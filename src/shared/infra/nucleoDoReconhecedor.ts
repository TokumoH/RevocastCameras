import type { GestureRecognizer, GestureRecognizerOptions } from '@mediapipe/tasks-vision'
import { CONFIANCA_MINIMA, ehGesto, type LeituraDoGesto } from '../../domains/captura/gestos'
import type { FalhaDoReconhecedor } from '../../domains/captura/portas'
import { GESTOS } from '../../domains/preparacao/gestos'
import { instalarGuardaDeRede, type EscopoDoWorker } from './guardaDeRede'
import { SHA256_DO_MODELO, SHA256_DO_WASM, conferirSha256 } from './integridadeDosGestos'

/*
 * Núcleo do reconhecedor de gestos (PLA-006, D8, D9, D11; revisão 1, I6 e N12; registro VER-063). Roda dentro do
 * worker (`reconhecedor.worker.ts`, que só o cria e liga as mensagens); tudo injetado, para o teste rodar sem o MediaPipe.
 * Daqui só o tipo do `@mediapipe/tasks-vision` é importado: o pacote entra por `carregarTarefas()` (o `import()`
 * dinâmico do worker), **depois** da guarda de rede e da conferência dos SHA-256.
 */

/** O que o núcleo usa do pacote (o `import('@mediapipe/tasks-vision')` do worker satisfaz este tipo). */
export interface TarefasDoMediapipe {
  GestureRecognizer: Pick<typeof GestureRecognizer, 'createFromOptions'>
}

type ReconhecedorDoMediapipe = Pick<GestureRecognizer, 'recognizeForVideo' | 'close'>

/** O resultado do `iniciar` no worker: `tempo` é medido na página (`reconhecedorMediapipe.ts`). */
export type ResultadoDoInicio = 'ok' | Exclude<FalhaDoReconhecedor, 'tempo'>

export interface DependenciasDoNucleo {
  /** `self` do worker. */
  escopo: EscopoDoWorker
  /** `location.origin` do worker (a origem do app). */
  origem: string
  /** As URLs por `?url` (D9): o carregador de módulo, o WASM e o modelo, todos da própria origem. */
  urls: { carregador: string; wasm: string; modelo: string }
  /** `crypto.subtle.digest('SHA-256', …)` no worker; sem `crypto.subtle`, rejeita → `integridade` (VER-062, N7). */
  digest: (b: ArrayBuffer) => Promise<ArrayBuffer>
  /** `URL.createObjectURL` no worker. */
  criarUrlDeBlob(b: Blob): string
  /** `URL.revokeObjectURL` no worker: a URL do WASM só vale durante as tentativas GPU/CPU (VER-063, rodada 1, N4). */
  revogarUrlDeBlob(u: string): void
  /** `() => import('@mediapipe/tasks-vision')` no worker; falso no teste. */
  carregarTarefas(): Promise<TarefasDoMediapipe>
  /** Relógio do `ms` da leitura; padrão `performance.now()`. */
  agora?: () => number
}

export interface NucleoDoReconhecedor {
  iniciar(): Promise<ResultadoDoInicio>
  /** Reconhece o quadro (sempre fechado, inclusive quando o MediaPipe lança, que propaga). Sem reconhecedor → gesto `null`. */
  reconhecer(q: ImageBitmap, em: number): LeituraDoGesto
  /** Tentativas de rede bloqueadas pela guarda (só o número, sem URL; N11). */
  bloqueios(): number
}

const SEM_LEITURA: LeituraDoGesto = Object.freeze({ gesto: null, confianca: 0, ms: 0 })

/** O melhor candidato do resultado: a maior pontuação (finita, de 0 a 1) entre todas as categorias; `None`, um nome fora dos 7 ou abaixo de `CONFIANCA_MINIMA` → gesto `null`. */
function lerResultado(resultado: unknown, ms: number): LeituraDoGesto {
  let melhor: { nome: unknown; pontuacao: number } | null = null
  const maos = (resultado as { gestures?: unknown } | null)?.gestures
  if (Array.isArray(maos)) {
    for (const categorias of maos) {
      if (!Array.isArray(categorias)) continue
      for (const c of categorias) {
        const pontuacao = (c as { score?: unknown } | null)?.score
        if (typeof pontuacao !== 'number' || !Number.isFinite(pontuacao) || pontuacao < 0 || pontuacao > 1) continue
        if (melhor === null || pontuacao > melhor.pontuacao) melhor = { nome: (c as { categoryName?: unknown }).categoryName, pontuacao }
      }
    }
  }
  if (melhor === null) return { gesto: null, confianca: 0, ms }
  const gesto = ehGesto(melhor.nome) && melhor.pontuacao >= CONFIANCA_MINIMA ? melhor.nome : null
  return { gesto, confianca: melhor.pontuacao, ms }
}

function fecharQuadro(q: ImageBitmap): void {
  try {
    q.close()
  } catch {
    /* quadro já solto */
  }
}

/**
 * O núcleo. `iniciar` (uma vez; a mesma promessa nas chamadas seguintes):
 * 1. instala a guarda de rede no escopo (antes de qualquer busca e de qualquer código do MediaPipe; I6);
 * 2. busca o WASM e o modelo pelo `escopo.fetch` já guardado;
 * 3. confere o SHA-256 dos dois (diferente ou `digest` que rejeita → `integridade`, nada do MediaPipe roda);
 * 4. só então `carregarTarefas()` e `createFromOptions` com o WASM como `blob:` de tipo `application/wasm` (N12) e o
 *    modelo conferido como `modelAssetBuffer` (F5); `delegate: 'GPU'` e, se falhar, `'CPU'` uma vez; os dois → `sem_suporte`.
 *
 * Antes de cada `createFromOptions`, o núcleo importa o carregador pelo `self.import` guardado e põe o `ModuleFactory`
 * dele no escopo: o `Wh` do MediaPipe apaga `self.ModuleFactory` depois de criar o módulo, e um módulo ES já importado não
 * roda de novo, então a tentativa com CPU depois de a GPU falhar no `setOptions` acharia "ModuleFactory not set." (VER-063).
 * Busca que falha ou carregador sem `default` → `outro`. A URL `blob:` do WASM é revogada depois das tentativas (N4).
 *
 * O núcleo não tem `fechar`: em produção quem encerra é a página, com `worker.terminate()`, que solta o módulo WASM, o
 * GPU e os quadros de uma vez (VER-063, rodada 1, N2).
 */
export function criarNucleoDoReconhecedor(d: DependenciasDoNucleo): NucleoDoReconhecedor {
  const escopo = d.escopo as EscopoDoWorker & { ModuleFactory?: unknown }
  const agora = d.agora ?? (() => performance.now())
  let bloqueados = 0
  let reconhecedor: ReconhecedorDoMediapipe | null = null
  let inicio: Promise<ResultadoDoInicio> | null = null

  async function buscar(url: string): Promise<ArrayBuffer> {
    const resposta = await escopo.fetch(url)
    if (!resposta.ok) throw new Error('busca recusada')
    return resposta.arrayBuffer()
  }

  async function devolverFabricaDoModulo(): Promise<void> {
    const importar = escopo.import
    if (typeof importar !== 'function') throw new Error('sem self.import')
    const modulo = (await importar(d.urls.carregador)) as { default?: unknown } | null
    if (typeof modulo?.default !== 'function') throw new Error('carregador sem ModuleFactory')
    escopo.ModuleFactory = modulo.default
  }

  function opcoes(delegate: 'GPU' | 'CPU', modelo: Uint8Array): GestureRecognizerOptions {
    return {
      baseOptions: { modelAssetBuffer: modelo, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      cannedGesturesClassifierOptions: { categoryAllowlist: GESTOS.map((g) => g.gesto) },
    }
  }

  async function carregar(): Promise<ResultadoDoInicio> {
    instalarGuardaDeRede(escopo, d.origem, () => {
      bloqueados += 1
    })
    let wasm: ArrayBuffer
    let modelo: ArrayBuffer
    try {
      ;[wasm, modelo] = await Promise.all([buscar(d.urls.wasm), buscar(d.urls.modelo)])
    } catch {
      return 'outro'
    }
    try {
      if (!(await conferirSha256(wasm, SHA256_DO_WASM, d.digest))) return 'integridade'
      if (!(await conferirSha256(modelo, SHA256_DO_MODELO, d.digest))) return 'integridade'
    } catch {
      return 'integridade'
    }
    let tarefas: TarefasDoMediapipe
    try {
      tarefas = await d.carregarTarefas()
    } catch {
      return 'outro'
    }
    const urlDoWasm = d.criarUrlDeBlob(new Blob([wasm], { type: 'application/wasm' }))
    try {
      return await criarComDelegado(tarefas, { wasmLoaderPath: d.urls.carregador, wasmBinaryPath: urlDoWasm }, new Uint8Array(modelo))
    } finally {
      try {
        d.revogarUrlDeBlob(urlDoWasm)
      } catch {
        /* sem efeito: o terminate solta o blob de qualquer jeito */
      }
    }
  }

  /** GPU e, se falhar, CPU uma vez, com o `ModuleFactory` devolvido antes de cada tentativa. */
  async function criarComDelegado(
    tarefas: TarefasDoMediapipe,
    fileset: { wasmLoaderPath: string; wasmBinaryPath: string },
    bytesDoModelo: Uint8Array,
  ): Promise<ResultadoDoInicio> {
    for (const delegate of ['GPU', 'CPU'] as const) {
      try {
        await devolverFabricaDoModulo()
      } catch {
        return 'outro'
      }
      try {
        reconhecedor = await tarefas.GestureRecognizer.createFromOptions(fileset, opcoes(delegate, bytesDoModelo))
        return 'ok'
      } catch {
        continue
      }
    }
    return 'sem_suporte'
  }

  return {
    iniciar() {
      inicio ??= carregar()
      return inicio
    },
    reconhecer(q, em) {
      try {
        if (reconhecedor === null) return SEM_LEITURA
        const comeco = agora()
        const resultado = reconhecedor.recognizeForVideo(q, em)
        return lerResultado(resultado, Math.max(0, agora() - comeco))
      } finally {
        fecharQuadro(q)
      }
    },
    bloqueios: () => bloqueados,
  }
}

/** Mensagens da página para o worker. */
export type MensagemParaOWorker = { tipo: 'iniciar' } | { tipo: 'quadro'; quadro: ImageBitmap; em: number }

/** Mensagens do worker para a página (D8): só o resultado do início e, por quadro, gesto, confiança e tempo. */
export type MensagemDoWorker =
  | { tipo: 'pronto' }
  | { tipo: 'falha'; motivo: Exclude<ResultadoDoInicio, 'ok'> }
  | { tipo: 'leitura'; gesto: LeituraDoGesto['gesto']; confianca: number; ms: number }
  | { tipo: 'sem_leitura' }

function ehQuadro(v: unknown): v is ImageBitmap {
  return typeof v === 'object' && v !== null && typeof (v as { close?: unknown }).close === 'function'
}

/**
 * O lado do worker das mensagens, uma de cada vez e em ordem (a resposta de um quadro sai antes de o próximo ser lido).
 * `iniciar` → `pronto` ou `falha`; `quadro` → `leitura` (só gesto, confiança e ms) ou `sem_leitura` (o MediaPipe lançou,
 * ou o quadro ou o tempo vieram fora da forma: o quadro é fechado e a página resolve `null`). Outra mensagem é ignorada.
 * Devolve a função do `onmessage` (com a promessa do atendimento, para o teste).
 */
export function atenderMensagens(nucleo: NucleoDoReconhecedor, postar: (m: MensagemDoWorker) => void): (dados: unknown) => Promise<void> {
  let fila: Promise<void> = Promise.resolve()

  async function atender(dados: unknown): Promise<void> {
    if (typeof dados !== 'object' || dados === null) return
    const m = dados as { tipo?: unknown; quadro?: unknown; em?: unknown }
    if (m.tipo === 'iniciar') {
      const r = await nucleo.iniciar()
      postar(r === 'ok' ? { tipo: 'pronto' } : { tipo: 'falha', motivo: r })
      return
    }
    if (m.tipo !== 'quadro') return
    if (!ehQuadro(m.quadro)) {
      postar({ tipo: 'sem_leitura' })
      return
    }
    if (typeof m.em !== 'number' || !Number.isFinite(m.em)) {
      fecharQuadro(m.quadro)
      postar({ tipo: 'sem_leitura' })
      return
    }
    let leitura: LeituraDoGesto
    try {
      leitura = nucleo.reconhecer(m.quadro, m.em)
    } catch {
      postar({ tipo: 'sem_leitura' })
      return
    }
    postar({ tipo: 'leitura', gesto: leitura.gesto, confianca: leitura.confianca, ms: leitura.ms })
  }

  return (dados) => {
    // um atendimento que lança (um `postMessage` recusado) não trava a fila dos seguintes
    fila = fila.then(() => atender(dados)).catch(() => undefined)
    return fila
  }
}
