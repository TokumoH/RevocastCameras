import { describe, expect, test } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ErroDePreparacao } from '../../domains/preparacao/portas'
import { criarRepositoriosDePreparacao } from './preparacaoSupabase'

interface Resposta {
  data?: unknown
  error?: unknown
  status?: number
  count?: number | null
}

/**
 * Cliente Supabase falso no padrão de `acessoSupabase.test.ts`: registra a cadeia do PostgREST
 * (`from`, `select`, `insert`, `update`, `delete`, `eq`, `order`) e devolve a resposta configurada.
 */
function criarFalso() {
  let chamadas: unknown[][] = []
  let resposta: Resposta = {}
  const construtor: Record<string, unknown> = {}
  for (const metodo of ['select', 'insert', 'update', 'delete', 'eq', 'order']) {
    construtor[metodo] = (...args: unknown[]) => {
      chamadas.push([metodo, ...args])
      return construtor
    }
  }
  construtor.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null, status: 200, count: null, ...resposta }).then(ok, falha)
  const cliente = {
    from: (...args: unknown[]) => {
      chamadas.push(['from', ...args])
      return construtor
    },
  } as unknown as SupabaseClient
  return {
    repos: criarRepositoriosDePreparacao(cliente),
    /** Devolve as chamadas registradas e começa uma lista nova. */
    tirar(): unknown[][] {
      const feitas = chamadas
      chamadas = []
      return feitas
    },
    responder(r: Resposta) {
      resposta = r
    },
  }
}

async function motivoDe(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa
  } catch (e) {
    if (e instanceof ErroDePreparacao) return e.motivo
    throw e
  }
  throw new Error('esperava ErroDePreparacao')
}

const ID = '0b6f3c1e-2a4d-4f8b-9c7e-1d2e3f4a5b6c'

describe('criarRepositoriosDePreparacao', () => {
  test('listar-converte', async () => {
    const f = criarFalso()

    f.responder({
      data: [
        { id: 'm1', tipo: 'som', nome: 'aplauso.mp3', caminho: `som/${ID}.mp3`, mime: 'audio/mpeg', tamanho_bytes: 1234, enviado_por: 'u1' },
        { id: 'm2', tipo: 'video', nome: 'x.mp4', caminho: 'video/x.mp4', mime: 'video/mp4', tamanho_bytes: 1, enviado_por: null },
        { id: 'm3', tipo: 'imagem', nome: 'logo.png', caminho: `imagem/${ID}.png`, mime: 'image/png', tamanho_bytes: 99, enviado_por: null },
      ],
    })
    expect(await f.repos.midias.listar()).toEqual([
      { id: 'm1', tipo: 'som', nome: 'aplauso.mp3', caminho: `som/${ID}.mp3`, mime: 'audio/mpeg', tamanhoBytes: 1234, enviadoPor: 'u1' },
      { id: 'm3', tipo: 'imagem', nome: 'logo.png', caminho: `imagem/${ID}.png`, mime: 'image/png', tamanhoBytes: 99, enviadoPor: null },
    ])
    expect(f.tirar()).toEqual([
      ['from', 'midias'],
      ['select', 'id, tipo, nome, caminho, mime, tamanho_bytes, enviado_por'],
      ['order', 'nome'],
    ])

    f.responder({ data: [{ id: 's1', midia_id: 'm1', rotulo: 'aplauso', emoji: '👏', volume: 0.5, ordem: 2 }] })
    expect(await f.repos.sons.listar()).toEqual([{ id: 's1', midiaId: 'm1', rotulo: 'aplauso', emoji: '👏', volume: 0.5, ordem: 2 }])
    expect(f.tirar()).toEqual([['from', 'sons'], ['select', 'id, midia_id, rotulo, emoji, volume, ordem'], ['order', 'ordem']])

    f.responder({ data: [{ id: 'c1', nome_exibicao: 'Abertura', nome_obs: 'Cena Abertura', ordem: 0 }] })
    expect(await f.repos.cenas.listar()).toEqual([{ id: 'c1', nomeExibicao: 'Abertura', nomeObs: 'Cena Abertura', ordem: 0 }])
    expect(f.tirar()).toEqual([['from', 'cenas'], ['select', 'id, nome_exibicao, nome_obs, ordem'], ['order', 'ordem']])

    f.responder({
      data: [
        { id: 'e1', titulo: 'Ep. 2', data: '2026-12-03', estado: 'rascunho' },
        { id: 'e2', titulo: 'Ep. 1', data: '2026-11-26', estado: 'encerrado' },
        { id: 'e3', titulo: 'Ep. 0', data: '2026-11-19', estado: 'arquivado' },
      ],
    })
    expect(await f.repos.episodios.listar()).toEqual([
      { id: 'e1', titulo: 'Ep. 2', data: '2026-12-03', estado: 'rascunho' },
      { id: 'e2', titulo: 'Ep. 1', data: '2026-11-26', estado: 'encerrado' },
    ])
    expect(f.tirar()).toEqual([['from', 'episodios'], ['select', 'id, titulo, data, estado'], ['order', 'data', { ascending: false }]])

    f.responder({
      data: [
        { id: 'a1', episodio_id: 'e1', titulo: 'Inscreva-se', texto: '', link: 'https://revocast.test/', imagem_midia_id: 'm3', duracao_s: 10, ordem: 0 },
      ],
    })
    expect(await f.repos.episodios.listarAvisos('e1')).toEqual([
      { id: 'a1', episodioId: 'e1', titulo: 'Inscreva-se', texto: '', link: 'https://revocast.test/', imagemMidiaId: 'm3', duracaoS: 10, ordem: 0 },
    ])
    expect(f.tirar()).toEqual([
      ['from', 'avisos'],
      ['select', 'id, episodio_id, titulo, texto, link, imagem_midia_id, duracao_s, ordem'],
      ['eq', 'episodio_id', 'e1'],
      ['order', 'ordem'],
    ])

    const gestos = ['ILoveYou', 'Closed_Fist', 'Victory', 'Thumb_Up', 'Thumb_Down', 'Pointing_Up', 'Open_Palm']
    f.responder({
      data: [
        ...gestos.map((gesto) => ({ gesto, acao: gesto === 'Thumb_Up' ? 'som' : 'nenhuma', cena_id: null, som_id: gesto === 'Thumb_Up' ? 's1' : null })),
        { gesto: 'Spock', acao: 'nenhuma', cena_id: null, som_id: null },
        { gesto: 'Victory', acao: 'explodir', cena_id: null, som_id: null },
      ],
    })
    const mapa = await f.repos.gestos.listar()
    expect(mapa).toHaveLength(7)
    expect(mapa.find((l) => l.gesto === 'Thumb_Up')).toEqual({ gesto: 'Thumb_Up', acao: 'som', cenaId: null, somId: 's1' })
    expect(mapa.map((l) => l.gesto)).toEqual(gestos)
    expect(f.tirar()).toEqual([['from', 'mapa_gestos'], ['select', 'gesto, acao, cena_id, som_id'], ['order', 'gesto']])
  })

  test('mapa-descarta-linha-que-nao-e-objeto (VER-061, rodada 1, N2)', async () => {
    // `lerMapaDeGestos` (o leitor único da Preparação e do palco): linha nula ou que não é objeto é descartada, sem lançar
    const f = criarFalso()
    f.responder({ data: [null, 'ILoveYou', 7, { gesto: 'Victory', acao: 'clipe', cena_id: null, som_id: null }, null] })
    expect(await f.repos.gestos.listar()).toEqual([{ gesto: 'Victory', acao: 'clipe', cenaId: null, somId: null }])
  })

  test('episodio-so-titulo-e-data', async () => {
    const f = criarFalso()
    f.responder({ data: [{ id: 'e1' }] })
    // Mesmo que a tela passe o episódio inteiro, só titulo e data vão (D2: nunca estado nem gestos_ligados).
    const episodio = { id: 'e1', titulo: 'Novo', data: '2026-12-10', estado: 'ao_vivo', gestos_ligados: true, criado_por: 'u1' }
    await f.repos.episodios.alterar('e1', episodio)
    const chamadas = f.tirar()
    expect(chamadas).toEqual([
      ['from', 'episodios'],
      ['update', { titulo: 'Novo', data: '2026-12-10' }],
      ['eq', 'id', 'e1'],
      ['select', 'id'],
    ])
    expect(Object.keys(chamadas[1][1] as object).sort()).toEqual(['data', 'titulo'])
  })

  test('gesto-manda-alvos-normalizados', async () => {
    const f = criarFalso()
    f.responder({ data: [{ gesto: 'Victory' }] })
    await f.repos.gestos.alterar({ gesto: 'Victory', acao: 'clipe', cenaId: 'x', somId: null })
    expect(f.tirar()).toEqual([
      ['from', 'mapa_gestos'],
      ['update', { acao: 'clipe', cena_id: null, som_id: null }],
      ['eq', 'gesto', 'Victory'],
      ['select', 'gesto'],
    ])
  })

  test('escrita-com-retorno', async () => {
    const f = criarFalso()
    const som = { rotulo: 'aplauso', emoji: null, volume: 1, ordem: 0 }
    const cena = { nomeExibicao: 'Abertura', nomeObs: 'Cena Abertura', ordem: 1 }
    const aviso = { titulo: 'T', texto: 'x', link: null, imagemMidiaId: null, duracaoS: 8, ordem: 3 }
    const escritas: [string, () => Promise<void>, unknown[][]][] = [
      ['midias.remover', () => f.repos.midias.remover('m1'), [['from', 'midias'], ['delete'], ['eq', 'id', 'm1'], ['select', 'id']]],
      ['sons.alterar', () => f.repos.sons.alterar('s1', som), [['from', 'sons'], ['update', som], ['eq', 'id', 's1'], ['select', 'id']]],
      [
        'cenas.alterar',
        () => f.repos.cenas.alterar('c1', cena),
        [['from', 'cenas'], ['update', { nome_exibicao: 'Abertura', nome_obs: 'Cena Abertura', ordem: 1 }], ['eq', 'id', 'c1'], ['select', 'id']],
      ],
      ['cenas.remover', () => f.repos.cenas.remover('c1'), [['from', 'cenas'], ['delete'], ['eq', 'id', 'c1'], ['select', 'id']]],
      [
        'episodios.alterar',
        () => f.repos.episodios.alterar('e1', { titulo: 'T', data: '2026-12-01' }),
        [['from', 'episodios'], ['update', { titulo: 'T', data: '2026-12-01' }], ['eq', 'id', 'e1'], ['select', 'id']],
      ],
      ['episodios.remover', () => f.repos.episodios.remover('e1'), [['from', 'episodios'], ['delete'], ['eq', 'id', 'e1'], ['select', 'id']]],
      [
        'episodios.alterarAviso',
        () => f.repos.episodios.alterarAviso('a1', aviso),
        [
          ['from', 'avisos'],
          ['update', { titulo: 'T', texto: 'x', link: null, imagem_midia_id: null, duracao_s: 8, ordem: 3 }],
          ['eq', 'id', 'a1'],
          ['select', 'id'],
        ],
      ],
      [
        'episodios.alterarOrdemDoAviso',
        () => f.repos.episodios.alterarOrdemDoAviso('a1', 4),
        [['from', 'avisos'], ['update', { ordem: 4 }], ['eq', 'id', 'a1'], ['select', 'id']],
      ],
      ['episodios.removerAviso', () => f.repos.episodios.removerAviso('a1'), [['from', 'avisos'], ['delete'], ['eq', 'id', 'a1'], ['select', 'id']]],
      [
        'gestos.alterar',
        () => f.repos.gestos.alterar({ gesto: 'Open_Palm', acao: 'nenhuma', cenaId: null, somId: null }),
        [['from', 'mapa_gestos'], ['update', { acao: 'nenhuma', cena_id: null, som_id: null }], ['eq', 'gesto', 'Open_Palm'], ['select', 'gesto']],
      ],
    ]
    for (const [nome, escrever, esperado] of escritas) {
      f.responder({ data: [{ id: 'linha' }] })
      await escrever()
      expect(f.tirar(), nome).toEqual(esperado)
      // a RLS filtrou (ou a linha sumiu): 0 linhas no RETURNING
      f.responder({ data: [] })
      expect(await motivoDe(escrever()), nome).toBe('nada_alterado')
      f.tirar()
    }
  })

  test('inclusoes', async () => {
    const f = criarFalso()
    f.responder({ data: null })
    await f.repos.sons.incluir('m1', { rotulo: 'aplauso', emoji: '👏', volume: 0.8, ordem: 2 })
    expect(f.tirar()).toEqual([['from', 'sons'], ['insert', { midia_id: 'm1', rotulo: 'aplauso', emoji: '👏', volume: 0.8, ordem: 2 }]])
    await f.repos.cenas.incluir({ nomeExibicao: 'Fim', nomeObs: 'Cena Fim', ordem: 5 })
    expect(f.tirar()).toEqual([['from', 'cenas'], ['insert', { nome_exibicao: 'Fim', nome_obs: 'Cena Fim', ordem: 5 }]])
    await f.repos.episodios.incluir({ titulo: 'Ep. 3', data: '2026-12-10', criadoPor: 'u1' })
    expect(f.tirar()).toEqual([['from', 'episodios'], ['insert', { titulo: 'Ep. 3', data: '2026-12-10', criado_por: 'u1' }]])
    await f.repos.episodios.incluirAviso({ episodioId: 'e1', titulo: 'T', texto: '', link: 'https://revocast.test/', imagemMidiaId: 'm3', duracaoS: 5, ordem: 0 })
    expect(f.tirar()).toEqual([
      ['from', 'avisos'],
      ['insert', { episodio_id: 'e1', titulo: 'T', texto: '', link: 'https://revocast.test/', imagem_midia_id: 'm3', duracao_s: 5, ordem: 0 }],
    ])
  })

  test('registrar-midia', async () => {
    const f = criarFalso()
    f.responder({ data: null })
    await f.repos.midias.registrar({
      id: ID,
      tipo: 'som',
      nome: 'Aplauso Forte.MP3',
      caminho: `som/${ID}.mp3`,
      mime: 'audio/mpeg',
      tamanhoBytes: 52_428_800,
      enviadoPor: 'u1',
    })
    expect(f.tirar()).toEqual([
      ['from', 'midias'],
      [
        'insert',
        { id: ID, tipo: 'som', nome: 'Aplauso Forte.MP3', caminho: `som/${ID}.mp3`, mime: 'audio/mpeg', tamanho_bytes: 52_428_800, enviado_por: 'u1' },
      ],
    ])
  })

  test('contar-avisos-com-imagem', async () => {
    const f = criarFalso()
    f.responder({ data: null, count: 3 })
    expect(await f.repos.midias.contarAvisosComImagem('m3')).toBe(3)
    expect(f.tirar()).toEqual([['from', 'avisos'], ['select', 'id', { count: 'exact', head: true }], ['eq', 'imagem_midia_id', 'm3']])
    f.responder({ data: null, count: 0 })
    expect(await f.repos.midias.contarAvisosComImagem('m3')).toBe(0)
    // sem contagem, a tela não pode dizer "nenhum aviso perde a imagem"
    f.responder({ data: null, count: null })
    expect(await motivoDe(f.repos.midias.contarAvisosComImagem('m3'))).toBe('outro')
  })

  test('erros-traduzidos', async () => {
    const f = criarFalso()
    f.responder({ data: null, error: { code: '23503', message: 'violates foreign key constraint "mapa_gestos_cena_id_fkey"' }, status: 409 })
    expect(await motivoDe(f.repos.cenas.remover('c1'))).toBe('em_uso')
    f.responder({ data: null, error: { code: '42501', message: 'x' }, status: 401 })
    expect(await motivoDe(f.repos.cenas.remover('c1'))).toBe('sessao_expirada')
    expect(await motivoDe(f.repos.midias.listar())).toBe('sessao_expirada')
    f.responder({ data: null, error: { code: '23505', message: 'episodios_um_ao_vivo' }, status: 409 })
    expect(await motivoDe(f.repos.episodios.incluir({ titulo: 'T', data: '2026-12-01', criadoPor: 'u1' }))).toBe('duplicado')
    f.responder({ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' }, status: 400 })
    expect(await motivoDe(f.repos.midias.registrar({ id: 'x', tipo: 'som', nome: 'a', caminho: 'a', mime: 'audio/mpeg', tamanhoBytes: 1, enviadoPor: 'u' }))).toBe(
      'invalido',
    )
    f.responder({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 })
    expect(await motivoDe(f.repos.gestos.listar())).toBe('rede')
    // a mensagem do servidor nunca vai para o erro
    f.responder({ data: null, error: { code: '23514', message: 'new row violates check "sons_volume_0_a_1"' }, status: 400 })
    const erro = await f.repos.sons.alterar('s1', { rotulo: 'a', emoji: null, volume: 2, ordem: 0 }).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(ErroDePreparacao)
    expect((erro as Error).message).not.toContain('sons_volume')
  })

  test('erro-lancado-vira-erro-de-preparacao', async () => {
    // O postgrest-js 2.119.0 não lança (devolve { error }); se lançar, o adaptador ainda entrega um motivo,
    // para a compensação do envio (biblioteca.ts) decidir sobre um ErroDePreparacao.
    const construtor: Record<string, unknown> = {}
    for (const metodo of ['select', 'insert', 'update', 'delete', 'eq', 'order']) construtor[metodo] = () => construtor
    construtor.then = (_ok: unknown, falha: (e: unknown) => unknown) => Promise.reject(new Error('inesperado')).then(undefined, falha)
    const repos = criarRepositoriosDePreparacao({ from: () => construtor } as unknown as SupabaseClient)
    expect(await motivoDe(repos.midias.registrar({ id: ID, tipo: 'som', nome: 'a', caminho: 'a', mime: 'audio/mpeg', tamanhoBytes: 1, enviadoPor: 'u' }))).toBe('outro')
    expect(await motivoDe(repos.midias.remover(ID))).toBe('outro')
  })
})
