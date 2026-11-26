// Matriz de permissões papel × tabela × operação, derivada do DES-001 §8 (tabela "Segurança": linhas
// "Login", "Modelo de autorização", "Banco", "Dispositivo camera", "Dispositivo obs_camera", "Dispositivo
// obs_palco", "Membros") e §7 (membros criados pelo gatilho; dispositivos escritos só por funções da E3;
// registro_acoes só inserção). Decisão de leitura da spec (controlador, Correção 8 da Tarefa 3; registrada
// em supabase/migrations/README.md e no VER-010; o responsável pode reverter): em mapa_gestos e
// estudio_estado, "equipe/admin escrevem" (§8) é lido como update, sem insert nem delete, porque os 7
// gestos são a chave fixa já semeada (§7) e estudio_estado tem uma linha só (§7). codigos_pareamento fica
// fora: sem política e com revoke all, é conferida em rls.test.ts (permission denied e has_table_privilege).
//
// Cada célula vira um teste (9 papéis × 11 tabelas × 4 operações = 396). Permitido, com alcance total:
// select lê todas as linhas (contadas como superusuário), fora os recortes que a spec prevê (RECORTES:
// câmera e obs_camera em dispositivos, conferidos linha a linha); insert de uma linha válida é aceito;
// update sem where altera toda linha; delete sem where esvazia a tabela. Assim uma política que prenda
// equipe/admin às "próprias linhas" (criado_por = auth.uid()) é pega. Proibido: select lê 0 linhas; insert da mesma linha válida sai com violação
// de RLS; update/delete sem where não muda o retrato (e não dá erro).
// - Exceção ao alcance total (PROPRIA_LINHA_INTOCADA): DES-001 §8 diz que o admin lê e escreve
//   membros_permitidos; a decisão D1 do PLA-002 (controlador; migração membros_sem_autoalteracao) acrescenta que
//   nenhum admin altera nem remove a própria linha. Nas células membros_permitidos × adm × update e × delete, o
//   permitido é "toda linha muda (update) ou some (delete), exceto a linha do e-mail da sessão, que fica idêntica".
// - Privilégio de tabela (Correção 13): desde 2026-10-30 o Supabase não dá mais privilégios automáticos de
//   leitura e escrita em tabelas novas (simulacao-supabase.sql), e a migração dá a authenticated só as
//   operações que algum papel da matriz tem (temPrivilegio, derivado da própria MATRIZ); anon não tem nenhuma.
//   Onde o papel do Postgres da sessão não tem o privilégio, a célula proibida espera primeiro "permission
//   denied for table" (um GRANT a mais, mesmo sem política, derruba a célula); depois o superusuário dá os 4
//   privilégios na transação do teste (desfeitos no rollback) e a célula confere o comportamento da RLS acima,
//   como nas demais: a RLS continua testada atrás do privilégio (defesa em profundidade).
// - As linhas de insert são válidas (sem conflito de chave nem check), então só a RLS pode recusá-las. Em
//   mapa_gestos e estudio_estado, onde toda linha possível já existe (7 gestos; id = 1), o superusuário
//   apaga antes uma linha na transação do teste, para que o insert dela seja válido.
// - Formas de linha: uma política indevida filtrada pela forma da linha (por exemplo, "a sessão insere um
//   dispositivo ligado a si mesma" ou "o membro registra ação em nome próprio") só aparece se o teste usar
//   essa forma. Por isso, nas colunas de vínculo com a sessão (usuario_anonimo_id, membro_id, dispositivo_id,
//   criado_por, enviado_por, atualizado_por, membros.id):
//   - cada tabela tem uma forma de insert por coluna, com a própria sessão (auth.uid(), o membro ou o
//     dispositivo da sessão; quando a sessão não tem membro ou dispositivo, um valor válido declarado). A
//     RLS é conferida antes das restrições e das chaves estrangeiras, então sem política o erro continua
//     sendo o de RLS; com uma política indevida, o insert é aceito ou dá outro erro, e o teste falha;
//   - antes de select, update e delete, o superusuário cria (ou marca) uma linha "da própria sessão"
//     (PROPRIAS), e os dados extras do beforeAll têm, em cada uma dessas colunas, ao menos uma linha nula
//     (por exemplo, um dispositivo sem sessão) e uma de outra sessão.
//   Limite: não cobre política filtrada por outros valores (por exemplo, a equipe inserir só papel
//   'apresentadora' na lista).
// - Formas de valor: pelo mesmo motivo, os dados extras têm os valores que uma política filtrada por valor
//   usaria em select, update e delete: episódio rascunho, ao vivo e encerrado; modo teste ligado; ação com
//   teste = true; dispositivo revogado; aviso com e sem link e imagem; gestos de cena e de som. Assim,
//   por exemplo, "a câmera lê episódio encerrado" ou "a apresentadora apaga episódio encerrado" é pego.
// - O update atribui constantes que diferem do valor de toda linha (o teste "o update de X muda toda linha"
//   confere, com as linhas próprias de cada papel), para que qualquer linha alterada indevidamente mude o
//   retrato. Atribui constantes, sem ler coluna: se lesse (set x = x || ...), o Postgres aplicaria
//   também a política de select, e uma política de update indevida para um papel que não lê a tabela
//   afetaria 0 linhas sem ser notada. Com a constante, só a política de update decide.
// - Antes de um delete, registro_acoes é esvaziada (superusuário), para que a chave estrangeira
//   registro_acoes → dispositivos não recuse no lugar da RLS; antes do delete de cenas, sons e midias, os
//   gestos de cena e de som voltam a 'nenhuma' (mapa_gestos → cenas/sons não tem ação de delete).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  type Claims,
  EMAIL_ADM,
  EMAIL_ANA,
  EMAIL_BIA,
  EMAIL_ESTRANHO,
  ID_CENA,
  ID_CAMERA,
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

const UID_SOLTA = '00000000-0000-4000-8000-00000000b010'
const ID_MIDIA_SEM_SOM = '00000000-0000-4000-8000-00000000f001'
const ID_AO_VIVO = '00000000-0000-4000-8000-00000000f002'
const ID_ENCERRADO = '00000000-0000-4000-8000-00000000f003'
const ID_REVOGADO = '00000000-0000-4000-8000-00000000f004'
const ID_IMAGEM_ADM = '00000000-0000-4000-8000-00000000f005'
const ID_CENA_UPDATE = '00000000-0000-4000-8000-00000000f006'
const ID_SOM_APLAUSO = '00000000-0000-4000-8000-00000000f007'

/**
 * Recortes de leitura que a spec prevê para uma célula permitida (DES-001 §8): a câmera lê só o próprio
 * registro em dispositivos; o obs_camera lê o próprio e o da câmera indicada. Fora deles, o permitido lê
 * todas as linhas da tabela.
 */
const RECORTES: Partial<Record<string, Partial<Record<Papel, string[]>>>> = {
  dispositivos: { camera: [ID_CAMERA], obs_camera: [ID_CAMERA, ID_OBS_CAMERA] },
}

/**
 * Linha que o permitido não alcança no update e no delete sem where (coluna email = valor), por tabela e papel.
 * DES-001 §8 ("admin lê e escreve membros_permitidos") com a regra da decisão D1 do PLA-002, decidida pelo
 * controlador: nenhum admin altera nem remove a própria linha da lista. A célula continua pegando uma política que
 * prenda o admin às "próprias linhas" (criado_por = auth.uid()), porque todas as demais linhas, inclusive as de
 * criado_por = adm, têm de mudar (update) ou sumir (delete). Só o update e o delete; select e insert seguem o
 * alcance total.
 */
const PROPRIA_LINHA_INTOCADA: Partial<Record<string, Partial<Record<Papel, string>>>> = {
  membros_permitidos: { adm: EMAIL_ADM },
}

const PAPEIS = {
  adm: membroGoogle(EMAIL_ADM, UID_ADM),
  equipe: membroGoogle(EMAIL_ANA, UID_ANA),
  apresentadora: membroGoogle(EMAIL_BIA, UID_BIA),
  estranho: membroGoogle(EMAIL_ESTRANHO, UID_ESTRANHO),
  palco: sessaoAnonima(UID_SESSAO_PALCO),
  camera: sessaoAnonima(UID_SESSAO_CAMERA),
  obs_camera: sessaoAnonima(UID_SESSAO_OBS_CAMERA),
  solta: sessaoAnonima(UID_SOLTA), // sessão anônima não pareada a nenhum dispositivo
  anon: null, // papel anon do Postgres, sem claims
} satisfies Record<string, Claims | null>
type Papel = keyof typeof PAPEIS
const TODOS = Object.keys(PAPEIS) as Papel[]
const MEMBROS: Papel[] = ['adm', 'equipe', 'apresentadora']
const EQUIPE: Papel[] = ['adm', 'equipe']

/** Membro (em membros) e dispositivo de cada sessão, para as formas de linha "da própria sessão". */
const MEMBRO_DE: Partial<Record<Papel, string>> = { adm: UID_ADM, equipe: UID_ANA, apresentadora: UID_BIA, estranho: UID_ESTRANHO }
const DISPOSITIVO_DE: Partial<Record<Papel, string>> = { palco: ID_PALCO, camera: ID_CAMERA, obs_camera: ID_OBS_CAMERA }

type Operacao = 'select' | 'insert' | 'update' | 'delete'
type Regra = { permitidos: Papel[] }

/** A matriz (DES-001 §8). Papel fora de `permitidos` = proibido. */
const MATRIZ: Record<string, Record<Operacao, Regra>> = {
  membros_permitidos: { select: { permitidos: ['adm'] }, insert: { permitidos: ['adm'] }, update: { permitidos: ['adm'] }, delete: { permitidos: ['adm'] } },
  membros: { select: { permitidos: EQUIPE }, insert: { permitidos: [] }, update: { permitidos: [] }, delete: { permitidos: [] } },
  midias: { select: { permitidos: [...MEMBROS, 'palco'] }, insert: { permitidos: EQUIPE }, update: { permitidos: EQUIPE }, delete: { permitidos: EQUIPE } },
  sons: { select: { permitidos: [...MEMBROS, 'palco'] }, insert: { permitidos: EQUIPE }, update: { permitidos: EQUIPE }, delete: { permitidos: EQUIPE } },
  cenas: { select: { permitidos: [...MEMBROS, 'palco'] }, insert: { permitidos: EQUIPE }, update: { permitidos: EQUIPE }, delete: { permitidos: EQUIPE } },
  episodios: { select: { permitidos: [...MEMBROS, 'palco'] }, insert: { permitidos: EQUIPE }, update: { permitidos: EQUIPE }, delete: { permitidos: EQUIPE } },
  avisos: { select: { permitidos: [...MEMBROS, 'palco'] }, insert: { permitidos: EQUIPE }, update: { permitidos: EQUIPE }, delete: { permitidos: EQUIPE } },
  mapa_gestos: { select: { permitidos: [...MEMBROS, 'palco'] }, insert: { permitidos: [] }, update: { permitidos: EQUIPE }, delete: { permitidos: [] } },
  estudio_estado: { select: { permitidos: MEMBROS }, insert: { permitidos: [] }, update: { permitidos: EQUIPE }, delete: { permitidos: [] } },
  dispositivos: { select: { permitidos: [...EQUIPE, 'camera', 'obs_camera'] }, insert: { permitidos: [] }, update: { permitidos: [] }, delete: { permitidos: [] } },
  registro_acoes: { select: { permitidos: MEMBROS }, insert: { permitidos: ['palco'] }, update: { permitidos: [] }, delete: { permitidos: [] } },
}

/**
 * Por tabela:
 * - `inserts`: formas de linha válidas para insert, por papel (ver "Formas de linha" no topo);
 * - `preparo`: rodado antes do insert como superusuário, quando toda linha possível já existe;
 * - `proprias`: SQL de superusuário que dá ao papel uma linha "sua" antes de select, update e delete;
 * - `update`: update sem where que atribui constantes diferentes do valor de toda linha.
 */
type Forma = (papel: Papel) => [string, unknown[]]
type Comandos = { inserts: Forma[]; preparo?: string; proprias?: (papel: Papel) => string | null; update: string }
const fixa = (sql: string, params: unknown[] = []): Forma => () => [sql, params]
const membroDe = (papel: Papel, sql: (uid: string) => string) => (MEMBRO_DE[papel] ? sql(MEMBRO_DE[papel]!) : null)
const COMANDOS: Record<string, Comandos> = {
  membros_permitidos: {
    inserts: [fixa(`insert into public.membros_permitidos (email, papel, criado_por) values ('matriz@revocast.test', 'equipe', auth.uid())`)],
    proprias: (p) => membroDe(p, (u) => `insert into public.membros_permitidos (email, papel, criado_por) values ('convite-matriz@revocast.test', 'equipe', '${u}')`),
    update: `update public.membros_permitidos set papel = 'admin', criado_por = '${UID_ADM}'`,
  },
  membros: {
    // O membro já tem a própria linha (gatilho); a sessão sem membro tenta criar a sua.
    inserts: [fixa(`insert into public.membros (id, email, nome) values (auth.uid(), 'matriz-membro@revocast.test', 'Matriz')`)],
    update: `update public.membros set nome = 'matriz'`,
  },
  midias: {
    inserts: [fixa(`insert into public.midias (tipo, nome, caminho, mime, tamanho_bytes, enviado_por) values ('imagem', 'm', 'imagens/matriz.png', 'image/png', 1, auth.uid())`)],
    proprias: (p) => membroDe(p, (u) => `insert into public.midias (tipo, nome, caminho, mime, tamanho_bytes, enviado_por) values ('imagem', 'p', 'imagens/propria.png', 'image/png', 1, '${u}')`),
    update: `update public.midias set nome = 'matriz'`,
  },
  sons: { inserts: [fixa(`insert into public.sons (midia_id, rotulo) values ($1, 'matriz')`, [ID_MIDIA_SEM_SOM])], update: `update public.sons set rotulo = 'matriz'` },
  cenas: { inserts: [fixa(`insert into public.cenas (nome_exibicao, nome_obs) values ('Matriz', 'Cena Matriz')`)], update: `update public.cenas set nome_exibicao = 'matriz'` },
  episodios: {
    inserts: [fixa(`insert into public.episodios (titulo, criado_por) values ('Matriz', auth.uid())`)],
    proprias: (p) => membroDe(p, (u) => `insert into public.episodios (titulo, criado_por) values ('Próprio', '${u}')`),
    update: `update public.episodios set titulo = 'matriz'`,
  },
  avisos: { inserts: [fixa(`insert into public.avisos (episodio_id, titulo) values ($1, 'Matriz')`, [ID_EPISODIO])], update: `update public.avisos set titulo = 'matriz'` },
  mapa_gestos: {
    preparo: `delete from public.mapa_gestos where gesto = 'Thumb_Up'`,
    inserts: [fixa(`insert into public.mapa_gestos (gesto, acao) values ('Thumb_Up', 'nenhuma')`)],
    // Cena diferente da do gesto de cena semeado e som_id nulo (o gesto de som também muda).
    update: `update public.mapa_gestos set acao = 'cena', cena_id = '${ID_CENA_UPDATE}', som_id = null`,
  },
  estudio_estado: {
    preparo: `delete from public.estudio_estado`,
    inserts: [fixa(`insert into public.estudio_estado (id, atualizado_por) values (1, auth.uid())`)],
    proprias: (p) => membroDe(p, (u) => `update public.estudio_estado set atualizado_por = '${u}'`),
    update: `update public.estudio_estado set episodio_teste_id = '${ID_AO_VIVO}'`,
  },
  dispositivos: {
    inserts: [
      fixa(`insert into public.dispositivos (tipo, rotulo, usuario_anonimo_id) values ('obs_palco', 'PC matriz', auth.uid())`),
      fixa(`insert into public.dispositivos (tipo, rotulo, criado_por) values ('obs_palco', 'PC matriz', auth.uid())`),
    ],
    proprias: (p) => membroDe(p, (u) => `insert into public.dispositivos (tipo, rotulo, criado_por) values ('obs_palco', 'PC próprio', '${u}')`),
    update: `update public.dispositivos set rotulo = 'matriz'`,
  },
  registro_acoes: {
    // Autoria declarada (DES-001 §8): pelo dispositivo da sessão (ou o palco) e pelo membro da sessão (ou a bia).
    inserts: [
      (p) => [`insert into public.registro_acoes (episodio_id, origem, acao, dispositivo_id) values ($1, 'toque', 'marcador', $2)`, [ID_EPISODIO, DISPOSITIVO_DE[p] ?? ID_PALCO]],
      (p) => [`insert into public.registro_acoes (episodio_id, origem, acao, membro_id) values ($1, 'toque', 'marcador', $2)`, [ID_EPISODIO, MEMBRO_DE[p] ?? UID_BIA]],
    ],
    proprias: (p) =>
      MEMBRO_DE[p]
        ? `insert into public.registro_acoes (episodio_id, origem, acao, membro_id) values ('${ID_EPISODIO}', 'toque', 'clipe', '${MEMBRO_DE[p]}')`
        : DISPOSITIVO_DE[p]
          ? `insert into public.registro_acoes (episodio_id, origem, acao, dispositivo_id) values ('${ID_EPISODIO}', 'toque', 'clipe', '${DISPOSITIVO_DE[p]}')`
          : null,
    update: `update public.registro_acoes set teste = true, acao = 'ocultar_aviso'`,
  },
}

let db: PGlite

beforeAll(async () => {
  db = await criarBanco()
  await semearDados(db)
  // Dados extras para toda tabela ter linha a ler, alterar e apagar.
  await cadastrarUsuario(db, { uid: UID_ESTRANHO, email: EMAIL_ESTRANHO, anonimo: false, provedor: 'google', confirmado: true })
  await cadastrarUsuario(db, { uid: UID_SOLTA, email: null, anonimo: true, provedor: null, confirmado: false })
  const m = await db.query<{ id: string }>(
    `insert into public.midias (tipo, nome, caminho, mime, tamanho_bytes) values ('som', 'aplauso', 'sons/aplauso.mp3', 'audio/mpeg', 10) returning id`,
  )
  await db.query(`insert into public.sons (id, midia_id, rotulo) values ($1, $2, 'aplauso')`, [ID_SOM_APLAUSO, m.rows[0].id])
  await db.query(
    `insert into public.midias (id, tipo, nome, caminho, mime, tamanho_bytes) values ($1, 'som', 'sem som', 'sons/sem-som.mp3', 'audio/mpeg', 10)`,
    [ID_MIDIA_SEM_SOM],
  )
  await db.query(`insert into public.registro_acoes (episodio_id, origem, acao, dispositivo_id) values ($1, 'gesto', 'clipe', $2)`, [ID_EPISODIO, ID_PALCO])
  // Formas de linha: vínculo nulo e vínculo de outra sessão em cada coluna de vínculo (ver o topo).
  await db.query(`insert into public.registro_acoes (episodio_id, origem, acao, membro_id) values ($1, 'toque', 'clipe', $2)`, [ID_EPISODIO, UID_ADM])
  await db.query(`insert into public.dispositivos (tipo, rotulo, criado_por) values ('obs_palco', 'PC sem sessão', $1)`, [UID_ADM])
  await db.query(`insert into public.episodios (titulo) values ('Sem autor')`)
  await db.query(
    `insert into public.midias (id, tipo, nome, caminho, mime, tamanho_bytes, enviado_por) values ($1, 'imagem', 'do adm', 'imagens/adm.png', 'image/png', 1, $2)`,
    [ID_IMAGEM_ADM, UID_ADM],
  )
  await db.query(`update public.membros_permitidos set criado_por = $1 where email = $2`, [UID_ADM, EMAIL_ANA])
  // Valores de estado: um episódio ao vivo, o modo teste ligado e uma ação de teste.
  await db.query(`insert into public.episodios (id, titulo, estado) values ($1, 'Ao vivo', 'ao_vivo')`, [ID_AO_VIVO])
  await db.query(`update public.estudio_estado set episodio_teste_id = $1`, [ID_EPISODIO])
  await db.query(`insert into public.registro_acoes (episodio_id, origem, acao, dispositivo_id, teste) values ($1, 'gesto', 'som', $2, true)`, [ID_EPISODIO, ID_PALCO])
  // Valores que uma política filtrada por valor usaria (ver "Formas de valor" no topo): episódio encerrado,
  // dispositivo revogado (sem sessão, para não mexer nos RECORTES), aviso com link e imagem, e um gesto de cena e
  // um de som (a cena e o som semeados; a constante de update usa outra cena).
  await db.query(`insert into public.episodios (id, titulo, estado) values ($1, 'Encerrado', 'encerrado')`, [ID_ENCERRADO])
  await db.query(
    `insert into public.dispositivos (id, tipo, rotulo, pareado_em, revogado_em) values ($1, 'obs_palco', 'PC revogado', now(), now())`,
    [ID_REVOGADO],
  )
  await db.query(
    `insert into public.avisos (episodio_id, titulo, link, imagem_midia_id) values ($1, 'Com link', 'https://revocast.test/aviso', $2)`,
    [ID_EPISODIO, ID_IMAGEM_ADM],
  )
  await db.query(`insert into public.cenas (id, nome_exibicao, nome_obs) values ($1, 'Update', 'Cena Update')`, [ID_CENA_UPDATE])
  await db.query(`update public.mapa_gestos set acao = 'cena', cena_id = $1 where gesto = 'Victory'`, [ID_CENA])
  await db.query(`update public.mapa_gestos set acao = 'som', som_id = $1 where gesto = 'Thumb_Up'`, [ID_SOM_APLAUSO])
}, TEMPO_LIMITE_HOOK_MS)
afterAll(() => db.close(), TEMPO_LIMITE_HOOK_MS)
beforeEach(async () => {
  await db.exec('begin')
})
afterEach(async () => {
  await db.exec('rollback')
})

async function retrato(tabela: string): Promise<string> {
  const r = await db.query<{ h: string }>(`select coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from public.${tabela} x`)
  return r.rows[0].h
}

const violaRls = (tabela: string) => `new row violates row-level security policy for table "${tabela}"`
const negado = (tabela: string) => `permission denied for table ${tabela}`
/**
 * O papel do Postgres da sessão (authenticated, ou anon sem claims) tem o privilégio da operação na tabela?
 * A migração dá a authenticated exatamente as operações que algum papel da matriz tem, e nada a anon (nem a
 * service_role, que nenhuma sessão da matriz usa).
 */
const temPrivilegio = (tabela: string, operacao: Operacao, papel: Papel) => papel !== 'anon' && MATRIZ[tabela][operacao].permitidos.length > 0

type Celula = { tabela: string; operacao: Operacao; papel: Papel; permitido: boolean }
const celulas: Celula[] = []
for (const [tabela, ops] of Object.entries(MATRIZ)) {
  for (const operacao of ['select', 'insert', 'update', 'delete'] as Operacao[]) {
    for (const papel of TODOS) celulas.push({ tabela, operacao, papel, permitido: ops[operacao].permitidos.includes(papel) })
  }
}

describe('matriz de permissões (DES-001 §8)', () => {
  test('a matriz cobre as 11 tabelas com política × 9 papéis × 4 operações', () => {
    expect(Object.keys(MATRIZ)).toHaveLength(11)
    expect(Object.keys(COMANDOS).sort()).toEqual(Object.keys(MATRIZ).sort())
    expect(TODOS).toHaveLength(9)
    expect(celulas).toHaveLength(11 * 9 * 4)
  })

  test.each(Object.keys(COMANDOS))('o update de %s muda toda linha (com as linhas próprias de cada papel)', async (tabela) => {
    // Como superusuário, na transação do teste: nenhuma linha pode sair do update igual ao que era.
    for (const papel of TODOS) {
      await db.exec('savepoint papel')
      const propria = COMANDOS[tabela].proprias?.(papel)
      if (propria) await db.query(propria)
      await db.query(`create temp table antes as select x::text as t from public.${tabela} x`)
      const total = (await db.query<{ n: number }>(`select count(*)::int as n from antes`)).rows[0].n
      await db.query(COMANDOS[tabela].update)
      const iguais = await db.query<{ n: number }>(`select count(*)::int as n from public.${tabela} x where x::text in (select t from antes)`)
      expect([papel, total > 0, iguais.rows[0].n]).toEqual([papel, true, 0])
      await db.exec('rollback to savepoint papel')
    }
  })

  test('toda coluna de vínculo com a sessão tem linha nula e linha de outra sessão', async () => {
    const q = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0].n
    const colunas: [string, string][] = [
      ['membros_permitidos', 'criado_por'], ['midias', 'enviado_por'], ['episodios', 'criado_por'], ['dispositivos', 'criado_por'],
      ['dispositivos', 'usuario_anonimo_id'], ['registro_acoes', 'membro_id'], ['registro_acoes', 'dispositivo_id'],
    ]
    for (const [tabela, coluna] of colunas) {
      expect([tabela, coluna, await q(`select count(*)::int as n from public.${tabela} where ${coluna} is null`) > 0]).toEqual([tabela, coluna, true])
      expect([tabela, coluna, await q(`select count(*)::int as n from public.${tabela} where ${coluna} is not null`) > 0]).toEqual([tabela, coluna, true])
    }
  })

  test('os dados extras têm as formas de valor (estado, revogação, link, imagem, gesto de cena e de som)', async () => {
    const q = async (sql: string) => (await db.query<{ n: number }>(`select count(*)::int as n from ${sql}`)).rows[0].n
    const formas: [string, string][] = [
      ['episódio rascunho', `public.episodios where estado = 'rascunho'`],
      ['episódio ao vivo', `public.episodios where estado = 'ao_vivo'`],
      ['episódio encerrado', `public.episodios where estado = 'encerrado'`],
      ['modo teste ligado', `public.estudio_estado where episodio_teste_id is not null`],
      ['ação de teste', `public.registro_acoes where teste`],
      ['dispositivo revogado', `public.dispositivos where revogado_em is not null`],
      ['dispositivo ativo', `public.dispositivos where revogado_em is null`],
      ['aviso com link', `public.avisos where link is not null`],
      ['aviso sem link', `public.avisos where link is null`],
      ['aviso com imagem', `public.avisos where imagem_midia_id is not null`],
      ['gesto de cena', `public.mapa_gestos where acao = 'cena'`],
      ['gesto de som', `public.mapa_gestos where acao = 'som'`],
    ]
    for (const [nome, sql] of formas) expect([nome, (await q(sql)) > 0]).toEqual([nome, true])
  })

  test.each(celulas.map((c) => [`${c.tabela} ${c.operacao} ${c.papel} → ${c.permitido ? 'permitido' : 'proibido'}`, c] as const))(
    '%s',
    async (_nome, { tabela, operacao, papel, permitido }) => {
      const sessao = PAPEIS[papel]
      const propria = operacao === 'insert' ? null : COMANDOS[tabela].proprias?.(papel)
      if (propria) await db.query(propria)
      if (!permitido && !temPrivilegio(tabela, operacao, papel)) {
        // Sem o GRANT (anon, ou authenticated numa operação que nenhuma política permite): permission denied.
        const comandos: [string, unknown[]][] =
          operacao === 'select' ? [[`select * from public.${tabela}`, []]]
          : operacao === 'insert' ? COMANDOS[tabela].inserts.map((forma) => forma(papel))
          : operacao === 'update' ? [[COMANDOS[tabela].update, []]]
          : [[`delete from public.${tabela}`, []]]
        for (const [sql, params] of comandos) {
          const r = await comoSessao(db, sessao, sql, params)
          expect([sql, r instanceof Error ? r.message : 'aceito']).toEqual([sql, negado(tabela)])
        }
        // Defesa em profundidade: com os 4 privilégios dados na transação do teste (desfeitos no rollback), a
        // RLS também nega, como abaixo. Assim uma política indevida é pega mesmo onde hoje falta o GRANT.
        await db.query(`grant select, insert, update, delete on public.${tabela} to ${papel === 'anon' ? 'anon' : 'authenticated'}`)
      }
      if (operacao === 'select') {
        const r = await comoSessao<Record<string, unknown>>(db, sessao, `select * from public.${tabela}`)
        if (r instanceof Error) throw r
        const recorte = RECORTES[tabela]?.[papel]
        if (!permitido) expect(r).toEqual([])
        else if (recorte) expect(r.map((l) => l.id).sort()).toEqual([...recorte].sort())
        else {
          // Permitido lê todas as linhas (contadas como superusuário), não só as "próprias".
          const total = (await db.query<{ n: number }>(`select count(*)::int as n from public.${tabela}`)).rows[0].n
          expect(r.length).toBe(total)
        }
        return
      }
      if (operacao === 'insert') {
        const { inserts, preparo } = COMANDOS[tabela]
        if (preparo) await db.query(preparo)
        for (const forma of inserts) {
          const [sql, params] = forma(papel)
          const r = await comoSessao(db, sessao, sql, params)
          if (permitido) {
            if (r instanceof Error) throw r
          } else {
            expect([sql, r instanceof Error ? r.message : 'aceito']).toEqual([sql, violaRls(tabela)])
          }
          if (preparo && inserts.length > 1) await db.query(preparo)
        }
        return
      }
      // update/delete sem where (ver o comentário do topo).
      if (operacao === 'delete' && tabela !== 'registro_acoes') await db.query('delete from public.registro_acoes')
      // mapa_gestos → cenas/sons não tem ação de delete: esvazia os gestos de cena e de som antes de apagar
      // cenas, sons ou mídias (que apagam os sons em cascata), para que a chave estrangeira não recuse no lugar da RLS.
      if (operacao === 'delete' && ['cenas', 'sons', 'midias'].includes(tabela)) {
        await db.query(`update public.mapa_gestos set acao = 'nenhuma', cena_id = null, som_id = null where cena_id is not null or som_id is not null`)
      }
      const antes = await retrato(tabela)
      await db.query(`create temp table antes_celula as select x::text as t from public.${tabela} x`)
      const sql = operacao === 'update' ? COMANDOS[tabela].update : `delete from public.${tabela}`
      const r = await comoSessao(db, sessao, sql)
      if (r instanceof Error) throw r
      const depois = await retrato(tabela)
      if (permitido) {
        // Permitido alcança toda linha: no update, nenhuma linha sobra igual; no delete, a tabela esvazia.
        const conta = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0].n
        const intocada = PROPRIA_LINHA_INTOCADA[tabela]?.[papel]
        if (intocada) {
          // Exceção (D1): a linha intocada fica idêntica e é a única que sobra igual (update) ou que sobra (delete).
          const filtro = operacao === 'update' ? 'where x::text in (select t from antes_celula)' : ''
          const sobra = await db.query<{ email: string; igual: boolean }>(
            `select email, x::text in (select t from antes_celula) as igual from public.${tabela} x ${filtro} order by email`,
          )
          expect(sobra.rows).toEqual([{ email: intocada, igual: true }])
        } else if (operacao === 'update') expect(await conta(`select count(*)::int as n from public.${tabela} x where x::text in (select t from antes_celula)`)).toBe(0)
        else expect(await conta(`select count(*)::int as n from public.${tabela}`)).toBe(0)
        expect(depois).not.toBe(antes)
      } else expect(depois).toBe(antes)
    },
  )
})
