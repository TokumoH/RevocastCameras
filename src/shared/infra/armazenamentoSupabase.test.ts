import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ErroDePreparacao } from '../../domains/preparacao/portas'
import {
  BUCKET_DE_MIDIAS,
  criarArmazenamentoSupabase,
  INATIVIDADE_DO_ENVIO_MS,
  motivoDaResposta,
  VALIDADE_DA_PREVIA_S,
} from './armazenamentoSupabase'

/**
 * `XMLHttpRequest` falso: registra `open`, cabeçalhos, `send` e `abort`; o teste dispara os eventos
 * (`upload.onprogress`, `upload.onload`, `onload` com status, `onerror`). Como no navegador, `abort()`
 * dispara `onabort` na hora (o adaptador não depende dele).
 */
class XhrFalso {
  upload: { onprogress: ((e: ProgressEvent) => void) | null; onload: ((e: ProgressEvent) => void) | null } = {
    onprogress: null,
    onload: null,
  }
  onload: ((e: Event) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onabort: ((e: Event) => void) | null = null
  status = 0
  responseText = ''
  aberto: [string, string] | null = null
  cabecalhos: Record<string, string> = {}
  corpo: unknown = undefined
  abortos = 0

  open(metodo: string, url: string) {
    this.aberto = [metodo, url]
  }
  setRequestHeader(nome: string, valor: string) {
    this.cabecalhos[nome] = valor
  }
  send(corpo: unknown) {
    this.corpo = corpo
  }
  abort() {
    this.abortos++
    this.onabort?.(new Event('abort'))
  }
  progredir(loaded: number, total: number, lengthComputable = true) {
    this.upload.onprogress?.({ loaded, total, lengthComputable } as ProgressEvent)
  }
  bytesEnviados() {
    this.upload.onload?.({} as ProgressEvent)
  }
  responder(status: number, corpo = '') {
    this.status = status
    this.responseText = corpo
    this.onload?.(new Event('load'))
  }
  falharRede() {
    this.status = 0
    this.onerror?.(new Event('error'))
  }
}

const URL_DO_PROJETO = 'https://exemplo.revocast.test/'
const CHAVE = 'sb_publishable_x'
const UUID = '0b6f3c1e-2a4d-4f8b-9c7e-1d2e3f4a5b6c'
const CAMINHO = `imagem/${UUID}.png`

type Sessao = { data: { session: { access_token: string } | null }; error: unknown }

/** XHR falso hostil: `abort()` dispara `onerror` e `onload` 200 na hora (pior caso para a ordem fim → abort). */
class XhrQueRespondeNoAbort extends XhrFalso {
  override abort() {
    this.abortos++
    this.falharRede()
    this.responder(200)
  }
}

function criarFalso(
  sessao: () => Promise<Sessao> = async () => ({ data: { session: { access_token: 'tok' } }, error: null }),
  Xhr: typeof XhrFalso = XhrFalso,
) {
  const xhrs: XhrFalso[] = []
  const bucket = {
    remove: vi.fn(async (_caminhos: string[]): Promise<{ data: unknown; error: unknown }> => ({ data: [], error: null })),
    createSignedUrl: vi.fn(
      async (_caminho: string, _validade: number): Promise<{ data: { signedUrl: string } | null; error: unknown }> => ({
        data: { signedUrl: 'https://exemplo.revocast.test/storage/v1/object/sign/midias/x?token=abc' },
        error: null,
      }),
    ),
  }
  const getSession = vi.fn(sessao)
  const storageFrom = vi.fn((_bucket: string) => bucket)
  const cliente = { auth: { getSession }, storage: { from: storageFrom } } as unknown as SupabaseClient
  const armazenamento = criarArmazenamentoSupabase(cliente, URL_DO_PROJETO, CHAVE, () => {
    const xhr = new Xhr()
    xhrs.push(xhr)
    return xhr as unknown as XMLHttpRequest
  })
  return { armazenamento, xhrs, bucket, getSession, storageFrom }
}

/** Deixa rodar as microtarefas (o `getSession` é aguardado antes de o XHR existir). */
async function esvaziar() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
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

/** Guarda o resultado da promessa sem deixar rejeição solta enquanto o teste segue. */
function acompanhar(promessa: Promise<void>) {
  const estado: { fim: 'pendente' | 'ok' | string } = { fim: 'pendente' }
  promessa.then(
    () => {
      estado.fim = 'ok'
    },
    (e: unknown) => {
      estado.fim = e instanceof ErroDePreparacao ? e.motivo : `inesperado: ${String(e)}`
    },
  )
  return estado
}

const corpo = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6])], { type: 'text/html' })
const opcoes = (sinal: AbortSignal = new AbortController().signal, aoProgredir: (f: number) => void = () => {}) => ({ aoProgredir, sinal })

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('constantes', () => {
  test('bucket, inatividade de 30 s e prévia de 10 min', () => {
    expect(BUCKET_DE_MIDIAS).toBe('midias')
    expect(INATIVIDADE_DO_ENVIO_MS).toBe(30_000)
    expect(VALIDADE_DA_PREVIA_S).toBe(600)
  })
})

describe('enviar', () => {
  test('envio-cabecalhos', async () => {
    const f = criarFalso()
    const b = corpo()
    const estado = acompanhar(f.armazenamento.enviar(CAMINHO, b, 'image/png', opcoes()))
    await esvaziar()
    expect(f.xhrs).toHaveLength(1)
    const [xhr] = f.xhrs
    expect(xhr.aberto).toEqual(['POST', `https://exemplo.revocast.test/storage/v1/object/midias/${CAMINHO}`])
    expect(xhr.aberto?.[1]).not.toContain('//storage')
    expect(xhr.cabecalhos).toEqual({
      authorization: 'Bearer tok',
      apikey: CHAVE,
      'x-upsert': 'false',
      'cache-control': 'max-age=3600',
      'content-type': 'image/png', // o tipo detectado, nunca o `type` que o navegador deu ao Blob
    })
    expect(xhr.corpo).toBe(b)
    xhr.responder(200, '{"Key":"midias/x"}')
    await esvaziar()
    expect(estado.fim).toBe('ok')

    // caminho com caractere fora de [a-z0-9/.-] → lança antes de abrir (e antes de ler a sessão)
    const recusados = [
      'imagem/../../outro/x.png', // só minúsculas: recusado pela forma, não pela maiúscula
      `imagem/../${UUID}.png`,
      `imagem/./${UUID}.png`,
      `som/${UUID}.png`, // extensão de imagem na pasta de som
      `imagem/${UUID}.mp3`,
      `video/${UUID}.mp4`,
      `imagem/sub/${UUID}.png`,
      `imagem/${UUID.slice(0, -1)}.png`,
      `imagem/${UUID}.png?x=1`,
      `imagem/${UUID}.PNG`,
      `imagem/${UUID} .png`,
      `imagem\\${UUID}.png`,
      '',
    ]
    for (const ruim of recusados) {
      let fim: unknown = 'pendente'
      f.armazenamento.enviar(ruim, b, 'image/png', opcoes()).then(
        () => (fim = 'ok'),
        (e: unknown) => (fim = e),
      )
      await esvaziar()
      expect(fim instanceof Error ? fim.message : fim, ruim).toBe('caminho inválido')
      expect(f.xhrs, ruim).toHaveLength(1)
    }
    expect(f.xhrs).toHaveLength(1)
    expect(f.getSession).toHaveBeenCalledTimes(1)

    // controle: os 8 formatos que o domínio gera passam
    for (const bom of ['mp3', 'wav', 'ogg', 'm4a'].map((e) => `som/${UUID}.${e}`).concat(['png', 'jpg', 'webp', 'gif'].map((e) => `imagem/${UUID}.${e}`))) {
      const estado = acompanhar(f.armazenamento.enviar(bom, b, 'image/png', opcoes()))
      await esvaziar()
      expect(f.xhrs[f.xhrs.length - 1].aberto?.[1], bom).toBe(`https://exemplo.revocast.test/storage/v1/object/midias/${bom}`)
      f.xhrs[f.xhrs.length - 1].responder(200)
      await esvaziar()
      expect(estado.fim, bom).toBe('ok')
    }
  })

  test('envio-token-na-hora', async () => {
    const tokens = ['tok1', 'tok2']
    const f = criarFalso(async () => ({ data: { session: { access_token: tokens.shift() ?? 'nenhum' } }, error: null }))
    for (const esperado of ['Bearer tok1', 'Bearer tok2']) {
      const estado = acompanhar(f.armazenamento.enviar(CAMINHO, corpo(), 'image/png', opcoes()))
      await esvaziar()
      const xhr = f.xhrs[f.xhrs.length - 1]
      expect(xhr.cabecalhos.authorization).toBe(esperado)
      xhr.responder(200)
      await esvaziar()
      expect(estado.fim).toBe('ok')
    }
    expect(f.xhrs).toHaveLength(2)
    expect(f.getSession).toHaveBeenCalledTimes(2)
  })

  test('envio-com-progresso', async () => {
    const f = criarFalso()
    const aoProgredir = vi.fn()
    const estado = acompanhar(f.armazenamento.enviar(CAMINHO, corpo(), 'image/png', opcoes(undefined, aoProgredir)))
    await esvaziar()
    const [xhr] = f.xhrs
    xhr.progredir(5, 10)
    expect(aoProgredir).toHaveBeenCalledWith(0.5)
    xhr.progredir(7, 0, false)
    expect(aoProgredir).toHaveBeenCalledTimes(1)
    xhr.progredir(0, 0, true) // total 0 com lengthComputable: nunca aoProgredir(NaN)
    expect(aoProgredir).toHaveBeenCalledTimes(1)
    expect(aoProgredir.mock.calls.flat().some((v) => Number.isNaN(v))).toBe(false)
    xhr.progredir(10, 10)
    expect(aoProgredir).toHaveBeenLastCalledWith(1)
    xhr.responder(200)
    await esvaziar()
    expect(estado.fim).toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
  })

  test('envio-cancelado', async () => {
    const f = criarFalso()
    const controle = new AbortController()
    const estado = acompanhar(f.armazenamento.enviar(CAMINHO, corpo(), 'image/png', opcoes(controle.signal)))
    await esvaziar()
    const [xhr] = f.xhrs
    controle.abort()
    await esvaziar()
    expect(xhr.abortos).toBe(1)
    expect(estado.fim).toBe('cancelado')
    expect(vi.getTimerCount()).toBe(0)
    // uma resposta que chegue depois do cancelamento não muda nada
    xhr.responder(200)
    await esvaziar()
    expect(estado.fim).toBe('cancelado')

    // sinal já abortado antes: rejeita sem ler a sessão e sem abrir
    const jaAbortado = new AbortController()
    jaAbortado.abort()
    expect(await motivoDe(f.armazenamento.enviar(CAMINHO, corpo(), 'image/png', opcoes(jaAbortado.signal)))).toBe('cancelado')
    expect(f.xhrs).toHaveLength(1)
    expect(f.getSession).toHaveBeenCalledTimes(1)
  })

  test('cancelar-durante-sessao', async () => {
    let liberar: () => void = () => {}
    const f = criarFalso(
      () =>
        new Promise<Sessao>((resolver) => {
          liberar = () => resolver({ data: { session: { access_token: 'tok' } }, error: null })
        }),
    )
    const controle = new AbortController()
    const estado = acompanhar(f.armazenamento.enviar(CAMINHO, corpo(), 'image/png', opcoes(controle.signal)))
    await esvaziar()
    expect(f.getSession).toHaveBeenCalledTimes(1)
    controle.abort() // o evento 'abort' passa enquanto a sessão ainda está sendo lida
    liberar()
    await esvaziar()
    expect(estado.fim).toBe('cancelado')
    expect(f.xhrs).toHaveLength(0) // o XHR nunca foi criado nem aberto
  })

  test('envio-solta-ouvinte', async () => {
    const fins: [string, (xhr: XhrFalso, controle: AbortController) => Promise<void>, string][] = [
      ['sucesso', async (xhr) => xhr.responder(201), 'ok'],
      ['erro HTTP', async (xhr) => xhr.responder(403, ''), 'negado'],
      ['onerror', async (xhr) => xhr.falharRede(), 'rede'],
      ['corte', async () => void (await vi.advanceTimersByTimeAsync(INATIVIDADE_DO_ENVIO_MS)), 'sem_resposta'],
      ['cancelado', async (_xhr, controle) => controle.abort(), 'cancelado'],
    ]
    for (const [nome, terminar, fimEsperado] of fins) {
      const f = criarFalso()
      const controle = new AbortController()
      const adicionar = vi.spyOn(controle.signal, 'addEventListener')
      const remover = vi.spyOn(controle.signal, 'removeEventListener')
      const estado = acompanhar(f.armazenamento.enviar(CAMINHO, corpo(), 'image/png', opcoes(controle.signal)))
      await esvaziar()
      await terminar(f.xhrs[0], controle)
      await esvaziar()
      expect(estado.fim, nome).toBe(fimEsperado)
      const deAbort = adicionar.mock.calls.filter((c) => c[0] === 'abort')
      expect(deAbort, nome).toHaveLength(1)
      const removidos = remover.mock.calls.filter((c) => c[0] === 'abort')
      expect(removidos, nome).toHaveLength(1)
      expect(removidos[0][1], nome).toBe(deAbort[0][1])
      expect(vi.getTimerCount(), nome).toBe(0)
    }
  })

  test('envio-sem-progresso-corta', async () => {
    const f = criarFalso()
    const controle = new AbortController()
    const remover = vi.spyOn(controle.signal, 'removeEventListener')
    const aoProgredir = vi.fn()
    const estado = acompanhar(f.armazenamento.enviar(CAMINHO, corpo(), 'image/png', opcoes(controle.signal, aoProgredir)))
    await esvaziar()
    const [xhr] = f.xhrs

    await vi.advanceTimersByTimeAsync(INATIVIDADE_DO_ENVIO_MS - 1) // 29 999 ms sem evento
    expect(xhr.abortos).toBe(0)
    expect(estado.fim).toBe('pendente')

    xhr.progredir(1, 10) // o progresso zera a contagem
    await vi.advanceTimersByTimeAsync(INATIVIDADE_DO_ENVIO_MS - 1)
    expect(xhr.abortos).toBe(0)
    expect(estado.fim).toBe('pendente')
    await vi.advanceTimersByTimeAsync(1) // 30 000 ms desde o último progresso
    expect(xhr.abortos).toBe(1)
    expect(estado.fim).toBe('sem_resposta')
    expect(vi.getTimerCount()).toBe(0)

    // guarda de fim único: eventos que cheguem depois do corte não mudam nada
    xhr.progredir(9, 10)
    xhr.responder(200)
    await esvaziar()
    expect(estado.fim).toBe('sem_resposta')
    expect(aoProgredir).toHaveBeenCalledTimes(1)
    expect(remover.mock.calls.filter((c) => c[0] === 'abort')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(xhr.abortos).toBe(1)
  })

  test('decide-o-fim-antes-do-abort', async () => {
    const semSessaoPadrao = undefined
    // cancelado: o onerror/onload disparados dentro do abort() não trocam o motivo
    const f = criarFalso(semSessaoPadrao, XhrQueRespondeNoAbort)
    const controle = new AbortController()
    const cancelado = acompanhar(f.armazenamento.enviar(CAMINHO, corpo(), 'image/png', opcoes(controle.signal)))
    await esvaziar()
    controle.abort()
    await esvaziar()
    expect(f.xhrs[0].abortos).toBe(1)
    expect(cancelado.fim).toBe('cancelado')

    // corte: idem para sem_resposta
    const g = criarFalso(semSessaoPadrao, XhrQueRespondeNoAbort)
    const cortado = acompanhar(g.armazenamento.enviar(CAMINHO, corpo(), 'image/png', opcoes()))
    await esvaziar()
    await vi.advanceTimersByTimeAsync(INATIVIDADE_DO_ENVIO_MS)
    expect(g.xhrs[0].abortos).toBe(1)
    expect(cortado.fim).toBe('sem_resposta')
    expect(vi.getTimerCount()).toBe(0)
  })

  test('corte-para-no-fim-do-envio', async () => {
    const f = criarFalso()
    const estado = acompanhar(f.armazenamento.enviar(CAMINHO, corpo(), 'image/png', opcoes()))
    await esvaziar()
    const [xhr] = f.xhrs
    xhr.progredir(10, 10)
    xhr.bytesEnviados()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(2 * INATIVIDADE_DO_ENVIO_MS) // 60 s esperando a resposta
    expect(xhr.abortos).toBe(0)
    expect(estado.fim).toBe('pendente')
    xhr.responder(200)
    await esvaziar()
    expect(estado.fim).toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
  })

  const comCorpo = (codigo: string) => JSON.stringify({ statusCode: codigo, error: 'Erro', message: 'texto do servidor' })
  const respostas: [string, number, string, string][] = [
    // o statusCode do corpo vem primeiro (o Storage costuma responder 400 com ele)
    ['RLS no corpo', 400, '{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}', 'negado'],
    ['já existe', 400, '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}', 'duplicado'],
    ['grande demais', 400, comCorpo('413'), 'invalido'],
    ['token no corpo', 400, comCorpo('401'), 'sessao_expirada'],
    ['tipo recusado (415)', 400, comCorpo('415'), 'invalido'],
    ['tipo recusado (422)', 400, comCorpo('422'), 'invalido'],
    ['bucket inexistente', 400, comCorpo('404'), 'outro'],
    // sem statusCode no corpo: o status HTTP
    ['401 vazio', 401, '', 'sessao_expirada'],
    ['403 não JSON', 403, '<html>Forbidden</html>', 'negado'],
    ['409 sem o campo', 409, '{"error":"x"}', 'duplicado'],
    ['413', 413, '', 'invalido'],
    ['415', 415, '', 'invalido'],
    ['400', 400, '', 'invalido'],
    ['500', 500, '', 'outro'],
    ['statusCode numérico é ignorado', 500, '{"statusCode":403}', 'outro'],
    ['statusCode vazio conta como ausente', 403, '{"statusCode":"","error":"x"}', 'negado'],
    ['code sem JWT inválido não é usado', 403, '{"code":"AccessDenied","error":"x"}', 'negado'],
    // JWT inválido ou expirado (VER-032): o campo `error` ou `code` do corpo vence o statusCode
    ['InvalidJWT com statusCode 400', 400, '{"statusCode":"400","error":"InvalidJWT","message":"exp claim timestamp check failed"}', 'sessao_expirada'],
    ['InvalidJWT com statusCode 403', 403, '{"statusCode":"403","error":"InvalidJWT","message":"exp claim timestamp check failed"}', 'sessao_expirada'],
    ['InvalidJWT em minúsculas', 400, '{"statusCode":"400","error":"invalidjwt"}', 'sessao_expirada'],
    ['InvalidJWT no code', 400, '{"statusCode":"400","code":"InvalidJWT"}', 'sessao_expirada'],
    ['InvalidJWT sem statusCode', 400, '{"error":"InvalidJWT"}', 'sessao_expirada'],
    ['403 sem InvalidJWT segue negado', 400, '{"statusCode":"403","error":"Unauthorized","message":"InvalidJWT"}', 'negado'],
    ['JSON nulo', 403, 'null', 'negado'],
  ]

  test.each(respostas)('envio-respostas: %s (motivoDaResposta)', (_nome, status, texto, motivo) => {
    expect(motivoDaResposta(status, texto)).toBe(motivo)
  })

  test.each(respostas)('envio-respostas: %s (pelo XHR)', async (_nome, status, texto, motivo) => {
    const f = criarFalso()
    const promessa = f.armazenamento.enviar(CAMINHO, corpo(), 'image/png', opcoes())
    const erroPromessa = promessa.then(
      () => null,
      (e: unknown) => e,
    )
    await esvaziar()
    f.xhrs[0].responder(status, texto)
    const erro = await erroPromessa
    expect(erro).toBeInstanceOf(ErroDePreparacao)
    expect((erro as ErroDePreparacao).motivo).toBe(motivo)
    // nenhum texto do corpo vai para a mensagem do erro
    expect((erro as Error).message).not.toMatch(/servidor|row-level|exists|Forbidden|Unauthorized/)
  })

  test('envio-respostas: onerror (status 0) → rede', async () => {
    const f = criarFalso()
    const estado = acompanhar(f.armazenamento.enviar(CAMINHO, corpo(), 'image/png', opcoes()))
    await esvaziar()
    f.xhrs[0].falharRede()
    await esvaziar()
    expect(estado.fim).toBe('rede')
    expect(vi.getTimerCount()).toBe(0)
  })

  test('envio-sem-sessao', async () => {
    const espioes = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
    const casos: [string, () => Promise<Sessao>, string][] = [
      ['sem sessão', async () => ({ data: { session: null }, error: null }), 'sessao_expirada'],
      ['token vazio', async () => ({ data: { session: { access_token: '' } }, error: null }), 'sessao_expirada'],
      ['erro do auth', async () => ({ data: { session: null }, error: new Error('Failed to fetch') }), 'rede'],
      [
        'erro do auth com sessão (expirada, rede caída)',
        async () => ({ data: { session: { access_token: 'sigilo7' } }, error: new Error('x') }),
        'rede',
      ],
      ['getSession lança', async () => Promise.reject(new Error('quebrou')), 'rede'],
    ]
    for (const [nome, sessao, motivo] of casos) {
      const f = criarFalso(sessao)
      expect(await motivoDe(f.armazenamento.enviar(CAMINHO, corpo(), 'image/png', opcoes())), nome).toBe(motivo)
      expect(f.xhrs, nome).toHaveLength(0)
    }

    // um envio completo, com erro HTTP, também não registra o token em console
    const f = criarFalso(async () => ({ data: { session: { access_token: 'sigilo7' } }, error: null }))
    const estado = acompanhar(f.armazenamento.enviar(CAMINHO, corpo(), 'image/png', opcoes()))
    await esvaziar()
    f.xhrs[0].responder(403, comCorpo('403'))
    await esvaziar()
    expect(estado.fim).toBe('negado')
    for (const espiao of espioes) {
      expect(JSON.stringify(espiao.mock.calls)).not.toContain('sigilo7')
    }
  })

  test('falha-ao-montar-o-envio-solta-tudo', async () => {
    // XHR que lança ao abrir (por exemplo, recusado pelo navegador): vira ErroDePreparacao e nada fica pendurado
    const f = criarFalso()
    const controle = new AbortController()
    const remover = vi.spyOn(controle.signal, 'removeEventListener')
    vi.spyOn(XhrFalso.prototype, 'open').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(await motivoDe(f.armazenamento.enviar(CAMINHO, corpo(), 'image/png', opcoes(controle.signal)))).toBe('outro')
    expect(remover.mock.calls.filter((c) => c[0] === 'abort')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('remover e prévia', () => {
  test('remover-e-previa', async () => {
    const f = criarFalso()
    await f.armazenamento.remover(CAMINHO)
    expect(f.storageFrom).toHaveBeenCalledWith('midias')
    expect(f.bucket.remove).toHaveBeenCalledWith([CAMINHO])

    f.bucket.remove.mockResolvedValueOnce({ data: null, error: { name: 'StorageApiError', status: 400, statusCode: '403', message: 'x' } })
    expect(await motivoDe(f.armazenamento.remover(CAMINHO))).toBe('negado')
    f.bucket.remove.mockResolvedValueOnce({ data: null, error: { name: 'StorageApiError', status: 400, statusCode: '400', code: 'InvalidJWT', message: 'x' } })
    expect(await motivoDe(f.armazenamento.remover(CAMINHO))).toBe('sessao_expirada')
    f.bucket.remove.mockResolvedValueOnce({ data: null, error: { name: 'StorageApiError', status: 403, statusCode: 'InvalidJWT', message: 'x' } })
    expect(await motivoDe(f.armazenamento.remover(CAMINHO))).toBe('sessao_expirada')
    f.bucket.remove.mockResolvedValueOnce({ data: null, error: { name: 'StorageApiError', status: 403, statusCode: '403', code: 'AccessDenied', message: 'InvalidJWT' } })
    expect(await motivoDe(f.armazenamento.remover(CAMINHO))).toBe('negado')
    f.bucket.remove.mockResolvedValueOnce({ data: null, error: { name: 'StorageUnknownError', message: 'Failed to fetch' } })
    expect(await motivoDe(f.armazenamento.remover(CAMINHO))).toBe('rede')
    f.bucket.remove.mockRejectedValueOnce(new Error('inesperado'))
    expect(await motivoDe(f.armazenamento.remover(CAMINHO))).toBe('outro')

    expect(await f.armazenamento.urlDePrevia(CAMINHO)).toBe('https://exemplo.revocast.test/storage/v1/object/sign/midias/x?token=abc')
    expect(f.bucket.createSignedUrl).toHaveBeenCalledWith(CAMINHO, 600)

    f.bucket.createSignedUrl.mockResolvedValueOnce({ data: null, error: { name: 'StorageApiError', status: 400, statusCode: '404', message: 'Object not found' } })
    expect(await motivoDe(f.armazenamento.urlDePrevia(CAMINHO))).toBe('outro')
    f.bucket.createSignedUrl.mockResolvedValueOnce({ data: null, error: { name: 'StorageApiError', status: 401, statusCode: '', message: 'x' } })
    expect(await motivoDe(f.armazenamento.urlDePrevia(CAMINHO))).toBe('sessao_expirada')
    f.bucket.createSignedUrl.mockResolvedValueOnce({ data: null, error: { name: 'StorageApiError', status: 403, statusCode: '403', code: 'InvalidJWT', message: 'x' } })
    expect(await motivoDe(f.armazenamento.urlDePrevia(CAMINHO))).toBe('sessao_expirada')
    f.bucket.createSignedUrl.mockResolvedValueOnce({ data: null, error: null })
    expect(await motivoDe(f.armazenamento.urlDePrevia(CAMINHO))).toBe('outro')
    f.bucket.createSignedUrl.mockRejectedValueOnce(new Error('inesperado'))
    expect(await motivoDe(f.armazenamento.urlDePrevia(CAMINHO))).toBe('outro')
  })
})
