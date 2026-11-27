import { describe, expect, test } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ErroDoAoVivo } from '../../domains/aovivo/portas'
import { criarRepositorioDoAoVivo, criarRepositorioDoPalco, traduzirErroDoAoVivo, VALIDADE_NO_PALCO_S } from './aoVivoSupabase'

interface Resposta {
  data?: unknown
  error?: unknown
  status?: number
}

const EP = '0b6f3c1e-2a4d-4f8b-9c7e-1d2e3f4a5b6c'
const DISP = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
const UID = '5a1c9e2b-7d3f-4b6a-8c1d-2e3f4a5b6c7d'
const MIDIA = '9e8d7c6b-5a4f-4e3d-9c2b-1a0f9e8d7c6b'
/** Código de pareamento de teste (43 caracteres), sem nada de real. */
const CODIGO = 'Codigo_de_teste-0123456789abcdefghijKLMNOPQ'

/**
 * Cliente falso no padrão de `preparacaoSupabase.test.ts`: registra a cadeia do PostgREST (`from`,
 * `select`, `insert`, `eq`, `order`), o `rpc` e o `storage`. As respostas saem de uma fila por
 * tabela/função (`responder('episodios', ...)`); sem resposta na fila, `{ data: null }`.
 */
function criarFalso() {
  let chamadas: unknown[][] = []
  const filas = new Map<string, Resposta[]>()
  function proxima(chave: string): Resposta {
    return filas.get(chave)?.shift() ?? {}
  }
  function construtor(chave: string) {
    const c: Record<string, unknown> = {}
    for (const metodo of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'in']) {
      c[metodo] = (...args: unknown[]) => {
        chamadas.push([metodo, ...args])
        return c
      }
    }
    c.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null, status: 200, ...proxima(chave) }).then(ok, falha)
    return c
  }
  let assinada: () => Promise<unknown> = async () => ({ data: { signedUrl: 'https://armazenamento.revocast.test/assinada?token=teste' }, error: null })
  const cliente = {
    from: (tabela: string) => {
      chamadas.push(['from', tabela])
      return construtor(tabela)
    },
    rpc: (funcao: string, ...args: unknown[]) => {
      chamadas.push(['rpc', funcao, ...args])
      return Promise.resolve({ data: null, error: null, status: 200, ...proxima(funcao) })
    },
    storage: {
      from: (bucket: string) => {
        chamadas.push(['storage.from', bucket])
        return {
          createSignedUrl: (...args: unknown[]) => {
            chamadas.push(['createSignedUrl', ...args])
            return assinada()
          },
        }
      },
    },
  } as unknown as SupabaseClient
  return {
    repo: criarRepositorioDoAoVivo(cliente),
    palco: criarRepositorioDoPalco(cliente),
    tirar(): unknown[][] {
      const feitas = chamadas
      chamadas = []
      return feitas
    },
    responder(chave: string, ...respostas: Resposta[]) {
      filas.set(chave, [...(filas.get(chave) ?? []), ...respostas])
    },
    assinada(f: () => Promise<unknown>) {
      assinada = f
    },
  }
}

async function motivoDe(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa
  } catch (e) {
    if (e instanceof ErroDoAoVivo) return e.motivo
    throw e
  }
  throw new Error('esperava ErroDoAoVivo')
}

describe('criarRepositorioDoAoVivo', () => {
  test('rpcs-e-parametros', async () => {
    const f = criarFalso()
    f.responder('episodio_ativo', { data: [{ id: EP, modo: 'ao_vivo' }] }, { data: [{ id: EP, modo: 'teste' }] }, { data: [] }, { data: [{ id: EP, modo: 'outro' }] }, { data: [{ id: 'EP', modo: 'teste' }] })
    expect(await f.repo.episodioAtivo()).toEqual({ id: EP, modo: 'ao_vivo' })
    expect(await f.repo.episodioAtivo()).toEqual({ id: EP, modo: 'teste' })
    expect(await f.repo.episodioAtivo()).toBeNull()
    expect(await f.repo.episodioAtivo()).toBeNull() // modo fora da lista
    expect(await f.repo.episodioAtivo()).toBeNull() // id fora da forma
    expect(f.tirar()).toEqual(Array.from({ length: 5 }, () => ['rpc', 'episodio_ativo']))

    await f.repo.iniciar(EP)
    await f.repo.encerrar(EP)
    await f.repo.definirModoTeste(EP)
    await f.repo.definirModoTeste(null)
    expect(f.tirar()).toEqual([
      ['rpc', 'iniciar_ao_vivo', { p_episodio: EP }],
      ['rpc', 'encerrar_ao_vivo', { p_episodio: EP }],
      ['rpc', 'definir_modo_teste', { p_episodio: EP }],
      ['rpc', 'definir_modo_teste', { p_episodio: null }],
    ])

    f.responder('criar_codigo_pareamento', { data: [{ dispositivo: DISP, codigo: CODIGO, expira: '2026-11-27T12:02:00+00:00' }] })
    expect(await f.repo.criarCodigo({ tipo: 'obs_camera', rotulo: 'OBS da câmera', dispositivoId: null, cameraId: UID })).toEqual({
      dispositivoId: DISP,
      codigo: CODIGO,
      expiraEm: '2026-11-27T12:02:00+00:00',
    })
    expect(f.tirar()).toEqual([['rpc', 'criar_codigo_pareamento', { p_tipo: 'obs_camera', p_rotulo: 'OBS da câmera', p_dispositivo: null, p_camera: UID }]])
    // rótulo fora do limite do domínio (conferirRotulo, VER-046 I5): invalido, sem chamar o banco
    for (const rotulo of ['', '   ', 'a'.repeat(61), '📷'.repeat(61)]) {
      expect(await motivoDe(f.repo.criarCodigo({ tipo: 'camera', rotulo, dispositivoId: null, cameraId: null }))).toBe('invalido')
    }
    expect(f.tirar()).toEqual([])
    // linha ausente ou incompleta: nunca devolve um código vazio
    f.responder('criar_codigo_pareamento', { data: [] }, { data: [{ dispositivo: DISP, codigo: null, expira: 'x' }] })
    expect(await motivoDe(f.repo.criarCodigo({ tipo: 'camera', rotulo: 'x', dispositivoId: DISP, cameraId: null }))).toBe('outro')
    expect(await motivoDe(f.repo.criarCodigo({ tipo: 'camera', rotulo: 'x', dispositivoId: DISP, cameraId: null }))).toBe('outro')
    f.tirar()

    f.responder('revogar_dispositivo', { data: UID }, { data: null })
    expect(await f.repo.revogar(DISP)).toEqual({ usuario: UID })
    expect(await f.repo.revogar(DISP)).toEqual({ usuario: null }) // nunca pareado
    expect(f.tirar()).toEqual([
      ['rpc', 'revogar_dispositivo', { p_dispositivo: DISP }],
      ['rpc', 'revogar_dispositivo', { p_dispositivo: DISP }],
    ])
    // retorno fora da forma de uuid (texto, maiúsculas, número) → invalido, nunca um "usuário" para o aviso
    f.responder('revogar_dispositivo', { data: 'nao-e-uuid' }, { data: UID.toUpperCase() }, { data: 7 })
    for (let i = 0; i < 3; i++) expect(await motivoDe(f.repo.revogar(DISP))).toBe('invalido')
    f.tirar()
  })

  test('listar-dispositivos', async () => {
    const f = criarFalso()
    f.responder('dispositivos', {
      data: [
        { id: DISP, tipo: 'camera', rotulo: 'Celular', camera_id: null, usuario_anonimo_id: UID, pareado_em: '2026-11-27T12:00:00+00:00', revogado_em: null },
        { id: EP, tipo: 'tablet', rotulo: 'Novo tipo', camera_id: null, usuario_anonimo_id: null, pareado_em: null, revogado_em: null },
        { id: MIDIA, tipo: 'obs_camera', rotulo: 'OBS', camera_id: DISP, usuario_anonimo_id: null, pareado_em: null, revogado_em: '2026-11-27T13:00:00+00:00' },
      ],
    })
    expect(await f.repo.listarDispositivos()).toEqual([
      { id: DISP, tipo: 'camera', rotulo: 'Celular', cameraId: null, usuarioAnonimoId: UID, pareadoEm: '2026-11-27T12:00:00+00:00', revogadoEm: null },
      { id: MIDIA, tipo: 'obs_camera', rotulo: 'OBS', cameraId: DISP, usuarioAnonimoId: null, pareadoEm: null, revogadoEm: '2026-11-27T13:00:00+00:00' },
    ])
    expect(f.tirar()).toEqual([
      ['from', 'dispositivos'],
      ['select', 'id, tipo, rotulo, camera_id, usuario_anonimo_id, pareado_em, revogado_em'],
      ['order', 'tipo'],
    ])
    f.responder('dispositivos', { error: { code: '42501' }, status: 403 })
    expect(await motivoDe(f.repo.listarDispositivos())).toBe('negado')
  })

  test('erros-do-ao-vivo', async () => {
    expect(traduzirErroDoAoVivo({ code: '55000', message: 'só rascunho inicia' })).toBe('estado_invalido')
    expect(traduzirErroDoAoVivo({ code: '22023', message: 'episódio' })).toBe('invalido')
    expect(traduzirErroDoAoVivo({ code: '23505', message: 'episodios_um_ao_vivo' })).toBe('duplicado')
    expect(traduzirErroDoAoVivo({ code: '42501', message: 'sem permissão' }, 403)).toBe('negado')
    expect(traduzirErroDoAoVivo({ code: '42501', message: 'x' }, 401)).toBe('sessao_expirada')
    expect(traduzirErroDoAoVivo({ code: '55000' }, 401)).toBe('sessao_expirada')
    expect(traduzirErroDoAoVivo({ code: 'PGRST303' })).toBe('sessao_expirada')
    expect(traduzirErroDoAoVivo({ code: '', message: 'TypeError: Failed to fetch' }, 0)).toBe('rede')
    expect(traduzirErroDoAoVivo({ code: '23514' })).toBe('invalido')
    expect(traduzirErroDoAoVivo({ code: '23503' })).toBe('outro') // em_uso não existe no ao vivo
    expect(traduzirErroDoAoVivo({ code: 'XX000' }, 500)).toBe('outro')
    expect(traduzirErroDoAoVivo(null)).toBe('outro')

    // o motivo chega a quem chama, pelas funções do repositório
    const f = criarFalso()
    f.responder('iniciar_ao_vivo', { error: { code: '23505', message: 'x' }, status: 409 })
    expect(await motivoDe(f.repo.iniciar(EP))).toBe('duplicado')
    f.responder('encerrar_ao_vivo', { error: { code: '55000', message: 'x' }, status: 400 })
    expect(await motivoDe(f.repo.encerrar(EP))).toBe('estado_invalido')
    f.responder('definir_modo_teste', { error: { code: '22023', message: 'x' }, status: 400 })
    expect(await motivoDe(f.repo.definirModoTeste(EP))).toBe('invalido')
    f.responder('revogar_dispositivo', { error: { code: '', message: 'x' }, status: 0 })
    expect(await motivoDe(f.repo.revogar(DISP))).toBe('rede')
    f.responder('episodio_ativo', { error: { code: '42501', message: 'x' }, status: 401 })
    expect(await motivoDe(f.repo.episodioAtivo())).toBe('sessao_expirada')
    // a mensagem do servidor nunca vai para o erro
    f.responder('criar_codigo_pareamento', { error: { code: '22023', message: 'rótulo secreto' }, status: 400 })
    const e = await f.repo.criarCodigo({ tipo: 'camera', rotulo: 'x', dispositivoId: null, cameraId: null }).catch((x: unknown) => x)
    expect((e as Error).message).toBe('Erro do ao vivo: invalido')
  })
})

describe('criarRepositorioDoPalco', () => {
  test('palco-carrega', async () => {
    const f = criarFalso()
    f.responder('episodios', { data: [{ id: EP, titulo: 'Episódio 1', data: '2026-11-27', estado: 'rascunho' }] })
    f.responder('cenas', { data: [{ id: 'c1', nome_exibicao: 'Abertura', nome_obs: 'Cena Abertura', ordem: 0 }] })
    f.responder('sons', {
      data: [
        { id: 's1', midia_id: MIDIA, rotulo: 'aplauso', emoji: '👏', volume: 0.5, ordem: 1, midias: { caminho: `som/${MIDIA}.mp3` } },
        { id: 's2', midia_id: 'm2', rotulo: 'sem mídia legível', emoji: null, volume: 1, ordem: 2, midias: null },
      ],
    })
    f.responder('avisos', {
      data: [
        { id: 'a1', episodio_id: EP, titulo: 'Inscreva-se', texto: 'texto', link: null, imagem_midia_id: MIDIA, duracao_s: 10, ordem: 0, midias: { caminho: `imagem/${MIDIA}.png` } },
        { id: 'a2', episodio_id: EP, titulo: 'Sem imagem', texto: 't', link: 'https://revocast.test', imagem_midia_id: null, duracao_s: 8, ordem: 1, midias: null },
      ],
    })
    expect(await f.palco.carregar(EP)).toEqual({
      episodio: { id: EP, titulo: 'Episódio 1', data: '2026-11-27', estado: 'rascunho' },
      cenas: [{ id: 'c1', nomeExibicao: 'Abertura', nomeObs: 'Cena Abertura', ordem: 0 }],
      sons: [{ id: 's1', midiaId: MIDIA, rotulo: 'aplauso', emoji: '👏', volume: 0.5, ordem: 1, caminho: `som/${MIDIA}.mp3` }],
      avisos: [
        { id: 'a1', episodioId: EP, titulo: 'Inscreva-se', texto: 'texto', link: null, imagemMidiaId: MIDIA, duracaoS: 10, ordem: 0, caminhoDaImagem: `imagem/${MIDIA}.png` },
        { id: 'a2', episodioId: EP, titulo: 'Sem imagem', texto: 't', link: 'https://revocast.test', imagemMidiaId: null, duracaoS: 8, ordem: 1, caminhoDaImagem: null },
      ],
    })
    const feitas = f.tirar()
    const porTabela = (tabela: string) => {
      const i = feitas.findIndex((c) => c[0] === 'from' && c[1] === tabela)
      const fim = feitas.findIndex((c, j) => j > i && c[0] === 'from')
      return feitas.slice(i, fim < 0 ? undefined : fim)
    }
    expect(porTabela('episodios')).toEqual([['from', 'episodios'], ['select', 'id, titulo, data, estado'], ['eq', 'id', EP]])
    expect(porTabela('cenas')).toEqual([['from', 'cenas'], ['select', 'id, nome_exibicao, nome_obs, ordem'], ['order', 'ordem']])
    expect(porTabela('sons')).toEqual([['from', 'sons'], ['select', 'id, midia_id, rotulo, emoji, volume, ordem, midias(caminho)'], ['order', 'ordem']])
    expect(porTabela('avisos')).toEqual([
      ['from', 'avisos'],
      ['select', 'id, episodio_id, titulo, texto, link, imagem_midia_id, duracao_s, ordem, midias(caminho)'],
      ['eq', 'episodio_id', EP],
      ['order', 'ordem'],
    ])

    // episódio que não aparece (RLS ou apagado) ou com estado desconhecido → invalido; erro de uma lista → o motivo dela
    f.responder('episodios', { data: [] })
    expect(await motivoDe(f.palco.carregar(EP))).toBe('invalido')
    f.responder('episodios', { data: [{ id: EP, titulo: 't', data: '2026-11-27', estado: 'arquivado' }] })
    expect(await motivoDe(f.palco.carregar(EP))).toBe('invalido')
    f.responder('episodios', { data: [{ id: EP, titulo: 't', data: '2026-11-27', estado: 'ao_vivo' }] })
    f.responder('sons', { error: { code: '', message: 'x' }, status: 0 })
    expect(await motivoDe(f.palco.carregar(EP))).toBe('rede')

    f.responder('episodio_ativo', { data: [{ id: EP, modo: 'teste' }] })
    expect(await f.palco.episodioAtivo()).toEqual({ id: EP, modo: 'teste' })
  })

  test('palco-url-de-arquivo', async () => {
    expect(VALIDADE_NO_PALCO_S).toBe(3600)
    const f = criarFalso()
    expect(await f.palco.urlDoArquivo(`som/${MIDIA}.mp3`)).toBe('https://armazenamento.revocast.test/assinada?token=teste')
    expect(f.tirar()).toEqual([['storage.from', 'midias'], ['createSignedUrl', `som/${MIDIA}.mp3`, 3600]])

    f.assinada(async () => ({ data: null, error: { name: 'StorageUnknownError', message: 'Failed to fetch' } }))
    expect(await motivoDe(f.palco.urlDoArquivo(`som/${MIDIA}.mp3`))).toBe('rede')
    f.assinada(async () => ({ data: null, error: { name: 'StorageApiError', status: 400, statusCode: '404', message: 'Object not found' } }))
    expect(await motivoDe(f.palco.urlDoArquivo(`som/${MIDIA}.mp3`))).toBe('outro')
    f.assinada(async () => {
      throw new Error('lançado')
    })
    expect(await motivoDe(f.palco.urlDoArquivo(`som/${MIDIA}.mp3`))).toBe('outro')
    f.assinada(async () => ({ data: { signedUrl: '' }, error: null }))
    expect(await motivoDe(f.palco.urlDoArquivo(`som/${MIDIA}.mp3`))).toBe('outro')
  })

  test('palco-registra', async () => {
    const f = criarFalso()
    await f.palco.registrar({ episodioId: EP, origem: 'toque', acao: 'proximo_aviso', cenaId: null, somId: null, avisoId: 'a1', membroId: UID, teste: true })
    expect(f.tirar()).toEqual([
      ['from', 'registro_acoes'],
      ['insert', { episodio_id: EP, origem: 'toque', acao: 'proximo_aviso', cena_id: null, som_id: null, aviso_id: 'a1', membro_id: UID, teste: true }],
    ])
    f.responder('registro_acoes', { error: { code: '42501', message: 'x' }, status: 403 })
    expect(await motivoDe(f.palco.registrar({ episodioId: EP, origem: 'toque', acao: 'clipe', cenaId: null, somId: null, avisoId: null, membroId: UID, teste: false }))).toBe('negado')
  })
})
