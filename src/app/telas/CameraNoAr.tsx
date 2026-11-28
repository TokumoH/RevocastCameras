import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Revogados } from '../../domains/aovivo/mensagens'
import { criarEmissorDeVideo } from '../../domains/captura/emissor'
import type { CanalDeVideo, FluxoDeVideo } from '../../domains/captura/portas'
import type { EstadoDoVideo, SinalDaCamera, SinalDaObs, SituacaoDoVideo } from '../../domains/captura/sinais'
import { criarCanalComutavel } from '../canalDeVideoComutavel'
import { REABRIR_CANAIS_MS } from '../canais'
import type { Dependencias } from '../dependencias'
import type { ServicosDoDispositivo } from '../servicos'
import { acompanharEstudio } from '../useDispositivo'
import type { DispositivoPareado } from '../useDispositivo'
import { FRASE_SEM_CONEXAO_DIRETA, TEXTO_SEM_TRAVA } from './textosDoVideo'

/** Depois de um toque, o status (situação, tela ligada, bateria) fica na tela por 3 s (D7, DES-001 §9). */
export const STATUS_VISIVEL_MS = 3000
/** A prévia (a imagem da câmera no próprio celular, para enquadrar) some sozinha em 15 s (D7). */
export const PREVIA_MS = 15_000

/**
 * Frases fixas do `/camera` (D6, D7; DES-001 §10.4, item 3). Nenhuma vem do navegador, do servidor ou do WebRTC, e nenhuma
 * leva dado recebido; a bateria é o único número, lido do aparelho. As duas que a aba Ao vivo também mostra (sem conexão
 * direta e sem a trava de tela) moram em `textosDoVideo.ts` desde o VER-056 (N4): a aba não importa mais esta rota.
 */
export const TEXTO_DA_CAMERA = Object.freeze({
  aguardando_toque: 'Toque para ligar a câmera.',
  aguardando_episodio: 'Câmera desligada: nenhum episódio no ar nem em teste.',
  aguardando_par: 'Procurando o computador do OBS…',
  conectando: 'Conectando ao OBS…',
  conectado: 'Vídeo chegando ao OBS.',
  sem_conexao_direta: FRASE_SEM_CONEXAO_DIRETA,
  sem_permissao: 'Permita o uso da câmera para este site e toque de novo.',
  sem_camera: 'Nenhuma câmera traseira encontrada neste aparelho.',
  inseguro: 'A câmera só funciona pelo endereço https do app.',
  sinal_grande: 'O vídeo deste aparelho gera um sinal grande demais para o canal. Anote o modelo do aparelho e o navegador.',
  /** Navegador sem `RTCPeerConnection` (VER-052; Riscos do VER-051; rodada 1, I2): a câmera não liga; a rota publica a situação. */
  sem_video_direto: 'Este navegador não faz vídeo direto (WebRTC). Abra o link num navegador atualizado.',
  semTrava: TEXTO_SEM_TRAVA,
  bateria: (porcento: number): string => `Bateria: ${porcento}%`,
  previa: 'Prévia',
  esconder: 'Esconder',
  /** Rótulos (leitor de tela) da área de toque do tamanho da tela. */
  ligar: 'Ligar a câmera',
  mostrar: 'Mostrar a situação da câmera',
})

/** Situações que pedem ação de quem está com o celular: a frase fica na tela, e o toque tenta ligar a câmera de novo. */
const PEDEM_TOQUE: ReadonlySet<EstadoDoVideo> = new Set(['aguardando_toque', 'sem_permissao', 'sem_camera', 'inseguro', 'sinal_grande'])
/** Situações escritas na tela sem toque: as que pedem ação e a do navegador sem WebRTC (que nenhum toque resolve). */
const PERMANENTES: ReadonlySet<EstadoDoVideo> = new Set([...PEDEM_TOQUE, 'sem_video_direto'])
/** Situações de problema (ponto rosa); `conectado` é ciano; o resto (esperas), cinza. */
const PROBLEMAS: ReadonlySet<EstadoDoVideo> = new Set(['sem_conexao_direta', 'sem_permissao', 'sem_camera', 'inseguro', 'sinal_grande', 'sem_video_direto'])

interface Vista extends SituacaoDoVideo {
  /** A câmera tem fluxo ligado (a prévia pode aparecer). */
  temFluxo: boolean
}

const VISTA_INICIAL: Vista = { estado: 'aguardando_toque', telaLigada: null, bateria: null, temFluxo: false }

/** A prévia: o mesmo fluxo da câmera (sem segundo `getUserMedia`), por `srcObject`, mudo e dentro da página (iPhone). */
function Previa({ fluxo }: { fluxo: FluxoDeVideo }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current
    if (video === null) return
    video.srcObject = fluxo as unknown as MediaStream // o adaptador guarda o `MediaStream` atrás do tipo opaco (D1)
    return () => {
      video.srcObject = null
    }
  }, [fluxo])
  return <video ref={ref} className="previa-da-camera" autoPlay muted playsInline />
}

/**
 * `/camera` pareado (PLA-005, D5–D7, D10, D13): tela preta com um ponto discreto; o celular é a lente, não a tela.
 * - **Consentimento (D7):** a câmera só liga depois de um toque na área do tamanho da tela; o Wake Lock é pedido no
 *   mesmo toque e de novo ao voltar a ver a página; sem ele, as instruções do DES-001 §10.4 ficam na tela.
 * - **Episódio (D5):** `episodioAtivo()` ao conectar o `estudio`, no `episodio_ativo_mudou` e ao voltar a ver; com
 *   episódio, abre o tópico da própria sessão (`video:<uid>`) por baixo do emissor (`criarCanalComutavel`) e o emissor
 *   liga e oferece; sem episódio, o emissor manda o `encerrar`, fecha a conexão e desliga a câmera, e só depois o canal
 *   fecha. Um `fechado`/`negado` do canal de vídeo consulta o episódio de novo: sem episódio, fica fechado; com episódio,
 *   é o `canalPerdido` do `estudio` (reavalia e reabre em 5 s). Aqui o `negado` com episódio fica assim de propósito
 *   (VER-056, I1): o tópico da câmera só depende dela mesma (a migração da E4 confere a própria câmera, não revogada, e não
 *   o `obs_camera`), então a negação quer dizer que este aparelho foi revogado ou trocado, e a reavaliação leva à tela de
 *   revogado, sem laço. O laço do I1 era só do `/obs/camera`, cujo tópico depende da câmera do par.
 * - **Tela (D7, D10):** nenhuma imagem fora da prévia pedida, que some em 15 s; o toque mostra o status por 3 s; as
 *   situações que pedem ação ficam escritas; nada vem do servidor (frases fixas, texto do React).
 * - **Presença (D13):** `video` com a situação, coalescida pelo `acompanharEstudio` (no máximo a cada 10 s).
 * - **Revogação:** a própria → desliga tudo antes da tela de revogado; a do par → o emissor fecha a conexão com ele, e
 *   os sinais dele são descartados por 15 min (`Revogados`).
 * - **Saída:** desmontar e `pagehide` desligam tudo (com o `encerrar`); a página restaurada do cache de navegação
 *   (`pageshow` com `persisted`) recomeça do zero e pede o toque de novo.
 */
export function CameraNoAr({
  dispositivo,
  servicos,
  marcarRevogado,
  aoVoltarAVer,
  agora,
}: {
  dispositivo: DispositivoPareado
  servicos: ServicosDoDispositivo
  marcarRevogado(): void
  aoVoltarAVer: Dependencias['aoVoltarAVer']
  agora?: () => number
}): ReactNode {
  const [vista, setVista] = useState<Vista>(VISTA_INICIAL)
  const [statusVisivel, setStatusVisivel] = useState(false)
  const [previa, setPrevia] = useState<FluxoDeVideo | null>(null)
  const [geracao, setGeracao] = useState(0)
  const controle = useRef<{ tocar(): void; abrirPrevia(): void; esconderPrevia(): void } | null>(null)

  useEffect(() => {
    let vivo = true
    let encerrado = false
    const cancelamentos = new Set<() => void>()
    function agendar(f: () => void, ms: number): () => void {
      const t = setTimeout(() => {
        cancelamentos.delete(cancelar)
        if (vivo) f()
      }, ms)
      const cancelar = () => {
        clearTimeout(t)
        cancelamentos.delete(cancelar)
      }
      cancelamentos.add(cancelar)
      return cancelar
    }

    const revogados = new Revogados(agora ?? (() => Date.now()))
    const camera = servicos.aparelho.camera()
    const tela = servicos.aparelho.tela()
    const videoDireto = servicos.aparelho.videoDireto()
    const comutavel = criarCanalComutavel<SinalDaCamera, SinalDaObs>()
    // sem WebRTC, a situação fica em `sem_video_direto` para sempre (a tela e a presença mostram a causa; rodada 1, I2)
    const situacao: SituacaoDoVideo = { estado: videoDireto ? 'aguardando_toque' : 'sem_video_direto', telaLigada: null, bateria: null }
    let estudio: ReturnType<typeof acompanharEstudio> | null = null
    /** O `estudio` conectou e não caiu desde então: o canal de vídeo só abre com ele (a reabertura consulta de novo). */
    let estudioAberto = false
    let toqueDado = false

    setVista({ ...VISTA_INICIAL, estado: situacao.estado })
    setStatusVisivel(false)
    setPrevia(null)

    /** Leva a situação à tela e à presença (que só remarca o que mudou, no máximo a cada 10 s). */
    function publicar(): void {
      if (!vivo) return
      const fluxo = camera.fluxoDaPrevia()
      setVista({ ...situacao, temFluxo: fluxo !== null })
      // a prévia acompanha o fluxo: some com a câmera desligada
      setPrevia((p) => (p === null ? null : fluxo))
      estudio?.atualizarPresenca()
    }

    const emissor = criarEmissorDeVideo({
      canal: comutavel.canal,
      conexoes: servicos.conexoes,
      camera,
      revogado: (u) => revogados.contem(u),
      novaSessao: () => crypto.randomUUID(),
      agendar,
      aoMudarSituacao: (e) => {
        if (!videoDireto) return // o emissor nunca liga sem WebRTC; a causa fica na situação
        situacao.estado = e
        publicar()
      },
    })

    // --- canal de vídeo (D5): só com episódio ativo ---
    let videoAberto: CanalDeVideo<SinalDaCamera, SinalDaObs> | null = null
    let soltarVideo: (() => void) | null = null
    let consulta = 0
    let cancelarNovaConsulta: (() => void) | null = null

    function abrirVideo(): void {
      if (videoAberto !== null || encerrado) return
      const c = servicos.canais(dispositivo.usuarioId).videoDaCamera()
      videoAberto = c
      comutavel.ligar(c)
      soltarVideo = c.aoMudarEstado((e) => {
        if (!vivo || videoAberto !== c) return
        if (e === 'fechado' || e === 'negado') void consultarEpisodio(true)
      })
    }

    /** Fecha o canal de vídeo **depois** de o emissor ter mandado o que precisava (o `encerrar`). */
    function fecharVideo(): void {
      soltarVideo?.()
      soltarVideo = null
      videoAberto = null
      void comutavel
        .desligar()
        ?.fechar()
        .catch(() => {})
    }

    /** `perdido`: o canal de vídeo caiu (`fechado`/`negado`); com episódio, é perda de canal como a do `estudio`. */
    async function consultarEpisodio(perdido = false): Promise<void> {
      const minha = ++consulta
      cancelarNovaConsulta?.()
      cancelarNovaConsulta = null
      let ep: { id: string } | null
      try {
        ep = await servicos.palco.episodioAtivo()
      } catch {
        if (minha === consulta) cancelarNovaConsulta = agendar(() => void consultarEpisodio(perdido), REABRIR_CANAIS_MS)
        return
      }
      if (!vivo || encerrado || minha !== consulta) return
      if (ep === null) {
        emissor.definirEpisodio(false) // o `encerrar` sai pelo canal ainda ligado
        fecharVideo()
        return
      }
      if (perdido) {
        fecharVideo()
        estudio?.canalPerdido()
        return
      }
      if (!videoDireto) return // nunca haverá oferta: nenhum canal de vídeo à toa (rodada 1, N2)
      if (!estudioAberto) return // `estudio` reabrindo (ou o dispositivo em reavaliação): a volta a `conectado` consulta de novo
      abrirVideo()
      emissor.definirEpisodio(true)
    }

    // --- tela ligada e bateria ---
    async function travar(): Promise<void> {
      let r: 'travada' | 'sem_trava'
      try {
        r = await tela.travar()
      } catch {
        r = 'sem_trava'
      }
      if (encerrado) return
      situacao.telaLigada = r
      publicar()
    }

    async function lerBateria(): Promise<void> {
      let b: number | null
      try {
        b = await servicos.aparelho.bateria()
      } catch {
        b = null
      }
      if (encerrado) return
      situacao.bateria = b
      publicar()
    }

    // --- fim de tudo (desmontagem, `pagehide`, revogação) ---
    function encerrarTudo(): void {
      if (encerrado) return
      encerrado = true
      consulta++
      cancelarNovaConsulta?.()
      emissor.parar() // `encerrar` pelo canal ainda ligado, conexão fechada, câmera desligada
      fecharVideo()
      estudio?.parar()
      tela.soltar()
      setStatusVisivel(false)
      setPrevia(null)
    }

    estudio = acompanharEstudio({
      tipo: 'camera',
      dispositivo,
      servicos,
      presenca: () => ({ tipo: 'camera', dispositivoId: dispositivo.id, obs: null, video: { ...situacao } }),
      marcarRevogado: () => {
        encerrarTudo()
        marcarRevogado()
      },
      agendar,
      aoConectar: () => {
        estudioAberto = true
        void consultarEpisodio()
      },
      aoEpisodioMudar: () => void consultarEpisodio(),
      aoRevogarOutro: (usuario) => {
        revogados.revogar(usuario)
        emissor.revogarPar(usuario)
      },
      aoFecharCanais: () => {
        estudioAberto = false
        consulta++ // uma consulta em curso não reabre o canal de vídeo
        cancelarNovaConsulta?.()
        cancelarNovaConsulta = null
        fecharVideo()
      },
    })

    // --- toque, status e prévia ---
    let cancelarStatus: (() => void) | null = null
    let cancelarPrevia: (() => void) | null = null

    controle.current = {
      tocar() {
        if (encerrado) return
        cancelarStatus?.()
        setStatusVisivel(true)
        cancelarStatus = agendar(() => {
          cancelarStatus = null
          setStatusVisivel(false)
        }, STATUS_VISIVEL_MS)
        void lerBateria()
        if (!videoDireto) return
        toqueDado = true
        if (situacao.telaLigada !== 'travada') void travar()
        if (PEDEM_TOQUE.has(situacao.estado)) void emissor.ligarPeloToque().then(publicar)
        else publicar()
      },
      abrirPrevia() {
        const fluxo = camera.fluxoDaPrevia()
        if (encerrado || fluxo === null) return
        setPrevia(fluxo)
        cancelarPrevia?.()
        cancelarPrevia = agendar(() => {
          cancelarPrevia = null
          setPrevia(null)
        }, PREVIA_MS)
      },
      esconderPrevia() {
        cancelarPrevia?.()
        cancelarPrevia = null
        setPrevia(null)
      },
    }

    const soltarVolta = aoVoltarAVer(() => {
      if (!vivo || encerrado) return
      if (toqueDado) void travar() // o navegador solta o Wake Lock com a página escondida (F7)
      emissor.voltarAVer()
      void consultarEpisodio()
    })
    const aoEsconder = () => encerrarTudo()
    const aoMostrar = (ev: Event) => {
      if ((ev as PageTransitionEvent).persisted && encerrado) setGeracao((g) => g + 1)
    }
    window.addEventListener('pagehide', aoEsconder)
    window.addEventListener('pageshow', aoMostrar)

    return () => {
      encerrarTudo()
      vivo = false
      controle.current = null
      soltarVolta()
      window.removeEventListener('pagehide', aoEsconder)
      window.removeEventListener('pageshow', aoMostrar)
      for (const c of [...cancelamentos]) c()
    }
  }, [dispositivo, servicos, marcarRevogado, aoVoltarAVer, agora, geracao])

  const frase = TEXTO_DA_CAMERA[vista.estado]
  const pedeToque = PEDEM_TOQUE.has(vista.estado)
  const cor = PROBLEMAS.has(vista.estado) ? 'rosa' : vista.estado === 'conectado' ? 'ciano' : 'cinza'
  const fraseVisivel = PERMANENTES.has(vista.estado) || statusVisivel || previa !== null
  const comStatus = statusVisivel || previa !== null

  return (
    <main className="tela-preta">
      <button
        type="button"
        className="toque-da-camera"
        aria-label={pedeToque ? TEXTO_DA_CAMERA.ligar : TEXTO_DA_CAMERA.mostrar}
        onClick={() => controle.current?.tocar()}
      />
      {/* a coluna rola quando não cabe (celular deitado com as barras do navegador) e, por isso, fica por cima da área de
          toque: o toque nela, fora dos botões, vale como toque na tela (VER-052, rodada 2, R2-N1); o botão de baixo segue
          para o teclado e o leitor de tela */}
      <div
        className="camera-no-ar"
        onClick={(ev) => {
          if (!(ev.target instanceof Element && ev.target.closest('button') !== null)) controle.current?.tocar()
        }}
      >
        <span className={`ponto-da-camera ponto-da-camera--${cor}`} role="img" aria-label={frase} />
        {fraseVisivel && (
          <p className="status-da-camera" role="status">
            {frase}
          </p>
        )}
        {comStatus && vista.bateria !== null && <p className="status-da-camera">{TEXTO_DA_CAMERA.bateria(Math.round(vista.bateria * 100))}</p>}
        {vista.telaLigada === 'sem_trava' && previa === null && (
          <div className="status-da-camera status-da-camera--instrucoes">
            <p>{TEXTO_DA_CAMERA.semTrava.titulo}</p>
            <p>{TEXTO_DA_CAMERA.semTrava.iphone}</p>
            <p>{TEXTO_DA_CAMERA.semTrava.android}</p>
          </div>
        )}
        {previa !== null ? (
          <>
            <Previa fluxo={previa} />
            <button type="button" className="botao-da-camera" onClick={() => controle.current?.esconderPrevia()}>
              {TEXTO_DA_CAMERA.esconder}
            </button>
          </>
        ) : (
          statusVisivel &&
          vista.temFluxo && (
            <button type="button" className="botao-da-camera" onClick={() => controle.current?.abrirPrevia()}>
              {TEXTO_DA_CAMERA.previa}
            </button>
          )
        )}
      </div>
    </main>
  )
}
