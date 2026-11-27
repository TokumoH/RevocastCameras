// @vitest-environment jsdom
import { afterEach, describe, test, expect, vi } from 'vitest'
import { EVENTOS_DE_SAIDA, TEMPO_DO_OBS_MS, criarObsNoNavegador } from './obsNavegador'

type Callback = (valor: unknown) => void

/** `window.obsstudio` falso: cada função responde pelo callback (ou nunca, se `calado`). */
function instalarObs(o: { nivel?: unknown; cenas?: unknown; cena?: unknown; status?: unknown; calado?: boolean; lancar?: boolean } = {}) {
  const chamadas: string[] = []
  const responder = (nome: string, valor: unknown) => (cb: Callback) => {
    chamadas.push(nome)
    if (o.lancar) throw new Error('falha do obs')
    if (!o.calado) cb(valor)
  }
  const obsstudio = {
    pluginVersion: '2.24.0',
    getControlLevel: responder('getControlLevel', 'nivel' in o ? o.nivel : 4),
    getScenes: responder('getScenes', o.cenas ?? ['Abertura', 'Conversa']),
    getCurrentScene: responder('getCurrentScene', o.cena ?? { name: 'Abertura', width: 1920, height: 1080 }),
    getStatus: responder('getStatus', o.status ?? { recording: false, recordingPaused: false, streaming: false, replaybuffer: false, virtualcam: false }),
    setCurrentScene: (nome: string) => {
      chamadas.push(`setCurrentScene:${nome}`)
      if (o.lancar) throw new Error('falha do obs')
    },
    saveReplayBuffer: () => {
      chamadas.push('saveReplayBuffer')
      if (o.lancar) throw new Error('falha do obs')
    },
  }
  Object.defineProperty(window, 'obsstudio', { value: obsstudio, configurable: true, writable: true })
  return chamadas
}

afterEach(() => {
  delete (window as { obsstudio?: unknown }).obsstudio
  vi.useRealTimers()
})

describe('window.obsstudio (obs-browser)', () => {
  test('sem-obsstudio', async () => {
    const obs = criarObsNoNavegador()
    expect(obs.disponivel()).toBe(false)
    expect(obs.versaoDoPlugin()).toBeNull()
    expect(await obs.nivel()).toBeNull()
    expect(await obs.cenas()).toBeNull()
    expect(await obs.cenaAtual()).toBeNull()
    expect(await obs.status()).toBeNull()
    expect(() => obs.trocarCena('Abertura')).not.toThrow()
    expect(() => obs.salvarClipe()).not.toThrow()
  })

  test('callbacks-viram-promessas', async () => {
    instalarObs()
    const obs = criarObsNoNavegador()
    expect(obs.disponivel()).toBe(true)
    expect(obs.versaoDoPlugin()).toBe('2.24.0')
    expect(await obs.cenas()).toEqual(['Abertura', 'Conversa'])
    expect(await obs.cenaAtual()).toBe('Abertura')

    // sem resposta em 3 s → null
    vi.useFakeTimers()
    instalarObs({ calado: true })
    const calado = criarObsNoNavegador()
    let cenas: unknown = 'esperando'
    const p = calado.cenas().then((v) => (cenas = v))
    await vi.advanceTimersByTimeAsync(2999)
    expect(cenas).toBe('esperando')
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(cenas).toBeNull()
    expect(TEMPO_DO_OBS_MS).toBe(3000)
    vi.useRealTimers()

    // função que lança e resposta fora da forma → null
    instalarObs({ lancar: true })
    const lanca = criarObsNoNavegador()
    expect(await lanca.cenas()).toBeNull()
    expect(() => lanca.trocarCena('Abertura')).not.toThrow()
    expect(() => lanca.salvarClipe()).not.toThrow()
    instalarObs({ cenas: ['Abertura', 3], cena: { width: 1 } })
    const torto = criarObsNoNavegador()
    expect(await torto.cenas()).toBeNull()
    expect(await torto.cenaAtual()).toBeNull()

    const chamadas = instalarObs()
    const ok = criarObsNoNavegador()
    ok.trocarCena('Conversa')
    ok.salvarClipe()
    expect(chamadas).toEqual(['setCurrentScene:Conversa', 'saveReplayBuffer'])
  })

  test('resposta-solta-o-tempo-limite', async () => {
    vi.useFakeTimers()
    instalarObs()
    const obs = criarObsNoNavegador()
    expect(await obs.cenas()).toEqual(['Abertura', 'Conversa'])
    expect(await obs.nivel()).toBe(4)
    expect(vi.getTimerCount()).toBe(0)
    // a função que lança também solta o tempo-limite
    instalarObs({ lancar: true })
    expect(await criarObsNoNavegador().status()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  test('nivel', async () => {
    for (const n of [0, 1, 2, 3, 4, 5]) {
      instalarObs({ nivel: n })
      expect(await criarObsNoNavegador().nivel()).toBe(n)
    }
    for (const n of [-1, 6, 2.5, '4', null, Number.NaN]) {
      instalarObs({ nivel: n })
      expect(await criarObsNoNavegador().nivel()).toBeNull()
    }
  })

  test('status-da-saida', async () => {
    instalarObs({ status: { recording: true, recordingPaused: false, streaming: true, replaybuffer: false, virtualcam: true } })
    expect(await criarObsNoNavegador().status()).toEqual({ gravando: true, replayBuffer: false, transmitindo: true, cameraVirtual: true })
    instalarObs({ status: { recording: false, streaming: false, replaybuffer: true, virtualcam: false } })
    expect(await criarObsNoNavegador().status()).toEqual({ gravando: false, replayBuffer: true, transmitindo: false, cameraVirtual: false })
    instalarObs({ status: { recording: 'sim', streaming: false, replaybuffer: false, virtualcam: false } })
    expect(await criarObsNoNavegador().status()).toBeNull()
    instalarObs({ status: 'ligado' })
    expect(await criarObsNoNavegador().status()).toBeNull()

    expect([...EVENTOS_DE_SAIDA]).toEqual([
      'obsStreamingStarting',
      'obsStreamingStarted',
      'obsStreamingStopped',
      'obsRecordingStarting',
      'obsRecordingStarted',
      'obsRecordingStopped',
      'obsReplaybufferStarting',
      'obsReplaybufferStarted',
      'obsReplaybufferStopped',
      'obsVirtualcamStarted',
      'obsVirtualcamStopped',
    ])
    const obs = criarObsNoNavegador()
    let vezes = 0
    const soltar = obs.aoMudarSaida(() => vezes++)
    for (const evento of EVENTOS_DE_SAIDA) window.dispatchEvent(new CustomEvent(evento))
    expect(vezes).toBe(11)
    // a Fonte está em todas as cenas: obsSourceActiveChanged não diz nada sobre a saída (I5)
    window.dispatchEvent(new CustomEvent('obsSourceActiveChanged', { detail: { active: true } }))
    window.dispatchEvent(new CustomEvent('obsSceneChanged', { detail: { name: 'Abertura' } }))
    expect(vezes).toBe(11)
    soltar()
    for (const evento of EVENTOS_DE_SAIDA) window.dispatchEvent(new CustomEvent(evento))
    expect(vezes).toBe(11)
  })
})
