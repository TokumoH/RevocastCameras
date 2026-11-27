import type { ObsNoNavegador, StatusDaSaida } from '../../domains/obs/portas'

/*
 * Adaptador de `window.obsstudio` (obs-browser; README do obsproject/obs-browser, conferido no
 * VER-039). Cada função de leitura responde por callback: aqui vira promessa com tempo-limite, e
 * a resposta é conferida antes de sair (forma errada → `null`). Nada do OBS vai para `console`.
 */

/** Tempo-limite de cada leitura de `window.obsstudio`: sem resposta → `null`. */
export const TEMPO_DO_OBS_MS = 3000

/**
 * Eventos de saída do obs-browser que o palco ouve (D10): início, inclusive os `Starting`, e fim
 * de transmissão, gravação, Replay Buffer e câmera virtual. Todos existem no README do obs-browser;
 * os `Stopping`, `obsRecordingPaused`/`Unpaused` e `obsReplaybufferSaved` também existem e ficam
 * de fora (o `Stopped` vem logo depois; pausa e clipe salvo não mudam se a saída está no ar).
 */
export const EVENTOS_DE_SAIDA = Object.freeze([
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
] as const)

type ComCallback = (cb: (valor: unknown) => void) => void

/** O pedaço de `window` que o adaptador usa. */
export type JanelaDoObs = Pick<Window, 'addEventListener' | 'removeEventListener'> & { obsstudio?: unknown }

function obsstudio(janela: JanelaDoObs): Record<string, unknown> | null {
  const o = janela.obsstudio
  return typeof o === 'object' && o !== null ? (o as Record<string, unknown>) : null
}

const NIVEL_MAXIMO = 5
const TAMANHO_DA_VERSAO = 40

export function criarObsNoNavegador(janela: JanelaDoObs = window): ObsNoNavegador {
  /** Chama `nome(cb)` e espera o callback por até 3 s; lançou, faltou ou passou do tempo → `null`. */
  function perguntar<T>(nome: string, ler: (valor: unknown) => T | null): Promise<T | null> {
    const o = obsstudio(janela)
    const f = o?.[nome]
    if (typeof f !== 'function') return Promise.resolve(null)
    return new Promise<T | null>((resolver) => {
      let respondido = false
      const terminar = (v: T | null) => {
        if (respondido) return
        respondido = true
        clearTimeout(limite)
        resolver(v)
      }
      const limite = setTimeout(() => terminar(null), TEMPO_DO_OBS_MS)
      try {
        ;(f as ComCallback).call(o, (valor) => {
          let lido: T | null = null
          try {
            lido = ler(valor)
          } catch {
            lido = null
          }
          terminar(lido)
        })
      } catch {
        terminar(null)
      }
    })
  }

  function acionar(nome: string, ...args: unknown[]): void {
    const o = obsstudio(janela)
    const f = o?.[nome]
    if (typeof f !== 'function') return
    try {
      ;(f as (...a: unknown[]) => void).apply(o, args)
    } catch {
      // o OBS recusou ou falhou: a ação não acontece, e nada vai para o console
    }
  }

  return {
    disponivel: () => obsstudio(janela) !== null,
    versaoDoPlugin() {
      const v = obsstudio(janela)?.pluginVersion
      return typeof v === 'string' && v.length <= TAMANHO_DA_VERSAO ? v : null
    },
    nivel: () => perguntar('getControlLevel', (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= NIVEL_MAXIMO ? v : null)),
    cenas: () => perguntar('getScenes', (v) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...(v as string[])] : null)),
    cenaAtual: () =>
      perguntar('getCurrentScene', (v) => {
        if (typeof v !== 'object' || v === null) return null
        const nome = (v as { name?: unknown }).name
        return typeof nome === 'string' ? nome : null
      }),
    status: () =>
      perguntar<StatusDaSaida>('getStatus', (v) => {
        if (typeof v !== 'object' || v === null) return null
        const s = v as Record<string, unknown>
        const { recording, replaybuffer, streaming, virtualcam } = s
        if (typeof recording !== 'boolean' || typeof replaybuffer !== 'boolean' || typeof streaming !== 'boolean' || typeof virtualcam !== 'boolean') return null
        return { gravando: recording, replayBuffer: replaybuffer, transmitindo: streaming, cameraVirtual: virtualcam }
      }),
    aoMudarSaida(f) {
      const ouvinte = () => f()
      for (const evento of EVENTOS_DE_SAIDA) janela.addEventListener(evento, ouvinte)
      return () => {
        for (const evento of EVENTOS_DE_SAIDA) janela.removeEventListener(evento, ouvinte)
      }
    },
    trocarCena: (nome) => acionar('setCurrentScene', nome),
    salvarClipe: () => acionar('saveReplayBuffer'),
  }
}
