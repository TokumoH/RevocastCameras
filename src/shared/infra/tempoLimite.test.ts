import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { fetchComTempoLimite, limitarRestEAuth, TEMPO_LIMITE_SUPABASE_MS } from './tempoLimite'

const ORIGEM = 'https://abc.supabase.co'

/**
 * `fetch` falso que nunca responde sozinho, como uma rede pendurada: só termina quando o teste chama
 * `responder` ou quando o sinal recebido aborta (aí rejeita com o `reason` do sinal, como o `fetch` real).
 */
function criarFetchPendurado() {
  const pedidos: { url: string; init: RequestInit | undefined; responder: (r: Response) => void }[] = []
  const fetchFalso = vi.fn((entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    return new Promise<Response>((resolve, reject) => {
      const sinal = init?.signal
      if (sinal?.aborted) {
        reject(sinal.reason)
        return
      }
      sinal?.addEventListener('abort', () => reject(sinal.reason), { once: true })
      const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
      pedidos.push({ url, init, responder: resolve })
    })
  })
  return { fetchFalso, pedidos }
}

/** Promessa observada: guarda se terminou e como, sem deixar rejeição sem tratamento. */
function observar<T>(promessa: Promise<T>) {
  const estado: { fim: 'pendente' | 'ok' | 'erro'; erro?: unknown; valor?: T } = { fim: 'pendente' }
  promessa.then(
    (v) => {
      estado.fim = 'ok'
      estado.valor = v
    },
    (e: unknown) => {
      estado.fim = 'erro'
      estado.erro = e
    },
  )
  return estado
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TEMPO_LIMITE_SUPABASE_MS', () => {
  test('é 15 s', () => {
    expect(TEMPO_LIMITE_SUPABASE_MS).toBe(15_000)
  })
})

describe('limitarRestEAuth', () => {
  const deveLimitar = limitarRestEAuth(ORIGEM)

  test('rest/v1 e auth/v1 do projeto têm tempo-limite', () => {
    expect(deveLimitar(`${ORIGEM}/rest/v1/rpc/papel_atual`)).toBe(true)
    expect(deveLimitar(`${ORIGEM}/rest/v1/membros_permitidos?select=email&order=email.asc`)).toBe(true)
    expect(deveLimitar(`${ORIGEM}/rest/v1`)).toBe(true)
    expect(deveLimitar(`${ORIGEM}/auth/v1/token?grant_type=refresh_token`)).toBe(true)
    expect(deveLimitar(`${ORIGEM}/auth/v1/user`)).toBe(true)
  })

  test('storage, functions, realtime e outros caminhos do projeto não têm', () => {
    expect(deveLimitar(`${ORIGEM}/storage/v1/object/videos/a.mp4`)).toBe(false)
    expect(deveLimitar(`${ORIGEM}/functions/v1/qualquer`)).toBe(false)
    expect(deveLimitar(`${ORIGEM}/realtime/v1/api/broadcast`)).toBe(false)
    expect(deveLimitar(`${ORIGEM}/rest/v10/x`)).toBe(false)
    expect(deveLimitar(`${ORIGEM}/restx/v1/x`)).toBe(false)
    expect(deveLimitar(`${ORIGEM}/`)).toBe(false)
  })

  test('outro host (mesmo com o caminho rest/v1) não tem', () => {
    expect(deveLimitar('https://outro.supabase.co/rest/v1/rpc/papel_atual')).toBe(false)
    expect(deveLimitar('https://abc.supabase.co.exemplo.test/rest/v1/x')).toBe(false)
    expect(deveLimitar('http://abc.supabase.co/rest/v1/x')).toBe(false)
    expect(deveLimitar('texto que não é URL')).toBe(false)
  })
})

describe('fetchComTempoLimite', () => {
  const deveLimitar = limitarRestEAuth(ORIGEM)

  test('rest/v1 sem resposta rejeita com TimeoutError depois de 15 s, nem um pouco antes', async () => {
    const { fetchFalso } = criarFetchPendurado()
    const f = fetchComTempoLimite(fetchFalso, TEMPO_LIMITE_SUPABASE_MS, deveLimitar)
    const r = observar(f(`${ORIGEM}/rest/v1/rpc/papel_atual`, { method: 'POST' }))
    await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_SUPABASE_MS - 1)
    expect(r.fim).toBe('pendente')
    await vi.advanceTimersByTimeAsync(1)
    expect(r.fim).toBe('erro')
    expect((r.erro as DOMException).name).toBe('TimeoutError')
    expect(vi.getTimerCount()).toBe(0)
  })

  test('auth/v1 sem resposta também rejeita depois de 15 s', async () => {
    const { fetchFalso } = criarFetchPendurado()
    const f = fetchComTempoLimite(fetchFalso, TEMPO_LIMITE_SUPABASE_MS, deveLimitar)
    const r = observar(f(`${ORIGEM}/auth/v1/token?grant_type=refresh_token`, { method: 'POST' }))
    await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_SUPABASE_MS)
    expect(r.fim).toBe('erro')
    expect((r.erro as DOMException).name).toBe('TimeoutError')
  })

  test('aceita URL e Request como entrada', async () => {
    const { fetchFalso } = criarFetchPendurado()
    const f = fetchComTempoLimite(fetchFalso, TEMPO_LIMITE_SUPABASE_MS, deveLimitar)
    const a = observar(f(new URL(`${ORIGEM}/rest/v1/rpc/papel_atual`)))
    const b = observar(f(new Request(`${ORIGEM}/auth/v1/user`)))
    await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_SUPABASE_MS)
    expect(a.fim).toBe('erro')
    expect(b.fim).toBe('erro')
  })

  test('storage/v1 e outro host não têm tempo-limite: o fetch recebe init intacto e nenhum timer é criado', async () => {
    const { fetchFalso, pedidos } = criarFetchPendurado()
    const f = fetchComTempoLimite(fetchFalso, TEMPO_LIMITE_SUPABASE_MS, deveLimitar)
    const init: RequestInit = { method: 'POST' }
    const envio = observar(f(`${ORIGEM}/storage/v1/object/videos/a.mp4`, init))
    const outro = observar(f('https://exemplo.test/rest/v1/x', init))
    expect(vi.getTimerCount()).toBe(0)
    expect(pedidos[0].init).toBe(init)
    expect(pedidos[1].init).toBe(init)
    await vi.advanceTimersByTimeAsync(10 * TEMPO_LIMITE_SUPABASE_MS)
    expect(envio.fim).toBe('pendente')
    expect(outro.fim).toBe('pendente')
  })

  test('o sinal do chamador continua abortando (antes do tempo-limite), com o motivo dele', async () => {
    const { fetchFalso } = criarFetchPendurado()
    const f = fetchComTempoLimite(fetchFalso, TEMPO_LIMITE_SUPABASE_MS, deveLimitar)
    const chamador = new AbortController()
    const r = observar(f(`${ORIGEM}/rest/v1/membros?select=id`, { signal: chamador.signal }))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(r.fim).toBe('pendente')
    // motivo distinto de qualquer AbortError/TimeoutError: só passa se o envoltório repassar o motivo do chamador
    const motivo = new Error('motivo do chamador')
    chamador.abort(motivo)
    await vi.advanceTimersByTimeAsync(0)
    expect(r.fim).toBe('erro')
    expect(r.erro).toBe(motivo)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('o sinal de um Request também é respeitado', async () => {
    const { fetchFalso } = criarFetchPendurado()
    const f = fetchComTempoLimite(fetchFalso, TEMPO_LIMITE_SUPABASE_MS, deveLimitar)
    const chamador = new AbortController()
    const r = observar(f(new Request(`${ORIGEM}/rest/v1/membros`, { signal: chamador.signal })))
    const motivo = new Error('motivo do Request')
    chamador.abort(motivo)
    await vi.advanceTimersByTimeAsync(0)
    expect(r.fim).toBe('erro')
    expect(r.erro).toBe(motivo)
  })

  test('sinal do chamador já abortado: rejeita na hora, sem timer', async () => {
    const { fetchFalso } = criarFetchPendurado()
    const f = fetchComTempoLimite(fetchFalso, TEMPO_LIMITE_SUPABASE_MS, deveLimitar)
    const chamador = new AbortController()
    chamador.abort(new DOMException('já cancelado', 'AbortError'))
    const r = observar(f(`${ORIGEM}/rest/v1/membros`, { signal: chamador.signal }))
    await vi.advanceTimersByTimeAsync(0)
    expect(r.fim).toBe('erro')
    expect((r.erro as DOMException).name).toBe('AbortError')
    expect(vi.getTimerCount()).toBe(0)
  })

  test('com sinal do chamador que não aborta, o tempo-limite ainda vale', async () => {
    const { fetchFalso } = criarFetchPendurado()
    const f = fetchComTempoLimite(fetchFalso, TEMPO_LIMITE_SUPABASE_MS, deveLimitar)
    const chamador = new AbortController()
    const r = observar(f(`${ORIGEM}/rest/v1/membros`, { signal: chamador.signal }))
    await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_SUPABASE_MS)
    expect(r.fim).toBe('erro')
    expect((r.erro as DOMException).name).toBe('TimeoutError')
  })

  test('resposta a tempo: devolve a resposta, limpa o timer e solta o ouvinte do sinal do chamador', async () => {
    const { fetchFalso, pedidos } = criarFetchPendurado()
    const f = fetchComTempoLimite(fetchFalso, TEMPO_LIMITE_SUPABASE_MS, deveLimitar)
    const chamador = new AbortController()
    const remover = vi.spyOn(chamador.signal, 'removeEventListener')
    const r = observar(f(`${ORIGEM}/rest/v1/rpc/papel_atual`, { method: 'POST', signal: chamador.signal }))
    expect(vi.getTimerCount()).toBe(1)
    const resposta = new Response('"admin"', { status: 200 })
    pedidos[0].responder(resposta)
    await vi.advanceTimersByTimeAsync(0)
    expect(r.fim).toBe('ok')
    expect(r.valor).toBe(resposta)
    expect(vi.getTimerCount()).toBe(0)
    expect(remover).toHaveBeenCalledWith('abort', expect.any(Function))
    // nada dispara depois: o sinal entregue ao fetch nunca aborta
    await vi.advanceTimersByTimeAsync(2 * TEMPO_LIMITE_SUPABASE_MS)
    expect(pedidos[0].init?.signal?.aborted).toBe(false)
  })

  test('preserva o init de quem chama (método, cabeçalhos, corpo) e troca só o sinal', async () => {
    const { fetchFalso, pedidos } = criarFetchPendurado()
    const f = fetchComTempoLimite(fetchFalso, TEMPO_LIMITE_SUPABASE_MS, deveLimitar)
    const chamador = new AbortController()
    observar(f(`${ORIGEM}/rest/v1/x`, { method: 'PATCH', headers: { apikey: 'k' }, body: '{}', signal: chamador.signal }))
    expect(pedidos[0].init).toMatchObject({ method: 'PATCH', headers: { apikey: 'k' }, body: '{}' })
    expect(pedidos[0].init?.signal).toBeInstanceOf(AbortSignal)
    expect(pedidos[0].init?.signal).not.toBe(chamador.signal)
    await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_SUPABASE_MS)
  })

  test('fetch que lança na hora (sem promessa) não deixa timer', () => {
    const fetchQueLanca = vi.fn((): Promise<Response> => {
      throw new TypeError('URL inválida')
    })
    const f = fetchComTempoLimite(fetchQueLanca, TEMPO_LIMITE_SUPABASE_MS, deveLimitar)
    const r = observar(f(`${ORIGEM}/rest/v1/x`))
    return Promise.resolve().then(() => {
      expect(r.fim).toBe('erro')
      expect(r.erro).toBeInstanceOf(TypeError)
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  test('falha de rede antes do tempo-limite chega como veio e limpa o timer', async () => {
    const fetchSemRede = vi.fn(async (): Promise<Response> => {
      throw new TypeError('Failed to fetch')
    })
    const f = fetchComTempoLimite(fetchSemRede, TEMPO_LIMITE_SUPABASE_MS, deveLimitar)
    const r = observar(f(`${ORIGEM}/rest/v1/x`))
    await vi.advanceTimersByTimeAsync(0)
    expect(r.fim).toBe('erro')
    expect(r.erro).toBeInstanceOf(TypeError)
    expect(vi.getTimerCount()).toBe(0)
  })
})
