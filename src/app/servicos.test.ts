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

describe('obterServicosDeAoVivo', () => {
  test('mesmo cliente de membro: com obterServicosDeMembro, 1 cliente; canais por usuário reaproveitados', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', URL_OK)
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', CHAVE_OK)
    vi.resetModules()
    const { obterServicosDeAoVivo, obterServicosDeMembro, obterServicosDePreparacao } = await import('./servicos')
    const aoVivo = obterServicosDeAoVivo()
    obterServicosDeMembro()
    obterServicosDePreparacao()
    expect(obterServicosDeAoVivo()).toBe(aoVivo)
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(createClient.mock.calls[0][2]).toMatchObject({ auth: { storageKey: 'revocast-auth-membro' } })
    expect(Object.keys(aoVivo).sort()).toEqual(['canais', 'repo'])
    expect(typeof aoVivo.repo.episodioAtivo).toBe('function')
    // um registro de canais por cliente e usuário (I3): o painel e o /controle dividem o mesmo
    const ID = '5a1c9e2b-7d3f-4b6a-8c1d-2e3f4a5b6c7d'
    expect(aoVivo.canais(ID)).toBe(aoVivo.canais(ID))
    expect(aoVivo.canais(ID)).not.toBe(aoVivo.canais('7b2d0f3c-8e4a-4c7b-9d2e-3f4a5b6c7d8e'))
  })

  test('configuração inválida: lança ErroDeConfiguracao e não cria cliente', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', CHAVE_OK)
    vi.resetModules()
    const servicos = await import('./servicos')
    const { ErroDeConfiguracao: Erro } = await import('../shared/infra/configuracao')
    expect(() => servicos.obterServicosDeAoVivo()).toThrow(Erro)
    expect(createClient).not.toHaveBeenCalled()
  })
})

describe('obterServicosDeDispositivo', () => {
  test('um cliente por tipo, preguiçoso, com a storageKey do tipo e sem sessão na URL', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', URL_OK)
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', CHAVE_OK)
    vi.resetModules()
    const { obterServicosDeDispositivo } = await import('./servicos')
    expect(createClient).not.toHaveBeenCalled() // importar não cria cliente
    const palco = obterServicosDeDispositivo('obs_palco')
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(createClient.mock.calls[0][2]).toMatchObject({ auth: { storageKey: 'revocast-auth-obs_palco', detectSessionInUrl: false } })
    expect(obterServicosDeDispositivo('obs_palco')).toBe(palco)
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(Object.keys(palco).sort()).toEqual(['canais', 'palco', 'servico'])
    expect(typeof palco.servico.parear).toBe('function')
    expect(typeof palco.palco.carregar).toBe('function')
    const ID = '5a1c9e2b-7d3f-4b6a-8c1d-2e3f4a5b6c7d'
    expect(palco.canais(ID)).toBe(palco.canais(ID))

    // outro tipo, outro cliente (com a chave dele); nunca o de membro
    obterServicosDeDispositivo('camera')
    expect(createClient).toHaveBeenCalledTimes(2)
    expect(createClient.mock.calls[1][2]).toMatchObject({ auth: { storageKey: 'revocast-auth-camera', detectSessionInUrl: false } })
    const chaves = createClient.mock.calls.map((c) => (c[2] as { auth: { storageKey: string } }).auth.storageKey)
    expect(chaves).not.toContain('revocast-auth-membro')
  })

  test('configuração inválida: lança ErroDeConfiguracao sem cliente e sem guardar nada', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://abc.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', CHAVE_OK)
    vi.resetModules()
    const servicos = await import('./servicos')
    const { ErroDeConfiguracao: Erro } = await import('../shared/infra/configuracao')
    expect(() => servicos.obterServicosDeDispositivo('obs_camera')).toThrow(Erro)
    expect(() => servicos.obterServicosDeDispositivo('obs_camera')).toThrow(/VITE_SUPABASE_URL/)
    expect(createClient).not.toHaveBeenCalled()
    vi.stubEnv('VITE_SUPABASE_URL', URL_OK)
    servicos.obterServicosDeDispositivo('obs_camera')
    expect(createClient).toHaveBeenCalledTimes(1)
  })
})
