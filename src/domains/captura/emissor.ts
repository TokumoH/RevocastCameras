import type { EstadoDoCanal } from '../canal/estados'
import { criarAgenda } from './agenda'
import type { CameraDoAparelho, CanalDeVideo, ConexaoDeVideo, EstadoDaConexao, FabricaDeConexoes, FaixaDeVideo, FalhaDaCamera, RespostaDoSinal } from './portas'
import {
  ESPERA_DA_CONEXAO_MS,
  ESPERA_DA_QUEDA_MS,
  ESPERA_DA_RESPOSTA_MS,
  FALHAS_PARA_SEM_CONEXAO_DIRETA,
  conferirSdp,
  esperaDaTentativa,
  type EstadoDoVideo,
  type SinalDaCamera,
  type SinalDaObs,
} from './sinais'

export interface DependenciasDoEmissor {
  /** O tópico da própria sessão da câmera (`video:<uid>`): recebe `pronto`, `resposta` e `encerrar`; envia pela função. */
  canal: CanalDeVideo<SinalDaCamera, SinalDaObs>
  conexoes: FabricaDeConexoes
  camera: CameraDoAparelho
  /** Remetente revogado avisado em `estudio` (a rota consulta `Revogados`): os sinais dele são descartados (D1). */
  revogado(usuario: string): boolean
  /** uuid novo por sessão de vídeo (`crypto.randomUUID()` na rota). */
  novaSessao(): string
  agendar(f: () => void, ms: number): () => void
  aoMudarSituacao(e: EstadoDoVideo): void
}

type Motivo = 'espera' | 'resposta' | 'queda' | 'conexao'

/** Uma sessão de vídeo: uma oferta, uma conexão e, no máximo, uma resposta aceita (D3). */
interface Sessao {
  readonly id: string
  readonly conexao: ConexaoDeVideo
  estado: EstadoDaConexao | null
  /** Oferta montada ou enviada, ainda sem resposta aceita. */
  aguardandoResposta: boolean
  /** Remetente da resposta aceita (o par); `null` antes dela. */
  par: string | null
  soltar: () => void
}

/**
 * Emissor do vídeo, no celular (PLA-005, D3, D5–D7). Só conhece portas.
 * - **Consentimento (D7):** a câmera nunca liga antes de `ligarPeloToque`; sem episódio, a conexão fecha (com
 *   `encerrar`) e a câmera desliga; com episódio de novo, religa sozinha enquanto o consentimento da página valer.
 *   Falha da câmera (`sem_permissao`, `sem_camera`, `inseguro`; `outro` volta a `aguardando_toque`) derruba o
 *   consentimento: só um novo toque tenta de novo. Faixa perdida (fim, ou mudez de 3 s) → liga de novo e troca a faixa
 *   sem renegociar; troca recusada → oferta nova; `outro` ao religar (página escondida) → tenta de novo em `voltarAVer`.
 * - **Ofertas (D3):** a câmera sempre oferece; uma sessão nova (uuid) por oferta; a primeira resposta da sessão vale;
 *   respostas repetidas, de sessão antiga ou de remetente revogado são descartadas. Oferece sozinha quando o canal
 *   (re)conecta sem sessão pendente e atende um `pronto` só sem sessão pendente e fora de uma espera crescente.
 *   Exceção (VER-056, I2): um `pronto` de remetente diferente do par aceito prova que o par mudou (só o `obs_camera`
 *   atual consegue mandá-lo): fecha a sessão com o par antigo e oferece de novo, sujeito às mesmas esperas.
 * - **Esperas (D6):** `caiu` espera 5 s; `falhou`, 15 s sem resposta, resposta aceita sem `conectado` em 20 s, `sem_par`
 *   e `limite` → nova tentativa pela espera crescente (2, 4, 8, 16, 30, 30… s), zerada no `conectado`; duas falhas
 *   seguidas depois de resposta aceita (`falhou` ou prazo da conexão) → `sem_conexao_direta`; `limite` não conta.
 * - **SDP próprio fora da regra (revisão 3, N13):** nada enviado, conexão fechada, câmera desligada, `sinal_grande` e
 *   nenhuma tentativa sozinha; um novo toque ou um novo episódio religam e tentam de novo uma vez.
 * O que um ouvinte de porta faz passa pelo `agendar` com 0 ms; cada prazo tem um único agendamento por motivo.
 */
export function criarEmissorDeVideo(d: DependenciasDoEmissor): {
  ligarPeloToque(): Promise<void>
  definirEpisodio(ativo: boolean): void
  revogarPar(usuario: string): void
  voltarAVer(): void
  parar(): void
} {
  const agenda = criarAgenda<Motivo>(d.agendar)
  let parado = false
  let consentido = false
  let episodio = false
  let canal: EstadoDoCanal = 'conectando'
  let faixa: FaixaDeVideo | null = null
  let faixaPerdida = false
  let ligacao: Promise<void> | null = null
  let falhaDaCamera: Exclude<FalhaDaCamera, 'outro'> | null = null
  let sessao: Sessao | null = null
  let ofertaAgendada = false
  let emEspera = false
  let tentativa = 0
  let falhasSeguidas = 0
  let semPar = false
  let sinalGrande = false
  let situacao: EstadoDoVideo | null = null

  function calcularSituacao(): EstadoDoVideo {
    if (falhaDaCamera !== null) return falhaDaCamera
    if (!consentido) return 'aguardando_toque'
    if (!episodio) return 'aguardando_episodio'
    if (sinalGrande) return 'sinal_grande'
    if (sessao?.estado === 'conectado') return 'conectado'
    if (falhasSeguidas >= FALHAS_PARA_SEM_CONEXAO_DIRETA) return 'sem_conexao_direta'
    if (semPar) return 'aguardando_par'
    return 'conectando'
  }

  function atualizar(): void {
    if (parado) return
    const e = calcularSituacao()
    if (e === situacao) return
    situacao = e
    d.aoMudarSituacao(e)
  }

  /** Sessão pendente: oferta agendada, espera crescente correndo ou uma sessão aberta (montando, aguardando, conectando, conectado, caiu). */
  function pendente(): boolean {
    return ofertaAgendada || emEspera || sessao !== null
  }

  function podeOferecer(): boolean {
    return !parado && consentido && episodio && faixa !== null && !faixaPerdida && canal === 'conectado' && !sinalGrande
  }

  async function enviar(s: SinalDaCamera): Promise<RespostaDoSinal> {
    try {
      return await d.canal.enviar(s)
    } catch {
      return 'falhou'
    }
  }

  function fecharSessao(): void {
    agenda.cancelar('resposta')
    agenda.cancelar('queda')
    agenda.cancelar('conexao')
    const s = sessao
    if (s === null) return
    sessao = null
    s.soltar()
    s.conexao.fechar()
  }

  function cancelarEspera(): void {
    agenda.cancelar('espera')
    emEspera = false
  }

  /** Fecha a sessão e agenda a próxima tentativa pela espera crescente; `conta` = falha depois de resposta aceita. */
  function falhar(conta: boolean): void {
    if (conta) falhasSeguidas += 1
    fecharSessao()
    const ms = esperaDaTentativa(tentativa)
    tentativa += 1
    emEspera = true
    agenda.porMotivo(
      'espera',
      () => {
        emEspera = false
        void oferecer()
      },
      ms,
    )
    atualizar()
  }

  function pedirOferta(): void {
    if (ofertaAgendada) return
    ofertaAgendada = true
    agenda.depois(() => {
      ofertaAgendada = false
      void oferecer()
    })
  }

  async function oferecer(): Promise<void> {
    const f = faixa
    if (!podeOferecer() || f === null) return
    fecharSessao()
    cancelarEspera()
    let conexao: ConexaoDeVideo
    try {
      conexao = d.conexoes.criar()
    } catch {
      falhar(false) // a fábrica recusou (VER-051, rodada 1, I2): conta como falha da conexão, sem rejeição solta
      return
    }
    const s: Sessao = { id: d.novaSessao(), conexao, estado: null, aguardandoResposta: true, par: null, soltar: () => {} }
    sessao = s
    s.soltar = conexao.aoMudar((e) => agenda.depois(() => aoMudarConexao(s, e)))
    atualizar()
    let sdp: string
    try {
      sdp = await conexao.oferecer(f)
    } catch {
      if (sessao === s) falhar(false)
      return
    }
    if (sessao !== s) return
    if (conferirSdp(sdp) !== 'ok') {
      sinalGrande = true
      fecharSessao()
      desligarCamera() // nada vai sair: a câmera não fica ligada à toa (consumo, luz acesa); o novo toque religa
      atualizar()
      return
    }
    const r = await enviar({ tipo: 'oferta', sessao: s.id, sdp })
    if (sessao !== s || !s.aguardandoResposta) return
    if (r === 'ok') {
      agenda.porMotivo(
        'resposta',
        () => {
          if (sessao !== s || !s.aguardandoResposta) return
          semPar = true
          falhar(false)
        },
        ESPERA_DA_RESPOSTA_MS,
      )
      return
    }
    if (r === 'sem_par') {
      semPar = true
      falhasSeguidas = 0
    }
    falhar(false)
  }

  function aoMudarConexao(s: Sessao, e: EstadoDaConexao): void {
    if (sessao !== s) return
    s.estado = e
    if (e === 'falhou') {
      falhar(s.par !== null)
      return
    }
    if (e === 'conectado') {
      agenda.cancelar('queda')
      agenda.cancelar('conexao')
      tentativa = 0
      falhasSeguidas = 0
      semPar = false
    } else if (e === 'caiu' && !agenda.ativo('queda')) {
      agenda.porMotivo(
        'queda',
        () => {
          if (sessao !== s || s.estado === 'conectado') return
          fecharSessao()
          void oferecer()
        },
        ESPERA_DA_QUEDA_MS,
      )
    }
    atualizar()
  }

  function aceitarResposta(id: string, sdp: string, remetente: string): void {
    const s = sessao
    if (s === null || s.id !== id || !s.aguardandoResposta) return
    s.aguardandoResposta = false
    s.par = remetente
    semPar = false
    agenda.cancelar('resposta')
    agenda.porMotivo(
      'conexao',
      () => {
        if (sessao === s && s.estado !== 'conectado') falhar(true)
      },
      ESPERA_DA_CONEXAO_MS,
    )
    s.conexao.aceitarResposta(sdp).catch(() => {
      if (sessao === s) falhar(false)
    })
    atualizar()
  }

  function aoSinal(s: SinalDaObs, remetente: string): void {
    if (d.revogado(remetente)) return
    if (s.tipo === 'resposta') {
      aceitarResposta(s.sessao, s.sdp, remetente)
    } else if (s.tipo === 'pronto') {
      const atual = sessao
      if (atual !== null && atual.par !== null && atual.par !== remetente) {
        // VER-056, I2: só o `obs_camera` atual manda `pronto` (o banco escolhe o destino e põe o remetente); outro remetente
        // prova que o par mudou, mesmo sem o aviso `revogacao`. Fecha com o par antigo e oferece de novo (como `revogarPar`).
        fecharSessao()
        pedirOferta()
        atualizar()
      } else if (!pendente() && podeOferecer()) pedirOferta()
    } else {
      const atual = sessao
      if (atual === null || atual.id !== s.sessao || (atual.par !== null && atual.par !== remetente)) return
      fecharSessao()
      semPar = true
      atualizar()
    }
  }

  function aoMudarCanal(e: EstadoDoCanal): void {
    const antes = canal
    canal = e
    if (e === 'conectado' && antes !== 'conectado' && !pendente() && podeOferecer()) pedirOferta()
  }

  function desligarCamera(): void {
    faixa = null
    faixaPerdida = false
    d.camera.desligar()
  }

  /** Liga (ou religa, com a faixa perdida) a câmera; uma ligação por vez. */
  function ligarCamera(religando: boolean): Promise<void> {
    if (ligacao !== null) return ligacao
    ligacao = (async () => {
      let r: Awaited<ReturnType<CameraDoAparelho['ligar']>>
      try {
        r = await d.camera.ligar()
      } catch {
        r = { ok: false, motivo: 'outro' }
      }
      ligacao = null
      await tratarCamera(r, religando)
    })()
    return ligacao
  }

  async function tratarCamera(r: Awaited<ReturnType<CameraDoAparelho['ligar']>>, religando: boolean): Promise<void> {
    if (parado || !episodio || !consentido) {
      if (r.ok) d.camera.desligar()
      return
    }
    if (!r.ok) {
      if (r.motivo === 'outro' && religando) {
        faixaPerdida = true // a página pode estar escondida: tenta de novo em voltarAVer
        return
      }
      consentido = false
      falhaDaCamera = r.motivo === 'outro' ? null : r.motivo
      fecharSessao()
      cancelarEspera()
      desligarCamera()
      atualizar()
      return
    }
    faixa = r.faixa
    faixaPerdida = false
    falhaDaCamera = null
    const s = sessao
    if (s !== null) {
      let trocou: boolean
      try {
        trocou = await s.conexao.trocarFaixa(r.faixa)
      } catch {
        trocou = false
      }
      if (sessao !== s || trocou) return
      fecharSessao()
      void oferecer()
      return
    }
    if (!pendente() && podeOferecer()) pedirOferta()
    atualizar()
  }

  function aoPerderFaixa(): void {
    if (faixa === null) return
    faixaPerdida = true
    if (episodio && consentido) void ligarCamera(true)
  }

  const soltarSinal = d.canal.aoSinal((s, remetente) => agenda.depois(() => aoSinal(s, remetente)))
  const soltarCanal = d.canal.aoMudarEstado((e) => agenda.depois(() => aoMudarCanal(e)))
  const soltarCamera = d.camera.aoPerderFaixa(() => agenda.depois(aoPerderFaixa))
  atualizar()

  return {
    async ligarPeloToque() {
      if (parado) return
      consentido = true
      falhaDaCamera = null
      sinalGrande = false
      if (!episodio) {
        atualizar()
        return
      }
      if (faixa !== null && !faixaPerdida) {
        if (!pendente() && podeOferecer()) pedirOferta()
        atualizar()
        return
      }
      atualizar()
      await ligarCamera(faixaPerdida)
    },

    definirEpisodio(ativo) {
      if (parado || ativo === episodio) return
      episodio = ativo
      if (ativo) {
        sinalGrande = false
        tentativa = 0
        falhasSeguidas = 0
        semPar = false
        if (consentido) void ligarCamera(false)
        atualizar()
        return
      }
      const s = sessao
      if (s !== null) void enviar({ tipo: 'encerrar', sessao: s.id })
      fecharSessao()
      cancelarEspera()
      desligarCamera()
      atualizar()
    },

    revogarPar(usuario) {
      if (parado || sessao === null || sessao.par !== usuario) return
      fecharSessao()
      pedirOferta()
      atualizar()
    },

    voltarAVer() {
      if (parado || !faixaPerdida || !episodio || !consentido) return
      void ligarCamera(true)
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
      soltarCamera()
      faixa = null
      d.camera.desligar()
    },
  }
}
