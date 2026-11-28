import { afterEach, describe, expect, test, vi } from 'vitest'
import textoDoWorker from './reconhecedor.worker.ts?raw'
import textoDoNucleo from './nucleoDoReconhecedor.ts?raw'
import textoDaGuarda from './guardaDeRede.ts?raw'
import { GESTOS } from '../../domains/preparacao/gestos'
import { SHA256_DO_MODELO, SHA256_DO_WASM } from './integridadeDosGestos'
import type { EscopoDoWorker } from './guardaDeRede'
import { atenderMensagens, criarNucleoDoReconhecedor, type MensagemDoWorker, type TarefasDoMediapipe } from './nucleoDoReconhecedor'

/*
 * Núcleo do reconhecedor (PLA-006, D8, D9, D11; revisão 1, I6 e N12; registro VER-063). Tudo falso: o escopo do worker,
 * o `fetch` original, o `digest`, a URL de `blob:` e o MediaPipe (`carregarTarefas`). O modelo real nunca roda aqui
 * (Tarefa 9). O falso do MediaPipe imita o `Wh` do `vision_bundle.mjs` 1.2.3: importa o carregador pelo `self.import`
 * (só a primeira importação põe `ModuleFactory` no escopo, como o módulo em cache), exige `ModuleFactory` e o apaga.
 */

const ORIGEM = 'https://revocast.test'
const TELEMETRIA = 'https://odml.pa.googleapis.com/v1/log'
const URLS = { carregador: '/assets/carregador.js', wasm: '/assets/vision.wasm', modelo: '/assets/gesture_recognizer.task' }
const BYTES_DO_WASM = [0, 97, 115, 109]
const BYTES_DO_MODELO = [80, 75, 3, 4]

function hexParaBuffer(hex: string): ArrayBuffer {
  const b = new Uint8Array(hex.length / 2)
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return b.buffer
}

type Delegado = 'GPU' | 'CPU'
type Resultado = { gestures: { categoryName: string; score: number }[][] }

function montar(o: { wasm?: number[]; modelo?: number[]; delegadosQueFalham?: Delegado[]; resultado?: () => Resultado; digestRejeita?: boolean } = {}) {
  const registro: string[] = []
  const escopo = {} as EscopoDoWorker & { ModuleFactory?: unknown }
  const fetchOriginal = vi.fn(async (entrada: unknown) => {
    const url = String(entrada)
    registro.push(`fetch ${url}${escopo.fetch === (fetchOriginal as unknown) ? ' sem-guarda' : ''}`)
    const corpo = url === URLS.wasm ? (o.wasm ?? BYTES_DO_WASM) : url === URLS.modelo ? (o.modelo ?? BYTES_DO_MODELO) : []
    return new Response(new Uint8Array(corpo))
  })
  const fabricaDoModulo = function ModuleFactory() {}
  let moduloCarregado = false
  escopo.fetch = fetchOriginal as unknown as typeof fetch
  escopo.import = async (url: string) => {
    registro.push(`import ${url}`)
    if (!moduloCarregado) escopo.ModuleFactory = fabricaDoModulo
    moduloCarregado = true
    return { default: fabricaDoModulo }
  }
  const digest = vi.fn(async (b: ArrayBuffer) => {
    const bytes = [...new Uint8Array(b)]
    const nome = JSON.stringify(bytes) === JSON.stringify(BYTES_DO_WASM) ? 'wasm' : JSON.stringify(bytes) === JSON.stringify(BYTES_DO_MODELO) ? 'modelo' : 'outro'
    registro.push(`digest ${nome}`)
    if (o.digestRejeita) throw new TypeError('crypto.subtle ausente')
    return hexParaBuffer(nome === 'wasm' ? SHA256_DO_WASM : nome === 'modelo' ? SHA256_DO_MODELO : '00'.repeat(32))
  })
  const blobs: Blob[] = []
  const criarUrlDeBlob = vi.fn((b: Blob) => {
    blobs.push(b)
    registro.push('blob')
    return `blob:${ORIGEM}/5a1c9e2b-7d3f-4b6a-8c1d-2e3f4a5b6c7d`
  })
  const opcoes: { fileset: unknown; opcoes: Record<string, unknown> }[] = []
  const reconhecedor = {
    recognizeForVideo: vi.fn((_q: unknown, _em: number): Resultado => (o.resultado ?? (() => ({ gestures: [] })))()),
    close: vi.fn(),
  }
  const tarefas: TarefasDoMediapipe = {
    GestureRecognizer: {
      createFromOptions: vi.fn(async (fileset: { wasmLoaderPath: string }, op: Record<string, unknown>) => {
        const delegado = (op.baseOptions as { delegate: Delegado }).delegate
        registro.push(`createFromOptions ${delegado}`)
        opcoes.push({ fileset, opcoes: op })
        await escopo.import?.(fileset.wasmLoaderPath)
        if (typeof escopo.ModuleFactory !== 'function') throw new Error('ModuleFactory not set.')
        escopo.ModuleFactory = undefined
        if (o.delegadosQueFalham?.includes(delegado)) throw new Error(`falha do delegado ${delegado}`)
        return reconhecedor
      }) as unknown as TarefasDoMediapipe['GestureRecognizer']['createFromOptions'],
    },
  }
  let telemetriaDoFalso: unknown = null
  const carregarTarefas = vi.fn(async () => {
    registro.push('carregarTarefas')
    // o que o MediaPipe faria ao carregar: a telemetria (F6) tem de cair na guarda já instalada
    telemetriaDoFalso = await escopo.fetch(TELEMETRIA).then(
      () => 'saiu',
      (e: unknown) => (e instanceof TypeError ? 'bloqueada' : 'outro erro'),
    )
    return tarefas
  })
  let relogio = 1000
  const revogadas: string[] = []
  const revogarUrlDeBlob = (u: string) => {
    revogadas.push(u)
    registro.push('revogar')
  }
  const nucleo = criarNucleoDoReconhecedor({ escopo, origem: ORIGEM, urls: URLS, digest, criarUrlDeBlob, revogarUrlDeBlob, carregarTarefas, agora: () => relogio })
  return {
    nucleo,
    registro,
    escopo,
    fetchOriginal,
    digest,
    blobs,
    criarUrlDeBlob,
    revogadas,
    opcoes,
    reconhecedor,
    tarefas,
    carregarTarefas,
    telemetria: () => telemetriaDoFalso,
    avancar(ms: number) {
      relogio += ms
    },
  }
}

function quadroFalso() {
  return { close: vi.fn(), width: 256, height: 144 } as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('criarNucleoDoReconhecedor', () => {
  test('guarda-antes-do-import: a guarda entra antes de qualquer busca e de carregarTarefas; a telemetria do falso é bloqueada', async () => {
    const m = montar()
    expect(await m.nucleo.iniciar()).toBe('ok')
    expect(m.escopo.fetch).not.toBe(m.fetchOriginal)
    expect(m.registro.filter((r) => r.startsWith('fetch'))).toEqual([`fetch ${URLS.wasm}`, `fetch ${URLS.modelo}`])
    expect(m.registro.indexOf('carregarTarefas')).toBeGreaterThan(m.registro.indexOf(`fetch ${URLS.modelo}`))
    expect(m.telemetria()).toBe('bloqueada')
    expect(m.fetchOriginal).toHaveBeenCalledTimes(2)
    expect(m.nucleo.bloqueios()).toBe(1)
  })

  test('worker-sem-import-estatico: nenhum import estático do MediaPipe no worker, no núcleo nem na guarda (só ?url)', () => {
    const importsEstaticos = (codigo: string) =>
      [...codigo.matchAll(/^\s*(?:import|export)\b(?!\s+type\b)[^;'"]*?(?:from\s*)?['"]([^'"]+)['"]/gm)].map((m) => m[1])
    const doMediapipe = (codigo: string) => importsEstaticos(codigo).filter((o) => o.startsWith('@mediapipe/'))
    expect(doMediapipe(textoDoWorker).length).toBeGreaterThan(0) // as URLs (D9) vêm por ?url
    expect(doMediapipe(textoDoWorker).every((o) => o.endsWith('?url'))).toBe(true)
    expect(doMediapipe(textoDoNucleo)).toEqual([])
    expect(doMediapipe(textoDaGuarda)).toEqual([])
    // o MediaPipe só por import() dinâmico, passado ao núcleo como carregarTarefas
    expect(textoDoWorker).toMatch(/carregarTarefas:\s*\(\)\s*=>\s*import\(\s*['"]@mediapipe\/tasks-vision['"]\s*\)/)
  })

  test('nucleo-confere-antes-de-usar: busca WASM e modelo, digest dos dois, só então createFromOptions com blob: e o buffer conferido', async () => {
    const m = montar()
    expect(await m.nucleo.iniciar()).toBe('ok')
    const ordem = m.registro.filter((r) => !r.startsWith('import'))
    expect(ordem).toEqual([`fetch ${URLS.wasm}`, `fetch ${URLS.modelo}`, 'digest wasm', 'digest modelo', 'carregarTarefas', 'blob', 'createFromOptions GPU', 'revogar'])
    const { fileset, opcoes } = m.opcoes[0]
    expect(fileset).toEqual({ wasmLoaderPath: URLS.carregador, wasmBinaryPath: `blob:${ORIGEM}/5a1c9e2b-7d3f-4b6a-8c1d-2e3f4a5b6c7d` })
    const base = opcoes.baseOptions as { modelAssetBuffer: Uint8Array; modelAssetPath?: string }
    expect(base.modelAssetBuffer).toBeInstanceOf(Uint8Array)
    expect([...base.modelAssetBuffer]).toEqual(BYTES_DO_MODELO)
    expect(base).not.toHaveProperty('modelAssetPath')
    expect([...new Uint8Array(await m.blobs[0].arrayBuffer())]).toEqual(BYTES_DO_WASM)
  })

  test('blob-do-wasm-com-tipo: o Blob do WASM é application/wasm (N12: instantiateStreaming exige o tipo)', async () => {
    const m = montar()
    await m.nucleo.iniciar()
    expect(m.blobs).toHaveLength(1)
    expect(m.blobs[0].type).toBe('application/wasm')
  })

  test.each([
    ['WASM', { wasm: [9, 9, 9] }],
    ['modelo', { modelo: [9, 9, 9] }],
  ])('nucleo-recusa-hash-diferente: %s com hash diferente → integridade; nada do MediaPipe roda', async (_nome, o) => {
    const m = montar(o)
    expect(await m.nucleo.iniciar()).toBe('integridade')
    expect(m.carregarTarefas).not.toHaveBeenCalled()
    expect(m.tarefas.GestureRecognizer.createFromOptions).not.toHaveBeenCalled()
    expect(m.criarUrlDeBlob).not.toHaveBeenCalled()
    expect(m.registro.some((r) => r.startsWith('import'))).toBe(false)
  })

  test('nucleo-recusa-hash-diferente: digest que rejeita (sem crypto.subtle, VER-062) → integridade', async () => {
    const m = montar({ digestRejeita: true })
    expect(await m.nucleo.iniciar()).toBe('integridade')
    expect(m.carregarTarefas).not.toHaveBeenCalled()
  })

  test('busca que falha (rede ou status de erro) → outro, sem MediaPipe', async () => {
    const m = montar()
    m.fetchOriginal.mockImplementationOnce(async () => new Response('nao', { status: 404 }))
    expect(await m.nucleo.iniciar()).toBe('outro')
    expect(m.carregarTarefas).not.toHaveBeenCalled()
    const n = montar()
    n.fetchOriginal.mockImplementationOnce(async () => {
      throw new TypeError('rede')
    })
    expect(await n.nucleo.iniciar()).toBe('outro')
  })

  test('delegado-gpu-e-depois-cpu: GPU rejeita → CPU (com o ModuleFactory devolvido ao escopo); os dois rejeitam → sem_suporte', async () => {
    const m = montar({ delegadosQueFalham: ['GPU'] })
    expect(await m.nucleo.iniciar()).toBe('ok')
    expect(m.registro.filter((r) => r.startsWith('createFromOptions'))).toEqual(['createFromOptions GPU', 'createFromOptions CPU'])
    expect(m.criarUrlDeBlob).toHaveBeenCalledTimes(1) // o mesmo blob nas duas tentativas
    const n = montar({ delegadosQueFalham: ['GPU', 'CPU'] })
    expect(await n.nucleo.iniciar()).toBe('sem_suporte')
    expect(n.registro.filter((r) => r.startsWith('createFromOptions'))).toEqual(['createFromOptions GPU', 'createFromOptions CPU'])
  })

  test('opcoes-do-reconhecedor: VIDEO, uma mão, GPU e a lista dos 7 gestos', async () => {
    const m = montar()
    await m.nucleo.iniciar()
    const { opcoes } = m.opcoes[0]
    expect(opcoes.runningMode).toBe('VIDEO')
    expect(opcoes.numHands).toBe(1)
    expect((opcoes.baseOptions as { delegate: string }).delegate).toBe('GPU')
    expect(opcoes.cannedGesturesClassifierOptions).toEqual({ categoryAllowlist: GESTOS.map((g) => g.gesto) })
    expect((opcoes.cannedGesturesClassifierOptions as { categoryAllowlist: string[] }).categoryAllowlist).toHaveLength(7)
  })

  test.each<[string, Resultado, string | null, number]>([
    ['vazio (sem mão)', { gestures: [] }, null, 0],
    ['mão sem gesto', { gestures: [[]] }, null, 0],
    ['None', { gestures: [[{ categoryName: 'None', score: 0.95 }]] }, null, 0.95],
    ['Victory 0,69', { gestures: [[{ categoryName: 'Victory', score: 0.69 }]] }, null, 0.69],
    ['Victory 0,7 (no limiar)', { gestures: [[{ categoryName: 'Victory', score: 0.7 }]] }, 'Victory', 0.7],
    ['Victory 0,9', { gestures: [[{ categoryName: 'Victory', score: 0.9 }]] }, 'Victory', 0.9],
    ['dois candidatos → o maior', { gestures: [[{ categoryName: 'Thumb_Up', score: 0.75 }, { categoryName: 'ILoveYou', score: 0.88 }]] }, 'ILoveYou', 0.88],
    ['nome fora dos 7', { gestures: [[{ categoryName: 'Rock', score: 0.99 }]] }, null, 0.99],
    ['pontuação inválida', { gestures: [[{ categoryName: 'Victory', score: Number.NaN }]] }, null, 0],
    ['pontuação acima de 1 é descartada', { gestures: [[{ categoryName: 'Victory', score: 1.5 }, { categoryName: 'Thumb_Up', score: 0.8 }]] }, 'Thumb_Up', 0.8],
    ['pontuação negativa é descartada', { gestures: [[{ categoryName: 'Victory', score: -0.1 }]] }, null, 0],
  ])('leitura-do-resultado: %s', async (_nome, resultado, gesto, confianca) => {
    const m = montar({ resultado: () => resultado })
    await m.nucleo.iniciar()
    const q = quadroFalso()
    const leitura = m.nucleo.reconhecer(q, 1234)
    expect(leitura).toEqual({ gesto, confianca, ms: expect.any(Number) })
    expect(m.reconhecedor.recognizeForVideo).toHaveBeenCalledWith(q, 1234)
  })

  test('leitura-do-resultado: ms é o tempo do recognizeForVideo no relógio do worker', async () => {
    let m: ReturnType<typeof montar> | null = null
    m = montar({
      resultado: () => {
        m?.avancar(37)
        return { gestures: [] }
      },
    })
    await m.nucleo.iniciar()
    expect(m.nucleo.reconhecer(quadroFalso(), 1).ms).toBe(37)
  })

  test('quadro-fechado-sempre: close() também quando o reconhecer lança e antes de iniciar', async () => {
    const m = montar({
      resultado: () => {
        throw new Error('falha do grafo')
      },
    })
    const antes = quadroFalso()
    expect(m.nucleo.reconhecer(antes, 1)).toEqual({ gesto: null, confianca: 0, ms: 0 })
    expect(antes.close).toHaveBeenCalledTimes(1)
    await m.nucleo.iniciar()
    const q = quadroFalso()
    expect(() => m.nucleo.reconhecer(q, 2)).toThrow('falha do grafo')
    expect(q.close).toHaveBeenCalledTimes(1)
  })

  test('nucleo-sem-fechar: o núcleo não tem fechar (quem encerra é o terminate da página; rodada 1, N2)', () => {
    const m = montar()
    expect(Object.keys(m.nucleo).sort()).toEqual(['bloqueios', 'iniciar', 'reconhecer'])
  })

  test.each<[string, { delegadosQueFalham?: Delegado[] }, string]>([
    ['ok na GPU', {}, 'ok'],
    ['ok na CPU', { delegadosQueFalham: ['GPU'] }, 'ok'],
    ['sem_suporte', { delegadosQueFalham: ['GPU', 'CPU'] }, 'sem_suporte'],
  ])('blob-revogado: a URL do WASM é revogada depois das tentativas (%s; rodada 1, N4)', async (_nome, o, esperado) => {
    const m = montar(o)
    expect(await m.nucleo.iniciar()).toBe(esperado)
    expect(m.revogadas).toEqual([`blob:${ORIGEM}/5a1c9e2b-7d3f-4b6a-8c1d-2e3f4a5b6c7d`])
    // revogada só depois da última tentativa
    expect(m.registro.at(-1)).toBe('revogar')
  })

  test('blob-revogado: carregador sem default → outro, e a URL também é revogada', async () => {
    const m = montar()
    m.escopo.import = async () => ({})
    expect(await m.nucleo.iniciar()).toBe('outro')
    expect(m.revogadas).toHaveLength(1)
  })

  test('iniciar duas vezes: a mesma promessa, uma guarda e uma busca de cada', async () => {
    const m = montar()
    const [a, b] = await Promise.all([m.nucleo.iniciar(), m.nucleo.iniciar()])
    expect([a, b]).toEqual(['ok', 'ok'])
    expect(m.fetchOriginal).toHaveBeenCalledTimes(2)
  })

  test('quadro-nunca-no-console: nenhum console.* em nenhum caminho', async () => {
    const espioes = (['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => undefined))
    for (const o of [{}, { wasm: [1] }, { delegadosQueFalham: ['GPU', 'CPU'] as Delegado[] }, { digestRejeita: true }]) {
      const m = montar({
        ...o,
        resultado: () => {
          throw new Error('falha')
        },
      })
      await m.nucleo.iniciar()
      try {
        m.nucleo.reconhecer(quadroFalso(), 1)
      } catch {
        /* esperado */
      }
    }
    const m = montar({ resultado: () => ({ gestures: [[{ categoryName: 'Victory', score: 0.9 }]] }) })
    const postados: MensagemDoWorker[] = []
    const atender = atenderMensagens(m.nucleo, (msg) => postados.push(msg))
    await atender({ tipo: 'iniciar' })
    await atender({ tipo: 'quadro', quadro: quadroFalso(), em: 1 })
    await atender({ tipo: 'outra coisa' })
    await atender(null)
    for (const e of espioes) expect(e).not.toHaveBeenCalled()
  })
})

describe('atenderMensagens', () => {
  test('iniciar → pronto; quadro → leitura só com gesto, confiança e ms', async () => {
    const m = montar({ resultado: () => ({ gestures: [[{ categoryName: 'Victory', score: 0.9 }]] }) })
    const postados: MensagemDoWorker[] = []
    const atender = atenderMensagens(m.nucleo, (msg) => postados.push(msg))
    await atender({ tipo: 'iniciar' })
    const q = quadroFalso()
    await atender({ tipo: 'quadro', quadro: q, em: 10 })
    expect(postados).toEqual([{ tipo: 'pronto' }, { tipo: 'leitura', gesto: 'Victory', confianca: 0.9, ms: 0 }])
    expect(q.close).toHaveBeenCalledTimes(1)
  })

  test('falha do iniciar → falha com o motivo; reconhecer que lança → sem_leitura', async () => {
    const m = montar({
      wasm: [1],
    })
    const postados: MensagemDoWorker[] = []
    const atender = atenderMensagens(m.nucleo, (msg) => postados.push(msg))
    await atender({ tipo: 'iniciar' })
    expect(postados).toEqual([{ tipo: 'falha', motivo: 'integridade' }])
    const n = montar({
      resultado: () => {
        throw new Error('x')
      },
    })
    const postadosN: MensagemDoWorker[] = []
    const atenderN = atenderMensagens(n.nucleo, (msg) => postadosN.push(msg))
    await atenderN({ tipo: 'iniciar' })
    await atenderN({ tipo: 'quadro', quadro: quadroFalso(), em: 1 })
    expect(postadosN).toEqual([{ tipo: 'pronto' }, { tipo: 'sem_leitura' }])
  })

  test('fila: um quadro que chega com o iniciar ainda em curso só é atendido depois do pronto (em ordem)', async () => {
    let soltar: () => void = () => undefined
    const m = montar({ resultado: () => ({ gestures: [[{ categoryName: 'Victory', score: 0.9 }]] }) })
    const fetchReal = m.fetchOriginal.getMockImplementation()
    m.fetchOriginal.mockImplementationOnce(async (entrada: unknown) => {
      await new Promise<void>((r) => (soltar = r))
      return (fetchReal as (e: unknown) => Promise<Response>)(entrada)
    })
    const postados: MensagemDoWorker[] = []
    const atender = atenderMensagens(m.nucleo, (msg) => postados.push(msg))
    const a = atender({ tipo: 'iniciar' })
    const b = atender({ tipo: 'quadro', quadro: quadroFalso(), em: 1 })
    await new Promise<void>((r) => setTimeout(r, 0))
    expect(postados).toEqual([])
    soltar()
    await a
    await b
    expect(postados).toEqual([{ tipo: 'pronto' }, { tipo: 'leitura', gesto: 'Victory', confianca: 0.9, ms: 0 }])
  })

  test('fila: um postar que lança não trava as mensagens seguintes', async () => {
    const m = montar()
    const postados: MensagemDoWorker[] = []
    let primeira = true
    const atender = atenderMensagens(m.nucleo, (msg) => {
      if (primeira) {
        primeira = false
        throw new Error('DataCloneError')
      }
      postados.push(msg)
    })
    await atender({ tipo: 'iniciar' })
    await atender({ tipo: 'quadro', quadro: quadroFalso(), em: 1 })
    expect(postados).toEqual([{ tipo: 'leitura', gesto: null, confianca: 0, ms: 0 }])
  })

  test('mensagem fora da forma: ignorada; um quadro com tempo inválido é fechado sem reconhecer', async () => {
    const m = montar()
    const postados: MensagemDoWorker[] = []
    const atender = atenderMensagens(m.nucleo, (msg) => postados.push(msg))
    await atender({ tipo: 'iniciar' })
    const q = quadroFalso()
    await atender({ tipo: 'quadro', quadro: q, em: Number.NaN })
    await atender({ tipo: 'quadro', quadro: 'nao e quadro', em: 1 })
    await atender('iniciar')
    expect(q.close).toHaveBeenCalledTimes(1)
    expect(m.reconhecedor.recognizeForVideo).not.toHaveBeenCalled()
    expect(postados).toEqual([{ tipo: 'pronto' }, { tipo: 'sem_leitura' }, { tipo: 'sem_leitura' }])
  })
})
