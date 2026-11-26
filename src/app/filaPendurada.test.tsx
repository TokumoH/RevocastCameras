// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TEMPO_LIMITE_SUPABASE_MS } from '../shared/infra/tempoLimite'
import { App } from './App'
import { criarServicosDeMembro } from './servicos'
import { criarFalsos } from './servicosFalsos'

/**
 * Fila pendurada (VER-020 → VER-021), de ponta a ponta com o supabase-js real: só o `fetch` global é falso.
 * A sessão já está guardada (não expirada), então `getSession` não vai à rede; `rpc('papel_atual')` fica
 * sem resposta até o sinal abortar. Sem o tempo-limite, a tela ficaria em "Conferindo seu acesso…".
 */

const URL_SUPABASE = 'https://abc.supabase.co'
const CHAVE = 'sb_publishable_teste'

function sessaoGuardada() {
  const agora = Math.floor(Date.now() / 1000)
  return {
    access_token: 'a', // valores curtos: o check-doc-secrets acusa token: '<8+ caracteres>'
    refresh_token: 'r',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: agora + 3600,
    user: {
      id: 'id-ana',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'ana@revocast.test',
      app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: {},
      is_anonymous: false,
      created_at: '2026-11-01T00:00:00Z',
    },
  }
}

type Rede = 'pendurada' | 'boa'

function criarRede() {
  const estado = { rede: 'pendurada' as Rede, papelAtual: 0, outros: [] as string[] }
  const fetchFalso = vi.fn((entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
    if (url === `${URL_SUPABASE}/rest/v1/rpc/papel_atual`) {
      estado.papelAtual++
      if (estado.rede === 'boa') {
        return Promise.resolve(
          new Response('"equipe"', { status: 200, headers: { 'Content-Type': 'application/json' } }),
        )
      }
      return new Promise<Response>((_, reject) => {
        const sinal = init?.signal
        sinal?.addEventListener('abort', () => reject(sinal.reason), { once: true })
      })
    }
    estado.outros.push(url)
    return Promise.reject(new TypeError('Failed to fetch'))
  })
  return { estado, fetchFalso }
}

beforeEach(() => {
  window.localStorage.setItem('revocast-auth-membro', JSON.stringify(sessaoGuardada()))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('fila pendurada', () => {
  test('papel_atual sem resposta → tela de falha depois de 15 s; Tentar de novo com a rede boa → painel', async () => {
    const { estado, fetchFalso } = criarRede()
    vi.stubGlobal('fetch', fetchFalso)
    const servicos = criarServicosDeMembro({ VITE_SUPABASE_URL: URL_SUPABASE, VITE_SUPABASE_PUBLISHABLE_KEY: CHAVE })
    const f = criarFalsos()
    render(<App caminho="/painel" dependencias={f.dependencias({ obterServicos: () => servicos })} />)

    expect(await screen.findByText('Conferindo seu acesso…')).toBeTruthy()
    await vi.waitFor(() => expect(estado.papelAtual).toBe(1))

    await act(() => vi.advanceTimersByTimeAsync(TEMPO_LIMITE_SUPABASE_MS - 1_000))
    expect(screen.getByText('Conferindo seu acesso…')).toBeTruthy()
    expect(estado.papelAtual).toBe(1) // a reavaliação pedida pelo SIGNED_IN da partida espera na fila

    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(await screen.findByRole('heading', { name: 'Não foi possível falar com o servidor' })).toBeTruthy()

    // A reavaliação que esperava na fila começou com a rede ainda pendurada (papel_atual nº 2) e também
    // paga o seu tempo-limite; o "Tentar de novo" entra atrás dela e já encontra a rede boa.
    await vi.waitFor(() => expect(estado.papelAtual).toBe(2))
    estado.rede = 'boa'
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await act(() => vi.advanceTimersByTimeAsync(TEMPO_LIMITE_SUPABASE_MS))
    expect(await screen.findByRole('heading', { name: 'Painel' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy()
    expect(estado.papelAtual).toBe(3)
    expect(estado.outros).toEqual([])
  })

  test('com a rede boa desde o início, nada espera o tempo-limite', async () => {
    const { estado, fetchFalso } = criarRede()
    estado.rede = 'boa'
    vi.stubGlobal('fetch', fetchFalso)
    const servicos = criarServicosDeMembro({ VITE_SUPABASE_URL: URL_SUPABASE, VITE_SUPABASE_PUBLISHABLE_KEY: CHAVE })
    const f = criarFalsos()
    render(<App caminho="/painel" dependencias={f.dependencias({ obterServicos: () => servicos })} />)
    expect(await screen.findByRole('heading', { name: 'Painel' })).toBeTruthy()
    expect(estado.outros).toEqual([])
  })
})
