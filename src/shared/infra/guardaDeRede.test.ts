import { describe, expect, test, vi } from 'vitest'
import { instalarGuardaDeRede, permitida, type EscopoDoWorker } from './guardaDeRede'

/*
 * Guarda de rede do worker do reconhecedor (PLA-006, D9; revisão 1, I5; registro VER-063). Escopo falso: cada caminho
 * de rede é um espião que faz o papel do original do navegador; o teste confere que uma URL de fora da origem nunca
 * chega a ele (rejeita ou lança `TypeError` antes) e que a própria origem chega com o mesmo texto.
 */

const ORIGEM = 'https://revocast.test'
const TELEMETRIA = 'https://odml.pa.googleapis.com/v1/log'

function escopoFalso() {
  const fetchOriginal = vi.fn(async (..._a: unknown[]) => new Response('ok'))
  const abertos: unknown[][] = []
  class XhrFalso {
    open(...a: unknown[]): void {
      abertos.push(a)
    }
  }
  const importScripts = vi.fn((..._urls: string[]) => undefined)
  const importar = vi.fn(async (_url: string) => ({ default: 'modulo' }))
  class WebSocketOriginal {}
  class EventSourceOriginal {}
  const escopo: EscopoDoWorker = {
    fetch: fetchOriginal as unknown as typeof fetch,
    XMLHttpRequest: XhrFalso as unknown as EscopoDoWorker['XMLHttpRequest'],
    importScripts,
    import: importar,
    WebSocket: WebSocketOriginal,
    EventSource: EventSourceOriginal,
  }
  return { escopo, fetchOriginal, abertos, XhrFalso, importScripts, importar, WebSocketOriginal, EventSourceOriginal }
}

describe('permitida', () => {
  test.each([
    ['/assets/x.wasm', true],
    ['assets/x.wasm', true],
    [`${ORIGEM}/assets/x.wasm`, true],
    [`blob:${ORIGEM}/5a1c9e2b-7d3f-4b6a-8c1d-2e3f4a5b6c7d`, true],
    [TELEMETRIA, false],
    ['//odml.pa.googleapis.com/x', false],
    ['http://revocast.test/x', false],
    ['https://revocast.test:8443/x', false],
    ['https://revocast.test.evil.example/x', false],
    ['data:,x', false],
    ['wss://revocast.test/x', false],
    ['blob:https://outro.example/5a1c9e2b-7d3f-4b6a-8c1d-2e3f4a5b6c7d', false],
    ['blob:null/5a1c9e2b', false],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
  ])('%s → %s', (url, esperado) => {
    expect(permitida(url, ORIGEM)).toBe(esperado)
  })

  test('URL e Request resolvidos como o texto', () => {
    expect(permitida(new URL(TELEMETRIA), ORIGEM)).toBe(false)
    expect(permitida(new Request(TELEMETRIA), ORIGEM)).toBe(false)
    expect(permitida(new URL('/assets/x.wasm', ORIGEM), ORIGEM)).toBe(true)
    expect(permitida(new Request(`${ORIGEM}/assets/x.task`), ORIGEM)).toBe(true)
  })

  test('origem inválida ou opaca recusa tudo (falha fechada)', () => {
    expect(permitida('/assets/x.wasm', 'nao e origem')).toBe(false)
    expect(permitida('/assets/x.wasm', 'null')).toBe(false)
    expect(permitida('data:,x', 'null')).toBe(false)
  })
})

describe('instalarGuardaDeRede', () => {
  test.each<[string, () => string | URL | Request]>([
    ['texto absoluto da telemetria', () => TELEMETRIA],
    ['URL da telemetria', () => new URL(TELEMETRIA)],
    ['Request da telemetria', () => new Request(TELEMETRIA, { method: 'POST' })],
    ['//host', () => '//odml.pa.googleapis.com/x'],
    ['mesma máquina, outra porta', () => 'https://revocast.test:8443/x'],
    ['data:', () => 'data:,x'],
  ])('guarda-bloqueia-rede-externa: %s → TypeError sem chamar o fetch original', async (_nome, url) => {
    const f = escopoFalso()
    instalarGuardaDeRede(f.escopo, ORIGEM)
    await expect(f.escopo.fetch(url())).rejects.toBeInstanceOf(TypeError)
    expect(f.fetchOriginal).not.toHaveBeenCalled()
  })

  test.each<[string, () => string | URL | Request, string | Request]>([
    ['relativa com barra', () => '/assets/x.wasm', '/assets/x.wasm'],
    ['relativa sem barra', () => 'assets/x.wasm', 'assets/x.wasm'],
    ['a própria origem absoluta', () => `${ORIGEM}/assets/x.task`, `${ORIGEM}/assets/x.task`],
    ['blob: da própria origem', () => `blob:${ORIGEM}/5a1c9e2b`, `blob:${ORIGEM}/5a1c9e2b`],
    ['URL da própria origem', () => new URL('/assets/x.wasm', ORIGEM), `${ORIGEM}/assets/x.wasm`],
  ])('guarda-bloqueia-rede-externa: %s passa com o mesmo texto', async (_nome, url, chega) => {
    const f = escopoFalso()
    instalarGuardaDeRede(f.escopo, ORIGEM)
    const init = { credentials: 'same-origin' as const }
    await f.escopo.fetch(url(), init)
    expect(f.fetchOriginal).toHaveBeenCalledTimes(1)
    expect(f.fetchOriginal.mock.calls[0]).toEqual([chega, init])
  })

  test('guarda-bloqueia-rede-externa: Request da própria origem passa como o mesmo objeto', async () => {
    const f = escopoFalso()
    instalarGuardaDeRede(f.escopo, ORIGEM)
    const pedido = new Request(`${ORIGEM}/assets/x.wasm`)
    await f.escopo.fetch(pedido)
    expect(f.fetchOriginal.mock.calls[0][0]).toBe(pedido)
  })

  test('guarda-bloqueia-rede-externa: o texto é lido uma vez (um toString que muda não engana a guarda)', async () => {
    const f = escopoFalso()
    instalarGuardaDeRede(f.escopo, ORIGEM)
    let leituras = 0
    const traicoeiro = {
      toString() {
        leituras += 1
        return leituras === 1 ? '/assets/x.wasm' : TELEMETRIA
      },
    }
    await f.escopo.fetch(traicoeiro as unknown as string)
    expect(leituras).toBe(1)
    expect(f.fetchOriginal.mock.calls[0][0]).toBe('/assets/x.wasm')
  })

  test('guarda-bloqueia-rede-externa: entrada que nem vira texto → rejeita, sem lançar e sem o original', async () => {
    const f = escopoFalso()
    instalarGuardaDeRede(f.escopo, ORIGEM)
    const semTexto = {
      toString(): string {
        throw new TypeError('sem texto')
      },
    }
    await expect(f.escopo.fetch(semTexto as unknown as string)).rejects.toBeInstanceOf(TypeError)
    expect(f.fetchOriginal).not.toHaveBeenCalled()
  })

  test('guarda-bloqueia-xhr-externo', () => {
    const f = escopoFalso()
    instalarGuardaDeRede(f.escopo, ORIGEM)
    const Xhr = f.escopo.XMLHttpRequest as unknown as new () => { open(...a: unknown[]): void }
    const xhr = new Xhr()
    expect(() => xhr.open('POST', TELEMETRIA)).toThrow(TypeError)
    expect(() => xhr.open('GET', new URL('//odml.pa.googleapis.com/x', ORIGEM), true)).toThrow(TypeError)
    expect(() => xhr.open('GET', 'data:,x', false)).toThrow(TypeError)
    expect(f.abertos).toEqual([])
    xhr.open('GET', '/assets/x.wasm', false)
    xhr.open('GET', new URL('/assets/y.wasm', ORIGEM), true, 'u', 'p')
    expect(f.abertos).toEqual([
      ['GET', '/assets/x.wasm', false],
      ['GET', `${ORIGEM}/assets/y.wasm`, true, 'u', 'p'],
    ])
  })

  test('guarda-bloqueia-importscripts-e-import', async () => {
    const f = escopoFalso()
    instalarGuardaDeRede(f.escopo, ORIGEM)
    expect(() => f.escopo.importScripts?.(TELEMETRIA)).toThrow(TypeError)
    expect(() => f.escopo.importScripts?.('/assets/a.js', '//odml.pa.googleapis.com/b.js')).toThrow(TypeError)
    expect(f.importScripts).not.toHaveBeenCalled()
    f.escopo.importScripts?.('/assets/a.js', `${ORIGEM}/assets/b.js`)
    expect(f.importScripts).toHaveBeenCalledWith('/assets/a.js', `${ORIGEM}/assets/b.js`)

    await expect(f.escopo.import?.(TELEMETRIA)).rejects.toBeInstanceOf(TypeError)
    await expect(f.escopo.import?.('//odml.pa.googleapis.com/m.js')).rejects.toBeInstanceOf(TypeError)
    await expect(f.escopo.import?.('data:text/javascript,export default 1')).rejects.toBeInstanceOf(TypeError)
    expect(f.importar).not.toHaveBeenCalled()
    // da origem: o original recebe a URL já resolvida pela origem (o import() nativo resolveria pelo módulo da guarda)
    await expect(f.escopo.import?.('/assets/carregador.js')).resolves.toEqual({ default: 'modulo' })
    expect(f.importar).toHaveBeenCalledWith(`${ORIGEM}/assets/carregador.js`)
  })

  test('guarda-bloqueia-importscripts-e-import: o texto é lido uma vez (toString traiçoeiro não engana; rodada 1, N1)', async () => {
    const f = escopoFalso()
    instalarGuardaDeRede(f.escopo, ORIGEM)
    const traicoeiro = () => {
      let leituras = 0
      return {
        toString() {
          leituras += 1
          return leituras === 1 ? '/assets/a.js' : TELEMETRIA
        },
      }
    }
    f.escopo.importScripts?.(traicoeiro() as unknown as string)
    expect(f.importScripts).toHaveBeenCalledWith('/assets/a.js')
    await f.escopo.import?.(traicoeiro() as unknown as string)
    expect(f.importar).toHaveBeenCalledWith(`${ORIGEM}/assets/a.js`)
  })

  test('guarda-bloqueia-importscripts-e-import: sem self.import no escopo, a guarda o define (o Mh do MediaPipe o prefere)', async () => {
    const f = escopoFalso()
    delete f.escopo.import
    delete f.escopo.importScripts
    instalarGuardaDeRede(f.escopo, ORIGEM)
    expect(typeof f.escopo.import).toBe('function')
    expect(f.escopo.importScripts).toBeUndefined()
    await expect((f.escopo as EscopoDoWorker).import?.(TELEMETRIA)).rejects.toBeInstanceOf(TypeError)
  })

  test('guarda-bloqueia-websocket-e-eventsource', () => {
    const f = escopoFalso()
    instalarGuardaDeRede(f.escopo, ORIGEM)
    const Ws = f.escopo.WebSocket as new (u: string) => unknown
    const Es = f.escopo.EventSource as new (u: string) => unknown
    expect(Ws).not.toBe(f.WebSocketOriginal)
    expect(Es).not.toBe(f.EventSourceOriginal)
    expect(() => new Ws('wss://odml.pa.googleapis.com/x')).toThrow(TypeError)
    expect(() => new Es('https://odml.pa.googleapis.com/x')).toThrow(TypeError)
    // sempre, até na própria origem: nenhum uso legítimo no worker
    expect(() => new Ws(`wss://revocast.test/x`)).toThrow(TypeError)
    expect(() => new Es('/eventos')).toThrow(TypeError)
  })

  test.each([['Worker'], ['SharedWorker'], ['WebTransport'], ['WebSocketStream']] as const)(
    'guarda-bloqueia-outros-caminhos: %s sempre lança, até na própria origem e sem existir antes (rodada 1, N3)',
    (nome) => {
      for (const existia of [true, false]) {
        const f = escopoFalso()
        if (existia) (f.escopo as unknown as Record<string, unknown>)[nome] = class {}
        const aoBloquear = vi.fn()
        instalarGuardaDeRede(f.escopo, ORIGEM, aoBloquear)
        const C = (f.escopo as unknown as Record<string, unknown>)[nome] as new (u: string) => unknown
        expect(() => new C('https://odml.pa.googleapis.com/x')).toThrow(TypeError)
        expect(() => new C(`${ORIGEM}/assets/w.js`)).toThrow(TypeError)
        expect(() => new C('data:text/javascript,fetch("https://odml.pa.googleapis.com")')).toThrow(TypeError)
        expect(aoBloquear).toHaveBeenCalledTimes(3)
      }
    },
  )

  test('guarda-bloqueia-cache-externo: Cache.add e addAll só da própria origem (rodada 1, N3)', async () => {
    const f = escopoFalso()
    const adicionados: unknown[] = []
    class CacheFalso {
      async add(p: unknown): Promise<void> {
        adicionados.push(['add', p])
      }
      async addAll(ps: unknown): Promise<void> {
        adicionados.push(['addAll', ps])
      }
    }
    f.escopo.Cache = CacheFalso as unknown as EscopoDoWorker['Cache']
    const aoBloquear = vi.fn()
    instalarGuardaDeRede(f.escopo, ORIGEM, aoBloquear)
    const cache = new CacheFalso()
    await expect(cache.add(TELEMETRIA)).rejects.toBeInstanceOf(TypeError)
    await expect(cache.add(new Request(TELEMETRIA))).rejects.toBeInstanceOf(TypeError)
    await expect(cache.addAll(['/assets/a.wasm', '//odml.pa.googleapis.com/x'])).rejects.toBeInstanceOf(TypeError)
    expect(adicionados).toEqual([])
    expect(aoBloquear).toHaveBeenCalledTimes(3)
    const pedido = new Request(`${ORIGEM}/assets/b.task`)
    await cache.add('/assets/a.wasm')
    await cache.addAll([new URL('/assets/a.wasm', ORIGEM), pedido])
    expect(adicionados).toEqual([
      ['add', '/assets/a.wasm'],
      ['addAll', [`${ORIGEM}/assets/a.wasm`, pedido]],
    ])
    expect(() => {
      ;(CacheFalso.prototype as { add: unknown }).add = async () => undefined
    }).toThrow(TypeError)
  })

  test('guarda-bloqueia-cache-externo: o texto é lido uma vez e é ele que vai ao original (rodada 2, R2-1)', async () => {
    const f = escopoFalso()
    const adicionados: unknown[] = []
    class CacheFalso {
      async add(p: unknown): Promise<void> {
        adicionados.push(['add', p])
      }
      async addAll(ps: unknown): Promise<void> {
        adicionados.push(['addAll', ps])
      }
    }
    f.escopo.Cache = CacheFalso as unknown as EscopoDoWorker['Cache']
    instalarGuardaDeRede(f.escopo, ORIGEM)
    const traicoeiro = () => {
      let leituras = 0
      return {
        toString() {
          leituras += 1
          return leituras === 1 ? '/assets/a.wasm' : TELEMETRIA
        },
      }
    }
    const cache = new CacheFalso()
    await cache.add(traicoeiro())
    await cache.addAll([traicoeiro(), traicoeiro()])
    expect(adicionados).toEqual([
      ['add', '/assets/a.wasm'],
      ['addAll', ['/assets/a.wasm', '/assets/a.wasm']],
    ])
  })

  test('guarda-conta-bloqueios: cada tentativa bloqueada conta uma vez, sem receber a URL', async () => {
    const f = escopoFalso()
    const aoBloquear = vi.fn((...a: unknown[]) => a)
    instalarGuardaDeRede(f.escopo, ORIGEM, aoBloquear)
    await expect(f.escopo.fetch(TELEMETRIA)).rejects.toBeInstanceOf(TypeError)
    const Xhr = f.escopo.XMLHttpRequest as unknown as new () => { open(...a: unknown[]): void }
    expect(() => new Xhr().open('POST', TELEMETRIA)).toThrow(TypeError)
    await expect(f.escopo.import?.(TELEMETRIA)).rejects.toBeInstanceOf(TypeError)
    expect(aoBloquear).toHaveBeenCalledTimes(3)
    for (const chamada of aoBloquear.mock.calls) expect(chamada).toEqual([])
    // o que passa não conta
    await f.escopo.fetch('/assets/x.wasm')
    expect(aoBloquear).toHaveBeenCalledTimes(3)
    // nem a mensagem do erro leva a URL
    const erro = await f.escopo.fetch(TELEMETRIA).catch((e: unknown) => e)
    expect(String((erro as Error).message)).not.toContain('googleapis')
  })

  test('guarda-nao-pode-ser-desfeita: os caminhos guardados não são graváveis nem reconfiguráveis', async () => {
    const f = escopoFalso()
    instalarGuardaDeRede(f.escopo, ORIGEM)
    const guardado = f.escopo.fetch
    expect(() => {
      f.escopo.fetch = f.fetchOriginal as unknown as typeof fetch
    }).toThrow(TypeError)
    expect(() => {
      ;(f.XhrFalso.prototype as { open: unknown }).open = () => undefined
    }).toThrow(TypeError)
    expect(() => Object.defineProperty(f.escopo, 'import', { value: f.importar })).toThrow(TypeError)
    expect(f.escopo.fetch).toBe(guardado)
    await expect(f.escopo.fetch(TELEMETRIA)).rejects.toBeInstanceOf(TypeError)
  })
})
