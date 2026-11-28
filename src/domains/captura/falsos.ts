import type { EstadoDoCanal } from '../canal/estados'
import type { Gesto } from '../preparacao/gestos'
import type { LeituraDoGesto, RespostaDoGesto } from './gestos'
import type {
  CameraDoAparelho,
  CanalDeVideo,
  ConexaoDeVideo,
  EstadoDaConexao,
  FabricaDeConexoes,
  FabricaDeReconhecedores,
  FaixaDeVideo,
  FalhaDaCamera,
  FalhaDoReconhecedor,
  FluxoDeVideo,
  FonteDeQuadros,
  QuadroDeVideo,
  RepositorioDosGestos,
  RespostaDoSinal,
} from './portas'

/*
 * Falsos das portas da Captura, só para os testes do emissor e do receptor (`emissor.test.ts`, `receptor.test.ts`) e,
 * desde a E5, do laço do reconhecimento (`reconhecimento.test.ts`).
 * Nenhum código de produção importa este arquivo (desde a E5, só `src/app/servicosFalsos.ts`, também só de teste, reusa os
 * falsos dos gestos). Ficam num arquivo comum (e não repetidos em cada teste) para os dois lados
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

export interface ReconhecedorFalso {
  readonly numero: number
  /** Os instantes passados a cada `reconhecer`. */
  readonly reconhecidos: number[]
  fechado(): boolean
}

/**
 * Fábrica de reconhecedores falsos (E5). `config` decide o próximo `iniciar` (`ok`, uma falha, `rejeitar`, ou seguro até
 * `soltarIniciar()` com `segurarIniciar`), se `criar` lança, e a leitura de cada quadro: `gesto` e `confianca`, devolvidos
 * depois de `msPorQuadro` no relógio do `agendar` (ou nunca, com `segurarReconhecer`). `registro` guarda a ordem de
 * `criar#n`, `iniciar#n` e `fechar#n`.
 */
export function criarReconhecedoresFalsos(agendar: (f: () => void, ms: number) => () => void) {
  const config = {
    iniciar: 'ok' as 'ok' | FalhaDoReconhecedor | 'rejeitar',
    segurarIniciar: false,
    segurarReconhecer: false,
    criarLanca: false,
    msPorQuadro: 20,
    gesto: null as Gesto | null,
    confianca: 0.9,
    /** O worker devolve `null` (falha neste quadro). */
    leituraNula: false,
    /** O `reconhecer` rejeita (o worker morreu depois de pronto; VER-063, rodada 1, N6). */
    reconhecerRejeita: false,
    /** O `reconhecer` lança de forma síncrona (VER-063, rodada 2, R2-2). */
    reconhecerLanca: false,
    /** O `ms` que o worker diz (no lugar de `msPorQuadro`); o quadro continua levando `msPorQuadro` no relógio. */
    msDoWorker: null as number | null,
    /** O gesto de cada quadro pelo instante (no lugar de `gesto`). */
    gestoNoQuadro: null as ((em: number) => Gesto | null) | null,
  }
  const criados: ReconhecedorFalso[] = []
  const registro: string[] = []
  const iniciosSeguros: (() => void)[] = []

  const fabrica: FabricaDeReconhecedores = {
    criar() {
      if (config.criarLanca) throw new Error('sem suporte')
      const numero = criados.length
      const reconhecidos: number[] = []
      let fechado = false
      criados.push({ numero, reconhecidos, fechado: () => fechado })
      registro.push(`criar#${numero}`)
      return {
        async iniciar() {
          registro.push(`iniciar#${numero}`)
          if (config.segurarIniciar) await new Promise<void>((r) => iniciosSeguros.push(r))
          if (config.iniciar === 'rejeitar') throw new Error('falha do worker')
          return config.iniciar === 'ok' ? { ok: true as const } : { ok: false as const, motivo: config.iniciar }
        },
        reconhecer(_q, em) {
          reconhecidos.push(em)
          if (config.segurarReconhecer) return new Promise<LeituraDoGesto | null>(() => {})
          if (config.reconhecerRejeita) return Promise.reject(new Error('reconhecedor encerrado'))
          if (config.reconhecerLanca) throw new Error('reconhecedor encerrado')
          const gesto = config.gestoNoQuadro === null ? config.gesto : config.gestoNoQuadro(em)
          const leitura: LeituraDoGesto | null = config.leituraNula ? null : { gesto, confianca: config.confianca, ms: config.msDoWorker ?? config.msPorQuadro }
          return new Promise<LeituraDoGesto | null>((r) => {
            agendar(() => r(leitura), config.msPorQuadro)
          })
        },
        fechar() {
          if (!fechado) registro.push(`fechar#${numero}`)
          fechado = true
        },
      }
    },
  }

  return {
    fabrica,
    config,
    criados,
    registro,
    ultimo: (): ReconhecedorFalso | undefined => criados.at(-1),
    soltarIniciar(): void {
      for (const r of iniciosSeguros.splice(0)) r()
    },
  }
}

/**
 * Fonte de quadros falsa (E5): `fonte()` faz o papel da rota (com `config.sem`, devolve `null`: sem vídeo); cada fonte
 * entrega quadros opacos (ou `null` com `config.quadroNulo`; seguros até `soltarQuadros()` com `config.segurarQuadro`). Conta as fontes pedidas, os quadros pedidos e as fechadas.
 */
export function criarFonteFalsa() {
  const config = { sem: false, quadroNulo: false, segurarQuadro: false }
  const contagem = { pedidas: 0, quadros: 0, fechadas: 0 }
  const quadrosSeguros: (() => void)[] = []

  function fonte(): FonteDeQuadros | null {
    contagem.pedidas += 1
    if (config.sem) return null
    let fechada = false
    return {
      async quadro() {
        contagem.quadros += 1
        if (config.segurarQuadro) await new Promise<void>((r) => quadrosSeguros.push(r))
        return config.quadroNulo ? null : ({} as QuadroDeVideo)
      },
      fechar() {
        if (!fechada) contagem.fechadas += 1
        fechada = true
      },
    }
  }

  return {
    fonte,
    config,
    pedidas: () => contagem.pedidas,
    quadrosPedidos: () => contagem.quadros,
    fechadas: () => contagem.fechadas,
    soltarQuadros(): void {
      for (const r of quadrosSeguros.splice(0)) r()
    },
  }
}

/** Repositório dos gestos falso (E5): guarda cada `enviar` (cópia) e responde com `responderCom` (padrão `enviado`). */
export function criarRepoDosGestosFalso() {
  const enviados: { id: string; gesto: Gesto }[] = []
  const situacao = { ligados: true, reconhecerAqui: true }
  let responder: (g: { id: string; gesto: Gesto }) => Promise<RespostaDoGesto> = async () => 'enviado'

  const repo: RepositorioDosGestos = {
    async situacao() {
      return { ...situacao }
    },
    enviar(g) {
      enviados.push({ id: g.id, gesto: g.gesto })
      return responder(g)
    },
  }

  return {
    repo,
    enviados,
    situacao,
    responderCom(f: (g: { id: string; gesto: Gesto }) => Promise<RespostaDoGesto>): void {
      responder = f
    },
  }
}
