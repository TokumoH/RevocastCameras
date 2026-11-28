import type { ConexaoDeVideo, EstadoDaConexao, FabricaDeConexoes, FaixaDeVideo, FluxoDeVideo } from '../../domains/captura/portas'
import { ESPERA_DO_ICE_MS } from '../../domains/captura/sinais'
import type { Configuracao } from './configuracao'

/*
 * A `ConexaoDeVideo` do DES-001 §6.1 sobre o `RTCPeerConnection` do navegador (PLA-005, D3, D4, D6, D7, D9): uma fabricação
 * pura que o domínio da Captura só conhece pela porta. O SDP, os candidatos e a credencial TURN nunca vão para `console`,
 * nem nas mensagens de erro: toda rejeição sai com uma frase fixa, sem a mensagem do navegador (que pode citar a descrição).
 */

/** STUN público e gratuito (DES-001 §10.3; D9). */
export const STUN_PUBLICO = 'stun:stun.l.google.com:19302'
/** Teto do envio de vídeo (D7: 720p30 a 2,5 Mbit/s; bateria e banda). */
export const BITRATE_MAXIMO = 2_500_000

/** Rótulo de nome de host: letras, dígitos e hífen no meio, até 63 caracteres. */
const ROTULO = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?'
/**
 * URL de TURN da RFC 7065, estrita (VER-051, rodada 1, I2): `turn:` ou `turns:` (minúsculas), host (nome, IPv4 ou IPv6 entre
 * colchetes), porta opcional e `?transport=udp|tcp` opcional; nada de espaço, `//`, caminho, usuário no host ou outro
 * parâmetro. A porta é conferida à parte (1 a 65535).
 */
const URL_DE_TURN = new RegExp(`^turns?:(?:\\[[0-9A-Fa-f:.]+\\]|${ROTULO}(?:\\.${ROTULO})*)(?::(\\d{1,5}))?(?:\\?transport=(?:udp|tcp))?$`)

/** A URL de TURN é aceita (forma da RFC 7065 e porta de 1 a 65535)? */
export function urlDeTurnValida(url: string): boolean {
  const m = URL_DE_TURN.exec(url)
  if (m === null) return false
  const porta = m[1]
  return porta === undefined || (Number(porta) >= 1 && Number(porta) <= 65535)
}

/**
 * Servidores ICE (D9): o STUN público sempre; o TURN da configuração só com URL válida (`urlDeTurnValida`) e as três partes
 * (`lerConfiguracao` já só monta `turn` com as três variáveis). Outra forma de URL é ignorada (só o STUN): nunca um
 * `https:`, um `stun:` com credencial ou uma URL que faria o construtor do `RTCPeerConnection` lançar.
 */
export function servidoresIce(config: Pick<Configuracao, 'turn'>): RTCIceServer[] {
  const servidores: RTCIceServer[] = [{ urls: STUN_PUBLICO }]
  const turn = config.turn
  if (turn !== undefined && urlDeTurnValida(turn.url) && turn.usuario !== '' && turn.senha !== '') {
    servidores.push({ urls: turn.url, username: turn.usuario, credential: turn.senha })
  }
  return servidores
}

type Agendar = (f: () => void, ms: number) => () => void

const agendarPadrao: Agendar = (f, ms) => {
  const t = setTimeout(f, ms)
  return () => clearTimeout(t)
}

/** `connectionState` → estado da porta (D6). `closed` a pedido não avisa nada (`null`). */
function traduzir(estado: RTCPeerConnectionState, fechadaAPedido: boolean): EstadoDaConexao | null {
  switch (estado) {
    case 'new':
    case 'connecting':
      return 'conectando'
    case 'connected':
      return 'conectado'
    case 'disconnected':
      return 'caiu'
    case 'failed':
      return 'falhou'
    case 'closed':
      return fechadaAPedido ? null : 'falhou'
    default:
      return null
  }
}

/** Rejeita com frase fixa, sem a mensagem do navegador (que pode trazer o SDP). */
async function semDetalhe<T>(passo: string, f: () => Promise<T>): Promise<T> {
  try {
    return await f()
  } catch {
    throw new Error(`conexão de vídeo: falha em ${passo}`)
  }
}

/** O fluxo do evento `track`; sem `streams` (o outro lado usou `addTransceiver` sem fluxo), um fluxo novo com a faixa. */
function fluxoDoEvento(ev: RTCTrackEvent): MediaStream | null {
  const fluxo = ev.streams[0]
  if (fluxo !== undefined) return fluxo
  return typeof MediaStream === 'function' ? new MediaStream([ev.track]) : null
}

/**
 * Fábrica das conexões (PLA-005, Tarefa 3). Cada `criar()` monta um `RTCPeerConnection` com
 * `{ iceServers, bundlePolicy: 'max-bundle' }`:
 * - **câmera** (`oferecer`): `addTransceiver(faixa, { direction: 'sendonly' })` (só vídeo, D3), `createOffer`,
 *   `setLocalDescription` e a espera do ICE; depois de `aceitarResposta`, `setParameters` com
 *   `encodings[0].maxBitrate = BITRATE_MAXIMO` (falha ignorada: o vídeo segue sem o teto);
 * - **obs_camera** (`responder`): `setRemoteDescription` da oferta e `createAnswer`; nada de `addTrack` (o transceptor vem
 *   `recvonly` pela oferta `sendonly`);
 * - **ICE não incremental (D4):** espera `icegatheringstatechange` até `complete` ou `ESPERA_DO_ICE_MS` e devolve o
 *   `localDescription.sdp` com os candidatos que tiver;
 * - **estados (D6):** `new`/`connecting` → `conectando`; `connected` → `conectado`; `disconnected` → `caiu`; `failed` e
 *   `closed` sem pedido → `falhou`. Cada aviso (estado e vídeo) é agendado com 0 ms, nunca dentro do evento do navegador;
 *   depois de `fechar()` nada mais é avisado, nem o que já estava agendado.
 */
export function criarFabricaDeConexoes(d: { ice: RTCIceServer[]; criarPc?: (c: RTCConfiguration) => RTCPeerConnection; agendar?: Agendar }): FabricaDeConexoes {
  const criarPc = d.criarPc ?? ((c: RTCConfiguration) => new RTCPeerConnection(c))
  const agendar = d.agendar ?? agendarPadrao

  /**
   * Constrói o `RTCPeerConnection` (VER-051, rodada 1, I2): se o construtor lançar (por exemplo, um servidor ICE que o
   * navegador recusa), tenta de novo só com os servidores STUN; se lançar de novo, `null`. Nada vai para `console`.
   */
  function construir(): RTCPeerConnection | null {
    try {
      return criarPc({ iceServers: d.ice, bundlePolicy: 'max-bundle' })
    } catch {
      /* tenta só com o STUN */
    }
    const soStun = d.ice.filter((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).every((u) => u.startsWith('stun:')))
    if (soStun.length === d.ice.length) return null
    try {
      return criarPc({ iceServers: soStun, bundlePolicy: 'max-bundle' })
    } catch {
      return null
    }
  }

  /** A conexão que não pôde ser construída: toda descrição rejeita com frase fixa; o domínio trata como falha. */
  function conexaoQueFalhou(): ConexaoDeVideo {
    const recusar = () => Promise.reject(new Error('conexão de vídeo: falha em RTCPeerConnection'))
    return {
      oferecer: recusar,
      aceitarResposta: recusar,
      responder: recusar,
      trocarFaixa: async () => false,
      aoMudar: () => () => {},
      aoVideo: () => () => {},
      fechar: () => {},
    }
  }

  function criar(): ConexaoDeVideo {
    const construido = construir()
    if (construido === null) return conexaoQueFalhou()
    const pc = construido
    const ouvintesDoEstado = new Set<(e: EstadoDaConexao) => void>()
    const ouvintesDoVideo = new Set<(f: FluxoDeVideo) => void>()
    let fechada = false
    let sender: RTCRtpSender | null = null
    /** Esperas do ICE em curso: `fechar()` as interrompe (VER-051, rodada 1, N3). */
    const esperas = new Set<() => void>()

    function avisar<T>(ouvintes: Set<(x: T) => void>, x: T): void {
      agendar(() => {
        if (fechada) return
        for (const f of [...ouvintes]) f(x)
      }, 0)
    }

    pc.addEventListener('connectionstatechange', () => {
      const e = traduzir(pc.connectionState, fechada)
      if (e !== null && !fechada) avisar(ouvintesDoEstado, e)
    })
    pc.addEventListener('track', (ev: RTCTrackEvent) => {
      if (fechada) return
      const fluxo = fluxoDoEvento(ev)
      if (fluxo !== null) avisar(ouvintesDoVideo, fluxo as unknown as FluxoDeVideo)
    })

    /**
     * Começa a esperar o fim da coleta (antes do `setLocalDescription`, para não perder o evento). `promessa` resolve no
     * `complete` ou em `ESPERA_DO_ICE_MS`; `parar()` solta o ouvinte e o prazo (e resolve).
     */
    function esperarIce(): { promessa: Promise<void>; parar(): void } {
      let parar: () => void = () => {}
      const promessa = new Promise<void>((resolver) => {
        let cancelar: () => void = () => {}
        const aoMudar = () => {
          if (pc.iceGatheringState === 'complete') parar()
        }
        parar = () => {
          pc.removeEventListener('icegatheringstatechange', aoMudar)
          cancelar()
          resolver()
        }
        pc.addEventListener('icegatheringstatechange', aoMudar)
        cancelar = agendar(parar, ESPERA_DO_ICE_MS)
      })
      const pararUmaVez = () => {
        esperas.delete(pararUmaVez)
        parar()
      }
      esperas.add(pararUmaVez)
      return { promessa, parar: pararUmaVez }
    }

    /** `setLocalDescription` e a espera do ICE; devolve o SDP local (com os candidatos coletados). */
    async function descreverLocal(descricao: RTCSessionDescriptionInit): Promise<string> {
      const ice = esperarIce()
      try {
        await semDetalhe('setLocalDescription', () => pc.setLocalDescription(descricao))
        if (pc.iceGatheringState !== 'complete') await ice.promessa
      } finally {
        ice.parar()
      }
      if (fechada) throw new Error('conexão de vídeo: fechada durante a espera do ICE')
      const sdp = pc.localDescription?.sdp
      if (typeof sdp !== 'string' || sdp === '') throw new Error('conexão de vídeo: sem descrição local')
      return sdp
    }

    async function limitarBitrate(): Promise<void> {
      if (sender === null) return
      try {
        const parametros = sender.getParameters()
        const encodings = Array.isArray(parametros.encodings) && parametros.encodings.length > 0 ? parametros.encodings : [{}]
        encodings[0] = { ...encodings[0], maxBitrate: BITRATE_MAXIMO }
        await sender.setParameters({ ...parametros, encodings })
      } catch {
        /* o vídeo segue sem o teto (navegador sem suporte ou parâmetros recusados) */
      }
    }

    return {
      async oferecer(faixa: FaixaDeVideo) {
        let transceptor: RTCRtpTransceiver
        try {
          transceptor = pc.addTransceiver(faixa as unknown as MediaStreamTrack, { direction: 'sendonly' })
        } catch {
          throw new Error('conexão de vídeo: falha em addTransceiver')
        }
        sender = transceptor.sender
        const oferta = await semDetalhe('createOffer', () => pc.createOffer())
        return descreverLocal(oferta)
      },
      async aceitarResposta(sdp: string) {
        await semDetalhe('setRemoteDescription', () => pc.setRemoteDescription({ type: 'answer', sdp }))
        await limitarBitrate()
      },
      async responder(oferta: string) {
        await semDetalhe('setRemoteDescription', () => pc.setRemoteDescription({ type: 'offer', sdp: oferta }))
        const resposta = await semDetalhe('createAnswer', () => pc.createAnswer())
        return descreverLocal(resposta)
      },
      async trocarFaixa(faixa: FaixaDeVideo) {
        if (sender === null) return false
        try {
          await sender.replaceTrack(faixa as unknown as MediaStreamTrack)
          return true
        } catch {
          return false
        }
      },
      aoMudar(f) {
        ouvintesDoEstado.add(f)
        return () => {
          ouvintesDoEstado.delete(f)
        }
      },
      aoVideo(f) {
        ouvintesDoVideo.add(f)
        return () => {
          ouvintesDoVideo.delete(f)
        }
      },
      fechar() {
        if (fechada) return
        fechada = true
        ouvintesDoEstado.clear()
        ouvintesDoVideo.clear()
        for (const parar of [...esperas]) parar()
        try {
          pc.close()
        } catch {
          /* já fechado */
        }
      },
    }
  }

  return { criar }
}
