import { beforeEach, describe, expect, test, vi } from 'vitest'

const createClient = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ marcador: 'cliente' })))
vi.mock('@supabase/supabase-js', () => ({ createClient }))

import { chaveDeArmazenamento, criarClienteSupabase, opcoesDeAuth, type TipoDeSessao } from './supabase'

const tipos: TipoDeSessao[] = ['membro', 'camera', 'obs_palco', 'obs_camera']

beforeEach(() => createClient.mockClear())

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
})
