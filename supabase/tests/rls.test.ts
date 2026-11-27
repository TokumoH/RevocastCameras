// Testes de acesso (RLS, funções auxiliares e gatilho) sobre a migração inicial.
// Todo teste roda sobre semearDados(), dentro de uma transação desfeita no fim.
// "Lê" = exatamente as linhas que a sessão deve ver (a linha semeada, ou todas as linhas da tabela,
// contadas como superusuário, nos controles de lote); todo teste de 0 linhas tem um controle positivo
// com a sessão autorizada.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  type Claims,
  DONO_MIGRACAO,
  MIGRACOES,
  EMAIL_ADM,
  EMAIL_ANA,
  EMAIL_BIA,
  EMAIL_ESTRANHO,
  ID_AVISO,
  ID_CAMERA,
  ID_CENA,
  ID_EPISODIO,
  ID_OBS_CAMERA,
  ID_PALCO,
  UID_ADM,
  UID_ANA,
  UID_BIA,
  UID_ESTRANHO,
  UID_SESSAO_CAMERA,
  UID_SESSAO_OBS_CAMERA,
  UID_SESSAO_PALCO,
  cadastrarUsuario,
  comoCanal,
  comoSessao,
  criarBanco,
  membroGoogle,
  semearDados,
  sessaoAnonima,
  TEMPO_LIMITE_HOOK_MS,
  type ExtensaoDoCanal,
} from './banco'
import { COLUNAS_DE_MEU_DISPOSITIVO, FORMA_DO_CODIGO } from '../../src/domains/acesso/dispositivos'

let db: PGlite

beforeAll(async () => {
  db = await criarBanco()
  await semearDados(db)
}, TEMPO_LIMITE_HOOK_MS)
afterAll(() => db.close(), TEMPO_LIMITE_HOOK_MS)
beforeEach(async () => {
  await db.exec('begin')
})
afterEach(async () => {
  await db.exec('rollback')
})

const ana = membroGoogle(EMAIL_ANA, UID_ANA)
const bia = membroGoogle(EMAIL_BIA, UID_BIA)
const adm = membroGoogle(EMAIL_ADM, UID_ADM)
const estranho = membroGoogle(EMAIL_ESTRANHO, UID_ESTRANHO)
const camera = sessaoAnonima(UID_SESSAO_CAMERA)
const palco = sessaoAnonima(UID_SESSAO_PALCO)
const obsCamera = sessaoAnonima(UID_SESSAO_OBS_CAMERA)

/** Linhas de um resultado que não pode ser erro. */
function linhas<T>(r: T[] | Error): T[] {
  if (r instanceof Error) throw new Error(`erro inesperado: ${r.message}`)
  return r
}

/** Erro de um resultado que tem de ser erro. */
function erro(r: unknown[] | Error): Error {
  if (!(r instanceof Error)) throw new Error(`esperava erro, veio ${JSON.stringify(r)}`)
  return r
}

const violaRls = (tabela: string) => `new row violates row-level security policy for table "${tabela}"`
const negado = (tabela: string) => `permission denied for table ${tabela}`
/** SQLSTATE de um erro do PGlite. */
const codigoDoErro = (e: Error) => (e as Error & { code?: string }).code

/**
 * Privilégios de tabela que a migração dá a authenticated (Correção 13): só as operações que alguma política
 * permite (DES-001 §8). anon e service_role não recebem nenhum; codigos_pareamento e tentativas_pareamento, nada. Desde
 * 2026-10-30 o Supabase não dá mais select/insert/update/delete automáticos em tabelas novas (simulacao-supabase.sql),
 * então sem esses GRANT nenhum acesso funciona; e onde o privilégio falta, o Postgres recusa antes da RLS ("permission
 * denied"). E3 (PLA-004, D7): episodios perde o insert e o update de tabela (ficam os de coluna, abaixo) e estudio_estado
 * perde o update (a escrita é por função).
 */
const PRIVILEGIOS_AUTHENTICATED: Record<string, string[]> = {
  avisos: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  cenas: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  codigos_pareamento: [],
  dispositivos: ['SELECT'],
  episodios: ['DELETE', 'SELECT'],
  estudio_estado: ['SELECT'],
  mapa_gestos: ['SELECT', 'UPDATE'],
  membros: ['SELECT'],
  membros_permitidos: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  midias: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  registro_acoes: ['INSERT', 'SELECT'],
  sons: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  tentativas_pareamento: [],
}
/**
 * Privilégios de coluna que a migração dá a authenticated (PLA-004, D7): em episodios, o insert e o update só das colunas
 * que o adaptador da E2 manda; estado e gestos_ligados mudam só pelas funções iniciar_ao_vivo, encerrar_ao_vivo (e, na
 * E5, definir_gestos_ligados). Colunas em ordem alfabética, como o catálogo as agrupa em acl-de-tabelas-e-sequencias.
 */
const PRIVILEGIOS_POR_COLUNA: Record<string, Record<string, string[]>> = {
  episodios: { INSERT: ['criado_por', 'data', 'titulo'], UPDATE: ['data', 'titulo'] },
}
/**
 * A sessão (null = anon) tem o privilégio? De tabela (a operação está em PRIVILEGIOS_AUTHENTICATED) ou, quando o comando
 * cita colunas, de coluna (todas elas em PRIVILEGIOS_POR_COLUNA da operação). Sem colunas, só o de tabela conta.
 */
const temPrivilegio = (sessao: Claims | null, tabela: string, operacao: string, colunas: readonly string[] = []) => {
  if (sessao === null) return false
  const op = operacao.toUpperCase()
  if (PRIVILEGIOS_AUTHENTICATED[tabela].includes(op)) return true
  const daColuna = PRIVILEGIOS_POR_COLUNA[tabela]?.[op] ?? []
  return colunas.length > 0 && colunas.every((c) => daColuna.includes(c))
}
/** Colunas de um update (as do set) ou de um insert (a lista entre parênteses); vazio nos demais comandos. */
function colunasDoComando(sql: string): string[] {
  const insert = /^insert into public\.\w+\s*\(([^)]*)\)/i.exec(sql)
  if (insert) return insert[1].split(',').map((c) => c.trim())
  const set = /\bset\s+(.+?)(?:\s+where\b|\s+returning\b|$)/is.exec(sql)
  if (set) return [...set[1].matchAll(/(?:^|,)\s*(\w+)\s*=/g)].map((m) => m[1])
  return []
}

/**
 * Onde a sessão não tem o privilégio, confere o "permission denied" e depois dá, como superusuário, os
 * privilégios de tabela que faltam ao papel do Postgres da sessão, roda `comRls` (a RLS tem de negar sozinha: defesa em
 * profundidade) e os revoga de novo. No Postgres, revogar o privilégio de tabela também revoga o das colunas: por isso,
 * depois do revoke, PRIVILEGIOS_POR_COLUNA é reaplicado (senão o comando seguinte, de outra sessão, cairia no "permission
 * denied" no lugar da RLS). Com o privilégio, só roda `comRls`.
 */
async function semPrivilegioERls(sessao: Claims | null, tabela: string, operacao: string, sql: string, params: unknown[], rotulo: string, comRls: () => Promise<void>): Promise<void> {
  if (temPrivilegio(sessao, tabela, operacao, colunasDoComando(sql))) return comRls()
  expect(erro(await comoSessao(db, sessao, sql, params)).message, rotulo).toBe(negado(tabela))
  const papelPg = sessao === null ? 'anon' : 'authenticated'
  const faltam = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].filter((p) => !temPrivilegio(sessao, tabela, p)).join(', ')
  await db.query(`grant ${faltam} on public.${tabela} to ${papelPg}`)
  try {
    await comRls()
  } finally {
    await db.query(`revoke ${faltam} on public.${tabela} from ${papelPg}`)
    for (const [op, colunas] of Object.entries(PRIVILEGIOS_POR_COLUNA[tabela] ?? {})) {
      await db.query(`grant ${op} (${colunas.join(', ')}) on public.${tabela} to authenticated`)
    }
  }
}

/** Update/delete que não pode ter efeito: sem o privilégio, "permission denied"; e a RLS filtra tudo (0 linhas). */
async function semEfeito(sessao: Claims | null, sql: string, params: unknown[] = []): Promise<void> {
  const [, operacao, tabela] = /^(update|delete from) public\.(\w+)/.exec(sql)!
  await semPrivilegioERls(sessao, tabela, operacao.split(' ')[0], sql, params, sql, async () => {
    expect(linhas(await comoSessao(db, sessao, sql, params)), sql).toEqual([])
  })
}

/** Insert recusado: sem o privilégio, "permission denied"; e a RLS recusa (violação de RLS). */
async function insercaoRecusada(sessao: Claims | null, tabela: string, sql: string, params: unknown[] = [], rotulo = sql): Promise<void> {
  await semPrivilegioERls(sessao, tabela, 'insert', sql, params, rotulo, async () => {
    expect(erro(await comoSessao(db, sessao, sql, params)).message, rotulo).toBe(violaRls(tabela))
  })
}

async function ids(claims: Claims, tabela: string): Promise<string[]> {
  return linhas(await comoSessao<{ id: string }>(db, claims, `select id from public.${tabela} order by id`)).map((l) => l.id)
}

async function papel(claims: Claims): Promise<string | null> {
  const [l] = linhas(await comoSessao<{ papel: string | null }>(db, claims, 'select public.papel_atual() as papel'))
  return l.papel
}

async function contar(tabela: string): Promise<number> {
  const r = await db.query<{ n: number }>(`select count(*)::int as n from public.${tabela}`)
  return r.rows[0].n
}

async function cadastrarEstranho(): Promise<void> {
  await cadastrarUsuario(db, { uid: UID_ESTRANHO, email: EMAIL_ESTRANHO, anonimo: false, provedor: 'google', confirmado: true })
}

// Mesmas cargas para quem pode e para quem não pode escrever na preparação.
const INSERE_CENA = `insert into public.cenas (nome_exibicao, nome_obs) values ('Entrevista', 'Cena Entrevista')`
const INSERE_EPISODIO = `insert into public.episodios (titulo) values ('Episódio novo')`
const INSERE_AVISO = `insert into public.avisos (episodio_id, titulo) values ($1, 'Aviso novo')`

// Mesma carga de registro_acoes para palco, câmera e estranho (sem RETURNING).
const INSERE_ACAO = `insert into public.registro_acoes (episodio_id, origem, acao, dispositivo_id) values ($1, 'toque', 'clipe', $2)`

describe('membros e papéis', () => {
  test('estranho-nao-le', async () => {
    await cadastrarEstranho()
    expect(await ids(estranho, 'cenas')).toEqual([])
    expect(await ids(ana, 'cenas')).toEqual([ID_CENA]) // controle
  })

  test('apresentadora-le-nao-escreve', async () => {
    expect(await ids(bia, 'cenas')).toEqual([ID_CENA])
    expect(erro(await comoSessao(db, bia, INSERE_CENA)).message).toBe(violaRls('cenas'))
    expect(erro(await comoSessao(db, bia, INSERE_EPISODIO)).message).toBe(violaRls('episodios'))
    expect(erro(await comoSessao(db, bia, INSERE_AVISO, [ID_EPISODIO])).message).toBe(violaRls('avisos'))
    expect([await contar('cenas'), await contar('episodios'), await contar('avisos')]).toEqual([1, 1, 1])
  })

  test('equipe-escreve-preparacao', async () => {
    linhas(await comoSessao(db, ana, INSERE_CENA))
    linhas(await comoSessao(db, ana, INSERE_EPISODIO))
    linhas(await comoSessao(db, ana, INSERE_AVISO, [ID_EPISODIO]))
    expect([await contar('cenas'), await contar('episodios'), await contar('avisos')]).toEqual([2, 2, 2])
    // O admin também escreve a preparação.
    linhas(await comoSessao(db, adm, `insert into public.cenas (nome_exibicao, nome_obs) values ('Debate', 'Cena Debate')`))
    expect(await contar('cenas')).toBe(3)
  })

  test('anonimo-com-email-de-membro', async () => {
    const anonimaComEmailDaAna: Claims = { ...ana, is_anonymous: true }
    expect(await ids(anonimaComEmailDaAna, 'cenas')).toEqual([])
    expect(await papel(anonimaComEmailDaAna)).toBeNull()
    expect(await ids(ana, 'cenas')).toEqual([ID_CENA]) // controle
  })

  test('email-com-maiusculas', async () => {
    expect(await papel(membroGoogle('Ana@Revocast.TEST', UID_ANA))).toBe('equipe')
  })

  test('email-nao-confirmado', async () => {
    expect(await papel(ana)).toBe('equipe') // controle
    await db.query('update auth.users set email_confirmed_at = null where id = $1', [UID_ANA])
    expect(await papel(ana)).toBeNull()
    // user_metadata.email_verified é editável pelo próprio usuário: não substitui a confirmação.
    expect(await papel({ ...ana, user_metadata: { email_verified: true } })).toBeNull()
  })

  test('papel-segue-email-do-jwt', async () => {
    // O plano manda ler o e-mail das claims (assinadas pelo Supabase), não de auth.users.
    expect(await papel(membroGoogle(EMAIL_BIA, UID_ANA))).toBe('apresentadora')
    expect(await papel(ana)).toBe('equipe') // controle
  })

  test('provedor-nao-google', async () => {
    expect(await papel(ana)).toBe('equipe') // controle
    expect(await papel({ ...ana, app_metadata: { provider: 'email' } })).toBeNull()
  })

  test('claims-incompletas-negam', async () => {
    // Falha fechada: sem is_anonymous ou sem provider, nem papel nem dispositivo.
    const { is_anonymous: _a, ...anaSemAnonimo } = ana
    const { is_anonymous: _p, ...palcoSemAnonimo } = palco
    expect(await papel(ana)).toBe('equipe') // controle
    expect(await papel(anaSemAnonimo as Claims)).toBeNull()
    expect(await papel({ ...ana, app_metadata: {} })).toBeNull()
    const disp = (c: Claims) => comoSessao<{ id: string }>(db, c, 'select id from public.dispositivo_atual()')
    expect(linhas(await disp(palco))).toEqual([{ id: ID_PALCO }]) // controle
    expect(linhas(await disp(palcoSemAnonimo as Claims))).toEqual([])
    // Sem sub: auth.uid() é nulo e não pode casar com um dispositivo ainda não pareado (usuario_anonimo_id nulo).
    await db.query(`insert into public.dispositivos (tipo, rotulo) values ('obs_palco', 'PC sem sessão')`)
    const { sub: _s, ...anonimaSemSub } = palco
    expect(linhas(await disp(anonimaSemSub as Claims))).toEqual([])
    expect(await ids(anonimaSemSub as Claims, 'avisos')).toEqual([])
  })

  test('confirmacao-pelo-proprio-uid', async () => {
    // email_confirmed_at vem da linha de auth.users do próprio sub, não de quem tem o e-mail das claims.
    await cadastrarUsuario(db, { uid: UID_ESTRANHO, email: EMAIL_ESTRANHO, anonimo: false, provedor: 'google', confirmado: false })
    expect(await papel(membroGoogle(EMAIL_ANA, UID_ESTRANHO))).toBeNull()
    expect(await papel(ana)).toBe('equipe') // controle
  })

  test('membros-nao-registram-acao', async () => {
    for (const sessao of [ana, adm]) {
      expect(erro(await comoSessao(db, sessao, INSERE_ACAO, [ID_EPISODIO, ID_PALCO])).message).toBe(violaRls('registro_acoes'))
    }
    // Também com a autoria de membro declarada como a própria sessão (inclusive o estranho, fora da lista).
    await cadastrarEstranho()
    const comoMembro = `insert into public.registro_acoes (episodio_id, origem, acao, membro_id) values ($1, 'toque', 'clipe', $2)`
    for (const [sessao, uid] of [[ana, UID_ANA], [adm, UID_ADM], [bia, UID_BIA], [estranho, UID_ESTRANHO]] as const) {
      expect(erro(await comoSessao(db, sessao, comoMembro, [ID_EPISODIO, uid])).message).toBe(violaRls('registro_acoes'))
    }
    linhas(await comoSessao(db, palco, INSERE_ACAO, [ID_EPISODIO, ID_PALCO])) // controle
    linhas(await comoSessao(db, palco, comoMembro, [ID_EPISODIO, UID_BIA])) // controle: o palco declara a autoria de membro
    expect(await contar('registro_acoes')).toBe(2)
  })

  test('so-admin-le-lista', async () => {
    const lista = (c: Claims) => comoSessao<{ email: string }>(db, c, 'select email from public.membros_permitidos order by email')
    expect(linhas(await lista(ana))).toEqual([])
    expect(linhas(await lista(adm)).map((l) => l.email)).toEqual([EMAIL_ADM, EMAIL_ANA, EMAIL_BIA])
  })

  test('ninguem-se-promove', async () => {
    const papelDaAna = async () =>
      (await db.query<{ papel: string }>('select papel from public.membros_permitidos where email = $1', [EMAIL_ANA])).rows[0].papel
    const insereNovo = `insert into public.membros_permitidos (email, papel) values ('nova@revocast.test', 'equipe')`
    const promoveAna = `update public.membros_permitidos set papel = 'admin' where email = $1`

    expect(erro(await comoSessao(db, ana, insereNovo)).message).toBe(violaRls('membros_permitidos'))
    expect(linhas(await comoSessao(db, ana, promoveAna, [EMAIL_ANA]))).toEqual([])
    expect(await papelDaAna()).toBe('equipe')
    // Sem where: só a política de update barra (a de leitura não entra), então este pega um update afrouxado.
    linhas(await comoSessao(db, ana, `update public.membros_permitidos set papel = 'admin'`))
    const papeis = await db.query<{ email: string; papel: string }>('select email, papel from public.membros_permitidos order by email')
    expect(papeis.rows).toEqual([
      { email: EMAIL_ADM, papel: 'admin' },
      { email: EMAIL_ANA, papel: 'equipe' },
      { email: EMAIL_BIA, papel: 'apresentadora' },
    ])

    // Ninguém se põe na lista com o próprio e-mail.
    await cadastrarEstranho()
    expect(erro(await comoSessao(db, estranho, `insert into public.membros_permitidos (email, papel) values ($1, 'admin')`, [EMAIL_ESTRANHO])).message).toBe(
      violaRls('membros_permitidos'),
    )
    linhas(await comoSessao(db, adm, insereNovo))
    expect(await contar('membros_permitidos')).toBe(4)
    linhas(await comoSessao(db, adm, promoveAna, [EMAIL_ANA])) // controle do update
    expect(await papelDaAna()).toBe('admin')
  })

  test('apresentadora-nao-altera-preparacao', async () => {
    const altera = `update public.cenas set nome_exibicao = 'Alterada' where id = $1 returning nome_exibicao`
    expect(linhas(await comoSessao(db, bia, altera, [ID_CENA]))).toEqual([])
    expect(linhas(await comoSessao(db, bia, 'delete from public.cenas where id = $1 returning id', [ID_CENA]))).toEqual([])
    const cena = await db.query('select nome_exibicao from public.cenas where id = $1', [ID_CENA])
    expect(cena.rows).toEqual([{ nome_exibicao: 'Abertura' }])
    expect(linhas(await comoSessao(db, ana, altera, [ID_CENA]))).toEqual([{ nome_exibicao: 'Alterada' }]) // controle
  })

  test('apresentadora-nao-le-membros', async () => {
    expect(await ids(bia, 'membros')).toEqual([])
    expect(await ids(ana, 'membros')).toEqual([UID_ANA, UID_BIA, UID_ADM].sort())
  })

  test('codigos-fechados', async () => {
    expect(await papel(adm)).toBe('admin')
    expect(erro(await comoSessao(db, adm, 'select * from public.codigos_pareamento')).message).toBe(
      'permission denied for table codigos_pareamento',
    )
  })

  test('anon-nao-executa', async () => {
    expect(erro(await comoSessao(db, null, 'select public.papel_atual()')).message).toBe(
      'permission denied for function papel_atual',
    )
  })
})

describe('dispositivos', () => {
  test('equipe-le-dispositivos', async () => {
    expect(await ids(ana, 'dispositivos')).toEqual([ID_CAMERA, ID_PALCO, ID_OBS_CAMERA].sort())
    expect(await ids(bia, 'dispositivos')).toEqual([])
  })

  test('palco-nao-le-dispositivos', async () => {
    expect(await ids(palco, 'dispositivos')).toEqual([])
    expect((await ids(obsCamera, 'dispositivos')).sort()).toEqual([ID_CAMERA, ID_OBS_CAMERA].sort()) // controle
  })

  test('obs-camera-le-camera', async () => {
    expect(await ids(obsCamera, 'dispositivos')).toEqual([ID_CAMERA, ID_OBS_CAMERA].sort())
    expect(await ids(camera, 'dispositivos')).toEqual([ID_CAMERA])
  })

  test('palco-le-avisos', async () => {
    expect(await ids(palco, 'avisos')).toEqual([ID_AVISO])
  })

  test('camera-nao-le-avisos', async () => {
    expect(await ids(camera, 'avisos')).toEqual([])
    expect(await ids(palco, 'avisos')).toEqual([ID_AVISO]) // controle
  })

  test('revogado-perde-acesso', async () => {
    expect(await ids(palco, 'avisos')).toEqual([ID_AVISO]) // controle
    await db.query('update public.dispositivos set revogado_em = now() where id = $1', [ID_PALCO])
    expect(await ids(palco, 'avisos')).toEqual([])
    // Revogado continua revogado mesmo com revogado_em anterior a pareado_em: só limpar revogado_em
    // (o novo pareamento da E3) devolve o acesso.
    await db.query(`update public.dispositivos set pareado_em = now(), revogado_em = now() - interval '1 day' where id = $1`, [ID_PALCO])
    expect(await ids(palco, 'avisos')).toEqual([])
  })

  test('palco-registra-acao', async () => {
    const antes = await contar('registro_acoes')
    linhas(await comoSessao(db, palco, INSERE_ACAO, [ID_EPISODIO, ID_PALCO]))
    expect(await contar('registro_acoes')).toBe(antes + 1)
  })

  test('camera-nao-registra-acao', async () => {
    expect(erro(await comoSessao(db, camera, INSERE_ACAO, [ID_EPISODIO, ID_CAMERA])).message).toBe(
      violaRls('registro_acoes'),
    )
    expect(erro(await comoSessao(db, obsCamera, INSERE_ACAO, [ID_EPISODIO, ID_OBS_CAMERA])).message).toBe(
      violaRls('registro_acoes'),
    )
  })

  test('estranho-nao-registra-acao', async () => {
    await cadastrarEstranho()
    expect(erro(await comoSessao(db, estranho, INSERE_ACAO, [ID_EPISODIO, ID_PALCO])).message).toBe(
      violaRls('registro_acoes'),
    )
  })

  test('dispositivo-exige-anonima', async () => {
    await cadastrarEstranho()
    await db.query('update public.dispositivos set usuario_anonimo_id = $1 where id = $2', [UID_ESTRANHO, ID_PALCO])
    expect(await ids(estranho, 'avisos')).toEqual([])
    // Controle: a mesma sessão, se fosse anônima, seria o palco e leria o aviso.
    expect(await ids(sessaoAnonima(UID_ESTRANHO), 'avisos')).toEqual([ID_AVISO])
  })
})

describe('gatilho criar_perfil_membro', () => {
  const perfil = async (uid: string) =>
    (await db.query<{ nome: string }>('select nome from public.membros where id = $1', [uid])).rows

  test('gatilho-cria-perfil', async () => {
    const antes = await contar('membros')
    const casos: [string, string, Record<string, unknown>, string][] = [
      ['00000000-0000-4000-8000-00000000e001', 'carla@revocast.test', { full_name: 'Carla Souza', name: 'Carla' }, 'Carla Souza'],
      ['00000000-0000-4000-8000-00000000e002', 'dani@revocast.test', { name: 'Dani' }, 'Dani'],
      ['00000000-0000-4000-8000-00000000e003', 'edu.lima@revocast.test', {}, 'edu.lima'],
      ['00000000-0000-4000-8000-00000000e008', 'hana@revocast.test', { full_name: '', name: 'Hana' }, 'Hana'],
    ]
    for (const [i, [uid, email, metadados, nome]] of casos.entries()) {
      await cadastrarUsuario(db, { uid, email, anonimo: false, provedor: 'google', confirmado: true, metadados })
      expect(await contar('membros')).toBe(antes + i + 1)
      expect(await perfil(uid)).toEqual([{ nome }])
    }
  })

  test('gatilho-email-minusculo', async () => {
    await cadastrarUsuario(db, { uid: '00000000-0000-4000-8000-00000000e007', email: 'Gabi.Rocha@Revocast.TEST', anonimo: false, provedor: 'google', confirmado: true })
    const r = await db.query('select email from public.membros where id = $1', ['00000000-0000-4000-8000-00000000e007'])
    expect(r.rows).toEqual([{ email: 'gabi.rocha@revocast.test' }])
  })

  test('gatilho-so-no-cadastro', async () => {
    // O gatilho é só "after insert" (primeiro login, DES-001 §7): um update em auth.users, como o Auth faz ao
    // trocar o e-mail, não cria outro perfil. Disparado também no update, o insert bateria em membros_pkey e a
    // troca de e-mail falharia (revisão 12, N3). O perfil fica com o e-mail antigo (Riscos da migração).
    await db.exec('set local role supabase_auth_admin')
    await db.query(`update auth.users set email = 'ana.nova@revocast.test' where id = $1`, [UID_ANA])
    await db.exec('reset role')
    const r = await db.query('select email from public.membros where id = $1', [UID_ANA])
    expect(r.rows).toEqual([{ email: EMAIL_ANA }])
    // Controle: o update chegou a auth.users.
    const u = await db.query('select email from auth.users where id = $1', [UID_ANA])
    expect(u.rows).toEqual([{ email: 'ana.nova@revocast.test' }])
  })

  test('gatilho-ignora-anonimo', async () => {
    const antes = await contar('membros')
    // Sessão anônima com e-mail (o usuário anônimo pode pedir um e-mail antes de deixar de ser anônimo):
    // só a condição "não anônimo" do gatilho impede o perfil.
    await cadastrarUsuario(db, { uid: '00000000-0000-4000-8000-00000000e004', email: 'anonimo@revocast.test', anonimo: true, provedor: null, confirmado: false })
    expect(await contar('membros')).toBe(antes)
    // Controle positivo no mesmo teste: cadastro não anônimo cria o perfil.
    await cadastrarUsuario(db, { uid: '00000000-0000-4000-8000-00000000e005', email: 'fabi@revocast.test', anonimo: false, provedor: 'google', confirmado: true })
    expect(await contar('membros')).toBe(antes + 1)
  })

  test('gatilho-ignora-sem-email', async () => {
    const antes = await contar('membros')
    await cadastrarUsuario(db, { uid: '00000000-0000-4000-8000-00000000e006', email: null, anonimo: false, provedor: 'google', confirmado: false })
    expect(await contar('membros')).toBe(antes)
    expect((await db.query('select id from auth.users where id = $1', ['00000000-0000-4000-8000-00000000e006'])).rows).toHaveLength(1)
  })
})

describe('preparação, lista e registro (Correção 1)', () => {
  /** Cria, como superusuário, uma mídia do tipo som e o som; devolve os ids. */
  async function criarMidiaESom(): Promise<{ midia: string; som: string }> {
    const m = await db.query<{ id: string }>(
      `insert into public.midias (tipo, nome, caminho, mime, tamanho_bytes) values ('som', 'aplauso', 'sons/aplauso.mp3', 'audio/mpeg', 1000) returning id`,
    )
    const s = await db.query<{ id: string }>(`insert into public.sons (midia_id, rotulo) values ($1, 'aplauso') returning id`, [m.rows[0].id])
    return { midia: m.rows[0].id, som: s.rows[0].id }
  }

  test('apresentadora-nao-altera-episodio', async () => {
    const altera = `update public.episodios set titulo = 'Alterado' where id = $1 returning titulo`
    expect(linhas(await comoSessao(db, bia, altera, [ID_EPISODIO]))).toEqual([])
    const ep = await db.query('select titulo from public.episodios where id = $1', [ID_EPISODIO])
    expect(ep.rows).toEqual([{ titulo: 'Episódio de teste' }])
    expect(linhas(await comoSessao(db, ana, altera, [ID_EPISODIO]))).toEqual([{ titulo: 'Alterado' }]) // controle
  })

  test('so-admin-apaga-lista', async () => {
    // Com where (a política de leitura também barra) e sem where (só a política de delete barra).
    expect(linhas(await comoSessao(db, ana, 'delete from public.membros_permitidos where email = $1', [EMAIL_ADM]))).toEqual([])
    expect(linhas(await comoSessao(db, ana, 'delete from public.membros_permitidos'))).toEqual([])
    expect(await contar('membros_permitidos')).toBe(3)
    // Controle: o adm apaga uma linha nova.
    await db.query(`insert into public.membros_permitidos (email, papel) values ('nova@revocast.test', 'equipe')`)
    linhas(await comoSessao(db, adm, `delete from public.membros_permitidos where email = 'nova@revocast.test'`))
    expect(await contar('membros_permitidos')).toBe(3)
  })

  test('estranho-nao-le-registro', async () => {
    await cadastrarEstranho()
    linhas(await comoSessao(db, palco, INSERE_ACAO, [ID_EPISODIO, ID_PALCO]))
    expect(await ids(estranho, 'registro_acoes')).toEqual([])
    expect(await ids(camera, 'registro_acoes')).toEqual([])
    expect(await ids(palco, 'registro_acoes')).toEqual([]) // o palco só insere
    expect(await ids(bia, 'registro_acoes')).toHaveLength(1) // controle
  })

  test('camera-e-estranho-nao-leem-preparacao', async () => {
    await cadastrarEstranho()
    const { midia, som } = await criarMidiaESom()
    const consultas: [string, string][] = [
      ['estudio_estado', 'select id::text as id from public.estudio_estado'],
      ['midias', 'select id from public.midias'],
      ['sons', 'select id from public.sons'],
      ['mapa_gestos', 'select gesto::text as id from public.mapa_gestos'],
      ['cenas', 'select id from public.cenas'],
      ['episodios', 'select id from public.episodios'],
    ]
    for (const [tabela, sql] of consultas) {
      for (const sessao of [camera, estranho, obsCamera]) {
        expect(linhas(await comoSessao(db, sessao, sql)), tabela).toEqual([])
      }
      expect(linhas(await comoSessao(db, bia, sql)).length, `controle ${tabela}`).toBe(await contar(tabela))
    }
    // Controles exatos: o palco lê mídias, sons e o mapa, mas não o estúdio.
    expect(await ids(palco, 'midias')).toEqual([midia])
    expect(await ids(palco, 'sons')).toEqual([som])
    expect(linhas(await comoSessao(db, palco, 'select gesto from public.mapa_gestos'))).toHaveLength(7)
    expect(await ids(palco, 'cenas')).toEqual([ID_CENA])
    expect(await ids(palco, 'episodios')).toEqual([ID_EPISODIO])
    expect(linhas(await comoSessao(db, palco, 'select id from public.estudio_estado'))).toEqual([])
  })

  test('dispositivos-nao-leem-membros-avisos-registro', async () => {
    // DES-001 §8: câmera e obs_camera não acessam avisos nem membros; registro_acoes é lido só por membros.
    await cadastrarEstranho()
    linhas(await comoSessao(db, palco, INSERE_ACAO, [ID_EPISODIO, ID_PALCO]))
    for (const tabela of ['avisos', 'membros', 'registro_acoes']) {
      for (const sessao of [camera, estranho, obsCamera]) expect(await ids(sessao, tabela), tabela).toEqual([])
    }
    // Controles: a apresentadora e o palco leem avisos; a equipe lê membros; a apresentadora lê o registro.
    expect(await ids(bia, 'avisos')).toEqual([ID_AVISO])
    expect(await ids(palco, 'avisos')).toEqual([ID_AVISO])
    expect(await ids(ana, 'membros')).toHaveLength(4) // os 3 semeados + o estranho cadastrado neste teste
    expect(await ids(bia, 'registro_acoes')).toHaveLength(1)
  })

  test('admin-escreve-preparacao', async () => {
    const midia = linhas(await comoSessao<{ id: string }>(db, adm,
      `insert into public.midias (tipo, nome, caminho, mime, tamanho_bytes) values ('som', 'vinheta', 'sons/vinheta.mp3', 'audio/mpeg', 10) returning id`))[0].id
    linhas(await comoSessao(db, adm, `insert into public.sons (midia_id, rotulo) values ($1, 'vinheta')`, [midia]))
    linhas(await comoSessao(db, adm, INSERE_EPISODIO))
    linhas(await comoSessao(db, adm, INSERE_AVISO, [ID_EPISODIO]))
    expect([await contar('midias'), await contar('sons'), await contar('episodios'), await contar('avisos')]).toEqual([1, 1, 2, 2])
    expect(linhas(await comoSessao(db, adm, `update public.sons set volume = 0.5 where midia_id = $1 returning volume`, [midia]))).toEqual([{ volume: 0.5 }])
    expect(linhas(await comoSessao(db, adm, `update public.mapa_gestos set acao = 'clipe' where gesto = 'Thumb_Up' returning acao`))).toEqual([{ acao: 'clipe' }])
    // E3 (PLA-004, D7): o modo teste só muda pela função; o update direto em estudio_estado perdeu o privilégio.
    linhas(await comoSessao(db, adm, 'select public.definir_modo_teste($1)', [ID_EPISODIO]))
    expect((await db.query('select episodio_teste_id from public.estudio_estado')).rows).toEqual([{ episodio_teste_id: ID_EPISODIO }])
    expect(erro(await comoSessao(db, adm, 'update public.estudio_estado set episodio_teste_id = null where id = 1 returning episodio_teste_id')).message).toBe(
      negado('estudio_estado'),
    )
    expect(linhas(await comoSessao(db, adm, 'delete from public.avisos where id = $1 returning id', [ID_AVISO]))).toEqual([{ id: ID_AVISO }])
  })

  test('apresentadora-nao-altera-mapa-e-avisos', async () => {
    const mapa = `update public.mapa_gestos set acao = 'clipe' where gesto = 'Thumb_Up' returning acao`
    const aviso = `update public.avisos set titulo = 'Alterado' where id = $1 returning titulo`
    expect(linhas(await comoSessao(db, bia, mapa))).toEqual([])
    expect(linhas(await comoSessao(db, bia, aviso, [ID_AVISO]))).toEqual([])
    expect(linhas(await comoSessao(db, ana, mapa))).toEqual([{ acao: 'clipe' }]) // controle
    expect(linhas(await comoSessao(db, ana, aviso, [ID_AVISO]))).toEqual([{ titulo: 'Alterado' }]) // controle
  })

  test('service-role-nao-executa-funcoes', async () => {
    // Os privilégios padrão do Supabase dão EXECUTE em funções novas também a service_role; a migração o revoga
    // (Correção 14): só authenticated executa as 3 funções. service_role passa por cima da RLS e não avalia
    // políticas, então não precisa delas. Um uso futuro pede decisão própria, com o GRANT explícito e, a partir do
    // VER-011, o ajuste do rpc:grants-check, que acusa EXECUTE de service_role.
    const executa = async (papelPg: string, funcao: string) =>
      (await db.query<{ t: boolean }>('select has_function_privilege($1, $2, $3) as t', [papelPg, funcao, 'EXECUTE'])).rows[0].t
    for (const funcao of ['public.papel_atual()', 'public.dispositivo_atual()', 'public.criar_perfil_membro()']) {
      expect([funcao, await executa('service_role', funcao), await executa('authenticated', funcao)]).toEqual([funcao, false, true])
    }
  })

  test('anon-nao-executa-funcoes', async () => {
    expect(erro(await comoSessao(db, null, 'select * from public.dispositivo_atual()')).message).toBe(
      'permission denied for function dispositivo_atual',
    )
    expect(erro(await comoSessao(db, null, 'select public.criar_perfil_membro()')).message).toBe(
      'permission denied for function criar_perfil_membro',
    )
    // Controles: authenticated executa as duas (a de gatilho recusa por ser de gatilho, não por permissão).
    expect(linhas(await comoSessao<{ id: string }>(db, palco, 'select id from public.dispositivo_atual()'))).toEqual([{ id: ID_PALCO }])
    expect(erro(await comoSessao(db, ana, 'select public.criar_perfil_membro()')).message).toBe(
      'trigger functions can only be called as triggers',
    )
  })

  test('apresentadora-nao-escreve-midias-e-sons', async () => {
    const { midia, som } = await criarMidiaESom()
    const insereMidia = `insert into public.midias (tipo, nome, caminho, mime, tamanho_bytes) values ('imagem', 'foto', 'imagens/foto.png', 'image/png', 10)`
    expect(erro(await comoSessao(db, bia, insereMidia)).message).toBe(violaRls('midias'))
    linhas(await comoSessao(db, ana, insereMidia)) // controle

    const outra = (await db.query<{ id: string }>(
      `insert into public.midias (tipo, nome, caminho, mime, tamanho_bytes) values ('som', 'buuu', 'sons/buuu.mp3', 'audio/mpeg', 10) returning id`,
    )).rows[0].id
    const insereSom = `insert into public.sons (midia_id, rotulo) values ($1, 'buuu')`
    expect(erro(await comoSessao(db, bia, insereSom, [outra])).message).toBe(violaRls('sons'))
    linhas(await comoSessao(db, ana, insereSom, [outra])) // controle

    const alteraMidia = `update public.midias set nome = 'novo' where id = $1 returning nome`
    const alteraSom = `update public.sons set rotulo = 'novo' where id = $1 returning rotulo`
    expect(linhas(await comoSessao(db, bia, alteraMidia, [midia]))).toEqual([])
    expect(linhas(await comoSessao(db, bia, alteraSom, [som]))).toEqual([])
    expect(linhas(await comoSessao(db, ana, alteraMidia, [midia]))).toEqual([{ nome: 'novo' }]) // controle
    expect(linhas(await comoSessao(db, ana, alteraSom, [som]))).toEqual([{ rotulo: 'novo' }]) // controle

    const apagaSom = 'delete from public.sons where id = $1 returning id'
    const apagaMidia = 'delete from public.midias where id = $1 returning id'
    expect(linhas(await comoSessao(db, bia, apagaSom, [som]))).toEqual([])
    expect(linhas(await comoSessao(db, bia, apagaMidia, [midia]))).toEqual([])
    expect(linhas(await comoSessao(db, ana, apagaSom, [som]))).toEqual([{ id: som }]) // controle
    expect(linhas(await comoSessao(db, ana, apagaMidia, [midia]))).toEqual([{ id: midia }]) // controle
  })

  test('apresentadora-nao-apaga-nem-altera-estudio', async () => {
    const apagaAviso = 'delete from public.avisos where id = $1 returning id'
    const apagaEpisodio = 'delete from public.episodios where id = $1 returning id'
    const apagaCena = 'delete from public.cenas where id = $1 returning id'
    const alteraEstudio = 'update public.estudio_estado set episodio_teste_id = $1 where id = 1 returning episodio_teste_id'
    expect(linhas(await comoSessao(db, bia, apagaAviso, [ID_AVISO]))).toEqual([])
    expect(linhas(await comoSessao(db, bia, apagaEpisodio, [ID_EPISODIO]))).toEqual([])
    expect(linhas(await comoSessao(db, bia, apagaCena, [ID_CENA]))).toEqual([])
    // E3 (PLA-004, D7): sem o update de estudio_estado, a recusa vem do privilégio (antes da RLS), e a função também recusa.
    expect(erro(await comoSessao(db, bia, alteraEstudio, [ID_EPISODIO])).message).toBe(negado('estudio_estado'))
    expect(codigoDoErro(erro(await comoSessao(db, bia, 'select public.definir_modo_teste($1)', [ID_EPISODIO])))).toBe('42501')
    expect([await contar('avisos'), await contar('episodios'), await contar('cenas')]).toEqual([1, 1, 1])
    expect((await db.query('select episodio_teste_id from public.estudio_estado')).rows).toEqual([{ episodio_teste_id: null }])
    // Controles: a equipe faz os mesmos comandos (o modo teste, pela função).
    linhas(await comoSessao(db, ana, 'select public.definir_modo_teste($1)', [ID_EPISODIO]))
    expect((await db.query('select episodio_teste_id from public.estudio_estado')).rows).toEqual([{ episodio_teste_id: ID_EPISODIO }])
    expect(linhas(await comoSessao(db, ana, apagaAviso, [ID_AVISO]))).toEqual([{ id: ID_AVISO }])
    // VER-046 (I3): o episódio do modo teste não se apaga; a equipe sai do teste pela função antes de apagar.
    linhas(await comoSessao(db, ana, 'select public.definir_modo_teste($1)', [null]))
    expect(linhas(await comoSessao(db, ana, apagaEpisodio, [ID_EPISODIO]))).toEqual([{ id: ID_EPISODIO }])
    expect(linhas(await comoSessao(db, ana, apagaCena, [ID_CENA]))).toEqual([{ id: ID_CENA }])
  })

  test('sem-escrita-direta', async () => {
    // Tabelas que o cliente não escreve direto (só gatilho, funções da E3 ou o palco inserindo):
    // nenhuma sessão, nem o admin, consegue inserir, alterar ou apagar.
    linhas(await comoSessao(db, palco, INSERE_ACAO, [ID_EPISODIO, ID_PALCO]))
    // A sessão tenta se ligar ao dispositivo novo (forma de um auto-pareamento sem código).
    const insereDispositivo = `insert into public.dispositivos (tipo, rotulo, usuario_anonimo_id) values ('obs_palco', 'PC 2', auth.uid())`
    const insereMembro = `insert into public.membros (id, email, nome) values ($1, 'nova@revocast.test', 'Nova')`
    await insercaoRecusada(adm, 'dispositivos', insereDispositivo)
    await insercaoRecusada(adm, 'membros', insereMembro, [UID_SESSAO_CAMERA])
    const semEfeitoLista: [Claims, string, unknown[]][] = [
      [adm, `update public.dispositivos set rotulo = 'x' returning id`, []],
      [adm, `delete from public.dispositivos returning id`, []],
      [adm, `update public.membros set nome = 'x' returning id`, []],
      [adm, `delete from public.membros returning id`, []],
      [adm, `update public.registro_acoes set teste = true returning id`, []],
      [adm, `delete from public.registro_acoes returning id`, []],
      [ana, `delete from public.estudio_estado returning id`, []],
      [ana, `delete from public.mapa_gestos returning gesto`, []],
      // Dispositivos não alteram nem apagam o próprio registro (a câmera não pode virar obs_palco).
      [camera, `update public.dispositivos set tipo = 'obs_palco', reconhecer_no = null where id = $1 returning id`, [ID_CAMERA]],
      [camera, `delete from public.dispositivos where id = $1 returning id`, [ID_CAMERA]],
      [obsCamera, `update public.dispositivos set rotulo = 'x' where id = $1 returning id`, [ID_OBS_CAMERA]],
      [obsCamera, `delete from public.dispositivos where id = $1 returning id`, [ID_OBS_CAMERA]],
    ]
    for (const [sessao, sql, params] of semEfeitoLista) await semEfeito(sessao, sql, params)
    for (const sessao of [camera, obsCamera, palco]) await insercaoRecusada(sessao, 'dispositivos', insereDispositivo)
    // O palco não lê dispositivos nem registro_acoes: sem where, só o privilégio (ou as políticas de update/delete) barraria.
    await semEfeito(palco, `update public.dispositivos set rotulo = 'x', revogado_em = null`)
    await semEfeito(palco, 'delete from public.dispositivos')
    await semEfeito(palco, 'update public.registro_acoes set teste = true')
    await semEfeito(palco, 'delete from public.registro_acoes')
    const rotulos = await db.query<{ rotulo: string }>(`select rotulo from public.dispositivos where rotulo = 'x'`)
    expect(rotulos.rows).toEqual([])
    const testes = await db.query<{ n: number }>('select count(*)::int as n from public.registro_acoes where teste')
    expect(testes.rows[0].n).toBe(0)
    expect(await ids(camera, 'avisos')).toEqual([]) // a câmera continua câmera
    // Controle: as linhas existem e o admin as enxerga (o 0 acima não é tabela vazia nem falta de leitura).
    const vistas = async (tabela: string) => (await comoSessao<{ n: number }>(db, adm, `select count(*)::int as n from public.${tabela}`))
    expect(linhas(await vistas('dispositivos'))[0].n).toBe(3)
    expect(linhas(await vistas('membros'))[0].n).toBe(3)
    expect(linhas(await vistas('registro_acoes'))[0].n).toBe(1)
    expect(linhas(await vistas('estudio_estado'))[0].n).toBe(1)
    expect(linhas(await vistas('mapa_gestos'))[0].n).toBe(7)
  })

  test('acl-de-tabelas-e-sequencias', async () => {
    // Catálogo: os privilégios de tabela de public dados a outros papéis que não o dono (aclexplode de relacl),
    // comparados com PRIVILEGIOS_AUTHENTICATED. Um GRANT a mais (para anon, para service_role, em
    // codigos_pareamento, a PUBLIC, com grant option ou numa operação que nenhuma política usa) ou a menos muda a
    // lista; service_role, que o padrão do Supabase ainda deixaria com truncate/references/trigger/maintain, não
    // aparece em nenhuma linha.
    const r = await db.query<{ l: string }>(
      `select c.relname || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ' '
            || string_agg(a.privilege_type || case when a.is_grantable then '*' else '' end, ',' order by a.privilege_type) as l
       from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join lateral aclexplode(c.relacl) a
       where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') and a.grantee <> c.relowner
       group by c.relname, a.grantee order by 1`,
    )
    const esperado = Object.entries(PRIVILEGIOS_AUTHENTICATED)
      .filter(([, privs]) => privs.length > 0)
      .map(([tabela, privs]) => `${tabela} authenticated ${privs.join(',')}`)
      .sort()
    expect(r.rows.map((l) => l.l)).toEqual(esperado)
    // Privilégios de coluna: exatamente os de PRIVILEGIOS_POR_COLUNA (PLA-004, D7), só para authenticated e sem grant
    // option (um GRANT por coluna a mais, a outro papel ou com grant option escaparia da lista acima e cai aqui).
    const colunas = await db.query<{ l: string }>(
      `select c.relname || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ' '
            || a.privilege_type || case when a.is_grantable then '*' else '' end || ' ' || string_agg(att.attname, ',' order by att.attname) as l
       from pg_attribute att join pg_class c on c.oid = att.attrelid join pg_namespace n on n.oid = c.relnamespace
         cross join lateral aclexplode(att.attacl) a
       where n.nspname = 'public' and att.attacl is not null and a.grantee <> c.relowner
       group by c.relname, a.grantee, a.privilege_type, a.is_grantable order by 1`,
    )
    const esperadoPorColuna = Object.entries(PRIVILEGIOS_POR_COLUNA)
      .flatMap(([tabela, ops]) => Object.entries(ops).map(([op, cols]) => `${tabela} authenticated ${op} ${cols.join(',')}`))
      .sort()
    expect(colunas.rows.map((l) => l.l)).toEqual(esperadoPorColuna)
    // A migração não cria sequências (chaves uuid e estudio_estado.id fixo): o revoke de sequências vale para as futuras.
    const seqs = await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'S'`)
    expect(seqs.rows).toEqual([])
    // Controle: as 13 tabelas existem e cada uma tem ACL (o resultado acima não veio de relacl nulo).
    const acls = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relacl is not null`,
    )
    expect(acls.rows[0].n).toBe(13)
  })

  test('mesmo-catalogo-com-tabelas-expostas', async () => {
    // Com "Automatically expose new tables" ligado (ou no padrão anterior a 2026-10-30), tabelas e sequências novas
    // recebem "grant all" para anon, authenticated e service_role. A migração começa com revoke all dos três, então
    // o catálogo de privilégios (ACL das relações de public e privilégios padrão do dono) tem de sair igual.
    const catalogo = async (d: PGlite) => ({
      acl: (await d.query(`select c.relname, c.relacl::text as acl from pg_class c where c.relnamespace = 'public'::regnamespace
        and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') order by 1`)).rows,
      padrao: (await d.query(`select d.defaclobjtype, d.defaclacl::text as acl from pg_default_acl d
        where d.defaclnamespace = 'public'::regnamespace and d.defaclrole = 'postgres_sim'::regrole order by 1`)).rows,
    })
    const exposto = await criarBanco({ exporTabelasNovas: true })
    try {
      expect(await catalogo(exposto)).toEqual(await catalogo(db))
    } finally {
      await exposto.close()
    }
    // Controle: as duas variantes da simulação diferem de fato antes da migração (tabela nova do dono).
    const tem = async (d: PGlite, papelPg: string, priv: string) =>
      (await d.query<{ t: boolean }>('select has_table_privilege($1, $2, $3) as t', [papelPg, 'public.nova', priv])).rows[0].t
    for (const [expor, select] of [[false, false], [true, true]] as const) {
      const d = await criarBanco({ exporTabelasNovas: expor, aplicarMigracao: false })
      try {
        await d.exec(`set role ${DONO_MIGRACAO}`)
        await d.exec('create table public.nova (id int)')
        await d.exec('reset role')
        for (const papelPg of ['anon', 'authenticated', 'service_role']) {
          expect([expor, papelPg, await tem(d, papelPg, 'SELECT'), await tem(d, papelPg, 'TRUNCATE')]).toEqual([expor, papelPg, select, true])
        }
      } finally {
        await d.close()
      }
    }
  }, 2 * TEMPO_LIMITE_HOOK_MS) // cria 3 bancos a mais: cerca de 2 vezes o tempo do beforeAll

  test('privilegios-de-tabela', async () => {
    const tabelas = ['membros_permitidos', 'membros', 'midias', 'sons', 'cenas', 'episodios', 'avisos', 'mapa_gestos',
      'estudio_estado', 'dispositivos', 'codigos_pareamento', 'registro_acoes', 'tentativas_pareamento']
    const tem = async (papelPg: string, tabela: string, priv: string) =>
      (await db.query<{ t: boolean }>('select has_table_privilege($1, $2, $3) as t', [papelPg, `public.${tabela}`, priv])).rows[0].t
    // service_role: nenhum privilégio em nenhuma tabela, inclusive codigos_pareamento (BYPASSRLS não supre a falta de GRANT).
    for (const tabela of tabelas) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
        expect(await tem('service_role', tabela, priv), `service_role ${tabela} ${priv}`).toBe(false)
      }
    }
    for (const papelPg of ['anon', 'authenticated']) {
      for (const tabela of tabelas) {
        // O padrão de 2026-10-30 ainda daria truncate, references, trigger e maintain; a migração os revoga.
        for (const priv of ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) expect(await tem(papelPg, tabela, priv), `${papelPg} ${tabela} ${priv}`).toBe(false)
      }
      for (const tabela of ['codigos_pareamento', 'tentativas_pareamento']) {
        for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          expect(await tem(papelPg, tabela, priv), `${papelPg} ${tabela} ${priv}`).toBe(false)
        }
      }
    }
    // Controle: o GRANT explícito da migração existe (authenticated lê e escreve cenas; anon, não).
    expect(await tem('authenticated', 'cenas', 'SELECT')).toBe(true)
    expect(await tem('authenticated', 'cenas', 'INSERT')).toBe(true)
    expect(await tem('anon', 'cenas', 'SELECT')).toBe(false)
    // Tabela futura criada pelo mesmo dono das migrações (postgres_sim): nasce sem nenhum privilégio para anon,
    // authenticated e service_role (os privilégios padrão de 2026-10-30 dariam truncate, references, trigger e
    // maintain; a migração os revoga para o futuro também).
    await db.exec(`set local role ${DONO_MIGRACAO}`)
    await db.exec('create table public.tabela_futura (id int)')
    await db.exec('reset role')
    for (const papelPg of ['anon', 'authenticated', 'service_role']) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
        expect(await tem(papelPg, 'tabela_futura', priv), `${papelPg} futura ${priv}`).toBe(false)
      }
    }
    expect(await tem(DONO_MIGRACAO, 'tabela_futura', 'SELECT')).toBe(true) // controle: a tabela existe e o dono a lê
    // Sequência futura do mesmo dono: nasce sem privilégio para os três papéis (o padrão de hoje daria update; o
    // antigo, tudo).
    await db.exec(`set local role ${DONO_MIGRACAO}`)
    await db.exec('create sequence public.sequencia_futura')
    await db.exec('reset role')
    const temSeq = async (papelPg: string, priv: string) =>
      (await db.query<{ t: boolean }>('select has_sequence_privilege($1, $2, $3) as t', [papelPg, 'public.sequencia_futura', priv])).rows[0].t
    for (const papelPg of ['anon', 'authenticated', 'service_role']) {
      for (const priv of ['USAGE', 'SELECT', 'UPDATE']) expect(await temSeq(papelPg, priv), `${papelPg} sequência futura ${priv}`).toBe(false)
    }
    expect(await temSeq(DONO_MIGRACAO, 'USAGE')).toBe(true) // controle
  })

  test('dono-da-migracao-sem-superusuario', async () => {
    // A migração roda como no Supabase, com um dono que não é superusuário (banco.ts): se voltasse a rodar como
    // superusuário, regressões como FORCE ROW LEVEL SECURITY em dispositivos deixariam de quebrar os testes.
    // Atributos do postgres do Supabase (NOSUPERUSER CREATEDB CREATEROLE LOGIN REPLICATION), menos BYPASSRLS
    // (dono-migracao.sql).
    const papel = await db.query(
      'select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication from pg_roles where rolname = $1',
      [DONO_MIGRACAO],
    )
    expect(papel.rows).toEqual([
      { rolsuper: false, rolbypassrls: false, rolcreaterole: true, rolcreatedb: true, rolcanlogin: true, rolreplication: true },
    ])
    // Todas as tabelas, tipos e funções da migração são dele (nenhum objeto ficou com o superusuário).
    const donos = await db.query<{ dono: string }>(
      `select distinct pg_get_userbyid(relowner) as dono from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'i', 'S')
       union select distinct pg_get_userbyid(proowner) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
       union select distinct pg_get_userbyid(typowner) from pg_type t join pg_namespace n on n.oid = t.typnamespace
         where n.nspname = 'public'`,
    )
    expect(donos.rows).toEqual([{ dono: DONO_MIGRACAO }])
    // Controle: há as 13 tabelas (12 da E0 e tentativas_pareamento, da E3) e as 12 funções em public (a lista acima não
    // veio de um schema vazio): as 3 da E0 (papel_atual, dispositivo_atual, criar_perfil_membro) e as 9 da E3
    // (criar_codigo_pareamento, parear_dispositivo, meu_dispositivo, revogar_dispositivo, episodio_ativo, iniciar_ao_vivo,
    // encerrar_ao_vivo, definir_modo_teste, pode_usar_canal).
    const n = await db.query<{ n: number }>(
      `select (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r')
            + (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public') as n`,
    )
    expect(Number(n.rows[0].n)).toBe(13 + 12)
  })

  test('anon-nao-le-nem-escreve', async () => {
    const { midia } = await criarMidiaESom()
    linhas(await comoSessao(db, palco, INSERE_ACAO, [ID_EPISODIO, ID_PALCO]))
    // Sessão anônima cadastrada, mas não pareada a nenhum dispositivo.
    const UID_SOLTA = '00000000-0000-4000-8000-00000000b009'
    await cadastrarUsuario(db, { uid: UID_SOLTA, email: null, anonimo: true, provedor: null, confirmado: false })
    const solta = sessaoAnonima(UID_SOLTA)
    const tabelas = ['membros_permitidos', 'membros', 'midias', 'sons', 'cenas', 'episodios', 'avisos', 'mapa_gestos',
      'estudio_estado', 'dispositivos', 'registro_acoes']
    for (const tabela of tabelas) {
      // anon não tem privilégio em nenhuma tabela; a sessão solta (authenticated) passa no privilégio e a RLS não devolve nada.
      const leAnon = `select * from public.${tabela}`
      await semPrivilegioERls(null, tabela, 'select', leAnon, [], `${tabela} anon`, async () => {
        expect(linhas(await comoSessao(db, null, leAnon)), `${tabela} anon (com o grant)`).toEqual([])
      })
      expect(linhas(await comoSessao(db, solta, `select * from public.${tabela}`)), `${tabela} solta`).toEqual([])
    }
    for (const sessao of [null, solta]) {
      expect(erro(await comoSessao(db, sessao, 'select * from public.codigos_pareamento')).message).toBe(
        'permission denied for table codigos_pareamento',
      )
    }
    // anon não insere em nenhuma tabela.
    const insercoes: [string, string, unknown[]][] = [
      ['membros_permitidos', `insert into public.membros_permitidos (email, papel) values ('nova@revocast.test', 'admin')`, []],
      ['membros', `insert into public.membros (id, email, nome) values ($1, 'solta@revocast.test', 'Solta')`, [UID_SOLTA]],
      ['midias', `insert into public.midias (tipo, nome, caminho, mime, tamanho_bytes) values ('imagem', 'f', 'imagens/f.png', 'image/png', 1)`, []],
      ['sons', `insert into public.sons (midia_id, rotulo) values ($1, 'x')`, [midia]],
      ['cenas', INSERE_CENA, []],
      ['episodios', INSERE_EPISODIO, []],
      ['avisos', INSERE_AVISO, [ID_EPISODIO]],
      ['mapa_gestos', `insert into public.mapa_gestos (gesto, acao) values ('Victory', 'clipe')`, []],
      ['estudio_estado', `insert into public.estudio_estado (id) values (1)`, []],
      ['dispositivos', `insert into public.dispositivos (tipo, rotulo) values ('obs_palco', 'PC 2')`, []],
      ['registro_acoes', INSERE_ACAO, [ID_EPISODIO, ID_PALCO]],
    ]
    for (const [tabela, sql, params] of insercoes) {
      for (const sessao of [null, solta]) await insercaoRecusada(sessao, tabela, sql, params, `${tabela} ${sessao ? 'solta' : 'anon'}`)
    }
    for (const sessao of [null, solta]) {
      expect(erro(await comoSessao(db, sessao, `insert into public.codigos_pareamento (dispositivo_id, codigo_hash) values ($1, 'h')`, [ID_CAMERA])).message).toBe(
        'permission denied for table codigos_pareamento',
      )
    }
    // anon também não altera nem apaga: update e delete sem where nas 11 tabelas com política não mudam nada.
    const retrato = async () => {
      const r: Record<string, string> = {}
      for (const t of tabelas) {
        r[t] = (await db.query<{ h: string }>(`select coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from public.${t} x`)).rows[0].h
      }
      return r
    }
    const alteracoes = [
      `update public.membros_permitidos set papel = 'admin'`, `update public.membros set nome = 'x'`,
      `update public.midias set nome = 'x'`, `update public.sons set rotulo = 'x'`, `update public.cenas set nome_exibicao = 'x'`,
      `update public.episodios set titulo = 'x'`, `update public.avisos set titulo = 'x'`, `update public.mapa_gestos set acao = 'clipe'`,
      `update public.estudio_estado set episodio_teste_id = '${ID_EPISODIO}'`, `update public.dispositivos set rotulo = 'x'`,
      `update public.registro_acoes set teste = true`,
      ...['registro_acoes', 'avisos', 'mapa_gestos', 'estudio_estado', 'dispositivos', 'membros_permitidos', 'membros', 'sons', 'midias', 'episodios', 'cenas']
        .map((t) => `delete from public.${t}`),
    ]
    const antes = await retrato()
    for (const sql of alteracoes) await semEfeito(null, sql)
    expect(await retrato()).toEqual(antes)
    // Controle do retrato: uma alteração do admin o muda.
    linhas(await comoSessao(db, adm, `update public.cenas set nome_exibicao = 'x'`))
    expect((await retrato()).cenas).not.toBe(antes.cenas)
    // Controle: a apresentadora lê o que lhe cabe (preparação, estúdio e registro).
    for (const tabela of ['midias', 'sons', 'cenas', 'episodios', 'avisos', 'mapa_gestos', 'estudio_estado', 'registro_acoes']) {
      expect(linhas(await comoSessao(db, bia, `select * from public.${tabela}`)).length, `controle ${tabela}`).toBe(await contar(tabela))
    }
  })

  test('dispositivos-nao-escrevem-preparacao', async () => {
    // DES-001 §8: o palco lê a preparação, mas não a escreve; câmera, obs_camera e sessão solta, nem isso.
    const { midia } = await criarMidiaESom()
    const UID_SOLTA = '00000000-0000-4000-8000-00000000b009'
    await cadastrarUsuario(db, { uid: UID_SOLTA, email: null, anonimo: true, provedor: null, confirmado: false })
    const sessoes: [string, Claims][] = [['palco', palco], ['camera', camera], ['obs_camera', obsCamera], ['solta', sessaoAnonima(UID_SOLTA)]]
    const insercoes: [string, string, unknown[]][] = [
      ['midias', `insert into public.midias (tipo, nome, caminho, mime, tamanho_bytes) values ('imagem', 'f', 'imagens/f.png', 'image/png', 1)`, []],
      ['sons', `insert into public.sons (midia_id, rotulo) values ($1, 'x')`, [midia]],
      ['cenas', INSERE_CENA, []],
      ['episodios', INSERE_EPISODIO, []],
      ['avisos', INSERE_AVISO, [ID_EPISODIO]],
    ]
    const alteracoes = [
      `update public.midias set nome = 'x'`, `update public.sons set rotulo = 'x'`, `update public.cenas set nome_exibicao = 'x'`,
      `update public.episodios set titulo = 'x', gestos_ligados = true`, `update public.avisos set titulo = 'x'`,
      `update public.mapa_gestos set acao = 'clipe'`, `update public.estudio_estado set episodio_teste_id = '${ID_EPISODIO}'`,
      'delete from public.avisos', 'delete from public.episodios', 'delete from public.sons', 'delete from public.midias',
      'delete from public.cenas', 'delete from public.mapa_gestos', 'delete from public.estudio_estado',
    ]
    const tabelas = ['midias', 'sons', 'cenas', 'episodios', 'avisos', 'mapa_gestos', 'estudio_estado']
    const retrato = async () => {
      const r: Record<string, string> = {}
      for (const t of tabelas) {
        r[t] = (await db.query<{ h: string }>(`select coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from public.${t} x`)).rows[0].h
      }
      return r
    }
    const antes = await retrato()
    for (const [nome, sessao] of sessoes) {
      for (const [tabela, sql, params] of insercoes) await insercaoRecusada(sessao, tabela, sql, params, `${nome} insere ${tabela}`)
      for (const sql of alteracoes) await semEfeito(sessao, sql)
    }
    expect(await retrato()).toEqual(antes)
    // Controle: a mesma alteração pela equipe muda o retrato.
    linhas(await comoSessao(db, ana, `update public.cenas set nome_exibicao = 'x'`))
    expect((await retrato()).cenas).not.toBe(antes.cenas)
  })

  test('tem-privilegio-por-coluna', () => {
    // O auxiliar dos testes acima entende privilégio de coluna (PLA-004, D7): todas as colunas citadas precisam do grant.
    expect(temPrivilegio(ana, 'episodios', 'update', ['titulo'])).toBe(true)
    expect(temPrivilegio(ana, 'episodios', 'update', ['titulo', 'gestos_ligados'])).toBe(false)
    expect(temPrivilegio(ana, 'episodios', 'insert', ['titulo', 'estado'])).toBe(false)
    expect(temPrivilegio(ana, 'episodios', 'insert', ['titulo', 'data', 'criado_por'])).toBe(true)
    expect(temPrivilegio(ana, 'episodios', 'update')).toBe(false) // sem colunas, só o de tabela conta
    expect(temPrivilegio(ana, 'episodios', 'delete')).toBe(true)
    expect(temPrivilegio(ana, 'estudio_estado', 'update', ['episodio_teste_id'])).toBe(false)
    expect(temPrivilegio(null, 'episodios', 'update', ['titulo'])).toBe(false) // anon nunca
    // E a leitura das colunas do comando, que semEfeito e insercaoRecusada usam.
    expect(colunasDoComando(`update public.episodios set titulo = 'x', gestos_ligados = true where id = $1 returning id`)).toEqual(['titulo', 'gestos_ligados'])
    expect(colunasDoComando(`insert into public.episodios (titulo, estado) values ('x', 'ao_vivo')`)).toEqual(['titulo', 'estado'])
    expect(colunasDoComando('delete from public.episodios')).toEqual([])
  })

  test('ninguem-trunca', async () => {
    linhas(await comoSessao(db, palco, INSERE_ACAO, [ID_EPISODIO, ID_PALCO]))
    for (const sessao of [null, ana, adm, palco]) {
      expect(erro(await comoSessao(db, sessao, 'truncate public.registro_acoes')).message).toBe(
        'permission denied for table registro_acoes',
      )
    }
    expect(await contar('registro_acoes')).toBe(1) // a ação inserida continua lá
  })
})

// E1 (PLA-002, Tarefa 2): o que a entrada e a aba Membros pedem do banco. Os comandos são o SQL equivalente ao que o
// adaptador manda pela Data API (update/delete com where e returning). Mesmo banco e mesmas transações do arquivo.
// Decisão D1 (migração membros_sem_autoalteracao): nenhum admin altera nem remove a própria linha da lista.
describe('E1 — entrada e lista de acesso', () => {
  const EMAIL_ADM2 = 'adm2@revocast.test'
  const UID_ADM2 = '00000000-0000-4000-8000-00000000a005'
  const adm2 = membroGoogle(EMAIL_ADM2, UID_ADM2)

  /** E-mail e papel de todas as linhas da lista, lidos como superusuário. */
  async function retratoDaLista(): Promise<{ email: string; papel: string }[]> {
    return (await db.query<{ email: string; papel: string }>('select email, papel from public.membros_permitidos order by email')).rows
  }
  const LISTA_SEMEADA = [
    { email: EMAIL_ADM, papel: 'admin' },
    { email: EMAIL_ANA, papel: 'equipe' },
    { email: EMAIL_BIA, papel: 'apresentadora' },
  ]
  const ALTERA_PAPEL = (papelNovo: string) => `update public.membros_permitidos set papel = '${papelNovo}' where email = $1 returning email`
  const REMOVE = 'delete from public.membros_permitidos where email = $1 returning email'

  test('e1-papel-de-cada-sessao', async () => {
    await cadastrarEstranho()
    expect([await papel(ana), await papel(bia), await papel(adm), await papel(estranho)]).toEqual(['equipe', 'apresentadora', 'admin', null])
  })

  test('e1-admin-troca-papel-vale-na-hora', async () => {
    linhas(await comoSessao(db, ana, INSERE_CENA)) // controle: antes da troca, a equipe insere
    await db.query(`delete from public.cenas where nome_obs = 'Cena Entrevista'`) // o mesmo insert volta a ser válido
    expect(linhas(await comoSessao(db, adm, ALTERA_PAPEL('apresentadora'), [EMAIL_ANA]))).toEqual([{ email: EMAIL_ANA }])
    expect(await papel(ana)).toBe('apresentadora')
    expect(erro(await comoSessao(db, ana, INSERE_CENA)).message).toBe(violaRls('cenas'))
  })

  test('e1-admin-remove-vale-na-hora', async () => {
    expect(await ids(ana, 'cenas')).toEqual([ID_CENA]) // controle
    expect(linhas(await comoSessao(db, adm, REMOVE, [EMAIL_ANA]))).toEqual([{ email: EMAIL_ANA }])
    expect(await papel(ana)).toBeNull()
    expect(await ids(ana, 'cenas')).toEqual([])
    // O perfil continua em membros (DES-001 §7), sem papel.
    expect((await db.query('select id from public.membros where id = $1', [UID_ANA])).rows).toEqual([{ id: UID_ANA }])
  })

  test('e1-liberado-depois-de-entrar', async () => {
    await cadastrarEstranho() // entrou antes de ser liberado: o gatilho criou o perfil
    expect((await db.query('select id from public.membros where id = $1', [UID_ESTRANHO])).rows).toEqual([{ id: UID_ESTRANHO }])
    expect(await papel(estranho)).toBeNull()
    linhas(
      await comoSessao(db, adm, `insert into public.membros_permitidos (email, papel, criado_por) values ($1, 'equipe', $2)`, [EMAIL_ESTRANHO, UID_ADM]),
    )
    expect(await papel(estranho)).toBe('equipe')
  })

  test('e1-equipe-nao-escreve-na-lista', async () => {
    expect(await retratoDaLista()).toEqual(LISTA_SEMEADA)
    // (1) Como o adaptador: com where e returning, 0 linhas e sem erro (o caso nada_alterado).
    expect(linhas(await comoSessao(db, ana, ALTERA_PAPEL('admin'), [EMAIL_ANA]))).toEqual([])
    expect(linhas(await comoSessao(db, ana, REMOVE, [EMAIL_BIA]))).toEqual([])
    expect(await retratoDaLista()).toEqual(LISTA_SEMEADA)
    // (2) Sem where e sem returning: só a política de escrita decide (com where ou returning, a de leitura, só do
    // admin, também entra e esconderia uma política de escrita afrouxada).
    expect(linhas(await comoSessao(db, ana, `update public.membros_permitidos set papel = 'apresentadora'`))).toEqual([])
    expect(linhas(await comoSessao(db, ana, 'delete from public.membros_permitidos'))).toEqual([])
    expect(await retratoDaLista()).toEqual(LISTA_SEMEADA)
  })

  test('e1-admin-nao-altera-a-si-mesmo', async () => {
    // O e-mail da sessão como semeado e em maiúsculas (a comparação é a de papel_atual(): minúsculas).
    for (const emailDaSessao of [EMAIL_ADM, 'Adm@Revocast.TEST']) {
      const sessao = membroGoogle(emailDaSessao, UID_ADM)
      expect([emailDaSessao, linhas(await comoSessao(db, sessao, ALTERA_PAPEL('equipe'), [EMAIL_ADM]))]).toEqual([emailDaSessao, []])
      expect([emailDaSessao, linhas(await comoSessao(db, sessao, REMOVE, [EMAIL_ADM]))]).toEqual([emailDaSessao, []])
      expect([emailDaSessao, await papel(sessao)]).toEqual([emailDaSessao, 'admin'])
      expect(await retratoDaLista()).toEqual(LISTA_SEMEADA)
    }
    // Nem trocando o e-mail de outra linha pelo próprio: o with check recusa antes da chave primária.
    expect(erro(await comoSessao(db, adm, 'update public.membros_permitidos set email = $1 where email = $2', [EMAIL_ADM, EMAIL_ANA])).message).toBe(
      violaRls('membros_permitidos'),
    )
    // Controle: o mesmo admin altera a linha de outra pessoa.
    expect(linhas(await comoSessao(db, adm, ALTERA_PAPEL('apresentadora'), [EMAIL_ANA]))).toEqual([{ email: EMAIL_ANA }])
  })

  test('e1-admin-remove-outro-admin', async () => {
    await db.query(`insert into public.membros_permitidos (email, papel) values ($1, 'admin')`, [EMAIL_ADM2])
    await cadastrarUsuario(db, { uid: UID_ADM2, email: EMAIL_ADM2, anonimo: false, provedor: 'google', confirmado: true })
    expect(await papel(adm2)).toBe('admin') // controle
    expect(linhas(await comoSessao(db, adm, ALTERA_PAPEL('equipe'), [EMAIL_ADM2]))).toEqual([{ email: EMAIL_ADM2 }])
    expect(await papel(adm2)).toBe('equipe')
    expect(linhas(await comoSessao(db, adm, REMOVE, [EMAIL_ADM2]))).toEqual([{ email: EMAIL_ADM2 }])
    expect(await papel(adm2)).toBeNull()
  })

  test('e1-sempre-sobra-um-admin', async () => {
    linhas(await comoSessao(db, adm, 'delete from public.membros_permitidos'))
    expect(await retratoDaLista()).toEqual([{ email: EMAIL_ADM, papel: 'admin' }])
    expect(await papel(adm)).toBe('admin')
  })
})

// E2 (PLA-003, Tarefa 3): o que a Biblioteca e a preparação pedem do banco. Mesmo banco e mesmas transações do arquivo.
// Um envio é simulado como o servidor do Storage faz: o comando roda como a sessão (papel authenticated com as
// claims) e grava em storage.objects com owner_id = auth.uid(). Um delete imita o servidor também no parâmetro
// storage.allow_delete_query (opção deleteDoStorage de comoSessao; sem ela, o gatilho protect_objects_delete da
// simulação recusa com 42501). Bucket e políticas: migração biblioteca_storage (decisões D3 a D5).
describe('E2 — Biblioteca e preparação', () => {
  const UUID_A = '0b6e2b8a-3c1d-4f2a-9e5b-1a2b3c4d5e6f'
  const UUID_B = '1c7f3c9b-4d2e-4a3b-8f6c-2b3c4d5e6f70'
  const UID_SOLTA = '00000000-0000-4000-8000-00000000b009'
  const solta = sessaoAnonima(UID_SOLTA)
  const ENVIA = `insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, auth.uid()::text)`
  /** As 9 sessões da matriz, com o nome que aparece na mensagem do teste. */
  const SESSOES: [string, Claims | null][] = [
    ['anon', null], ['ana', ana], ['bia', bia], ['adm', adm], ['estranho', estranho],
    ['camera', camera], ['palco', palco], ['obs_camera', obsCamera], ['solta', solta],
  ]
  /** Cadastra o estranho (Google fora da lista) e a sessão anônima sem dispositivo. */
  async function cadastrarSessoesExtras(): Promise<void> {
    await cadastrarEstranho()
    await cadastrarUsuario(db, { uid: UID_SOLTA, email: null, anonimo: true, provedor: null, confirmado: false })
  }
  /** Cria, como superusuário, o bucket `outro` (fora do app), privado e sem limites. */
  async function criarBucketOutro(): Promise<void> {
    await db.query(`insert into storage.buckets (id, name) values ('outro', 'outro')`)
  }
  /** Bucket e nome de todos os objetos, lidos como superusuário. */
  async function retratoDoStorage(): Promise<{ bucket_id: string; name: string }[]> {
    return (await db.query<{ bucket_id: string; name: string }>('select bucket_id, name from storage.objects order by bucket_id, name')).rows
  }
  /** Semeia, como superusuário, 2 objetos no `midias` (um som, uma imagem) e 1 no `outro`. */
  async function semearObjetos(): Promise<void> {
    await criarBucketOutro()
    await db.query(
      `insert into storage.objects (bucket_id, name) values ('midias', $1), ('midias', $2), ('outro', $1)`,
      [`som/${UUID_A}.mp3`, `imagem/${UUID_B}.png`],
    )
  }
  const OBJETOS_SEMEADOS = [
    { bucket_id: 'midias', name: `imagem/${UUID_B}.png` },
    { bucket_id: 'midias', name: `som/${UUID_A}.mp3` },
    { bucket_id: 'outro', name: `som/${UUID_A}.mp3` },
  ]
  const codigo = (e: Error) => (e as Error & { code?: string }).code

  test('e2-bucket-privado-com-limites', async () => {
    const r = await db.query<{ public: boolean; file_size_limit: number | bigint; allowed_mime_types: string[] }>(
      `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'midias'`,
    )
    expect(r.rows).toHaveLength(1)
    const [b] = r.rows
    expect(b.public).toBe(false)
    expect(Number(b.file_size_limit)).toBe(52428800)
    // Exatamente os 8 tipos da D4, sem image/svg+xml (carrega script).
    expect([...b.allowed_mime_types].sort()).toEqual(
      ['audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'],
    )
    expect(b.allowed_mime_types).not.toContain('image/svg+xml')
  })

  test('e2-bucket-criado-antes-fica-privado', async () => {
    // O ramo on conflict da migração: um bucket midias criado antes à mão (aqui, estragado pelo dono das migrações)
    // volta a privado, com o limite e os 8 tipos, quando o insert da migração roda de novo. O trecho é lido do próprio
    // arquivo (do insert até o fim do on conflict), para não duplicar o texto e falhar se ele mudar.
    const migracao = MIGRACOES.find((m) => m.arquivo.endsWith('_biblioteca_storage.sql'))
    expect(migracao, 'migração biblioteca_storage').toBeDefined()
    const FIM = 'excluded.allowed_mime_types;'
    const ini = migracao!.sql.indexOf('insert into storage.buckets')
    const fim = migracao!.sql.indexOf(FIM)
    expect([ini >= 0, fim > ini]).toEqual([true, true])
    const trecho = migracao!.sql.slice(ini, fim + FIM.length)
    const bucket = async () =>
      (await db.query<{ public: boolean; file_size_limit: number | bigint; allowed_mime_types: string[] }>(
        `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'midias'`,
      )).rows.map((b) => ({ ...b, file_size_limit: Number(b.file_size_limit), allowed_mime_types: [...b.allowed_mime_types].sort() }))
    const comoDono = async (sql: string) => {
      await db.exec(`set local role ${DONO_MIGRACAO}`)
      try {
        await db.exec(sql)
      } finally {
        await db.exec('reset role')
      }
    }
    await comoDono(`update storage.buckets set public = true, file_size_limit = 999999999,
      allowed_mime_types = array['image/svg+xml', 'image/png'] where id = 'midias'`)
    expect(await bucket()).toEqual([{ public: true, file_size_limit: 999999999, allowed_mime_types: ['image/png', 'image/svg+xml'] }]) // controle
    await comoDono(trecho)
    expect(await bucket()).toEqual([{
      public: false,
      file_size_limit: 52428800,
      allowed_mime_types: ['audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'],
    }])
  })

  test('e2-storage-quem-envia', async () => {
    await cadastrarSessoesExtras()
    const nome = `som/${UUID_A}.mp3`
    for (const [rotulo, sessao] of SESSOES) {
      const r = await comoSessao(db, sessao, ENVIA, ['midias', nome])
      if (rotulo === 'ana' || rotulo === 'adm') {
        expect(linhas(r), rotulo).toEqual([])
      } else {
        // anon também cai na RLS, e não no privilégio: no Supabase anon e authenticated têm select, insert, update
        // e delete em storage.* (supabase/storage, migrations/tenant/0002-storage-schema.sql, "alter default
        // privileges in schema storage grant all on tables", menos o que a 0073 tira; simulacao-supabase.sql) e
        // as políticas são todas "to authenticated".
        expect(erro(r).message, rotulo).toBe(violaRls('objects'))
      }
    }
    // Só os 2 envios aceitos ficaram, cada um com o dono da sessão.
    const r = await db.query('select bucket_id, name, owner_id from storage.objects order by owner_id')
    expect(r.rows).toEqual([
      { bucket_id: 'midias', name: nome, owner_id: UID_ANA },
      { bucket_id: 'midias', name: nome, owner_id: UID_ADM },
    ])
  })

  test('e2-storage-quem-le', async () => {
    await cadastrarSessoesExtras()
    await semearObjetos()
    const DO_MIDIAS = [{ name: `imagem/${UUID_B}.png` }, { name: `som/${UUID_A}.mp3` }]
    for (const [rotulo, sessao] of SESSOES) {
      const lidos = linhas(await comoSessao<{ name: string }>(db, sessao, 'select name from storage.objects order by name'))
      // ana, adm (prévia na Biblioteca) e palco (toca os sons e mostra as imagens): os 2 do midias, nunca o do outro.
      expect(lidos, rotulo).toEqual(['ana', 'adm', 'palco'].includes(rotulo) ? DO_MIDIAS : [])
    }
  })

  test('e2-storage-quem-apaga', async () => {
    await cadastrarSessoesExtras()
    await semearObjetos()
    // Controle do gatilho: sem o parâmetro que o servidor do Storage liga, até a equipe recebe 42501.
    const semParametro = erro(await comoSessao(db, ana, 'delete from storage.objects'))
    expect(codigo(semParametro)).toBe('42501')
    expect(await retratoDoStorage()).toEqual(OBJETOS_SEMEADOS)
    for (const [rotulo, sessao] of SESSOES) {
      await db.exec('savepoint caso')
      expect(linhas(await comoSessao(db, sessao, 'delete from storage.objects', [], { deleteDoStorage: true })), rotulo).toEqual([])
      // ana e adm: o midias esvazia e o outro fica; os demais: nada muda.
      expect(await retratoDoStorage(), rotulo).toEqual(
        rotulo === 'ana' || rotulo === 'adm' ? [{ bucket_id: 'outro', name: `som/${UUID_A}.mp3` }] : OBJETOS_SEMEADOS,
      )
      await db.exec('rollback to savepoint caso')
      await db.exec('release savepoint caso')
    }
  })

  test('e2-sem-update', async () => {
    await semearObjetos()
    expect(linhas(await comoSessao(db, ana, `update storage.objects set name = $1`, [`som/${UUID_B}.mp3`]))).toEqual([])
    expect(await retratoDoStorage()).toEqual(OBJETOS_SEMEADOS)
  })

  test.each([
    `som/../x.mp3`,
    `som/a/${UUID_A}.mp3`,
    `som\\${UUID_A}.mp3`,
    `som/${UUID_A}.png`,
    `imagem/${UUID_A}.mp3`,
    `outro/${UUID_A}.mp3`,
    `som/${UUID_A.toUpperCase()}.mp3`,
    `som/${UUID_A}.mp3.html`,
    `som/${UUID_A}`,
    `som/x.mp3`,
    `imagem/${UUID_A}.svg`,
  ])('e2-nome-fora-do-formato: %s', async (nome) => {
    expect(erro(await comoSessao(db, ana, ENVIA, ['midias', nome])).message).toBe(violaRls('objects'))
    // Controles: os dois formatos que o app gera passam com a mesma sessão.
    expect(linhas(await comoSessao(db, ana, ENVIA, ['midias', `imagem/${UUID_A}.png`]))).toEqual([])
    expect(linhas(await comoSessao(db, ana, ENVIA, ['midias', `som/${UUID_A}.m4a`]))).toEqual([])
  })

  test('e2-outro-bucket-nao-recebe', async () => {
    await criarBucketOutro()
    expect(erro(await comoSessao(db, ana, ENVIA, ['outro', `som/${UUID_A}.mp3`])).message).toBe(violaRls('objects'))
    expect(linhas(await comoSessao(db, ana, ENVIA, ['midias', `som/${UUID_A}.mp3`]))).toEqual([]) // controle
  })

  test('e2-som-em-gesto-nao-sai', async () => {
    const [midia] = linhas(await comoSessao<{ id: string }>(db, ana,
      `insert into public.midias (tipo, nome, caminho, mime, tamanho_bytes) values ('som', 'aplauso.mp3', $1, 'audio/mpeg', 1000) returning id`,
      [`som/${UUID_A}.mp3`]))
    const [som] = linhas(await comoSessao<{ id: string }>(db, ana,
      `insert into public.sons (midia_id, rotulo) values ($1, 'aplauso') returning id`, [midia.id]))
    expect(linhas(await comoSessao(db, ana,
      `update public.mapa_gestos set acao = 'som', som_id = $1 where gesto = 'Thumb_Up' returning gesto`, [som.id]))).toEqual([{ gesto: 'Thumb_Up' }])
    const APAGA = 'delete from public.midias where id = $1 returning id'
    const e = erro(await comoSessao(db, ana, APAGA, [midia.id]))
    expect(codigo(e)).toBe('23503')
    expect(e.message).toContain('mapa_gestos')
    expect((await db.query('select id from public.midias where id = $1', [midia.id])).rows).toEqual([{ id: midia.id }])
    // Com o gesto de volta a nenhuma, a mídia sai, e o som vai junto (cascata).
    linhas(await comoSessao(db, ana, `update public.mapa_gestos set acao = 'nenhuma', som_id = null where gesto = 'Thumb_Up' returning gesto`))
    expect(linhas(await comoSessao(db, ana, APAGA, [midia.id]))).toEqual([{ id: midia.id }])
    expect((await db.query('select id from public.midias where id = $1', [midia.id])).rows).toEqual([])
    expect((await db.query('select id from public.sons where id = $1', [som.id])).rows).toEqual([])
  })

  test('e2-imagem-em-aviso-vira-nulo', async () => {
    const [midia] = linhas(await comoSessao<{ id: string }>(db, ana,
      `insert into public.midias (tipo, nome, caminho, mime, tamanho_bytes) values ('imagem', 'foto.png', $1, 'image/png', 10) returning id`,
      [`imagem/${UUID_A}.png`]))
    expect(linhas(await comoSessao(db, ana, 'update public.avisos set imagem_midia_id = $1 where id = $2 returning id', [midia.id, ID_AVISO])))
      .toEqual([{ id: ID_AVISO }])
    expect(linhas(await comoSessao(db, ana, 'delete from public.midias where id = $1 returning id', [midia.id]))).toEqual([{ id: midia.id }])
    expect((await db.query('select id, imagem_midia_id from public.avisos where id = $1', [ID_AVISO])).rows).toEqual([
      { id: ID_AVISO, imagem_midia_id: null },
    ])
  })

  test('e2-cena-em-gesto-nao-sai', async () => {
    expect(linhas(await comoSessao(db, ana,
      `update public.mapa_gestos set acao = 'cena', cena_id = $1 where gesto = 'Victory' returning gesto`, [ID_CENA]))).toEqual([{ gesto: 'Victory' }])
    const e = erro(await comoSessao(db, ana, 'delete from public.cenas where id = $1 returning id', [ID_CENA]))
    expect(codigo(e)).toBe('23503')
    expect(e.message).toContain('mapa_gestos')
    expect((await db.query('select id from public.cenas where id = $1', [ID_CENA])).rows).toEqual([{ id: ID_CENA }])
  })

  test('e2-episodio-sem-estado', async () => {
    // Documenta que a E2 não mexe em estado nem em gestos_ligados (D2): o update do adaptador manda só título e data.
    expect(linhas(await comoSessao(db, ana,
      `update public.episodios set titulo = 'Novo', data = '2026-12-01' where id = $1 returning estado, gestos_ligados`, [ID_EPISODIO])))
      .toEqual([{ estado: 'rascunho', gestos_ligados: false }])
  })
})

// PLA-004, Tarefa 2 (D6; revisão do plano, I6 e N6): a simulação do Realtime. comoCanal segue o caminho principal do
// servidor do Realtime (lib/realtime/tenants/authorization.ex, @authorize_query): chama realtime.authorize(...), que
// insere a sonda como o papel da conexão, troca para o papel da sessão com as claims e o tópico e lê de volta (receber) ou
// tenta inserir (enviar) em realtime.messages, sob a RLS. Sem política nenhuma, nada passa; com uma política de teste, só
// o que ela permite. Este é o teste que a sabotagem "tirar a RLS de realtime.messages da simulação" derruba nesta tarefa.
describe('Simulação do Realtime (E3, Tarefa 2)', () => {
  /** Cria, como superusuário e dentro da transação do teste (desfeita no fim), uma política de teste em realtime.messages. */
  const politica = (sql: string) => db.exec(`create policy teste_${Math.random().toString(36).slice(2, 8)} on realtime.messages ${sql}`)

  test('simulacao-realtime-respeita-rls', async () => {
    // Sem política nenhuma em realtime.messages: a RLS nega receber e enviar, em qualquer extensão.
    for (const ext of ['broadcast', 'presence'] as const) {
      expect(await comoCanal(db, ana, 'x', ext, 'receber'), `receber ${ext}`).toBe(false)
    }
    for (const ext of ['broadcast', 'presence', 'persistence'] as const) {
      expect(await comoCanal(db, ana, 'x', ext, 'enviar'), `enviar ${ext}`).toBe(false)
    }

    // Política de receber só no tópico x: receber em x, não em y, e enviar continua negado.
    await politica(`for select to authenticated using (realtime.topic() = 'x')`)
    expect(await comoCanal(db, ana, 'x', 'broadcast', 'receber')).toBe(true)
    expect(await comoCanal(db, ana, 'x', 'presence', 'receber')).toBe(true)
    expect(await comoCanal(db, ana, 'y', 'broadcast', 'receber')).toBe(false)
    for (const ext of ['broadcast', 'presence', 'persistence'] as const) {
      expect(await comoCanal(db, ana, 'x', ext, 'enviar'), `enviar ${ext} com só a política de receber`).toBe(false)
    }
    // A política de teste não vale para anon (to authenticated).
    expect(await comoCanal(db, null, 'x', 'broadcast', 'receber')).toBe(false)

    // Política de enviar só persistence em x: a coluna extension chega à política como a extensão pedida.
    await politica(`for insert to authenticated with check (realtime.topic() = 'x' and extension = 'persistence')`)
    expect(await comoCanal(db, ana, 'x', 'persistence', 'enviar')).toBe(true)
    expect(await comoCanal(db, ana, 'y', 'persistence', 'enviar')).toBe(false)
    expect(await comoCanal(db, ana, 'x', 'broadcast', 'enviar')).toBe(false)
    expect(await comoCanal(db, ana, 'x', 'presence', 'enviar')).toBe(false)

    // As claims e o sub chegam à política (request.jwt.claims, como o servidor define): só a ana recebe em z.
    await politica(`for select to authenticated using (realtime.topic() = 'z' and auth.uid() = '${UID_ANA}'::uuid)`)
    expect(await comoCanal(db, ana, 'z', 'broadcast', 'receber')).toBe(true)
    expect(await comoCanal(db, bia, 'z', 'broadcast', 'receber')).toBe(false)

    // Nada fica gravado: as sondas são desfeitas dentro de realtime.authorize, e comoCanal desfaz o próprio savepoint.
    expect((await db.query('select count(*)::int as n from realtime.messages')).rows).toEqual([{ n: 0 }])
    expect((await db.query("select current_user as u, coalesce(current_setting('realtime.topic', true), '') as t")).rows).toEqual([{ u: 'postgres', t: '' }])
  })

  test('comoCanal: o servidor não confere leitura de persistence (só broadcast e presence)', async () => {
    await expect(comoCanal(db, ana, 'x', 'persistence', 'receber')).rejects.toThrow('persistence')
  })
})

// E3 (PLA-004, Tarefa 3): pareamento (D2), dispositivos e revogação (D4, D5), canais (D6) e estado do episódio só por
// função (D7), sobre a migração ao_vivo_e_pareamento. Mesmo banco e mesmas transações do arquivo. Toda sessão anônima
// nova de pareamento é cadastrada no próprio teste (cadastrarUsuario anônimo), como o login anônimo do app faria. Os
// canais passam por comoCanal (realtime.authorize, como o servidor do Realtime), com as duas políticas de
// realtime.messages chamando public.pode_usar_canal.
describe('E3 — pareamento, ao vivo e canais', () => {
  const UID_SOLTA = '00000000-0000-4000-8000-00000000b009'
  const UID_SESSAO_REVOGADA = '00000000-0000-4000-8000-00000000b00a'
  const ID_REVOGADO = '00000000-0000-4000-8000-00000000d004'
  const ID_OUTRO = '00000000-0000-4000-8000-00000000c104'
  const ID_AO_VIVO = '00000000-0000-4000-8000-00000000c105'
  const ID_ENCERRADO = '00000000-0000-4000-8000-00000000c106'
  const solta = sessaoAnonima(UID_SOLTA)
  const revogado = sessaoAnonima(UID_SESSAO_REVOGADA)
  /** As 9 sessões da E2 e a de um obs_palco revogado (sessão própria, para caber numa linha das tabelas). */
  const SESSOES: [string, Claims | null][] = [
    ['anon', null], ['ana', ana], ['bia', bia], ['adm', adm], ['estranho', estranho],
    ['camera', camera], ['palco', palco], ['obs_camera', obsCamera], ['solta', solta], ['revogado', revogado],
  ]
  const sessao = (nome: string) => SESSOES.find(([n]) => n === nome)![1]

  /** Cadastra o estranho, a sessão anônima sem dispositivo e o obs_palco revogado com a sua sessão. */
  async function cadastrarSessoesExtras(): Promise<void> {
    await cadastrarEstranho()
    await cadastrarUsuario(db, { uid: UID_SOLTA, email: null, anonimo: true, provedor: null, confirmado: false })
    await cadastrarUsuario(db, { uid: UID_SESSAO_REVOGADA, email: null, anonimo: true, provedor: null, confirmado: false })
    await db.query(
      `insert into public.dispositivos (id, tipo, rotulo, usuario_anonimo_id, pareado_em, revogado_em) values ($1, 'obs_palco', 'PC revogado', $2, now(), now())`,
      [ID_REVOGADO, UID_SESSAO_REVOGADA],
    )
  }

  let contadorDeAnonimas = 0
  /** Sessão anônima nova (o login anônimo que a rota de dispositivo faz antes de parear). */
  async function novaAnonima(): Promise<Claims> {
    contadorDeAnonimas += 1
    const uid = `00000000-0000-4000-8000-0000${contadorDeAnonimas.toString(16).padStart(8, '0')}`
    await cadastrarUsuario(db, { uid, email: null, anonimo: true, provedor: null, confirmado: false })
    return sessaoAnonima(uid)
  }

  type CodigoCriado = { dispositivo: string; codigo: string; expira: string | Date }
  const CRIA = 'select * from public.criar_codigo_pareamento($1, $2, $3, $4)'
  /** Código criado pela sessão (por padrão, a ana) para um dispositivo novo ou existente. */
  async function criarCodigo(
    tipo: string, rotulo: string | null, dispositivo: string | null = null, cameraId: string | null = null, quem: Claims = ana,
  ): Promise<CodigoCriado> {
    const [l] = linhas(await comoSessao<CodigoCriado>(db, quem, CRIA, [tipo, rotulo, dispositivo, cameraId]))
    return l
  }
  type Pareamento = { resultado: string; dispositivo: string | null; nome: string | null }
  const PAREIA = 'select * from public.parear_dispositivo($1, $2)'
  async function parear(quem: Claims | null, codigo: string | null, tipo: string | null): Promise<Pareamento> {
    const r = linhas(await comoSessao<Pareamento>(db, quem, PAREIA, [codigo, tipo]))
    expect(r).toHaveLength(1)
    return r[0]
  }
  /** Dispositivo da sessão por dispositivo_atual(). */
  async function dispositivoDe(quem: Claims): Promise<string[]> {
    return linhas(await comoSessao<{ id: string }>(db, quem, 'select id from public.dispositivo_atual()')).map((l) => l.id)
  }
  async function usadoEm(dispositivo: string): Promise<(string | Date | null)[]> {
    return (await db.query<{ usado_em: string | Date | null }>('select usado_em from public.codigos_pareamento where dispositivo_id = $1', [dispositivo])).rows.map((l) => l.usado_em)
  }
  async function tentativasDe(uid: string): Promise<number> {
    return (await db.query<{ n: number }>('select count(*)::int as n from public.tentativas_pareamento where usuario_id = $1', [uid])).rows[0].n
  }
  /** Mídia semeada como superusuário (o que o palco pareado passa a ler). */
  async function semearMidia(): Promise<string> {
    return (await db.query<{ id: string }>(
      `insert into public.midias (tipo, nome, caminho, mime, tamanho_bytes) values ('som', 'aplauso', 'sons/aplauso.mp3', 'audio/mpeg', 1000) returning id`,
    )).rows[0].id
  }
  const definirTeste = (id: string | null) => db.query('update public.estudio_estado set episodio_teste_id = $1', [id])
  /** Texto de 43 caracteres na forma do código que nenhum código gerado tem (para tentativas erradas). */
  const codigoErrado = (n: number) => `errado${'x'.repeat(35)}${n.toString().padStart(2, '0')}`
  const SHA256_HEX = async (texto: string) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))].map((b) => b.toString(16).padStart(2, '0')).join('')

  // ----- pareamento (D2) -----

  test('e3-codigo-so-equipe', async () => {
    await cadastrarSessoesExtras()
    for (const [nome, s] of SESSOES) {
      const r = await comoSessao<CodigoCriado>(db, s, CRIA, ['obs_palco', 'PC', null, null])
      if (nome === 'ana' || nome === 'adm') {
        const l = linhas(r)
        expect([nome, l.length, FORMA_DO_CODIGO.test(l[0].codigo)]).toEqual([nome, 1, true])
      } else if (nome === 'anon') {
        expect(erro(r).message).toBe('permission denied for function criar_codigo_pareamento')
      } else {
        expect([nome, codigoDoErro(erro(r))]).toEqual([nome, '42501'])
      }
    }
    // Só as duas chamadas aceitas criaram dispositivo (as recusadas não deixam rastro).
    expect((await db.query<{ n: number }>(`select count(*)::int as n from public.dispositivos where rotulo = 'PC'`)).rows[0].n).toBe(2)
  })

  test('e3-codigo-so-hash', async () => {
    const { dispositivo, codigo } = await criarCodigo('obs_palco', 'PC do hash')
    const conta = async (sql: string, params: unknown[]) => (await db.query<{ n: number }>(sql, params)).rows[0].n
    expect(await conta('select count(*)::int as n from public.codigos_pareamento where codigo_hash = $1', [codigo])).toBe(0)
    expect(await conta(`select count(*)::int as n from public.codigos_pareamento where codigo_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [codigo])).toBe(1)
    // O hash conferido também por fora do Postgres (Web Crypto), para não depender só da mesma expressão da função.
    expect(await conta('select count(*)::int as n from public.codigos_pareamento where dispositivo_id = $1 and codigo_hash = $2', [dispositivo, await SHA256_HEX(codigo)])).toBe(1)
    // Nenhuma coluna de nenhuma linha guarda o código (nem dentro de outro texto).
    expect(await conta('select count(*)::int as n from public.codigos_pareamento c where position($1 in c::text) > 0', [codigo])).toBe(0)
    expect(await conta('select count(*)::int as n from public.dispositivos d where position($1 in d::text) > 0', [codigo])).toBe(0)
  })

  test('e3-codigo-aleatorio', async () => {
    const { dispositivo } = await criarCodigo('obs_palco', 'PC aleatório')
    const codigos: string[] = []
    for (let i = 0; i < 50; i += 1) codigos.push((await criarCodigo('obs_palco', null, dispositivo)).codigo)
    expect(new Set(codigos).size).toBe(50)
    expect(codigos.every((c) => c.length === 43 && FORMA_DO_CODIGO.test(c))).toBe(true)
    // Um código novo do mesmo dispositivo apaga o pendente anterior: sobra só o último.
    expect(await usadoEm(dispositivo)).toEqual([null])
  })

  test('e3-codigo-obs-camera-exige-camera', async () => {
    expect(codigoDoErro(erro(await comoSessao(db, ana, CRIA, ['obs_camera', 'PC câmera', null, null])))).toBe('22023')
    expect(codigoDoErro(erro(await comoSessao(db, ana, CRIA, ['obs_camera', 'PC câmera', null, ID_PALCO])))).toBe('22023')
    const { dispositivo } = await criarCodigo('obs_camera', 'PC câmera', null, ID_CAMERA)
    expect((await db.query('select tipo, camera_id, criado_por from public.dispositivos where id = $1', [dispositivo])).rows).toEqual([
      { tipo: 'obs_camera', camera_id: ID_CAMERA, criado_por: UID_ANA },
    ])
    // Nos outros tipos a câmera indicada é ignorada (dispositivos_camera_so_obs_camera).
    const palcoNovo = await criarCodigo('obs_palco', 'PC palco', null, ID_CAMERA)
    expect((await db.query('select camera_id from public.dispositivos where id = $1', [palcoNovo.dispositivo])).rows).toEqual([{ camera_id: null }])
  })

  test('e3-codigo-parametros-invalidos', async () => {
    // Rótulo (1 a 60 caracteres depois de tirar os espaços das pontas), tipo e dispositivo existente do mesmo tipo.
    const antes = await contar('dispositivos')
    const casos: [string, unknown[]][] = [
      ['rótulo vazio', ['obs_palco', '', null, null]],
      ['rótulo só de espaços', ['obs_palco', '   ', null, null]],
      ['rótulo nulo', ['obs_palco', null, null, null]],
      ['rótulo de 61', ['obs_palco', 'x'.repeat(61), null, null]],
      ['tipo nulo', [null, 'PC', null, null]],
      ['dispositivo de outro tipo', ['camera', null, ID_PALCO, null]],
      ['dispositivo inexistente', ['obs_palco', null, ID_OUTRO, null]],
    ]
    for (const [caso, params] of casos) expect([caso, codigoDoErro(erro(await comoSessao(db, ana, CRIA, params)))]).toEqual([caso, '22023'])
    expect(await contar('dispositivos')).toBe(antes)
    expect(await contar('codigos_pareamento')).toBe(0)
    // Controles: 60 caracteres (com espaços nas pontas, tirados) e o dispositivo existente do mesmo tipo.
    const longo = await criarCodigo('obs_palco', `  ${'y'.repeat(60)}  `)
    expect((await db.query('select rotulo from public.dispositivos where id = $1', [longo.dispositivo])).rows).toEqual([{ rotulo: 'y'.repeat(60) }])
    expect((await criarCodigo('obs_palco', null, ID_PALCO)).dispositivo).toBe(ID_PALCO)
  })

  test('e3-codigo-novo-invalida-pendente', async () => {
    const primeiro = await criarCodigo('obs_palco', 'PC trocado')
    const segundo = await criarCodigo('obs_palco', null, primeiro.dispositivo)
    expect(segundo.dispositivo).toBe(primeiro.dispositivo)
    const s = await novaAnonima()
    expect((await parear(s, primeiro.codigo, 'obs_palco')).resultado).toBe('invalido')
    expect(await parear(s, segundo.codigo, 'obs_palco')).toEqual({ resultado: 'pareado', dispositivo: primeiro.dispositivo, nome: 'PC trocado' })
  })

  test('e3-parear-so-anonima', async () => {
    const { codigo, dispositivo } = await criarCodigo('obs_palco', 'PC membro')
    for (const s of [ana, bia, adm]) expect(codigoDoErro(erro(await comoSessao(db, s, PAREIA, [codigo, 'obs_palco'])))).toBe('42501')
    expect(erro(await comoSessao(db, null, PAREIA, [codigo, 'obs_palco'])).message).toBe('permission denied for function parear_dispositivo')
    // Sem a claim is_anonymous, a sessão não conta como anônima (falha fechada).
    const s = await novaAnonima()
    const { is_anonymous: _a, ...semClaim } = s
    expect(codigoDoErro(erro(await comoSessao(db, semClaim as Claims, PAREIA, [codigo, 'obs_palco'])))).toBe('42501')
    expect(await usadoEm(dispositivo)).toEqual([null])
    expect((await parear(s, codigo, 'obs_palco')).resultado).toBe('pareado') // controle
  })

  test('e3-parear-ok', async () => {
    const midia = await semearMidia()
    const { codigo, dispositivo } = await criarCodigo('obs_palco', 'PC novo')
    const s = await novaAnonima()
    expect(await ids(s, 'midias')).toEqual([]) // controle: antes de parear, nada
    expect(await parear(s, codigo, 'obs_palco')).toEqual({ resultado: 'pareado', dispositivo, nome: 'PC novo' })
    expect(await dispositivoDe(s)).toEqual([dispositivo])
    const [usado] = await usadoEm(dispositivo)
    expect(usado).not.toBeNull()
    const d = await db.query<{ usuario_anonimo_id: string; pareado: boolean; revogado_em: null }>(
      'select usuario_anonimo_id, pareado_em is not null as pareado, revogado_em from public.dispositivos where id = $1', [dispositivo])
    expect(d.rows).toEqual([{ usuario_anonimo_id: s.sub, pareado: true, revogado_em: null }])
    expect(await ids(s, 'midias')).toEqual([midia])
    expect(await tentativasDe(s.sub)).toBe(0)
  })

  test('e3-codigo-uso-unico', async () => {
    const { codigo, dispositivo } = await criarCodigo('obs_palco', 'PC único')
    const s1 = await novaAnonima()
    const s2 = await novaAnonima()
    expect((await parear(s1, codigo, 'obs_palco')).resultado).toBe('pareado')
    expect(await parear(s2, codigo, 'obs_palco')).toEqual({ resultado: 'invalido', dispositivo: null, nome: null })
    expect(await dispositivoDe(s2)).toEqual([])
    expect(await dispositivoDe(s1)).toEqual([dispositivo]) // o dono continua o mesmo
    expect(await tentativasDe(s2.sub)).toBe(1)
  })

  test('e3-codigo-uso-unico-trava-a-linha', async () => {
    // O PGlite tem uma conexão só e não reproduz duas chamadas simultâneas. A garantia vem do texto da função: o select do
    // código termina em FOR UPDATE OF c, e em READ COMMITTED a segunda chamada espera o bloqueio e o Postgres reavalia
    // usado_em is null na versão nova da linha (já usada), devolvendo invalido. Este teste prende a trava no texto.
    const r = await db.query<{ d: string }>(
      `select pg_get_functiondef('public.parear_dispositivo(text, public.tipo_dispositivo)'::regprocedure) as d`)
    const normalizado = r.rows[0].d.replace(/\s+/g, ' ').toLowerCase()
    expect(normalizado).toMatch(/and c\.usado_em is null and c\.expira_em > now\(\) for update of c;/)
  })

  test('e3-codigo-expirado', async () => {
    const { codigo, dispositivo } = await criarCodigo('obs_palco', 'PC expirado')
    await db.query(`update public.codigos_pareamento set expira_em = now() - interval '1 second' where dispositivo_id = $1`, [dispositivo])
    const s = await novaAnonima()
    expect((await parear(s, codigo, 'obs_palco')).resultado).toBe('invalido')
    expect(await usadoEm(dispositivo)).toEqual([null])
    expect(await dispositivoDe(s)).toEqual([])
    // Controle: o mesmo código, de volta à validade, pareia.
    await db.query(`update public.codigos_pareamento set expira_em = now() + interval '1 minute' where dispositivo_id = $1`, [dispositivo])
    expect((await parear(s, codigo, 'obs_palco')).resultado).toBe('pareado')
  })

  test('e3-codigo-vale-2-minutos', async () => {
    const { dispositivo, expira } = await criarCodigo('obs_palco', 'PC validade')
    const r = await db.query<{ ok: boolean; expira_em: Date }>(
      `select expira_em = now() + interval '2 minutes' as ok, expira_em from public.codigos_pareamento where dispositivo_id = $1`,
      [dispositivo],
    )
    expect(r.rows.map((l) => l.ok)).toEqual([true])
    expect(new Date(expira).getTime()).toBe(r.rows[0].expira_em.getTime()) // a função devolve a validade gravada
  })

  test('e3-parear-tipo-errado', async () => {
    const { codigo, dispositivo } = await criarCodigo('obs_palco', 'PC do palco')
    const s = await novaAnonima()
    for (const tipo of ['camera', 'obs_camera', null]) {
      expect([tipo, await parear(s, codigo, tipo)]).toEqual([tipo, { resultado: 'tipo_errado', dispositivo: null, nome: null }])
    }
    expect(await usadoEm(dispositivo)).toEqual([null])
    expect(await tentativasDe(s.sub)).toBe(0)
    expect(await dispositivoDe(s)).toEqual([])
    expect((await parear(s, codigo, 'obs_palco')).resultado).toBe('pareado')
  })

  test('e3-codigo-nulo-ou-fora-da-forma', async () => {
    const { codigo, dispositivo } = await criarCodigo('obs_palco', 'PC forma')
    const s = await novaAnonima()
    for (const errado of [null, '', codigo.slice(0, 42), `${codigo}x`, ` ${codigo}`]) {
      expect([errado, (await parear(s, errado, 'obs_palco')).resultado]).toEqual([errado, 'invalido'])
    }
    expect(await tentativasDe(s.sub)).toBe(5)
    expect(await usadoEm(dispositivo)).toEqual([null])
  })

  test('e3-limite-de-tentativas', async () => {
    const s = await novaAnonima()
    for (let i = 0; i < 5; i += 1) expect((await parear(s, codigoErrado(i), 'obs_palco')).resultado).toBe('invalido')
    expect(await tentativasDe(s.sub)).toBe(5)
    const { codigo, dispositivo } = await criarCodigo('obs_palco', 'PC limite')
    expect(await parear(s, codigo, 'obs_palco')).toEqual({ resultado: 'limite', dispositivo: null, nome: null })
    expect(await usadoEm(dispositivo)).toEqual([null]) // o válido continua sem uso
    expect(await tentativasDe(s.sub)).toBe(5) // a resposta limite não grava tentativa
    expect(await dispositivoDe(s)).toEqual([])
    const outra = await novaAnonima()
    expect((await parear(outra, codigo, 'obs_palco')).resultado).toBe('pareado')
    // Limite inferior da janela: com as 5 falhas de 9 min atrás, a sessão continua em limite (a janela é de 10 min, não menos).
    await db.query(`update public.tentativas_pareamento set criado_em = criado_em - interval '9 minutes' where usuario_id = $1`, [s.sub])
    const outroCodigo = await criarCodigo('obs_palco', 'PC ainda no limite')
    expect((await parear(s, outroCodigo.codigo, 'obs_palco')).resultado).toBe('limite')
    expect(await usadoEm(outroCodigo.dispositivo)).toEqual([null])
    // Depois de 10 min sem falha (11 min no total), a primeira sessão volta a tentar.
    await db.query(`update public.tentativas_pareamento set criado_em = criado_em - interval '2 minutes' where usuario_id = $1`, [s.sub])
    const novo = await criarCodigo('obs_palco', 'PC depois do limite')
    expect((await parear(s, novo.codigo, 'obs_palco')).resultado).toBe('pareado')
  })

  test('e3-tentativas-antigas-limpas', async () => {
    // Tentativas com mais de 1 dia somem na chamada seguinte de parear_dispositivo (de qualquer sessão).
    const s = await novaAnonima()
    expect((await parear(s, codigoErrado(1), 'obs_palco')).resultado).toBe('invalido')
    await db.query(`update public.tentativas_pareamento set criado_em = criado_em - interval '25 hours' where usuario_id = $1`, [s.sub])
    const outra = await novaAnonima()
    expect((await parear(outra, codigoErrado(2), 'obs_palco')).resultado).toBe('invalido')
    expect([await tentativasDe(s.sub), await tentativasDe(outra.sub)]).toEqual([0, 1])
  })

  test('e3-codigos-vencidos-limpos', async () => {
    // Códigos vencidos há mais de 1 dia somem na chamada seguinte de criar_codigo_pareamento (de qualquer dispositivo);
    // o vencido há menos de 1 dia fica (o usado, para a auditoria do pareamento recente).
    const velho = await criarCodigo('obs_palco', 'PC velho')
    const recente = await criarCodigo('obs_palco', 'PC recente')
    const s = await novaAnonima()
    expect((await parear(s, recente.codigo, 'obs_palco')).resultado).toBe('pareado')
    await db.query(`update public.codigos_pareamento set expira_em = now() - interval '25 hours' where dispositivo_id = $1`, [velho.dispositivo])
    await db.query(`update public.codigos_pareamento set expira_em = now() - interval '23 hours' where dispositivo_id = $1`, [recente.dispositivo])
    await criarCodigo('obs_palco', 'PC que dispara a limpeza')
    expect(await usadoEm(velho.dispositivo)).toEqual([])
    expect(await usadoEm(recente.dispositivo)).toHaveLength(1)
    expect((await usadoEm(recente.dispositivo))[0]).not.toBeNull()
  })

  test('e3-parear-de-novo-troca-sessao', async () => {
    await semearMidia()
    expect(await ids(palco, 'midias')).toHaveLength(1) // controle: o palco semeado lê
    const { codigo } = await criarCodigo('obs_palco', null, ID_PALCO)
    const s = await novaAnonima()
    expect(await parear(s, codigo, 'obs_palco')).toEqual({ resultado: 'pareado', dispositivo: ID_PALCO, nome: 'PC do estúdio (palco)' })
    expect(await dispositivoDe(palco)).toEqual([])
    expect(await ids(palco, 'midias')).toEqual([])
    expect(await dispositivoDe(s)).toEqual([ID_PALCO])
    const d = await db.query('select usuario_anonimo_id, revogado_em from public.dispositivos where id = $1', [ID_PALCO])
    expect(d.rows).toEqual([{ usuario_anonimo_id: s.sub, revogado_em: null }])
  })

  test('e3-sessao-em-um-dispositivo-so', async () => {
    const um = await criarCodigo('obs_palco', 'PC um')
    const dois = await criarCodigo('camera', 'Celular dois')
    const s = await novaAnonima()
    expect((await parear(s, um.codigo, 'obs_palco')).resultado).toBe('pareado')
    expect((await parear(s, dois.codigo, 'camera')).resultado).toBe('pareado')
    const r = await db.query('select id, usuario_anonimo_id from public.dispositivos where id = any($1::uuid[]) order by rotulo desc', [[um.dispositivo, dois.dispositivo]])
    expect(r.rows).toEqual([{ id: um.dispositivo, usuario_anonimo_id: null }, { id: dois.dispositivo, usuario_anonimo_id: s.sub }])
    expect(await dispositivoDe(s)).toEqual([dois.dispositivo])
  })

  test('e3-sem-acesso-direto', async () => {
    await cadastrarSessoesExtras()
    await criarCodigo('obs_palco', 'PC tabela')
    const comandos = (t: string) => [
      `select * from public.${t}`,
      t === 'codigos_pareamento'
        ? `insert into public.codigos_pareamento (dispositivo_id, codigo_hash) values ('${ID_PALCO}', 'h')`
        : `insert into public.tentativas_pareamento (usuario_id) values ('${UID_SESSAO_PALCO}')`,
      `update public.${t} set id = id`,
      `delete from public.${t}`,
    ]
    for (const t of ['codigos_pareamento', 'tentativas_pareamento']) {
      for (const [nome, s] of SESSOES) {
        for (const sql of comandos(t)) expect([nome, sql, erro(await comoSessao(db, s, sql)).message]).toEqual([nome, sql, negado(t)])
      }
    }
    expect(await contar('codigos_pareamento')).toBe(1)
  })

  // ----- dispositivos e revogação (D4, D5) -----

  test('e3-revogar', async () => {
    await semearMidia()
    const pendente = await criarCodigo('obs_palco', null, ID_PALCO)
    const REVOGA = 'select public.revogar_dispositivo($1) as usuario'
    expect(codigoDoErro(erro(await comoSessao(db, bia, REVOGA, [ID_PALCO])))).toBe('42501')
    expect(codigoDoErro(erro(await comoSessao(db, palco, REVOGA, [ID_PALCO])))).toBe('42501')
    expect(erro(await comoSessao(db, null, REVOGA, [ID_PALCO])).message).toBe('permission denied for function revogar_dispositivo')
    expect(await dispositivoDe(palco)).toEqual([ID_PALCO]) // as recusas não revogaram
    expect(await ids(palco, 'midias')).toHaveLength(1)
    linhas(await comoSessao(db, palco, INSERE_ACAO, [ID_EPISODIO, ID_PALCO])) // controle do insert
    expect(linhas(await comoSessao(db, ana, REVOGA, [ID_PALCO]))).toEqual([{ usuario: UID_SESSAO_PALCO }])
    expect(await dispositivoDe(palco)).toEqual([])
    expect(await ids(palco, 'midias')).toEqual([])
    expect(erro(await comoSessao(db, palco, INSERE_ACAO, [ID_EPISODIO, ID_PALCO])).message).toBe(violaRls('registro_acoes'))
    expect(await usadoEm(pendente.dispositivo)).toEqual([]) // os pendentes do palco foram apagados
    // A sessão revogada continua na linha (aviso e auditoria, D5).
    const d = await db.query<{ usuario_anonimo_id: string; revogado: boolean }>(
      'select usuario_anonimo_id, revogado_em is not null as revogado from public.dispositivos where id = $1', [ID_PALCO])
    expect(d.rows).toEqual([{ usuario_anonimo_id: UID_SESSAO_PALCO, revogado: true }])
    expect(codigoDoErro(erro(await comoSessao(db, ana, REVOGA, [ID_PALCO])))).toBe('55000')
    expect(codigoDoErro(erro(await comoSessao(db, adm, REVOGA, [ID_OUTRO])))).toBe('22023')
    expect(linhas(await comoSessao(db, adm, REVOGA, [ID_CAMERA]))).toEqual([{ usuario: UID_SESSAO_CAMERA }]) // o admin também revoga
    // Os outros dispositivos não foram tocados.
    expect(await dispositivoDe(obsCamera)).toEqual([ID_OBS_CAMERA])
  })

  test('e3-revogado-nao-repareia-com-codigo-antigo', async () => {
    const antigo = await criarCodigo('obs_palco', null, ID_PALCO)
    linhas(await comoSessao(db, ana, 'select public.revogar_dispositivo($1)', [ID_PALCO]))
    const s = await novaAnonima()
    expect((await parear(s, antigo.codigo, 'obs_palco')).resultado).toBe('invalido')
    expect(await dispositivoDe(s)).toEqual([])
    // Controle: um código novo, criado depois da revogação, pareia de novo e limpa revogado_em (trocar o aparelho).
    const novo = await criarCodigo('obs_palco', null, ID_PALCO)
    expect((await parear(s, novo.codigo, 'obs_palco')).resultado).toBe('pareado')
    expect((await db.query('select usuario_anonimo_id, revogado_em from public.dispositivos where id = $1', [ID_PALCO])).rows).toEqual([
      { usuario_anonimo_id: s.sub, revogado_em: null },
    ])
  })

  test('e3-meu-dispositivo', async () => {
    await cadastrarSessoesExtras()
    const esperado: Record<string, { id: string; tipo: string; rotulo: string; camera_id: string | null }[]> = {
      camera: [{ id: ID_CAMERA, tipo: 'camera', rotulo: 'Celular de gravação', camera_id: null }],
      palco: [{ id: ID_PALCO, tipo: 'obs_palco', rotulo: 'PC do estúdio (palco)', camera_id: null }],
      obs_camera: [{ id: ID_OBS_CAMERA, tipo: 'obs_camera', rotulo: 'PC do estúdio (câmera)', camera_id: ID_CAMERA }],
    }
    for (const [nome, s] of SESSOES) {
      const r = await comoSessao(db, s, 'select * from public.meu_dispositivo()')
      if (nome === 'anon') expect(erro(r).message).toBe('permission denied for function meu_dispositivo')
      else expect([nome, linhas(r)]).toEqual([nome, esperado[nome] ?? []])
    }
    // A função não abre a tabela: o palco continua sem ler dispositivos (revisão do plano, I2).
    expect(await ids(palco, 'dispositivos')).toEqual([])
    // Sessão com o mesmo sub do palco, mas não anônima: nada.
    expect(linhas(await comoSessao(db, { ...palco, is_anonymous: false }, 'select * from public.meu_dispositivo()'))).toEqual([])
  })

  test('e3-meu-dispositivo-colunas', async () => {
    const r = await db.query<{ t: string }>(`select pg_get_function_result('public.meu_dispositivo()'::regprocedure) as t`)
    expect(r.rows[0].t).toBe('TABLE(id uuid, tipo tipo_dispositivo, rotulo text, camera_id uuid)')
    // A mesma lista que o adaptador da Tarefa 4 lê (COLUNAS_DE_MEU_DISPOSITIVO, Tarefa 1): um nome trocado de um lado cai aqui.
    const colunas = [...r.rows[0].t.matchAll(/(?:\(|, )(\w+) /g)].map((m) => m[1])
    expect(colunas).toEqual([...COLUNAS_DE_MEU_DISPOSITIVO])
  })

  // ----- episódio ativo e estado (D7) -----

  type CasoAtivo = { caso: string; quem: string; preparo: () => Promise<unknown>; esperado: (Record<string, string>)[] }
  const ATIVO: CasoAtivo[] = [
    { caso: 'sem nada', quem: 'ana', preparo: async () => undefined, esperado: [] },
    { caso: 'modo teste com rascunho', quem: 'ana', preparo: () => definirTeste(ID_EPISODIO), esperado: [{ id: ID_EPISODIO, modo: 'teste' }] },
    {
      caso: 'ao vivo e teste em outro', quem: 'ana',
      preparo: async () => {
        await db.query(`insert into public.episodios (id, titulo, estado) values ($1, 'Ao vivo', 'ao_vivo')`, [ID_AO_VIVO])
        await definirTeste(ID_EPISODIO)
      },
      esperado: [{ id: ID_AO_VIVO, modo: 'ao_vivo' }],
    },
    {
      caso: 'teste num encerrado', quem: 'ana',
      preparo: async () => {
        await db.query(`insert into public.episodios (id, titulo, estado) values ($1, 'Encerrado', 'encerrado')`, [ID_ENCERRADO])
        await definirTeste(ID_ENCERRADO)
      },
      esperado: [],
    },
    ...['estranho', 'solta', 'revogado'].map((quem) => ({ caso: `${quem} com modo teste`, quem, preparo: () => definirTeste(ID_EPISODIO), esperado: [] })),
    ...['bia', 'adm', 'camera', 'palco', 'obs_camera'].map((quem) => ({
      caso: `${quem} com modo teste`, quem, preparo: () => definirTeste(ID_EPISODIO), esperado: [{ id: ID_EPISODIO, modo: 'teste' }],
    })),
  ]
  test.each(ATIVO.map((c) => [c.caso, c] as const))('e3-episodio-ativo: %s', async (_caso, { quem, preparo, esperado }) => {
    await cadastrarSessoesExtras()
    await preparo()
    expect(linhas(await comoSessao(db, sessao(quem), 'select * from public.episodio_ativo()'))).toEqual(esperado)
  })

  test('e3-episodio-ativo: anon não executa', async () => {
    expect(erro(await comoSessao(db, null, 'select * from public.episodio_ativo()')).message).toBe('permission denied for function episodio_ativo')
  })

  const estadoDe = async (id: string) =>
    (await db.query<{ estado: string; gestos_ligados: boolean }>('select estado, gestos_ligados from public.episodios where id = $1', [id])).rows[0]
  const estudio = async () =>
    (await db.query<{ episodio_teste_id: string | null; atualizado_por: string | null }>('select episodio_teste_id, atualizado_por from public.estudio_estado')).rows[0]

  test('e3-iniciar-e-encerrar', async () => {
    const INICIA = 'select public.iniciar_ao_vivo($1)'
    const ENCERRA = 'select public.encerrar_ao_vivo($1)'
    await db.query(`insert into public.episodios (id, titulo) values ($1, 'Outro')`, [ID_OUTRO])
    await definirTeste(ID_OUTRO)
    linhas(await comoSessao(db, ana, INICIA, [ID_EPISODIO]))
    expect(await estadoDe(ID_EPISODIO)).toEqual({ estado: 'ao_vivo', gestos_ligados: false })
    expect(await estudio()).toEqual({ episodio_teste_id: null, atualizado_por: UID_ANA })
    expect(codigoDoErro(erro(await comoSessao(db, ana, INICIA, [ID_OUTRO])))).toBe('23505')
    expect(await estadoDe(ID_OUTRO)).toEqual({ estado: 'rascunho', gestos_ligados: false })
    expect(codigoDoErro(erro(await comoSessao(db, ana, ENCERRA, [ID_OUTRO])))).toBe('55000') // rascunho não encerra
    expect(codigoDoErro(erro(await comoSessao(db, bia, ENCERRA, [ID_EPISODIO])))).toBe('42501')
    await db.query('update public.episodios set gestos_ligados = true where id = $1', [ID_EPISODIO])
    linhas(await comoSessao(db, adm, ENCERRA, [ID_EPISODIO]))
    expect(await estadoDe(ID_EPISODIO)).toEqual({ estado: 'encerrado', gestos_ligados: false })
    expect((await estudio()).atualizado_por).toBe(UID_ADM)
    expect(codigoDoErro(erro(await comoSessao(db, ana, INICIA, [ID_EPISODIO])))).toBe('55000')
    expect(codigoDoErro(erro(await comoSessao(db, ana, ENCERRA, [ID_EPISODIO])))).toBe('55000')
    expect(codigoDoErro(erro(await comoSessao(db, bia, INICIA, [ID_OUTRO])))).toBe('42501')
    for (const s of [palco, camera]) expect(codigoDoErro(erro(await comoSessao(db, s, INICIA, [ID_OUTRO])))).toBe('42501')
    expect(erro(await comoSessao(db, null, INICIA, [ID_OUTRO])).message).toBe('permission denied for function iniciar_ao_vivo')
    expect(codigoDoErro(erro(await comoSessao(db, ana, INICIA, [ID_AO_VIVO])))).toBe('22023') // inexistente
    expect(codigoDoErro(erro(await comoSessao(db, ana, ENCERRA, [ID_AO_VIVO])))).toBe('22023')
    expect(await estadoDe(ID_OUTRO)).toEqual({ estado: 'rascunho', gestos_ligados: false })
    linhas(await comoSessao(db, ana, INICIA, [ID_OUTRO])) // controle: sem outro ao vivo, inicia
    expect((await estadoDe(ID_OUTRO)).estado).toBe('ao_vivo')
  })

  test('e3-modo-teste', async () => {
    const DEFINE = 'select public.definir_modo_teste($1)'
    linhas(await comoSessao(db, ana, DEFINE, [ID_EPISODIO]))
    expect(await estudio()).toEqual({ episodio_teste_id: ID_EPISODIO, atualizado_por: UID_ANA })
    await db.exec('savepoint com_ao_vivo')
    await db.query(`insert into public.episodios (id, titulo, estado) values ($1, 'Ao vivo', 'ao_vivo')`, [ID_AO_VIVO])
    for (const alvo of [ID_EPISODIO, null]) expect([alvo, codigoDoErro(erro(await comoSessao(db, ana, DEFINE, [alvo])))]).toEqual([alvo, '55000'])
    await db.exec('rollback to savepoint com_ao_vivo')
    await db.exec('release savepoint com_ao_vivo')
    await db.query(`insert into public.episodios (id, titulo, estado) values ($1, 'Encerrado', 'encerrado')`, [ID_ENCERRADO])
    expect(codigoDoErro(erro(await comoSessao(db, ana, DEFINE, [ID_ENCERRADO])))).toBe('55000') // só rascunho
    expect(codigoDoErro(erro(await comoSessao(db, ana, DEFINE, [ID_OUTRO])))).toBe('22023') // inexistente
    expect(codigoDoErro(erro(await comoSessao(db, bia, DEFINE, [null])))).toBe('42501')
    expect(await estudio()).toEqual({ episodio_teste_id: ID_EPISODIO, atualizado_por: UID_ANA })
    linhas(await comoSessao(db, adm, DEFINE, [null]))
    expect(await estudio()).toEqual({ episodio_teste_id: null, atualizado_por: UID_ADM })
  })

  test('e3-atualizado-em-nas-funcoes-de-estado', async () => {
    // As 3 funções de estado gravam atualizado_em = now(): um valor antigo forçado antes de cada chamada tem de avançar.
    const VELHO = '2000-01-01T00:00:00Z'
    const carimboNovo = async () =>
      (await db.query<{ ok: boolean }>('select atualizado_em = now() as ok from public.estudio_estado')).rows[0].ok
    const chamadas: [string, string, unknown[]][] = [
      ['definir_modo_teste', 'select public.definir_modo_teste($1)', [ID_EPISODIO]],
      ['iniciar_ao_vivo', 'select public.iniciar_ao_vivo($1)', [ID_EPISODIO]],
      ['encerrar_ao_vivo', 'select public.encerrar_ao_vivo($1)', [ID_EPISODIO]],
    ]
    for (const [nome, sql, params] of chamadas) {
      await db.query('update public.estudio_estado set atualizado_em = $1', [VELHO])
      expect([nome, await carimboNovo()]).toEqual([nome, false]) // controle
      linhas(await comoSessao(db, ana, sql, params))
      expect([nome, await carimboNovo()]).toEqual([nome, true])
    }
  })

  test('e3-estado-so-por-funcao', async () => {
    const r = (sql: string, params: unknown[] = []) => comoSessao(db, ana, sql, params)
    expect(erro(await r(`update public.episodios set estado = 'ao_vivo' where id = $1`, [ID_EPISODIO])).message).toBe(negado('episodios'))
    expect(erro(await r(`update public.episodios set gestos_ligados = true where id = $1`, [ID_EPISODIO])).message).toBe(negado('episodios'))
    expect(linhas(await r(`update public.episodios set titulo = 'Novo', data = '2026-12-01' where id = $1 returning titulo`, [ID_EPISODIO]))).toEqual([{ titulo: 'Novo' }])
    expect(erro(await r(`insert into public.episodios (titulo, estado) values ('x', 'ao_vivo')`)).message).toBe(negado('episodios'))
    expect(erro(await r(`insert into public.episodios (titulo, gestos_ligados) values ('x', true)`)).message).toBe(negado('episodios'))
    linhas(await r(`insert into public.episodios (titulo, data, criado_por) values ('y', '2026-12-02', $1)`, [UID_ANA]))
    expect(await estadoDe(ID_EPISODIO)).toEqual({ estado: 'rascunho', gestos_ligados: false })
    expect((await db.query(`select estado from public.episodios where titulo = 'y'`)).rows).toEqual([{ estado: 'rascunho' }])
    expect((await db.query(`select count(*)::int as n from public.episodios where titulo = 'x'`)).rows).toEqual([{ n: 0 }])
  })

  test('e3-exclui-so-rascunho', async () => {
    await db.query(`insert into public.episodios (id, titulo, estado) values ($1, 'Encerrado', 'encerrado'), ($2, 'Ao vivo', 'ao_vivo')`, [ID_ENCERRADO, ID_AO_VIVO])
    const APAGA = 'delete from public.episodios where id = $1 returning id'
    expect(linhas(await comoSessao(db, ana, APAGA, [ID_ENCERRADO]))).toEqual([])
    expect(linhas(await comoSessao(db, adm, APAGA, [ID_AO_VIVO]))).toEqual([])
    expect(linhas(await comoSessao(db, ana, APAGA, [ID_EPISODIO]))).toEqual([{ id: ID_EPISODIO }])
    expect((await db.query('select id from public.episodios order by id')).rows).toEqual([{ id: ID_AO_VIVO }, { id: ID_ENCERRADO }])
  })

  test('e3-episodio-do-teste-nao-se-apaga (VER-046, I3)', async () => {
    const APAGA = 'delete from public.episodios where id = $1 returning id'
    linhas(await comoSessao(db, ana, 'select public.definir_modo_teste($1)', [ID_EPISODIO]))
    // nem equipe nem admin apagam o rascunho que está no modo teste: o teste não muda por fora das funções (D7)
    expect(linhas(await comoSessao(db, ana, APAGA, [ID_EPISODIO]))).toEqual([])
    expect(linhas(await comoSessao(db, adm, APAGA, [ID_EPISODIO]))).toEqual([])
    expect(linhas(await comoSessao(db, ana, 'select modo from public.episodio_ativo()'))).toEqual([{ modo: 'teste' }])
    expect((await db.query('select episodio_teste_id from public.estudio_estado')).rows).toEqual([{ episodio_teste_id: ID_EPISODIO }])
    // controle: outro rascunho (fora do teste) continua apagável
    await db.query(`insert into public.episodios (id, titulo) values ($1, 'Outro rascunho')`, [ID_ENCERRADO])
    expect(linhas(await comoSessao(db, ana, APAGA, [ID_ENCERRADO]))).toEqual([{ id: ID_ENCERRADO }])
    // saindo do modo teste pela função, o rascunho volta a poder ser apagado
    linhas(await comoSessao(db, ana, 'select public.definir_modo_teste($1)', [null]))
    expect(linhas(await comoSessao(db, ana, APAGA, [ID_EPISODIO]))).toEqual([{ id: ID_EPISODIO }])
  })

  test('e3-episodio-do-teste-fk-restrict (VER-046, I3, rodada 1)', async () => {
    // A chave estrangeira recusa o delete do episódio do teste mesmo por fora da política (superusuário dos testes e
    // postgres_sim, o dono das migrações): fecha a corrida definir_modo_teste × delete por construção.
    await definirTeste(ID_EPISODIO)
    for (const papel of [null, 'postgres_sim'] as const) {
      await db.query('savepoint antes_do_delete')
      if (papel !== null) await db.query(`set local role ${papel}`)
      const r = await db.query('delete from public.episodios where id = $1', [ID_EPISODIO]).catch((e: unknown) => e)
      expect([papel, codigoDoErro(r as Error)]).toEqual([papel, '23503'])
      await db.query('rollback to savepoint antes_do_delete')
    }
    expect((await db.query('select episodio_teste_id from public.estudio_estado')).rows).toEqual([{ episodio_teste_id: ID_EPISODIO }])
    // controle: sem o teste, o mesmo delete do dono passa
    await definirTeste(null)
    await db.query('set local role postgres_sim')
    expect((await db.query('delete from public.episodios where id = $1 returning id', [ID_EPISODIO])).rows).toEqual([{ id: ID_EPISODIO }])
    await db.query('reset role')
  })

  test('e3-episodio-do-teste-dependencia-da-leitura (VER-046, rodada 1)', async () => {
    // A política de delete lê estudio_estado como quem apaga (estudio_estado_le). Sem essa leitura, a subconsulta é nula e
    // a política deixa de filtrar: o delete do episódio do teste falha fechado pela chave estrangeira (23503), nunca apaga.
    await definirTeste(ID_EPISODIO)
    await db.query('drop policy estudio_estado_le on public.estudio_estado')
    expect(linhas(await comoSessao(db, ana, 'select id from public.estudio_estado'))).toEqual([]) // a leitura foi negada
    const r = await comoSessao(db, ana, 'delete from public.episodios where id = $1 returning id', [ID_EPISODIO])
    expect(codigoDoErro(erro(r))).toBe('23503')
    expect((await db.query('select episodio_teste_id from public.estudio_estado')).rows).toEqual([{ episodio_teste_id: ID_EPISODIO }])
  })

  test('e3-estudio-estado-so-leitura', async () => {
    for (const s of [ana, adm]) {
      expect(erro(await comoSessao(db, s, 'update public.estudio_estado set episodio_teste_id = null')).message).toBe(negado('estudio_estado'))
    }
    expect(linhas(await comoSessao(db, bia, 'select id from public.estudio_estado'))).toEqual([{ id: 1 }]) // controle: todo membro lê
  })

  test('e3-funcoes-so-authenticated', async () => {
    // As 9 funções da E3: SECURITY DEFINER, search_path vazio e EXECUTE só para authenticated (o rpc:grants-check confere o
    // mesmo nas migrações; aqui, no banco dos testes).
    const r = await db.query<{ f: string; definer: boolean; config: string[]; anon: boolean; service: boolean; auth: boolean; publico: boolean }>(
      `select p.oid::regprocedure::text as f, p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('service_role', p.oid, 'EXECUTE') as service,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
              exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as publico
       from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('criar_codigo_pareamento', 'parear_dispositivo', 'meu_dispositivo', 'revogar_dispositivo', 'episodio_ativo',
                           'iniciar_ao_vivo', 'encerrar_ao_vivo', 'definir_modo_teste', 'pode_usar_canal')
       order by 1`,
    )
    expect(r.rows.map((l) => l.f)).toEqual([
      'criar_codigo_pareamento(tipo_dispositivo,text,uuid,uuid)', 'definir_modo_teste(uuid)', 'encerrar_ao_vivo(uuid)', 'episodio_ativo()',
      'iniciar_ao_vivo(uuid)', 'meu_dispositivo()', 'parear_dispositivo(text,tipo_dispositivo)', 'pode_usar_canal(text,text,boolean)',
      'revogar_dispositivo(uuid)',
    ])
    for (const l of r.rows) {
      expect([l.f, l.definer, l.config, l.anon, l.service, l.auth, l.publico]).toEqual([l.f, true, ['search_path=""'], false, false, true, false])
    }
  })

  // ----- canais (D6) -----

  type Combinacao = 'rb' | 'rp' | 'eb' | 'ep' | 'es'
  const COMBINACOES: [Combinacao, ExtensaoDoCanal, 'receber' | 'enviar'][] = [
    ['rb', 'broadcast', 'receber'], ['rp', 'presence', 'receber'],
    ['eb', 'broadcast', 'enviar'], ['ep', 'presence', 'enviar'], ['es', 'persistence', 'enviar'],
  ]
  const TOPICOS = (ativo: string, outro: string): [string, string][] => [
    ['estudio', 'estudio'], ['controle', `episodio:${ativo}:controle`], ['outro', `episodio:${outro}:controle`],
    ['video', `episodio:${ativo}:video`], ['x', 'x'],
  ]
  /** O que cada sessão pode, por tópico (rb/rp receber broadcast/presence; eb/ep/es enviar broadcast/presence/persistence). */
  async function permissoesNoCanal(quem: Claims | null): Promise<Record<string, string>> {
    const r: Record<string, string> = {}
    for (const [nome, topico] of TOPICOS(ID_EPISODIO, ID_OUTRO)) {
      const pode: string[] = []
      for (const [sigla, ext, op] of COMBINACOES) if (await comoCanal(db, quem, topico, ext, op)) pode.push(sigla)
      r[nome] = pode.join(' ')
    }
    return r
  }
  const NADA = { estudio: '', controle: '', outro: '', video: '', x: '' }
  /** A matriz da D6: uma linha por sessão; persistence nunca; outro episódio, :video e qualquer outro tópico, nunca. */
  const MATRIZ_DO_CANAL: [string, Record<string, string>][] = [
    ['anon', NADA],
    ['ana', { ...NADA, estudio: 'rb rp eb ep', controle: 'rb rp eb ep' }],
    ['bia', { ...NADA, estudio: 'rb rp ep', controle: 'rb rp eb ep' }],
    ['adm', { ...NADA, estudio: 'rb rp eb ep', controle: 'rb rp eb ep' }],
    ['estranho', NADA],
    ['camera', { ...NADA, estudio: 'rb rp ep' }],
    ['palco', { ...NADA, estudio: 'rb rp ep', controle: 'rb rp eb' }],
    ['obs_camera', { ...NADA, estudio: 'rb rp ep' }],
    ['solta', NADA],
    ['revogado', NADA],
  ]
  test.each(MATRIZ_DO_CANAL)('e3-canal-matriz: %s', async (nome, esperado) => {
    await cadastrarSessoesExtras()
    await db.query(`insert into public.episodios (id, titulo) values ($1, 'Outro')`, [ID_OUTRO])
    await definirTeste(ID_EPISODIO)
    expect(await permissoesNoCanal(sessao(nome))).toEqual(esperado)
  })

  test('e3-canal-segue-o-episodio-ativo', async () => {
    const CONTROLE = `episodio:${ID_EPISODIO}:controle`
    linhas(await comoSessao(db, ana, 'select public.definir_modo_teste($1)', [ID_EPISODIO]))
    expect(await comoCanal(db, ana, CONTROLE, 'broadcast', 'receber')).toBe(true)
    expect(await comoCanal(db, palco, CONTROLE, 'broadcast', 'enviar')).toBe(true)
    linhas(await comoSessao(db, ana, 'select public.definir_modo_teste($1)', [null]))
    for (const [ext, op] of [['broadcast', 'receber'], ['presence', 'receber'], ['broadcast', 'enviar'], ['presence', 'enviar']] as const) {
      expect([ext, op, await comoCanal(db, ana, CONTROLE, ext, op), await comoCanal(db, palco, CONTROLE, ext, 'receber')]).toEqual([ext, op, false, false])
    }
    // Ao vivo: o tópico passa a ser o do episódio ao vivo.
    linhas(await comoSessao(db, ana, 'select public.iniciar_ao_vivo($1)', [ID_EPISODIO]))
    expect(await comoCanal(db, bia, CONTROLE, 'broadcast', 'enviar')).toBe(true)
    linhas(await comoSessao(db, ana, 'select public.encerrar_ao_vivo($1)', [ID_EPISODIO]))
    expect(await comoCanal(db, bia, CONTROLE, 'broadcast', 'enviar')).toBe(false)
    expect(await comoCanal(db, bia, 'estudio', 'broadcast', 'receber')).toBe(true) // estudio não depende do episódio
  })

  test('e3-revogado-sem-canal', async () => {
    await definirTeste(ID_EPISODIO)
    const CONTROLE = `episodio:${ID_EPISODIO}:controle`
    expect(await comoCanal(db, palco, 'estudio', 'broadcast', 'receber')).toBe(true) // controle
    expect(await comoCanal(db, palco, CONTROLE, 'broadcast', 'enviar')).toBe(true) // controle
    linhas(await comoSessao(db, ana, 'select public.revogar_dispositivo($1)', [ID_PALCO]))
    for (const topico of ['estudio', CONTROLE]) {
      for (const [, ext, op] of COMBINACOES) expect([topico, ext, op, await comoCanal(db, palco, topico, ext, op)]).toEqual([topico, ext, op, false])
    }
  })

  test('e3-politicas-do-canal', async () => {
    // search_path vazio só nesta consulta (set_config local, desfeito no rollback): o texto sai qualificado, como o
    // data-api:check o lê (POLITICAS_DO_CANAL).
    await db.query(`select set_config('search_path', '', true)`)
    const r = await db.query(
      `select policyname, permissive, roles::text[] as roles, cmd, qual, with_check from pg_policies
       where schemaname = 'realtime' and tablename = 'messages' order by policyname collate "C"`,
    )
    expect(r.rows).toEqual([
      { policyname: 'canal_envia', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'INSERT', qual: null, with_check: 'public.pode_usar_canal(realtime.topic(), extension, true)' },
      { policyname: 'canal_recebe', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'SELECT', qual: 'public.pode_usar_canal(realtime.topic(), extension, false)', with_check: null },
    ])
  })
})
