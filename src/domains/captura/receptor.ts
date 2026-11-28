import type { EstadoDoCanal } from '../aovivo/portas'
import { criarAgenda } from './agenda'
import type { CanalDeVideo, ConexaoDeVideo, EstadoDaConexao, FabricaDeConexoes, FluxoDeVideo, RespostaDoSinal } from './portas'
import { FALHAS_PARA_SEM_CONEXAO_DIRETA, PRONTO_A_CADA_MS, conferirSdp, esperaDaTentativa, type EstadoDoVideo, type SinalDaCamera, type SinalDaObs } from './sinais'

export interface DependenciasDoReceptor {
  /** O tópico da própria sessão do `obs_camera` (`video:<uid>`): recebe `oferta` e `encerrar`; envia pela função. */
  canal: CanalDeVideo<SinalDaObs, SinalDaCamera>
  conexoes: FabricaDeConexoes
  revogado(usuario: string): boolean
  novaSessao(): string
  agendar(f: () => void, ms: number): () => void
  aoMudarSituacao(e: EstadoDoVideo): void
  /**
   * O fluxo que a tela mostra, entregue **só com a conexão em `conectado`**; `null` ao sair de `conectado` (queda,
   * `caiu`, `falhou`, fechamento): a Fonte do OBS fica transparente (D3: "sem vídeo" é conexão fora de `conectado`,
   * não o evento `track`; D8).
   */
  aoVideo(fluxo: FluxoDeVideo | null): void
}

type Motivo = 'pronto' | 'limite'

interface Sessao {
  /** A sessão da oferta (a resposta leva a mesma). */
  readonly id: string
  readonly conexao: ConexaoDeVideo
  /** Remetente da oferta (a câmera, posto pelo banco). */
  readonly remetente: string
  estado: EstadoDaConexao | null
  respondida: boolean
  conectou: boolean
  /** O fluxo recebido (evento `track`), guardado até a conexão estar em `conectado`. */
  fluxo: FluxoDeVideo | null
  /** O fluxo foi entregue à tela (`aoVideo(fluxo)`) e ainda não retirado. */
  entregue: boolean
  soltar: () => void
}

/**
 * Receptor do vídeo, no `/obs/camera` (PLA-005, D3, D5, D6). Só conhece portas; só responde, nunca oferece.
 * - **`pronto` (D3):** com episódio ativo, canal conectado e a conexão fora de `conectado`, manda `pronto` na hora e a
 *   cada 10 s (uma conexão em `conectando` não é fechada por isso). `limite` (no `pronto` ou na `resposta`) → o próximo
 *   `pronto` só depois da espera crescente, nunca antes dos 10 s do ciclo normal.
 * - **Oferta:** responde com a **mesma** sessão; oferta de outra sessão fecha a conexão anterior antes de criar a nova
 *   (a oferta só vem da sessão atual da câmera, D2); repetida, de remetente revogado ou sem episódio → ignorada.
 * - **Vídeo (D3, D8):** o fluxo só vai à tela com a conexão em `conectado`; ao sair de `conectado` (`caiu`, `conectando`,
 *   `falhou`, fechamento), `aoVideo(null)`; ao voltar a `conectado`, o mesmo fluxo de novo.
 * - **Fim:** `encerrar` da sessão atual (do mesmo remetente), `revogarPar` do remetente da oferta, `falhou`, sem episódio
 *   ou `parar` → fecha e limpa o vídeo (`aoVideo(null)`).
 * - **SDP próprio fora da regra (revisão 3, N13):** nada enviado, `sinal_grande`, sem `pronto` até nova oferta.
 * - **Situação:** duas falhas seguidas depois de responder (`falhou`, ou oferta nova sem a anterior ter conectado, que é o
 *   prazo da conexão vencido do lado da câmera) → `sem_conexao_direta` (o selo do `/obs/camera`, D6).
 */
export function criarReceptorDeVideo(d: DependenciasDoReceptor): {
  definirEpisodio(ativo: boolean): void
  revogarPar(usuario: string): void
  parar(): void
} {
  const agenda = criarAgenda<Motivo>(d.agendar)
  let parado = false
  let episodio = false
  let canal: EstadoDoCanal = 'conectando'
  let sessao: Sessao | null = null
  let sinalGrande = false
  let falhasSeguidas = 0
  let tentativa = 0
  let emEsperaDoLimite = false
  let situacao: EstadoDoVideo | null = null

  function calcularSituacao(): EstadoDoVideo {
    if (!episodio) return 'aguardando_episodio'
    if (sinalGrande) return 'sinal_grande'
    if (sessao?.estado === 'conectado') return 'conectado'
    if (falhasSeguidas >= FALHAS_PARA_SEM_CONEXAO_DIRETA) return 'sem_conexao_direta'
    return sessao !== null ? 'conectando' : 'aguardando_par'
  }

  function atualizar(): void {
    if (parado) return
    const e = calcularSituacao()
    if (e === situacao) return
    situacao = e
    d.aoMudarSituacao(e)
  }

  async function enviar(s: SinalDaObs): Promise<RespostaDoSinal> {
    try {
      return await d.canal.enviar(s)
    } catch {
      return 'falhou'
    }
  }

  function deveMandarPronto(): boolean {
    return !parado && episodio && canal === 'conectado' && sessao?.estado !== 'conectado' && !sinalGrande
  }

  /** Começa (ou para) o ciclo do `pronto`; nunca dentro da espera do limite. */
  function avaliarPronto(): void {
    if (!deveMandarPronto()) {
      agenda.cancelar('pronto')
      return
    }
    if (agenda.ativo('pronto') || emEsperaDoLimite) return
    agenda.porMotivo('pronto', avaliarPronto, PRONTO_A_CADA_MS)
    void enviar({ tipo: 'pronto', sessao: d.novaSessao() }).then((r) => {
      if (r === 'limite') esperarLimite()
    })
  }

  function esperarLimite(): void {
    if (parado) return
    agenda.cancelar('pronto')
    const ms = Math.max(PRONTO_A_CADA_MS, esperaDaTentativa(tentativa))
    tentativa += 1
    emEsperaDoLimite = true
    agenda.porMotivo(
      'limite',
      () => {
        emEsperaDoLimite = false
        avaliarPronto()
      },
      ms,
    )
  }

  /** Entrega o fluxo só com a conexão em `conectado`; fora dele, retira o que estava entregue. */
  function mostrarOuRetirar(s: Sessao): void {
    const mostrar = sessao === s && s.estado === 'conectado' && s.fluxo !== null
    if (mostrar && !s.entregue && s.fluxo !== null) {
      s.entregue = true
      d.aoVideo(s.fluxo)
    } else if (!mostrar && s.entregue) {
      s.entregue = false
      d.aoVideo(null)
    }
  }

  function fecharSessao(): void {
    const s = sessao
    if (s === null) return
    sessao = null
    s.soltar()
    s.conexao.fechar()
    mostrarOuRetirar(s)
  }

  function aoMudarConexao(s: Sessao, e: EstadoDaConexao): void {
    if (sessao !== s) return
    s.estado = e
    if (e === 'conectado') {
      s.conectou = true
      falhasSeguidas = 0
      tentativa = 0
    } else if (e === 'falhou') {
      if (s.respondida) falhasSeguidas += 1
      fecharSessao()
    }
    mostrarOuRetirar(s)
    atualizar()
    avaliarPronto()
  }

  async function responder(id: string, oferta: string, remetente: string): Promise<void> {
    const anterior = sessao
    if (anterior !== null && anterior.respondida && !anterior.conectou) falhasSeguidas += 1
    fecharSessao()
    sinalGrande = false
    let conexao: ConexaoDeVideo
    try {
      conexao = d.conexoes.criar()
    } catch {
      // a fábrica recusou (VER-051, rodada 1, I2): como um `responder` que falha, sem rejeição solta
      atualizar()
      avaliarPronto()
      return
    }
    const s: Sessao = { id, conexao, remetente, estado: null, respondida: false, conectou: false, fluxo: null, entregue: false, soltar: () => {} }
    sessao = s
    const soltarEstado = conexao.aoMudar((e) => agenda.depois(() => aoMudarConexao(s, e)))
    const soltarVideo = conexao.aoVideo((fluxo) =>
      agenda.depois(() => {
        if (sessao !== s) return
        if (s.entregue && s.fluxo !== fluxo) {
          s.entregue = false
          d.aoVideo(null)
        }
        s.fluxo = fluxo
        mostrarOuRetirar(s)
      }),
    )
    s.soltar = () => {
      soltarEstado()
      soltarVideo()
    }
    atualizar()
    let sdp: string
    try {
      sdp = await conexao.responder(oferta)
    } catch {
      if (sessao !== s) return
      fecharSessao()
      atualizar()
      avaliarPronto()
      return
    }
    if (sessao !== s) return
    if (conferirSdp(sdp) !== 'ok') {
      sinalGrande = true
      fecharSessao()
      agenda.cancelar('pronto')
      atualizar()
      return
    }
    s.respondida = true
    const r = await enviar({ tipo: 'resposta', sessao: id, sdp })
    if (r === 'limite') esperarLimite()
  }

  function aoSinal(s: SinalDaCamera, remetente: string): void {
    if (d.revogado(remetente) || !episodio) return
    const atual = sessao
    if (s.tipo === 'encerrar') {
      if (atual === null || atual.id !== s.sessao || atual.remetente !== remetente) return
      fecharSessao()
      atualizar()
      avaliarPronto()
      return
    }
    if (atual !== null && atual.id === s.sessao) return
    void responder(s.sessao, s.sdp, remetente)
  }

  function aoMudarCanal(e: EstadoDoCanal): void {
    canal = e
    avaliarPronto()
  }

  const soltarSinal = d.canal.aoSinal((s, remetente) => agenda.depois(() => aoSinal(s, remetente)))
  const soltarCanal = d.canal.aoMudarEstado((e) => agenda.depois(() => aoMudarCanal(e)))
  atualizar()

  return {
    definirEpisodio(ativo) {
      if (parado || ativo === episodio) return
      episodio = ativo
      if (!ativo) {
        fecharSessao()
        agenda.cancelar('pronto')
        sinalGrande = false
        falhasSeguidas = 0
      }
      atualizar()
      avaliarPronto()
    },

    revogarPar(usuario) {
      if (parado || sessao === null || sessao.remetente !== usuario) return
      fecharSessao()
      atualizar()
      avaliarPronto()
    },

    parar() {
      if (parado) return
      parado = true
      const s = sessao
      if (s !== null) void enviar({ tipo: 'encerrar', sessao: s.id })
      fecharSessao()
      agenda.parar()
      soltarSinal()
      soltarCanal()
    },
  }
}
