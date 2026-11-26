import { describe, expect, test, vi } from 'vitest'
import { regrasDeTabela, verificarDataApi } from '../check-data-api.mjs'

// O SQL de cada teste é aplicado de verdade num PGlite com a simulação do Supabase (scripts/_catalogo.mjs);
// as regras leem o catálogo resultante. Todo caso usa SQL aceito pelo Postgres, salvo os de erro de SQL.

/**
 * Como na migração real: tabelas e sequências criadas depois não nascem com privilégio algum para os clientes (o padrão
 * do Supabase de 2026-10-30, na simulação, ainda dá TRUNCATE, REFERENCES, TRIGGER e MAINTAIN nas tabelas e UPDATE nas sequências).
 */
const PADRAO = `alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;`

/** Tabela de exemplo correta: RLS ativa, uma política para authenticated e o grant da operação dela (como na migração real). */
function tabela(nome = 'cenas', {
  rls = true,
  politica = `create policy ${nome}_le on public.${nome} for select to authenticated using (true);`,
  grant = `grant select on public.${nome} to authenticated;`,
} = {}) {
  return `create table public.${nome} (id int, nome text);
${rls ? `alter table public.${nome} enable row level security;` : ''}
${politica}
${grant}`
}

/** Tabela só-funções correta: RLS ativa, nenhuma política e nenhum privilégio de anon e authenticated. */
function soFuncoes({ revoke = 'revoke all on table public.codigos_pareamento from anon, authenticated;', politica = '' } = {}) {
  return `create table public.codigos_pareamento (id int, codigo text);
alter table public.codigos_pareamento enable row level security;
${revoke}
${politica}`
}

const BASE = `${PADRAO}\n${tabela()}\n${soFuncoes()}`

/** O padrão antigo do Supabase (até 2026-10-30, "grant all" automático), reproduzido por grant explícito na tabela só-funções. */
const ANTIGO = 'grant all on public.codigos_pareamento to anon, authenticated;'

/** Erros do estado final dos privilégios padrão quando a migração não os revoga (padrão do Supabase de 2026-10-30). */
const PADRAO_NAO_REVOGADO = ['anon', 'service_role', 'authenticated'].map((p) => `alter default privileges (papel postgres_sim, schema public, tabelas): ${p} recebe TRUNCATE, REFERENCES, TRIGGER, MAINTAIN nas tabelas criadas depois (falta alter default privileges ... revoke)`)
  .concat(['anon', 'service_role', 'authenticated'].map((p) => `alter default privileges (papel postgres_sim, schema public, sequências): ${p} recebe UPDATE nas sequências criadas depois (falta alter default privileges ... revoke)`))

const SEM_POLITICA = 'sem política "to authenticated" para a operação (privilégio sem uso: vira acesso se a RLS for desligada ou trocada)'
const semGrant = (rotulo, politica, ops) => `${rotulo}: política ${politica} sem o grant de ${ops} a authenticated (no Supabase a política não vale: permission denied)`
// O primeiro teste de cada arquivo inicializa o PGlite (alguns segundos, mais com a máquina ocupada).
vi.setConfig({ testTimeout: 60_000 })

const verificar = (sql) => verificarDataApi(sql)

// Formas que só um superusuário consegue (no Supabase, o postgres que aplica as migrações não é superusuário): aplicadas
// como postgres_sim, dão erro de SQL (ver catalogo.test.mjs). Aqui a migração escala (set session authorization postgres)
// e volta ao dono no fim, desvio que a conferência do usuário da sessão não vê: o catálogo continua acusando.
const su = (sql) => `set session authorization postgres; ${sql} set session authorization postgres_sim;`

describe('regras do DES-001 (seções 8 e 13)', () => {
  test('tabelas corretas: nenhum erro', async () => {
    expect(await verificar(BASE)).toEqual([])
  })

  test('tabela sem RLS', async () => {
    expect(await verificar(`${PADRAO} ${tabela('cenas', { rls: false })}`)).toEqual(['public.cenas: sem row level security (falta alter table ... enable row level security)'])
  })

  test('tabela sem política', async () => {
    expect(await verificar(`${PADRAO} ${tabela('cenas', { politica: '', grant: '' })}`)).toEqual(['public.cenas: sem nenhuma política (create policy)'])
  })

  // Correção 16: desde 2026-10-30 o Supabase não dá mais SELECT/INSERT/UPDATE/DELETE automáticos. Os testes abaixo
  // reproduzem o padrão antigo com um grant explícito no próprio SQL (ANTIGO), e o novo vem da simulação.
  test('só-funções sem revoke, no padrão novo do Supabase: anon e authenticated com o que ele ainda dá (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN)', async () => {
    expect(await verificar(soFuncoes({ revoke: '' }))).toEqual([
      'public.codigos_pareamento: anon com TRUNCATE, REFERENCES, TRIGGER, MAINTAIN em tabela só-funções',
      'public.codigos_pareamento: service_role com TRUNCATE, REFERENCES, TRIGGER, MAINTAIN em tabela só-funções',
      'public.codigos_pareamento: authenticated com TRUNCATE, REFERENCES, TRIGGER, MAINTAIN em tabela só-funções',
      ...PADRAO_NAO_REVOGADO,
    ])
  })

  test('só-funções sem revoke, com o privilégio do padrão antigo dado por grant explícito', async () => {
    expect(await verificar(`${PADRAO} ${soFuncoes({ revoke: ANTIGO })}`)).toEqual([
      'public.codigos_pareamento: anon com SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN em tabela só-funções',
      'public.codigos_pareamento: authenticated com SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN em tabela só-funções',
    ])
  })

  test('só-funções com política', async () => {
    const politica = 'create policy p on public.codigos_pareamento for select to authenticated using (true);'
    expect(await verificar(`${PADRAO} ${soFuncoes({ politica })}`)).toEqual(['public.codigos_pareamento: tabela só-funções não pode ter política'])
  })

  test('só-funções com revoke só de anon', async () => {
    expect(await verificar(`${PADRAO} ${soFuncoes({ revoke: `${ANTIGO} revoke all on public.codigos_pareamento from anon;` })}`)).toEqual([
      'public.codigos_pareamento: authenticated com SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN em tabela só-funções',
    ])
  })

  test('só-funções com revoke só de authenticated', async () => {
    expect(await verificar(`${PADRAO} ${soFuncoes({ revoke: `${ANTIGO} revoke all on public.codigos_pareamento from authenticated;` })}`)).toEqual([
      'public.codigos_pareamento: anon com SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN em tabela só-funções',
    ])
  })

  test('só-funções com revoke all (coluna): não tira o privilégio de tabela (mutante 456 da revisão 11)', async () => {
    expect(await verificar(`${PADRAO} ${soFuncoes({ revoke: `${ANTIGO} revoke all (id) on public.codigos_pareamento from anon, authenticated;` })}`)).toEqual([
      'public.codigos_pareamento: anon com SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN em tabela só-funções',
      'public.codigos_pareamento: authenticated com SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN em tabela só-funções',
    ])
  })

  test('só-funções com grant de coluna a authenticated', async () => {
    expect(await verificar(`${BASE} grant select (id) on public.codigos_pareamento to authenticated;`)).toEqual([
      'public.codigos_pareamento: authenticated com privilégio de coluna em tabela só-funções',
    ])
  })

  test('só-funções com grant de coluna a anon', async () => {
    expect(await verificar(`${BASE} grant select (id) on public.codigos_pareamento to anon;`)).toEqual([
      'public.codigos_pareamento: anon com SELECT na coluna id',
      'public.codigos_pareamento: anon com privilégio de coluna em tabela só-funções',
    ])
  })

  test('só-funções com grant a anon depois do revoke', async () => {
    expect(await verificar(`${BASE} grant select on public.codigos_pareamento to anon;`)).toEqual(['public.codigos_pareamento: anon com SELECT em tabela só-funções'])
  })

  test('só-funções com grant a public depois do revoke', async () => {
    expect(await verificar(`${BASE} grant select on public.codigos_pareamento to public;`)).toEqual([
      'public.codigos_pareamento: PUBLIC com SELECT',
      'public.codigos_pareamento: anon com SELECT em tabela só-funções',
      'public.codigos_pareamento: service_role com SELECT em tabela só-funções',
      'public.codigos_pareamento: authenticated com SELECT em tabela só-funções',
    ])
  })

  test('SQL sem tabela: nada conferido', async () => {
    expect(await verificar(PADRAO)).toEqual(['nenhuma tabela criada pelas migrações: a checagem não conferiu nada'])
  })

  test('SQL vazio: nada conferido, e os privilégios padrão do Supabase continuam dando algo a anon e a authenticated', async () => {
    expect(await verificar('')).toEqual(['nenhuma tabela criada pelas migrações: a checagem não conferiu nada', ...PADRAO_NAO_REVOGADO])
  })

  test('erro de SQL: a mensagem do Postgres', async () => {
    expect(await verificar(`${BASE}\nalter table public.nao_existe enable row level security;`)).toEqual(['sql: erro de SQL: relation "public.nao_existe" does not exist (linha 11)'])
  })

  test('erro de sintaxe: a mensagem do Postgres, com a linha', async () => {
    expect(await verificar(`${BASE}\nalter tabel public.cenas enable row level security;`)).toEqual(['sql: erro de SQL: syntax error at or near "tabel" (linha 11)'])
  })
})

describe('regras além do DES-001', () => {
  test('tabela fora de public', async () => {
    expect(await verificar(`${BASE} ${su('create schema privado authorization postgres_sim;')} create table privado.x (id int); alter table privado.x enable row level security; create policy p on privado.x to authenticated using (true); grant select, insert, update, delete on privado.x to authenticated;`)).toEqual([
      'privado.x: fora do schema public (o DES-001 põe tudo em public)',
    ])
  })

  test('dono authenticated (owner to): o dono passa por cima da RLS', async () => {
    expect(await verificar(`${BASE} ${su('alter table public.cenas owner to authenticated;')}`)).toEqual([
      'public.cenas: dono é authenticated (só postgres_sim, o papel que aplica as migrações)',
      'public.cenas: authenticated com TRUNCATE, REFERENCES, TRIGGER, MAINTAIN',
      // como dono, authenticated tem todos os privilégios, e só há política de select
      `public.cenas: authenticated com INSERT, UPDATE, DELETE ${SEM_POLITICA}`,
    ])
  })

  test.each([
    ['sem "to" (vale para PUBLIC)', 'create policy vaza on public.cenas for select using (true);', 'PUBLIC'],
    ['to public', 'create policy vaza on public.cenas for select to public using (true);', 'PUBLIC'],
    ['to anon', 'create policy vaza on public.cenas for select to anon using (true);', 'anon'],
    ['to authenticated, anon', 'create policy vaza on public.cenas for select to authenticated, anon using (true);', 'anon'],
  ])('política para anon ou PUBLIC: %s', async (_caso, politica, papel) => {
    expect(await verificar(`${BASE} ${politica}`)).toEqual([`public.cenas: política vaza vale para ${papel} (só "to authenticated" é permitido)`])
  })

  test('grant a PUBLIC em tabela comum', async () => {
    // anon herda de PUBLIC (privilégio efetivo)
    expect(await verificar(`${BASE} grant select on public.cenas to public;`)).toEqual(['public.cenas: PUBLIC com SELECT', 'public.cenas: anon com SELECT', 'public.cenas: service_role com SELECT'])
  })

  test('grant de coluna a anon', async () => {
    expect(await verificar(`${BASE} grant update (nome) on public.cenas to anon;`)).toEqual(['public.cenas: anon com UPDATE na coluna nome'])
  })

  test('grant com grant option', async () => {
    expect(await verificar(`${BASE} grant select on public.cenas to authenticated with grant option;`)).toEqual([
      'public.cenas: authenticated com grant option em SELECT (pode repassar o privilégio)',
    ])
  })

  test.each([['truncate'], ['references'], ['trigger'], ['maintain']])('%s a authenticated', async (priv) => {
    expect(await verificar(`${BASE} grant ${priv} on public.cenas to authenticated;`)).toEqual([`public.cenas: authenticated com ${priv.toUpperCase()}`])
  })

  // Revisão 13, I2: a regra vale também para o privilégio de coluna (o has_table_privilege só vê o de tabela).
  test.each([
    ['tabela', 'grant references (id) on public.cenas to authenticated;', 'public.cenas'],
    ['tabela, junto com select de coluna', 'grant references (id), select (id) on public.cenas to authenticated;', 'public.cenas'],
    ['view', 'create view public.v with (security_invoker = true) as select id from public.cenas; grant references (id) on public.v to authenticated;', 'public.v'],
  ])('references de coluna a authenticated (%s)', async (_caso, sql, rotulo) => {
    expect(await verificar(`${BASE} ${sql}`)).toEqual([`${rotulo}: authenticated com REFERENCES na coluna id`])
  })

  test('select, insert e update de coluna a authenticated, com as políticas das operações: aceito', async () => {
    const politicas = 'create policy cenas_insere on public.cenas for insert to authenticated with check (true); create policy cenas_altera on public.cenas for update to authenticated using (true);'
    expect(await verificar(`${PADRAO} ${tabela('cenas', { grant: '' })} ${politicas} grant select (id), insert (nome), update (nome) on public.cenas to authenticated; ${soFuncoes()}`)).toEqual([])
  })

  // Correção 16: a regra literal do brief (qualquer privilégio de anon é erro). A revisão 14 (I1) provou que eles não
  // ficam inertes sob a RLS: por um gatilho, anon gravava como o dono da função (ver "gatilhos (revisão 14, I1)").
  test('grant all a anon: tudo acusado', async () => {
    expect(await verificar(`${BASE} grant all on public.cenas to anon;`)).toEqual(['public.cenas: anon com SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'])
  })

  test('select, insert, update e delete de anon (o padrão antigo do Supabase), mesmo com RLS e sem política para anon: acusados', async () => {
    expect(await verificar(`${BASE} grant select, insert, update, delete on public.cenas to anon;`)).toEqual(['public.cenas: anon com SELECT, INSERT, UPDATE, DELETE'])
  })

  test.each([
    ['select em view', 'create view public.v with (security_invoker) as select id from public.cenas; grant select on public.v to anon;', ['public.v: anon com SELECT']],
    ['maintain em tabela', 'grant maintain on public.cenas to anon;', ['public.cenas: anon com MAINTAIN']],
    ['herdado de PUBLIC, em sequência', 'create sequence public.s; grant usage on sequence public.s to public;', ['public.s: PUBLIC com USAGE', 'public.s: anon com USAGE em sequência', 'public.s: service_role com USAGE em sequência', 'public.s: authenticated com USAGE em sequência']],
  ])('qualquer privilégio de anon: %s', async (_caso, sql, esperado) => {
    expect(await verificar(`${BASE} ${sql}`)).toEqual(esperado)
  })

  test('sem o revoke dos privilégios padrão (padrão de 2026-10-30): as tabelas nascem com TRUNCATE, REFERENCES, TRIGGER e MAINTAIN', async () => {
    expect(await verificar(`${tabela()}`)).toEqual([
      'public.cenas: anon com TRUNCATE, REFERENCES, TRIGGER, MAINTAIN',
      'public.cenas: service_role com TRUNCATE, REFERENCES, TRIGGER, MAINTAIN',
      'public.cenas: authenticated com TRUNCATE, REFERENCES, TRIGGER, MAINTAIN',
      ...PADRAO_NAO_REVOGADO,
    ])
  })

  test('privilégio padrão: TRUNCATE de volta para anon', async () => {
    expect(await verificar(`${BASE} alter default privileges in schema public grant truncate on tables to anon;`)).toEqual([
      'alter default privileges (papel postgres_sim, schema public, tabelas): anon recebe TRUNCATE nas tabelas criadas depois (falta alter default privileges ... revoke)',
    ])
  })

  test.each([
    ['public', 'alter default privileges grant select on tables to public;', [
      'alter default privileges (papel postgres_sim, todos os schemas, tabelas): PUBLIC ganha SELECT nos objetos criados depois',
      'alter default privileges (papel postgres_sim, todos os schemas, tabelas): PUBLIC recebe SELECT nas tabelas criadas depois (falta alter default privileges ... revoke)',
    ]],
    ['anon (global)', 'alter default privileges grant select on tables to anon;', [
      'alter default privileges (papel postgres_sim, todos os schemas, tabelas): anon ganha SELECT nos objetos criados depois',
      'alter default privileges (papel postgres_sim, todos os schemas, tabelas): anon recebe SELECT nas tabelas criadas depois (falta alter default privileges ... revoke)',
    ]],
    ['schemas', 'alter default privileges grant usage on schemas to anon;', ['alter default privileges (papel postgres_sim, todos os schemas, schemas): anon ganha USAGE nos objetos criados depois']],
    // Correção 16: no estado final, anon não recebe nada nas sequências criadas depois (o padrão do Supabase dá UPDATE).
    ['sequências (anon, de volta)', 'alter default privileges in schema public grant update on sequences to anon;', [
      'alter default privileges (papel postgres_sim, schema public, sequências): anon recebe UPDATE nas sequências criadas depois (falta alter default privileges ... revoke)',
    ]],
    // Correção 16b: authenticated também não recebe nada nas sequências criadas depois, nem MAINTAIN nas tabelas.
    ['sequências (authenticated)', 'alter default privileges in schema public grant update on sequences to authenticated;', [
      'alter default privileges (papel postgres_sim, schema public, sequências): authenticated recebe UPDATE nas sequências criadas depois (falta alter default privileges ... revoke)',
    ]],
    ['tabelas (authenticated com select): fora da regra', 'alter default privileges in schema public grant select on tables to authenticated;', []],
    ['tabelas (authenticated com maintain)', 'alter default privileges in schema public grant maintain on tables to authenticated;', [
      'alter default privileges (papel postgres_sim, schema public, tabelas): authenticated recebe MAINTAIN nas tabelas criadas depois (falta alter default privileges ... revoke)',
    ]],
  ])('privilégio padrão para %s', async (_caso, sql, esperado) => {
    expect(await verificar(`${BASE} ${sql}`)).toEqual(esperado)
  })

  // Correção 17c (decisão do controlador): service_role não recebe nada nas tabelas e sequências criadas depois.
  test('privilégio padrão para service_role: acusado no estado final', async () => {
    expect(await verificar(`${BASE} alter default privileges in schema public grant all on tables to service_role;`)).toEqual([
      'alter default privileges (papel postgres_sim, schema public, tabelas): service_role recebe SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN nas tabelas criadas depois (falta alter default privileges ... revoke)',
    ])
  })

  test('privilégio padrão de service_role sem o revoke (padrão do Supabase): tabelas e sequências', async () => {
    const sql = `alter default privileges in schema public revoke all on tables from anon, authenticated; alter default privileges in schema public revoke all on sequences from anon, authenticated;
${tabela()} ${soFuncoes()} create sequence public.s;`
    expect(await verificar(sql)).toEqual([
      'public.cenas: service_role com TRUNCATE, REFERENCES, TRIGGER, MAINTAIN',
      'public.codigos_pareamento: service_role com TRUNCATE, REFERENCES, TRIGGER, MAINTAIN em tabela só-funções',
      'public.s: service_role com UPDATE em sequência',
      'alter default privileges (papel postgres_sim, schema public, tabelas): service_role recebe TRUNCATE, REFERENCES, TRIGGER, MAINTAIN nas tabelas criadas depois (falta alter default privileges ... revoke)',
      'alter default privileges (papel postgres_sim, schema public, sequências): service_role recebe UPDATE nas sequências criadas depois (falta alter default privileges ... revoke)',
    ])
  })

  test.each([
    ['tabela', 'grant select, insert on public.cenas to service_role;', ['public.cenas: service_role com SELECT, INSERT']],
    ['view', 'create view public.v with (security_invoker) as select id from public.cenas; grant select on public.v to service_role;', ['public.v: service_role com SELECT']],
    ['coluna', 'grant update (nome) on public.cenas to service_role;', ['public.cenas: service_role com UPDATE na coluna nome']],
    ['sequência', 'create sequence public.s; grant usage on sequence public.s to service_role;', ['public.s: service_role com USAGE em sequência']],
    ['tabela só-funções', 'grant select on public.codigos_pareamento to service_role;', ['public.codigos_pareamento: service_role com SELECT em tabela só-funções']],
    ['grant option', 'grant select on public.cenas to service_role with grant option;', [
      'public.cenas: service_role com grant option em SELECT (pode repassar o privilégio)',
      'public.cenas: service_role com SELECT',
    ]],
    ['coluna herdada por participação', "create role r; grant select (nome) on public.cenas to r; grant r to service_role;", ['public.cenas: r com SELECT na coluna nome', 'public.cenas: service_role com privilégio de coluna']],
    ['tabela herdada por participação', "create role r; grant select on public.cenas to r; grant r to service_role;", ['public.cenas: r com SELECT (só authenticated pode ter privilégio)', 'public.cenas: service_role com SELECT']],
  ])('qualquer privilégio de service_role (correção 17c): %s', async (_caso, sql, esperado) => {
    expect(await verificar(`${BASE} ${sql}`)).toEqual(esperado)
  })

  test('sequência sem o revoke dos privilégios padrão: anon com UPDATE (o padrão do Supabase de 2026-10-30)', async () => {
    const padraoSoDeTabelas = 'alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;'
    expect(await verificar(`${padraoSoDeTabelas} ${tabela()} ${soFuncoes()} create sequence public.s;`)).toEqual([
      'public.s: anon com UPDATE em sequência',
      'public.s: service_role com UPDATE em sequência',
      'public.s: authenticated com UPDATE em sequência',
      'alter default privileges (papel postgres_sim, schema public, sequências): anon recebe UPDATE nas sequências criadas depois (falta alter default privileges ... revoke)',
      'alter default privileges (papel postgres_sim, schema public, sequências): service_role recebe UPDATE nas sequências criadas depois (falta alter default privileges ... revoke)',
      'alter default privileges (papel postgres_sim, schema public, sequências): authenticated recebe UPDATE nas sequências criadas depois (falta alter default privileges ... revoke)',
    ])
  })

  test('sequência com grant explícito a anon (o padrão antigo do Supabase)', async () => {
    expect(await verificar(`${BASE} create sequence public.s; grant usage, select, update on sequence public.s to anon;`)).toEqual(['public.s: anon com USAGE, SELECT, UPDATE em sequência'])
  })

  test('sequência com o padrão: nenhum privilégio de anon', async () => {
    expect(await verificar(`${BASE} create sequence public.s;`)).toEqual([])
  })

  test('sequência sem privilégio de anon: aceita', async () => {
    expect(await verificar(`${BASE} create sequence public.s; revoke all on sequence public.s from anon;`)).toEqual([])
  })

  test('coluna identity: a sequência é conferida', async () => {
    const sql = `${PADRAO} ${tabela('t').replace('id int', 'id int generated always as identity')} grant usage, select, update on sequence public.t_id_seq to anon;`
    expect(await verificar(sql)).toEqual(['public.t_id_seq: anon com USAGE, SELECT, UPDATE em sequência'])
  })

  test('tabela particionada: cada partição precisa de RLS e política', async () => {
    const sql = `${BASE} create table public.p (id int) partition by range (id); alter table public.p enable row level security;
create policy p_le on public.p for select to authenticated using (true); grant select on public.p to authenticated; create table public.p1 partition of public.p for values from (0) to (10);`
    expect(await verificar(sql)).toEqual([
      'public.p1: sem row level security (falta alter table ... enable row level security)',
      'public.p1: sem nenhuma política (create policy)',
    ])
  })

  test('tabela particionada sem RLS', async () => {
    const sql = `${BASE} create table public.p (id int) partition by range (id); create policy p_le on public.p for select to authenticated using (true); grant select on public.p to authenticated;`
    expect(await verificar(sql)).toEqual(['public.p: sem row level security (falta alter table ... enable row level security)'])
  })

  test('só tabela particionada: conta como tabela conferida', async () => {
    const sql = `${PADRAO} create table public.p (id int) partition by range (id); alter table public.p enable row level security; create policy p_le on public.p for select to authenticated using (true); grant select on public.p to authenticated;`
    expect(await verificar(sql)).toEqual([])
  })

  test('grant de coluna a PUBLIC', async () => {
    // service_role herda de PUBLIC (privilégio efetivo de coluna)
    expect(await verificar(`${BASE} grant select (nome) on public.cenas to public;`)).toEqual(['public.cenas: PUBLIC com SELECT na coluna nome', 'public.cenas: service_role com privilégio de coluna'])
  })

  test.each([
    ['funções', 'alter default privileges grant execute on functions to anon;'],
    ['tipos', 'alter default privileges grant usage on types to anon;'],
  ])('privilégio padrão de %s: fica fora desta checagem', async (_caso, sql) => {
    expect(await verificar(`${BASE} ${sql}`)).toEqual([])
  })

  test('privilégio padrão: TRUNCATE para PUBLIC (ganho e estado final)', async () => {
    expect(await verificar(`${BASE} alter default privileges in schema public grant truncate on tables to public;`)).toEqual([
      'alter default privileges (papel postgres_sim, schema public, tabelas): PUBLIC ganha TRUNCATE nos objetos criados depois',
      'alter default privileges (papel postgres_sim, schema public, tabelas): PUBLIC recebe TRUNCATE nas tabelas criadas depois (falta alter default privileges ... revoke)',
    ])
  })

  test('privilégio padrão de outro papel (for role): comparado com a linha dele, não com a do postgres', async () => {
    expect(await verificar(`${BASE} ${su('create role r; alter default privileges for role r in schema public grant select on tables to anon;')}`)).toEqual([
      'alter default privileges (papel r, schema public, tabelas): anon ganha SELECT nos objetos criados depois',
    ])
  })

  // Revisão 13, I1: tabela temporária sobrando no fim da migração é recusada; apagada na própria migração, fica de fora.
  test('tabela temporária sobrando no fim da migração: forma não suportada', async () => {
    expect(await verificar(`${BASE} create temp table rascunho (id int);`)).toEqual([
      'sql: objeto temporário sobrando no fim da migração (table rascunho): forma não suportada; apague-o na própria migração (drop)',
    ])
  })

  test('tabela temporária apagada na própria migração: fica de fora', async () => {
    expect(await verificar(`${BASE} create temp table rascunho (id int); drop table rascunho;`)).toEqual([])
  })

  test('materialized view e foreign table: forma não suportada', async () => {
    const sql = `${BASE} create materialized view public.mv as select 1 as x; revoke all on public.mv from anon;
${su('create foreign data wrapper w; create server s foreign data wrapper w; grant usage on foreign server s to postgres_sim;')} create foreign table public.ft (id int) server s; revoke all on public.ft from anon;`
    expect(await verificar(sql)).toEqual([
      'public.ft: foreign table criada pelas migrações: forma não suportada',
      'public.mv: materialized view criada pelas migrações: forma não suportada',
      'wrapper de dados externos w: criação pelas migrações: forma não suportada',
      'servidor externo s: criação pelas migrações: forma não suportada',
    ])
  })
})

describe('views', () => {
  test.each([['security_invoker'], ['security_invoker = true'], ['security_invoker = on'], ['security_invoker = 1'], ['security_invoker = yes'], ["security_invoker = 'true'"], ['security_barrier, security_invoker']])(
    'view com %s: aceita',
    async (opcao) => {
      expect(await verificar(`${BASE} create view public.v with (${opcao}) as select id from public.cenas;`)).toEqual([])
    },
  )

  test('view com lista de colunas parecida com with (mutante 432)', async () => {
    expect(await verificar(`${BASE} create view public.v (with_x) with (security_invoker = true) as select id from public.cenas;`)).toEqual([])
  })

  test.each([
    ['sem with', 'create view public.v as select id from public.cenas;'],
    ['security_invoker = false', 'create view public.v with (security_invoker = false) as select id from public.cenas;'],
    ['alter view ... set (security_invoker = false)', 'create view public.v with (security_invoker) as select id from public.cenas; alter view public.v set (security_invoker = false);'],
    ['alter table <view> set (security_invoker = false)', 'create view public.v with (security_invoker) as select id from public.cenas; alter table public.v set (security_invoker = false);'],
    ['alter view ... reset (security_invoker)', 'create view public.v with (security_invoker) as select id from public.cenas; alter view public.v reset (security_invoker);'],
    ['create or replace sem invoker', 'create view public.v with (security_invoker) as select id from public.cenas; create or replace view public.v as select id from public.cenas;'],
  ])('view %s', async (_caso, sql) => {
    expect(await verificar(`${BASE} ${sql}`)).toEqual(['public.v: view sem security_invoker = true (sem isso a view ignora a RLS das tabelas)'])
  })

  test('alter view ... set (security_invoker = true) depois do create corrige', async () => {
    expect(await verificar(`${BASE} create view public.v as select id from public.cenas; alter view public.v set (security_invoker = true);`)).toEqual([])
  })
})

describe('o que contorna a RLS', () => {
  test('regra (create rule) que grava na tabela só-funções (revisão 11, I4)', async () => {
    const sql = `${BASE} create rule r as on insert to public.cenas do also insert into public.codigos_pareamento (id) values (new.id);`
    expect(await verificar(sql)).toEqual(['regra (create rule) r em public.cenas: criação pelas migrações: forma não suportada'])
  })

  test('gatilho de evento', async () => {
    const sql = `${BASE} create function public.e() returns event_trigger language plpgsql as $$ begin end $$; ${su('create event trigger et on ddl_command_end execute function public.e();')}`
    expect(await verificar(sql)).toEqual(['gatilho de evento et: criação pelas migrações: forma não suportada'])
  })

  test.each([
    ['alter role anon bypassrls', su('alter role anon bypassrls;'), ['papel anon: papel pré-existente: alteração pelas migrações: forma não suportada']],
    ['alter role authenticated createrole', su('alter role authenticated createrole;'), ['papel authenticated: papel pré-existente: alteração pelas migrações: forma não suportada']],
    ['papel novo com BYPASSRLS', su('create role r bypassrls;'), ['papel r: criado com BYPASSRLS']],
    ['papel novo com SUPERUSER', su('create role r superuser;'), ['papel r: criado com SUPERUSER']],
    // Correção 15: o dono tem CREATEROLE (como o postgres do Supabase): papel novo comum é aceito pela regra, sem su().
    ['papel novo comum', 'create role r;', []],
    ['papel novo com LOGIN, CREATEROLE e CREATEDB', 'create role r login createrole createdb;', []],
    // Correção 15b (decisão do controlador): REPLICATION lê todos os dados pela replicação, por fora da RLS.
    ['papel novo com REPLICATION', 'create role r replication;', ['papel r: criado com REPLICATION']],
    ['papel novo com LOGIN e REPLICATION', 'create role r login replication;', ['papel r: criado com REPLICATION']],
    ['papel novo que ganha REPLICATION depois (estado final)', 'create role r; alter role r replication;', ['papel r: criado com REPLICATION']],
    ['papel novo com SUPERUSER e REPLICATION', su('create role r superuser replication;'), ['papel r: criado com SUPERUSER', 'papel r: criado com REPLICATION']],
  ])('papéis: %s', async (_caso, sql, esperado) => {
    expect(await verificar(`${BASE} ${sql}`)).toEqual(esperado)
  })

  test.each([
    ['grant <papel> to anon', 'create role r; grant r to anon;', 'anon membro de r'],
    ['create role ... role anon', 'create role r role anon;', 'anon membro de r'],
    ['create role ... admin authenticated', 'create role r admin authenticated;', 'authenticated membro de r'],
    ['grant anon to <papel>', su('create role r; grant anon to r;'), 'r membro de anon'],
  ])('participação em papel: %s', async (_caso, sql, rotulo) => {
    expect(await verificar(`${BASE} ${sql}`)).toEqual([`${rotulo}: participação em papel envolvendo anon ou authenticated`])
  })

  test('grant authenticated to anon: a participação e o SELECT que anon herda de authenticated', async () => {
    expect(await verificar(`${BASE} ${su('grant authenticated to anon;')}`)).toEqual([
      'public.cenas: anon com SELECT',
      'anon membro de authenticated: participação em papel envolvendo anon ou authenticated',
    ])
  })

  test('grant pg_read_all_data to authenticated: a participação e o SELECT herdado na tabela só-funções', async () => {
    expect(await verificar(`${BASE} ${su('grant pg_read_all_data to authenticated;')}`)).toEqual([
      'public.codigos_pareamento: authenticated com SELECT em tabela só-funções',
      'authenticated membro de pg_read_all_data: participação em papel envolvendo anon ou authenticated',
    ])
  })

  test('participação sem anon nem authenticated: aceita', async () => {
    expect(await verificar(`${BASE} ${su('create role r; grant pg_read_all_data to r;')}`)).toEqual([])
    expect(await verificar(`${BASE} create role r; create role q in role r;`)).toEqual([])
  })
})

describe('objetos pré-existentes e outros objetos do catálogo', () => {
  test.each([
    ['grant em auth.users', su('grant select on auth.users to anon;'), 'auth.users: relação pré-existente (Postgres ou simulação do Supabase): alteração pelas migrações: forma não suportada'],
    ['grant em tabela do catálogo', su('grant select on pg_catalog.pg_authid to anon;'), 'pg_catalog.pg_authid: relação pré-existente (Postgres ou simulação do Supabase): alteração pelas migrações: forma não suportada'],
    ['RLS ligada em auth.users', su('alter table auth.users enable row level security;'), 'auth.users: relação pré-existente (Postgres ou simulação do Supabase): alteração pelas migrações: forma não suportada'],
    ['grant de coluna em auth.users', su('grant select (email) on auth.users to anon;'), 'auth.users: relação pré-existente (Postgres ou simulação do Supabase): alteração pelas migrações: forma não suportada'],
  ])('%s', async (_caso, sql, msg) => {
    expect(await verificar(`${BASE} ${sql}`)).toEqual([msg])
  })

  test.each([
    ['nome (rename)', su('alter table auth.users rename to usuarios;'), 'auth.usuarios'],
    ['schema (set schema)', su('create schema s; alter table auth.users set schema s;'), 's.users'],
    ['dono (owner to)', su('alter table auth.users owner to supabase_auth_admin;'), 'auth.users'],
    ['force row level security', su('alter table auth.users force row level security;'), 'auth.users'],
    ['opções (reloptions)', su('alter table auth.users set (fillfactor = 50);'), 'auth.users'],
  ])('relação pré-existente alterada: %s', async (_caso, sql, rotulo) => {
    expect(await verificar(`${BASE} ${sql}`)).toEqual([`${rotulo}: relação pré-existente (Postgres ou simulação do Supabase): alteração pelas migrações: forma não suportada`])
  })

  // Revisão 12, N1: antes aceitos (sem ganho de anon/PUBLIC); agora todo schema pré-existente alterado é acusado.
  test.each([
    ['nome (rename)', su('alter schema auth rename to autenticacao;'), 'autenticacao'],
    ['dono (owner to)', su('alter schema auth owner to supabase_auth_admin;'), 'auth'],
    ['privilégio revogado', su('revoke usage on schema auth from supabase_auth_admin;'), 'auth'],
  ])('schema pré-existente alterado: %s', async (_caso, sql, rotulo) => {
    expect(await verificar(`${BASE} ${sql}`)).toEqual([`schema ${rotulo}: schema pré-existente: alteração pelas migrações: forma não suportada`])
  })

  test.each([
    ['nome (rename)', su('alter role supabase_auth_admin rename to auth_admin;'), 'auth_admin'],
    ['SUPERUSER', su('alter role supabase_auth_admin superuser;'), 'supabase_auth_admin'],
    ['NOINHERIT', su('alter role authenticated noinherit;'), 'authenticated'],
    ['CREATEDB', su('alter role anon createdb;'), 'anon'],
    ['LOGIN', su('alter role anon login;'), 'anon'],
    ['REPLICATION', su('alter role anon replication;'), 'anon'],
  ])('papel pré-existente alterado: %s', async (_caso, sql, rotulo) => {
    // renomear um papel também muda o texto das ACLs que o citam (auth.users, no caso de supabase_auth_admin)
    expect(await verificar(`${BASE} ${sql}`)).toContain(`papel ${rotulo}: papel pré-existente: alteração pelas migrações: forma não suportada`)
  })

  test.each([
    ['dono do banco', su('alter database postgres owner to anon;'), 'banco de dados postgres: alteração pelas migrações: forma não suportada'],
    // Revisão 13, N2: o nome do banco entra na impressão (o mutante 720 sem d.datname não era equivalente).
    ['nome de outro banco', su('alter database template1 rename to t1;'), 'banco de dados t1: alteração pelas migrações: forma não suportada'],
    ['nome da linguagem', su('alter language plpgsql rename to plpgsql2;'), 'linguagem plpgsql2: alteração pelas migrações: forma não suportada'],
    ['dono da linguagem', su('alter language plpgsql owner to anon;'), 'linguagem plpgsql: alteração pelas migrações: forma não suportada'],
    ['regra pré-existente renomeada', su('alter rule pg_settings_n on pg_catalog.pg_settings rename to x;'), 'regra (create rule) x em pg_settings: alteração pelas migrações: forma não suportada'],
  ])('outro objeto pré-existente alterado: %s', async (_caso, sql, msg) => {
    expect(await verificar(`${BASE} ${sql}`)).toContain(msg)
  })

  // UPDATE direto no catálogo (só um superusuário consegue; no Supabase as migrações não rodam como superusuário).
  test.each([
    ['dono de relação com a ACL intacta', su("update pg_catalog.pg_class set relowner = 'anon'::regrole where oid = 'auth.users'::regclass;"), 'auth.users: relação pré-existente (Postgres ou simulação do Supabase): alteração pelas migrações: forma não suportada'],
    ['tipo de relação (relkind), revisão 12', su("update pg_catalog.pg_class set relkind = 'm' where oid = 'auth.users'::regclass;"), 'auth.users: relação pré-existente (Postgres ou simulação do Supabase): alteração pelas migrações: forma não suportada'],
    ['regra desligada', su("update pg_catalog.pg_rewrite set ev_enabled = 'D' where rulename = 'pg_settings_u';"), 'regra (create rule) pg_settings_u em pg_settings: alteração pelas migrações: forma não suportada'],
    ['regra instead', su("update pg_catalog.pg_rewrite set is_instead = not is_instead where rulename = 'pg_settings_u';"), 'regra (create rule) pg_settings_u em pg_settings: alteração pelas migrações: forma não suportada'],
    ['tipo de evento da regra', su("update pg_catalog.pg_rewrite set ev_type = '3' where rulename = 'pg_settings_u';"), 'regra (create rule) pg_settings_u em pg_settings: alteração pelas migrações: forma não suportada'],
    ['nome da extensão', su("update pg_catalog.pg_extension set extname = 'x' where extname = 'plpgsql';"), 'extensão x: alteração pelas migrações: forma não suportada'],
    ['schema da extensão', su("update pg_catalog.pg_extension set extnamespace = 'public'::regnamespace where extname = 'plpgsql';"), 'extensão plpgsql: alteração pelas migrações: forma não suportada'],
    ['versão da extensão', su("update pg_catalog.pg_extension set extversion = '9' where extname = 'plpgsql';"), 'extensão plpgsql: alteração pelas migrações: forma não suportada'],
    ['dono da extensão', su("update pg_catalog.pg_extension set extowner = 'anon'::regrole where extname = 'plpgsql';"), 'extensão plpgsql: alteração pelas migrações: forma não suportada'],
    ['linguagem confiável', su("update pg_catalog.pg_language set lanpltrusted = true where lanname = 'c';"), 'linguagem c: alteração pelas migrações: forma não suportada'],
    ['tratador da linguagem', su("update pg_catalog.pg_language set lanplcallfoid = lanvalidator where lanname = 'plpgsql';"), 'linguagem plpgsql: alteração pelas migrações: forma não suportada'],
    ['bloco anônimo da linguagem', su("update pg_catalog.pg_language set laninline = 0 where lanname = 'plpgsql';"), 'linguagem plpgsql: alteração pelas migrações: forma não suportada'],
    ['validador da linguagem', su("update pg_catalog.pg_language set lanvalidator = 0 where lanname = 'plpgsql';"), 'linguagem plpgsql: alteração pelas migrações: forma não suportada'],
  ])('UPDATE direto no catálogo: %s', async (_caso, sql, msg) => {
    expect(await verificar(`${BASE} ${sql}`)).toEqual([msg])
  })

  test('UPDATE direto no catálogo: dono de schema', async () => {
    const sql = `${BASE} ${su("update pg_catalog.pg_namespace set nspowner = 'anon'::regrole where nspname = 'auth';")}`
    expect(await verificar(sql)).toEqual(['schema auth: dono é anon', 'schema auth: schema pré-existente: alteração pelas migrações: forma não suportada'])
  })

  test('gatilho em auth.users (como o da migração real): aceito', async () => {
    const sql = `${BASE} create function public.g() returns trigger language plpgsql as $$ begin return new; end $$; create trigger t after insert on auth.users for each row execute function public.g();`
    expect(await verificar(sql)).toEqual([])
  })

  test('política em relação pré-existente', async () => {
    expect(await verificar(`${BASE} ${su('create policy p on auth.users for select to authenticated using (true);')}`)).toEqual([
      'política p em auth.users: política em relação pré-existente: forma não suportada',
    ])
  })

  test.each([
    ['create on schema public a anon', su('grant create on schema public to anon;'), ['schema public: anon ganhou CREATE', 'schema public: schema pré-existente: alteração pelas migrações: forma não suportada']],
    ['usage em auth para public', su('grant usage on schema auth to public;'), ['schema auth: PUBLIC ganhou USAGE', 'schema auth: schema pré-existente: alteração pelas migrações: forma não suportada']],
    // Correção 15: o dono tem CREATE no banco e é membro de anon e authenticated: estes três não precisam de su().
    ['schema com dono anon', 'create schema s authorization anon;', ['schema s: dono é anon', 'schema s: anon ganhou USAGE, CREATE']],
    ['schema com dono authenticated', 'create schema s authorization authenticated;', ['schema s: dono é authenticated']],
    ['schema novo comum', 'create schema s;', []],
    ['schema da simulação removido', su('drop schema auth cascade;'), expect.arrayContaining(['schema auth: schema pré-existente: remoção pelas migrações: forma não suportada'])],
  ])('schemas: %s', async (_caso, sql, esperado) => {
    expect(await verificar(`${BASE} ${sql}`)).toEqual(esperado)
  })

  test.each([
    // Correção 15: o dono tem todos os privilégios no banco, mas sem grant option; o grant dele não muda nada (ver
    // catalogo.test.mjs), e só o de um superusuário chega ao catálogo.
    ['grant on database a anon', su('grant create on database postgres to anon;'), 'banco de dados postgres: alteração pelas migrações: forma não suportada'],
    ['grant on database a PUBLIC', su('grant create on database postgres to public;'), 'banco de dados postgres: alteração pelas migrações: forma não suportada'],
    ['alter role ... set', su('alter role authenticated set search_path = public;'), 'configuração de papel ou banco (alter role/database ... set) papel authenticated: criação pelas migrações: forma não suportada'],
    ['grant on parameter', su('grant set on parameter session_replication_role to anon;'), 'privilégio em parâmetro (grant ... on parameter) session_replication_role: criação pelas migrações: forma não suportada'],
    ['publicação', su('create publication p for table public.cenas;'), 'publicação p: criação pelas migrações: forma não suportada'],
    ['linguagem', 'grant usage on language sql to anon;', 'linguagem sql: alteração pelas migrações: forma não suportada'],
  ])('outros objetos: %s', async (_caso, sql, msg) => {
    const erros = await verificar(`${BASE} ${sql}`)
    expect(erros).toContain(msg)
  })

  test('objeto grande', async () => {
    expect(await verificar(`${BASE} select pg_catalog.lo_create(424242);`)).toEqual(['objeto grande 424242: criação pelas migrações: forma não suportada'])
  })
})

describe('formas que a leitura por texto não via (revisões 10 e 11)', () => {
  const desligada = ['public.cenas: sem row level security (falta alter table ... enable row level security)']

  test.each([
    ['comentário terminado por \\r', '-- nota\ralter table public.cenas disable row level security;'],
    ['tag $é$', "select $é$'$é$; alter table public.cenas disable row level security; select $é$'$é$;"],
    ['nome U&"..."', 'alter table public.U&"\\0063enas" disable row level security;'],
    ['do $$ execute $$', "do $$ begin execute 'alter table public.cenas disable row level security'; end $$;"],
    ['t* (inclui descendentes)', 'alter table public.cenas* disable row level security;'],
    ['nome entre aspas', 'alter table public."cenas" disable row level security;'],
    ['set role antes do disable', 'set role postgres_sim; alter table public.cenas disable row level security;'],
  ])('RLS desligada: %s', async (_caso, sql) => {
    expect(await verificar(`${BASE} ${sql}`)).toEqual(desligada)
  })

  test('t* com enable: aceito', async () => {
    expect(await verificar(`${PADRAO} ${tabela('cenas', { rls: false })} alter table public.cenas* enable row level security;`)).toEqual([])
  })

  test.each([
    ['nome U&"..."', 'grant all on public.U&"\\0063odigos_pareamento" to anon;'],
    ['create schema ... grant embutido', su('create schema extra grant all on public.codigos_pareamento to anon;')],
    ['grant on all tables in schema', 'grant all on all tables in schema public to anon;'],
  ])('só-funções aberta para anon: %s', async (_caso, sql) => {
    const erros = await verificar(`${BASE} ${sql}`)
    expect(erros).toContain('public.codigos_pareamento: anon com SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN em tabela só-funções')
  })

  test('grant select on all tables in schema public to anon', async () => {
    expect(await verificar(`${BASE} grant select on all tables in schema public to anon;`)).toEqual([
      'public.cenas: anon com SELECT',
      'public.codigos_pareamento: anon com SELECT em tabela só-funções',
    ])
  })

  test('renomear a tabela e recriar com o mesmo nome sem RLS (revisão 10, I2)', async () => {
    const sql = `${BASE} alter table public.cenas rename to cenas_antiga; create table public.cenas (id int, nome text);`
    expect(await verificar(sql)).toEqual([
      'public.cenas: sem row level security (falta alter table ... enable row level security)',
      'public.cenas: sem nenhuma política (create policy)',
    ])
  })

  test('create schema ... create table embutido (mutante 83)', async () => {
    expect(await verificar(`${BASE} ${su('create schema ss authorization postgres_sim create unlogged table t2 (id int);')}`)).toEqual([
      'ss.t2: fora do schema public (o DES-001 põe tudo em public)',
      'ss.t2: sem row level security (falta alter table ... enable row level security)',
      'ss.t2: sem nenhuma política (create policy)',
    ])
  })

  test('alter extension ... add não esconde a tabela', async () => {
    expect(await verificar(`${BASE} create table public.t (id int); ${su('alter extension plpgsql add table public.t;')}`)).toEqual([
      'public.t: sem row level security (falta alter table ... enable row level security)',
      'public.t: sem nenhuma política (create policy)',
    ])
  })

  test('tabelas chamadas cascade e restrict não somem com o drop de outra (mutantes 420/421)', async () => {
    const sql = `${BASE} create table public.cascade (id int); create table public.x (id int); drop table public.x cascade;`
    expect(await verificar(sql)).toEqual([
      'public.cascade: sem row level security (falta alter table ... enable row level security)',
      'public.cascade: sem nenhuma política (create policy)',
    ])
  })

  test('drop table seguido de create table if not exists: vale a nova', async () => {
    const sql = `${BASE} drop table public.cenas; create table if not exists public.cenas (id int);`
    expect(await verificar(sql)).toEqual([
      'public.cenas: sem row level security (falta alter table ... enable row level security)',
      'public.cenas: sem nenhuma política (create policy)',
    ])
  })

  test('drop policy deixa a tabela sem política', async () => {
    expect(await verificar(`${BASE} drop policy cenas_le on public.cenas;`)).toEqual([
      'public.cenas: sem nenhuma política (create policy)',
      `public.cenas: authenticated com SELECT ${SEM_POLITICA}`,
    ])
  })

  test('alter policy ... to public', async () => {
    expect(await verificar(`${BASE} alter policy cenas_le on public.cenas to public;`)).toEqual([
      'public.cenas: política cenas_le vale para PUBLIC (só "to authenticated" é permitido)',
      `public.cenas: authenticated com SELECT ${SEM_POLITICA}`,
    ])
  })

  test('select ... into public.x cria tabela conferida', async () => {
    expect(await verificar(`${BASE} select 1 as id into public.x;`)).toEqual([
      'public.x: sem row level security (falta alter table ... enable row level security)',
      'public.x: sem nenhuma política (create policy)',
    ])
  })

  test('tabela com nome entre aspas e acento: conferida como qualquer outra', async () => {
    const sql = `${BASE} create table public."Sessões" (id int); alter table public."Sessões" enable row level security; create policy p on public."Sessões" to authenticated using (true); grant select, insert, update, delete on public."Sessões" to authenticated;`
    expect(await verificar(sql)).toEqual([])
  })
})

describe('correção 16: políticas, grants de authenticated e gatilhos', () => {
  // Revisão 14, N1: só "to authenticated"; política para qualquer outro papel é erro.
  test.each([
    ['service_role (da simulação)', 'create policy p on public.cenas for select to service_role using (true);', 'service_role'],
    ['papel da simulação (supabase_auth_admin)', 'create policy p on public.cenas for select to supabase_auth_admin using (true);', 'supabase_auth_admin'],
    ['papel novo com login (sem grant)', "create role r login password 'x'; create policy p on public.cenas for select to r using (true);", 'r'],
    ['o próprio dono', 'create policy p on public.cenas for select to postgres_sim using (true);', 'postgres_sim'],
    ['authenticated e outro papel', 'create policy p on public.cenas for select to authenticated, supabase_auth_admin using (true);', 'supabase_auth_admin'],
  ])('política para outro papel: %s', async (_caso, sql, papel) => {
    expect(await verificar(`${BASE} ${sql}`)).toEqual([`public.cenas: política p vale para ${papel} (só "to authenticated" é permitido)`])
  })

  test('política só para outro papel: também deixa o grant de authenticated sem política', async () => {
    expect(await verificar(`${PADRAO} ${tabela('cenas', { politica: 'create policy p on public.cenas for select to supabase_auth_admin using (true);' })} ${soFuncoes()}`)).toEqual([
      'public.cenas: política p vale para supabase_auth_admin (só "to authenticated" é permitido)',
      `public.cenas: authenticated com SELECT ${SEM_POLITICA}`,
    ])
  })

  // Regra nova: grant de tabela a authenticated × políticas "to authenticated", por operação.
  test.each([
    ['insert', 'grant insert on public.cenas to authenticated;', 'INSERT'],
    ['update', 'grant update on public.cenas to authenticated;', 'UPDATE'],
    ['delete', 'grant delete on public.cenas to authenticated;', 'DELETE'],
    ['insert e delete juntos', 'grant insert, delete on public.cenas to authenticated;', 'INSERT, DELETE'],
    ['insert de coluna', 'grant insert (nome) on public.cenas to authenticated;', 'INSERT'],
    ['update de coluna', 'grant update (nome) on public.cenas to authenticated;', 'UPDATE'],
    ['herdado de PUBLIC', 'grant delete on public.cenas to public;', 'DELETE'],
  ])('grant a authenticated sem política da operação: %s', async (caso, sql, ops) => {
    const esperado = [`public.cenas: authenticated com ${ops} ${SEM_POLITICA}`]
    if (caso === 'herdado de PUBLIC') esperado.unshift('public.cenas: PUBLIC com DELETE', 'public.cenas: anon com DELETE', 'public.cenas: service_role com DELETE')
    expect(await verificar(`${BASE} ${sql}`)).toEqual(esperado)
  })

  test('select de coluna sem política de select', async () => {
    const sql = `${PADRAO} ${tabela('cenas', { politica: 'create policy cenas_insere on public.cenas for insert to authenticated with check (true);', grant: 'grant insert on public.cenas to authenticated; grant select (id) on public.cenas to authenticated;' })} ${soFuncoes()}`
    expect(await verificar(sql)).toEqual([`public.cenas: authenticated com SELECT ${SEM_POLITICA}`])
  })

  test.each([
    ['for select', 'for select', 'SELECT'],
    ['for insert', 'for insert', 'INSERT'],
    ['for update', 'for update', 'UPDATE'],
    ['for delete', 'for delete', 'DELETE'],
    ['for all', 'for all', 'SELECT, INSERT, UPDATE, DELETE'],
    ['sem "for" (vale para todas)', '', 'SELECT, INSERT, UPDATE, DELETE'],
  ])('política "to authenticated" sem o grant da operação: %s', async (_caso, comando, ops) => {
    const politica = `create policy p on public.cenas ${comando} to authenticated ${comando === 'for insert' ? 'with check' : 'using'} (true);`
    expect(await verificar(`${PADRAO} ${tabela('cenas', { politica, grant: '' })} ${soFuncoes()}`)).toEqual([semGrant('public.cenas', 'p', ops)])
  })

  test('política for all com só o grant de select: faltam INSERT, UPDATE e DELETE', async () => {
    const politica = 'create policy p on public.cenas for all to authenticated using (true);'
    expect(await verificar(`${PADRAO} ${tabela('cenas', { politica })} ${soFuncoes()}`)).toEqual([semGrant('public.cenas', 'p', 'INSERT, UPDATE, DELETE')])
  })

  test('várias políticas, cada uma com e sem grant: uma mensagem por política, em ordem de nome', async () => {
    const politica = `create policy b_altera on public.cenas for update to authenticated using (true);
create policy a_apaga on public.cenas for delete to authenticated using (true);
create policy c_le on public.cenas for select to authenticated using (true);`
    expect(await verificar(`${PADRAO} ${tabela('cenas', { politica, grant: 'grant select on public.cenas to authenticated;' })} ${soFuncoes()}`)).toEqual([
      semGrant('public.cenas', 'a_apaga', 'DELETE'),
      semGrant('public.cenas', 'b_altera', 'UPDATE'),
    ])
  })

  test.each([
    ['as quatro operações com políticas próprias', `create policy l on public.cenas for select to authenticated using (true);
create policy i on public.cenas for insert to authenticated with check (true);
create policy u on public.cenas for update to authenticated using (true);
create policy d on public.cenas for delete to authenticated using (true);`, 'grant select, insert, update, delete on public.cenas to authenticated;'],
    ['for all com os quatro grants', 'create policy p on public.cenas for all to authenticated using (true);', 'grant select, insert, update, delete on public.cenas to authenticated;'],
    ['grant all menos os proibidos', 'create policy p on public.cenas for all to authenticated using (true);', 'grant all on public.cenas to authenticated; revoke truncate, references, trigger, maintain on public.cenas from authenticated;'],
  ])('grants e políticas que batem: %s', async (_caso, politica, grant) => {
    expect(await verificar(`${PADRAO} ${tabela('cenas', { politica, grant })} ${soFuncoes()}`)).toEqual([])
  })

  // Correção 16b (decisão do controlador): MAINTAIN de authenticated é proibido, como TRUNCATE, REFERENCES e TRIGGER.
  test('maintain a authenticated em tabela e em view', async () => {
    expect(await verificar(`${BASE} grant maintain on public.cenas to authenticated;`)).toEqual(['public.cenas: authenticated com MAINTAIN'])
    expect(await verificar(`${BASE} create view public.v with (security_invoker) as select id from public.cenas; grant maintain on public.v to authenticated;`)).toEqual(['public.v: authenticated com MAINTAIN'])
  })

  test('view com grant de select a authenticated: aceita (a regra de grant e política é só de tabela)', async () => {
    expect(await verificar(`${BASE} create view public.v with (security_invoker) as select id from public.cenas; grant select on public.v to authenticated;`)).toEqual([])
  })

  // Correção 16b (decisão do controlador): authenticated sem privilégio algum em sequência (a coluna identity não precisa).
  test.each([
    ['usage, select e update', 'grant usage, select, update on sequence public.s to authenticated;', 'USAGE, SELECT, UPDATE'],
    ['só usage', 'grant usage on sequence public.s to authenticated;', 'USAGE'],
    ['só select', 'grant select on sequence public.s to authenticated;', 'SELECT'],
    ['só update', 'grant update on sequence public.s to authenticated;', 'UPDATE'],
  ])('sequência com privilégio de authenticated: %s', async (_caso, grant, privs) => {
    expect(await verificar(`${BASE} create sequence public.s; ${grant}`)).toEqual([`public.s: authenticated com ${privs} em sequência`])
  })

  test('coluna identity com insert de authenticated e nada na sequência: aceito', async () => {
    const sql = `${PADRAO} ${tabela('t', { politica: 'create policy t_insere on public.t for insert to authenticated with check (true);', grant: 'grant insert on public.t to authenticated;' }).replace('id int', 'id int generated always as identity')} ${soFuncoes()}`
    expect(await verificar(sql)).toEqual([])
  })

  // Revisão 14, N3: a exceção do dono na regra de grant option é alcançável.
  test('dono com grant option explícito: aceito', async () => {
    expect(await verificar(`${BASE} grant select on public.cenas to postgres_sim with grant option;`)).toEqual([])
  })

  test('outro papel com grant option: acusado (controle do teste anterior)', async () => {
    expect(await verificar(`${BASE} grant select on public.cenas to supabase_auth_admin with grant option;`)).toEqual([
      'public.cenas: supabase_auth_admin com SELECT (só authenticated pode ter privilégio)',
      'public.cenas: supabase_auth_admin com grant option em SELECT (pode repassar o privilégio)',
    ])
  })

  // Correção 18 (revisão 16, I1; decisão do controlador): só authenticated pode ter privilégio; o dono fica isento.
  test.each([
    ['papel novo com LOGIN e TRUNCATE (prova da revisão 16)', "create role r login password 'x'; grant truncate on public.cenas to r;", ['public.cenas: r com TRUNCATE (só authenticated pode ter privilégio)']],
    ['supabase_auth_admin com TRUNCATE e TRIGGER', 'grant truncate, trigger on public.cenas to supabase_auth_admin;', ['public.cenas: supabase_auth_admin com TRUNCATE, TRIGGER (só authenticated pode ter privilégio)']],
    ['grant on all tables a papel novo (sonda c1c da revisão 16)', "create role r login password 'x'; grant truncate on all tables in schema public to r;", [
      'public.cenas: r com TRUNCATE (só authenticated pode ter privilégio)',
      'public.codigos_pareamento: r com TRUNCATE (só authenticated pode ter privilégio)',
    ]],
    ['papel novo em view', "create role r; create view public.v with (security_invoker) as select id from public.cenas; grant select, insert on public.v to r;", ['public.v: r com SELECT, INSERT (só authenticated pode ter privilégio)']],
    ['papel novo em sequência', 'create role r; create sequence public.s; grant usage on sequence public.s to r;', ['public.s: r com USAGE (só authenticated pode ter privilégio)']],
    ['papel novo em coluna', 'create role r; grant update (nome) on public.cenas to r;', ['public.cenas: r com UPDATE na coluna nome']],
    ['dois papéis novos, cada um uma mensagem', 'create role q; create role r; grant select on public.cenas to r; grant delete on public.cenas to q;', [
      'public.cenas: q com DELETE (só authenticated pode ter privilégio)',
      'public.cenas: r com SELECT (só authenticated pode ter privilégio)',
    ]],
    ['herdado: papel novo membro de outro papel novo com o privilégio', "create role r; create role q login; grant select on public.cenas to r; grant r to q;", ['public.cenas: r com SELECT (só authenticated pode ter privilégio)']],
    ['o dono com grant explícito: isento', 'grant select on public.cenas to postgres_sim;', []],
    ['o dono com grant de coluna: isento', 'grant select (nome) on public.cenas to postgres_sim;', []],
    ['dois papéis novos com privilégio padrão: um erro por papel, em ordem de nome', 'create role r; create role q; alter default privileges in schema public grant select on tables to r; alter default privileges in schema public grant insert on tables to q;', [
      'alter default privileges (papel postgres_sim, schema public, tabelas): q recebe INSERT nas tabelas criadas depois (falta alter default privileges ... revoke)',
      'alter default privileges (papel postgres_sim, schema public, tabelas): r recebe SELECT nas tabelas criadas depois (falta alter default privileges ... revoke)',
    ]],
    ['papel novo com privilégio padrão das tabelas criadas depois', 'create role r; alter default privileges in schema public grant select on tables to r;', [
      'alter default privileges (papel postgres_sim, schema public, tabelas): r recebe SELECT nas tabelas criadas depois (falta alter default privileges ... revoke)',
    ]],
    ['papel novo com privilégio padrão das sequências criadas depois', 'create role r; alter default privileges in schema public grant usage on sequences to r;', [
      'alter default privileges (papel postgres_sim, schema public, sequências): r recebe USAGE nas sequências criadas depois (falta alter default privileges ... revoke)',
    ]],
    ['privilégio padrão global para papel novo (o dono, na linha global, fica de fora)', 'create role r; alter default privileges grant select on tables to r;', [
      'alter default privileges (papel postgres_sim, todos os schemas, tabelas): r recebe SELECT nas tabelas criadas depois (falta alter default privileges ... revoke)',
    ]],
  ])('privilégio para papel além de authenticated: %s', async (_caso, sql, esperado) => {
    expect(await verificar(`${BASE} ${sql}`)).toEqual(esperado)
  })
})

// Revisão 14, I1: anon gravava numa tabela com RLS por um gatilho (a função SECURITY DEFINER grava como o dono), e as
// duas checagens aprovavam. SQL das sondas notas.sql (view com INSTEAD OF) e notas2.sql (BEFORE INSERT que devolve NULL).
describe('gatilhos (revisão 14, I1)', () => {
  const NOTAS = `create table public.notas (id uuid primary key default gen_random_uuid(), texto text not null, papel text);
alter table public.notas enable row level security;
create policy notas_le on public.notas for select to authenticated using ((select public.papel_atual()) is not null);
revoke truncate, references, trigger on public.notas from anon, authenticated;
create view public.notas_v with (security_invoker = true) as select id, texto from public.notas;
create function public.notas_v_ins() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notas (texto, papel) values (new.texto, public.papel_atual()::text);
  return new;
end;
$$;
revoke execute on function public.notas_v_ins() from public, anon, service_role;
grant execute on function public.notas_v_ins() to authenticated;
create trigger notas_v_ins instead of insert on public.notas_v for each row execute function public.notas_v_ins();`

  const NOTAS2 = `create table public.notas (id uuid primary key default gen_random_uuid(), texto text not null, papel text);
alter table public.notas enable row level security;
create policy notas_le on public.notas for select to authenticated using ((select public.papel_atual()) is not null);
create table public.notas_entrada (texto text not null);
alter table public.notas_entrada enable row level security;
create policy notas_entrada_ins on public.notas_entrada for insert to authenticated with check ((select public.papel_atual()) is not null);
revoke truncate, references, trigger on public.notas, public.notas_entrada from anon, authenticated;
create function public.notas_encaminha() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notas (texto, papel) values (new.texto, public.papel_atual()::text);
  return null;
end;
$$;
revoke execute on function public.notas_encaminha() from public, anon, service_role;
grant execute on function public.notas_encaminha() to authenticated;
create trigger notas_encaminha before insert on public.notas_entrada for each row execute function public.notas_encaminha();`

  // papel_atual() de mentira, só para o SQL das sondas aplicar (a migração real cria a verdadeira).
  const PAPEL = `create function public.papel_atual() returns text language sql stable security definer set search_path = '' as $$ select 'x'::text $$;`
  const GATILHO_VIEW = 'public.notas_v: gatilho INSTEAD OF notas_v_ins: forma não suportada (a função grava por fora da RLS)'

  test('notas.sql como a sonda: o INSTEAD OF e a política sem grant são acusados', async () => {
    expect(await verificar(`${BASE} ${PAPEL} ${NOTAS}`)).toEqual([semGrant('public.notas', 'notas_le', 'SELECT'), GATILHO_VIEW])
  })

  test('notas.sql com os privilégios do padrão antigo de anon (grant explícito): anon acusado em cada relação', async () => {
    const antigo = 'grant select, insert, update, delete on public.notas, public.notas_v to anon; grant select on public.notas to authenticated;'
    expect(await verificar(`${BASE} ${PAPEL} ${NOTAS} ${antigo}`)).toEqual([
      'public.notas: anon com SELECT, INSERT, UPDATE, DELETE',
      GATILHO_VIEW,
      'public.notas_v: anon com SELECT, INSERT, UPDATE, DELETE',
    ])
  })

  test('notas.sql com tudo certo para authenticated: o INSTEAD OF continua acusado', async () => {
    expect(await verificar(`${BASE} ${PAPEL} ${NOTAS} grant select on public.notas to authenticated; grant select, insert on public.notas_v to authenticated;`)).toEqual([GATILHO_VIEW])
  })

  test('notas2.sql como a sonda: as políticas sem grant são acusadas', async () => {
    expect(await verificar(`${BASE} ${PAPEL} ${NOTAS2}`)).toEqual([
      semGrant('public.notas', 'notas_le', 'SELECT'),
      semGrant('public.notas_entrada', 'notas_entrada_ins', 'INSERT'),
    ])
  })

  test('notas2.sql com o INSERT de anon do padrão antigo (grant explícito): anon acusado', async () => {
    const grants = 'grant select on public.notas to authenticated; grant insert on public.notas_entrada to authenticated; grant insert on public.notas_entrada to anon;'
    expect(await verificar(`${BASE} ${PAPEL} ${NOTAS2} ${grants}`)).toEqual(['public.notas_entrada: anon com INSERT'])
  })

  test('notas2.sql com os grants de authenticated e nada para anon: aceito (anon não chega ao gatilho: sem privilégio)', async () => {
    const grants = 'grant select on public.notas to authenticated; grant insert on public.notas_entrada to authenticated;'
    expect(await verificar(`${BASE} ${PAPEL} ${NOTAS2} ${grants}`)).toEqual([])
  })

  test.each([
    ['update', 'instead of update'],
    ['delete', 'instead of delete'],
  ])('gatilho INSTEAD OF de %s em view', async (_caso, evento) => {
    const sql = `${BASE} create view public.v with (security_invoker) as select id from public.cenas;
create function public.g() returns trigger language plpgsql as $$ begin return null; end $$;
create trigger t ${evento} on public.v for each row execute function public.g();`
    expect(await verificar(sql)).toEqual(['public.v: gatilho INSTEAD OF t: forma não suportada (a função grava por fora da RLS)'])
  })

  test('dois gatilhos INSTEAD OF na mesma view: um erro por gatilho, em ordem de nome', async () => {
    const sql = `${BASE} create view public.v with (security_invoker) as select id from public.cenas;
create function public.g() returns trigger language plpgsql as $$ begin return null; end $$;
create trigger z instead of insert on public.v for each row execute function public.g();
create trigger a instead of update on public.v for each row execute function public.g();`
    expect(await verificar(sql)).toEqual([
      'public.v: gatilho INSTEAD OF a: forma não suportada (a função grava por fora da RLS)',
      'public.v: gatilho INSTEAD OF z: forma não suportada (a função grava por fora da RLS)',
    ])
  })

  test('gatilho comum (after insert) em tabela: aceito por esta checagem', async () => {
    const sql = `${BASE} create function public.g() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger t after insert on public.cenas for each row execute function public.g();`
    expect(await verificar(sql)).toEqual([])
  })
})

// Revisão 15, I2: mutantes não equivalentes que sobreviviam (M10, M12, M14), com o SQL do relatório.
describe('correção 17: mutantes da revisão 15', () => {
  test('tabela particionada: grant de insert a authenticated sem política de insert (M10)', async () => {
    const sql = `${BASE} create table public.ev (id int, d date) partition by range (d); alter table public.ev enable row level security;
create policy ev_le on public.ev for select to authenticated using (true); grant select, insert on public.ev to authenticated;`
    expect(await verificar(sql)).toEqual([`public.ev: authenticated com INSERT ${SEM_POLITICA}`])
  })

  test('só-funções com grant de insert de coluna a authenticated (M12)', async () => {
    expect(await verificar(`${BASE} grant insert (codigo) on public.codigos_pareamento to authenticated;`)).toEqual([
      'public.codigos_pareamento: authenticated com privilégio de coluna em tabela só-funções',
    ])
  })

  test('grant option só de coluna (M14)', async () => {
    expect(await verificar(`${BASE} grant update (nome) on public.cenas to authenticated with grant option;`)).toEqual([
      'public.cenas: authenticated com grant option em UPDATE (coluna nome) (pode repassar o privilégio)',
      `public.cenas: authenticated com UPDATE ${SEM_POLITICA}`,
    ])
  })
})

describe('regrasDeTabela (sobre um catálogo montado à mão)', () => {
  test('sem nenhuma tabela', () => {
    const c = {
      relacoes: [], relacoesPreexistentes: [], politicasEmPreexistentes: [], schemas: [], schemasPreexistentes: [], aclPadrao: [], aclPadraoFinal: [],
      papeisNovos: [], papeisPreexistentes: [], participacoesNovas: [], outros: [], papeisDoSupabase: { anon: '1', authenticated: '2' }, donoDasMigracoes: 'postgres',
    }
    expect(regrasDeTabela(c)).toEqual(['nenhuma tabela criada pelas migrações: a checagem não conferiu nada'])
  })
})
