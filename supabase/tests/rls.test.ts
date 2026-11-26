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
  comoSessao,
  criarBanco,
  membroGoogle,
  semearDados,
  sessaoAnonima,
  TEMPO_LIMITE_HOOK_MS,
} from './banco'

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

/**
 * Privilégios de tabela que a migração dá a authenticated (Correção 13): só as operações que alguma política
 * permite (DES-001 §8). anon e service_role não recebem nenhum; codigos_pareamento, nada. Desde 2026-10-30 o Supabase não dá
 * mais select/insert/update/delete automáticos em tabelas novas (simulacao-supabase.sql), então sem esses
 * GRANT nenhum acesso funciona; e onde o privilégio falta, o Postgres recusa antes da RLS ("permission denied").
 */
const PRIVILEGIOS_AUTHENTICATED: Record<string, string[]> = {
  avisos: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  cenas: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  codigos_pareamento: [],
  dispositivos: ['SELECT'],
  episodios: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  estudio_estado: ['SELECT', 'UPDATE'],
  mapa_gestos: ['SELECT', 'UPDATE'],
  membros: ['SELECT'],
  membros_permitidos: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  midias: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  registro_acoes: ['INSERT', 'SELECT'],
  sons: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
}
/** A sessão (null = anon) tem o privilégio de tabela? */
const temPrivilegio = (sessao: Claims | null, tabela: string, operacao: string) =>
  sessao !== null && PRIVILEGIOS_AUTHENTICATED[tabela].includes(operacao.toUpperCase())

/**
 * Onde a sessão não tem o privilégio, confere o "permission denied" e depois dá, como superusuário, os
 * privilégios que faltam ao papel do Postgres da sessão, roda `comRls` (a RLS tem de negar sozinha: defesa em
 * profundidade) e os revoga de novo. Com o privilégio, só roda `comRls`.
 */
async function semPrivilegioERls(sessao: Claims | null, tabela: string, operacao: string, sql: string, params: unknown[], rotulo: string, comRls: () => Promise<void>): Promise<void> {
  if (temPrivilegio(sessao, tabela, operacao)) return comRls()
  expect(erro(await comoSessao(db, sessao, sql, params)).message, rotulo).toBe(negado(tabela))
  const papelPg = sessao === null ? 'anon' : 'authenticated'
  const faltam = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].filter((p) => !temPrivilegio(sessao, tabela, p)).join(', ')
  await db.query(`grant ${faltam} on public.${tabela} to ${papelPg}`)
  try {
    await comRls()
  } finally {
    await db.query(`revoke ${faltam} on public.${tabela} from ${papelPg}`)
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
    expect(linhas(await comoSessao(db, adm, 'update public.estudio_estado set episodio_teste_id = $1 where id = 1 returning episodio_teste_id', [ID_EPISODIO]))).toEqual([{ episodio_teste_id: ID_EPISODIO }])
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
    expect(linhas(await comoSessao(db, bia, alteraEstudio, [ID_EPISODIO]))).toEqual([])
    expect([await contar('avisos'), await contar('episodios'), await contar('cenas')]).toEqual([1, 1, 1])
    // Controles: a equipe faz os mesmos comandos.
    expect(linhas(await comoSessao(db, ana, alteraEstudio, [ID_EPISODIO]))).toEqual([{ episodio_teste_id: ID_EPISODIO }])
    expect(linhas(await comoSessao(db, ana, apagaAviso, [ID_AVISO]))).toEqual([{ id: ID_AVISO }])
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
    // Nenhum privilégio de coluna (um GRANT por coluna escaparia da lista acima).
    const colunas = await db.query(
      `select c.relname, a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and a.attacl is not null`,
    )
    expect(colunas.rows).toEqual([])
    // A migração não cria sequências (chaves uuid e estudio_estado.id fixo): o revoke de sequências vale para as futuras.
    const seqs = await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'S'`)
    expect(seqs.rows).toEqual([])
    // Controle: as 12 tabelas existem e cada uma tem ACL (o resultado acima não veio de relacl nulo).
    const acls = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relacl is not null`,
    )
    expect(acls.rows[0].n).toBe(12)
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
      'estudio_estado', 'dispositivos', 'codigos_pareamento', 'registro_acoes']
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
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect(await tem(papelPg, 'codigos_pareamento', priv), `${papelPg} codigos_pareamento ${priv}`).toBe(false)
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
    // Controle: há as 12 tabelas e as 3 funções em public (a lista acima não veio de um schema vazio).
    const n = await db.query<{ n: number }>(
      `select (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r')
            + (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public') as n`,
    )
    expect(Number(n.rows[0].n)).toBe(12 + 3)
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
