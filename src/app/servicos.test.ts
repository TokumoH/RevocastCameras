import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const createClient = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ marcador: 'cliente' })))
vi.mock('@supabase/supabase-js', () => ({ createClient }))

import { ErroDeConfiguracao } from '../shared/infra/configuracao'
import { ambienteDoVite, criarServicosDeMembro } from './servicos'

const URL_OK = 'https://abc.supabase.co'
const CHAVE_OK = 'sb_publishable_x'
const TURN_URL = 'turn:turn.revocast.test:3478'

beforeEach(() => createClient.mockClear())

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
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
  test('devolve só as cinco variáveis (Supabase e TURN opcional, PLA-005 D9)', () => {
    vi.stubEnv('VITE_SUPABASE_URL', URL_OK)
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', CHAVE_OK)
    vi.stubEnv('VITE_TURN_URL', TURN_URL)
    vi.stubEnv('VITE_TURN_USUARIO', 'usuario-de-teste')
    vi.stubEnv('VITE_TURN_SENHA', 'senha-de-teste')
    vi.stubEnv('VITE_OUTRA', 'nao-deve-aparecer')
    const env = ambienteDoVite()
    expect(Object.keys(env).sort()).toEqual(['VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_URL', 'VITE_TURN_SENHA', 'VITE_TURN_URL', 'VITE_TURN_USUARIO'])
    expect(env).toEqual({
      VITE_SUPABASE_URL: URL_OK,
      VITE_SUPABASE_PUBLISHABLE_KEY: CHAVE_OK,
      VITE_TURN_URL: TURN_URL,
      VITE_TURN_USUARIO: 'usuario-de-teste',
      VITE_TURN_SENHA: 'senha-de-teste',
    })
    expect(env).not.toHaveProperty('DEV')
    expect(env).not.toHaveProperty('MODE')
    expect(env).not.toHaveProperty('VITE_OUTRA')
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
    expect(Object.keys(palco).sort()).toEqual(['aparelho', 'canais', 'conexoes', 'gestos', 'palco', 'quadros', 'reconhecedores', 'servico'])
    expect(typeof palco.servico.parear).toBe('function')
    expect(typeof palco.palco.carregar).toBe('function')
    const ID = '5a1c9e2b-7d3f-4b6a-8c1d-2e3f4a5b6c7d'
    expect(palco.canais(ID)).toBe(palco.canais(ID))
    // E5 (PLA-006, Tarefa 4): o repositório dos gestos e os canais de gestos sobre o mesmo cliente do tipo
    expect(Object.keys(palco.gestos).sort()).toEqual(['enviar', 'situacao'])
    expect(typeof palco.canais(ID).gestos).toBe('function')
    expect(typeof palco.canais(ID).gestosDoPalco).toBe('function')

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

describe('obterServicosDeDispositivo: vídeo (PLA-005, Tarefa 3)', () => {
  /** `RTCPeerConnection` falso só para ler a configuração com que o adaptador o cria. */
  function capturarConfiguracoes(): RTCConfiguration[] {
    const configuracoes: RTCConfiguration[] = []
    vi.stubGlobal(
      'RTCPeerConnection',
      class {
        constructor(c: RTCConfiguration) {
          configuracoes.push(c)
        }
        addEventListener() {}
        close() {}
      },
    )
    return configuracoes
  }

  test('conexoes-com-turn', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', URL_OK)
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', CHAVE_OK)
    vi.stubEnv('VITE_TURN_URL', TURN_URL)
    vi.stubEnv('VITE_TURN_USUARIO', 'usuario-de-teste')
    vi.stubEnv('VITE_TURN_SENHA', 'senha-de-teste')
    vi.resetModules()
    const configuracoes = capturarConfiguracoes()
    const { obterServicosDeDispositivo } = await import('./servicos')
    const camera = obterServicosDeDispositivo('camera')
    expect(configuracoes).toEqual([]) // nada de RTCPeerConnection antes de pedir uma conexão
    camera.conexoes.criar().fechar()
    expect(configuracoes).toEqual([
      {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: TURN_URL, username: 'usuario-de-teste', credential: 'senha-de-teste' },
        ],
        bundlePolicy: 'max-bundle',
      },
    ])
    expect(createClient).toHaveBeenCalledTimes(1)
  })

  test('conexoes-sem-turn: só o STUN (uma das três ausente)', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', URL_OK)
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', CHAVE_OK)
    vi.stubEnv('VITE_TURN_URL', TURN_URL)
    vi.stubEnv('VITE_TURN_USUARIO', 'usuario-de-teste')
    vi.resetModules()
    const configuracoes = capturarConfiguracoes()
    const { obterServicosDeDispositivo } = await import('./servicos')
    obterServicosDeDispositivo('obs_camera').conexoes.criar().fechar()
    expect(configuracoes.map((c) => c.iceServers)).toEqual([[{ urls: 'stun:stun.l.google.com:19302' }]])
  })

  test('aparelho e um cliente por tipo', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', URL_OK)
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', CHAVE_OK)
    vi.resetModules()
    const { obterServicosDeDispositivo } = await import('./servicos')
    const camera = obterServicosDeDispositivo('camera')
    const obs = obterServicosDeDispositivo('obs_camera')
    expect(obterServicosDeDispositivo('camera')).toBe(camera)
    expect(createClient).toHaveBeenCalledTimes(2)
    expect(Object.keys(camera.aparelho).sort()).toEqual(['bateria', 'camera', 'tela', 'videoDireto'])
    expect(typeof camera.aparelho.camera().ligar).toBe('function')
    expect(typeof camera.aparelho.tela().travar).toBe('function')
    expect(await camera.aparelho.bateria()).toBeNull() // o ambiente de teste não tem getBattery
    // VER-052 (Riscos do VER-051): sem `RTCPeerConnection` a câmera avisa na tela; lido na hora de cada chamada
    expect(camera.aparelho.videoDireto()).toBe(false)
    vi.stubGlobal('RTCPeerConnection', class {})
    expect(camera.aparelho.videoDireto()).toBe(true)
    vi.unstubAllGlobals()
    expect(camera.aparelho.videoDireto()).toBe(false)
    expect(camera.conexoes).not.toBe(obs.conexoes)
    const ID = '5a1c9e2b-7d3f-4b6a-8c1d-2e3f4a5b6c7d'
    expect(typeof camera.canais(ID).videoDaCamera).toBe('function')
    expect(typeof obs.canais(ID).videoDaObs).toBe('function')
  })
})

describe('obterServicosDeDispositivo: reconhecedores e quadros (PLA-006, Tarefa 6)', () => {
  test('um por página e preguiçosos: nenhum worker ao montar nem ao criar o reconhecedor', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', URL_OK)
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', CHAVE_OK)
    vi.resetModules()
    const workers: unknown[] = []
    vi.stubGlobal(
      'Worker',
      class {
        constructor(...a: unknown[]) {
          workers.push(a)
        }
        postMessage() {}
        terminate() {}
      },
    )
    const { obterServicosDeDispositivo } = await import('./servicos')
    const camera = obterServicosDeDispositivo('camera')
    const obs = obterServicosDeDispositivo('obs_camera')
    // uma fábrica por página, dividida pelos tipos (só uma rota de dispositivo reconhece por vez)
    expect(camera.reconhecedores).toBe(obs.reconhecedores)
    expect(obterServicosDeDispositivo('camera').reconhecedores).toBe(camera.reconhecedores)
    expect(typeof camera.reconhecedores.criar).toBe('function')
    const reconhecedor = camera.reconhecedores.criar()
    expect(typeof reconhecedor.iniciar).toBe('function')
    expect(workers).toEqual([])
    reconhecedor.fechar()
    expect(await reconhecedor.iniciar()).toEqual({ ok: false, motivo: 'outro' }) // fechado antes: nenhum worker (VER-058)
    expect(workers).toEqual([])
    // quadros: uma fonte nova por fluxo, sobre o <video> fora do DOM
    expect(typeof camera.quadros).toBe('function')
    expect(camera.quadros).toBe(obs.quadros)
  })
})
