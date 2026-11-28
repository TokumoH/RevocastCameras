import { afterEach, describe, expect, test, vi } from 'vitest'
import type { FluxoDeVideo } from '../../domains/captura/portas'
import { INTERVALO_DO_PLAY_MS, LARGURA_DO_QUADRO, criarFonteDeQuadros } from './quadrosDeVideo'

/*
 * Fonte de quadros (PLA-006, D10; revisão 1, I7; registro VER-063). Vídeo, canvas e `createImageBitmap` falsos: o
 * `<video>` nunca vai ao documento, toca por `play()` explícito e só dá quadro tocando e com dimensões.
 */

class VideoFalso {
  muted = false
  playsInline = false
  autoplay = false
  srcObject: unknown = null
  paused = true
  videoWidth = 1280
  videoHeight = 720
  readyState = 4
  plays = 0
  pauses = 0
  responderPlay: 'resolve' | 'rejeita' = 'resolve'
  play(): Promise<void> {
    this.plays += 1
    this.paused = false
    if (this.responderPlay === 'rejeita') {
      this.paused = true
      return Promise.reject(new DOMException('sem gesto do usuário', 'NotAllowedError'))
    }
    return Promise.resolve()
  }
  pause(): void {
    this.pauses += 1
    this.paused = true
  }
}

function montar(o: { play?: 'resolve' | 'rejeita'; videoDoDocumento?: boolean } = {}) {
  const video = new VideoFalso()
  video.responderPlay = o.play ?? 'resolve'
  const desenhos: unknown[][] = []
  const canvases: { largura: number; altura: number; width: number; height: number }[] = []
  const criarCanvas = vi.fn((largura: number, altura: number) => {
    const c = {
      largura,
      altura,
      width: largura,
      height: altura,
      getContext: (tipo: string) => (tipo === '2d' ? { drawImage: (...a: unknown[]) => desenhos.push(a) } : null),
    }
    canvases.push(c)
    return c as unknown as OffscreenCanvas
  })
  const bitmaps: unknown[] = []
  const criarBitmap = vi.fn(async (fonte: unknown) => {
    const b = { de: fonte, close: vi.fn() }
    bitmaps.push(b)
    return b as unknown as ImageBitmap
  }) as unknown as typeof createImageBitmap
  let relogio = 0
  const appendNoDocumento = vi.fn()
  const criados: string[] = []
  if (o.videoDoDocumento) {
    // o caminho padrão (`document.createElement('video')`) com um documento falso que registra qualquer anexação
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        criados.push(tag)
        return tag === 'video' ? video : {}
      },
      body: { appendChild: appendNoDocumento, append: appendNoDocumento, prepend: appendNoDocumento, insertBefore: appendNoDocumento },
      documentElement: { appendChild: appendNoDocumento, append: appendNoDocumento },
      head: { appendChild: appendNoDocumento, append: appendNoDocumento },
    })
  }
  const fluxo = { fluxo: 'camera' } as unknown as FluxoDeVideo
  const fonte = criarFonteDeQuadros(fluxo, {
    ...(o.videoDoDocumento ? {} : { criarVideo: () => video as unknown as HTMLVideoElement }),
    criarCanvas,
    criarBitmap,
    agora: () => relogio,
  })
  return {
    fonte,
    video,
    fluxo,
    desenhos,
    canvases,
    bitmaps,
    criarBitmap,
    criarCanvas,
    appendNoDocumento,
    criados,
    avancar(ms: number) {
      relogio += ms
    },
  }
}

const microtarefas = () => new Promise<void>((r) => setTimeout(r, 0))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('criarFonteDeQuadros', () => {
  test('video-fora-do-dom: nenhum appendChild; muted, playsInline e srcObject = o fluxo', async () => {
    const m = montar({ videoDoDocumento: true })
    expect(m.criados).toEqual(['video'])
    expect(m.appendNoDocumento).not.toHaveBeenCalled()
    expect(m.video.muted).toBe(true)
    expect(m.video.playsInline).toBe(true)
    expect(m.video.srcObject).toBe(m.fluxo)
    await microtarefas()
    expect(await m.fonte.quadro()).not.toBeNull()
    expect(m.appendNoDocumento).not.toHaveBeenCalled()
  })

  test('video-tocando: play() chamado uma vez ao criar', async () => {
    const m = montar()
    expect(m.video.plays).toBe(1)
    await microtarefas()
    await m.fonte.quadro()
    await m.fonte.quadro()
    expect(m.video.plays).toBe(1)
  })

  test('video-tocando: play() rejeitado → null e nova tentativa só depois de 1 000 ms', async () => {
    expect(INTERVALO_DO_PLAY_MS).toBe(1000)
    const m = montar({ play: 'rejeita' })
    await microtarefas()
    expect(await m.fonte.quadro()).toBeNull()
    expect(m.video.plays).toBe(1)
    m.avancar(999)
    expect(await m.fonte.quadro()).toBeNull()
    expect(m.video.plays).toBe(1)
    m.avancar(1)
    expect(await m.fonte.quadro()).toBeNull() // tentou de novo, ainda rejeitado
    expect(m.video.plays).toBe(2)
    m.avancar(500)
    expect(await m.fonte.quadro()).toBeNull()
    expect(m.video.plays).toBe(2)
    // o navegador passa a aceitar: a próxima tentativa (1 s depois) toca e o quadro volta
    m.video.responderPlay = 'resolve'
    m.avancar(500)
    expect(await m.fonte.quadro()).toBeNull() // a tentativa sai neste pedido; o quadro vem no próximo
    expect(m.video.plays).toBe(3)
    await microtarefas()
    expect(await m.fonte.quadro()).not.toBeNull()
    expect(m.criarBitmap).toHaveBeenCalledTimes(1)
  })

  test('video-tocando: paused com videoWidth > 0 → null, nunca o quadro congelado', async () => {
    const m = montar()
    await microtarefas()
    expect(await m.fonte.quadro()).not.toBeNull()
    m.video.paused = true // o navegador pausou o elemento destacado (I7)
    expect(m.video.videoWidth).toBeGreaterThan(0)
    expect(await m.fonte.quadro()).toBeNull()
    expect(m.criarBitmap).toHaveBeenCalledTimes(1)
    m.avancar(1000)
    await m.fonte.quadro()
    expect(m.video.plays).toBe(2)
  })

  test('quadro-de-256: vídeo 1280×720 → canvas 256×144 e o bitmap do canvas', async () => {
    expect(LARGURA_DO_QUADRO).toBe(256)
    const m = montar()
    await microtarefas()
    const q = await m.fonte.quadro()
    expect(m.criarCanvas).toHaveBeenCalledWith(256, 144)
    expect(m.desenhos).toEqual([[m.video, 0, 0, 256, 144]])
    expect(m.bitmaps).toEqual([q])
    expect((q as unknown as { de: unknown }).de).toBe(m.canvases[0])
    // o mesmo canvas nos quadros seguintes; dimensões novas (retrato) → canvas novo
    await m.fonte.quadro()
    expect(m.criarCanvas).toHaveBeenCalledTimes(1)
    m.video.videoWidth = 720
    m.video.videoHeight = 1280
    await m.fonte.quadro()
    expect(m.criarCanvas).toHaveBeenLastCalledWith(256, 455)
  })

  test('sem-video-sem-quadro: videoWidth 0 → null', async () => {
    const m = montar()
    await microtarefas()
    m.video.videoWidth = 0
    m.video.videoHeight = 0
    expect(await m.fonte.quadro()).toBeNull()
    expect(m.criarCanvas).not.toHaveBeenCalled()
  })

  test('sem-video-sem-quadro: só os metadados (readyState 1, videoWidth > 0) → null; com o quadro atual (2) → quadro', async () => {
    const m = montar()
    await microtarefas()
    m.video.readyState = 1
    expect(await m.fonte.quadro()).toBeNull()
    expect(m.criarCanvas).not.toHaveBeenCalled()
    m.video.readyState = 2
    expect(await m.fonte.quadro()).not.toBeNull()
  })

  test('createImageBitmap que rejeita → null', async () => {
    const m = montar()
    await microtarefas()
    vi.mocked(m.criarBitmap).mockRejectedValueOnce(new Error('InvalidStateError'))
    expect(await m.fonte.quadro()).toBeNull()
  })

  test('fechar-solta-o-fluxo: pause() e srcObject = null; idempotente; depois, nenhum quadro', async () => {
    const m = montar()
    await microtarefas()
    m.fonte.fechar()
    expect(m.video.pauses).toBe(1)
    expect(m.video.srcObject).toBeNull()
    m.fonte.fechar()
    expect(m.video.pauses).toBe(1)
    expect(await m.fonte.quadro()).toBeNull()
    m.avancar(5000)
    expect(await m.fonte.quadro()).toBeNull()
    expect(m.video.plays).toBe(1)
  })

  test('fechar durante o createImageBitmap: o bitmap que chega depois é fechado e não sai', async () => {
    const m = montar()
    await microtarefas()
    let soltar: (b: ImageBitmap) => void = () => undefined
    const atrasado = { close: vi.fn() }
    vi.mocked(m.criarBitmap).mockImplementationOnce(() => new Promise<ImageBitmap>((r) => (soltar = r)))
    const p = m.fonte.quadro()
    await microtarefas()
    m.fonte.fechar()
    soltar(atrasado as unknown as ImageBitmap)
    expect(await p).toBeNull()
    expect(atrasado.close).toHaveBeenCalledTimes(1)
  })
})
