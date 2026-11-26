import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const createClient = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ marcador: 'cliente' })))
vi.mock('@supabase/supabase-js', () => ({ createClient }))

import { ErroDeConfiguracao } from '../shared/infra/configuracao'
import { ambienteDoVite, criarServicosDeMembro } from './servicos'

const URL_OK = 'https://abc.supabase.co'
const CHAVE_OK = 'sb_publishable_x'

beforeEach(() => createClient.mockClear())

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('criarServicosDeMembro', () => {
  test('sem configuração: lança ErroDeConfiguracao citando a variável e não cria cliente', () => {
    const criar = () => criarServicosDeMembro({})
    expect(criar).toThrow(ErroDeConfiguracao)
    expect(criar).toThrow(/VITE_SUPABASE_URL/)
    expect(createClient).not.toHaveBeenCalled()
  })

  test('com as duas variáveis: um cliente de membro e os dois serviços', () => {
    const servicos = criarServicosDeMembro({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: CHAVE_OK })
    expect(createClient).toHaveBeenCalledTimes(1)
    const [url, chave, opcoes] = createClient.mock.calls[0]
    expect(url).toBe(URL_OK)
    expect(chave).toBe(CHAVE_OK)
    expect(opcoes).toMatchObject({ auth: { storageKey: 'revocast-auth-membro', detectSessionInUrl: true } })
    expect(Object.keys(servicos).sort()).toEqual(['auth', 'repo'])
    expect(typeof servicos.auth.usuarioAtual).toBe('function')
    expect(typeof servicos.repo.papelAtual).toBe('function')
  })
})

describe('ambienteDoVite', () => {
  test('devolve só as duas variáveis do Supabase', () => {
    vi.stubEnv('VITE_SUPABASE_URL', URL_OK)
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', CHAVE_OK)
    vi.stubEnv('VITE_TURN_SENHA', 'nao-deve-aparecer')
    const env = ambienteDoVite()
    expect(Object.keys(env).sort()).toEqual(['VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_URL'])
    expect(env).toEqual({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: CHAVE_OK })
    expect(env).not.toHaveProperty('DEV')
    expect(env).not.toHaveProperty('MODE')
  })
})

describe('obterServicosDeMembro', () => {
  test('cria uma vez por página (cache em módulo)', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', URL_OK)
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', CHAVE_OK)
    vi.resetModules()
    const { obterServicosDeMembro } = await import('./servicos')
    const a = obterServicosDeMembro()
    const b = obterServicosDeMembro()
    expect(a).toBe(b)
    expect(createClient).toHaveBeenCalledTimes(1)
  })

  test('configuração inválida: lança nas duas chamadas e não cria cliente nem guarda cache', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', CHAVE_OK)
    vi.resetModules()
    const servicos = await import('./servicos')
    const { ErroDeConfiguracao: Erro } = await import('../shared/infra/configuracao')
    expect(() => servicos.obterServicosDeMembro()).toThrow(Erro)
    expect(() => servicos.obterServicosDeMembro()).toThrow(/VITE_SUPABASE_URL/)
    expect(createClient).not.toHaveBeenCalled()

    // a configuração corrigida (num teste; numa página real ela não muda) passa a valer: nada ficou guardado
    vi.stubEnv('VITE_SUPABASE_URL', URL_OK)
    servicos.obterServicosDeMembro()
    expect(createClient).toHaveBeenCalledTimes(1)
  })
})

describe('obterServicosDePreparacao', () => {
  test('mesmo cliente de membro: uma página com as duas composições cria 1 cliente', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', URL_OK)
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', CHAVE_OK)
    vi.resetModules()
    const { obterServicosDeMembro, obterServicosDePreparacao } = await import('./servicos')
    const preparacao = obterServicosDePreparacao()
    obterServicosDeMembro()
    expect(obterServicosDePreparacao()).toBe(preparacao)
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(createClient.mock.calls[0][2]).toMatchObject({ auth: { storageKey: 'revocast-auth-membro' } })
    expect(Object.keys(preparacao).sort()).toEqual(['armazenamento', 'cenas', 'episodios', 'gestos', 'midias', 'sons'])
  })

  test('na outra ordem também: 1 cliente', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', URL_OK)
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', CHAVE_OK)
    vi.resetModules()
    const { obterServicosDeMembro, obterServicosDePreparacao } = await import('./servicos')
    obterServicosDeMembro()
    obterServicosDePreparacao()
    expect(createClient).toHaveBeenCalledTimes(1)
  })

  test('configuração inválida: as duas lançam ErroDeConfiguracao e nenhum cliente é criado', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://abc.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', CHAVE_OK)
    vi.resetModules()
    const servicos = await import('./servicos')
    const { ErroDeConfiguracao: Erro } = await import('../shared/infra/configuracao')
    expect(() => servicos.obterServicosDePreparacao()).toThrow(Erro)
    expect(() => servicos.obterServicosDeMembro()).toThrow(Erro)
    expect(() => servicos.obterServicosDePreparacao()).toThrow(/VITE_SUPABASE_URL/)
    expect(createClient).not.toHaveBeenCalled()
  })
})
