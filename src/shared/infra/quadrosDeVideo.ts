import type { FluxoDeVideo, FonteDeQuadros, QuadroDeVideo } from '../../domains/captura/portas'

/*
 * Fonte de quadros reduzidos de um `MediaStream` (PLA-006, D10; revisão 1, I7; registro VER-063): a porta
 * `FonteDeQuadros` sobre um `<video>` **fora do DOM** (a tela preta continua sem `<video>` no documento; teste
 * `tela-preta-sem-video` da E4) e um canvas de `LARGURA_DO_QUADRO` px. O fluxo é o que a rota já tem (a câmera, por
 * `fluxoDaPrevia()`; o recebido, no OBS): nenhum `getUserMedia` novo. O quadro sai como `ImageBitmap` (transferível ao
 * worker; a página não o guarda).
 */

/** Largura do quadro que vai ao worker (D10); a altura segue a proporção do vídeo. */
export const LARGURA_DO_QUADRO = 256
/** Intervalo mínimo entre duas tentativas de `play()` com o vídeo parado (I7). */
export const INTERVALO_DO_PLAY_MS = 1000

type Canvas = OffscreenCanvas | HTMLCanvasElement
type Contexto2d = { drawImage(imagem: CanvasImageSource, x: number, y: number, l: number, a: number): void }

export interface DependenciasDaFonte {
  /** Padrão: `document.createElement('video')`, nunca anexado ao documento. */
  criarVideo?: () => HTMLVideoElement
  /** Padrão: `OffscreenCanvas` (F11) ou, se faltar, um `<canvas>` fora do DOM. */
  criarCanvas?: (l: number, a: number) => Canvas
  /** Padrão: `createImageBitmap`. */
  criarBitmap?: typeof createImageBitmap
  /** Padrão: `performance.now()`. */
  agora?: () => number
}

function criarCanvasPadrao(l: number, a: number): Canvas {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(l, a)
  const c = document.createElement('canvas')
  c.width = l
  c.height = a
  return c
}

/**
 * A fonte: cria o `<video>` (`muted`, `playsInline`, `autoplay`, `srcObject` = o fluxo) sem anexá-lo e chama `play()`
 * na hora. `quadro()`:
 * - fechada → `null`;
 * - `play()` rejeitado ou `video.paused` (um elemento destacado pode ficar pausado com `videoWidth` > 0 e dar sempre o
 *   mesmo quadro congelado, I7) → `null` e nova tentativa de `play()` no máximo a cada `INTERVALO_DO_PLAY_MS`;
 * - sem o quadro atual (`readyState` abaixo de `HAVE_CURRENT_DATA`) ou sem `videoWidth`/`videoHeight` → `null`;
 * - senão desenha o quadro atual num canvas `LARGURA_DO_QUADRO` × altura proporcional (o mesmo canvas enquanto as
 *   dimensões não mudam) e devolve `createImageBitmap(canvas)`; erro → `null`.
 *
 * `fechar()`: `pause()` e `srcObject = null` (solta o fluxo; não para a câmera, que é da rota); idempotente. Um bitmap
 * que chega depois do `fechar` é fechado e não sai.
 */
export function criarFonteDeQuadros(fluxo: FluxoDeVideo, d: DependenciasDaFonte = {}): FonteDeQuadros {
  const criarVideo = d.criarVideo ?? (() => document.createElement('video'))
  const criarCanvas = d.criarCanvas ?? criarCanvasPadrao
  const criarBitmap = d.criarBitmap ?? ((fonte: ImageBitmapSource) => createImageBitmap(fonte))
  const agora = d.agora ?? (() => performance.now())

  const video = criarVideo()
  video.muted = true
  video.playsInline = true
  video.autoplay = true
  video.srcObject = fluxo as unknown as MediaStream
  let fechada = false
  let playRecusado = false
  let ultimaTentativa = 0
  let canvas: { c: Canvas; l: number; a: number } | null = null

  function tocar(): void {
    ultimaTentativa = agora()
    let resultado: Promise<void> | undefined
    try {
      resultado = video.play()
    } catch {
      playRecusado = true
      return
    }
    // o `play()` de navegadores antigos não devolve promessa: aí vale só o `paused`; com promessa, o estado anterior fica
    // até ela responder (uma recusa nunca abre uma janela de quadros)
    if (resultado === undefined) {
      playRecusado = false
      return
    }
    resultado.then(
      () => {
        playRecusado = false
      },
      () => {
        playRecusado = true
      },
    )
  }

  tocar()

  return {
    async quadro() {
      if (fechada) return null
      if (playRecusado || video.paused) {
        if (agora() - ultimaTentativa >= INTERVALO_DO_PLAY_MS) tocar()
        return null
      }
      // `videoWidth` > 0 só garante os metadados (HAVE_METADATA): sem o quadro atual (HAVE_CURRENT_DATA = 2), o desenho
      // sairia vazio
      if (video.readyState < 2) return null
      const lv = video.videoWidth
      const av = video.videoHeight
      if (!(lv > 0) || !(av > 0)) return null
      const l = LARGURA_DO_QUADRO
      const a = Math.max(1, Math.round((LARGURA_DO_QUADRO * av) / lv))
      let bitmap: ImageBitmap
      try {
        if (canvas === null || canvas.l !== l || canvas.a !== a) canvas = { c: criarCanvas(l, a), l, a }
        const ctx = canvas.c.getContext('2d') as Contexto2d | null
        if (ctx === null) return null
        ctx.drawImage(video, 0, 0, l, a)
        bitmap = await criarBitmap(canvas.c)
      } catch {
        return null
      }
      if (fechada) {
        try {
          bitmap.close()
        } catch {
          /* já solto */
        }
        return null
      }
      return bitmap as unknown as QuadroDeVideo
    },
    fechar() {
      if (fechada) return
      fechada = true
      try {
        video.pause()
      } catch {
        /* sem efeito */
      }
      video.srcObject = null
      canvas = null
    },
  }
}
