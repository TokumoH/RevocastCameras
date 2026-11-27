// @vitest-environment jsdom
import { afterEach, beforeEach, describe, test, expect, vi } from 'vitest'
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { lerEstadoNoAr } from '../../domains/aovivo/mensagens'
import { RELEITURA_MINIMA_MS } from '../../domains/aovivo/palco'
import type { RepositorioDoPalco } from '../../domains/aovivo/portas'
import type { ObsWebsocket } from '../../domains/obs/portas'
import { criarObsNoNavegador } from '../../shared/infra/obsNavegador'
import { criarFalsos, criarFalsosDeDispositivo } from '../servicosFalsos'
import { ObsPalco } from './ObsPalco'
import { EVENTOS_DE_SAIDA } from '../../shared/infra/obsNavegador'
import { CHAVE_DO_WEBSOCKET, CONFIG_ABERTA_MS, RECONECTAR_WS_MS, RENOVAR_URLS_MS, SELO_VISIVEL_MS, SITUACAO_A_CADA_MS, TEXTO_DO_PALCO } from './PalcoNoAr'
import { TEXTO_DO_DISPOSITIVO } from './TelaDeDispositivo'

const EP = 'e0000000-0000-4000-8000-000000000001'
const EP2 = 'e0000000-0000-4000-8000-000000000002'
const EU = 'b0000000-0000-4000-8000-0000000000bb'
const DISPOSITIVO = 'd0000000-0000-4000-8000-0000000000dd'
const MEMBRO = 'a0000000-0000-4000-8000-000000000001'
const OUTRO_MEMBRO = 'a0000000-0000-4000-8000-000000000002'
const SOM = '50000000-0000-4000-8000-000000000001'
const AVISO = 'f0000000-0000-4000-8000-000000000001'
const CENA = 'c0000000-0000-4000-8000-00000000000a'
const SENHA = 'senha-de-teste'

let sequencia = 0
const novoId = () => `90000000-0000-4000-8000-${String(++sequencia).padStart(12, '0')}`

type Carga = Awaited<ReturnType<RepositorioDoPalco['carregar']>>
type Aviso = Carga['avisos'][number]

function carga(id: string, titulo: string, aviso: Partial<Aviso> = {}): Carga {
  return {
    episodio: { id, titulo, data: '2026-11-27', estado: 'rascunho' },
    cenas: [{ id: CENA, nomeExibicao: 'Abertura', nomeObs: 'Abertura', ordem: 0 }],
    sons: [{ id: SOM, midiaId: '60000000-0000-4000-8000-000000000001', rotulo: 'Aplauso', emoji: null, volume: 0.8, ordem: 0, caminho: 'som/aplauso.mp3' }],
    avisos: [{ id: AVISO, episodioId: id, titulo: 'Inscreva-se', texto: 'Canal novo', link: null, imagemMidiaId: null, duracaoS: 10, ordem: 0, caminhoDaImagem: null, ...aviso }],
  }
}

type StatusDoObs = { recording: boolean; replaybuffer: boolean; streaming: boolean; virtualcam: boolean }
const PARADO: StatusDoObs = { recording: false, replaybuffer: false, streaming: false, virtualcam: false }

/** `window.obsstudio` falso (obs-browser), respondendo pelo callback; o palco usa o adaptador real sobre ele. */
function instalarObs(o: { nivel?: number; status?: Partial<StatusDoObs> | null; cena?: string } = {}) {
  const chamadas: string[] = []
  const status = () => (o.status === null ? null : { ...PARADO, recordingPaused: false, ...o.status })
  const obsstudio = {
    pluginVersion: '2.24.0',
    getControlLevel: (cb: (v: unknown) => void) => cb(o.nivel ?? 4),
    getScenes: (cb: (v: unknown) => void) => cb(['Abertura']),
    getCurrentScene: (cb: (v: unknown) => void) => {
      chamadas.push('getCurrentScene')
      cb({ name: o.cena ?? 'Abertura', width: 1920, height: 1080 })
    },
    getStatus: (cb: (v: unknown) => void) => {
      chamadas.push('getStatus')
      cb(status())
    },
    setCurrentScene: (nome: string) => chamadas.push(`setCurrentScene:${nome}`),
    saveReplayBuffer: () => chamadas.push('saveReplayBuffer'),
  }
  Object.defineProperty(window, 'obsstudio', { value: obsstudio, configurable: true, writable: true })
  return {
    chamadas,
    mudarStatus(s: Partial<StatusDoObs> | null) {
      o.status = s
    },
    /** A cena do programa passa a ser `nome` (como uma troca feita à mão no OBS). */
    mudarCena(nome: string) {
      o.cena = nome
    },
  }
}

/** obs-websocket falso: guarda cada `conectar` (com a senha, só para conferir que ela vai ao OBS local). */
function wsFalso(primeira: 'conectado' | 'senha_errada' | 'sem_conexao' = 'conectado') {
  let resposta = primeira
  let ligado = false
  const quedas = new Set<() => void>()
  const conexoes: { porta: number; senha: string }[] = []
  const ws: ObsWebsocket = {
    async conectar(c) {
      conexoes.push({ ...c })
      ligado = resposta === 'conectado'
      return resposta
    },
    versao: async () => (ligado ? '31.0.1' : null),
    marcar: async () => ligado,
    conectado: () => ligado,
    aoFechar(f) {
      quedas.add(f)
      return () => quedas.delete(f)
    },
    fechar() {
      ligado = false
    },
  }
  return {
    ws,
    conexoes,
    cair() {
      ligado = false
      for (const f of [...quedas]) f()
    },
    /** O que os próximos `conectar` respondem. */
    responder(r: 'conectado' | 'senha_errada' | 'sem_conexao') {
      resposta = r
    },
  }
}

function armazenamentoFalso(inicial: Record<string, string> = {}) {
  const m = new Map(Object.entries(inicial))
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v)
    },
    removeItem: (k: string) => {
      m.delete(k)
    },
  }
}

/** Esvazia as promessas pendentes e anda `ms` no relógio falso (dentro do `act`). */
async function esperar(ms = 0) {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
    if (ms > 0) await vi.advanceTimersByTimeAsync(ms)
    for (let i = 0; i < 40; i++) await Promise.resolve()
  })
}

function montar(
  o: {
    episodio?: { id: string; modo: 'ao_vivo' | 'teste' } | null
    carga?: Carga
    armazenamento?: Record<string, string>
    ws?: ReturnType<typeof wsFalso>
    /** Chamado antes de desenhar (espiões nos falsos). */
    antes?: (d: ReturnType<typeof criarFalsosDeDispositivo>) => void
    strict?: boolean
  } = {},
) {
  const episodio = o.episodio === undefined ? { id: EP, modo: 'teste' as const } : o.episodio
  const d = criarFalsosDeDispositivo({
    sessao: { usuarioId: EU, anonima: true },
    dispositivo: { id: DISPOSITIVO, tipo: 'obs_palco', rotulo: 'Palco do estúdio', cameraId: null },
    episodioAtivo: episodio,
    carga: o.carga ?? (episodio === null ? undefined : carga(episodio.id, 'Ensaio geral')),
  })
  const episodioAtivo = vi.spyOn(d.servicos.palco, 'episodioAtivo')
  o.antes?.(d)
  const arm = armazenamentoFalso(o.armazenamento)
  const ws = o.ws ?? wsFalso()
  const dep = criarFalsos().dependencias({ obterDispositivo: () => d.servicos })
  const tela = <ObsPalco titulo="Palco" dependencias={dep} obs={criarObsNoNavegador()} criarWs={() => ws.ws} armazenamentoLocal={arm} />
  const r = render(o.strict ? <StrictMode>{tela}</StrictMode> : tela)
  const controle = (id = EP) => `episodio:${id}:controle`
  /** Quantos canais já foram criados para o tópico (reabrir o `:controle` cria outro). */
  const criados = (topico: string) => d.canal.realtime.criados.filter((c) => c.topico === topico).length
  return { d, r, arm, ws, episodioAtivo, controle, criados }
}

/** Presença do `:controle` (membros) que os testes de comando simulam: o palco só aceita comando de quem está nela (VER-046, I4). */
function presentesNoControle(m: ReturnType<typeof montar>, usuarios: string[], ep = EP) {
  act(() => m.d.canal.sincronizarPresenca(m.controle(ep), Object.fromEntries(usuarios.map((u) => [u, [{}]]))))
}

/** Comando de um membro: por padrão ele está na presença do `:controle` (`naPresenca: false` simula quem não está). */
function comando(m: ReturnType<typeof montar>, payload: Record<string, unknown>, remetente = MEMBRO, ep = EP, o: { naPresenca?: boolean } = {}) {
  if (o.naPresenca !== false) presentesNoControle(m, [MEMBRO, OUTRO_MEMBRO, remetente], ep)
  act(() => m.d.canal.entregar(m.controle(ep), 'comando', { id: novoId(), ...payload, remetente }))
}

function tecla(key: string) {
  act(() => {
    fireEvent.keyDown(window, { key })
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete (window as { obsstudio?: unknown }).obsstudio
})

describe('/obs/palco no ar (D9, D10, D15, D16)', () => {
  test.each([
    ['sem episódio', null],
    ['modo teste', { id: EP, modo: 'teste' as const }],
    ['ao_vivo', { id: EP, modo: 'ao_vivo' as const }],
  ])('palco-sem-nada-sem-tecla (%s)', async (_nome, episodio) => {
    instalarObs()
    const m = montar({ episodio })
    await esperar()
    expect(m.d.canal.abertos()).toEqual(episodio === null ? ['estudio'] : ['estudio', m.controle()])
    await esperar(60_000)
    expect(m.r.container.textContent).toBe('')
    expect(m.r.container.querySelector('input, form, .selo-do-palco, .aviso-no-ar')).toBeNull()
  })

  test.each([
    ['sem episódio', null, TEXTO_DO_PALCO.aguardando],
    ['modo teste', { id: EP, modo: 'teste' as const }, 'Modo teste: Ensaio geral'],
  ])('selo-por-tecla (%s)', async (_nome, episodio, frase) => {
    instalarObs()
    const m = montar({ episodio })
    await esperar()
    tecla('s')
    await esperar()
    expect(screen.getByText(frase)).toBeTruthy()
    expect(screen.getByText('Pareado como Palco do estúdio')).toBeTruthy()
    await esperar(SELO_VISIVEL_MS - 1)
    expect(screen.queryByText(frase)).not.toBeNull()
    await esperar(1)
    expect(m.r.container.textContent).toBe('')
  })

  test.each([
    ['transmitindo', { nivel: 4, status: { streaming: true } }],
    ['gravando', { nivel: 4, status: { recording: true } }],
    ['Replay Buffer ativo', { nivel: 4, status: { replaybuffer: true } }],
    ['câmera virtual', { nivel: 4, status: { virtualcam: true } }],
    ['status null', { nivel: 4, status: null }],
    ['nível abaixo de READ_OBS', { nivel: 0, status: {} }],
  ])('selo-e-config-recusados-no-ar (%s)', async (_nome, obs) => {
    instalarObs(obs)
    const m = montar()
    await esperar()
    tecla('s')
    tecla('c')
    await esperar(4000) // o adaptador desiste em 3 s se o OBS não responde
    expect(m.r.container.textContent).toBe('')
    expect(m.r.container.querySelector('input')).toBeNull()
  })

  test('sem window.obsstudio, selo e configuração também são recusados', async () => {
    const m = montar()
    await esperar()
    tecla('s')
    tecla('c')
    await esperar(4000)
    expect(m.r.container.textContent).toBe('')
  })

  test.each(['obsStreamingStarting', 'obsRecordingStarting', 'obsReplaybufferStarting', 'obsVirtualcamStarted'])('selo-e-config-recusados-no-ar: %s fecha o painel e o selo na hora', async (evento) => {
    instalarObs()
    const m = montar({ episodio: null })
    await esperar()
    tecla('c')
    tecla('s')
    await esperar()
    expect(screen.getByText(TEXTO_DO_PALCO.avisoDaConfig)).toBeTruthy()
    expect(screen.getByText(TEXTO_DO_PALCO.aguardando)).toBeTruthy()
    act(() => {
      window.dispatchEvent(new Event(evento))
    })
    // na hora: sem esperar promessa nem relógio
    expect(m.r.container.textContent).toBe('')
    expect(m.r.container.querySelector('input')).toBeNull()
  })

  test('selo-e-config-recusados-no-ar: o evento que chega durante a conferência vence', async () => {
    const obs = instalarObs()
    const m = montar()
    await esperar()
    tecla('c') // a conferência do status ainda vai responder "parado"...
    act(() => {
      // ...mas a transmissão começou antes da resposta (o `Starting` chega antes de o `getStatus` dizer `streaming`)
      window.dispatchEvent(new Event('obsStreamingStarting'))
    })
    await esperar()
    expect(obs.chamadas).toContain('getStatus') // a conferência terminou dizendo "parado"
    expect(m.r.container.querySelector('input')).toBeNull()
    // VER-046, rodada 1: o status continua "parado" até o `Started`, então a tecla `s` também é recusada depois do
    // `Starting` (antes, o selo abria nessa janela)
    tecla('s')
    await esperar()
    expect(screen.queryByText('Pareado como Palco do estúdio')).toBeNull()
    // controle: com o fim da mesma saída, abre
    act(() => {
      window.dispatchEvent(new Event('obsStreamingStopped'))
    })
    tecla('s')
    await esperar()
    expect(screen.getByText('Pareado como Palco do estúdio')).toBeTruthy()
    expect(m.r.container.querySelector('input')).toBeNull()
  })

  test('palco-mostra-aviso-literal', async () => {
    instalarObs()
    const m = montar({
      carga: carga(EP, 'Ensaio geral', { titulo: '<b>x</b>', texto: '<script>alert(1)</script>\nlinha 2', link: 'https://revocast.test/inscreva', caminhoDaImagem: 'imagem/cartaz.png' }),
    })
    await esperar()
    comando(m, { acao: 'aviso', avisoId: AVISO })
    await esperar()
    const cartao = m.r.container.querySelector('.aviso-no-ar')
    expect(cartao).not.toBeNull()
    expect(screen.getByText('<b>x</b>')).toBeTruthy()
    expect(m.r.container.textContent).toContain('<script>alert(1)</script>')
    expect(screen.getByText('https://revocast.test/inscreva')).toBeTruthy()
    expect(m.r.container.querySelector('script, b, a')).toBeNull()
    expect(m.r.container.querySelector('img')?.getAttribute('src')).toBe('https://armazenamento.revocast.test/assinada/imagem/cartaz.png?token=teste')
    // o cartão é a única coisa com texto na tela
    expect(m.r.container.textContent).toBe(cartao?.textContent)
    // o prazo do aviso o tira do ar
    await esperar(10_000)
    expect(m.r.container.querySelector('.aviso-no-ar')).toBeNull()
  })

  test('palco-toca-som', async () => {
    instalarObs()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const m = montar()
    await esperar()
    const audio = m.r.container.querySelector('audio') as HTMLAudioElement
    expect(audio.getAttribute('preload')).toBe('auto')
    expect(audio.getAttribute('src')).toBe('https://armazenamento.revocast.test/assinada/som/aplauso.mp3?token=teste')
    audio.currentTime = 7
    comando(m, { acao: 'som', somId: SOM })
    await esperar()
    expect(play).toHaveBeenCalledTimes(1)
    expect(play.mock.contexts[0]).toBe(audio)
    expect(audio.currentTime).toBe(0)
    expect(audio.volume).toBe(0.8)
    const estado = m.d.canal.enviados(m.controle()).filter((e) => e.event === 'estado').at(-1)?.payload as { ultimo: { resultado: string } }
    expect(estado.ultimo.resultado).toBe('ok')
    expect(m.d.chamadas.registros).toHaveLength(1)
  })

  test('palco-presenca-com-obs', async () => {
    const sem = montar({ episodio: null })
    await esperar()
    expect(sem.d.canal.presencas('estudio').at(-1)).toEqual({
      tipo: 'obs_palco',
      dispositivoId: DISPOSITIVO,
      obs: { navegador: false, versaoDoPlugin: null, nivel: null, websocket: 'desligado', versaoObs: null, replayBuffer: null, gravando: null },
    })
    cleanup()

    instalarObs({ nivel: 4, status: { recording: true, replaybuffer: true } })
    const com = montar({ episodio: null })
    await esperar()
    expect(com.d.canal.presencas('estudio').at(-1)).toEqual({
      tipo: 'obs_palco',
      dispositivoId: DISPOSITIVO,
      obs: { navegador: true, versaoDoPlugin: '2.24.0', nivel: 4, websocket: 'desligado', versaoObs: null, replayBuffer: true, gravando: true },
    })
  })

  test('situação relida nos eventos de saída e a cada 15 s', async () => {
    const obs = instalarObs({ nivel: 4, status: {} })
    const m = montar({ episodio: null })
    await esperar()
    expect((m.d.canal.presencas('estudio').at(-1) as { obs: { gravando: boolean } }).obs.gravando).toBe(false)
    obs.mudarStatus({ recording: true })
    act(() => {
      window.dispatchEvent(new Event('obsRecordingStarted'))
    })
    await esperar()
    expect((m.d.canal.presencas('estudio').at(-1) as { obs: { gravando: boolean } }).obs.gravando).toBe(true)
    obs.mudarStatus({})
    await esperar(15_000)
    expect((m.d.canal.presencas('estudio').at(-1) as { obs: { gravando: boolean } }).obs.gravando).toBe(false)
  })

  test('palco-config-escondida', async () => {
    instalarObs()
    const m = montar()
    await esperar()
    expect(m.r.container.querySelector('input')).toBeNull()
    tecla('c')
    await esperar()
    expect(screen.getByText('Este painel aparece na transmissão: configure antes de ir ao ar.')).toBeTruthy()
    const senha = screen.getByLabelText(TEXTO_DO_PALCO.senha) as HTMLInputElement
    expect(senha.type).toBe('password')
    expect(senha.value).toBe('')
    // digitar "s" ou "c" no campo não abre nem fecha nada
    fireEvent.keyDown(senha, { key: 's' })
    await esperar()
    expect(screen.queryByText('Pareado como Palco do estúdio')).toBeNull()
    fireEvent.change(senha, { target: { value: SENHA } })
    fireEvent.change(screen.getByLabelText(TEXTO_DO_PALCO.porta), { target: { value: '4456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await esperar()
    expect(JSON.parse(m.arm.m.get(CHAVE_DO_WEBSOCKET) as string)).toEqual({ porta: 4456, senha: SENHA })
    expect(m.ws.conexoes.at(-1)).toEqual({ porta: 4456, senha: SENHA })
    // painel fechado; a senha não fica no DOM, na presença nem no estado publicado
    expect(m.r.container.querySelector('input')).toBeNull()
    expect(document.body.innerHTML).not.toContain(SENHA)
    expect(JSON.stringify(m.d.canal.presencas('estudio'))).not.toContain(SENHA)
    expect(JSON.stringify(m.d.canal.enviados(m.controle()))).not.toContain(SENHA)
    expect((m.d.canal.presencas('estudio').at(-1) as { obs: { websocket: string } }).obs.websocket).toBe('conectado')
    // reaberto: o campo vem vazio e a porta salva
    tecla('c')
    await esperar()
    expect((screen.getByLabelText(TEXTO_DO_PALCO.senha) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(TEXTO_DO_PALCO.porta) as HTMLInputElement).value).toBe('4456')
    // salvar com a senha em branco mantém a salva
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await esperar()
    expect(JSON.parse(m.arm.m.get(CHAVE_DO_WEBSOCKET) as string)).toEqual({ porta: 4456, senha: SENHA })
    // fecha sozinho em 2 min
    tecla('c')
    await esperar()
    expect(screen.getByText(TEXTO_DO_PALCO.avisoDaConfig)).toBeTruthy()
    await esperar(CONFIG_ABERTA_MS - 1)
    expect(screen.queryByText(TEXTO_DO_PALCO.avisoDaConfig)).not.toBeNull()
    await esperar(1)
    expect(m.r.container.textContent).toBe('')
  })

  test('porta inválida não salva', async () => {
    instalarObs()
    const m = montar()
    await esperar()
    tecla('c')
    await esperar()
    fireEvent.change(screen.getByLabelText(TEXTO_DO_PALCO.porta), { target: { value: '70000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await esperar()
    expect(screen.getByText(TEXTO_DO_PALCO.portaInvalida)).toBeTruthy()
    expect(m.arm.m.has(CHAVE_DO_WEBSOCKET)).toBe(false)
  })

  test('websocket salvo conecta ao abrir; queda reconecta no mesmo objeto', async () => {
    instalarObs({ nivel: 4, status: { recording: true } })
    const ws = wsFalso()
    const m = montar({ armazenamento: { [CHAVE_DO_WEBSOCKET]: JSON.stringify({ porta: 4455, senha: SENHA }) }, ws })
    await esperar()
    expect(ws.conexoes).toEqual([{ porta: 4455, senha: SENHA }])
    expect((m.d.canal.presencas('estudio').at(-1) as { obs: { websocket: string; versaoObs: string } }).obs).toMatchObject({ websocket: 'conectado', versaoObs: '31.0.1' })
    act(() => ws.cair())
    await esperar()
    expect((m.d.canal.presencas('estudio').at(-1) as { obs: { websocket: string } }).obs.websocket).toBe('sem_conexao')
    // o marcador pedido com o websocket caído responde sem_websocket (o executor não foi recriado)
    comando(m, { acao: 'marcador' })
    await esperar()
    const ultimo = () => (m.d.canal.enviados(m.controle()).filter((e) => e.event === 'estado').at(-1)?.payload as { ultimo: { resultado: string; motivo: string | null } }).ultimo
    expect(ultimo()).toMatchObject({ resultado: 'falhou', motivo: 'sem_websocket' })
    await esperar(RECONECTAR_WS_MS)
    expect(ws.conexoes).toHaveLength(2)
    expect((m.d.canal.presencas('estudio').at(-1) as { obs: { websocket: string } }).obs.websocket).toBe('conectado')
    comando(m, { acao: 'marcador' })
    await esperar()
    expect(ultimo()).toMatchObject({ resultado: 'ok', motivo: null })
  })

  test('senha recusada aparece na presença, nunca a senha', async () => {
    instalarObs()
    const m = montar({ armazenamento: { [CHAVE_DO_WEBSOCKET]: JSON.stringify({ porta: 4455, senha: SENHA }) }, ws: wsFalso('senha_errada') })
    await esperar()
    const ultima = m.d.canal.presencas('estudio').at(-1) as { obs: { websocket: string } }
    expect(ultima.obs.websocket).toBe('senha_errada')
    expect(JSON.stringify(m.d.canal.presencas('estudio'))).not.toContain(SENHA)
  })

  test('palco-reconecta', async () => {
    instalarObs()
    const m = montar()
    await esperar()
    expect(m.episodioAtivo).toHaveBeenCalledTimes(1)
    const estados = () => m.d.canal.enviados(m.controle()).filter((e) => e.event === 'estado')
    const antes = estados().length
    expect(antes).toBeGreaterThan(0) // publicado ao conectar o `:controle`
    act(() => {
      m.d.canal.definirEstado('estudio', 'reconectando')
      m.d.canal.definirEstado(m.controle(), 'reconectando')
    })
    await esperar()
    act(() => {
      m.d.canal.definirEstado('estudio', 'conectado')
      m.d.canal.definirEstado(m.controle(), 'conectado')
    })
    await esperar()
    expect(m.episodioAtivo).toHaveBeenCalledTimes(2)
    expect(estados().length).toBeGreaterThan(antes)
    expect(lerEstadoNoAr(estados().at(-1)?.payload)).not.toBeNull()
    expect(m.d.canal.abertos()).toEqual(['estudio', m.controle()]) // o mesmo episódio: nada reaberto
  })

  test('palco-reconecta: o `:controle` de volta a conectado republica o estado', async () => {
    instalarObs()
    const m = montar()
    await esperar()
    const estados = () => m.d.canal.enviados(m.controle()).filter((e) => e.event === 'estado')
    const antes = estados().length
    act(() => m.d.canal.definirEstado(m.controle(), 'reconectando'))
    await esperar()
    act(() => m.d.canal.definirEstado(m.controle(), 'conectado'))
    await esperar()
    expect(estados().length).toBe(antes + 1)
    expect(m.episodioAtivo).toHaveBeenCalledTimes(1) // só o `estudio` reconsulta o episódio
  })

  test('websocket-sem-reiniciar-no-ar: a reconexão com a senha recusada não tira o aviso da transmissão', async () => {
    const obs = instalarObs({ nivel: 4, status: { streaming: true } })
    const ws = wsFalso()
    const m = montar({ armazenamento: { [CHAVE_DO_WEBSOCKET]: JSON.stringify({ porta: 4455, senha: SENHA }) }, ws, carga: carga(EP, 'Ensaio geral', { duracaoS: 120 }) })
    await esperar()
    comando(m, { acao: 'aviso', avisoId: AVISO })
    await esperar()
    expect(m.r.container.querySelector('.aviso-no-ar')).not.toBeNull()
    expect(m.criados(m.controle())).toBe(1)
    const ultimoEstado = () => m.d.canal.enviados(m.controle()).filter((e) => e.event === 'estado').at(-1)?.payload as { avisoId: string | null; ultimo: { acao: string } | null }
    const websocket = () => (m.d.canal.presencas('estudio').at(-1) as { obs: { websocket: string } }).obs.websocket
    // o OBS reinicia o obs-websocket com outra senha: cai, e a reconexão volta `senha_errada`
    ws.responder('senha_errada')
    act(() => ws.cair())
    await esperar(RECONECTAR_WS_MS)
    expect(ws.conexoes).toHaveLength(2)
    expect(websocket()).toBe('senha_errada')
    expect(m.r.container.querySelector('.aviso-no-ar')).not.toBeNull()
    expect(m.criados(m.controle())).toBe(1) // o `:controle` não foi reaberto
    expect(ultimoEstado()).toMatchObject({ avisoId: AVISO, ultimo: { acao: 'aviso' } }) // o estado não foi zerado
    // "Salvar" fora do ar (a saída parou): conecta de novo sem reiniciar a sessão
    obs.mudarStatus({})
    act(() => {
      window.dispatchEvent(new Event('obsStreamingStopped'))
    })
    ws.responder('conectado')
    tecla('c')
    await esperar()
    fireEvent.change(screen.getByLabelText(TEXTO_DO_PALCO.senha), { target: { value: 'outra-senha-de-teste' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await esperar()
    expect(websocket()).toBe('conectado')
    expect(m.r.container.querySelector('.aviso-no-ar')).not.toBeNull()
    expect(m.criados(m.controle())).toBe(1)
    expect(ultimoEstado()).toMatchObject({ avisoId: AVISO })
  })

  test('palco-renova-urls (e não corta o som que está tocando)', async () => {
    instalarObs()
    let n = 0
    const m = montar({
      antes: (d) => {
        vi.spyOn(d.servicos.palco, 'urlDoArquivo').mockImplementation(async (c) => `https://armazenamento.revocast.test/assinada/${c}?token=${++n}`)
      },
    })
    await esperar()
    const audio = m.r.container.querySelector('audio') as HTMLAudioElement
    expect(audio.getAttribute('src')).toMatch(/token=1$/)
    await esperar(RENOVAR_URLS_MS - 1)
    expect(audio.getAttribute('src')).toMatch(/token=1$/)
    await esperar(1)
    expect(audio.getAttribute('src')).toMatch(/token=2$/)
    // tocando: a URL nova espera o fim do som
    Object.defineProperty(audio, 'paused', { value: false, configurable: true })
    await esperar(RENOVAR_URLS_MS)
    expect(audio.getAttribute('src')).toMatch(/token=2$/)
    Object.defineProperty(audio, 'paused', { value: true, configurable: true })
    act(() => {
      audio.dispatchEvent(new Event('ended'))
    })
    await esperar()
    expect(audio.getAttribute('src')).toMatch(/token=3$/)
  })

  test('palco-troca-sem-vazar: o palco velho para (nenhum timer a mais)', async () => {
    instalarObs()
    const m = montar()
    await esperar()
    const timers = vi.getTimerCount()
    m.d.definirEpisodioAtivo({ id: EP2, modo: 'ao_vivo' })
    m.d.definirCarga(carga(EP2, 'Episódio dois'))
    act(() => m.d.canal.entregar('estudio', 'episodio_ativo_mudou', { remetente: MEMBRO }))
    await esperar()
    expect(m.d.canal.abertos()).toEqual(['estudio', m.controle(EP2)])
    expect(vi.getTimerCount()).toBe(timers)
  })

  test('palco-desmonta-limpo', async () => {
    instalarObs()
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const m = montar()
    await esperar()
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    m.r.unmount()
    await esperar()
    expect(vi.getTimerCount()).toBe(0)
    expect(m.d.canal.abertos()).toEqual([])
    for (const tipo of ['keydown', ...EVENTOS_DE_SAIDA]) {
      const conta = (spy: typeof add) => spy.mock.calls.filter((c) => c[0] === tipo).length
      expect(conta(add), tipo).toBeGreaterThan(0)
      expect(conta(remove), tipo).toBe(conta(add))
    }
  })

  test('palco-strict-mode: um `estudio` e um `:controle`', async () => {
    instalarObs()
    const m = montar({ strict: true })
    await esperar()
    expect(m.d.canal.abertos()).toEqual(['estudio', m.controle()])
  })

  test('palco-canal-fechado durante a consulta do episódio: o `:controle` não reabre sozinho', async () => {
    instalarObs()
    let soltar: () => void = () => {}
    const m = montar({
      antes: (d) => {
        vi.spyOn(d.servicos.palco, 'episodioAtivo').mockImplementationOnce(
          () => new Promise((r) => (soltar = () => r({ id: EP, modo: 'teste' }))),
        )
      },
    })
    await esperar()
    expect(m.d.canal.abertos()).toEqual(['estudio']) // a consulta está pendente
    act(() => m.d.canal.definirEstado('estudio', 'fechado'))
    await esperar()
    soltar()
    await esperar(1000)
    expect(m.d.canal.abertos()).toEqual([])
    await esperar(4000)
    expect(m.d.canal.abertos()).toEqual(['estudio', m.controle()])
  })

  test.each([
    ['transmissão', { streaming: true }],
    ['status desconhecido', null],
  ] as const)('releitura de 15 s fecha selo e painel (%s, sem evento do obs-browser)', async (_nome, status) => {
    const obs = instalarObs()
    const m = montar({ episodio: null })
    await esperar()
    tecla('c')
    tecla('s')
    await esperar()
    expect(m.r.container.querySelector('input')).not.toBeNull()
    obs.mudarStatus(status)
    await esperar(SELO_VISIVEL_MS - 1000) // o selo ainda estaria aberto
    expect(m.r.container.querySelector('.selo-do-palco')).not.toBeNull()
    await esperar(SITUACAO_A_CADA_MS - SELO_VISIVEL_MS + 1000)
    expect(m.r.container.querySelector('input')).toBeNull()
    expect(m.r.container.textContent).toBe('')
  })

  test('palco-troca-de-episodio', async () => {
    const obs = instalarObs({ nivel: 4, status: { replaybuffer: true } })
    const m = montar()
    await esperar()
    expect(m.d.canal.abertos()).toEqual(['estudio', m.controle(EP)])
    // um clipe esperando os 5 s não é salvo depois da troca (executor.parar(), VER-039 N5)
    comando(m, { acao: 'clipe' })
    await esperar()
    m.d.definirEpisodioAtivo({ id: EP2, modo: 'ao_vivo' })
    m.d.definirCarga(carga(EP2, 'Episódio dois'))
    act(() => m.d.canal.entregar('estudio', 'episodio_ativo_mudou', { remetente: MEMBRO }))
    await esperar()
    expect(m.d.canal.abertos()).toEqual(['estudio', m.controle(EP2)])
    await esperar(6000)
    expect(obs.chamadas).not.toContain('saveReplayBuffer')
    // comandos do tópico antigo não chegam; os do novo, sim
    comando(m, { acao: 'aviso', avisoId: AVISO }, MEMBRO, EP2)
    await esperar()
    expect(m.r.container.querySelector('.aviso-no-ar')).not.toBeNull()
  })

  test('palco-canal-fechado (sem dispositivo → revogado)', async () => {
    instalarObs()
    const m = montar()
    await esperar()
    m.d.definirDispositivo(null)
    act(() => m.d.canal.definirEstado('estudio', 'fechado'))
    await esperar()
    expect(screen.getByText(TEXTO_DO_DISPOSITIVO.revogado)).toBeTruthy()
    expect(m.d.chamadas.sair).toBe(1)
    expect(m.d.canal.abertos()).toEqual([])
  })

  test.each(['fechado', 'negado'] as const)('palco-canal-fechado (com dispositivo, %s → reabre em 5 s)', async (estado) => {
    instalarObs()
    const m = montar()
    await esperar()
    act(() => m.d.canal.definirEstado(m.controle(), estado))
    await esperar()
    expect(m.d.canal.abertos()).toEqual([])
    expect(m.d.chamadas.sair).toBe(0)
    await esperar(4999)
    expect(m.d.canal.abertos()).toEqual([])
    await esperar(1)
    expect(m.d.canal.abertos()).toEqual(['estudio', m.controle()])
    expect(screen.queryByText(TEXTO_DO_DISPOSITIVO.revogado)).toBeNull()
    expect(m.r.container.textContent).toBe('')
  })

  test('palco revogado na hora; revogação de outro descarta o remetente', async () => {
    instalarObs()
    const m = montar()
    await esperar()
    act(() => m.d.canal.entregar('estudio', 'revogacao', { usuario: OUTRO_MEMBRO, remetente: MEMBRO }))
    await esperar()
    comando(m, { acao: 'aviso', avisoId: AVISO }, OUTRO_MEMBRO)
    await esperar()
    expect(m.r.container.querySelector('.aviso-no-ar')).toBeNull()
    expect(m.d.chamadas.sair).toBe(0)

    act(() => m.d.canal.entregar('estudio', 'revogacao', { usuario: EU, remetente: MEMBRO }))
    await esperar()
    expect(screen.getByText(TEXTO_DO_DISPOSITIVO.revogado)).toBeTruthy()
    expect(m.d.chamadas.sair).toBe(1)
    expect(m.d.canal.abertos()).toEqual([])
  })
})

/** Último estado publicado pelo palco no `:controle`. */
function ultimoEstado(m: ReturnType<typeof montar>, ep = EP): Record<string, unknown> | undefined {
  return m.d.canal.enviados(m.controle(ep)).filter((e) => e.event === 'estado').at(-1)?.payload as Record<string, unknown> | undefined
}

describe('/obs/palco: revisão final da E3 (VER-046)', () => {
  test.each([
    ['transmissão', { status: { streaming: true } }],
    ['gravação', { status: { recording: true } }],
    ['status desconhecido (sem resposta)', { status: null }],
    ['nível abaixo de READ_OBS', { nivel: 0 }],
  ] as const)('palco revogado no ar não aparece na transmissão (I1, D16): %s', async (_nome, o) => {
    instalarObs(o)
    const m = montar()
    await esperar()
    act(() => m.d.canal.entregar('estudio', 'revogacao', { usuario: EU, remetente: MEMBRO }))
    await esperar()
    expect(m.d.chamadas.sair).toBe(1)
    expect(m.d.canal.abertos()).toEqual([])
    expect(m.r.container.textContent).toBe('')
    expect(screen.queryByText(TEXTO_DO_DISPOSITIVO.revogado)).toBeNull()
    await esperar(SITUACAO_A_CADA_MS)
    expect(m.r.container.textContent).toBe('')
  })

  test('troca do aparelho (revogação pelo canal fechado) também não aparece no ar (I1)', async () => {
    instalarObs({ status: { replaybuffer: true } })
    const m = montar()
    await esperar()
    m.d.definirDispositivo(null)
    act(() => m.d.canal.definirEstado('estudio', 'fechado'))
    await esperar()
    expect(m.d.chamadas.sair).toBe(1)
    expect(m.r.container.textContent).toBe('')
  })

  test('a mensagem de revogado aparece com a saída parada e some no início da saída (I1)', async () => {
    const obs = instalarObs()
    const m = montar()
    await esperar()
    act(() => m.d.canal.entregar('estudio', 'revogacao', { usuario: EU, remetente: MEMBRO }))
    await esperar()
    expect(screen.getByText(TEXTO_DO_DISPOSITIVO.revogado)).toBeTruthy()
    // o evento de início some com a tela na hora, já no Starting (antes da releitura do status)
    act(() => {
      window.dispatchEvent(new Event('obsStreamingStarting'))
    })
    expect(m.r.container.textContent).toBe('')
    obs.mudarStatus({ streaming: true })
    await esperar()
    expect(m.r.container.textContent).toBe('')
    // a saída para de novo (o `Stopped` da mesma saída): volta a mostrar
    obs.mudarStatus({})
    act(() => {
      window.dispatchEvent(new Event('obsStreamingStopped'))
    })
    await esperar()
    expect(screen.getByText(TEXTO_DO_DISPOSITIVO.revogado)).toBeTruthy()
  })

  test.each(['Recording', 'Streaming', 'Replaybuffer'])(
    'Starting de %s com o status ainda "parado": a tela continua vazia até o Stopped ou duas releituras (I1, rodada 1)',
    async (saida) => {
      instalarObs() // o getStatus continua dizendo "parado" (como no obs-browser antes do `Started`)
      const m = montar()
      await esperar()
      act(() => m.d.canal.entregar('estudio', 'revogacao', { usuario: EU, remetente: MEMBRO }))
      await esperar()
      expect(screen.getByText(TEXTO_DO_DISPOSITIVO.revogado)).toBeTruthy()
      act(() => {
        window.dispatchEvent(new Event(`obs${saida}Starting`))
      })
      expect(m.r.container.textContent).toBe('')
      await esperar()
      expect(m.r.container.textContent).toBe('')
      // o `Stopped` de outra saída não libera
      act(() => {
        window.dispatchEvent(new Event(saida === 'Recording' ? 'obsStreamingStopped' : 'obsRecordingStopped'))
      })
      await esperar()
      expect(m.r.container.textContent).toBe('')
      // uma releitura periódica com o status "parado" ainda não libera (pode ser a janela antes do `Started`)
      await esperar(SITUACAO_A_CADA_MS)
      expect(m.r.container.textContent).toBe('')
      // a segunda libera (um início que falhou e nunca teve fim)
      await esperar(SITUACAO_A_CADA_MS)
      expect(screen.getByText(TEXTO_DO_DISPOSITIVO.revogado)).toBeTruthy()
    },
  )

  test('depois de um início que falhou e foi liberado, um Starting novo volta a esconder (I1, rodada 2)', async () => {
    instalarObs() // o getStatus diz "parado" o tempo todo
    const m = montar()
    await esperar()
    act(() => m.d.canal.entregar('estudio', 'revogacao', { usuario: EU, remetente: MEMBRO }))
    await esperar()
    // um início que falha (Starting sem Stopped): liberado depois de duas releituras com a saída parada
    act(() => {
      window.dispatchEvent(new Event('obsRecordingStarting'))
    })
    await esperar(SITUACAO_A_CADA_MS * 2)
    expect(screen.getByText(TEXTO_DO_DISPOSITIVO.revogado)).toBeTruthy()
    // um Starting novo, com o status ainda "parado": a contagem recomeça, e a tela fica vazia
    act(() => {
      window.dispatchEvent(new Event('obsStreamingStarting'))
    })
    await esperar()
    expect(m.r.container.textContent).toBe('')
    await esperar(SITUACAO_A_CADA_MS)
    expect(m.r.container.textContent).toBe('')
  })

  test('comando de quem não está na presença do `:controle` é descartado (I4)', async () => {
    instalarObs()
    const OUTRO_PALCO = 'b0000000-0000-4000-8000-0000000000b2'
    const m = montar()
    await esperar()
    presentesNoControle(m, [MEMBRO])
    comando(m, { acao: 'aviso', avisoId: AVISO }, OUTRO_PALCO, EP, { naPresenca: false })
    await esperar()
    expect(m.r.container.querySelector('.aviso-no-ar')).toBeNull()
    expect(m.d.chamadas.registros).toEqual([])
    comando(m, { acao: 'aviso', avisoId: AVISO }, MEMBRO, EP, { naPresenca: false })
    await esperar()
    expect(m.r.container.querySelector('.aviso-no-ar')).not.toBeNull()
  })

  test('aviso e som criados depois do início: o palco relê e executa (I2)', async () => {
    instalarObs()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const AVISO_NOVO = 'f0000000-0000-4000-8000-000000000002'
    const SOM_NOVO = '50000000-0000-4000-8000-000000000002'
    const m = montar()
    await esperar()
    const base = carga(EP, 'Ensaio geral')
    m.d.definirCarga({
      ...base,
      sons: [...base.sons, { ...base.sons[0], id: SOM_NOVO, rotulo: 'Risada', caminho: 'som/risada.mp3', volume: 0.5 }],
      avisos: [...base.avisos, { ...base.avisos[0], id: AVISO_NOVO, titulo: 'Aviso novo', texto: '' }],
    })
    comando(m, { acao: 'aviso', avisoId: AVISO_NOVO })
    await esperar()
    expect(screen.getByText('Aviso novo')).toBeTruthy()
    expect(ultimoEstado(m)?.ultimo).toMatchObject({ acao: 'aviso', resultado: 'ok' })
    comando(m, { acao: 'som', somId: SOM_NOVO })
    await esperar()
    expect(ultimoEstado(m)?.ultimo).toMatchObject({ acao: 'som', resultado: 'ok' })
    expect(play).toHaveBeenCalledTimes(1)
    expect((play.mock.contexts[0] as HTMLAudioElement).getAttribute('src')).toBe('https://armazenamento.revocast.test/assinada/som/risada.mp3?token=teste')
    // a releitura assinou só o arquivo novo
    expect(m.d.chamadas.urls.filter((u) => u === 'som/aplauso.mp3')).toHaveLength(1)
    expect(m.d.chamadas.urls.filter((u) => u === 'som/risada.mp3')).toHaveLength(1)
  })

  test('som com URL já assinada e o `<audio>` ainda sem ela: toca por um elemento avulso (I2)', async () => {
    instalarObs()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const m = montar()
    await esperar()
    // o React ainda não desenhou a URL (o caso do som recém-relido): simulado tirando o src do elemento
    const audio = m.r.container.querySelector('audio') as HTMLAudioElement
    audio.removeAttribute('src')
    comando(m, { acao: 'som', somId: SOM })
    await esperar()
    expect(ultimoEstado(m)?.ultimo).toMatchObject({ acao: 'som', resultado: 'ok' })
    expect(play).toHaveBeenCalledTimes(1)
    expect(play.mock.contexts[0]).not.toBe(audio)
    expect((play.mock.contexts[0] as HTMLAudioElement).getAttribute('src')).toBe('https://armazenamento.revocast.test/assinada/som/aplauso.mp3?token=teste')
  })

  test('aviso corrigido: quem entra no `:controle` faz o palco reler (I2)', async () => {
    instalarObs()
    const m = montar()
    await esperar()
    const carregar = vi.spyOn(m.d.servicos.palco, 'carregar')
    m.d.definirCarga(carga(EP, 'Ensaio geral', { titulo: 'Inscreva-se já' }))
    act(() => m.d.canal.entrarAlguem(m.controle()))
    await esperar()
    expect(carregar).toHaveBeenCalledTimes(1)
    comando(m, { acao: 'aviso', avisoId: AVISO })
    await esperar()
    expect(screen.getByText('Inscreva-se já')).toBeTruthy()
    expect(carregar).toHaveBeenCalledTimes(1) // o aviso já era conhecido: o comando não relê
    // o mesmo episódio de volta (episodio_ativo_mudou) também relê, passado o intervalo mínimo (Date.now adiantado)
    const agora = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(agora + RELEITURA_MINIMA_MS)
    act(() => m.d.canal.entregar('estudio', 'episodio_ativo_mudou', { remetente: MEMBRO }))
    await esperar()
    expect(carregar).toHaveBeenCalledTimes(2)
    expect(m.d.canal.abertos()).toEqual(['estudio', m.controle()])
  })

  test('cena atual do OBS no estado; troca à mão aparece (A1, D9)', async () => {
    const obs = instalarObs({ cena: 'Abertura' })
    const m = montar()
    await esperar()
    expect(ultimoEstado(m)?.cenaObs).toBe('Abertura')
    obs.mudarCena('Conversa')
    act(() => {
      window.dispatchEvent(new CustomEvent('obsSceneChanged', { detail: { name: 'Conversa' } }))
    })
    await esperar()
    expect(ultimoEstado(m)?.cenaObs).toBe('Conversa')
    // sem o evento, a releitura periódica também traz a cena
    obs.mudarCena('Abertura')
    await esperar(SITUACAO_A_CADA_MS)
    expect(ultimoEstado(m)?.cenaObs).toBe('Abertura')
    // cena com nome longo vai como null no canal, sem perder o resto do estado
    obs.mudarCena('L'.repeat(201))
    await esperar(SITUACAO_A_CADA_MS)
    expect(ultimoEstado(m)?.cenaObs).toBeNull()
    expect(ultimoEstado(m)?.episodioId).toBe(EP)
  })

  test('cena atual: abaixo de READ_USER o palco não pede getCurrentScene (A1)', async () => {
    const obs = instalarObs({ nivel: 1 })
    const m = montar()
    await esperar()
    act(() => {
      window.dispatchEvent(new CustomEvent('obsSceneChanged'))
    })
    await esperar(SITUACAO_A_CADA_MS)
    expect(obs.chamadas).not.toContain('getCurrentScene')
    expect(ultimoEstado(m)?.cenaObs).toBeNull()
  })
})

describe('/obs/palco sem piscar (N2)', () => {
  /**
   * Lê um arquivo do repositório pelo `node:fs` (o Vitest roda na raiz). O projeto não tem `@types/node`,
   * então o módulo é importado com o tipo mínimo usado; o CSS por `?raw` volta vazio (o Vitest não processa CSS).
   */
  async function lerArquivo(caminho: string): Promise<string> {
    const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync(c: string, codificacao: 'utf8'): string }
    const { process } = globalThis as unknown as { process: { cwd(): string } }
    return fs.readFileSync(`${process.cwd()}/${caminho}`, 'utf8')
  }

  /** Roda o script clássico do `<head>` num documento novo do jsdom, com `location.pathname` = `caminho`; devolve se é palco (classe e esquema claro, juntos). */
  function rodar(script: string, caminho: string): boolean {
    const doc = document.implementation.createHTMLDocument('palco')
    new Function('location', 'document', script)({ pathname: caminho }, doc)
    const classe = doc.documentElement.classList.contains('palco')
    const claro = doc.documentElement.style.colorScheme === 'light'
    expect(claro, `esquema claro em ${caminho}`).toBe(classe)
    return classe
  }

  test('palco-sem-piscar', async () => {
    const html = await lerArquivo('index.html')
    const css = await lerArquivo('src/shared/styles/base.css')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const head = [...doc.head.children]
    const classico = head.find((e) => e.tagName === 'SCRIPT' && !e.hasAttribute('src'))
    expect(classico).toBeDefined()
    expect(classico?.hasAttribute('type')).toBe(false) // clássico: roda na hora, sem esperar o módulo
    // antes da folha de estilos e do módulo: a primeira pintura já sai transparente na Fonte do OBS
    const folha = head.findIndex((e) => e.tagName === 'LINK' && e.getAttribute('rel') === 'stylesheet')
    expect(head.indexOf(classico as Element)).toBeLessThan(folha)
    const modulo = doc.querySelector('script[type="module"]') as Element
    expect((classico as Element).compareDocumentPosition(modulo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const script = (classico as Element).textContent ?? ''
    expect(rodar(script, '/obs/palco')).toBe(true)
    expect(rodar(script, '/obs/palco/')).toBe(true)
    expect(rodar(script, '/obs/palco//')).toBe(true) // como o resolverRota, que tira todas as barras finais
    expect(rodar(script, '/obs/palcox')).toBe(false)
    expect(rodar(script, '/obs/palco/x')).toBe(false)
    expect(rodar(script, '/camera')).toBe(false)

    expect(css).toMatch(/html\.palco,\s*html\.palco body\s*\{[^}]*background:\s*transparent/)
  })
})
