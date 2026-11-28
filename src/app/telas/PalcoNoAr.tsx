import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Revogados } from '../../domains/aovivo/mensagens'
import { criarPalco } from '../../domains/aovivo/palco'
import type { CanalDoControle, CanalDoEstado, EstadoDoCanal, RepositorioDoPalco } from '../../domains/aovivo/portas'
import { criarExecutorObs } from '../../domains/obs/executor'
import type { ExecutorObs } from '../../domains/obs/executor'
import type { MarcadorObs, ObsNoNavegador, ObsWebsocket } from '../../domains/obs/portas'
import { SELO_VISIVEL_MS, SITUACAO_A_CADA_MS, criarGuardaDaSaida } from '../../domains/obs/saida'
import type { ServicosDoDispositivo } from '../servicos'
import { REABRIR_CANAIS_MS } from '../canais'
import { acompanharEstudio } from '../useDispositivo'
import type { DispositivoPareado } from '../useDispositivo'

/** `SELO_VISIVEL_MS` (5 s, D16) e `SITUACAO_A_CADA_MS` (15 s) moram em `domains/obs/saida.ts` desde o VER-053 (a guarda é a mesma no `/obs/camera`). */
export { SELO_VISIVEL_MS, SITUACAO_A_CADA_MS }
/** O painel de configuração do websocket fecha sozinho em 2 min (D10). */
export const CONFIG_ABERTA_MS = 120_000
/** As URLs assinadas dos sons e das imagens (válidas por 1 h) são renovadas a cada 45 min (D16). */
export const RENOVAR_URLS_MS = 45 * 60_000
/** O obs-websocket que caiu (ou não respondeu) é tentado de novo a cada 10 s, no mesmo objeto (VER-039, I1). */
export const RECONECTAR_WS_MS = 10_000
/** Chave do armazenamento local da Fonte de navegador com a porta e a senha do obs-websocket (D10, DES-001 §8). */
export const CHAVE_DO_WEBSOCKET = 'revocast-obs-websocket'
export const PORTA_PADRAO = 4455

export const TEXTO_DO_PALCO = Object.freeze({
  aguardando: 'Palco · aguardando episódio',
  teste: (titulo: string) => `Modo teste: ${titulo}`,
  aoVivo: (titulo: string) => `Ao vivo: ${titulo}`,
  pareado: (rotulo: string) => `Pareado como ${rotulo}`,
  avisoDaConfig: 'Este painel aparece na transmissão: configure antes de ir ao ar.',
  tituloDaConfig: 'obs-websocket',
  senha: 'Senha do obs-websocket',
  dicaDaSenha: 'Em branco mantém a senha já salva.',
  porta: 'Porta',
  salvar: 'Salvar',
  portaInvalida: 'Porta inválida (de 1 a 65535).',
  naoSalvou: 'Não foi possível salvar neste navegador.',
} as const)

type Armazenamento = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Configuração salva do websocket, conferida (porta de 1 a 65535, senha em texto); fora da forma ou ilegível → `null`. */
export function lerConfiguracaoDoWebsocket(a: Armazenamento): { porta: number; senha: string } | null {
  let texto: string | null
  try {
    texto = a.getItem(CHAVE_DO_WEBSOCKET)
  } catch {
    return null
  }
  if (texto === null) return null
  try {
    const o: unknown = JSON.parse(texto)
    if (typeof o !== 'object' || o === null) return null
    const { porta, senha } = o as Record<string, unknown>
    if (!portaValida(porta) || typeof senha !== 'string' || senha.length > 1000) return null
    return { porta, senha }
  } catch {
    return null
  }
}

function portaValida(p: unknown): p is number {
  return typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 65535
}

type Carga = Awaited<ReturnType<RepositorioDoPalco['carregar']>>
type EstadoDoWs = 'desligado' | 'senha_errada' | 'conectando' | 'conectado' | 'sem_conexao'

/** O que a tela mostra; tudo além do aviso só aparece pela tecla e com a saída parada (D10, D16). */
interface Vista {
  carga: Carga | null
  modo: 'ao_vivo' | 'teste' | null
  urls: Readonly<Record<string, string>>
  avisoId: string | null
  selo: boolean
  config: boolean
}

const VISTA_INICIAL: Vista = { carga: null, modo: null, urls: {}, avisoId: null, selo: false, config: false }

/**
 * O palco no ar, dentro da Fonte de navegador do OBS (D9, D10, D15, D16). Tudo o que fala com o mundo
 * fica no efeito (um controlador por montagem); o React só desenha a `Vista`:
 * - `estudio` por `acompanharEstudio` (presença com a `SituacaoDoObs`, `episodio_ativo_mudou`,
 *   `revogacao`, canal fechado ou negado → reavaliação);
 * - `episodioAtivo()` ao conectar (a primeira vez e a cada volta) e no aviso; com episódio: `carregar`,
 *   URLs assinadas (renovadas a cada 45 min), o `:controle` (comandos), o `:estado` (onde o palco publica o
 *   estado, VER-047), um executor e o serviço do palco; a troca de episódio para os dois (`palco.parar()` e
 *   `executor.parar()`, VER-039 N5) e fecha os dois tópicos antigos;
 * - a situação do OBS é relida de tempos em tempos e nos eventos de saída (presença e estado republicados
 *   quando muda); o websocket caído é percebido por `aoFechar` e reconectado no mesmo objeto;
 * - selo (tecla `s`, 5 s) e configuração do websocket (tecla `c`, 2 min) só com a saída parada e o status
 *   conhecido; qualquer evento de saída os fecha na hora.
 * Nenhum dado vira HTML: título, texto e link do aviso são texto React (o link nunca é `<a>`).
 */
export function PalcoNoAr({
  dispositivo,
  servicos,
  obs,
  criarWs,
  armazenamentoLocal,
  marcarRevogado,
}: {
  dispositivo: DispositivoPareado
  servicos: ServicosDoDispositivo
  obs: ObsNoNavegador
  criarWs: () => ObsWebsocket
  armazenamentoLocal: Armazenamento
  marcarRevogado(): void
}): ReactNode {
  const [vista, setVista] = useState<Vista>(VISTA_INICIAL)
  const [erroDaConfig, setErroDaConfig] = useState<string | null>(null)
  const audios = useRef(new Map<string, HTMLAudioElement>())
  const senhaRef = useRef<HTMLInputElement>(null)
  const portaRef = useRef<HTMLInputElement>(null)
  const controlador = useRef<{ salvarWebsocket(c: { porta: number; senha: string }): void } | null>(null)

  useEffect(() => {
    let vivo = true
    const mudar = (f: (v: Vista) => Vista) => {
      if (vivo) setVista(f)
    }
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
    function repetir(f: () => void, ms: number): () => void {
      const t = setInterval(() => {
        if (vivo) f()
      }, ms)
      const cancelar = () => {
        clearInterval(t)
        cancelamentos.delete(cancelar)
      }
      cancelamentos.add(cancelar)
      return cancelar
    }
    const revogados = new Revogados(() => Date.now())

    // --- obs-websocket (D10) ---
    let ws: ObsWebsocket | null = null
    let soltarQueda: (() => void) | null = null
    let estadoDoWs: EstadoDoWs = 'desligado'
    let tentativaDoWs = 0
    let cancelarReconexao: (() => void) | null = null

    /**
     * O websocket que o executor vê (a porta estreita `MarcadorObs`, VER-046 N1): sempre o mesmo objeto, que
     * delega ao obs-websocket real desta rota, se houver. Conectar, ouvir a queda e fechar são da rota
     * (`conectarWs`). A queda e a volta aparecem por `conectado()`, e o estado sem conexão (desligado, senha
     * recusada, sem conexão) pela função `estadoDoWebsocket`: nada no websocket recria o executor, o serviço
     * do palco ou o `:controle` (rodada 1: nada reinicia a sessão no ar).
     */
    const wsDoExecutor: MarcadorObs = {
      versao: () => ws?.versao() ?? Promise.resolve(null),
      marcar: (nome) => ws?.marcar(nome) ?? Promise.resolve(false),
      conectado: () => ws?.conectado() ?? false,
    }
    const estadoSemConexao = () => (estadoDoWs === 'desligado' ? 'desligado' : estadoDoWs === 'senha_errada' ? 'senha_errada' : 'sem_conexao')

    /** URLs assinadas já obtidas nesta sessão (a mesma informação da `Vista`, para quem roda fora do React). */
    let urlsAtuais: Record<string, string> = {}

    async function tocarSom(somId: string, volume: number): Promise<boolean> {
      let el = audios.current.get(somId)
      if (el === undefined || !el.getAttribute('src')) {
        // som relido agora (VER-046, I2): o `<audio>` (ou a URL dele) ainda não foi desenhado pelo React; toca por
        // um elemento avulso com a URL já assinada
        const som = sessao?.dados.sons.find((x) => x.id === somId)
        const url = som === undefined ? undefined : urlsAtuais[som.caminho]
        if (url === undefined) return false
        el = new Audio(url)
      }
      try {
        el.currentTime = 0
        el.volume = Math.min(1, Math.max(0, volume))
        await el.play()
        return true
      } catch {
        return false
      }
    }

    function criarExecutor(): ExecutorObs {
      return criarExecutorObs({
        obs,
        ws: wsDoExecutor,
        estadoDoWebsocket: estadoSemConexao,
        tocarSom,
        mostrarAviso: (id) => mudar((v) => ({ ...v, avisoId: id })),
        ocultarAviso: () => mudar((v) => ({ ...v, avisoId: null })),
        agendar: (f, ms) => {
          agendar(f, ms)
        },
      })
    }

    // --- sessão do episódio ---
    interface Sessao {
      episodio: { id: string; modo: 'ao_vivo' | 'teste' }
      dados: Carga
      canal: CanalDoControle
      /** `:estado` (VER-047): onde o palco publica o estado no ar. */
      canalDoEstado: CanalDoEstado
      executor: ExecutorObs
      palco: ReturnType<typeof criarPalco>
      soltar: (() => void)[]
    }
    const base = criarExecutor()
    let sessao: Sessao | null = null
    let consulta = 0
    let cancelarNovaConsulta: (() => void) | null = null
    const atual = (): ExecutorObs => sessao?.executor ?? base

    /** Assina as URLs dos arquivos da sessão; `soNovos`: só os que ainda não têm URL (depois de reler as listas). */
    async function renovarUrls(s: Sessao, soNovos = false): Promise<void> {
      const todos = [...s.dados.sons.map((x) => x.caminho), ...s.dados.avisos.flatMap((a) => (a.caminhoDaImagem === null ? [] : [a.caminhoDaImagem]))]
      const caminhos = soNovos ? todos.filter((c) => urlsAtuais[c] === undefined) : todos
      const pares = await Promise.all(
        caminhos.map(async (c) => {
          try {
            return [c, await servicos.palco.urlDoArquivo(c)] as const
          } catch {
            return null // fica a URL anterior (se houver); a próxima renovação tenta de novo
          }
        }),
      )
      if (!vivo || sessao !== s) return
      const novas: Record<string, string> = {}
      for (const p of pares) if (p !== null) novas[p[0]] = p[1]
      urlsAtuais = { ...urlsAtuais, ...novas }
      // um `<audio>` tocando não troca de `src` (a carga nova cortaria o som): a URL nova entra no fim dele
      for (const som of s.dados.sons) {
        const el = audios.current.get(som.id)
        const nova = novas[som.caminho]
        if (el === undefined || nova === undefined || el.paused || el.ended) continue
        delete novas[som.caminho]
        el.addEventListener(
          'ended',
          () => {
            if (vivo && sessao === s) mudar((v) => ({ ...v, urls: { ...v.urls, [som.caminho]: nova } }))
          },
          { once: true },
        )
      }
      mudar((v) => ({ ...v, urls: { ...v.urls, ...novas } }))
    }

    /**
     * Relê as listas do episódio da sessão (VER-046, I2): troca a carga da tela e assina as URLs dos arquivos
     * novos antes de devolver (um som relido já pode tocar). Falha ou sessão trocada → `null` (fica a anterior).
     */
    async function recarregarDados(s: Sessao): Promise<Carga | null> {
      let nova: Carga
      try {
        nova = await servicos.palco.carregar(s.episodio.id)
      } catch {
        return null
      }
      if (!vivo || sessao !== s) return null
      s.dados = nova
      mudar((v) => ({ ...v, carga: nova }))
      await renovarUrls(s, true)
      return vivo && sessao === s ? nova : null
    }

    function iniciarSessao(episodio: Sessao['episodio'], dados: Carga): void {
      const canais = servicos.canais(dispositivo.usuarioId)
      const canal = canais.controle(episodio.id)
      const canalDoEstado = canais.estado(episodio.id) // VER-047: o estado no ar num tópico próprio
      const executor = criarExecutor()
      let criada: Sessao | null = null // a releitura só é pedida depois de a sessão existir
      const palco = criarPalco({
        canal,
        canalDoEstado,
        repo: servicos.palco,
        executor,
        revogados,
        episodio,
        dados,
        meuUsuario: dispositivo.usuarioId,
        agendarRepeticao: repetir,
        recarregarDados: () => (criada === null ? Promise.resolve(null) : recarregarDados(criada)),
      })
      const s: Sessao = { episodio, dados, canal, canalDoEstado, executor, palco, soltar: [] }
      criada = s
      sessao = s
      // `:controle` e `:estado`: a volta de qualquer um a `conectado` republica; a perda de qualquer um fecha tudo
      // (`canalPerdido`, como o `estudio`) e a reabertura é a do `acompanharEstudio`
      const aoMudarCanal = (e: EstadoDoCanal) => {
        if (!vivo || sessao !== s) return
        if (e === 'conectado') palco.republicar()
        else if (e === 'fechado' || e === 'negado') estudio.canalPerdido()
      }
      s.soltar.push(
        canal.aoMudarEstado(aoMudarCanal),
        canalDoEstado.aoMudarEstado(aoMudarCanal),
        repetir(() => void renovarUrls(s), RENOVAR_URLS_MS),
      )
      urlsAtuais = {}
      mudar((v) => ({ ...v, carga: dados, modo: episodio.modo, urls: {}, avisoId: null }))
      void renovarUrls(s)
      void atualizarSituacao()
    }

    function pararSessao(): void {
      const s = sessao
      if (s === null) return
      sessao = null
      s.palco.parar()
      s.executor.parar()
      for (const f of s.soltar) f()
      void s.canal.fechar().catch(() => {})
      void s.canalDoEstado.fechar().catch(() => {})
      for (const el of audios.current.values()) {
        try {
          el.pause()
        } catch {
          /* jsdom e áudio sem fonte */
        }
      }
      urlsAtuais = {}
      mudar((v) => ({ ...v, carga: null, modo: null, urls: {}, avisoId: null }))
    }

    async function consultarEpisodio(): Promise<void> {
      const minha = ++consulta
      cancelarNovaConsulta?.()
      cancelarNovaConsulta = null
      const deNovo = () => {
        if (minha === consulta) cancelarNovaConsulta = agendar(() => void consultarEpisodio(), REABRIR_CANAIS_MS)
      }
      let ep: Sessao['episodio'] | null
      try {
        ep = await servicos.palco.episodioAtivo()
      } catch {
        deNovo()
        return
      }
      if (!vivo || minha !== consulta) return
      if (sessao !== null && ep !== null && sessao.episodio.id === ep.id && sessao.episodio.modo === ep.modo) {
        // mesmo episódio: republica e relê as listas, como o `/controle` e a aba Ao vivo em cada consulta (VER-046, I2)
        sessao.palco.republicar()
        void sessao.palco.recarregarListas()
        return
      }
      pararSessao()
      if (ep === null) return
      let dados: Carga
      try {
        dados = await servicos.palco.carregar(ep.id)
      } catch {
        deNovo()
        return
      }
      if (!vivo || minha !== consulta) return
      iniciarSessao(ep, dados)
    }

    // --- situação do OBS e presença ---
    /** A situação que a presença e o estado levaram por último (o executor lê o websocket na hora, então a comparação é com o publicado). */
    let situacaoPublicada = ''
    async function atualizarSituacao(): Promise<void> {
      const executor = atual()
      let depois: string
      try {
        depois = JSON.stringify(await executor.atualizarSituacao())
      } catch {
        return
      }
      if (!vivo || executor !== atual()) return
      // a cena do programa no OBS (getCurrentScene, com o nível conferido pelo executor) entra no estado (VER-044 A1, D9)
      sessao?.palco.definirCenaObs(executor.cenaAtual())
      if (depois === situacaoPublicada) return
      situacaoPublicada = depois
      estudio.atualizarPresenca()
      sessao?.palco.republicar()
    }

    /** O websocket mudou (conectando, conectado, caiu, senha recusada, desligado): só a situação muda; nada é recriado. */
    function mudarWs(novo: EstadoDoWs): void {
      estadoDoWs = novo
      void atualizarSituacao()
    }

    function reconectarDepois(): void {
      if (cancelarReconexao !== null) return
      cancelarReconexao = agendar(() => {
        cancelarReconexao = null
        conectarWs()
      }, RECONECTAR_WS_MS)
    }

    function conectarWs(): void {
      cancelarReconexao?.()
      cancelarReconexao = null
      const cfg = lerConfiguracaoDoWebsocket(armazenamentoLocal)
      const tentativa = ++tentativaDoWs
      if (cfg === null) {
        ws?.fechar()
        mudarWs('desligado')
        return
      }
      if (ws === null) {
        const novo = criarWs()
        ws = novo
        soltarQueda = novo.aoFechar(() => {
          if (!vivo) return
          mudarWs('sem_conexao')
          reconectarDepois()
        })
      }
      const alvo = ws
      mudarWs('conectando')
      void alvo.conectar(cfg).then(
        (r) => {
          if (!vivo || tentativa !== tentativaDoWs) return
          mudarWs(r)
          if (r === 'sem_conexao') reconectarDepois()
        },
        () => {
          if (vivo && tentativa === tentativaDoWs) {
            mudarWs('sem_conexao')
            reconectarDepois()
          }
        },
      )
    }

    // --- selo e configuração (D10, D16) ---
    let geracaoDaSaida = 0
    const guarda = criarGuardaDaSaida(obs)
    let cancelarSelo: (() => void) | null = null
    let cancelarConfig: (() => void) | null = null
    let seloAberto = false
    let configAberta = false

    function fecharSeloEConfig(): void {
      cancelarSelo?.()
      cancelarConfig?.()
      cancelarSelo = cancelarConfig = null
      seloAberto = configAberta = false
      mudar((v) => (v.selo || v.config ? { ...v, selo: false, config: false } : v))
    }

    async function pedir(qual: 'selo' | 'config'): Promise<void> {
      const g = geracaoDaSaida
      const livre = await guarda.livre()
      if (!vivo || !livre || g !== geracaoDaSaida) return
      if (qual === 'selo') {
        cancelarSelo?.()
        cancelarSelo = agendar(() => {
          cancelarSelo = null
          seloAberto = false
          mudar((v) => ({ ...v, selo: false }))
        }, SELO_VISIVEL_MS)
        seloAberto = true
        mudar((v) => ({ ...v, selo: true }))
      } else {
        cancelarConfig?.()
        cancelarConfig = agendar(() => {
          cancelarConfig = null
          configAberta = false
          mudar((v) => ({ ...v, config: false }))
        }, CONFIG_ABERTA_MS)
        configAberta = true
        mudar((v) => ({ ...v, config: true }))
      }
    }

    /** Defesa a mais (se um evento de saída do obs-browser faltar): a releitura periódica também fecha selo e painel com a saída no ar ou o status desconhecido. */
    async function conferirSaidaComAberto(): Promise<void> {
      if (!seloAberto && !configAberta) return
      const livre = await guarda.livre()
      if (vivo && !livre) fecharSeloEConfig()
    }

    function aoTeclar(ev: KeyboardEvent): void {
      if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return
      if (ev.target instanceof Element && ev.target.closest('input, textarea, select, button') !== null) return
      const tecla = ev.key.toLowerCase()
      if (tecla === 's') void pedir('selo')
      else if (tecla === 'c') void pedir('config')
    }

    // --- montagem ---
    const estudio = acompanharEstudio({
      tipo: 'obs_palco',
      dispositivo,
      servicos,
      presenca: () => ({ tipo: 'obs_palco', dispositivoId: dispositivo.id, obs: atual().situacao() }),
      // a janela de 10 s da presença (D13 do PLA-005) é da situação do vídeo; o palco já só remarca quando a situação
      // do OBS muda (`situacaoPublicada`) e segue como na E3, marcando na hora (VER-052)
      presencaMinimaMs: 0,
      marcarRevogado,
      agendar,
      aoConectar: () => void consultarEpisodio(),
      aoEpisodioMudar: () => void consultarEpisodio(),
      aoRevogarOutro: (usuario) => revogados.revogar(usuario),
      aoFecharCanais: () => {
        consulta++ // uma consulta em curso não reabre o `:controle` nem o `:estado`
        cancelarNovaConsulta?.()
        cancelarNovaConsulta = null
        pararSessao()
      },
    })
    const soltarSaida = obs.aoMudarSaida((tipo, saida) => {
      guarda.evento(tipo, saida)
      geracaoDaSaida++
      fecharSeloEConfig()
      void atualizarSituacao()
    })
    // cena trocada à mão no OBS (obsSceneChanged): relê a situação, que traz a cena atual (VER-046, A1)
    const soltarCena = obs.aoMudarCena(() => void atualizarSituacao())
    window.addEventListener('keydown', aoTeclar)
    repetir(() => {
      guarda.contarReleitura()
      void atualizarSituacao()
      void conferirSaidaComAberto()
    }, SITUACAO_A_CADA_MS)
    conectarWs()
    void atualizarSituacao()

    controlador.current = {
      salvarWebsocket(c) {
        ws?.fechar()
        try {
          armazenamentoLocal.setItem(CHAVE_DO_WEBSOCKET, JSON.stringify(c))
        } catch {
          setErroDaConfig(TEXTO_DO_PALCO.naoSalvou)
          return
        }
        fecharSeloEConfig()
        conectarWs()
      },
    }

    return () => {
      vivo = false
      controlador.current = null
      window.removeEventListener('keydown', aoTeclar)
      soltarSaida()
      soltarCena()
      estudio.parar()
      pararSessao()
      soltarQueda?.()
      ws?.fechar()
      for (const c of [...cancelamentos]) c()
    }
  }, [dispositivo, servicos, obs, criarWs, armazenamentoLocal, marcarRevogado])

  // o painel fechado leva junto o aviso de erro (e a senha digitada, que só existia no campo)
  useEffect(() => {
    if (!vista.config) setErroDaConfig(null)
  }, [vista.config])

  function salvar(ev: FormEvent<HTMLFormElement>): void {
    ev.preventDefault()
    const porta = Number(portaRef.current?.value ?? '')
    if (!portaValida(porta)) {
      setErroDaConfig(TEXTO_DO_PALCO.portaInvalida)
      return
    }
    const digitada = senhaRef.current?.value ?? ''
    if (senhaRef.current) senhaRef.current.value = ''
    const senha = digitada !== '' ? digitada : (lerConfiguracaoDoWebsocket(armazenamentoLocal)?.senha ?? '')
    controlador.current?.salvarWebsocket({ porta, senha })
  }

  const { carga, urls, avisoId, modo } = vista
  const aviso = carga !== null && avisoId !== null ? (carga.avisos.find((a) => a.id === avisoId) ?? null) : null
  const urlDaImagem = aviso?.caminhoDaImagem ? urls[aviso.caminhoDaImagem] : undefined
  const portaSalva = vista.config ? (lerConfiguracaoDoWebsocket(armazenamentoLocal)?.porta ?? PORTA_PADRAO) : PORTA_PADRAO

  return (
    <div className="palco-no-ar">
      {aviso !== null && (
        <section className="aviso-no-ar" aria-live="polite">
          <h2 className="aviso-no-ar__titulo">{aviso.titulo}</h2>
          {aviso.texto !== '' && <p className="aviso-no-ar__texto">{aviso.texto}</p>}
          {aviso.link !== null && aviso.link !== '' && <p className="aviso-no-ar__link">{aviso.link}</p>}
          {urlDaImagem !== undefined && <img className="aviso-no-ar__imagem" src={urlDaImagem} alt="" />}
        </section>
      )}
      {vista.selo && (
        <p className="selo-do-palco" role="status">
          <span>{TEXTO_DO_PALCO.pareado(dispositivo.rotulo)}</span>
          <span>{carga === null ? TEXTO_DO_PALCO.aguardando : modo === 'teste' ? TEXTO_DO_PALCO.teste(carga.episodio.titulo) : TEXTO_DO_PALCO.aoVivo(carga.episodio.titulo)}</span>
        </p>
      )}
      {vista.config && (
        <form className="config-do-palco" onSubmit={salvar} noValidate>
          <p className="config-do-palco__aviso" role="alert">{TEXTO_DO_PALCO.avisoDaConfig}</p>
          <h2>{TEXTO_DO_PALCO.tituloDaConfig}</h2>
          <label className="campo">
            <span>{TEXTO_DO_PALCO.senha}</span>
            <input ref={senhaRef} type="password" autoComplete="off" defaultValue="" />
          </label>
          <p className="config-do-palco__dica">{TEXTO_DO_PALCO.dicaDaSenha}</p>
          <label className="campo campo--curto">
            <span>{TEXTO_DO_PALCO.porta}</span>
            <input ref={portaRef} type="number" inputMode="numeric" min={1} max={65535} defaultValue={portaSalva} />
          </label>
          {erroDaConfig !== null && <p className="mensagem mensagem--erro" role="alert">{erroDaConfig}</p>}
          <button type="submit" className="botao">{TEXTO_DO_PALCO.salvar}</button>
        </form>
      )}
      {carga?.sons.map((som) => (
        <audio
          key={som.id}
          preload="auto"
          src={urls[som.caminho]}
          ref={(el) => {
            if (el === null) audios.current.delete(som.id)
            else audios.current.set(som.id, el)
          }}
        />
      ))}
    </div>
  )
}
