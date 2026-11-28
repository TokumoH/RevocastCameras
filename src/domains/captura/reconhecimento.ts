import type { Gesto } from '../preparacao/gestos'
import { criarAgenda } from './agenda'
import { criarConfirmador } from './confirmador'
import {
  ESPERA_DO_RECONHECEDOR_MS,
  JANELA_DA_MEDIA,
  MS_PARA_PARAR,
  MS_PARA_REDUZIR,
  QUADROS_POR_SEGUNDO,
  QUADROS_REDUZIDOS,
  TEMPO_LENTO_MS,
  ehGesto,
  type EstadoDosGestos,
  type LeituraDoGesto,
  type RespostaDoGesto,
  type SituacaoDosGestos,
} from './gestos'
import type { FabricaDeReconhecedores, FonteDeQuadros, QuadroDeVideo, ReconhecedorDeGestos, RepositorioDosGestos } from './portas'

export interface DependenciasDoReconhecimento {
  fabrica: FabricaDeReconhecedores
  /** Os quadros do vídeo que a rota já tem (a faixa da câmera; o vídeo recebido no OBS); `null` = sem vídeo agora. */
  fonte: () => FonteDeQuadros | null
  repo: RepositorioDosGestos
  /** uuid novo por gesto confirmado (`crypto.randomUUID()` na rota). */
  novoId(): string
  agora(): number
  agendar(f: () => void, ms: number): () => void
  aoMudarSituacao(s: SituacaoDosGestos): void
  /** Cada gesto confirmado, com a resposta da função; `negado` e `desligados` pedem à rota que chame `reavaliar()`. */
  aoGesto(g: { gesto: Gesto; resposta: RespostaDoGesto; em: number }): void
}

/** O que a rota sabe (D5, D11): a situação do banco, o episódio ativo, o vídeo disponível e a página visível. */
export interface CondicoesDoReconhecimento {
  ligados: boolean
  reconhecerAqui: boolean
  episodio: boolean
  video: boolean
  visivel: boolean
}

type Motivo = 'quadro' | 'carga'

/** O que mantém o laço parado até um evento novo: `negado` (e `desligados` do banco) até a próxima `definir`; os outros até `tentarDeNovo` ou os gestos desligados e ligados de novo. */
type Bloqueio = 'lento' | 'sem_suporte' | 'falhou' | 'negado'

/** Um worker vivo e a fonte de quadros dele. */
interface Sessao {
  readonly reconhecedor: ReconhecedorDeGestos
  readonly fonte: FonteDeQuadros
  /** `iniciar` respondeu `ok`. */
  pronto: boolean
  /** O último quadro pedido veio `null`. */
  semVideo: boolean
  periodoMs: number
  /** Os últimos `JANELA_DA_MEDIA` tempos por quadro. */
  readonly tempos: number[]
  /** Desde quando a média está acima de `MS_PARA_PARAR`. */
  lentoDesde: number | null
  quadros: number
  quadrosNaUltimaSituacao: number
}

const PERIODO_NORMAL_MS = 1000 / QUADROS_POR_SEGUNDO
const PERIODO_REDUZIDO_MS = 1000 / QUADROS_REDUZIDOS

/**
 * O laço do reconhecimento (PLA-006, D3, D5, D8, D11): quadros → reconhecedor → confirmador → `enviar_gesto`.
 *
 * - O worker só nasce com `ligados && reconhecerAqui && episodio && video && visivel` e uma fonte de quadros; qualquer
 *   condição falsa o encerra (`fechar`), solta a fonte e zera o confirmador; nenhum agendamento sobra.
 * - Um quadro por vez: o próximo só é pedido depois da resposta do anterior, no período atual (100 ms; 200 ms com a média
 *   móvel dos últimos 20 quadros acima de 120 ms); a média acima de 400 ms por 10 s para tudo (`lento`).
 * - `iniciar` tem `ESPERA_DO_RECONHECEDOR_MS`; `sem_suporte` → `sem_suporte`; o resto → `falhou`. Nenhuma das três tenta
 *   de novo sozinha: só `tentarDeNovo` (toque, `gestos_mudaram`, `dispositivo_mudou`, episódio novo) ou os gestos
 *   desligados e ligados de novo.
 * - O gesto confirmado vai a `repo.enviar` sem segurar o laço; `negado` e `desligados` param o laço (situação
 *   `desligados`) até a próxima `definir` (revisão 1, N3; revisão 2, N14). Rejeição → `falhou`.
 * - `reconhecer` que rejeita (ou lança) = o reconhecedor morreu (o worker deu erro depois de pronto): encerra e fica
 *   `falhou`, como uma carga que falha (VER-063, rodada 1, N6); `null` é só falha deste quadro.
 */
export function criarReconhecimento(d: DependenciasDoReconhecimento): {
  definir(c: CondicoesDoReconhecimento): void
  tentarDeNovo(): void
  parar(): void
} {
  const agenda = criarAgenda<Motivo>(d.agendar)
  const confirmador = criarConfirmador()
  let condicoes: CondicoesDoReconhecimento | null = null
  let bloqueio: Bloqueio | null = null
  let sessao: Sessao | null = null
  let ultima: SituacaoDosGestos | null = null
  let parado = false

  function publicar(s: SituacaoDosGestos): void {
    if (ultima !== null && ultima.estado === s.estado && ultima.quadrosPorSegundo === s.quadrosPorSegundo && ultima.msPorQuadro === s.msPorQuadro) return
    ultima = s
    d.aoMudarSituacao(s)
  }

  function situacao(estado: EstadoDosGestos): void {
    publicar({ estado, quadrosPorSegundo: null, msPorQuadro: null })
  }

  function media(s: Sessao): number | null {
    return s.tempos.length === 0 ? null : s.tempos.reduce((a, b) => a + b, 0) / s.tempos.length
  }

  /** Situação do laço vivo: o estado e a taxa mudam na hora; o `msPorQuadro`, no primeiro quadro e depois a cada `JANELA_DA_MEDIA` quadros. */
  function situacaoDoLaco(s: Sessao): void {
    if (!s.pronto) return situacao('carregando')
    if (s.semVideo) return situacao('aguardando_video')
    const m = media(s)
    const nova: SituacaoDosGestos = { estado: 'reconhecendo', quadrosPorSegundo: 1000 / s.periodoMs, msPorQuadro: m === null ? null : Math.round(m) }
    const mudouOEssencial =
      ultima === null || ultima.estado !== nova.estado || ultima.quadrosPorSegundo !== nova.quadrosPorSegundo || (ultima.msPorQuadro === null) !== (nova.msPorQuadro === null)
    if (!mudouOEssencial && s.quadros - s.quadrosNaUltimaSituacao < JANELA_DA_MEDIA) return
    s.quadrosNaUltimaSituacao = s.quadros
    publicar(nova)
  }

  /** Encerra o worker e a fonte; os retornos atrasados da sessão encerrada são ignorados (`sessao !== s`). */
  function encerrar(): void {
    const s = sessao
    if (s === null) return
    sessao = null
    agenda.cancelar('quadro')
    agenda.cancelar('carga')
    confirmador.zerar()
    try {
      s.reconhecedor.fechar()
    } catch {
      // o adaptador não lança; protegido mesmo assim
    }
    try {
      s.fonte.fechar()
    } catch {
      // idem
    }
  }

  function bloquear(b: Bloqueio): void {
    bloqueio = b
    avaliar()
  }

  function avaliar(): void {
    if (parado || condicoes === null) return
    const c = condicoes
    if (!c.episodio || !c.ligados) {
      encerrar()
      bloqueio = null
      return situacao('desligados')
    }
    if (!c.reconhecerAqui) {
      encerrar()
      bloqueio = null
      return situacao('outro_aparelho')
    }
    if (bloqueio !== null) {
      encerrar()
      return situacao(bloqueio === 'negado' ? 'desligados' : bloqueio)
    }
    if (!c.video || !c.visivel) {
      encerrar()
      return situacao('aguardando_video')
    }
    if (sessao === null) ligar()
  }

  function ligar(): void {
    let fonte: FonteDeQuadros | null
    try {
      fonte = d.fonte()
    } catch {
      fonte = null
    }
    if (fonte === null) return situacao('aguardando_video')
    let reconhecedor: ReconhecedorDeGestos
    try {
      reconhecedor = d.fabrica.criar()
    } catch {
      try {
        fonte.fechar()
      } catch {
        // idem
      }
      return bloquear('falhou')
    }
    const s: Sessao = {
      reconhecedor,
      fonte,
      pronto: false,
      semVideo: false,
      periodoMs: PERIODO_NORMAL_MS,
      tempos: [],
      lentoDesde: null,
      quadros: 0,
      quadrosNaUltimaSituacao: 0,
    }
    sessao = s
    situacao('carregando')
    // a rota pode chamar `parar` ou `definir` de dentro do `aoMudarSituacao` (rodada 1, N1): nada de iniciar um reconhecedor fechado
    if (sessao !== s) return
    agenda.porMotivo(
      'carga',
      () => {
        if (sessao === s) bloquear('falhou')
      },
      ESPERA_DO_RECONHECEDOR_MS,
    )
    let inicio: Promise<{ ok: true } | { ok: false; motivo: string }>
    try {
      inicio = reconhecedor.iniciar()
    } catch {
      inicio = Promise.resolve({ ok: false, motivo: 'outro' })
    }
    inicio.then(
      (r) => {
        if (sessao !== s) return
        agenda.cancelar('carga')
        if (!r.ok) return bloquear(r.motivo === 'sem_suporte' ? 'sem_suporte' : 'falhou')
        s.pronto = true
        situacaoDoLaco(s)
        if (sessao !== s) return
        agenda.porMotivo('quadro', () => pedirQuadro(s), 0)
      },
      () => {
        if (sessao === s) bloquear('falhou')
      },
    )
  }

  function pedirQuadro(s: Sessao): void {
    if (sessao !== s) return
    let pedido: Promise<QuadroDeVideo | null>
    try {
      pedido = s.fonte.quadro()
    } catch {
      pedido = Promise.resolve(null)
    }
    pedido
      .then(
        (q) => q,
        () => null,
      )
      .then((q) => {
        if (sessao !== s) return
        if (q === null) {
          s.semVideo = true
          situacaoDoLaco(s)
          if (sessao !== s) return
          agenda.porMotivo('quadro', () => pedirQuadro(s), s.periodoMs)
          return
        }
        s.semVideo = false
        const em = d.agora()
        let leitura: Promise<LeituraDoGesto | null>
        try {
          leitura = s.reconhecedor.reconhecer(q, em)
        } catch {
          leitura = Promise.reject(new Error('reconhecer lançou'))
        }
        // rejeição (ou exceção) = o reconhecedor morreu (porta, VER-063 N6): para com `falhou`, como uma carga que falha;
        // `null` continua sendo falha só deste quadro
        leitura.then(
          (l) => {
            if (sessao === s) depoisDoQuadro(s, em, l)
          },
          () => {
            if (sessao === s) bloquear('falhou')
          },
        )
      })
  }

  function depoisDoQuadro(s: Sessao, em: number, l: LeituraDoGesto | null): void {
    const agora = d.agora()
    if (l !== null) {
      // ida e volta medida (inclui o worker); o `ms` do worker protege um relógio que não andou
      const doWorker = typeof l.ms === 'number' && Number.isFinite(l.ms) && l.ms >= 0 ? l.ms : 0
      s.tempos.push(Math.max(doWorker, agora - em))
      if (s.tempos.length > JANELA_DA_MEDIA) s.tempos.shift()
      s.quadros += 1
      const m = media(s) ?? 0
      s.periodoMs = m > MS_PARA_REDUZIR ? PERIODO_REDUZIDO_MS : PERIODO_NORMAL_MS
      if (m > MS_PARA_PARAR) {
        if (s.lentoDesde === null) s.lentoDesde = agora
        if (agora - s.lentoDesde >= TEMPO_LENTO_MS) return bloquear('lento')
      } else s.lentoDesde = null
      // defesa em profundidade: o adaptador já traduz; fora dos 7 (inclusive `None`) conta como sem gesto
      const gesto = confirmador.ler({ gesto: ehGesto(l.gesto) ? l.gesto : null, confianca: l.confianca }, em, s.periodoMs)
      if (gesto !== null) enviar(s, gesto, em)
    }
    situacaoDoLaco(s)
    if (sessao !== s) return
    agenda.porMotivo('quadro', () => pedirQuadro(s), Math.max(0, s.periodoMs - (agora - em)))
  }

  function enviar(s: Sessao, gesto: Gesto, em: number): void {
    const id = d.novoId()
    let pedido: Promise<RespostaDoGesto>
    try {
      pedido = d.repo.enviar({ id, gesto })
    } catch {
      pedido = Promise.resolve('falhou')
    }
    pedido
      .then(
        (r) => r,
        (): RespostaDoGesto => 'falhou',
      )
      .then((resposta) => {
        if (parado) return
        // para antes de avisar: a rota pode chamar `definir` de dentro do `aoGesto`
        if ((resposta === 'negado' || resposta === 'desligados') && sessao === s) bloquear('negado')
        d.aoGesto({ gesto, resposta, em })
      })
  }

  return {
    definir(c) {
      if (parado) return
      condicoes = { ligados: c.ligados, reconhecerAqui: c.reconhecerAqui, episodio: c.episodio, video: c.video, visivel: c.visivel }
      if (bloqueio === 'negado') bloqueio = null
      avaliar()
    },
    tentarDeNovo() {
      if (parado || bloqueio === null) return
      bloqueio = null
      avaliar()
    },
    parar() {
      if (parado) return
      parado = true
      encerrar()
      agenda.parar()
    },
  }
}
