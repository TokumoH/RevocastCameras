// Banco de testes: PGlite (Postgres em WASM) com a simulação do Supabase e todas as migrações, em ordem.
// Uso por arquivo de teste: criarBanco() e semearDados() no beforeAll, db.close() no afterAll e
// cada teste dentro de uma transação (begin no beforeEach, rollback no afterEach).
import { PGlite } from '@electric-sql/pglite'
import simulacao from './simulacao-supabase.sql?raw'
import donoMigracao from './dono-migracao.sql?raw'

// Todas as migrações, em ordem de nome (o prefixo AAAAMMDDHHMMSS é a ordem de aplicação, como na Supabase CLI).
const MIGRACOES: { arquivo: string; sql: string }[] = Object.entries(
  import.meta.glob('../migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
)
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([caminho, sql]) => ({ arquivo: caminho.slice(caminho.lastIndexOf('/') + 1), sql }))

/** Claims do JWT de uma sessão do Supabase (só os campos que a migração lê). */
export type Claims = {
  sub: string
  role: 'authenticated'
  email?: string
  is_anonymous: boolean
  app_metadata: { provider?: string }
  /** Editável pelo próprio usuário no Supabase; a migração não pode confiar nele. */
  user_metadata?: Record<string, unknown>
}

// E-mails de teste: só no domínio revocast.test (o TLD .test é reservado para testes pela RFC 2606).
export const EMAIL_ANA = 'ana@revocast.test'
export const EMAIL_BIA = 'bia@revocast.test'
export const EMAIL_ADM = 'adm@revocast.test'
export const EMAIL_ESTRANHO = 'estranho@revocast.test'

// uid das pessoas (auth.users.id).
export const UID_ANA = '00000000-0000-4000-8000-00000000a001'
export const UID_BIA = '00000000-0000-4000-8000-00000000a002'
export const UID_ADM = '00000000-0000-4000-8000-00000000a003'
export const UID_ESTRANHO = '00000000-0000-4000-8000-00000000a004'

// uid das sessões anônimas de cada dispositivo.
export const UID_SESSAO_CAMERA = '00000000-0000-4000-8000-00000000b001'
export const UID_SESSAO_PALCO = '00000000-0000-4000-8000-00000000b002'
export const UID_SESSAO_OBS_CAMERA = '00000000-0000-4000-8000-00000000b003'

// ids dos dados semeados.
export const ID_CENA = '00000000-0000-4000-8000-00000000c001'
export const ID_EPISODIO = '00000000-0000-4000-8000-00000000c002'
export const ID_AVISO = '00000000-0000-4000-8000-00000000c003'
export const ID_CAMERA = '00000000-0000-4000-8000-00000000d001'
export const ID_PALCO = '00000000-0000-4000-8000-00000000d002'
export const ID_OBS_CAMERA = '00000000-0000-4000-8000-00000000d003'

/**
 * Cria o banco em memória e aplica a simulação do Supabase e o dono das migrações (como superusuário) e as
 * migrações (todas, em ordem de nome) como postgres_sim, sem superusuário nem BYPASSRLS (ver dono-migracao.sql). Assim uma regressão que
 * só aparece com dono comum (por exemplo, FORCE ROW LEVEL SECURITY em dispositivos) quebra os testes. Depois o
 * banco volta ao superusuário, que os testes usam para semear e tirar retratos.
 */
export async function criarBanco(opcoes: { exporTabelasNovas?: boolean; aplicarMigracao?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(simulacao)
  await db.exec(donoMigracao)
  if (opcoes.exporTabelasNovas) await db.exec(EXPOR_TABELAS_NOVAS)
  if (opcoes.aplicarMigracao === false) return db
  await db.exec('set role postgres_sim')
  try {
    for (const { sql } of MIGRACOES) await db.exec(sql)
  } finally {
    await db.exec('reset role')
  }
  return db
}

/**
 * Variante da simulação com a opção "Automatically expose new tables" da Data API ligada (ou um projeto que
 * manteve o padrão anterior a 2026-10-30): tabelas e sequências novas do dono das migrações recebem "grant all"
 * para os três papéis da Data API. A migração tem de deixar o mesmo catálogo de privilégios nas duas variantes.
 */
export const EXPOR_TABELAS_NOVAS = `
alter default privileges for role postgres_sim in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres_sim in schema public grant all on sequences to anon, authenticated, service_role;
`

/**
 * Tempo limite dos beforeAll/afterAll dos arquivos de teste (terceiro argumento), em ms. O beforeAll cria o
 * PGlite, aplica a simulação e a migração e semeia: leva de 1,4 a 6 s com a máquina leve, mas passou dos 10 s
 * padrão do Vitest com a máquina carregada (load 12,5: 0/493, "Hook timed out in 10000ms"; Correção 16 da
 * Tarefa 3). O limite fica aqui, e não no vite.config.ts, para não mudar a configuração global do Vitest.
 * O teste mesmo-catalogo-com-tabelas-expostas, que cria 3 bancos a mais, usa o dobro.
 */
export const TEMPO_LIMITE_HOOK_MS = 120_000

/** Papel que aplica a migração nos testes (o dono das tabelas e das funções). */
export const DONO_MIGRACAO = 'postgres_sim'

/** Claims de uma sessão Google não anônima. */
export function membroGoogle(email: string, uid: string): Claims {
  return { sub: uid, role: 'authenticated', email, is_anonymous: false, app_metadata: { provider: 'google' } }
}

/** Claims de uma sessão anônima (dispositivo). */
export function sessaoAnonima(uid: string): Claims {
  return { sub: uid, role: 'authenticated', is_anonymous: true, app_metadata: {} }
}

export type Cadastro = {
  uid: string
  email: string | null
  anonimo: boolean
  provedor: string | null
  confirmado: boolean
  metadados?: Record<string, unknown>
}

/**
 * Insere em auth.users como o papel supabase_auth_admin da simulação (como o Auth do Supabase), o que
 * dispara o gatilho criar_perfil_membro sem privilégio próprio em public.
 */
export async function cadastrarUsuario(db: PGlite, c: Cadastro): Promise<void> {
  await db.exec('set role supabase_auth_admin')
  try {
    await inserirUsuario(db, c)
  } finally {
    // Numa transação já abortada pelo erro, o reset falha, mas o rollback do teste desfaz o set role.
    await db.exec('reset role').catch(() => undefined)
  }
}

async function inserirUsuario(db: PGlite, c: Cadastro): Promise<void> {
  await db.query(
    `insert into auth.users (id, email, is_anonymous, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
     values ($1, $2, $3, case when $4::boolean then now() end, $5::jsonb, $6::jsonb)`,
    [
      c.uid,
      c.email,
      c.anonimo,
      c.confirmado,
      JSON.stringify(c.provedor ? { provider: c.provedor } : {}),
      JSON.stringify(c.metadados ?? {}),
    ],
  )
}

/** Dados de base de todos os testes, inseridos como superusuário, exceto auth.users (ver cadastrarUsuario); a migração não insere membros. */
export async function semearDados(db: PGlite): Promise<void> {
  await db.query(
    `insert into public.membros_permitidos (email, papel) values ($1, 'equipe'), ($2, 'apresentadora'), ($3, 'admin')`,
    [EMAIL_ANA, EMAIL_BIA, EMAIL_ADM],
  )
  // Perfis em membros criados pelo gatilho.
  const pessoas: [string, string, string][] = [
    [UID_ANA, EMAIL_ANA, 'Ana'],
    [UID_BIA, EMAIL_BIA, 'Bia'],
    [UID_ADM, EMAIL_ADM, 'Adm'],
  ]
  for (const [uid, email, nome] of pessoas) {
    await cadastrarUsuario(db, { uid, email, anonimo: false, provedor: 'google', confirmado: true, metadados: { full_name: nome } })
  }
  for (const uid of [UID_SESSAO_CAMERA, UID_SESSAO_PALCO, UID_SESSAO_OBS_CAMERA]) {
    await cadastrarUsuario(db, { uid, email: null, anonimo: true, provedor: null, confirmado: false })
  }
  await db.query(`insert into public.cenas (id, nome_exibicao, nome_obs) values ($1, 'Abertura', 'Cena Abertura')`, [ID_CENA])
  await db.query(
    `insert into public.episodios (id, titulo, estado, criado_por) values ($1, 'Episódio de teste', 'rascunho', $2)`,
    [ID_EPISODIO, UID_ANA],
  )
  await db.query(`insert into public.avisos (id, episodio_id, titulo, texto) values ($1, $2, 'Aviso', 'Texto do aviso')`, [
    ID_AVISO,
    ID_EPISODIO,
  ])
  await db.query(
    `insert into public.dispositivos (id, tipo, rotulo, reconhecer_no, camera_id, usuario_anonimo_id, pareado_em) values
       ($1, 'camera', 'Celular de gravação', 'celular', null, $2, now()),
       ($3, 'obs_palco', 'PC do estúdio (palco)', null, null, $4, now()),
       ($5, 'obs_camera', 'PC do estúdio (câmera)', null, $1, $6, now())`,
    [ID_CAMERA, UID_SESSAO_CAMERA, ID_PALCO, UID_SESSAO_PALCO, ID_OBS_CAMERA, UID_SESSAO_OBS_CAMERA],
  )
}

/**
 * Roda `sql` como a sessão dada: `null` = papel anon sem claims; com claims = papel authenticated.
 * Usa um savepoint para que uma recusa esperada não aborte a transação do teste; devolve as linhas
 * ou o erro. Termina sempre com `reset role` (o chamador volta a ser superusuário).
 */
export async function comoSessao<T>(
  db: PGlite,
  claims: Claims | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[] | Error> {
  await db.exec('savepoint sessao')
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims ? JSON.stringify(claims) : ''])
    await db.exec(claims ? 'set local role authenticated' : 'set local role anon')
    const r = await db.query<T>(sql, params)
    await db.exec('release savepoint sessao')
    return r.rows
  } catch (e) {
    await db.exec('rollback to savepoint sessao')
    await db.exec('release savepoint sessao')
    return e instanceof Error ? e : new Error(String(e))
  } finally {
    await db.exec('reset role')
    // Zera as claims: o superusuário não depende delas, mas assim nenhuma sessão vaza para o comando seguinte.
    await db.query(`select set_config('request.jwt.claims', '', true)`)
  }
}
