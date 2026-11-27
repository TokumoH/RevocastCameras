// @vitest-environment jsdom
import { afterEach, describe, test, expect, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { App } from './App'
import { resolverRota } from './rotas'
import { criarFalsos, usuarioGoogle } from './servicosFalsos'
import type { TipoDeDispositivo } from '../domains/acesso/dispositivos'

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

/** O que as três rotas de dispositivo mostram sem sessão e sem fragmento (Tarefa 6 da E3). */
const SEM_LINK = 'Este aparelho não está pareado (ou foi revogado). Abra o link ou o QR gerado na aba Ao vivo do painel.'

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
    ['/camera', SEM_LINK],
    ['/obs/palco', SEM_LINK],
    ['/obs/camera', SEM_LINK],
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
    const tipo = { camera: 'camera', obs_palco: 'obs_palco', obs_camera: 'obs_camera' }[nome as string]
    expect(f.chamadas.obterDispositivo).toEqual(tipo === undefined ? [] : [tipo])
    expect(f.chamadas.limparFragmento).toBe(tipo === undefined ? 0 : 1)
    if (nome === 'entrar') await waitFor(() => expect(f.chamadas.navegar).toEqual(['/painel']))
  })

  /**
   * Rota de dispositivo pelo caminho padrão (sem dependências injetadas, módulos novos a cada caso): a
   * tela pede sozinha os serviços do tipo dela (`useDispositivo` → `obterDispositivo(tipo)`, desde a
   * Tarefa 6) e mostra o estado sem sessão. Devolve a `storageKey` de cada `createClient`.
   */
  async function abrirRotaDeDispositivo(caminho: string, frase: string): Promise<string[]> {
    createClient.mockClear()
    vi.resetModules()
    const { App: AppNovo } = await import('./App')
    render(<AppNovo caminho={caminho} />)
    expect(await screen.findByText(frase)).toBeTruthy()
    cleanup()
    return createClient.mock.calls.map((c) => (c[2] as { auth: { storageKey: string } }).auth.storageKey)
  }

  const ROTAS_DE_DISPOSITIVO: [string, TipoDeDispositivo, string][] = [
    ['/camera', 'camera', SEM_LINK],
    ['/obs/palco', 'obs_palco', SEM_LINK],
    ['/obs/camera', 'obs_camera', SEM_LINK],
  ]

  test('caminho-padrao-nao-cria-cliente-em-dispositivo', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abc.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_x')
    for (const [caminho, tipo, frase] of ROTAS_DE_DISPOSITIVO) {
      const chaves = await abrirRotaDeDispositivo(caminho, frase)
      expect(chaves, caminho).not.toContain('revocast-auth-membro')
      expect(chaves, caminho).toEqual([`revocast-auth-${tipo}`])
    }

    // página desconhecida: nenhum cliente
    createClient.mockClear()
    vi.resetModules()
    const { App: Desconhecida } = await import('./App')
    render(<Desconhecida caminho="/xyz" />)
    expect(await screen.findByText('Esse endereço não existe.')).toBeTruthy()
    expect(createClient).toHaveBeenCalledTimes(0)
    cleanup()

    // controle positivo: a rota de membro, pelo mesmo caminho padrão, cria o cliente uma vez
    createClient.mockClear()
    vi.resetModules()
    const { App: AppNovo } = await import('./App')
    render(<AppNovo caminho="/painel" />)
    expect(await screen.findByRole('button', { name: 'Entrar com Google' })).toBeTruthy()
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(createClient.mock.calls[0][2]).toMatchObject({ auth: { storageKey: 'revocast-auth-membro' } })
  })

  test('dispositivo-cria-so-o-proprio-cliente', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abc.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_x')
    for (const [caminho, tipo, frase] of ROTAS_DE_DISPOSITIVO) {
      const chaves = await abrirRotaDeDispositivo(caminho, frase)
      expect(chaves, caminho).toEqual([`revocast-auth-${tipo}`])
      expect(createClient.mock.calls[0][2], caminho).toMatchObject({ auth: { detectSessionInUrl: false } })
    }

    // em /painel, só o de membro
    createClient.mockClear()
    vi.resetModules()
    const { App: AppNovo } = await import('./App')
    render(<AppNovo caminho="/painel" />)
    expect(await screen.findByRole('button', { name: 'Entrar com Google' })).toBeTruthy()
    const chaves = createClient.mock.calls.map((c) => (c[2] as { auth: { storageKey: string } }).auth.storageKey)
    expect(chaves).toEqual(['revocast-auth-membro'])
  })
})
