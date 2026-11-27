// Testes de restrição (CHECK, índices únicos e chaves estrangeiras compostas) da migração inicial.
// Rodam como superusuário (as restrições valem para qualquer papel), sobre semearDados(),
// cada um numa transação desfeita no fim. Toda recusa confere o SQLSTATE e o nome da restrição,
// para que o teste não passe por uma recusa de outro motivo.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { ID_CAMERA, ID_CENA, ID_EPISODIO, ID_PALCO, UID_ANA, UID_SESSAO_CAMERA, TEMPO_LIMITE_HOOK_MS, criarBanco, semearDados } from './banco'

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

const CHECK = '23514'
const DUPLICADO = '23505'
const CHAVE_ESTRANGEIRA = '23503'

/** Roda o comando dentro de um savepoint e devolve o código e a restrição do erro (ou falha se não houver erro). */
async function recusa(sql: string, params: unknown[] = []): Promise<{ code: string; constraint: string }> {
  await db.exec('savepoint recusa')
  try {
    await db.query(sql, params)
  } catch (e) {
    await db.exec('rollback to savepoint recusa')
    const { code, constraint } = e as { code: string; constraint: string }
    return { code, constraint }
  }
  await db.exec('release savepoint recusa')
  throw new Error(`esperava recusa: ${sql}`)
}

/** Cria uma mídia do tipo dado e devolve o id. */
async function criarMidia(tipo: 'som' | 'imagem', caminho: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into public.midias (tipo, nome, caminho, mime, tamanho_bytes) values ($1, $2, $2, $3, 1000) returning id`,
    [tipo, caminho, tipo === 'som' ? 'audio/mpeg' : 'image/png'],
  )
  return r.rows[0].id
}

/** Cria uma mídia do tipo som e o som correspondente; devolve o id do som. */
async function criarSom(): Promise<string> {
  const midia = await criarMidia('som', 'sons/aplauso.mp3')
  const r = await db.query<{ id: string }>(`insert into public.sons (midia_id, rotulo) values ($1, 'aplauso') returning id`, [midia])
  return r.rows[0].id
}

const acaoDe = async (gesto: string) =>
  (await db.query('select acao, cena_id, som_id from public.mapa_gestos where gesto = $1', [gesto])).rows[0]

describe('episódios e estúdio', () => {
  test('dois-ao-vivo', async () => {
    await db.query(`update public.episodios set estado = 'ao_vivo' where id = $1`, [ID_EPISODIO])
    expect(await recusa(`insert into public.episodios (titulo, estado) values ('Outro', 'ao_vivo')`)).toEqual({
      code: DUPLICADO,
      constraint: 'episodios_um_ao_vivo',
    })
    // Controle: o índice é parcial; dois episódios encerrados convivem.
    await db.query(`insert into public.episodios (titulo, estado) values ('Velho 1', 'encerrado'), ('Velho 2', 'encerrado')`)
  })

  test('estudio-uma-linha', async () => {
    expect((await db.query('select id from public.estudio_estado')).rows).toEqual([{ id: 1 }])
    expect(await recusa('insert into public.estudio_estado (id) values (2)')).toEqual({
      code: CHECK,
      constraint: 'estudio_estado_linha_unica',
    })
  })
})

describe('mapa de gestos', () => {
  test('mapa-padrao', async () => {
    const r = await db.query<{ gesto: string; acao: string }>('select gesto, acao from public.mapa_gestos')
    expect(Object.fromEntries(r.rows.map((l) => [l.gesto, l.acao]))).toEqual({
      ILoveYou: 'clipe',
      Closed_Fist: 'marcador',
      Victory: 'proxima_cena',
      Pointing_Up: 'proximo_aviso',
      Open_Palm: 'ocultar_aviso',
      Thumb_Up: 'nenhuma',
      Thumb_Down: 'nenhuma',
    })
    expect(r.rows).toHaveLength(7)
  })

  test('gesto-som-sem-som', async () => {
    expect(await recusa(`update public.mapa_gestos set acao = 'som' where gesto = 'Thumb_Up'`)).toEqual({
      code: CHECK,
      constraint: 'mapa_gestos_equivalencia',
    })
  })

  test('gesto-cena-sem-cena', async () => {
    expect(await recusa(`update public.mapa_gestos set acao = 'cena', cena_id = null where gesto = 'Thumb_Up'`)).toEqual({
      code: CHECK,
      constraint: 'mapa_gestos_equivalencia',
    })
  })

  test('gesto-cena-ok', async () => {
    await db.query(`update public.mapa_gestos set acao = 'cena', cena_id = $1 where gesto = 'Thumb_Up'`, [ID_CENA])
    expect(await acaoDe('Thumb_Up')).toEqual({ acao: 'cena', cena_id: ID_CENA, som_id: null })
  })

  test('gesto-som-ok', async () => {
    const som = await criarSom()
    await db.query(`update public.mapa_gestos set acao = 'som', som_id = $1 where gesto = 'Thumb_Up'`, [som])
    expect(await acaoDe('Thumb_Up')).toEqual({ acao: 'som', cena_id: null, som_id: som })
  })

  test('gesto-som-com-cena', async () => {
    const som = await criarSom()
    expect(
      await recusa(`update public.mapa_gestos set acao = 'som', som_id = $1, cena_id = $2 where gesto = 'Thumb_Up'`, [som, ID_CENA]),
    ).toEqual({ code: CHECK, constraint: 'mapa_gestos_equivalencia' })
  })

  test('gesto-cena-com-som', async () => {
    const som = await criarSom()
    expect(
      await recusa(`update public.mapa_gestos set acao = 'cena', cena_id = $1, som_id = $2 where gesto = 'Thumb_Up'`, [ID_CENA, som]),
    ).toEqual({ code: CHECK, constraint: 'mapa_gestos_equivalencia' })
  })
})

describe('dispositivos', () => {
  test('dispositivos-sem-sessao', async () => {
    await db.query(
      `insert into public.dispositivos (tipo, rotulo, usuario_anonimo_id) values ('obs_palco', 'PC 2', null), ('obs_palco', 'PC 3', null)`,
    )
    const r = await db.query<{ n: number }>('select count(*)::int as n from public.dispositivos where usuario_anonimo_id is null')
    expect(r.rows[0].n).toBe(2)
  })

  test('obs-camera-sem-camera', async () => {
    expect(await recusa(`insert into public.dispositivos (tipo, rotulo) values ('obs_camera', 'PC 2 (câmera)')`)).toEqual({
      code: CHECK,
      constraint: 'dispositivos_camera_so_obs_camera',
    })
  })

  test('sessao-em-dois-dispositivos', async () => {
    expect(
      await recusa(`insert into public.dispositivos (tipo, rotulo, usuario_anonimo_id) values ('obs_palco', 'PC 2', $1)`, [
        UID_SESSAO_CAMERA,
      ]),
    ).toEqual({ code: DUPLICADO, constraint: 'dispositivos_usuario_anonimo_unico' })
  })

  test('camera-sem-reconhecer-ok', async () => {
    await db.query(`insert into public.dispositivos (tipo, rotulo, reconhecer_no) values ('camera', 'Celular 2', null)`)
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.dispositivos where tipo = 'camera'`)
    expect(r.rows[0].n).toBe(2)
  })

  test('palco-com-reconhecer-recusado', async () => {
    expect(
      await recusa(`insert into public.dispositivos (tipo, rotulo, reconhecer_no) values ('obs_palco', 'PC 2', 'computador')`),
    ).toEqual({ code: CHECK, constraint: 'dispositivos_reconhecer_so_camera' })
  })

  test('camera-id-so-no-obs-camera', async () => {
    for (const tipo of ['camera', 'obs_palco']) {
      expect(
        await recusa(`insert into public.dispositivos (tipo, rotulo, camera_id) values ($1, 'outro', $2)`, [tipo, ID_CAMERA]),
      ).toEqual({ code: CHECK, constraint: 'dispositivos_camera_so_obs_camera' })
    }
  })

  test('obs-camera-com-camera-ok', async () => {
    await db.query(`insert into public.dispositivos (tipo, rotulo, camera_id) values ('obs_camera', 'PC 2 (câmera)', $1)`, [ID_CAMERA])
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.dispositivos where tipo = 'obs_camera'`)
    expect(r.rows[0].n).toBe(2)
  })
})

describe('registro de ações e sons', () => {
  const insereAcao = `insert into public.registro_acoes (episodio_id, origem, acao, membro_id, dispositivo_id) values ($1, 'toque', 'clipe', $2, $3)`

  test('registro-um-autor', async () => {
    expect(await recusa(insereAcao, [ID_EPISODIO, null, null])).toEqual({ code: CHECK, constraint: 'registro_acoes_um_autor' })
    expect(await recusa(insereAcao, [ID_EPISODIO, UID_ANA, ID_PALCO])).toEqual({ code: CHECK, constraint: 'registro_acoes_um_autor' })
    // Controles: exatamente um autor, membro ou dispositivo.
    await db.query(insereAcao, [ID_EPISODIO, UID_ANA, null])
    await db.query(insereAcao, [ID_EPISODIO, null, ID_PALCO])
    const r = await db.query<{ n: number }>('select count(*)::int as n from public.registro_acoes')
    expect(r.rows[0].n).toBe(2)
  })

  test('som-volume-0-a-1', async () => {
    const midia = await criarMidia('som', 'sons/alto.mp3')
    const insere = `insert into public.sons (midia_id, rotulo, volume) values ($1, 'alto', $2)`
    expect(await recusa(insere, [midia, 1.5])).toEqual({ code: CHECK, constraint: 'sons_volume_0_a_1' })
    expect(await recusa(insere, [midia, -0.1])).toEqual({ code: CHECK, constraint: 'sons_volume_0_a_1' })
    await db.query(insere, [midia, 1]) // controle: limite aceito
    const r = await db.query<{ n: number }>('select count(*)::int as n from public.sons where midia_id = $1', [midia])
    expect(r.rows[0].n).toBe(1)
  })
})

// Padrões que o DES-001 §7 cita: gestos_ligados "padrão falso", duracao_s "padrão 10" e expira_em "2 min".
// O insert mínimo omite a coluna, então só o default da migração decide o valor.
describe('valores padrão (DES-001 §7)', () => {
  test('episodio-gestos-desligados-por-padrao', async () => {
    const r = await db.query(`insert into public.episodios (titulo) values ('Padrão') returning gestos_ligados`)
    expect(r.rows).toEqual([{ gestos_ligados: false }])
  })

  test('aviso-dura-10s-por-padrao', async () => {
    const r = await db.query(`insert into public.avisos (episodio_id, titulo) values ($1, 'Padrão') returning duracao_s`, [ID_EPISODIO])
    expect(r.rows).toEqual([{ duracao_s: 10 }])
  })

  test('codigo-expira-em-2-minutos-por-padrao', async () => {
    // now() é o início da transação do teste, o mesmo instante usado pelo default.
    const r = await db.query(
      `insert into public.codigos_pareamento (dispositivo_id, codigo_hash) values ($1, 'hash-padrao')
       returning (expira_em - now()) = interval '2 minutes' as dois_minutos`,
      [ID_CAMERA],
    )
    expect(r.rows).toEqual([{ dois_minutos: true }])
  })
})

// Catálogo: as chaves estrangeiras e as unicidades de public, lidas em pg_constraint, comparadas com a lista
// esperada. As chaves vêm do DES-001 §7 ("episodio_id (FK)", "cena_id (FK, opcional)", "camera_id (FK para
// dispositivos)", "midia_id (FK midias, tipo som)" etc.); as ações on delete e as unicidades fora do §7
// (midias.caminho, sons.midia_id, midias (id, tipo)) são decisões da migração (supabase/migrations/README.md).
// Remover uma `references`, trocar a ação on delete ou tirar um `unique` muda a lista e derruba o teste.
describe('catálogo: chaves estrangeiras e unicidades (DES-001 §7)', () => {
  const colunas = (rel: string, nums: string) =>
    `(select string_agg(a.attname, ', ' order by k.ord) from unnest(${nums}) with ordinality k(n, ord)
       join pg_attribute a on a.attrelid = ${rel} and a.attnum = k.n)`

  test('chaves-estrangeiras', async () => {
    const r = await db.query<{ fk: string }>(
      `select c.conrelid::regclass::text || ' (' || ${colunas('c.conrelid', 'c.conkey')} || ') -> '
            || c.confrelid::regclass::text || ' (' || ${colunas('c.confrelid', 'c.confkey')} || ') on delete '
            || case c.confdeltype when 'a' then 'no action' when 'r' then 'restrict' when 'c' then 'cascade'
                 when 'n' then 'set null' when 'd' then 'set default' end
            || coalesce(' (' || ${colunas('c.conrelid', 'c.confdelsetcols')} || ')', '') as fk
       from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace order by 1`,
    )
    expect(r.rows.map((l) => l.fk)).toEqual([
      'avisos (episodio_id) -> episodios (id) on delete cascade',
      'avisos (imagem_midia_id, tipo_imagem) -> midias (id, tipo) on delete set null (imagem_midia_id)',
      'codigos_pareamento (dispositivo_id) -> dispositivos (id) on delete cascade',
      'dispositivos (camera_id) -> dispositivos (id) on delete no action',
      'dispositivos (criado_por) -> membros (id) on delete set null',
      'dispositivos (usuario_anonimo_id) -> auth.users (id) on delete set null',
      'episodios (criado_por) -> membros (id) on delete set null',
      'estudio_estado (atualizado_por) -> membros (id) on delete set null',
      'estudio_estado (episodio_teste_id) -> episodios (id) on delete no action', // VER-046 (I3): era set null
      'mapa_gestos (cena_id) -> cenas (id) on delete no action',
      'mapa_gestos (som_id) -> sons (id) on delete no action',
      'membros (id) -> auth.users (id) on delete cascade',
      'membros_permitidos (criado_por) -> membros (id) on delete set null',
      'midias (enviado_por) -> membros (id) on delete set null',
      'registro_acoes (aviso_id) -> avisos (id) on delete set null',
      'registro_acoes (cena_id) -> cenas (id) on delete set null',
      'registro_acoes (dispositivo_id) -> dispositivos (id) on delete no action',
      'registro_acoes (episodio_id) -> episodios (id) on delete cascade',
      'registro_acoes (membro_id) -> membros (id) on delete no action',
      'registro_acoes (som_id) -> sons (id) on delete set null',
      'sons (midia_id, tipo_midia) -> midias (id, tipo) on delete cascade',
      // E3 (PLA-004, D2): apagar o usuário anônimo apaga as tentativas de pareamento dele.
      'tentativas_pareamento (usuario_id) -> auth.users (id) on delete cascade',
    ])
  })

  test('unicidades', async () => {
    // Restrições unique (as chaves primárias e os índices únicos parciais têm testes próprios).
    const r = await db.query<{ u: string }>(
      `select c.conrelid::regclass::text || ' (' || ${colunas('c.conrelid', 'c.conkey')} || ')' as u
       from pg_constraint c where c.contype = 'u' and c.connamespace = 'public'::regnamespace order by 1`,
    )
    expect(r.rows.map((l) => l.u)).toEqual([
      'cenas (nome_obs)',
      'codigos_pareamento (codigo_hash)',
      'membros (email)',
      'midias (caminho)',
      'midias (id, tipo)',
      'sons (midia_id)',
    ])
  })
})

describe('pareamento', () => {
  test('codigo-hash-unico', async () => {
    const insere = `insert into public.codigos_pareamento (dispositivo_id, codigo_hash) values ($1, 'hash-1')`
    await db.query(insere, [ID_CAMERA]) // controle
    expect(await recusa(insere, [ID_CAMERA])).toEqual({ code: DUPLICADO, constraint: 'codigos_pareamento_codigo_hash_key' })
  })
})

describe('membros e mídias', () => {
  test('email-lista-minusculo', async () => {
    expect(await recusa(`insert into public.membros_permitidos (email, papel) values ('Nova@revocast.test', 'equipe')`)).toEqual({
      code: CHECK,
      constraint: 'membros_permitidos_email_minusculo',
    })
  })

  test('som-com-midia-imagem', async () => {
    const imagem = await criarMidia('imagem', 'imagens/foto.png')
    expect(await recusa(`insert into public.sons (midia_id, rotulo) values ($1, 'errado')`, [imagem])).toEqual({
      code: CHAVE_ESTRANGEIRA,
      constraint: 'sons_midia_do_tipo_som',
    })
  })

  test('som-com-tipo-explicito-imagem', async () => {
    // Com o tipo explícito errado, a chave composta casaria com a mídia de imagem: só o check impede.
    const imagem = await criarMidia('imagem', 'imagens/foto.png')
    expect(await recusa(`insert into public.sons (midia_id, tipo_midia, rotulo) values ($1, 'imagem', 'errado')`, [imagem])).toEqual({
      code: CHECK,
      constraint: 'sons_tipo_midia_som',
    })
  })

  test('aviso-com-tipo-explicito-som', async () => {
    const som = await criarMidia('som', 'sons/buuu.mp3')
    expect(
      await recusa(`insert into public.avisos (episodio_id, titulo, imagem_midia_id, tipo_imagem) values ($1, 'errado', $2, 'som')`, [ID_EPISODIO, som]),
    ).toEqual({ code: CHECK, constraint: 'avisos_tipo_imagem' })
  })

  test('aviso-com-midia-som', async () => {
    const som = await criarMidia('som', 'sons/buuu.mp3')
    expect(
      await recusa(`insert into public.avisos (episodio_id, titulo, imagem_midia_id) values ($1, 'errado', $2)`, [ID_EPISODIO, som]),
    ).toEqual({ code: CHAVE_ESTRANGEIRA, constraint: 'avisos_midia_do_tipo_imagem' })
  })

  test('aviso-com-midia-imagem-ok', async () => {
    const imagem = await criarMidia('imagem', 'imagens/foto.png')
    await db.query(`insert into public.avisos (episodio_id, titulo, imagem_midia_id) values ($1, 'certo', $2)`, [ID_EPISODIO, imagem])
    const r = await db.query<{ n: number }>('select count(*)::int as n from public.avisos where imagem_midia_id = $1', [imagem])
    expect(r.rows[0].n).toBe(1)
  })

  test('aviso-link-so-https', async () => {
    expect(
      await recusa(`insert into public.avisos (episodio_id, titulo, link) values ($1, 'link', 'http://exemplo.test')`, [ID_EPISODIO]),
    ).toEqual({ code: CHECK, constraint: 'avisos_link_https' })
    // Sem as barras ("https:" sozinho) também é recusado: o DES-001 §7 pede `https://`.
    expect(
      await recusa(`insert into public.avisos (episodio_id, titulo, link) values ($1, 'link', 'https:exemplo.test')`, [ID_EPISODIO]),
    ).toEqual({ code: CHECK, constraint: 'avisos_link_https' })
    await db.query(`insert into public.avisos (episodio_id, titulo, link) values ($1, 'link', 'https://exemplo.test')`, [ID_EPISODIO]) // controle
  })

  test('midia-ate-50mb', async () => {
    expect(
      await recusa(
        `insert into public.midias (tipo, nome, caminho, mime, tamanho_bytes) values ('som', 'grande', 'sons/grande.mp3', 'audio/mpeg', 52428801)`,
      ),
    ).toEqual({ code: CHECK, constraint: 'midias_tamanho_ate_50mb' })
    // Controle: exatamente 50 MB (52428800 bytes) é aceito.
    await db.query(
      `insert into public.midias (tipo, nome, caminho, mime, tamanho_bytes) values ('som', 'limite', 'sons/limite.mp3', 'audio/mpeg', 52428800)`,
    )
  })
})
