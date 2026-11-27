import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, ReactNode } from 'react'
import type { UsuarioDaSessao } from '../../domains/acesso/sessao'
import { enviarMidia, excluirMidia } from '../../domains/preparacao/biblioteca'
import { GESTOS } from '../../domains/preparacao/gestos'
import type { LinhaDoMapa } from '../../domains/preparacao/gestos'
import { BYTES_PARA_DETECTAR, conferirSom, nomeDeExibicao, TIPOS_ACEITOS, usoDaBiblioteca } from '../../domains/preparacao/midia'
import type { Midia, RecusaDoArquivo, Som } from '../../domains/preparacao/midia'
import { ErroDePreparacao } from '../../domains/preparacao/portas'
import type { MotivoDaPreparacao, ServicosDePreparacao } from '../../domains/preparacao/portas'
import { usosDaMidia } from '../../domains/preparacao/usos'
import { BarraDeProgresso } from '../../shared/ui/BarraDeProgresso'
import { Mensagem } from '../../shared/ui/Mensagem'

/** Textos fixos da aba (PLA-003, Tarefa 5). Nenhum vem do servidor nem de um erro. */
export const TEXTO_DA_BIBLIOTECA = {
  vazio: 'Arquivo vazio.',
  grandeDemais: 'Arquivo acima de 50 MB.',
  tipoRecusado: 'Tipo não aceito. Use MP3, WAV, OGG, M4A, PNG, JPEG, WebP ou GIF.',
  semEspaco: 'Sem espaço: o limite grátis é 1 GB.',
  cancelado: 'Envio cancelado.',
  semResposta: 'O envio parou de avançar e foi interrompido. Tente de novo.',
  emUso: 'Este som está ligado a um gesto. Troque o gesto antes de excluir.',
  mudou: 'A biblioteca ou o seu papel mudou; conferindo de novo.',
  naoConcluiu: 'Não foi possível concluir. Tente de novo.',
  arquivoFicou: 'Excluído da biblioteca; o arquivo ficou no armazenamento.',
  enviado: 'Arquivo enviado.',
  excluido: 'Excluído da biblioteca.',
  somSalvo: 'Som salvo.',
  rotuloVazio: 'Dê um rótulo ao som.',
  volumeInvalido: 'O volume vai de 0 a 100 %.',
  sessaoExpirada: 'A sessão expirou. Entre de novo e envie outra vez.',
  avisoDaFila: 'Trocar de aba ou sair da página cancela os envios.',
  registrando: 'Registrando…',
  naoCarregou: 'Não foi possível carregar a biblioteca.',
  alertaDeUso: 'A biblioteca passou de 80 % do limite grátis.',
} as const

const TEXTO_DA_RECUSA: Record<RecusaDoArquivo, string> = {
  vazio: TEXTO_DA_BIBLIOTECA.vazio,
  grande_demais: TEXTO_DA_BIBLIOTECA.grandeDemais,
  tipo_recusado: TEXTO_DA_BIBLIOTECA.tipoRecusado,
  sem_espaco: TEXTO_DA_BIBLIOTECA.semEspaco,
}

/** Os tipos do seletor de arquivos: os mesmos 8 da D4 (o tipo de verdade vem dos primeiros bytes). */
const ACEITOS = TIPOS_ACEITOS.map((t) => t.mime).join(',')

const EMOJI_DO_GESTO = new Map(GESTOS.map((g) => [g.gesto, g.emoji]))

type Dados = { midias: Midia[]; sons: Som[]; mapa: LinhaDoMapa[] }
type Carga = { tipo: 'carregando' } | { tipo: 'pronta'; dados: Dados } | { tipo: 'falha' }
type Aviso = { tom: 'info' | 'erro'; texto: string }
/**
 * Um arquivo escolhido: à espera, sendo enviado (um de cada vez), registrando (os bytes já estão no
 * Storage e o "Cancelar" não faria mais efeito) ou com falha (fica na fila, com a mensagem fixa, até
 * a pessoa dispensar: com vários arquivos, uma recusa não some atrás do sucesso do seguinte).
 */
type EstadoDoItem = 'esperando' | 'enviando' | 'registrando' | 'falhou'
type ItemDaFila = { chave: number; nome: string; arquivo: File; fracao: number; estado: EstadoDoItem; erro: string | null }
/** Desfecho de um envio da fila. `parar`: a fila inteira para (sessão expirada ou acesso negado). */
type Desfecho =
  | { tipo: 'enviado' }
  | { tipo: 'cancelado' }
  /** Recusa do domínio: nada foi enviado (a lista não precisa recarregar). */
  | { tipo: 'recusado'; texto: string }
  | { tipo: 'falhou'; texto: string }
  /** `recarregar`: falso na sessão expirada (a leitura também falharia e pediria `reavaliar()` de novo). */
  | { tipo: 'parar'; texto: string; recarregar: boolean }
/** Exclusão pedida: `avisos` nulo enquanto a contagem de avisos com a imagem não chega. */
type Confirmacao = { midiaId: string; avisos: number | null }
type RascunhoDoSom = { rotulo: string; emoji: string; volume: number }
/** Para onde o foco vai depois de uma ação (WCAG 2.4.3): os botões que somem ou ficam desabilitados perdem o foco. */
type Foco =
  | { tipo: 'status' }
  | { tipo: 'erro' }
  | { tipo: 'salvar'; id: string }
  | { tipo: 'excluir'; id: string }
  | { tipo: 'manter'; id: string }
  | { tipo: 'dispensar'; id: string }
  | { tipo: 'campo' }

function motivoDe(erro: unknown): MotivoDaPreparacao {
  return erro instanceof ErroDePreparacao ? erro.motivo : 'outro'
}

/** Megabytes no sentido do limite (10⁶ bytes), com uma casa: `800000000` → "800,0". */
function emMB(bytes: number): string {
  return (bytes / 1_000_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function tamanhoDoArquivo(bytes: number): string {
  return bytes < 100_000 ? 'menos de 0,1 MB' : `${emMB(bytes)} MB`
}

/** Ordem do próximo som: depois do último. */
function proximaOrdem(sons: readonly Som[]): number {
  return sons.reduce((maior, s) => Math.max(maior, s.ordem + 1), 0)
}

/**
 * A prévia só usa URL `https:` (ou `http:`, no Supabase local); qualquer outra é tratada como falha.
 * Exportada para a aba Episódios (miniatura da imagem do aviso, Tarefa 7), que segue a mesma regra.
 */
export function urlDePreviaAceita(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

function textoDosGestos(gestos: readonly string[]): string {
  const emojis = gestos.map((g) => EMOJI_DO_GESTO.get(g as LinhaDoMapa['gesto']) ?? g).join(', ')
  return gestos.length === 1 ? `Usado no gesto ${emojis}` : `Usado nos gestos ${emojis}`
}

/**
 * Aba Biblioteca (E2, Tarefa 5): uso do limite de 1 GB (D7), envio de sons e imagens numa fila (um
 * arquivo de cada vez, com progresso e "Cancelar"), sons com rótulo, emoji e volume, prévia pedida só
 * quando a pessoa clica e exclusão com confirmação que diz onde a mídia é usada (D11). A ordem entre
 * Storage e banco é a do domínio (`enviarMidia`, `excluirMidia`, D6). Quem nega é a RLS e as políticas
 * do bucket: uma escrita negada mostra a mensagem fixa, pede `reavaliar()` e recarrega.
 */
export function AbaBiblioteca({
  servicos,
  usuario,
  reavaliar,
}: {
  servicos: ServicosDePreparacao
  usuario: UsuarioDaSessao
  reavaliar: () => void
}): ReactNode {
  const [carga, setCarga] = useState<Carga>({ tipo: 'carregando' })
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [fila, setFila] = useState<ItemDaFila[]>([])
  const [arrastando, setArrastando] = useState(false)
  const [rascunhos, setRascunhos] = useState<Record<string, RascunhoDoSom>>({})
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null)
  const [previas, setPrevias] = useState<Record<string, string>>({})
  const prefixo = useId()

  const montada = useRef(true)
  const ultimaLeitura = useRef(0)
  /** Os dados da última leitura, para conferir o uso antes de cada envio da fila. */
  const dadosAtuais = useRef<Dados | null>(null)
  /** A fila de verdade (o estado `fila` é o espelho que a tela mostra). */
  const filaAtual = useRef<ItemDaFila[]>([])
  const processando = useRef(false)
  const proximaChave = useRef(0)
  /** O `AbortController` do envio em curso (por chave); abortado no "Cancelar" e na desmontagem. */
  const controladores = useRef(new Map<number, AbortController>())
  const pedindoPrevia = useRef(new Set<string>())
  const focoPendente = useRef<Foco | null>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  const campoRef = useRef<HTMLInputElement>(null)
  const erroRef = useRef<HTMLDivElement>(null)
  const linhasDaFila = useRef(new Map<number, HTMLLIElement>())
  const botoes = useRef(new Map<string, HTMLButtonElement>())
  const reavaliarAtual = useRef(reavaliar)
  useEffect(() => {
    reavaliarAtual.current = reavaliar
  }, [reavaliar])

  /** Lê mídias, sons e o mapa de gestos juntos; só a leitura mais recente aplica. */
  const carregar = useCallback(async (): Promise<void> => {
    const numero = ++ultimaLeitura.current
    try {
      const [midias, sons, mapa] = await Promise.all([servicos.midias.listar(), servicos.sons.listar(), servicos.gestos.listar()])
      if (!montada.current || numero !== ultimaLeitura.current) return
      const dados = { midias, sons, mapa }
      dadosAtuais.current = dados
      setCarga({ tipo: 'pronta', dados })
    } catch (erro) {
      if (!montada.current || numero !== ultimaLeitura.current) return
      setCarga({ tipo: 'falha' })
      if (motivoDe(erro) === 'sessao_expirada') reavaliarAtual.current()
    }
  }, [servicos])

  useEffect(() => {
    montada.current = true
    void carregar()
    const ativos = controladores.current
    return () => {
      montada.current = false
      for (const controlador of ativos.values()) controlador.abort()
    }
  }, [carregar])

  // Enquanto houver envio pendente, sair ou recarregar a página pede confirmação ao navegador (o envio
  // seria cancelado); o ouvinte sai quando a fila termina e na desmontagem.
  const haPendentes = fila.some((item) => item.estado !== 'falhou')
  useEffect(() => {
    if (!haPendentes) return
    const aoSairDaPagina = (evento: BeforeUnloadEvent) => {
      evento.preventDefault()
      evento.returnValue = ''
    }
    window.addEventListener('beforeunload', aoSairDaPagina)
    return () => window.removeEventListener('beforeunload', aoSairDaPagina)
  }, [haPendentes])

  // Depois de cada render: se uma ação pediu foco e nenhuma escrita está em curso, põe o foco no alvo.
  // `useLayoutEffect` (e não `useEffect`): o foco muda no mesmo commit que mostra o aviso, antes da pintura;
  // com `useEffect`, uma renderização fora de evento deixava o aviso na tela com o foco ainda no <body>.
  useLayoutEffect(() => {
    const alvo = focoPendente.current
    if (alvo === null || ocupado) return
    focoPendente.current = null
    const elemento =
      alvo.tipo === 'erro' ? erroRef.current
      : alvo.tipo === 'status' ? statusRef.current
      : alvo.tipo === 'campo' ? (campoRef.current?.disabled ? statusRef.current : campoRef.current)
      : (botoes.current.get(`${alvo.tipo}:${alvo.id}`) ?? statusRef.current)
    elemento?.focus()
  })

  function refDoBotao(tipo: 'salvar' | 'excluir' | 'manter' | 'dispensar', id: string) {
    return (botao: HTMLButtonElement | null) => {
      if (botao) botoes.current.set(`${tipo}:${id}`, botao)
      else botoes.current.delete(`${tipo}:${id}`)
    }
  }

  function mostrar(novo: Aviso, foco: Foco | null) {
    setAviso(novo)
    if (foco !== null) focoPendente.current = foco
  }

  /** Mensagem fixa por motivo. `focar`: a falha veio de uma ação da pessoa (o foco vai para o aviso de erro). */
  function tratarErro(erro: unknown, focar: boolean) {
    const motivo = motivoDe(erro)
    const foco: Foco | null = focar ? { tipo: 'erro' } : null
    if (motivo === 'cancelado') mostrar({ tom: 'info', texto: TEXTO_DA_BIBLIOTECA.cancelado }, null)
    else if (motivo === 'sem_resposta') mostrar({ tom: 'erro', texto: TEXTO_DA_BIBLIOTECA.semResposta }, foco)
    else if (motivo === 'em_uso') mostrar({ tom: 'erro', texto: TEXTO_DA_BIBLIOTECA.emUso }, foco)
    else if (motivo === 'negado' || motivo === 'nada_alterado') {
      mostrar({ tom: 'erro', texto: TEXTO_DA_BIBLIOTECA.mudou }, foco)
      reavaliarAtual.current()
      void carregar()
    } else if (motivo === 'sessao_expirada') reavaliarAtual.current()
    else mostrar({ tom: 'erro', texto: TEXTO_DA_BIBLIOTECA.naoConcluiu }, foco)
  }

  function trocarFila(nova: ItemDaFila[]) {
    filaAtual.current = nova
    setFila(nova)
  }

  function atualizarItem(chave: number, mudanca: Partial<ItemDaFila>) {
    trocarFila(filaAtual.current.map((item) => (item.chave === chave ? { ...item, ...mudanca } : item)))
  }

  /** O botão da linha vai sumir ou mudar: se o foco estava nela, vai para `alvo`, não para o <body>. */
  function protegerFoco(chave: number, alvo: Foco) {
    const linha = linhasDaFila.current.get(chave)
    if (linha?.contains(document.activeElement) && focoPendente.current === null) focoPendente.current = alvo
  }

  function tirarDaFila(chave: number) {
    protegerFoco(chave, { tipo: 'status' })
    trocarFila(filaAtual.current.filter((item) => item.chave !== chave))
  }

  /** Desfecho de um erro do envio: mensagem fixa por motivo, anunciada pela região de alerta sem mover o foco. */
  function desfechoDoErro(erro: unknown): Desfecho {
    const motivo = motivoDe(erro)
    if (motivo === 'cancelado') {
      mostrar({ tom: 'info', texto: TEXTO_DA_BIBLIOTECA.cancelado }, null)
      return { tipo: 'cancelado' }
    }
    let desfecho: Desfecho
    if (motivo === 'sem_resposta') desfecho = { tipo: 'falhou', texto: TEXTO_DA_BIBLIOTECA.semResposta }
    else if (motivo === 'em_uso') desfecho = { tipo: 'falhou', texto: TEXTO_DA_BIBLIOTECA.emUso }
    else if (motivo === 'negado' || motivo === 'nada_alterado') {
      desfecho = { tipo: 'parar', texto: TEXTO_DA_BIBLIOTECA.mudou, recarregar: true }
      reavaliarAtual.current()
    } else if (motivo === 'sessao_expirada') {
      desfecho = { tipo: 'parar', texto: TEXTO_DA_BIBLIOTECA.sessaoExpirada, recarregar: false }
      reavaliarAtual.current()
    } else desfecho = { tipo: 'falhou', texto: TEXTO_DA_BIBLIOTECA.naoConcluiu }
    mostrar({ tom: 'erro', texto: desfecho.texto }, null)
    return desfecho
  }

  /**
   * Envia um item da fila. O `enviar` passado ao domínio é o do armazenamento, mais um aviso de que os
   * bytes já estão no Storage: daí em diante a linha mostra "Registrando…" e o "Cancelar" some (abortar
   * não teria mais efeito: o domínio já está registrando a mídia).
   */
  async function enviarItem(item: ItemDaFila): Promise<Desfecho> {
    const controlador = new AbortController()
    controladores.current.set(item.chave, controlador)
    atualizarItem(item.chave, { estado: 'enviando', fracao: 0 })
    const armazenamento = {
      ...servicos.armazenamento,
      enviar: async (...args: Parameters<ServicosDePreparacao['armazenamento']['enviar']>) => {
        await servicos.armazenamento.enviar(...args)
        if (!montada.current) return
        protegerFoco(item.chave, { tipo: 'campo' })
        atualizarItem(item.chave, { estado: 'registrando', fracao: 1 })
      },
    }
    try {
      const inicio = new Uint8Array(await item.arquivo.slice(0, BYTES_PARA_DETECTAR).arrayBuffer())
      if (controlador.signal.aborted) throw new ErroDePreparacao('cancelado')
      const dados = dadosAtuais.current ?? { midias: [], sons: [], mapa: [] }
      const resultado = await enviarMidia(
        { ...servicos, armazenamento },
        { nome: item.arquivo.name, inicio, corpo: item.arquivo },
        {
          usoAtualBytes: usoDaBiblioteca(dados.midias).bytes,
          membroId: usuario.id,
          gerarId: () => crypto.randomUUID(),
          ordemDoSom: proximaOrdem(dados.sons),
        },
        {
          aoProgredir: (fracao) => {
            if (montada.current) atualizarItem(item.chave, { fracao })
          },
          sinal: controlador.signal,
        },
      )
      if (!resultado.ok) {
        const texto = TEXTO_DA_RECUSA[resultado.motivo]
        if (montada.current) mostrar({ tom: 'erro', texto }, null)
        return { tipo: 'recusado', texto }
      }
      // o uso conta o arquivo enviado já no próximo da fila, mesmo antes de a lista recarregar
      dadosAtuais.current = { ...dados, midias: [...dados.midias, resultado.midia] }
      if (montada.current) mostrar({ tom: 'info', texto: TEXTO_DA_BIBLIOTECA.enviado }, null)
      return { tipo: 'enviado' }
    } catch (erro) {
      return montada.current ? desfechoDoErro(erro) : { tipo: 'cancelado' }
    } finally {
      controladores.current.delete(item.chave)
    }
  }

  /** A linha fica na fila com a mensagem fixa e "Dispensar"; se o foco estava no "Cancelar", vai para o "Dispensar". */
  function marcarFalha(chave: number, texto: string) {
    protegerFoco(chave, { tipo: 'dispensar', id: String(chave) })
    atualizarItem(chave, { estado: 'falhou', erro: texto, fracao: 0 })
  }

  /**
   * Envia a fila um arquivo de cada vez; o uso é reconferido (lista recarregada) entre um e outro. Uma
   * falha fica na linha; sessão expirada ou acesso negado param a fila: os que esperavam ficam com a
   * mesma mensagem, sem tentar enviar. Na sessão expirada, a fila não recarrega a lista: `reavaliar()` é
   * chamado uma vez só (a leitura também falharia com `sessao_expirada` e chamaria de novo). Em
   * `negado`/`nada_alterado`, a lista recarrega (o papel ou a biblioteca mudou; a regra do brief é mensagem
   * + `reavaliar()` + recarga).
   */
  async function processarFila() {
    if (processando.current) return
    processando.current = true
    try {
      for (;;) {
        if (!montada.current) return
        const item = filaAtual.current.find((i) => i.estado === 'esperando')
        if (!item) return
        const desfecho = await enviarItem(item)
        if (!montada.current) return
        if (desfecho.tipo === 'enviado' || desfecho.tipo === 'cancelado') tirarDaFila(item.chave)
        else if (desfecho.tipo === 'recusado' || desfecho.tipo === 'falhou') marcarFalha(item.chave, desfecho.texto)
        else {
          const restantes = filaAtual.current.filter((i) => i.chave === item.chave || i.estado === 'esperando')
          for (const i of restantes) marcarFalha(i.chave, desfecho.texto)
        }
        if (desfecho.tipo === 'recusado' || (desfecho.tipo === 'parar' && !desfecho.recarregar)) continue
        await carregar()
      }
    } finally {
      processando.current = false
    }
  }

  function adicionar(arquivos: File[]) {
    if (arquivos.length === 0 || carga.tipo !== 'pronta') return
    const novos = arquivos.map(
      (arquivo): ItemDaFila => ({ chave: ++proximaChave.current, nome: nomeDeExibicao(arquivo.name), arquivo, fracao: 0, estado: 'esperando', erro: null }),
    )
    trocarFila([...filaAtual.current, ...novos])
    void processarFila()
  }

  function aoCancelar(chave: number) {
    focoPendente.current = { tipo: 'status' }
    const controlador = controladores.current.get(chave)
    if (controlador) {
      // envio em curso: o domínio recebe `cancelado`, remove de boa-fé o que possa ter ficado e não registra
      controlador.abort()
      return
    }
    tirarDaFila(chave)
    mostrar({ tom: 'info', texto: TEXTO_DA_BIBLIOTECA.cancelado }, { tipo: 'status' })
  }

  /** Tira da fila uma linha com falha; o foco vai para o campo de arquivos (a próxima ação natural). */
  function aoDispensar(chave: number) {
    focoPendente.current = { tipo: 'campo' }
    trocarFila(filaAtual.current.filter((item) => item.chave !== chave))
  }

  function aoEscolher(evento: ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(evento.target.files ?? [])
    evento.target.value = '' // escolher o mesmo arquivo de novo dispara outra mudança
    adicionar(arquivos)
  }

  function aoArrastar(evento: DragEvent<HTMLDivElement>) {
    evento.preventDefault()
    if (carga.tipo === 'pronta') setArrastando(true)
  }

  function aoSair(evento: DragEvent<HTMLDivElement>) {
    if (evento.relatedTarget instanceof Node && evento.currentTarget.contains(evento.relatedTarget)) return
    setArrastando(false)
  }

  function aoSoltar(evento: DragEvent<HTMLDivElement>) {
    evento.preventDefault()
    setArrastando(false)
    adicionar(Array.from(evento.dataTransfer?.files ?? []))
  }

  /** Escrita direta da pessoa (salvar som): mensagens fixas e foco previsível. */
  async function escrever(acao: () => Promise<void>, textoDoSucesso: string, focoNoSucesso: Foco, aoDarCerto?: () => void) {
    setOcupado(true)
    setAviso(null)
    try {
      await acao()
      aoDarCerto?.()
      await carregar()
      if (montada.current) mostrar({ tom: 'info', texto: textoDoSucesso }, focoNoSucesso)
    } catch (erro) {
      if (montada.current) tratarErro(erro, true)
    } finally {
      if (montada.current) setOcupado(false)
    }
  }

  function rascunhoDe(som: Som): RascunhoDoSom {
    return rascunhos[som.id] ?? { rotulo: som.rotulo, emoji: som.emoji ?? '', volume: Math.round(som.volume * 100) }
  }

  function editar(som: Som, mudanca: Partial<RascunhoDoSom>) {
    setRascunhos((r) => ({ ...r, [som.id]: { ...rascunhoDe(som), ...mudanca } }))
  }

  function aoSalvar(som: Som) {
    const rascunho = rascunhoDe(som)
    const rotulo = rascunho.rotulo.trim()
    const emoji = rascunho.emoji.trim() === '' ? null : rascunho.emoji.trim()
    const volume = rascunho.volume / 100
    const recusa = conferirSom({ rotulo, volume })
    if (recusa !== null) {
      mostrar({ tom: 'erro', texto: recusa === 'rotulo_vazio' ? TEXTO_DA_BIBLIOTECA.rotuloVazio : TEXTO_DA_BIBLIOTECA.volumeInvalido }, { tipo: 'erro' })
      return
    }
    void escrever(
      () => servicos.sons.alterar(som.id, { rotulo, emoji, volume, ordem: som.ordem }),
      TEXTO_DA_BIBLIOTECA.somSalvo,
      { tipo: 'salvar', id: som.id },
      () =>
        setRascunhos((r) => {
          const resto = { ...r }
          delete resto[som.id]
          return resto
        }),
    )
  }

  async function aoPedirExclusao(m: Midia) {
    focoPendente.current = { tipo: 'manter', id: m.id }
    if (m.tipo !== 'imagem') {
      setConfirmacao({ midiaId: m.id, avisos: 0 })
      return
    }
    setConfirmacao({ midiaId: m.id, avisos: null })
    try {
      const avisos = await servicos.midias.contarAvisosComImagem(m.id)
      if (montada.current) setConfirmacao((c) => (c?.midiaId === m.id ? { midiaId: m.id, avisos } : c))
    } catch (erro) {
      if (!montada.current) return
      setConfirmacao((c) => (c?.midiaId === m.id ? null : c))
      tratarErro(erro, true)
    }
  }

  function aoManter(m: Midia) {
    setConfirmacao(null)
    focoPendente.current = { tipo: 'excluir', id: m.id }
  }

  async function aoConfirmarExclusao(m: Midia, bloqueia: boolean) {
    if (bloqueia) {
      // defesa em profundidade: o botão já está desabilitado e o banco também recusa (`23503`)
      mostrar({ tom: 'erro', texto: TEXTO_DA_BIBLIOTECA.emUso }, { tipo: 'erro' })
      return
    }
    setOcupado(true)
    setAviso(null)
    try {
      const { arquivoFicou } = await excluirMidia(servicos, m)
      if (!montada.current) return
      setConfirmacao(null)
      await carregar()
      if (montada.current) {
        mostrar({ tom: 'info', texto: arquivoFicou ? TEXTO_DA_BIBLIOTECA.arquivoFicou : TEXTO_DA_BIBLIOTECA.excluido }, { tipo: 'status' })
      }
    } catch (erro) {
      if (!montada.current) return
      setConfirmacao(null)
      tratarErro(erro, true)
      if (motivoDe(erro) === 'em_uso') void carregar()
    } finally {
      if (montada.current) setOcupado(false)
    }
  }

  async function aoAlternarPrevia(m: Midia) {
    if (previas[m.id] !== undefined) {
      setPrevias((p) => {
        const resto = { ...p }
        delete resto[m.id]
        return resto
      })
      return
    }
    if (pedindoPrevia.current.has(m.id)) return
    pedindoPrevia.current.add(m.id)
    try {
      const url = await servicos.armazenamento.urlDePrevia(m.caminho)
      if (!urlDePreviaAceita(url)) throw new ErroDePreparacao('outro')
      if (montada.current) setPrevias((p) => ({ ...p, [m.id]: url }))
    } catch (erro) {
      if (montada.current) tratarErro(erro, true)
    } finally {
      pedindoPrevia.current.delete(m.id)
    }
  }

  const dados = carga.tipo === 'pronta' ? carga.dados : null
  const uso = usoDaBiblioteca(dados?.midias ?? [])
  const somDaMidia = new Map((dados?.sons ?? []).map((s) => [s.midiaId, s]))
  const midiasDeSom = (dados?.midias ?? [])
    .filter((m) => m.tipo === 'som')
    .sort((a, b) => (somDaMidia.get(a.id)?.ordem ?? Number.MAX_SAFE_INTEGER) - (somDaMidia.get(b.id)?.ordem ?? Number.MAX_SAFE_INTEGER))
  const imagens = (dados?.midias ?? []).filter((m) => m.tipo === 'imagem')
  const idDoCampo = `${prefixo}-arquivos`

  function confirmacaoDe(m: Midia): ReactNode {
    if (confirmacao?.midiaId !== m.id || dados === null) return null
    const usos = usosDaMidia(m, { sons: dados.sons, mapa: dados.mapa, avisosComImagem: confirmacao.avisos ?? 0 })
    const contando = m.tipo === 'imagem' && confirmacao.avisos === null
    let texto: string
    if (usos.bloqueia) texto = textoDosGestos(usos.gestos)
    else if (contando) texto = 'Conferindo onde a imagem é usada…'
    else if (usos.avisos > 0) texto = usos.avisos === 1 ? '1 aviso perde a imagem' : `${usos.avisos} avisos perdem a imagem`
    else texto = 'Não está em uso.'
    return (
      <div className="lista-de-midias__confirmacao">
        <span>{texto}</span>
        {usos.bloqueia && <span>Troque o gesto antes de excluir.</span>}
        <div className="tabela__acoes">
          <button
            type="button"
            className="botao botao--pequeno"
            disabled={ocupado || usos.bloqueia || contando}
            onClick={() => void aoConfirmarExclusao(m, usos.bloqueia)}
          >
            Confirmar exclusão
          </button>
          <button ref={refDoBotao('manter', m.id)} type="button" className="botao botao--pequeno botao--contorno" disabled={ocupado} onClick={() => aoManter(m)}>
            Manter
          </button>
        </div>
      </div>
    )
  }

  function acoesDe(m: Midia, extra: ReactNode): ReactNode {
    const temPrevia = previas[m.id] !== undefined
    return (
      <div className="tabela__acoes">
        {extra}
        <button type="button" className="botao botao--pequeno botao--contorno" onClick={() => void aoAlternarPrevia(m)}>
          {temPrevia ? 'Ocultar prévia' : m.tipo === 'som' ? 'Ouvir' : 'Ver'}
        </button>
        {confirmacao?.midiaId !== m.id && (
          <button
            ref={refDoBotao('excluir', m.id)}
            type="button"
            className="botao botao--pequeno botao--contorno"
            disabled={ocupado}
            onClick={() => void aoPedirExclusao(m)}
          >
            Excluir
          </button>
        )}
      </div>
    )
  }

  function cabecaDe(m: Midia): ReactNode {
    return (
      <div className="lista-de-midias__cabeca">
        <span className="lista-de-midias__nome">{m.nome}</span>
        <span className="tabela__fraco">{tamanhoDoArquivo(m.tamanhoBytes)}</span>
      </div>
    )
  }

  return (
    <div className="biblioteca">
      <h2>Biblioteca</h2>
      {/* Regiões de aviso sempre montadas (o texto entra depois, para o leitor de tela anunciar); vazias, ficam
          fora do fluxo (.so-leitor). `tabIndex={-1}` deixa o foco ir para elas depois de uma ação. */}
      <div ref={statusRef} role="status" tabIndex={-1} className={aviso?.tom === 'info' ? 'mensagem' : 'so-leitor'}>
        {aviso?.tom === 'info' ? aviso.texto : null}
      </div>
      <div ref={erroRef} role="alert" tabIndex={-1} className={aviso?.tom === 'erro' ? 'mensagem mensagem--erro' : 'so-leitor'}>
        {aviso?.tom === 'erro' ? aviso.texto : null}
      </div>

      {dados !== null && (
        <p className="uso">
          Uso: <strong>{emMB(uso.bytes)} MB de 1 GB</strong>
          {uso.alerta && <span className="uso__alerta">{TEXTO_DA_BIBLIOTECA.alertaDeUso}</span>}
        </p>
      )}

      <div className={arrastando ? 'envio envio--arrastando' : 'envio'} onDragOver={aoArrastar} onDragLeave={aoSair} onDrop={aoSoltar}>
        <label htmlFor={idDoCampo} className="envio__rotulo">Enviar sons e imagens</label>
        <p className="envio__dica">Escolha ou solte aqui: MP3, WAV, OGG, M4A, PNG, JPEG, WebP ou GIF, até 50 MB cada.</p>
        <input ref={campoRef} id={idDoCampo} type="file" accept={ACEITOS} multiple disabled={carga.tipo !== 'pronta'} onChange={aoEscolher} />
      </div>

      {haPendentes && <p className="fila__aviso">{TEXTO_DA_BIBLIOTECA.avisoDaFila}</p>}
      {fila.length > 0 && (
        <ul className="fila" aria-label="Envios">
          {fila.map((item) => (
            <li
              key={item.chave}
              ref={(linha) => {
                if (linha) linhasDaFila.current.set(item.chave, linha)
                else linhasDaFila.current.delete(item.chave)
              }}
            >
              <span className="fila__nome">{item.nome}</span>
              {item.estado === 'esperando' && <span className="tabela__fraco">Na fila</span>}
              {item.estado === 'enviando' && <BarraDeProgresso fracao={item.fracao} rotulo={`Envio de ${item.nome}`} />}
              {item.estado === 'registrando' && <span className="tabela__fraco">{TEXTO_DA_BIBLIOTECA.registrando}</span>}
              {item.estado === 'falhou' && <span className="fila__erro">{item.erro}</span>}
              {(item.estado === 'esperando' || item.estado === 'enviando') && (
                <button type="button" className="botao botao--pequeno botao--contorno" onClick={() => aoCancelar(item.chave)}>
                  Cancelar
                </button>
              )}
              {item.estado === 'falhou' && (
                <button
                  ref={refDoBotao('dispensar', String(item.chave))}
                  type="button"
                  className="botao botao--pequeno botao--contorno"
                  onClick={() => aoDispensar(item.chave)}
                >
                  Dispensar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {carga.tipo === 'carregando' && <p role="status">Carregando a biblioteca…</p>}
      {carga.tipo === 'falha' && (
        <>
          <Mensagem tom="erro">{TEXTO_DA_BIBLIOTECA.naoCarregou}</Mensagem>
          <button
            type="button"
            className="botao botao--contorno"
            onClick={() => {
              setCarga({ tipo: 'carregando' })
              void carregar()
            }}
          >
            Tentar de novo
          </button>
        </>
      )}

      {dados !== null && (
        <>
          <h3 id={`${prefixo}-sons`}>Sons</h3>
          {midiasDeSom.length === 0 ? (
            <p className="tabela__fraco">Nenhum som ainda.</p>
          ) : (
            <ul className="lista-de-midias" aria-labelledby={`${prefixo}-sons`}>
              {midiasDeSom.map((m) => {
                const som = somDaMidia.get(m.id)
                const rascunho = som ? rascunhoDe(som) : null
                const id = `${prefixo}-${m.id}`
                return (
                  <li key={m.id}>
                    {cabecaDe(m)}
                    {som && rascunho && (
                      <div className="lista-de-midias__campos">
                        <div className="campo">
                          <label htmlFor={`${id}-rotulo`}>Rótulo</label>
                          <input id={`${id}-rotulo`} type="text" maxLength={60} value={rascunho.rotulo} onChange={(e) => editar(som, { rotulo: e.target.value })} />
                        </div>
                        <div className="campo campo--curto">
                          <label htmlFor={`${id}-emoji`}>Emoji</label>
                          <input id={`${id}-emoji`} type="text" maxLength={16} value={rascunho.emoji} onChange={(e) => editar(som, { emoji: e.target.value })} />
                        </div>
                        <div className="campo">
                          <label htmlFor={`${id}-volume`}>Volume</label>
                          <div className="lista-de-midias__volume">
                            <input
                              id={`${id}-volume`}
                              type="range"
                              min={0}
                              max={100}
                              step={1}
                              value={rascunho.volume}
                              onChange={(e) => editar(som, { volume: Number(e.target.value) })}
                            />
                            <output htmlFor={`${id}-volume`}>{rascunho.volume} %</output>
                          </div>
                        </div>
                      </div>
                    )}
                    {acoesDe(
                      m,
                      som ? (
                        <button ref={refDoBotao('salvar', som.id)} type="button" className="botao botao--pequeno botao--ciano" disabled={ocupado} onClick={() => aoSalvar(som)}>
                          Salvar
                        </button>
                      ) : null,
                    )}
                    {previas[m.id] !== undefined && <audio className="previa" controls preload="none" src={previas[m.id]} />}
                    {confirmacaoDe(m)}
                  </li>
                )
              })}
            </ul>
          )}

          <h3 id={`${prefixo}-imagens`}>Imagens</h3>
          {imagens.length === 0 ? (
            <p className="tabela__fraco">Nenhuma imagem ainda.</p>
          ) : (
            <ul className="lista-de-midias" aria-labelledby={`${prefixo}-imagens`}>
              {imagens.map((m) => (
                <li key={m.id}>
                  {cabecaDe(m)}
                  {acoesDe(m, null)}
                  {previas[m.id] !== undefined && <img className="previa" src={previas[m.id]} alt={m.nome} />}
                  {confirmacaoDe(m)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
