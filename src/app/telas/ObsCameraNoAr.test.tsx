// @vitest-environment jsdom
import { afterEach, beforeEach, describe, test, expect, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PRESENCA_MINIMA_MS, PRONTO_A_CADA_MS } from '../../domains/captura/sinais'
import type { EstadoDoVideo } from '../../domains/captura/sinais'
import { SELO_VISIVEL_MS, SITUACAO_A_CADA_MS } from '../../domains/obs/saida'
import { EVENTOS_DE_SAIDA, criarObsNoNavegador } from '../../shared/infra/obsNavegador'
import { lerArquivoDoRepositorio } from '../lerArquivoDoRepositorio'
import { criarFalsos, criarFalsosDeDispositivo } from '../servicosFalsos'
import { ObsCamera } from './ObsCamera'
import { TEXTO_DA_OBS_CAMERA } from './ObsCameraNoAr'
import { TEXTO_DO_DISPOSITIVO } from './TelaDeDispositivo'

const EP = 'e0000000-0000-4000-8000-000000000001'
const EU = 'b0000000-0000-4000-8000-0000000000bb'
/** A sessão da câmera pareada (o remetente que o banco põe nos sinais dela). */
const CAMERA = 'c0000000-0000-4000-8000-0000000000cc'
const MEMBRO = 'a0000000-0000-4000-8000-000000000001'
const DISPOSITIVO = 'd0000000-0000-4000-8000-0000000000dd'
const VIDEO = `video:${EU}`

let sequencia = 0
/** Sessão de vídeo nova (uuid minúsculo, como a câmera gera). */
const novaSessao = () => `90000000-0000-4000-8000-${String(++sequencia).padStart(12, '0')}`

type StatusDoObs = { recording: boolean; replaybuffer: boolean; streaming: boolean; virtualcam: boolean }
const PARADO: StatusDoObs = { recording: false, replaybuffer: false, streaming: false, virtualcam: false }

/** `window.obsstudio` falso (obs-browser), como no `PalcoNoAr.test.tsx`; a rota usa o adaptador real sobre ele. */
function instalarObs(o: { nivel?: number; status?: Partial<StatusDoObs> | null } = {}) {
  const obsstudio = {
    pluginVersion: '2.24.0',
    getControlLevel: (cb: (v: unknown) => void) => cb(o.nivel ?? 1),
    getStatus: (cb: (v: unknown) => void) => cb(o.status === null ? null : { ...PARADO, recordingPaused: false, ...o.status }),
  }
  Object.defineProperty(window, 'obsstudio', { value: obsstudio, configurable: true, writable: true })
  return {
    mudarStatus(s: Partial<StatusDoObs> | null) {
      o.status = s
    },
  }
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

type Falsos = ReturnType<typeof criarFalsosDeDispositivo>
type Episodio = { id: string; modo: 'ao_vivo' | 'teste' } | null

/** Esvazia as promessas e os `setTimeout(..., 0)` que o receptor agenda, e anda `ms` no relógio falso. */
async function esperar(ms = 0) {
  await act(async () => {
    for (let r = 0; r < 6; r++) {
      for (let i = 0; i < 20; i++) await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1)
    }
    if (ms > 0) await vi.advanceTimersByTimeAsync(ms)
    for (let r = 0; r < 6; r++) {
      for (let i = 0; i < 20; i++) await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1)
    }
  })
}

function montar(o: { episodio?: Episodio; pareado?: boolean; rotulo?: string; antes?: (d: Falsos) => void } = {}) {
  const episodio = o.episodio === undefined ? { id: EP, modo: 'teste' as const } : o.episodio
  const d =
    o.pareado === false
      ? criarFalsosDeDispositivo({ episodioAtivo: episodio })
      : criarFalsosDeDispositivo({
          sessao: { usuarioId: EU, anonima: true },
          dispositivo: { id: DISPOSITIVO, tipo: 'obs_camera', rotulo: o.rotulo ?? 'OBS do estúdio', cameraId: null },
          episodioAtivo: episodio,
        })
  o.antes?.(d)
  const dep = criarFalsos().dependencias({ obterDispositivo: () => d.servicos, fragmento: '' })
  const r = render(<ObsCamera titulo="Câmera do OBS" dependencias={dep} obs={criarObsNoNavegador()} />)
  return {
    d,
    r,
    video: () => r.container.querySelector('video'),
    tipos: () => d.canal.sinaisDeVideo().map((s) => s.p_tipo),
    /** Último estado do vídeo marcado na presença. */
    estadoNaPresenca: () => (d.canal.presencas('estudio').at(-1) as { video?: { estado: EstadoDoVideo } } | undefined)?.video?.estado,
  }
}
type Montado = ReturnType<typeof montar>

/** A câmera oferece (pelo tópico da própria sessão do `obs_camera`, com o remetente posto pelo "banco"). */
function oferecer(m: Montado, sessao = novaSessao(), remetente = CAMERA): string {
  act(() => m.d.canal.entregar(VIDEO, 'sinal', { tipo: 'oferta', sessao, sdp: m.d.video.sdpDaOferta, remetente }))
  return sessao
}

async function conectar(m: Montado) {
  await esperar()
  oferecer(m)
  await esperar()
}

function avisarEstudio(m: Montado, evento: string, payload: Record<string, unknown>) {
  act(() => m.d.canal.entregar('estudio', evento, { ...payload, remetente: MEMBRO }))
}

async function mudarEpisodio(m: Montado, ep: Episodio) {
  m.d.definirEpisodioAtivo(ep)
  avisarEstudio(m, 'episodio_ativo_mudou', {})
  await esperar()
}

function tecla(key: string) {
  act(() => {
    fireEvent.keyDown(window, { key })
  })
}

/** Duas falhas seguidas depois de responder (D6): `sem_conexao_direta`. */
async function falharDuasVezes(m: Montado) {
  for (let i = 0; i < 2; i++) {
    oferecer(m)
    await esperar()
    m.d.video.conexoesCriadas.at(-1)?.falhar()
    await esperar()
  }
}

describe('/obs/camera: só o vídeo na Fonte do OBS (PLA-005, D5, D8, D10)', () => {
  test.each<[EstadoDoVideo, (m: Montado) => Promise<void>, boolean]>([
    ['aguardando_par', async () => {}, false],
    ['conectando', async (m) => void oferecer(m), false],
    ['sem_conexao_direta', falharDuasVezes, false],
    ['conectado', async (m) => void oferecer(m), true],
  ])('obs-camera-so-o-video (%s)', async (estado, agir, comVideo) => {
    instalarObs() // saída parada: nem assim aparece texto sem a tecla
    const m = montar({ antes: (d) => (d.video.config.conectarSozinha = estado === 'conectado') })
    await esperar()
    await agir(m)
    await esperar()
    await esperar(PRESENCA_MINIMA_MS)
    expect(m.estadoNaPresenca()).toBe(estado)
    expect(m.r.container.textContent).toBe('')
    expect(m.video() !== null).toBe(comVideo)
    expect(m.r.container.querySelectorAll('video')).toHaveLength(comVideo ? 1 : 0)
    expect(m.r.container.querySelector('.selo-do-palco, .cartao, p, h1')).toBeNull()
  })

  test('video-com-srcobject', async () => {
    const m = montar()
    await conectar(m)
    const video = m.video()
    expect(video).not.toBeNull()
    expect(video?.muted).toBe(true)
    expect(video?.hasAttribute('autoplay')).toBe(true)
    expect(video?.hasAttribute('playsinline')).toBe(true)
    expect(video?.hasAttribute('controls')).toBe(false) // os controles do navegador iriam ao ar na Fonte
    expect(video?.srcObject).toBe(m.d.video.fluxoRecebido)
    expect(video?.hasAttribute('src')).toBe(false) // o fluxo vai por `srcObject`, nunca por URL
    expect(video?.getAttribute('src')).toBeNull()
    // a queda tira o vídeo da Fonte (D3: sem vídeo é conexão fora de `conectado`) e a volta o devolve
    m.d.video.conexoesCriadas[0].cair()
    await esperar()
    expect(m.video()).toBeNull()
    m.d.video.conexoesCriadas[0].conectar()
    await esperar()
    expect(m.video()?.srcObject).toBe(m.d.video.fluxoRecebido)
  })

  test('obs-camera-abre-o-topico-da-sua-sessao', async () => {
    const m = montar()
    await esperar()
    // os efeitos da tela pareada só rodam no fim do `act` do primeiro `esperar()`; o canal de vídeo, o `pronto` e a `rpc`
    // vêm na volta seguinte (falha também com o arquivo rodando sozinho, sem esta linha)
    await esperar()
    const topicosDeVideo = m.d.canal.realtime.criados.map((c) => c.topico).filter((t) => t.startsWith('video:'))
    expect(topicosDeVideo).toEqual([VIDEO])
    expect(m.d.canal.abertos()).toEqual(['estudio', VIDEO])
    expect(VIDEO).not.toContain(DISPOSITIVO)
    // o `pronto` sai pela função (nunca pelo Broadcast do tópico)
    expect(m.tipos()).toEqual(['pronto'])
    expect(m.d.canal.enviados(VIDEO)).toEqual([])
    await esperar(PRONTO_A_CADA_MS)
    expect(m.tipos()).toEqual(['pronto', 'pronto'])
    // conectado: o `pronto` para; a resposta vai com a sessão da oferta
    const sessao = oferecer(m)
    await esperar()
    expect(m.tipos()).toEqual(['pronto', 'pronto', 'resposta'])
    expect(m.d.canal.sinaisDeVideo().at(-1)).toMatchObject({ p_tipo: 'resposta', p_sessao: sessao, p_sdp: m.d.video.sdpDaResposta })
    await esperar(PRONTO_A_CADA_MS * 3)
    expect(m.tipos()).toHaveLength(3)
  })

  test('selo-por-tecla', async () => {
    instalarObs()
    const m = montar()
    await esperar()
    tecla('s')
    await esperar()
    expect(screen.getByText(TEXTO_DA_OBS_CAMERA.aguardando_par)).toBeTruthy()
    expect(screen.getByText('Câmera do OBS · aguardando a câmera')).toBeTruthy()
    expect(screen.getByText('Pareado como OBS do estúdio')).toBeTruthy()
    expect(m.video()).toBeNull()
    // `esperar` anda 12 ms a cada chamada (os `setTimeout(..., 0)` do receptor): a margem fica em 100 ms
    await esperar(SELO_VISIVEL_MS - 100)
    expect(screen.queryByText(TEXTO_DA_OBS_CAMERA.aguardando_par)).not.toBeNull()
    await esperar(100)
    expect(m.r.container.textContent).toBe('')
    // outra tecla, com modificador ou repetida, não abre
    tecla('x')
    act(() => {
      fireEvent.keyDown(window, { key: 's', ctrlKey: true })
      fireEvent.keyDown(window, { key: 's', repeat: true })
    })
    await esperar()
    expect(m.r.container.textContent).toBe('')
  })

  test('selo-literal: o rótulo vai como texto, nunca como HTML', async () => {
    instalarObs()
    const rotulo = '<img src=x onerror=alert(1)> OBS'
    const m = montar({ rotulo })
    await esperar()
    tecla('s')
    await esperar()
    expect(screen.getByText(`Pareado como ${rotulo}`)).toBeTruthy()
    expect(m.r.container.querySelector('img')).toBeNull()
  })

  test('selo-por-tecla: sem conexão direta e com o vídeo na Fonte', async () => {
    instalarObs()
    const m = montar({ antes: (d) => (d.video.config.conectarSozinha = false) })
    await esperar()
    await falharDuasVezes(m)
    tecla('s')
    await esperar()
    expect(screen.getByText('Câmera do OBS · sem conexão direta')).toBeTruthy()
    await esperar(SELO_VISIVEL_MS)
    // conectado: o selo aparece junto do vídeo e some sozinho, o vídeo fica
    m.d.video.config.conectarSozinha = true
    oferecer(m)
    await esperar()
    tecla('s')
    await esperar()
    expect(screen.getByText(TEXTO_DA_OBS_CAMERA.conectado)).toBeTruthy()
    expect(m.video()).not.toBeNull()
    await esperar(SELO_VISIVEL_MS)
    expect(m.r.container.textContent).toBe('')
    expect(m.video()).not.toBeNull()
  })

  test.each([
    ['transmitindo', { status: { streaming: true } }],
    ['gravando', { status: { recording: true } }],
    ['Replay Buffer', { status: { replaybuffer: true } }],
    ['câmera virtual', { status: { virtualcam: true } }],
    ['status null', { status: null }],
    ['nível 0', { nivel: 0, status: {} }],
  ])('selo-recusado-no-ar (%s)', async (_nome, obs) => {
    instalarObs(obs)
    const m = montar()
    await esperar()
    tecla('s')
    await esperar(4000) // o adaptador desiste em 3 s se o OBS não responde
    expect(m.r.container.textContent).toBe('')
    await esperar(SELO_VISIVEL_MS)
    expect(m.r.container.textContent).toBe('')
  })

  test('selo-recusado-no-ar: sem window.obsstudio também não abre', async () => {
    const m = montar()
    await esperar()
    tecla('s')
    await esperar(4000)
    expect(m.r.container.textContent).toBe('')
  })

  test('selo-recusado-no-ar: obsStreamingStarting com o selo aberto fecha na hora, e a tecla fica recusada até o Stopped', async () => {
    instalarObs() // o getStatus continua "parado" (como no obs-browser antes do `Started`)
    const m = montar()
    await esperar()
    tecla('s')
    await esperar()
    expect(screen.getByText(TEXTO_DA_OBS_CAMERA.aguardando_par)).toBeTruthy()
    act(() => {
      window.dispatchEvent(new Event('obsStreamingStarting'))
    })
    // na hora: sem esperar promessa nem relógio
    expect(m.r.container.textContent).toBe('')
    tecla('s')
    await esperar()
    expect(m.r.container.textContent).toBe('')
    act(() => {
      window.dispatchEvent(new Event('obsStreamingStopped'))
    })
    tecla('s')
    await esperar()
    expect(screen.getByText(TEXTO_DA_OBS_CAMERA.aguardando_par)).toBeTruthy()
  })

  test('selo-recusado-no-ar: Starting sem Stopped libera o selo depois de duas releituras com a saída parada (VER-046)', async () => {
    instalarObs() // o getStatus continua "parado": um início que falhou e nunca teve fim
    const m = montar()
    await esperar()
    act(() => {
      window.dispatchEvent(new Event('obsRecordingStarting'))
    })
    tecla('s')
    await esperar()
    expect(m.r.container.textContent).toBe('')
    // uma releitura periódica com a saída parada ainda não libera
    await esperar(SITUACAO_A_CADA_MS)
    tecla('s')
    await esperar()
    expect(m.r.container.textContent).toBe('')
    // a segunda libera
    await esperar(SITUACAO_A_CADA_MS)
    tecla('s')
    await esperar()
    expect(screen.getByText(TEXTO_DA_OBS_CAMERA.aguardando_par)).toBeTruthy()
  })

  test('selo-recusado-no-ar: a releitura periódica fecha o selo se um evento faltar', async () => {
    const obs = instalarObs()
    const m = montar()
    await esperar()
    // o selo abre 2 s antes da releitura periódica (a cada 15 s desde a montagem); venceria sozinho 3 s depois dela
    await esperar(SITUACAO_A_CADA_MS - 2000)
    tecla('s')
    await esperar()
    expect(screen.getByText(TEXTO_DA_OBS_CAMERA.aguardando_par)).toBeTruthy()
    // a transmissão começou sem o evento chegar: a releitura acha a saída no ar e fecha o selo antes do prazo dele
    obs.mudarStatus({ streaming: true })
    await esperar(2500)
    expect(m.r.container.textContent).toBe('')
  })

  test.each([
    ['sem window.obsstudio', null, true],
    ['saída parada', {}, true],
    ['transmitindo', { status: { streaming: true } }, false],
    ['status desconhecido', { status: null }, false],
    ['nível 0', { nivel: 0, status: {} }, false],
  ] as const)('telas-de-erro-so-com-saida-parada: sem pareamento (%s)', async (_nome, obs, mostra) => {
    if (obs !== null) instalarObs(obs)
    const m = montar({ pareado: false })
    await esperar(4000)
    if (mostra) expect(screen.getByText(TEXTO_DO_DISPOSITIVO.sem_link)).toBeTruthy()
    else expect(m.r.container.textContent).toBe('')
    expect(m.d.chamadas.ordem).not.toContain('entrarAnonimo')
  })

  test('telas-de-erro-so-com-saida-parada: o cartão some no Starting e volta no Stopped', async () => {
    instalarObs()
    const m = montar({ pareado: false })
    await esperar()
    expect(screen.getByText(TEXTO_DO_DISPOSITIVO.sem_link)).toBeTruthy()
    act(() => {
      window.dispatchEvent(new Event('obsRecordingStarting'))
    })
    expect(m.r.container.textContent).toBe('')
    act(() => {
      window.dispatchEvent(new Event('obsRecordingStopped'))
    })
    await esperar()
    expect(screen.getByText(TEXTO_DO_DISPOSITIVO.sem_link)).toBeTruthy()
  })

  test('revogacao-da-camera-corta-o-video', async () => {
    instalarObs()
    const m = montar()
    await conectar(m)
    expect(m.video()).not.toBeNull()
    avisarEstudio(m, 'revogacao', { usuario: CAMERA })
    await esperar()
    expect(m.video()).toBeNull()
    expect(m.d.video.conexoesCriadas[0].fechada()).toBe(true)
    // a oferta seguinte do remetente revogado é ignorada (15 min)
    oferecer(m)
    await esperar()
    expect(m.d.video.conexoesCriadas).toHaveLength(1)
    expect(m.video()).toBeNull()
    expect(m.tipos().filter((t) => t === 'resposta')).toHaveLength(1)
    // a rota segue pareada, sem nada na Fonte
    expect(m.r.container.textContent).toBe('')
    expect(m.d.chamadas.sair).toBe(0)
    expect(m.d.canal.abertos()).toEqual(['estudio', VIDEO])
  })

  test.each([
    ['saída parada', {}, true],
    ['transmitindo', { streaming: true }, false],
  ] as const)('revogado-na-hora (%s)', async (_nome, status, mostra) => {
    instalarObs({ status })
    // a conexão fecha na própria revogação, antes da troca de tela (não só na desmontagem que vem depois)
    const comATelaPareada: boolean[] = []
    const m = montar({
      antes: (d) => {
        const criar = d.video.conexoes.criar
        d.video.conexoes.criar = () => {
          const c = criar()
          const fechar = c.fechar.bind(c)
          c.fechar = () => {
            comATelaPareada.push(document.querySelector('.obs-camera-no-ar') !== null)
            fechar()
          }
          return c
        }
      },
    })
    await conectar(m)
    expect(m.video()).not.toBeNull()
    const antes = m.tipos().length
    avisarEstudio(m, 'revogacao', { usuario: EU })
    await esperar()
    expect(m.d.video.conexoesCriadas[0].fechada()).toBe(true)
    expect(m.d.canal.abertos()).toEqual([])
    expect(m.d.chamadas.sair).toBe(1)
    expect(m.video()).toBeNull()
    expect(comATelaPareada).toEqual([true])
    // a sessão revogada não chama mais a função (nem o `encerrar`, que o banco recusaria)
    expect(m.tipos()).toHaveLength(antes)
    if (mostra) expect(screen.getByText(TEXTO_DO_DISPOSITIVO.revogado)).toBeTruthy()
    else expect(m.r.container.textContent).toBe('')
    await esperar(15_000)
    if (!mostra) expect(m.r.container.textContent).toBe('')
  })

  test('sem-episodio-limpa', async () => {
    const m = montar()
    await conectar(m)
    expect(m.video()).not.toBeNull()
    await mudarEpisodio(m, null)
    expect(m.video()).toBeNull()
    expect(m.d.video.conexoesCriadas[0].fechada()).toBe(true)
    expect(m.d.canal.abertos()).toEqual(['estudio'])
    const antes = m.tipos().length
    await esperar(PRONTO_A_CADA_MS * 3)
    expect(m.tipos()).toHaveLength(antes) // sem `pronto` sem episódio
    await esperar(PRESENCA_MINIMA_MS)
    expect(m.estadoNaPresenca()).toBe('aguardando_episodio')
    // `negado` do canal de vídeo sem episódio não reavalia o dispositivo
    await mudarEpisodio(m, { id: EP, modo: 'teste' })
    expect(m.d.canal.abertos()).toEqual(['estudio', VIDEO])
    const avaliacoes = m.d.chamadas.ordem.filter((x) => x === 'dispositivoAtual').length
    m.d.definirEpisodioAtivo(null)
    act(() => m.d.canal.definirEstado(VIDEO, 'negado'))
    await esperar(60_000)
    expect(m.d.chamadas.ordem.filter((x) => x === 'dispositivoAtual')).toHaveLength(avaliacoes)
    expect(m.d.canal.abertos()).toEqual(['estudio'])
  })

  test('presenca-obs-camera', async () => {
    const m = montar()
    await esperar()
    const presenca = (estado: EstadoDoVideo) => ({ tipo: 'obs_camera', dispositivoId: DISPOSITIVO, obs: null, video: { estado, telaLigada: null, bateria: null } })
    expect(m.d.canal.presencas('estudio')).toEqual([presenca('aguardando_episodio')])
    await esperar(PRESENCA_MINIMA_MS)
    expect(m.d.canal.presencas('estudio')).toEqual([presenca('aguardando_episodio'), presenca('aguardando_par')])
    oferecer(m)
    await esperar()
    await esperar(PRESENCA_MINIMA_MS)
    expect(m.d.canal.presencas('estudio').at(-1)).toEqual(presenca('conectado'))
    expect(m.d.canal.presencas('estudio')).toHaveLength(3)
  })

  test('sem-webrtc-no-obs-camera (pendência do VER-052): situação na presença e no selo; nenhum canal de vídeo', async () => {
    instalarObs()
    const m = montar({ antes: (d) => (d.video.config.videoDireto = false) })
    await esperar()
    expect(m.estadoNaPresenca()).toBe('sem_video_direto')
    expect(m.d.canal.abertos()).toEqual(['estudio'])
    expect(m.tipos()).toEqual([])
    expect(m.r.container.textContent).toBe('')
    tecla('s')
    await esperar()
    expect(screen.getByText(TEXTO_DA_OBS_CAMERA.sem_video_direto)).toBeTruthy()
  })

  test('obs-camera-desmonta-limpo', async () => {
    const adicionados = vi.spyOn(window, 'addEventListener')
    const removidos = vi.spyOn(window, 'removeEventListener')
    const m = montar()
    await conectar(m)
    m.r.unmount()
    await esperar()
    expect(m.d.video.conexoesCriadas[0].fechada()).toBe(true)
    expect(m.d.canal.abertos()).toEqual([])
    expect(m.tipos().at(-1)).toBe('encerrar') // o `encerrar` sai pelo canal ainda ligado
    expect(vi.getTimerCount()).toBe(0)
    // os ouvintes da tecla e dos eventos de saída do obs-browser saem com a tela
    const vigiados = new Set<string>(['keydown', ...EVENTOS_DE_SAIDA])
    const pares = (c: unknown[][]) => c.filter(([tipo]) => vigiados.has(String(tipo))).map(([tipo, f]) => [tipo, f])
    const postos = pares(adicionados.mock.calls)
    // a tecla é da `ObsCameraNoAr`; os de saída, dela e da `SoComSaidaParada` de antes do pareamento (11 cada)
    expect(postos.filter(([tipo]) => tipo === 'keydown')).toHaveLength(1)
    expect(postos.filter(([tipo]) => tipo !== 'keydown').length).toBeGreaterThanOrEqual(EVENTOS_DE_SAIDA.length)
    const tirados = pares(removidos.mock.calls)
    for (const [tipo, f] of postos) expect(tirados.some(([t, g]) => t === tipo && g === f), String(tipo)).toBe(true)
  })

  test('sdp-nunca-no-console', async () => {
    const consoles = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((n) => vi.spyOn(console, n).mockImplementation(() => {}))
    const m = montar({ antes: (d) => (d.video.config.conectarSozinha = false) })
    await esperar()
    await falharDuasVezes(m)
    oferecer(m)
    await esperar()
    m.d.video.conexoesCriadas.at(-1)?.conectar()
    await esperar()
    tecla('s')
    await esperar()
    await mudarEpisodio(m, null)
    m.r.unmount()
    await esperar()
    expect(m.tipos()).toContain('resposta')
    const tudo = JSON.stringify(consoles.map((c) => c.mock.calls))
    expect(tudo).not.toContain(m.d.video.sdpDaOferta)
    expect(tudo).not.toContain(m.d.video.sdpDaResposta)
    expect(tudo).not.toContain('v=0')
    expect(localStorage.length + sessionStorage.length).toBe(0)
    expect(JSON.stringify(m.d.canal.presencas('estudio'))).not.toContain('v=0')
  })
})

describe('/obs/camera sem piscar (D8; revisão 1, I5)', () => {
  /** Roda o script clássico do `<head>` num documento novo do jsdom, com `location.pathname` = `caminho`. */
  function rodar(script: string, caminho: string) {
    const doc = document.implementation.createHTMLDocument('fonte')
    new Function('location', 'document', script)({ pathname: caminho }, doc)
    const html = doc.documentElement
    return { obsCamera: html.classList.contains('obs-camera'), palco: html.classList.contains('palco'), esquema: html.style.colorScheme }
  }

  test('obs-camera-sem-piscar', async () => {
    const html = await lerArquivoDoRepositorio('index.html')
    const css = await lerArquivoDoRepositorio('src/shared/styles/base.css')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const head = [...doc.head.children]
    const classicos = head.filter((e) => e.tagName === 'SCRIPT' && !e.hasAttribute('src'))
    expect(classicos).toHaveLength(1) // o mesmo script do palco, sem um segundo depois da folha
    const classico = classicos[0]
    expect(classico.hasAttribute('type')).toBe(false)
    const folha = head.findIndex((e) => e.tagName === 'LINK' && e.getAttribute('rel') === 'stylesheet')
    expect(head.indexOf(classico)).toBeLessThan(folha)
    const script = classico.textContent ?? ''

    for (const caminho of ['/obs/camera', '/obs/camera/', '/obs/camera//']) {
      expect(rodar(script, caminho), caminho).toEqual({ obsCamera: true, palco: false, esquema: 'light' })
    }
    for (const caminho of ['/obs/camerax', '/obs/camera/x', '/camera', '/obs']) {
      expect(rodar(script, caminho), caminho).toEqual({ obsCamera: false, palco: false, esquema: '' })
    }
    // o palco continua com a classe dele, e só ele
    expect(rodar(script, '/obs/palco')).toEqual({ obsCamera: false, palco: true, esquema: 'light' })

    expect(css).toMatch(/html\.obs-camera,\s*html\.obs-camera body\s*\{[^}]*background:\s*transparent/)
    expect(css).toMatch(/html\.obs-camera\s*\{[^}]*color-scheme:\s*light/)
    // o vídeo ocupa a Fonte sem cortar (object-fit: contain) e sem fundo próprio
    expect(css).toMatch(/\.video-da-obs-camera\s*\{[^}]*object-fit:\s*contain/)
    expect(css).toMatch(/\.video-da-obs-camera\s*\{[^}]*background:\s*transparent/)
  })
})
