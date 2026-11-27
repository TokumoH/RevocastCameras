// @vitest-environment jsdom
import { afterEach, describe, test, expect, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { App } from './App'
import { resolverRota } from './rotas'
import { criarFalsos, usuarioGoogle } from './servicosFalsos'

/** Cliente Supabase mínimo: sem sessão e com a assinatura de eventos que o adaptador cancela. */
const createClient = vi.hoisted(() =>
  vi.fn((..._args: unknown[]) => ({
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  })),
)
vi.mock('@supabase/supabase-js', () => ({ createClient }))

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

const membro = () => criarFalsos({ usuario: usuarioGoogle('ana@revocast.test'), papel: 'equipe' })

describe('App', () => {
  test('mostra a tela de controle com o logo', async () => {
    const f = membro()
    render(<App caminho="/controle" dependencias={f.dependencias()} />)
    expect(await screen.findByRole('heading', { name: 'Controle' })).toBeTruthy()
    expect(screen.getByAltText('RevoCast')).toBeTruthy()
  })

  test('mostra "Página não encontrada" no cartão rosa, com link para /entrar, para caminho desconhecido', () => {
    const { container } = render(<App caminho="/xyz" dependencias={criarFalsos().dependencias()} />)
    expect(screen.getByRole('heading', { name: 'Página não encontrada' })).toBeTruthy()
    expect(container.querySelector('section.cartao.cartao--rosa')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ir para a entrada' }).getAttribute('href')).toBe('/entrar')
  })

  test.each([
    ['/entrar', 'Abrindo a sua área…'],
    ['/painel', 'Iniciar e encerrar o ao vivo chegam na etapa E3.'],
    ['/controle', 'Em construção — etapa E3'],
    ['/camera', 'Em construção — etapa E4'],
    ['/obs/palco', 'Em construção — etapa E3'],
    ['/obs/camera', 'Em construção — etapa E4'],
    ['/xyz', 'Esse endereço não existe.'],
  ])('%s: logo, título de resolverRota (heading e document.title) e a frase "%s"', async (caminho, frase) => {
    const { nome, titulo } = resolverRota(caminho)
    const f = membro()
    render(<App caminho={caminho} dependencias={f.dependencias()} />)
    expect(await screen.findByText(frase)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(titulo)
    expect(document.title).toBe(`${titulo} · RevoCast Câmeras`)
    expect(screen.getByAltText('RevoCast')).toBeTruthy()
    const deMembro = nome === 'entrar' || nome === 'painel' || nome === 'controle'
    expect(f.chamadas.obterServicos).toBe(deMembro ? 1 : 0)
    if (nome === 'entrar') await waitFor(() => expect(f.chamadas.navegar).toEqual(['/painel']))
  })

  test('caminho-padrao-nao-cria-cliente-em-dispositivo', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abc.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_x')
    const casos: [string, string][] = [
      ['/camera', 'Em construção — etapa E4'],
      ['/obs/palco', 'Em construção — etapa E3'],
      ['/obs/camera', 'Em construção — etapa E4'],
      ['/xyz', 'Esse endereço não existe.'],
    ]
    for (const [caminho, frase] of casos) {
      createClient.mockClear()
      vi.resetModules()
      const { App: AppNovo } = await import('./App')
      render(<AppNovo caminho={caminho} />)
      expect(await screen.findByText(frase)).toBeTruthy()
      expect(createClient, caminho).toHaveBeenCalledTimes(0)
      cleanup()
    }

    // controle positivo: a rota de membro, pelo mesmo caminho padrão, cria o cliente uma vez
    createClient.mockClear()
    vi.resetModules()
    const { App: AppNovo } = await import('./App')
    render(<AppNovo caminho="/painel" />)
    expect(await screen.findByRole('button', { name: 'Entrar com Google' })).toBeTruthy()
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(createClient.mock.calls[0][2]).toMatchObject({ auth: { storageKey: 'revocast-auth-membro' } })
  })
})
