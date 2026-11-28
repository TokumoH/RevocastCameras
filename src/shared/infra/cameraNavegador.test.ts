import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ESPERA_DA_CAMERA_MS, MUDO_TOLERADO_MS, RESTRICOES_DE_CAPTURA, criarCameraDoAparelho, criarManterTelaLigada, lerBateria } from './cameraNavegador'

/*
 * Falsos de `navigator.mediaDevices`, `MediaStreamTrack`, `navigator.wakeLock`, `document` e `getBattery` (jsdom e Node
 * não têm nenhum deles): só o que muda o comportamento do adaptador (F5, F7).
 */

class FaixaFalsa extends EventTarget {
  readonly kind = 'video'
  paradas = 0
  stop(): void {
    this.paradas += 1
  }
  emitir(tipo: 'ended' | 'mute' | 'unmute'): void {
    this.dispatchEvent(new Event(tipo))
  }
}

function fluxoFalso(faixas: FaixaFalsa[] = [new FaixaFalsa()]) {
  return { faixas, getTracks: () => [...faixas], getVideoTracks: () => faixas.filter((f) => f.kind === 'video') }
}
type FluxoFalso = ReturnType<typeof fluxoFalso>

function navegador(getUserMedia: (c: MediaStreamConstraints) => Promise<FluxoFalso>) {
  const gum = vi.fn(getUserMedia)
  return { nav: { mediaDevices: { getUserMedia: gum } } as unknown as Pick<Navigator, 'mediaDevices'>, gum }
}

function erroDoNavegador(name: string): Error {
  return name === 'TypeError' ? new TypeError('x') : new DOMException('x', name)
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('criarCameraDoAparelho', () => {
  test('restricoes-de-captura', async () => {
    expect(RESTRICOES_DE_CAPTURA).toEqual({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
    })
    const fluxo = fluxoFalso()
    const { nav, gum } = navegador(async () => fluxo)
    const camera = criarCameraDoAparelho(nav, () => true)
    const r = await camera.ligar()
    expect(r).toEqual({ ok: true, faixa: fluxo.faixas[0] })
    expect(gum).toHaveBeenCalledTimes(1)
    expect(gum.mock.calls[0][0]).toEqual(RESTRICOES_DE_CAPTURA)
    expect(gum.mock.calls[0][0]).toMatchObject({ audio: false })
  })

  test.each([
    ['NotAllowedError', 'sem_permissao'],
    ['SecurityError', 'sem_permissao'],
    ['NotFoundError', 'sem_camera'],
    ['OverconstrainedError', 'sem_camera'],
    ['NotReadableError', 'outro'],
    ['TypeError', 'outro'],
  ])('erros-da-camera: %s → %s', async (nome, motivo) => {
    const { nav } = navegador(async () => {
      throw erroDoNavegador(nome)
    })
    expect(await criarCameraDoAparelho(nav, () => true).ligar()).toEqual({ ok: false, motivo })
  })

  test('erros-da-camera: inseguro sem chamar nada', async () => {
    const { nav, gum } = navegador(async () => fluxoFalso())
    expect(await criarCameraDoAparelho(nav, () => false).ligar()).toEqual({ ok: false, motivo: 'inseguro' })
    expect(gum).not.toHaveBeenCalled()
    const semMidia = {} as Pick<Navigator, 'mediaDevices'>
    expect(await criarCameraDoAparelho(semMidia, () => true).ligar()).toEqual({ ok: false, motivo: 'inseguro' })
    const semGum = { mediaDevices: {} } as unknown as Pick<Navigator, 'mediaDevices'>
    expect(await criarCameraDoAparelho(semGum, () => true).ligar()).toEqual({ ok: false, motivo: 'inseguro' })
    // fluxo sem faixa de vídeo: nada fica ligado
    const soAudio = new FaixaFalsa()
    Object.defineProperty(soAudio, 'kind', { value: 'audio' })
    const { nav: nav2 } = navegador(async () => fluxoFalso([soAudio]))
    expect(await criarCameraDoAparelho(nav2, () => true).ligar()).toEqual({ ok: false, motivo: 'sem_camera' })
    expect(soAudio.paradas).toBe(1)
  })

  test('camera-que-nao-responde', async () => {
    expect(ESPERA_DA_CAMERA_MS).toBe(30_000)
    let resolver: (f: FluxoFalso) => void = () => {}
    const { nav } = navegador(() => new Promise<FluxoFalso>((r) => (resolver = r)))
    const camera = criarCameraDoAparelho(nav, () => true)
    let r: unknown
    void camera.ligar().then((x) => (r = x))
    await vi.advanceTimersByTimeAsync(29_999)
    expect(r).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(r).toEqual({ ok: false, motivo: 'sem_permissao' })
    // a câmera responde depois: as faixas são paradas na hora e nada fica como fluxo da prévia
    const tardio = fluxoFalso()
    resolver(tardio)
    await vi.advanceTimersByTimeAsync(0)
    expect(tardio.faixas[0].paradas).toBe(1)
    expect(camera.fluxoDaPrevia()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  test('faixa-perdida', async () => {
    expect(MUDO_TOLERADO_MS).toBe(3000)
    const fluxo = fluxoFalso()
    const { nav } = navegador(async () => fluxo)
    const camera = criarCameraDoAparelho(nav, () => true)
    const perdida = vi.fn()
    camera.aoPerderFaixa(perdida)
    await camera.ligar()
    const f = fluxo.faixas[0]
    // mudo por 2 999 ms e volta: nada
    f.emitir('mute')
    await vi.advanceTimersByTimeAsync(2999)
    f.emitir('unmute')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(perdida).not.toHaveBeenCalled()
    // mudo por 3 000 ms: perdida (uma vez só, mesmo com `ended` depois)
    f.emitir('mute')
    await vi.advanceTimersByTimeAsync(2999)
    expect(perdida).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(1) // o aviso é adiado (0 ms) a partir do prazo; o relógio falso conta 1 ms dentro do avanço
    expect(perdida).toHaveBeenCalledTimes(1)
    f.emitir('ended')
    await vi.advanceTimersByTimeAsync(0)
    expect(perdida).toHaveBeenCalledTimes(1)

    // `ended`: perdida, adiada (nunca dentro do evento)
    const fluxo2 = fluxoFalso()
    const { nav: nav2 } = navegador(async () => fluxo2)
    const camera2 = criarCameraDoAparelho(nav2, () => true)
    const perdida2 = vi.fn()
    const soltar = camera2.aoPerderFaixa(perdida2)
    await camera2.ligar()
    fluxo2.faixas[0].emitir('ended')
    expect(perdida2).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(perdida2).toHaveBeenCalledTimes(1)
    // ouvinte solto: nada; faixa desligada por nós: nada
    soltar()
    const fluxo3 = fluxoFalso()
    const { nav: nav3 } = navegador(async () => fluxo3)
    const camera3 = criarCameraDoAparelho(nav3, () => true)
    const perdida3 = vi.fn()
    camera3.aoPerderFaixa(perdida3)
    await camera3.ligar()
    camera3.desligar()
    fluxo3.faixas[0].emitir('ended')
    fluxo3.faixas[0].emitir('mute')
    await vi.advanceTimersByTimeAsync(5000)
    expect(perdida3).not.toHaveBeenCalled()
  })

  test('desligar-para-tudo', async () => {
    const fluxo = fluxoFalso([new FaixaFalsa(), new FaixaFalsa()])
    const { nav } = navegador(async () => fluxo)
    const camera = criarCameraDoAparelho(nav, () => true)
    camera.desligar() // nada ligado: sem erro
    await camera.ligar()
    camera.desligar()
    expect(fluxo.faixas.map((f) => f.paradas)).toEqual([1, 1])
    expect(camera.fluxoDaPrevia()).toBeNull()
    expect(() => camera.desligar()).not.toThrow()
    expect(fluxo.faixas.map((f) => f.paradas)).toEqual([1, 1])

    // religar com a faixa perdida: o fluxo anterior é parado antes do pedido novo (aparelho que não abre a câmera duas vezes)
    const primeiro = fluxoFalso()
    const segundo = fluxoFalso()
    const fila = [primeiro, segundo]
    const paradasNoPedido: number[] = []
    const { nav: nav2 } = navegador(async () => {
      paradasNoPedido.push(primeiro.faixas[0].paradas)
      return fila.shift()!
    })
    const camera2 = criarCameraDoAparelho(nav2, () => true)
    await camera2.ligar()
    await camera2.ligar()
    expect(paradasNoPedido).toEqual([0, 1])
    expect(primeiro.faixas[0].paradas).toBe(1)
    expect(segundo.faixas[0].paradas).toBe(0)
    expect(camera2.fluxoDaPrevia()).toBe(segundo)
  })

  test('previa-sem-segundo-getusermedia', async () => {
    const fluxo = fluxoFalso()
    const { nav, gum } = navegador(async () => fluxo)
    const camera = criarCameraDoAparelho(nav, () => true)
    expect(camera.fluxoDaPrevia()).toBeNull()
    await camera.ligar()
    expect(camera.fluxoDaPrevia()).toBe(fluxo)
    expect(camera.fluxoDaPrevia()).toBe(fluxo)
    expect(gum).toHaveBeenCalledTimes(1)
  })
})

class SentinelaFalsa extends EventTarget {
  released = false
  readonly release = vi.fn(async () => {
    if (this.released) return
    this.released = true
    this.dispatchEvent(new Event('release'))
  })
  /** O sistema solta a trava (página escondida, F7). */
  soltarPeloSistema(): void {
    this.released = true
    this.dispatchEvent(new Event('release'))
  }
}

function telaFalsa() {
  const sentinelas: SentinelaFalsa[] = []
  const request = vi.fn(async (_tipo?: string) => {
    const s = new SentinelaFalsa()
    sentinelas.push(s)
    return s
  })
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
  return {
    nav: { wakeLock: { request } } as unknown as Navigator,
    doc: doc as unknown as Document,
    request,
    sentinelas,
    ver(estado: DocumentVisibilityState): void {
      doc.visibilityState = estado
      doc.dispatchEvent(new Event('visibilitychange'))
    },
  }
}

describe('criarManterTelaLigada', () => {
  test('tela-ligada', async () => {
    // sem wakeLock → sem_trava
    const t0 = telaFalsa()
    expect(await criarManterTelaLigada({} as Navigator, t0.doc).travar()).toBe('sem_trava')
    // request rejeitado → sem_trava
    const t1 = telaFalsa()
    t1.request.mockRejectedValueOnce(new DOMException('x', 'NotAllowedError'))
    expect(await criarManterTelaLigada(t1.nav, t1.doc).travar()).toBe('sem_trava')

    // aceito → travada; o sistema solta ao esconder; ao voltar a ver, pede de novo
    const t = telaFalsa()
    const tela = criarManterTelaLigada(t.nav, t.doc)
    expect(await tela.travar()).toBe('travada')
    expect(t.request).toHaveBeenCalledWith('screen')
    t.ver('hidden')
    t.sentinelas[0].soltarPeloSistema()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.request).toHaveBeenCalledTimes(1) // escondida: não pede
    t.ver('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(t.request).toHaveBeenCalledTimes(2)
    // ainda travada (a nova sentinela não foi solta): voltar a ver de novo não pede outra
    t.ver('hidden')
    t.ver('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(t.request).toHaveBeenCalledTimes(2)

    // soltar → release e nenhum pedido depois
    tela.soltar()
    expect(t.sentinelas[1].release).toHaveBeenCalledTimes(1)
    t.ver('hidden')
    t.ver('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(t.request).toHaveBeenCalledTimes(2)
    expect(() => tela.soltar()).not.toThrow()

    // soltar enquanto o pedido ainda não respondeu: a sentinela que chega é solta na hora
    const t2 = telaFalsa()
    let liberar: () => void = () => {}
    t2.request.mockImplementationOnce(
      () =>
        new Promise<SentinelaFalsa>((r) => {
          liberar = () => {
            const s = new SentinelaFalsa()
            t2.sentinelas.push(s)
            r(s)
          }
        }),
    )
    const tela2 = criarManterTelaLigada(t2.nav, t2.doc)
    const travando = tela2.travar()
    tela2.soltar()
    liberar()
    expect(await travando).toBe('sem_trava')
    expect(t2.sentinelas[0].release).toHaveBeenCalledTimes(1)
  })
})

/** Pedido de Wake Lock seguro até `liberar()` (o navegador demorando a responder). */
function segurarPedidos(t: ReturnType<typeof telaFalsa>) {
  const pendentes: (() => void)[] = []
  t.request.mockImplementation(
    () =>
      new Promise<SentinelaFalsa>((r) => {
        pendentes.push(() => {
          const s = new SentinelaFalsa()
          t.sentinelas.push(s)
          r(s)
        })
      }),
  )
  return {
    liberar(): void {
      for (const f of pendentes.splice(0)) f()
    },
  }
}

/** Sentinelas que ninguém soltou (a tela ficaria ligada depois de `soltar`). */
const presas = (t: ReturnType<typeof telaFalsa>) => t.sentinelas.filter((s) => !s.released).length

describe('criarManterTelaLigada: um pedido por vez (VER-051, rodada 1, I1)', () => {
  test('tela-dois-travar', async () => {
    // P1: travar() + travar() ao mesmo tempo → um pedido, uma sentinela; soltar() não deixa nenhuma presa
    const t = telaFalsa()
    const p = segurarPedidos(t)
    const tela = criarManterTelaLigada(t.nav, t.doc)
    const a = tela.travar()
    const b = tela.travar()
    p.liberar()
    expect(await a).toBe('travada')
    expect(await b).toBe('travada')
    expect(t.request).toHaveBeenCalledTimes(1)
    tela.soltar()
    expect(presas(t)).toBe(0)
  })

  test('tela-travar-e-visibilidade', async () => {
    // P2: a rota chama travar() no aoVoltarAVer junto com o visibilitychange do adaptador → um pedido só
    const t = telaFalsa()
    const tela = criarManterTelaLigada(t.nav, t.doc)
    expect(await tela.travar()).toBe('travada')
    t.ver('hidden')
    t.sentinelas[0].soltarPeloSistema()
    const p = segurarPedidos(t)
    t.ver('visible') // pedido do adaptador, em curso
    const r = tela.travar() // e o da rota
    t.ver('visible') // e outro evento de visibilidade
    p.liberar()
    expect(await r).toBe('travada')
    await vi.advanceTimersByTimeAsync(0)
    expect(t.request).toHaveBeenCalledTimes(2)
    tela.soltar()
    expect(presas(t)).toBe(0)
  })

  test('tela-soltar-durante-pedido', async () => {
    // P3: travar(); soltar(); travar() com o pedido pendente → uma sentinela, mantida (o último pedido quer a trava)
    const t = telaFalsa()
    const p = segurarPedidos(t)
    const tela = criarManterTelaLigada(t.nav, t.doc)
    const a = tela.travar()
    tela.soltar()
    const b = tela.travar()
    p.liberar()
    expect(await a).toBe('travada')
    expect(await b).toBe('travada')
    expect(t.request).toHaveBeenCalledTimes(1)
    expect(t.sentinelas).toHaveLength(1)
    tela.soltar()
    expect(presas(t)).toBe(0)
    // soltar sem travar de novo: a sentinela que chega é solta na hora
    const c = tela.travar()
    tela.soltar()
    p.liberar()
    expect(await c).toBe('sem_trava')
    expect(presas(t)).toBe(0)
  })
})

describe('lerBateria', () => {
  test('bateria', async () => {
    expect(await lerBateria({ getBattery: async () => ({ level: 0.42 }) } as unknown as Navigator)).toBe(0.42)
    expect(await lerBateria({} as Navigator)).toBeNull()
    expect(await lerBateria({ getBattery: async () => Promise.reject(new Error('x')) } as unknown as Navigator)).toBeNull()
    expect(
      await lerBateria({
        getBattery: () => {
          throw new Error('x')
        },
      } as unknown as Navigator),
    ).toBeNull()
    for (const level of [Number.NaN, -0.1, 1.5, '0.5', null]) {
      expect(await lerBateria({ getBattery: async () => ({ level }) } as unknown as Navigator)).toBeNull()
    }
  })
})
