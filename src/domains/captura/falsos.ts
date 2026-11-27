import type { EstadoDoCanal } from '../aovivo/portas'
import type { CameraDoAparelho, CanalDeVideo, ConexaoDeVideo, EstadoDaConexao, FabricaDeConexoes, FaixaDeVideo, FalhaDaCamera, FluxoDeVideo, RespostaDoSinal } from './portas'

/*
 * Falsos das portas da Captura, só para os testes do emissor e do receptor (`emissor.test.ts`, `receptor.test.ts`).
 * Nenhum código do app importa este arquivo. Ficam num arquivo comum (e não repetidos em cada teste) para os dois lados
 * serem provados contra os mesmos falsos. Sem `vi` (o arquivo não é teste): cada falso guarda o que recebeu em listas.
 */

/** SDP de teste (IP da faixa de documentação, RFC 5737): nunca um SDP real. */
export const SDP_DA_OFERTA = 'v=0\r\no=- 1 2 IN IP4 192.0.2.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\n'
export const SDP_DA_RESPOSTA = 'v=0\r\no=- 3 4 IN IP4 192.0.2.2\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=recvonly\r\n'

/** Deixa as promessas já resolvidas andarem (os falsos respondem na hora). */
async function esvaziar(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve()
}

/**
 * Relógio falso para o `agendar` das máquinas: `avancar(ms)` roda, em ordem de tempo, o que vence até lá (inclusive o
 * que for agendado no caminho) e deixa as promessas andarem entre uma tarefa e outra.
 */
export function criarRelogioFalso() {
  let agora = 0
  let sequencia = 0
  const tarefas = new Map<number, { em: number; f: () => void }>()

  function agendar(f: () => void, ms: number): () => void {
    const id = sequencia
    sequencia += 1
    tarefas.set(id, { em: agora + ms, f })
    return () => {
      tarefas.delete(id)
    }
  }

  async function avancar(ms: number): Promise<void> {
    const alvo = agora + ms
    for (let voltas = 0; voltas < 10_000; voltas += 1) {
      await esvaziar()
      let proxima: [number, { em: number; f: () => void }] | null = null
      for (const [id, t] of tarefas) {
        if (t.em > alvo) continue
        if (proxima === null || t.em < proxima[1].em || (t.em === proxima[1].em && id < proxima[0])) proxima = [id, t]
      }
      if (proxima === null) break
      tarefas.delete(proxima[0])
      agora = proxima[1].em
      proxima[1].f()
    }
    agora = alvo
    await esvaziar()
  }

  return { agendar, avancar, agora: () => agora, pendentes: () => tarefas.size }
}

/**
 * Canal de vídeo falso. `entregar(evento, payload)` faz o caminho do adaptador real: passa o `payload` pelo leitor do
 * domínio (`lerSinalDaCamera` ou `lerSinalDaObs`) e entrega só o que ele aceita, com o `remetente` do `payload`.
 */
export function criarCanalFalso<Envia, Recebe>(ler: (evento: string, payload: unknown) => Recebe | null) {
  const ouvintesDoSinal = new Set<(s: Recebe, remetente: string) => void>()
  const ouvintesDoEstado = new Set<(e: EstadoDoCanal) => void>()
  const enviados: Envia[] = []
  let responder: (s: Envia) => RespostaDoSinal = () => 'ok'

  const canal: CanalDeVideo<Envia, Recebe> = {
    aoSinal(f) {
      ouvintesDoSinal.add(f)
      return () => {
        ouvintesDoSinal.delete(f)
      }
    },
    aoMudarEstado(f) {
      ouvintesDoEstado.add(f)
      return () => {
        ouvintesDoEstado.delete(f)
      }
    },
    async enviar(s) {
      enviados.push(s)
      return responder(s)
    },
    async fechar() {},
  }

  return {
    canal,
    enviados,
    responderCom(f: (s: Envia) => RespostaDoSinal): void {
      responder = f
    },
    /** `true` se o leitor aceitou e o sinal foi entregue. */
    entregar(evento: string, payload: unknown): boolean {
      const sinal = ler(evento, payload)
      const remetente = typeof payload === 'object' && payload !== null ? (payload as { remetente?: unknown }).remetente : undefined
      if (sinal === null || typeof remetente !== 'string') return false
      for (const f of [...ouvintesDoSinal]) f(sinal, remetente)
      return true
    },
    mudarEstado(e: EstadoDoCanal): void {
      for (const f of [...ouvintesDoEstado]) f(e)
    },
    ouvintes: () => ouvintesDoSinal.size + ouvintesDoEstado.size,
  }
}

/** Uma faixa ou um fluxo opaco de teste (o adaptador real guarda o `MediaStreamTrack` e o `MediaStream`). */
export function faixaDeTeste(): FaixaDeVideo {
  return {} as FaixaDeVideo
}
export function fluxoDeTeste(): FluxoDeVideo {
  return {} as FluxoDeVideo
}

export interface ConexaoFalsa {
  readonly numero: number
  readonly conexao: ConexaoDeVideo
  readonly ofertas: FaixaDeVideo[]
  readonly respostasAceitas: string[]
  readonly ofertasRespondidas: string[]
  readonly trocas: FaixaDeVideo[]
  fechada(): boolean
  emitir(e: EstadoDaConexao): void
  mostrarVideo(f: FluxoDeVideo): void
  ouvintes(): number
}

/** Fábrica de conexões falsas: `registro` guarda a ordem de `criar#n` e `fechar#n` de todas as conexões. */
export function criarConexoesFalsas() {
  const criadas: ConexaoFalsa[] = []
  const registro: string[] = []
  const config = { sdpDaOferta: SDP_DA_OFERTA, sdpDaResposta: SDP_DA_RESPOSTA, trocaDaFaixa: true, segurarRespostas: false }
  /** `responder` seguros (com `segurarRespostas`): só terminam em `soltarRespostas()`. */
  const respostasSeguras: (() => void)[] = []

  const fabrica: FabricaDeConexoes = {
    criar() {
      const numero = criadas.length
      const ouvintesDoEstado = new Set<(e: EstadoDaConexao) => void>()
      const ouvintesDoVideo = new Set<(f: FluxoDeVideo) => void>()
      let fechada = false
      const falsa: ConexaoFalsa = {
        numero,
        ofertas: [],
        respostasAceitas: [],
        ofertasRespondidas: [],
        trocas: [],
        fechada: () => fechada,
        emitir(e) {
          for (const f of [...ouvintesDoEstado]) f(e)
        },
        mostrarVideo(fluxo) {
          for (const f of [...ouvintesDoVideo]) f(fluxo)
        },
        ouvintes: () => ouvintesDoEstado.size + ouvintesDoVideo.size,
        conexao: {
          async oferecer(faixa) {
            falsa.ofertas.push(faixa)
            return config.sdpDaOferta
          },
          async aceitarResposta(sdp) {
            falsa.respostasAceitas.push(sdp)
          },
          async responder(oferta) {
            falsa.ofertasRespondidas.push(oferta)
            if (config.segurarRespostas) await new Promise<void>((r) => respostasSeguras.push(r))
            return config.sdpDaResposta
          },
          async trocarFaixa(faixa) {
            falsa.trocas.push(faixa)
            return config.trocaDaFaixa
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
            if (!fechada) registro.push(`fechar#${numero}`)
            fechada = true
          },
        },
      }
      criadas.push(falsa)
      registro.push(`criar#${numero}`)
      return falsa.conexao
    },
  }

  return {
    fabrica,
    criadas,
    registro,
    config,
    ultima: (): ConexaoFalsa | undefined => criadas.at(-1),
    soltarRespostas(): void {
      for (const r of respostasSeguras.splice(0)) r()
    },
  }
}

/**
 * Câmera falsa: `proximo` decide o resultado do próximo `ligar`; `perder()` dispara `aoPerderFaixa`. Com `segurar`, o
 * `ligar` só responde em `soltarLigacoes()` (um `getUserMedia` que demora). `registro` guarda a ordem de `ligar#n`,
 * `faixa#n` (a faixa n entregue) e `desligar`.
 */
export function criarCameraFalsa() {
  const ouvintes = new Set<() => void>()
  const faixas: FaixaDeVideo[] = []
  const registro: string[] = []
  const ligacoesSeguras: (() => void)[] = []
  const estado = { ligacoes: 0, desligadas: 0, proximo: null as FalhaDaCamera | null, segurar: false }

  const camera: CameraDoAparelho = {
    async ligar() {
      const n = estado.ligacoes
      estado.ligacoes += 1
      registro.push(`ligar#${n}`)
      if (estado.segurar) await new Promise<void>((r) => ligacoesSeguras.push(r))
      if (estado.proximo !== null) return { ok: false, motivo: estado.proximo }
      const faixa = faixaDeTeste()
      faixas.push(faixa)
      registro.push(`faixa#${n}`)
      return { ok: true, faixa }
    },
    aoPerderFaixa(f) {
      ouvintes.add(f)
      return () => {
        ouvintes.delete(f)
      }
    },
    desligar() {
      estado.desligadas += 1
      registro.push('desligar')
    },
    fluxoDaPrevia: () => null,
  }

  return {
    camera,
    estado,
    faixas,
    registro,
    soltarLigacoes(): void {
      for (const r of ligacoesSeguras.splice(0)) r()
    },
    perder(): void {
      for (const f of [...ouvintes]) f()
    },
    ouvintes: () => ouvintes.size,
  }
}
