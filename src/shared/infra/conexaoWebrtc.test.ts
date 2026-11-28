import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { FaixaDeVideo, FluxoDeVideo } from '../../domains/captura/portas'
import { ESPERA_DO_ICE_MS } from '../../domains/captura/sinais'
import { BITRATE_MAXIMO, STUN_PUBLICO, criarFabricaDeConexoes, servidoresIce, urlDeTurnValida } from './conexaoWebrtc'

/*
 * `RTCPeerConnection` falso (jsdom e Node não têm WebRTC): registra cada chamada e emite os eventos que mudam o
 * comportamento do adaptador (`icegatheringstatechange`, `connectionstatechange`, `track`). SDPs montados aqui, com IP da
 * faixa de documentação (RFC 5737); credencial TURN só como texto fixo de teste.
 */

const SDP_SEM_CANDIDATOS = 'v=0\r\no=- 1 2 IN IP4 192.0.2.10\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n'
const CANDIDATO = 'a=candidate:1 1 udp 2122260223 192.0.2.10 54321 typ host\r\n'
const SDP_COM_CANDIDATOS = `${SDP_SEM_CANDIDATOS}${CANDIDATO}`
const SDP_DA_OFERTA_REMOTA = 'v=0\r\no=- 5 6 IN IP4 192.0.2.20\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\n'
const SDP_DA_RESPOSTA_REMOTA = 'v=0\r\no=- 7 8 IN IP4 192.0.2.30\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=recvonly\r\n'
const TURN = { url: 'turn:turn.revocast.test:3478', usuario: 'usuario-de-teste', senha: 'senha-de-teste' }

class PcFalso extends EventTarget {
  readonly config: RTCConfiguration
  readonly chamadas: string[] = []
  readonly transceptores: { faixa: unknown; init: unknown }[] = []
  readonly remotas: { type?: string; sdp?: string }[] = []
  connectionState: RTCPeerConnectionState = 'new'
  iceGatheringState: RTCIceGatheringState = 'new'
  localDescription: { type: string; sdp: string } | null = null
  falharEm: string | null = null
  readonly sender = {
    replaceTrack: vi.fn(async (_t: unknown) => {}),
    getParameters: vi.fn(() => ({ encodings: [{}] as { maxBitrate?: number }[] })),
    setParameters: vi.fn(async (_p: unknown) => {}),
  }

  constructor(config: RTCConfiguration) {
    super()
    this.config = config
  }

  private conferirFalha(metodo: string): void {
    // erro do navegador com o SDP na mensagem (o Chromium cita trechos da descrição): o adaptador não pode repassá-lo
    if (this.falharEm === metodo) throw new DOMException(`Failed to execute ${metodo}: ${SDP_DA_OFERTA_REMOTA}`, 'InvalidAccessError')
  }

  addTransceiver(faixa: unknown, init: unknown) {
    this.chamadas.push('addTransceiver')
    if (this.falharEm === 'addTransceiver') throw new DOMException(`Failed to execute addTransceiver: ${SDP_DA_OFERTA_REMOTA}`, 'InvalidStateError')
    this.transceptores.push({ faixa, init })
    return { sender: this.sender }
  }
  addTrack() {
    this.chamadas.push('addTrack')
  }
  async createOffer() {
    this.chamadas.push('createOffer')
    this.conferirFalha('createOffer')
    return { type: 'offer', sdp: SDP_SEM_CANDIDATOS }
  }
  async createAnswer() {
    this.chamadas.push('createAnswer')
    this.conferirFalha('createAnswer')
    return { type: 'answer', sdp: SDP_SEM_CANDIDATOS }
  }
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.chamadas.push('setLocalDescription')
    this.conferirFalha('setLocalDescription')
    this.localDescription = { type: d.type, sdp: d.sdp }
    this.iceGatheringState = 'gathering'
    this.dispatchEvent(new Event('icegatheringstatechange'))
  }
  async setRemoteDescription(d: { type?: string; sdp?: string }) {
    this.chamadas.push(`setRemoteDescription:${d.type}`)
    this.conferirFalha('setRemoteDescription')
    this.remotas.push({ type: d.type, sdp: d.sdp })
  }
  close() {
    this.chamadas.push('close')
    this.connectionState = 'closed'
  }

  completarIce(): void {
    if (this.localDescription !== null) this.localDescription = { ...this.localDescription, sdp: SDP_COM_CANDIDATOS }
    this.iceGatheringState = 'complete'
    this.dispatchEvent(new Event('icegatheringstatechange'))
  }
  mudarEstado(s: RTCPeerConnectionState): void {
    this.connectionState = s
    this.dispatchEvent(new Event('connectionstatechange'))
  }
  emitirTrack(track: unknown, streams: unknown[]): void {
    const ev = new Event('track')
    Object.assign(ev, { track, streams })
    this.dispatchEvent(ev)
  }
}

function montar(ice: RTCIceServer[] = servidoresIce({})) {
  const pcs: PcFalso[] = []
  const fabrica = criarFabricaDeConexoes({
    ice,
    criarPc: (c) => {
      const pc = new PcFalso(c)
      pcs.push(pc)
      return pc as unknown as RTCPeerConnection
    },
  })
  return { fabrica, pcs, pc: () => pcs.at(-1)! }
}

const faixa = { kind: 'video', id: 'faixa-de-teste' }
const comoFaixa = (f: unknown) => f as FaixaDeVideo

/** Deixa as promessas já resolvidas andarem (sem avançar o relógio). */
async function esvaziar(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

/** Acompanha uma promessa sem `await`: `valor()` é `undefined` até ela resolver. */
function acompanhar<T>(p: Promise<T>) {
  let v: T | undefined
  let erro: unknown
  p.then(
    (x) => {
      v = x
    },
    (e: unknown) => {
      erro = e
    },
  )
  return { valor: () => v, erro: () => erro }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('servidoresIce', () => {
  test('servidores-ice', () => {
    expect(STUN_PUBLICO).toBe('stun:stun.l.google.com:19302')
    expect(servidoresIce({})).toEqual([{ urls: STUN_PUBLICO }])
    expect(servidoresIce({ turn: TURN })).toEqual([
      { urls: STUN_PUBLICO },
      { urls: TURN.url, username: 'usuario-de-teste', credential: 'senha-de-teste' },
    ])
    expect(servidoresIce({ turn: { ...TURN, url: 'turns:turn.revocast.test:5349' } })[1]).toEqual({
      urls: 'turns:turn.revocast.test:5349',
      username: 'usuario-de-teste',
      credential: 'senha-de-teste',
    })
    // outra forma de URL, ou uma das três partes vazia: ignorado (só o STUN)
    for (const url of ['https://turn.revocast.test', 'stun:turn.revocast.test', 'TURN:turn.revocast.test', ' turn:turn.revocast.test', 'turnx:turn.revocast.test']) {
      expect(servidoresIce({ turn: { ...TURN, url } })).toEqual([{ urls: STUN_PUBLICO }])
    }
    expect(servidoresIce({ turn: { ...TURN, usuario: '' } })).toEqual([{ urls: STUN_PUBLICO }])
    expect(servidoresIce({ turn: { ...TURN, senha: '' } })).toEqual([{ urls: STUN_PUBLICO }])
  })

  test('turn-url-malformada', () => {
    // VER-051, rodada 1 (I2): forma estrita da RFC 7065; fora dela, só o STUN (o construtor do RTCPeerConnection lançaria)
    for (const url of [
      'turn:turn.revocast.test:3478',
      'turns:turn.revocast.test:5349?transport=tcp',
      'turn:turn.revocast.test?transport=udp',
      'turn:192.0.2.5',
      'turn:[2001:db8::1]:3478',
      'turn:turn.revocast.test:65535',
    ]) {
      expect([url, urlDeTurnValida(url)]).toEqual([url, true])
      expect(servidoresIce({ turn: { ...TURN, url } })).toHaveLength(2)
    }
    for (const url of [
      'turn:host com espaco',
      'turn:',
      'turn:turn.revocast.test:',
      'turn:turn.revocast.test:0',
      'turn:turn.revocast.test:70000',
      'turn://turn.revocast.test',
      'turn:turn.revocast.test/caminho',
      'turn:turn.revocast.test?transport=sctp',
      'turn:turn.revocast.test?outro=1',
      'turn:-turn.revocast.test',
      `turn:usuario${'@'}turn.revocast.test`, // usuário no host (montado em partes: não é e-mail)
      'turn:turn.revocast.test\n',
      'turn:turn..revocast.test',
    ]) {
      expect([url, urlDeTurnValida(url)]).toEqual([url, false])
      expect(servidoresIce({ turn: { ...TURN, url } })).toEqual([{ urls: STUN_PUBLICO }])
    }
  })

  test('construtor-que-lanca', async () => {
    // o construtor recusa os servidores (com o TURN): tenta de novo só com o STUN
    const configuracoes: RTCConfiguration[] = []
    let recusas = 1
    const fabrica = criarFabricaDeConexoes({
      ice: servidoresIce({ turn: TURN }),
      criarPc: (c) => {
        configuracoes.push(c)
        if (recusas > 0) {
          recusas -= 1
          throw new DOMException('turn:turn.revocast.test:3478 usuario-de-teste', 'SyntaxError')
        }
        return new PcFalso(c) as unknown as RTCPeerConnection
      },
    })
    expect(() => fabrica.criar()).not.toThrow()
    expect(configuracoes.map((c) => c.iceServers)).toEqual([servidoresIce({ turn: TURN }), [{ urls: STUN_PUBLICO }]])

    // recusa sempre: criar() não lança; a conexão rejeita com frase fixa (o domínio trata como falha), sem nada no console
    const espioes = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((n) => vi.spyOn(console, n).mockImplementation(() => {}))
    const sempre = criarFabricaDeConexoes({
      ice: servidoresIce({ turn: TURN }),
      criarPc: () => {
        throw new DOMException('turn:turn.revocast.test:3478 usuario-de-teste', 'SyntaxError')
      },
    })
    const c = sempre.criar()
    const erros: unknown[] = []
    await c.oferecer(comoFaixa(faixa)).catch((e: unknown) => erros.push(e))
    await c.responder(SDP_DA_OFERTA_REMOTA).catch((e: unknown) => erros.push(e))
    await c.aceitarResposta(SDP_DA_RESPOSTA_REMOTA).catch((e: unknown) => erros.push(e))
    expect(await c.trocarFaixa(comoFaixa(faixa))).toBe(false)
    expect(() => c.aoMudar(() => {})()).not.toThrow()
    expect(() => c.aoVideo(() => {})()).not.toThrow()
    expect(() => c.fechar()).not.toThrow()
    expect(erros).toHaveLength(3)
    for (const e of erros) {
      expect((e as Error).message).toBe('conexão de vídeo: falha em RTCPeerConnection')
      expect((e as Error).message).not.toContain('usuario-de-teste')
    }
    for (const espiao of espioes) expect(espiao).not.toHaveBeenCalled()
    // só STUN e o construtor recusa: sem segunda tentativa igual
    let chamadas = 0
    criarFabricaDeConexoes({
      ice: servidoresIce({}),
      criarPc: () => {
        chamadas += 1
        throw new Error('x')
      },
    }).criar()
    expect(chamadas).toBe(1)
  })

  test('configuracao-do-pc', () => {
    const ice = servidoresIce({ turn: TURN })
    const m = montar(ice)
    m.fabrica.criar()
    expect(m.pc().config).toEqual({ iceServers: ice, bundlePolicy: 'max-bundle' })
  })
})

describe('criarFabricaDeConexoes', () => {
  test('oferta-sendonly', async () => {
    const m = montar()
    const c = m.fabrica.criar()
    const sdp = acompanhar(c.oferecer(comoFaixa(faixa)))
    await esvaziar()
    m.pc().completarIce()
    await esvaziar()
    expect(sdp.valor()).toBe(SDP_COM_CANDIDATOS)
    expect(m.pc().transceptores).toEqual([{ faixa, init: { direction: 'sendonly' } }])
    expect(m.pc().chamadas).toEqual(['addTransceiver', 'createOffer', 'setLocalDescription'])
  })

  test('ice-nao-incremental', async () => {
    // com `complete` em 100 ms: devolve o SDP com os candidatos em 100 ms, nunca antes
    const m = montar()
    const c = m.fabrica.criar()
    const sdp = acompanhar(c.oferecer(comoFaixa(faixa)))
    await esvaziar()
    await vi.advanceTimersByTimeAsync(99)
    expect(sdp.valor()).toBeUndefined()
    m.pc().completarIce()
    await vi.advanceTimersByTimeAsync(1)
    expect(sdp.valor()).toBe(SDP_COM_CANDIDATOS)

    // sem `complete`: devolve o que tiver em ESPERA_DO_ICE_MS (3000), nunca antes
    expect(ESPERA_DO_ICE_MS).toBe(3000)
    const c2 = m.fabrica.criar()
    const sdp2 = acompanhar(c2.oferecer(comoFaixa(faixa)))
    await esvaziar()
    await vi.advanceTimersByTimeAsync(2999)
    expect(sdp2.valor()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(sdp2.valor()).toBe(SDP_SEM_CANDIDATOS)
    expect(vi.getTimerCount()).toBe(0) // nada pendurado depois da espera

    // coleta já completa antes de esperar: devolve na hora
    const c3 = m.fabrica.criar()
    const pc3 = m.pc()
    pc3.setLocalDescription = async (d: { type: string; sdp: string }) => {
      pc3.localDescription = { type: d.type, sdp: SDP_COM_CANDIDATOS }
      pc3.iceGatheringState = 'complete'
    }
    const sdp3 = acompanhar(c3.oferecer(comoFaixa(faixa)))
    await esvaziar()
    expect(sdp3.valor()).toBe(SDP_COM_CANDIDATOS)
    expect(vi.getTimerCount()).toBe(0) // o prazo do ICE é solto também quando a coleta já veio completa
  })

  test('resposta-recvonly', async () => {
    const m = montar()
    const c = m.fabrica.criar()
    const sdp = acompanhar(c.responder(SDP_DA_OFERTA_REMOTA))
    await esvaziar()
    m.pc().completarIce()
    await esvaziar()
    expect(sdp.valor()).toBe(SDP_COM_CANDIDATOS)
    expect(m.pc().remotas).toEqual([{ type: 'offer', sdp: SDP_DA_OFERTA_REMOTA }])
    expect(m.pc().chamadas).toEqual(['setRemoteDescription:offer', 'createAnswer', 'setLocalDescription'])
    expect(m.pc().chamadas).not.toContain('addTrack')
    expect(m.pc().chamadas).not.toContain('addTransceiver')
  })

  test('estados-da-conexao', async () => {
    const m = montar()
    const c = m.fabrica.criar()
    const estados: string[] = []
    c.aoMudar((e) => estados.push(e))
    const pc = m.pc()
    for (const s of ['new', 'connecting', 'connected', 'disconnected', 'connected', 'failed'] as const) pc.mudarEstado(s)
    await vi.advanceTimersByTimeAsync(0)
    expect(estados).toEqual(['conectando', 'conectando', 'conectado', 'caiu', 'conectado', 'falhou'])

    // `closed` sem pedido → falhou
    const c2 = m.fabrica.criar()
    const e2: string[] = []
    c2.aoMudar((e) => e2.push(e))
    m.pc().mudarEstado('closed')
    await vi.advanceTimersByTimeAsync(0)
    expect(e2).toEqual(['falhou'])

    // `closed` depois de `fechar()` → nenhum aviso; e nada que já estava agendado roda depois do fechar
    const c3 = m.fabrica.criar()
    const e3: string[] = []
    c3.aoMudar((e) => e3.push(e))
    const pc3 = m.pc()
    pc3.mudarEstado('connected') // agendado, ainda não entregue
    c3.fechar()
    const tardio = vi.fn()
    c3.aoMudar(tardio) // ouvinte que chega depois do fechar: o aviso agendado também não o alcança
    pc3.mudarEstado('closed')
    pc3.mudarEstado('failed')
    await vi.advanceTimersByTimeAsync(0)
    expect(e3).toEqual([])
    expect(tardio).not.toHaveBeenCalled()
    expect(pc3.chamadas).toEqual(['close'])
    c3.fechar() // idempotente
    expect(pc3.chamadas).toEqual(['close'])

    // o cancelamento devolvido por aoMudar solta o ouvinte
    const c4 = m.fabrica.criar()
    const e4: string[] = []
    const soltar = c4.aoMudar((e) => e4.push(e))
    soltar()
    m.pc().mudarEstado('connected')
    await vi.advanceTimersByTimeAsync(0)
    expect(e4).toEqual([])
  })

  test('fechar-durante-o-ice', async () => {
    // VER-051, rodada 1 (N3): fechar() durante a espera do ICE rejeita na hora (sem esperar 3 s) e solta o prazo
    const m = montar()
    const c = m.fabrica.criar()
    const sdp = acompanhar(c.oferecer(comoFaixa(faixa)))
    await esvaziar()
    c.fechar()
    await esvaziar()
    expect(sdp.valor()).toBeUndefined()
    expect((sdp.erro() as Error).message).toBe('conexão de vídeo: fechada durante a espera do ICE')
    expect(vi.getTimerCount()).toBe(0)
    const r = m.fabrica.criar()
    const sdpR = acompanhar(r.responder(SDP_DA_OFERTA_REMOTA))
    await esvaziar()
    r.fechar()
    await esvaziar()
    expect(sdpR.erro()).toBeInstanceOf(Error)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('aviso-adiado', async () => {
    const m = montar()
    const c = m.fabrica.criar()
    const estado = vi.fn()
    const video = vi.fn()
    c.aoMudar(estado)
    c.aoVideo(video)
    const fluxo = { id: 'fluxo-de-teste' }
    m.pc().mudarEstado('connected')
    m.pc().emitirTrack({ kind: 'video' }, [fluxo])
    // nada dentro do evento do navegador
    expect(estado).not.toHaveBeenCalled()
    expect(video).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(estado).toHaveBeenCalledWith('conectado')
    expect(video).toHaveBeenCalledTimes(1)
  })

  test('video-recebido', async () => {
    const m = montar()
    const c = m.fabrica.criar()
    const fluxos: FluxoDeVideo[] = []
    c.aoVideo((f) => fluxos.push(f))
    const fluxo = { id: 'fluxo-de-teste' }
    m.pc().emitirTrack({ kind: 'video' }, [fluxo])
    await vi.advanceTimersByTimeAsync(0)
    expect(fluxos).toEqual([fluxo])

    // `addTransceiver` sem `streams` do outro lado: o evento vem sem fluxo; o adaptador monta um com a faixa
    const montados: unknown[][] = []
    vi.stubGlobal(
      'MediaStream',
      class {
        readonly faixas: unknown[]
        constructor(faixas: unknown[]) {
          this.faixas = faixas
          montados.push(faixas)
        }
      },
    )
    const track = { kind: 'video', id: 'faixa-remota' }
    m.pc().emitirTrack(track, [])
    await vi.advanceTimersByTimeAsync(0)
    expect(montados).toEqual([[track]])
    expect((fluxos[1] as unknown as { faixas: unknown[] }).faixas).toEqual([track])

    // depois de fechar, nada
    c.fechar()
    m.pc().emitirTrack({ kind: 'video' }, [fluxo])
    await vi.advanceTimersByTimeAsync(0)
    expect(fluxos).toHaveLength(2)
  })

  test('trocar-faixa', async () => {
    const m = montar()
    const c = m.fabrica.criar()
    // sem oferta (sem sender): precisa de oferta nova
    expect(await c.trocarFaixa(comoFaixa(faixa))).toBe(false)
    const sdp = c.oferecer(comoFaixa(faixa))
    await esvaziar()
    m.pc().completarIce()
    await sdp
    const nova = { kind: 'video', id: 'faixa-nova' }
    expect(await c.trocarFaixa(comoFaixa(nova))).toBe(true)
    expect(m.pc().sender.replaceTrack).toHaveBeenCalledWith(nova)
    m.pc().sender.replaceTrack.mockRejectedValueOnce(new DOMException('x', 'InvalidModificationError'))
    expect(await c.trocarFaixa(comoFaixa(nova))).toBe(false)
  })

  test('bitrate-maximo', async () => {
    expect(BITRATE_MAXIMO).toBe(2_500_000)
    const m = montar()
    const c = m.fabrica.criar()
    const sdp = c.oferecer(comoFaixa(faixa))
    await esvaziar()
    m.pc().completarIce()
    await sdp
    expect(m.pc().sender.setParameters).not.toHaveBeenCalled() // só depois de aceitar a resposta
    await c.aceitarResposta(SDP_DA_RESPOSTA_REMOTA)
    expect(m.pc().remotas).toEqual([{ type: 'answer', sdp: SDP_DA_RESPOSTA_REMOTA }])
    expect(m.pc().sender.setParameters).toHaveBeenCalledTimes(1)
    expect(m.pc().sender.setParameters.mock.calls[0][0]).toEqual({ encodings: [{ maxBitrate: 2_500_000 }] })

    // setParameters rejeitado (ou getParameters que lança): a resposta continua aceita, sem erro
    const c2 = m.fabrica.criar()
    const sdp2 = c2.oferecer(comoFaixa(faixa))
    await esvaziar()
    m.pc().completarIce()
    await sdp2
    m.pc().sender.setParameters.mockRejectedValueOnce(new DOMException('x', 'InvalidModificationError'))
    await expect(c2.aceitarResposta(SDP_DA_RESPOSTA_REMOTA)).resolves.toBeUndefined()
    m.pc().sender.getParameters.mockImplementationOnce(() => {
      throw new Error('x')
    })
    await expect(c2.aceitarResposta(SDP_DA_RESPOSTA_REMOTA)).resolves.toBeUndefined()

    // sem encodings no getParameters: um encoding é criado com o teto
    const c3 = m.fabrica.criar()
    const sdp3 = c3.oferecer(comoFaixa(faixa))
    await esvaziar()
    m.pc().completarIce()
    await sdp3
    m.pc().sender.getParameters.mockReturnValueOnce({ encodings: [] })
    await c3.aceitarResposta(SDP_DA_RESPOSTA_REMOTA)
    expect(m.pc().sender.setParameters.mock.calls[0][0]).toEqual({ encodings: [{ maxBitrate: 2_500_000 }] })
    // navegador sem `encodings` nos parâmetros: também um encoding com o teto
    m.pc().sender.getParameters.mockReturnValueOnce({} as { encodings: { maxBitrate?: number }[] })
    await c3.aceitarResposta(SDP_DA_RESPOSTA_REMOTA)
    expect(m.pc().sender.setParameters.mock.calls[1][0]).toEqual({ encodings: [{ maxBitrate: 2_500_000 }] })
  })

  test('sdp-nunca-no-console', async () => {
    const espioes = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((n) => vi.spyOn(console, n).mockImplementation(() => {}))
    const m = montar()
    // caminho feliz dos dois lados
    const c = m.fabrica.criar()
    const sdp = c.oferecer(comoFaixa(faixa))
    await esvaziar()
    m.pc().completarIce()
    await sdp
    await c.aceitarResposta(SDP_DA_RESPOSTA_REMOTA)
    const r = m.fabrica.criar()
    const sdpR = r.responder(SDP_DA_OFERTA_REMOTA)
    await esvaziar()
    m.pc().completarIce()
    await sdpR
    // erros do navegador com o SDP na mensagem: o adaptador rejeita com mensagem fixa, sem o SDP
    const erros: unknown[] = []
    for (const metodo of ['setRemoteDescription', 'createAnswer', 'setLocalDescription']) {
      const x = m.fabrica.criar()
      m.pc().falharEm = metodo
      await x.responder(SDP_DA_OFERTA_REMOTA).catch((e: unknown) => erros.push(e))
    }
    for (const metodo of ['addTransceiver', 'createOffer', 'setLocalDescription']) {
      const x = m.fabrica.criar()
      m.pc().falharEm = metodo
      await x.oferecer(comoFaixa(faixa)).catch((e: unknown) => erros.push(e))
    }
    const y = m.fabrica.criar()
    m.pc().falharEm = 'setRemoteDescription'
    await y.aceitarResposta(SDP_DA_RESPOSTA_REMOTA).catch((e: unknown) => erros.push(e))
    // sem descrição local depois da espera: também mensagem fixa
    const z = m.fabrica.criar()
    m.pc().setLocalDescription = async () => {}
    const pz = z.oferecer(comoFaixa(faixa)).catch((e: unknown) => erros.push(e))
    await vi.advanceTimersByTimeAsync(3000)
    await pz
    expect(erros).toHaveLength(8)
    for (const e of erros) {
      expect(e).toBeInstanceOf(Error)
      const texto = `${(e as Error).message} ${(e as Error).stack ?? ''} ${String((e as Error).cause ?? '')}`
      for (const proibido of ['v=0', '192.0.2', 'candidate']) expect(texto).not.toContain(proibido)
    }
    for (const espiao of espioes) expect(espiao).not.toHaveBeenCalled()
  })

  test('turn-nunca-no-console', async () => {
    const espioes = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((n) => vi.spyOn(console, n).mockImplementation(() => {}))
    const ice = servidoresIce({ turn: TURN })
    servidoresIce({ turn: { ...TURN, url: 'https://turn.revocast.test' } })
    const m = montar(ice)
    const c = m.fabrica.criar()
    const sdp = c.oferecer(comoFaixa(faixa))
    await vi.advanceTimersByTimeAsync(3000)
    await sdp
    m.pc().mudarEstado('failed')
    await vi.advanceTimersByTimeAsync(0)
    c.fechar()
    for (const espiao of espioes) expect(espiao).not.toHaveBeenCalled()
  })
})
