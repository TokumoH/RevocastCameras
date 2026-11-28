import type { CameraDoAparelho, FaixaDeVideo, FalhaDaCamera, FluxoDeVideo, ManterTelaLigada } from '../../domains/captura/portas'

/*
 * A câmera do aparelho (`getUserMedia`), a tela ligada (Screen Wake Lock API, o `ManterTelaLigada` do DES-001 §6.1) e a
 * bateria (`getBattery`, onde existir), como fabricações puras das portas da Captura (PLA-005, D7, D13; F5, F7). O domínio
 * só vê a faixa e o fluxo como tipos opacos; quem guarda o `MediaStreamTrack` e o `MediaStream` é este arquivo. Nenhum
 * ouvinte do domínio roda dentro de um evento do navegador: tudo passa pelo `agendar` (0 ms ou o prazo).
 */

/** Restrições de captura (D7): só vídeo, câmera traseira de preferência, 720p30 (bateria e banda). */
export const RESTRICOES_DE_CAPTURA: MediaStreamConstraints = Object.freeze({
  audio: false,
  video: Object.freeze({
    facingMode: Object.freeze({ ideal: 'environment' }),
    width: Object.freeze({ ideal: 1280 }),
    height: Object.freeze({ ideal: 720 }),
    frameRate: Object.freeze({ ideal: 30, max: 30 }),
  }),
}) as MediaStreamConstraints
/** Faixa muda por este tempo conta como perdida (D7; DES-001 §15). */
export const MUDO_TOLERADO_MS = 3000
/** `getUserMedia` que nunca responde (F5): vira `sem_permissao`, com novo toque. */
export const ESPERA_DA_CAMERA_MS = 30_000

type Agendar = (f: () => void, ms: number) => () => void

const agendarPadrao: Agendar = (f, ms) => {
  const t = setTimeout(f, ms)
  return () => clearTimeout(t)
}

/** Erro do `getUserMedia` → motivo (F5). Só o `name` decide; a mensagem do navegador nunca sai daqui. */
function motivoDoErro(erro: unknown): Exclude<FalhaDaCamera, 'inseguro'> {
  const nome = typeof erro === 'object' && erro !== null && 'name' in erro ? (erro as { name: unknown }).name : undefined
  if (nome === 'NotAllowedError' || nome === 'SecurityError') return 'sem_permissao'
  if (nome === 'NotFoundError' || nome === 'OverconstrainedError') return 'sem_camera'
  return 'outro'
}

function pararFluxo(fluxo: MediaStream): void {
  for (const faixa of fluxo.getTracks()) {
    try {
      faixa.stop()
    } catch {
      /* já parada */
    }
  }
}

/** O fluxo atual e o que solta os ouvintes da faixa dele. */
interface Ligada {
  fluxo: MediaStream
  soltar: () => void
}

/**
 * A câmera traseira, só vídeo (D7; F5):
 * - sem `navigator.mediaDevices.getUserMedia` ou fora de contexto seguro → `inseguro`, sem chamar nada;
 * - `NotAllowedError`, `SecurityError` ou nenhuma resposta em `ESPERA_DA_CAMERA_MS` → `sem_permissao` (se a câmera
 *   responder depois, as faixas são paradas na hora); `NotFoundError`, `OverconstrainedError` ou fluxo sem faixa de
 *   vídeo → `sem_camera`; outro erro → `outro`;
 * - `ended`, ou `mute` por `MUDO_TOLERADO_MS` sem `unmute`, avisa `aoPerderFaixa` uma vez por faixa;
 * - religar (a faixa perdida) para o fluxo anterior antes do pedido novo; `desligar` para tudo (idempotente);
 * - `fluxoDaPrevia` devolve o fluxo já ligado (sem segundo `getUserMedia`).
 * Os padrões (`navigator`, `isSecureContext`) são lidos na hora de cada `ligar`, nunca ao criar.
 */
export function criarCameraDoAparelho(nav?: Pick<Navigator, 'mediaDevices'>, seguro?: () => boolean, agendar: Agendar = agendarPadrao): CameraDoAparelho {
  const ouvintes = new Set<() => void>()
  let atual: Ligada | null = null

  function avisarPerda(): void {
    agendar(() => {
      for (const f of [...ouvintes]) f()
    }, 0)
  }

  /** Ouve `ended` e `mute`/`unmute` da faixa; devolve o que solta tudo (ouvintes e prazo do mudo). */
  function ouvirFaixa(faixa: MediaStreamTrack): () => void {
    let perdida = false
    let cancelarMudo: (() => void) | null = null
    const perder = () => {
      if (perdida) return
      perdida = true
      cancelarMudo?.()
      cancelarMudo = null
      avisarPerda()
    }
    const aoMudo = () => {
      if (perdida || cancelarMudo !== null) return
      cancelarMudo = agendar(() => {
        cancelarMudo = null
        perder()
      }, MUDO_TOLERADO_MS)
    }
    const aoVoltarSom = () => {
      cancelarMudo?.()
      cancelarMudo = null
    }
    faixa.addEventListener('ended', perder)
    faixa.addEventListener('mute', aoMudo)
    faixa.addEventListener('unmute', aoVoltarSom)
    return () => {
      perdida = true
      cancelarMudo?.()
      cancelarMudo = null
      faixa.removeEventListener('ended', perder)
      faixa.removeEventListener('mute', aoMudo)
      faixa.removeEventListener('unmute', aoVoltarSom)
    }
  }

  function desligar(): void {
    const l = atual
    atual = null
    if (l === null) return
    l.soltar()
    pararFluxo(l.fluxo)
  }

  /** `getUserMedia` com prazo: `null` = sem resposta a tempo (o fluxo que chegar depois é parado na hora). */
  function pedirComPrazo(midia: MediaDevices): Promise<MediaStream | null> {
    return new Promise<MediaStream | null>((resolver, rejeitar) => {
      let esgotado = false
      const cancelar = agendar(() => {
        esgotado = true
        resolver(null)
      }, ESPERA_DA_CAMERA_MS)
      midia.getUserMedia(RESTRICOES_DE_CAPTURA).then(
        (fluxo) => {
          if (esgotado) {
            pararFluxo(fluxo)
            return
          }
          cancelar()
          resolver(fluxo)
        },
        (erro: unknown) => {
          if (esgotado) return
          cancelar()
          rejeitar(erro)
        },
      )
    })
  }

  return {
    async ligar() {
      const navegador = nav ?? (globalThis.navigator as Navigator | undefined)
      const contextoSeguro = seguro ?? (() => globalThis.isSecureContext === true)
      const midia = navegador?.mediaDevices as MediaDevices | undefined
      if (!contextoSeguro() || midia === undefined || typeof midia.getUserMedia !== 'function') return { ok: false, motivo: 'inseguro' }
      // Religando (o emissor só pede a câmera sem faixa boa): o fluxo anterior, com a faixa perdida, sai antes do pedido
      // novo, para soltar a câmera em aparelhos que não a abrem duas vezes (`NotReadableError`).
      desligar()
      let fluxo: MediaStream | null
      try {
        fluxo = await pedirComPrazo(midia)
      } catch (erro) {
        return { ok: false, motivo: motivoDoErro(erro) }
      }
      if (fluxo === null) return { ok: false, motivo: 'sem_permissao' }
      const faixa = fluxo.getVideoTracks()[0]
      if (faixa === undefined) {
        pararFluxo(fluxo)
        return { ok: false, motivo: 'sem_camera' }
      }
      desligar() // dois `ligar` ao mesmo tempo: fica só o último fluxo
      atual = { fluxo, soltar: ouvirFaixa(faixa) }
      return { ok: true, faixa: faixa as unknown as FaixaDeVideo }
    },
    aoPerderFaixa(f) {
      ouvintes.add(f)
      return () => {
        ouvintes.delete(f)
      }
    },
    desligar,
    fluxoDaPrevia() {
      return atual === null ? null : (atual.fluxo as unknown as FluxoDeVideo)
    },
  }
}

/** `navigator.wakeLock` pode faltar (navegador antigo ou contexto inseguro), embora o `lib.dom` o declare sempre. */
type NavegadorComTrava = { readonly wakeLock?: WakeLock }
type DocumentoVisivel = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>

/**
 * Tela ligada (F7): `travar` pede `wakeLock.request('screen')`; sem `wakeLock` ou recusado → `sem_trava`. Quando o sistema
 * solta a trava (página escondida), ela é pedida de novo ao voltar a ver (`visibilitychange` com `visible`); `soltar`
 * libera e para de ouvir a visibilidade.
 * **Um pedido por vez, uma sentinela só (VER-051, rodada 1, I1):** `travar` com a trava ativa devolve `travada` sem pedir;
 * com um pedido em curso (de outro `travar` ou do `visibilitychange`), devolve a promessa dele. A sentinela que chega
 * depois de `soltar` (sem um `travar` novo) é solta na hora; se outra já estiver ativa, a que chega é solta (nunca duas).
 */
export function criarManterTelaLigada(nav?: NavegadorComTrava, doc?: DocumentoVisivel): ManterTelaLigada {
  let querTravada = false
  let sentinela: WakeLockSentinel | null = null
  let pedidoEmCurso: Promise<'travada' | 'sem_trava'> | null = null
  let documentoOuvido: DocumentoVisivel | null = null

  function ativa(): boolean {
    return sentinela !== null && !sentinela.released
  }

  function aoMudarVisibilidade(): void {
    if (querTravada && documentoOuvido?.visibilityState === 'visible') void pedirUmaVez()
  }

  function ouvirVisibilidade(): void {
    if (documentoOuvido !== null) return
    const d = doc ?? (globalThis.document as Document | undefined)
    if (d === undefined) return
    documentoOuvido = d
    d.addEventListener('visibilitychange', aoMudarVisibilidade)
  }

  /** A trava ativa, o pedido em curso ou um pedido novo (nunca dois ao mesmo tempo). */
  function pedirUmaVez(): Promise<'travada' | 'sem_trava'> {
    if (ativa()) return Promise.resolve('travada')
    if (pedidoEmCurso !== null) return pedidoEmCurso
    const pedido = pedir().finally(() => {
      if (pedidoEmCurso === pedido) pedidoEmCurso = null
    })
    pedidoEmCurso = pedido
    return pedido
  }

  async function pedir(): Promise<'travada' | 'sem_trava'> {
    const navegador = nav ?? (globalThis.navigator as NavegadorComTrava | undefined)
    const trava = navegador?.wakeLock
    if (trava === undefined || typeof trava.request !== 'function') return 'sem_trava'
    let s: WakeLockSentinel
    try {
      s = await trava.request('screen')
    } catch {
      return 'sem_trava'
    }
    if (!querTravada) {
      void s.release().catch(() => {})
      return 'sem_trava'
    }
    // Defesa em profundidade: com `pedirUmaVez` (um pedido por vez e nenhum com a trava ativa) este bloco não é alcançável;
    // fica para que uma mudança futura no caminho do pedido nunca deixe duas sentinelas (VER-051, rodada 2, N5).
    if (ativa()) {
      void s.release().catch(() => {}) // nunca duas sentinelas
      return 'travada'
    }
    sentinela = s
    s.addEventListener('release', () => {
      if (sentinela === s) sentinela = null // solta pelo sistema: pedida de novo ao voltar a ver
    })
    return 'travada'
  }

  return {
    travar() {
      querTravada = true
      ouvirVisibilidade()
      return pedirUmaVez()
    },
    soltar() {
      querTravada = false
      documentoOuvido?.removeEventListener('visibilitychange', aoMudarVisibilidade)
      documentoOuvido = null
      const s = sentinela
      sentinela = null
      if (s !== null) void s.release().catch(() => {})
    },
  }
}

/** `navigator.getBattery` não está no `lib.dom` do TypeScript 7.0.2: interface local mínima. */
interface NavegadorComBateria {
  getBattery?: () => Promise<{ readonly level: unknown }>
}

/** Nível da bateria de 0 a 1 (D13), ou `null` onde o navegador não informa (sem `getBattery`, recusado ou fora da faixa). */
export async function lerBateria(nav?: Navigator): Promise<number | null> {
  const navegador = (nav ?? (globalThis.navigator as Navigator | undefined)) as NavegadorComBateria | undefined
  try {
    if (typeof navegador?.getBattery !== 'function') return null
    const { level } = await navegador.getBattery()
    return typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 1 ? level : null
  } catch {
    return null
  }
}
