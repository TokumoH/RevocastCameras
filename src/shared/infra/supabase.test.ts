import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const createClient = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ marcador: 'cliente' })))
vi.mock('@supabase/supabase-js', () => ({ createClient }))

import { chaveDeArmazenamento, criarClienteSupabase, opcoesDeAuth, type TipoDeSessao } from './supabase'
import { limitarRestEAuth, TEMPO_LIMITE_SUPABASE_MS } from './tempoLimite'

const tipos: TipoDeSessao[] = ['membro', 'camera', 'obs_palco', 'obs_camera']

beforeEach(() => createClient.mockClear())

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('chaveDeArmazenamento', () => {
  test('cada tipo de sessão tem chave própria', () => {
    expect(new Set(tipos.map(chaveDeArmazenamento)).size).toBe(4)
  })

  test('segue o formato revocast-auth-<tipo>', () => {
    for (const tipo of tipos) expect(chaveDeArmazenamento(tipo)).toBe(`revocast-auth-${tipo}`)
  })
})

describe('opcoesDeAuth', () => {
  test('PKCE sempre; sessão na URL só para membro', () => {
    expect(opcoesDeAuth('camera')).toMatchObject({ flowType: 'pkce', detectSessionInUrl: false })
    expect(opcoesDeAuth('membro')).toMatchObject({ flowType: 'pkce', detectSessionInUrl: true })
  })

  test('todos os tipos: PKCE, sessão persistida, renovação automática, chave própria', () => {
    for (const tipo of tipos) {
      expect(opcoesDeAuth(tipo)).toMatchObject({
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        storageKey: chaveDeArmazenamento(tipo),
        detectSessionInUrl: tipo === 'membro',
      })
    }
  })
})

describe('criarClienteSupabase', () => {
  const config = { supabaseUrl: 'https://abc.supabase.co', supabaseChavePublica: 'sb_publishable_x' }

  test('repassa URL, chave pública e as opções de auth literais de cada um dos 4 tipos ao createClient', () => {
    tipos.forEach((tipo, i) => {
      const cliente = criarClienteSupabase(config, tipo)
      expect(cliente).toEqual({ marcador: 'cliente' })
      expect(createClient).toHaveBeenCalledTimes(i + 1)
      expect(createClient).toHaveBeenNthCalledWith(i + 1, 'https://abc.supabase.co', 'sb_publishable_x', {
        auth: {
          storageKey: `revocast-auth-${tipo}`,
          flowType: 'pkce',
          detectSessionInUrl: tipo === 'membro',
          persistSession: true,
          autoRefreshToken: true,
        },
        global: { fetch: expect.any(Function) },
      })
    })
    const chaves = createClient.mock.calls.map((c) => (c[2] as { auth: { storageKey: string } }).auth.storageKey)
    expect(new Set(chaves).size).toBe(4)
  })

  test('clientes de tipos diferentes recebem chaves de armazenamento diferentes', () => {
    const clienteA = criarClienteSupabase(config, 'membro')
    const clienteB = criarClienteSupabase(config, 'camera')
    expect(createClient).toHaveBeenCalledTimes(2)
    expect(clienteA).not.toBe(clienteB)
    const [a, b] = createClient.mock.calls.map((c) => (c[2] as { auth: { storageKey: string } }).auth.storageKey)
    expect(a).toBe('revocast-auth-membro')
    expect(b).toBe('revocast-auth-camera')
    expect(a).not.toBe(b)
  })

  test('o fetch entregue ao createClient tem tempo-limite de 15 s em rest/v1 e auth/v1, não em storage/v1', async () => {
    vi.useFakeTimers()
    const urls: string[] = []
    // rede pendurada: só termina quando o sinal aborta
    const fetchGlobal = vi.fn((entrada: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(entrada))
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchGlobal)
    criarClienteSupabase(config, 'membro')
    const opcoes = createClient.mock.calls[0][2] as { global: { fetch: typeof fetch } }
    const fim: Record<string, string> = {}
    for (const caminho of ['/rest/v1/rpc/papel_atual', '/auth/v1/token', '/storage/v1/object/a']) {
      fim[caminho] = 'pendente'
      opcoes.global.fetch(`https://abc.supabase.co${caminho}`, { method: 'POST' }).catch((e: DOMException) => {
        fim[caminho] = e.name
      })
    }
    await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_SUPABASE_MS)
    expect(urls).toHaveLength(3) // chama o fetch global da página (resolvido na hora da chamada)
    expect(fim).toEqual({
      '/rest/v1/rpc/papel_atual': 'TimeoutError',
      '/auth/v1/token': 'TimeoutError',
      '/storage/v1/object/a': 'pendente',
    })
  })
})

describe('Storage fora do tempo-limite (E2, D8)', () => {
  test('storage-fora-do-tempo-limite', () => {
    const url = 'https://abc.supabase.co'
    const limitar = limitarRestEAuth(url)
    // o envio (XMLHttpRequest, com acompanhamento próprio) e a URL assinada da prévia ficam sem os 15 s
    expect(limitar(`${url}/storage/v1/object/midias/x`)).toBe(false)
    expect(limitar(`${url}/storage/v1/object/sign/midias/x`)).toBe(false)
    // controle: o PostgREST das tabelas da Preparação continua com tempo-limite
    expect(limitar(`${url}/rest/v1/midias`)).toBe(true)
  })
})
