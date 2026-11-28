import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Revogados } from '../../domains/aovivo/mensagens'
import type { CanalDeVideo, FluxoDeVideo } from '../../domains/captura/portas'
import { criarReceptorDeVideo } from '../../domains/captura/receptor'
import type { EstadoDoVideo, SinalDaCamera, SinalDaObs, SituacaoDoVideo } from '../../domains/captura/sinais'
import { SELO_VISIVEL_MS } from '../../domains/obs/saida'
import { criarCanalComutavel } from '../canalDeVideoComutavel'
import { REABRIR_CANAIS_MS, esperaDaReabertura } from '../canais'
import type { ServicosDoDispositivo } from '../servicos'
import { acompanharEstudio } from '../useDispositivo'
import type { DispositivoPareado } from '../useDispositivo'
import type { GuardaDaRota } from './TelaDeDispositivo'

/** As situações que o `/obs/camera` pode ter: as do receptor e a da Fonte sem WebRTC (publicada pela rota, VER-052). */
type EstadoDaObsCamera = 'aguardando_episodio' | 'aguardando_par' | 'conectando' | 'conectado' | 'sem_conexao_direta' | 'sinal_grande' | 'sem_video_direto'

/** A situação no selo; nenhuma frase vem do navegador, do servidor, do OBS ou do WebRTC. */
const FRASES_DO_SELO: Readonly<Record<EstadoDaObsCamera, string>> = Object.freeze({
  aguardando_episodio: 'Câmera do OBS · aguardando episódio',
  aguardando_par: 'Câmera do OBS · aguardando a câmera',
  conectando: 'Câmera do OBS · conectando',
  conectado: 'Câmera do OBS · vídeo chegando',
  sem_conexao_direta: 'Câmera do OBS · sem conexão direta',
  sinal_grande: 'Câmera do OBS · sinal grande demais para o canal',
  // a Fonte sem `RTCPeerConnection` (pendência do VER-052; F10: o OBS 30.2+ deveria ter): a rota publica a situação
  sem_video_direto: 'Câmera do OBS · esta Fonte não faz vídeo direto (WebRTC)',
})

/** Frases fixas do selo do `/obs/camera` (tecla `s`, 5 s; D8); o rótulo do dispositivo vai como texto do React. */
export const TEXTO_DA_OBS_CAMERA = Object.freeze({ ...FRASES_DO_SELO, pareado: (rotulo: string): string => `Pareado como ${rotulo}` })

/** A frase do selo para a situação; as do lado da câmera (toque, permissão...) nunca chegam aqui e valem "aguardando a câmera". */
function fraseDoSelo(e: EstadoDoVideo): string {
  return Object.hasOwn(FRASES_DO_SELO, e) ? FRASES_DO_SELO[e as EstadoDaObsCamera] : FRASES_DO_SELO.aguardando_par
}

interface Vista {
  estado: EstadoDoVideo
  /** O fluxo recebido, só com a conexão em `conectado` (o receptor o retira ao sair dele; D3, D8). */
  fluxo: FluxoDeVideo | null
  selo: boolean
}

/** O vídeo recebido: por `srcObject` (nunca por URL), mudo, com reprodução automática e dentro da página. */
function VideoRecebido({ fluxo }: { fluxo: FluxoDeVideo }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current
    if (video === null) return
    video.srcObject = fluxo as unknown as MediaStream // o adaptador guarda o `MediaStream` atrás do tipo opaco (D1)
    return () => {
      video.srcObject = null
    }
  }, [fluxo])
  return <video ref={ref} className="video-da-obs-camera" autoPlay muted playsInline />
}

/**
 * `/obs/camera` pareado (PLA-005, D3, D5, D8, D10, D13), dentro da Fonte de navegador do OBS, que vai ao ar:
 * - **Só o vídeo (D8):** um `<video autoplay muted playsinline>` em tela cheia **só** enquanto a conexão está em
 *   `conectado`; sem vídeo, nada (a Fonte fica transparente), em qualquer situação. Nenhuma frase fica na tela.
 * - **Selo (D8):** a tecla `s` mostra, por `SELO_VISIVEL_MS` (5 s), o rótulo e a situação ("Câmera do OBS · aguardando a
 *   câmera"...), só com a saída parada e o status conhecido, pela guarda da rota (`GuardaDaRota`, a mesma da
 *   `SoComSaidaParada` desde o VER-056, N2; a regra de `criarGuardaDaSaida`, a do palco); qualquer evento de saída fecha na
 *   hora, e a releitura a cada `SITUACAO_A_CADA_MS` (contada pela guarda) fecha se um evento faltar.
 * - **Episódio (D5):** `episodioAtivo()` ao conectar o `estudio` e no `episodio_ativo_mudou`; com episódio, abre o tópico
 *   da própria sessão (`video:<uid>`, `videoDaObs()`) por baixo do receptor (`criarCanalComutavel`); sem episódio, o
 *   receptor fecha e limpa o vídeo, e o canal fecha. Um `fechado` do canal de vídeo consulta de novo: sem episódio, fica
 *   fechado; com episódio, é o `canalPerdido` do `estudio`.
 * - **Vídeo negado (VER-056, I1):** um `negado` do canal de vídeo é o banco dizendo que o par deixou de valer (a câmera do
 *   par revogada; o próprio `obs_camera` revogado cai também pelo `estudio`): o receptor fecha a sessão **na hora**
 *   (`perderPar`, vídeo fora da Fonte) e o canal fecha. Sem episódio, fica fechado; com episódio, o `estudio` não é
 *   fechado nem o dispositivo reavaliado por isso: o tópico reabre pela espera crescente (`esperaDaReabertura`: 5, 10,
 *   20, 40, 60 s), ou na hora num `dispositivo_mudou`, `episodio_ativo_mudou` ou `revogacao` de outro (o repareamento);
 *   a contagem zera quando o vídeo volta (`conectado`) ou o episódio acaba.
 * - **Presença (D13):** `video` com a situação, coalescida pelo `acompanharEstudio` (no máximo a cada 10 s).
 * - **Revogação:** a própria → para tudo antes da tela de revogado (que só aparece com a saída parada); a do par (a
 *   câmera) → o receptor fecha a conexão com ela, e os sinais dela são descartados por 15 min (`Revogados`).
 * - **Sem WebRTC:** a situação fica em `sem_video_direto` (selo e presença), e o canal de vídeo não abre.
 */
export function ObsCameraNoAr({
  dispositivo,
  servicos,
  marcarRevogado,
  guarda,
}: {
  dispositivo: DispositivoPareado
  servicos: ServicosDoDispositivo
  marcarRevogado(): void
  /** A guarda da saída da rota, a mesma da `SoComSaidaParada` (VER-056, N2): os eventos de saída e as releituras vêm dela. */
  guarda: GuardaDaRota
}): ReactNode {
  const [vista, setVista] = useState<Vista>({ estado: 'aguardando_episodio', fluxo: null, selo: false })

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

    const revogados = new Revogados(() => Date.now())
    const videoDireto = servicos.aparelho.videoDireto()
    const comutavel = criarCanalComutavel<SinalDaObs, SinalDaCamera>()
    const situacao: SituacaoDoVideo = { estado: videoDireto ? 'aguardando_episodio' : 'sem_video_direto', telaLigada: null, bateria: null }
    let estudio: ReturnType<typeof acompanharEstudio> | null = null
    /** O `estudio` conectou e não caiu desde então: o canal de vídeo só abre com ele (a reabertura consulta de novo). */
    let estudioAberto = false
    /** Negações seguidas do tópico de vídeo com episódio (a espera da reabertura cresce com elas; VER-056, I1). */
    let negacoes = 0
    /** O tópico foi negado com episódio e espera a reabertura (um evento reabre na hora). */
    let videoNegado = false

    setVista({ estado: situacao.estado, fluxo: null, selo: false })

    /** Leva a situação ao selo e à presença (que só remarca o que mudou, no máximo a cada 10 s). */
    function publicar(): void {
      if (!vivo) return
      setVista((v) => (v.estado === situacao.estado ? v : { ...v, estado: situacao.estado }))
      estudio?.atualizarPresenca()
    }

    const receptor = criarReceptorDeVideo({
      canal: comutavel.canal,
      conexoes: servicos.conexoes,
      revogado: (u) => revogados.contem(u),
      novaSessao: () => crypto.randomUUID(),
      agendar,
      aoMudarSituacao: (e) => {
        if (!videoDireto) return // o receptor nunca recebe oferta sem WebRTC; a causa fica na situação
        if (e === 'conectado') negacoes = 0 // o par valeu: a próxima negação recomeça a espera de 5 s
        situacao.estado = e
        publicar()
      },
      aoVideo: (fluxo) => {
        if (vivo) setVista((v) => ({ ...v, fluxo }))
      },
    })

    // --- canal de vídeo (D5): só com episódio ativo ---
    let videoAberto: CanalDeVideo<SinalDaObs, SinalDaCamera> | null = null
    let soltarVideo: (() => void) | null = null
    let consulta = 0
    let cancelarNovaConsulta: (() => void) | null = null

    function abrirVideo(): void {
      if (videoAberto !== null || encerrado) return
      const c = servicos.canais(dispositivo.usuarioId).videoDaObs()
      videoAberto = c
      comutavel.ligar(c)
      soltarVideo = c.aoMudarEstado((e) => {
        if (!vivo || videoAberto !== c) return
        if (e === 'negado') {
          // o par deixou de valer: o vídeo sai da Fonte antes de qualquer consulta (VER-056, I1)
          receptor.perderPar()
          fecharVideo()
          void consultarEpisodio('negado')
        } else if (e === 'fechado') void consultarEpisodio('fechado')
      })
    }

    /** Fecha o canal de vídeo **depois** de o receptor ter mandado o que precisava (o `encerrar` do `parar`). */
    function fecharVideo(): void {
      soltarVideo?.()
      soltarVideo = null
      videoAberto = null
      void comutavel
        .desligar()
        ?.fechar()
        .catch(() => {})
    }

    /**
     * `perdido`: o canal de vídeo caiu. `fechado` com episódio é perda de canal como a do `estudio`; `negado` com episódio
     * espera a reabertura crescente, sem tocar no `estudio` (VER-056, I1).
     */
    async function consultarEpisodio(perdido: 'fechado' | 'negado' | null = null): Promise<void> {
      const minha = ++consulta
      cancelarNovaConsulta?.()
      cancelarNovaConsulta = null
      if (perdido === null) videoNegado = false
      let ep: { id: string } | null
      try {
        ep = await servicos.palco.episodioAtivo()
      } catch {
        if (minha === consulta) cancelarNovaConsulta = agendar(() => void consultarEpisodio(perdido), REABRIR_CANAIS_MS)
        return
      }
      if (!vivo || encerrado || minha !== consulta) return
      if (ep === null) {
        receptor.definirEpisodio(false) // fecha a conexão e limpa o vídeo
        fecharVideo()
        negacoes = 0
        videoNegado = false
        return
      }
      if (perdido === 'negado') {
        videoNegado = true
        cancelarNovaConsulta = agendar(() => void consultarEpisodio(), esperaDaReabertura(negacoes))
        negacoes += 1
        return
      }
      if (perdido === 'fechado') {
        fecharVideo()
        estudio?.canalPerdido()
        return
      }
      if (!videoDireto) return // nunca haverá conexão: nenhum canal de vídeo à toa
      if (!estudioAberto) return // `estudio` reabrindo: a volta a `conectado` consulta de novo
      abrirVideo()
      receptor.definirEpisodio(true)
    }

    // --- selo (D8): tecla `s`, 5 s, só com a saída parada e o status conhecido ---
    let geracaoDaSaida = 0
    let cancelarSelo: (() => void) | null = null
    let seloAberto = false

    function fecharSelo(): void {
      cancelarSelo?.()
      cancelarSelo = null
      seloAberto = false
      if (vivo) setVista((v) => (v.selo ? { ...v, selo: false } : v))
    }

    async function pedirSelo(): Promise<void> {
      const g = geracaoDaSaida
      const livre = await guarda.livre()
      if (!vivo || encerrado || !livre || g !== geracaoDaSaida) return
      cancelarSelo?.()
      cancelarSelo = agendar(() => {
        cancelarSelo = null
        seloAberto = false
        setVista((v) => ({ ...v, selo: false }))
      }, SELO_VISIVEL_MS)
      seloAberto = true
      setVista((v) => ({ ...v, selo: true }))
    }

    /** Defesa a mais (se um evento de saída do obs-browser faltar): a releitura periódica fecha o selo com a saída no ar ou o status desconhecido. */
    async function conferirSaidaComSelo(): Promise<void> {
      if (!seloAberto) return
      const livre = await guarda.livre()
      if (vivo && !livre) fecharSelo()
    }

    function aoTeclar(ev: KeyboardEvent): void {
      if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return
      if (ev.target instanceof Element && ev.target.closest('input, textarea, select, button') !== null) return
      if (ev.key.toLowerCase() === 's') void pedirSelo()
    }

    // --- fim de tudo (desmontagem, revogação) ---
    function encerrarTudo(): void {
      if (encerrado) return
      encerrado = true
      consulta++
      cancelarNovaConsulta?.()
      receptor.parar() // `encerrar` pelo canal ainda ligado (se ligado), conexão fechada, vídeo limpo
      fecharVideo()
      estudio?.parar()
      fecharSelo()
    }

    estudio = acompanharEstudio({
      tipo: 'obs_camera',
      dispositivo,
      servicos,
      presenca: () => ({ tipo: 'obs_camera', dispositivoId: dispositivo.id, obs: null, video: { ...situacao } }),
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
      aoDispositivoMudar: () => {
        if (videoNegado) void consultarEpisodio() // a câmera pode ter sido pareada de novo: reabre já
      },
      aoRevogarOutro: (usuario) => {
        revogados.revogar(usuario)
        receptor.revogarPar(usuario)
        if (videoNegado) void consultarEpisodio() // o repareamento avisa a sessão antiga da câmera: reabre já
      },
      aoFecharCanais: () => {
        estudioAberto = false
        consulta++ // uma consulta em curso não reabre o canal de vídeo
        cancelarNovaConsulta?.()
        cancelarNovaConsulta = null
        fecharVideo()
      },
    })

    const soltarSaida = guarda.aoMudarSaida(() => {
      geracaoDaSaida++
      fecharSelo()
    })
    const soltarReleitura = guarda.aoReler(() => {
      if (vivo) void conferirSaidaComSelo() // depois de a guarda contar a releitura
    })
    window.addEventListener('keydown', aoTeclar)

    return () => {
      encerrarTudo()
      vivo = false
      window.removeEventListener('keydown', aoTeclar)
      soltarSaida()
      soltarReleitura()
      for (const c of [...cancelamentos]) c()
    }
  }, [dispositivo, servicos, marcarRevogado, guarda])

  return (
    <div className="obs-camera-no-ar">
      {vista.fluxo !== null && <VideoRecebido fluxo={vista.fluxo} />}
      {vista.selo && (
        <p className="selo-do-palco" role="status">
          <span>{TEXTO_DA_OBS_CAMERA.pareado(dispositivo.rotulo)}</span>
          <span>{fraseDoSelo(vista.estado)}</span>
        </p>
      )}
    </div>
  )
}
