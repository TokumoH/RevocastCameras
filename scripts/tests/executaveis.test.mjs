import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { lerMigracoes, ordenarMigracoes } from '../_catalogo.mjs'
import { verificarDataApi } from '../check-data-api.mjs'
import { verificarGrants } from '../check-rpc-grants.mjs'

// Cada processo novo inicializa um PGlite (alguns segundos, mais com a máquina ocupada).
vi.setConfig({ testTimeout: 60_000 })

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'checagens-banco-'))
afterAll(() => fs.rmSync(raiz, { recursive: true, force: true }))

/** Cria um diretório de migrações com os arquivos dados {nome: sql}. */
function migracoes(nome, arquivos, prefixo = '') {
  const dir = path.join(raiz, nome)
  fs.mkdirSync(dir)
  Object.entries(arquivos).forEach(([arq, sql], i) => fs.writeFileSync(path.join(dir, arq), (i === 0 ? prefixo : '') + sql))
  return dir
}

function rodar(script, ...args) {
  const r = spawnSync(process.execPath, [path.join(scripts, script), ...args], { encoding: 'utf8' })
  return { codigo: r.status, saida: r.stdout, erro: r.stderr }
}

const BOA = `alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
create table public.cenas (id uuid);
alter table public.cenas enable row level security;
create policy p on public.cenas for select to authenticated using (true);
grant select on public.cenas to authenticated;
create function public.papel_atual() returns text language sql stable security definer set search_path = '' as $$ select null::text $$;
revoke execute on function public.papel_atual() from public, anon, service_role;
grant execute on function public.papel_atual() to authenticated;
create function public.f() returns int language sql security definer set search_path = '' as $$ select length(public.papel_atual()) $$;
revoke execute on function public.f() from public, anon, service_role;
grant execute on function public.f() to authenticated;`

describe('lerMigracoes', () => {
  test('concatena em ordem de nome e ignora o que não é .sql', () => {
    const dir = migracoes('ordem', { '20261117000001_b.sql': 'B', '20261117000000_a.sql': 'A', 'LEIAME.md': 'x' })
    expect(lerMigracoes(dir).map((m) => [m.arquivo, m.sql])).toEqual([
      ['20261117000000_a.sql', 'A'],
      ['20261117000001_b.sql', 'B'],
    ])
  })

  test('ordena mesmo quando o sistema de arquivos devolve fora de ordem', () => {
    const dir = migracoes('fora-de-ordem', { '20261117000000_a.sql': 'A', '20261117000001_b.sql': 'B', '20261201000000_c.sql': 'C' })
    const espiao = vi.spyOn(fs, 'readdirSync').mockReturnValue(['20261201000000_c.sql', '20261117000000_a.sql', '20261117000001_b.sql'])
    try {
      expect(lerMigracoes(dir).map((m) => m.arquivo)).toEqual(['20261117000000_a.sql', '20261117000001_b.sql', '20261201000000_c.sql'])
    } finally {
      espiao.mockRestore()
    }
  })

  test('ordenarMigracoes ordena por nome e descarta o que não é .sql', () => {
    expect(ordenarMigracoes(['b.sql', 'a.sql', 'LEIAME.md', 'c.txt'])).toEqual(['a.sql', 'b.sql'])
  })

  test('subdiretório com nome .sql: erro com o nome (revisão 12, N5)', () => {
    const dir = migracoes('subdir-sql', { '20261117000000_a.sql': 'A' })
    fs.mkdirSync(path.join(dir, 'x.sql'))
    expect(() => lerMigracoes(dir)).toThrow(/^x\.sql: não é um arquivo$/)
  })

  // Revisão 13, N4: a Supabase CLI só aplica <dígitos>_nome.sql; um .sql fora do padrão ficaria verde aqui e de fora no db push.
  test.each([['corrige_rls.sql'], ['_20261117000000.sql'], ['20261117000000.sql'], ['20261117000000-x.sql'], ['v1_x.sql']])('nome fora do padrão da CLI (%s): erro com o nome', (arq) => {
    const dir = migracoes(`fora-do-padrao-${arq}`, { '20261117000000_a.sql': 'A', [arq]: 'B' })
    expect(() => lerMigracoes(dir)).toThrow(new RegExp(`^${arq.replace(/\./g, '\\.')}: nome fora do padrão da Supabase CLI \\(<dígitos>_nome\\.sql\\): a CLI não aplicaria o arquivo$`))
  })

  test('nome no padrão da CLI com só um dígito: aceito', () => {
    expect(lerMigracoes(migracoes('um-digito', { '1_a.sql': 'A' })).map((m) => m.arquivo)).toEqual(['1_a.sql'])
  })

  test('diretório ausente ou vazio: nenhuma migração', () => {
    expect(lerMigracoes(path.join(raiz, 'nao-existe'))).toEqual([])
    expect(lerMigracoes(migracoes('vazio', {}))).toEqual([])
  })
})

describe('guarda de execução', () => {
  test.each(['_catalogo.mjs', 'check-rpc-grants.mjs', 'check-data-api.mjs'])('importar %s com argv[1] inexistente não lança nem executa a checagem', (arq) => {
    const codigo = `process.argv[1] = '/nao/existe/nada.mjs'; await import(${JSON.stringify(path.join(scripts, arq))}); console.log('importou')`
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', codigo], { encoding: 'utf8' })
    expect(r.stderr).toBe('')
    expect(r.stdout.trim()).toBe('importou')
    expect(r.status).toBe(0)
  })
})

describe.each([
  ['check-rpc-grants.mjs', 'check-rpc-grants'],
  ['check-data-api.mjs', 'check-data-api'],
])('executável %s', (script, nome) => {
  test('sem migração: acusa e sai com código 1', () => {
    const r = rodar(script, path.join(raiz, 'nao-existe'))
    expect(r.codigo).toBe(1)
    expect(r.erro).toContain(`ERRO [${nome}] nenhuma migração .sql em`)
    expect(r.erro.trim().split('\n')).toHaveLength(1) // só o aviso de migração ausente, sem rodar as regras sobre texto vazio
  })

  test('arquivo no lugar do diretório: nenhuma migração, código 1, sem stack trace', () => {
    const arquivo = path.join(raiz, `arquivo-${nome}.sql`)
    fs.writeFileSync(arquivo, 'select 1;')
    const r = rodar(script, arquivo)
    expect(r.codigo).toBe(1)
    expect(r.erro).toContain(`ERRO [${nome}] nenhuma migração .sql em`)
    expect(r.erro).not.toMatch(/\n\s+at |Error:/)
  })

  test('diretório sem .sql: acusa e sai com código 1', () => {
    const r = rodar(script, migracoes(`sem-sql-${nome}`, { 'LEIAME.md': 'x' }))
    expect(r.codigo).toBe(1)
    expect(r.erro).toContain('nenhuma migração .sql em')
  })

  test('subdiretório com nome .sql: mensagem clara, código 1, sem stack trace', () => {
    const dir = migracoes(`subdir-${nome}`, { '20261117000000_a.sql': 'select 1;' })
    fs.mkdirSync(path.join(dir, 'x.sql'))
    const r = rodar(script, dir)
    expect(r.codigo).toBe(1)
    expect(r.erro).toBe(`ERRO [${nome}] não foi possível ler as migrações: x.sql: não é um arquivo\n`)
  })

  test('migração com nome fora do padrão da CLI: mensagem clara, código 1', () => {
    const r = rodar(script, migracoes(`fora-do-padrao-cli-${nome}`, { '20261117000000_a.sql': 'select 1;', 'corrige_rls.sql': 'select 1;' }))
    expect(r.codigo).toBe(1)
    expect(r.erro).toBe(`ERRO [${nome}] não foi possível ler as migrações: corrige_rls.sql: nome fora do padrão da Supabase CLI (<dígitos>_nome.sql): a CLI não aplicaria o arquivo\n`)
  })

  test('uso incorreto (argumentos demais): código 2', () => {
    expect(rodar(script, 'a', 'b').codigo).toBe(2)
  })

  test('executado por link simbólico também roda a checagem', () => {
    const link = path.join(raiz, `link-${nome}.mjs`)
    fs.symlinkSync(path.join(scripts, script), link)
    const r = spawnSync(process.execPath, [link, path.join(raiz, 'nao-existe')], { encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('nenhuma migração')
  })
})

describe('executáveis sobre migração com defeito', () => {
  test('rpc:grants-check cita a função', () => {
    const ruim = BOA.replace('revoke execute on function public.f() from public, anon, service_role;', '')
    expect(ruim).not.toBe(BOA)
    const r = rodar('check-rpc-grants.mjs', migracoes('ruim-rpc', { '20261117000000_a.sql': ruim }))
    expect(r.codigo).toBe(1)
    expect(r.erro).toContain('ERRO [check-rpc-grants] public.f: PUBLIC com EXECUTE (falta revoke execute ... from public)')
    expect(r.erro).toContain('ERRO [check-rpc-grants] public.f: anon com EXECUTE (falta revoke execute ... from anon)')
  })

  test('data-api:check cita a tabela', () => {
    const ruim = BOA.replace('alter table public.cenas enable row level security;', '')
    expect(ruim).not.toBe(BOA)
    const r = rodar('check-data-api.mjs', migracoes('ruim-api', { '20261117000000_a.sql': ruim }))
    expect(r.codigo).toBe(1)
    expect(r.erro).toContain('ERRO [check-data-api] public.cenas: sem row level security (falta alter table ... enable row level security)')
  })

  test('erro de SQL: cita o arquivo e a mensagem do Postgres, sem stack trace, código 1', () => {
    const dir = migracoes('erro-sql', { '20261117000000_a.sql': BOA, '20261117000001_b.sql': 'select 1;\nalter tabel public.cenas disable row level security;' })
    const r = rodar('check-data-api.mjs', dir)
    expect(r.codigo).toBe(1)
    expect(r.erro).toBe('ERRO [check-data-api] 20261117000001_b.sql: erro de SQL: syntax error at or near "tabel" (linha 2)\n')
  })
})

// Os casos abaixo usam as funções no mesmo processo (instância de PGlite reaproveitada), sobre migrações lidas
// do disco por lerMigracoes(): cada processo novo custa a inicialização do PGlite (cerca de 2,5 s).
const PADRAO = 'alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;\nalter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;\n'

describe('várias migrações, lidas do disco', () => {
  test('as migrações são lidas em conjunto: tabela numa e RLS/política em outra', async () => {
    const dir = migracoes('conjunto', {
      '20261117000000_a.sql': 'create table public.cenas (id uuid);',
      '20261117000001_b.sql': 'alter table public.cenas enable row level security;\ncreate policy p on public.cenas for select to authenticated using (true);\ngrant select on public.cenas to authenticated;',
    }, PADRAO)
    expect(await verificarDataApi(lerMigracoes(dir))).toEqual([])
  })

  test('erro de SQL no rpc:grants-check também cita o arquivo', async () => {
    const dir = migracoes('erro-sql-rpc', { '20261117000000_a.sql': BOA, '20261117000001_b.sql': 'select 1/0;' })
    expect(await verificarGrants(lerMigracoes(dir))).toEqual(['20261117000001_b.sql: erro de SQL: division by zero (linha 1)'])
  })

  test('controle de transação numa migração: forma não suportada', async () => {
    const dir = migracoes('commit', { '20261117000000_a.sql': `${BOA}\ncommit;` })
    expect(await verificarDataApi(lerMigracoes(dir))).toEqual(['20261117000000_a.sql: controle de transação (begin/commit/rollback/end) na migração: forma não suportada'])
  })

  test('cada migração começa como sessão nova: set role e search_path da anterior não valem na seguinte', async () => {
    const dir = migracoes('sessao', {
      '20261117000000_a.sql': `${BOA}\nset role anon; set search_path = auth;`,
      '20261117000001_b.sql': 'create table cenas2 (id int); alter table public.cenas2 enable row level security; create policy p on public.cenas2 to authenticated using (true); grant select, insert, update, delete on public.cenas2 to authenticated;',
    })
    expect(await verificarDataApi(lerMigracoes(dir))).toEqual([])
  })
})

describe('migração sem ";" no fim do arquivo', () => {
  test('rpc:grants-check: o último comando de uma migração não gruda no primeiro da seguinte', async () => {
    const dir = migracoes('sem-ponto-e-virgula-rpc', { '20261201000000_a.sql': BOA.replace(/;$/, ''), '20261202000000_b.sql': 'grant execute on function public.f() to anon;' })
    expect(await verificarGrants(lerMigracoes(dir))).toEqual([
      'public.f: anon com EXECUTE (falta revoke execute ... from anon)',
      'public.f: EXECUTE concedido a anon (só authenticated é permitido)',
    ])
  })

  test('data-api:check: RLS sem ";" no fim e política na migração seguinte', async () => {
    const dir = migracoes('sem-ponto-e-virgula-api', {
      '20261201000000_a.sql': 'create table public.cenas (id uuid);\nalter table public.cenas enable row level security',
      '20261202000000_b.sql': 'create policy p on public.cenas for select to authenticated using (true); grant select on public.cenas to authenticated;',
    }, PADRAO)
    expect(await verificarDataApi(lerMigracoes(dir))).toEqual([])
  })

  test('arquivo que termina em comentário de linha sem quebra de linha também não gruda', async () => {
    const dir = migracoes('termina-em-comentario', {
      '20261201000000_a.sql': 'create table public.cenas (id uuid);\nalter table public.cenas enable row level security; -- fim',
      '20261202000000_b.sql': 'create policy p on public.cenas for select to authenticated using (true); grant select on public.cenas to authenticated;',
    }, PADRAO)
    expect(await verificarDataApi(lerMigracoes(dir))).toEqual([])
  })
})

describe('diretório padrão das migrações', () => {
  // Revisão 12, N4: a guarda "a simulação não criou o papel" (simulação incompleta ou trocada).
  // Correção 17b: service_role (criado pela simulação desde a correção 14 da Tarefa 3) também é exigido.
  test.each([
    ['anon', 'create role authenticated nologin;'],
    ['service_role', 'create role anon nologin; create role authenticated nologin;'],
  ])('simulação do Supabase sem o papel %s: falha fechada, mensagem clara, sem stack trace', (papel, simulacao) => {
    const projeto = path.join(raiz, `projeto-sem-${papel}`)
    fs.mkdirSync(path.join(projeto, 'scripts'), { recursive: true })
    // check-data-api.mjs importa a leitura do corpo de check-rpc-grants.mjs (PLA-003, D13).
    for (const f of ['_lib.mjs', '_catalogo.mjs', 'check-rpc-grants.mjs', 'check-data-api.mjs']) fs.copyFileSync(path.join(scripts, f), path.join(projeto, 'scripts', f))
    fs.symlinkSync(path.join(scripts, '..', 'node_modules'), path.join(projeto, 'node_modules'))
    fs.mkdirSync(path.join(projeto, 'supabase', 'migrations'), { recursive: true })
    fs.mkdirSync(path.join(projeto, 'supabase', 'tests'))
    fs.writeFileSync(path.join(projeto, 'supabase', 'migrations', '20261117000000_a.sql'), BOA)
    fs.writeFileSync(path.join(projeto, 'supabase', 'tests', 'simulacao-supabase.sql'), simulacao)
    fs.writeFileSync(path.join(projeto, 'supabase', 'tests', 'dono-migracao.sql'), 'create role postgres_sim nologin;')
    const r = spawnSync(process.execPath, [path.join(projeto, 'scripts', 'check-data-api.mjs')], { encoding: 'utf8', cwd: raiz })
    expect(r.status).toBe(1)
    expect(r.stderr).toBe(`ERRO [check-data-api] não foi possível analisar as migrações: a simulação do Supabase não criou o papel ${papel}\n`)
  })

  // Correção 14: o dono das migrações (dono-migracao.sql, da Tarefa 3) tem de criar postgres_sim, e sem superusuário.
  test.each([
    ['sem o papel postgres_sim', 'create role outro nologin;', 'supabase/tests/dono-migracao.sql não criou o papel postgres_sim'],
    ['postgres_sim superusuário', 'create role postgres_sim nologin superuser;', 'o papel postgres_sim (dono das migrações) é superusuário: no Supabase o papel postgres não é'],
  ])('dono das migrações %s: falha fechada, mensagem clara', (caso, dono, msg) => {
    const projeto = path.join(raiz, `projeto-dono-${caso.replace(/\W+/g, '-')}`)
    fs.mkdirSync(path.join(projeto, 'scripts'), { recursive: true })
    for (const f of ['_lib.mjs', '_catalogo.mjs', 'check-rpc-grants.mjs']) fs.copyFileSync(path.join(scripts, f), path.join(projeto, 'scripts', f))
    fs.symlinkSync(path.join(scripts, '..', 'node_modules'), path.join(projeto, 'node_modules'))
    fs.mkdirSync(path.join(projeto, 'supabase', 'migrations'), { recursive: true })
    fs.mkdirSync(path.join(projeto, 'supabase', 'tests'))
    fs.writeFileSync(path.join(projeto, 'supabase', 'migrations', '20261117000000_a.sql'), BOA)
    fs.copyFileSync(path.join(scripts, '..', 'supabase', 'tests', 'simulacao-supabase.sql'), path.join(projeto, 'supabase', 'tests', 'simulacao-supabase.sql'))
    fs.writeFileSync(path.join(projeto, 'supabase', 'tests', 'dono-migracao.sql'), dono)
    const r = spawnSync(process.execPath, [path.join(projeto, 'scripts', 'check-rpc-grants.mjs')], { encoding: 'utf8', cwd: raiz })
    expect(r.status).toBe(1)
    expect(r.stderr).toBe(`ERRO [check-rpc-grants] não foi possível analisar as migrações: ${msg}\n`)
  })

  test.each([['check-rpc-grants.mjs', 'check-rpc-grants'], ['check-data-api.mjs', 'check-data-api']])('%s sem argumento lê supabase/migrations relativo à raiz do projeto', (script, nome) => {
    const projeto = path.join(raiz, `projeto-${nome}`)
    fs.mkdirSync(path.join(projeto, 'scripts'), { recursive: true })
    for (const f of ['_lib.mjs', '_catalogo.mjs', 'check-rpc-grants.mjs', 'check-data-api.mjs']) fs.copyFileSync(path.join(scripts, f), path.join(projeto, 'scripts', f))
    fs.symlinkSync(path.join(scripts, '..', 'node_modules'), path.join(projeto, 'node_modules'))
    // sem migrações: acusa o diretório padrão
    const sem = spawnSync(process.execPath, [path.join(projeto, 'scripts', script)], { encoding: 'utf8', cwd: raiz })
    expect(sem.status).toBe(1)
    expect(sem.stderr).toContain('nenhuma migração .sql em supabase')
    // com a migração correta no lugar padrão: ok, mesmo rodando de outro diretório
    fs.mkdirSync(path.join(projeto, 'supabase', 'migrations'), { recursive: true })
    fs.writeFileSync(path.join(projeto, 'supabase', 'migrations', '20261117000000_a.sql'), BOA)
    // sem a simulação do Supabase: falha fechada, sem stack trace
    const semSimulacao = spawnSync(process.execPath, [path.join(projeto, 'scripts', script)], { encoding: 'utf8', cwd: raiz })
    expect(semSimulacao.status).toBe(1)
    expect(semSimulacao.stderr).toBe(`ERRO [${nome}] não foi possível analisar as migrações: simulação do Supabase ausente: ${path.join('supabase', 'tests', 'simulacao-supabase.sql')}\n`)
    fs.mkdirSync(path.join(projeto, 'supabase', 'tests'))
    fs.copyFileSync(path.join(scripts, '..', 'supabase', 'tests', 'simulacao-supabase.sql'), path.join(projeto, 'supabase', 'tests', 'simulacao-supabase.sql'))
    // sem o dono das migrações (dono-migracao.sql): falha fechada, sem stack trace
    const semDono = spawnSync(process.execPath, [path.join(projeto, 'scripts', script)], { encoding: 'utf8', cwd: raiz })
    expect(semDono.status).toBe(1)
    expect(semDono.stderr).toBe(`ERRO [${nome}] não foi possível analisar as migrações: dono das migrações ausente: ${path.join('supabase', 'tests', 'dono-migracao.sql')}\n`)
    fs.copyFileSync(path.join(scripts, '..', 'supabase', 'tests', 'dono-migracao.sql'), path.join(projeto, 'supabase', 'tests', 'dono-migracao.sql'))
    const com = spawnSync(process.execPath, [path.join(projeto, 'scripts', script)], { encoding: 'utf8', cwd: raiz })
    expect(com.stderr).toBe('')
    expect(com.status).toBe(0)
    expect(com.stdout).toContain(`${nome}: 0 erro(s) — 1 migração(ões)`)
  })
})
