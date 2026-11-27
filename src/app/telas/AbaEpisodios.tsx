import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import type { UsuarioDaSessao } from '../../domains/acesso/sessao'
import { conferirAviso, conferirEpisodio, normalizarLink, podeExcluirEpisodio, trocarOrdem } from '../../domains/preparacao/episodios'
import type { Aviso, Episodio, EstadoDoEpisodio } from '../../domains/preparacao/episodios'
import type { Midia } from '../../domains/preparacao/midia'
import { ErroDePreparacao } from '../../domains/preparacao/portas'
import type { MotivoDaPreparacao, ServicosDePreparacao } from '../../domains/preparacao/portas'
import { Mensagem } from '../../shared/ui/Mensagem'
import { urlDePreviaAceita } from './AbaBiblioteca'

/** Textos fixos da aba (PLA-003, Tarefa 7). Nenhum vem do servidor nem de um erro. */
export const TEXTO_DOS_EPISODIOS = {
  tituloVazio: 'Dê um título.',
  tituloLongo: 'Título com até 120 caracteres.',
  dataInvalida: 'Data inválida.',
  linkInvalido: 'O link precisa começar com https://.',
  duracaoInvalida: 'Duração entre 1 e 600 segundos.',
  imagemInexistente: 'Essa imagem não está mais na Biblioteca.',
  aoVivoDuplicado: 'Já existe um episódio ao vivo.',
  mudou: 'Os episódios ou o seu papel mudaram; conferindo de novo.',
  naoConcluiu: 'Não foi possível concluir. Tente de novo.',
  naoCarregou: 'Não foi possível carregar os episódios.',
  notaE3: 'Iniciar e encerrar o ao vivo chegam na etapa E3.',
  soRascunho: 'Só rascunhos podem ser excluídos.',
  semImagem: 'Sem imagem',
  criado: 'Episódio criado.',
  salvo: 'Episódio salvo.',
  excluido: 'Episódio excluído.',
  avisoIncluido: 'Aviso incluído.',
  avisoSalvo: 'Aviso salvo.',
  avisoExcluido: 'Aviso excluído.',
  ordem: 'Ordem atualizada.',
} as const

const ROTULO_DO_ESTADO: Record<EstadoDoEpisodio, string> = { rascunho: 'Rascunho', ao_vivo: 'Ao vivo', encerrado: 'Encerrado' }

const TEXTO_DA_RECUSA: Record<
  'titulo_vazio' | 'titulo_longo' | 'data_invalida' | 'link_invalido' | 'duracao_invalida' | 'imagem_inexistente',
  string
> = {
  titulo_vazio: TEXTO_DOS_EPISODIOS.tituloVazio,
  titulo_longo: TEXTO_DOS_EPISODIOS.tituloLongo,
  data_invalida: TEXTO_DOS_EPISODIOS.dataInvalida,
  link_invalido: TEXTO_DOS_EPISODIOS.linkInvalido,
  duracao_invalida: TEXTO_DOS_EPISODIOS.duracaoInvalida,
  imagem_inexistente: TEXTO_DOS_EPISODIOS.imagemInexistente,
}

/** `avisosDe`: o episódio cujos avisos estão em `avisos` (`null` com nenhum aberto). */
type Dados = { episodios: Episodio[]; midias: Midia[]; avisos: Aviso[]; avisosDe: string | null }
type Carga = { tipo: 'carregando' } | { tipo: 'pronta'; dados: Dados } | { tipo: 'falha' }
type Recado = { tom: 'info' | 'erro'; texto: string }
type Direcao = 'subir' | 'descer'
/** Campos do formulário de aviso como digitados (a duração é texto até a conferência). */
type FormularioDoAviso = { titulo: string; texto: string; link: string; imagem: string; duracao: string }
/** De onde veio a escrita: o mesmo motivo do banco quer dizer coisas diferentes no episódio e no aviso. */
type Alvo = 'episodio' | 'aviso'
/** Para onde o foco vai depois de uma ação (WCAG 2.4.3): os botões que somem ou ficam desabilitados perdem o foco. */
type Foco =
  | { tipo: 'status' }
  | { tipo: 'erro' }
  | { tipo: 'novo' }
  | { tipo: 'cabecalho' }
  | { tipo: 'aviso' }
  | { tipo: 'botao'; chave: string }
  /** Depois de subir ou descer: o mesmo botão do aviso movido ou, se ele ficou desabilitado na ponta, o outro. */
  | { tipo: 'ordem'; id: string; direcao: Direcao }

const AVISO_EM_BRANCO: FormularioDoAviso = { titulo: '', texto: '', link: '', imagem: '', duracao: '10' }

function motivoDe(erro: unknown): MotivoDaPreparacao {
  return erro instanceof ErroDePreparacao ? erro.motivo : 'outro'
}

/** Hoje no relógio da pessoa, no formato do `<input type="date">` (`AAAA-MM-DD`). */
function hoje(): string {
  const d = new Date()
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** `AAAA-MM-DD` → `DD/MM/AAAA` (só troca a ordem; um texto fora do formato aparece como veio). */
function dataNaTela(data: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : data
}

/** Mais recente primeiro (o texto `AAAA-MM-DD` ordena como a data); empates na ordem da lista. */
function porData(episodios: readonly Episodio[]): Episodio[] {
  return [...episodios].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))
}

/** Os avisos pela ordem do campo `ordem`; empates na ordem da lista (a mesma regra de `trocarOrdem`). */
function ordenados(avisos: readonly Aviso[]): Aviso[] {
  return [...avisos].sort((a, b) => a.ordem - b.ordem)
}

function proximaOrdem(avisos: readonly Aviso[]): number {
  return avisos.reduce((maior, a) => Math.max(maior, a.ordem + 1), 0)
}

function textoDaExclusao(quantos: number): string {
  if (quantos === 0) return 'Excluir o episódio? Ele não tem avisos.'
  if (quantos === 1) return 'Excluir o episódio e o seu aviso?'
  return `Excluir o episódio e os seus ${quantos} avisos?`
}

/**
 * Aba Episódios (E2, Tarefa 7): lista dos episódios (título, data, estado), "Novo episódio" (título e
 * data, padrão hoje) e, ao abrir um, título e data editáveis, "Excluir episódio" só em rascunho (D2) e
 * os avisos em ordem (cartões com título, texto literal com as quebras de linha, link só depois de
 * `normalizarLink`, imagem da Biblioteca com miniatura pedida no clique, duração; subir, descer,
 * editar, excluir) com o formulário de aviso. A aba **nunca escreve `estado` nem `gestos_ligados`**:
 * iniciar e encerrar o ao vivo são da E3. Quem nega é a RLS: escrita negada mostra a mensagem fixa,
 * pede `reavaliar()` e recarrega.
 */
export function AbaEpisodios({ servicos, usuario, reavaliar }: { servicos: ServicosDePreparacao; usuario: UsuarioDaSessao; reavaliar: () => void }): ReactNode {
  const [carga, setCarga] = useState<Carga>({ tipo: 'carregando' })
  const [recado, setRecado] = useState<Recado | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [novoTitulo, setNovoTitulo] = useState('')
  const [novaData, setNovaData] = useState(hoje)
  const [aberto, setAberto] = useState<string | null>(null)
  const [dadosDoEpisodio, setDadosDoEpisodio] = useState({ titulo: '', data: '' })
  const [confirmarEpisodio, setConfirmarEpisodio] = useState(false)
  const [formulario, setFormulario] = useState<FormularioDoAviso>(AVISO_EM_BRANCO)
  const [editando, setEditando] = useState<string | null>(null)
  const [confirmarAviso, setConfirmarAviso] = useState<string | null>(null)
  const [previas, setPrevias] = useState<Record<string, string>>({})
  const prefixo = useId()

  const montada = useRef(true)
  const ultimaLeitura = useRef(0)
  /** O episódio aberto, lido pela carga (que pode terminar depois de a pessoa abrir ou fechar outro). */
  const abertoAtual = useRef<string | null>(null)
  /** O aviso no formulário de edição, lido pela carga: se ele sumiu (excluído por fora), a edição é desfeita. */
  const editandoAtual = useRef<string | null>(null)
  /** Guarda síncrona contra clique duplo: o `ocupado` só desabilita os botões no próximo render. */
  const escrevendo = useRef(false)
  const pedindoPrevia = useRef(new Set<string>())
  const focoPendente = useRef<Foco | null>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  const erroRef = useRef<HTMLDivElement>(null)
  const novoRef = useRef<HTMLInputElement>(null)
  const cabecalhoRef = useRef<HTMLHeadingElement>(null)
  const avisoRef = useRef<HTMLInputElement>(null)
  const botoes = useRef(new Map<string, HTMLButtonElement>())
  const reavaliarAtual = useRef(reavaliar)
  useEffect(() => {
    reavaliarAtual.current = reavaliar
  }, [reavaliar])

  function definirAberto(id: string | null) {
    abertoAtual.current = id
    setAberto(id)
  }

  function definirEditando(id: string | null) {
    editandoAtual.current = id
    setEditando(id)
  }

  /**
   * Lê os episódios, as mídias (as imagens do seletor e da miniatura) e, com um episódio aberto, os
   * avisos dele, juntos; só a leitura mais recente aplica. Se o episódio aberto sumiu (excluído por
   * fora), a aba volta à lista.
   */
  const carregar = useCallback(async (): Promise<void> => {
    const numero = ++ultimaLeitura.current
    const id = abertoAtual.current
    try {
      const [episodios, midias, avisos] = await Promise.all([
        servicos.episodios.listar(),
        servicos.midias.listar(),
        id === null ? Promise.resolve([]) : servicos.episodios.listarAvisos(id),
      ])
      if (!montada.current || numero !== ultimaLeitura.current) return
      if (id !== null && !episodios.some((e) => e.id === id)) {
        abertoAtual.current = null
        setAberto(null)
      }
      // o aviso em edição não veio na carga (excluído por fora): o formulário volta a "Novo aviso" e "Editar" volta nos cartões
      if (editandoAtual.current !== null && !avisos.some((x) => x.id === editandoAtual.current)) {
        editandoAtual.current = null
        setEditando(null)
        setFormulario(AVISO_EM_BRANCO)
      }
      setCarga({ tipo: 'pronta', dados: { episodios, midias, avisos, avisosDe: id } })
    } catch (erro) {
      if (!montada.current || numero !== ultimaLeitura.current) return
      setCarga({ tipo: 'falha' })
      if (motivoDe(erro) === 'sessao_expirada') reavaliarAtual.current()
    }
  }, [servicos])

  useEffect(() => {
    montada.current = true
    void carregar()
    return () => {
      montada.current = false
    }
  }, [carregar])

  // Foco no mesmo commit que mostra o recado (`useLayoutEffect`, como nas outras abas), quando nenhuma escrita está em curso.
  useLayoutEffect(() => {
    const alvo = focoPendente.current
    if (alvo === null || ocupado) return
    focoPendente.current = null
    let elemento: HTMLElement | null | undefined
    if (alvo.tipo === 'erro') elemento = erroRef.current
    else if (alvo.tipo === 'status') elemento = statusRef.current
    else if (alvo.tipo === 'novo') elemento = novoRef.current
    else if (alvo.tipo === 'cabecalho') elemento = cabecalhoRef.current
    else if (alvo.tipo === 'aviso') elemento = avisoRef.current
    else if (alvo.tipo === 'botao') elemento = botoes.current.get(alvo.chave)
    else {
      const outra: Direcao = alvo.direcao === 'subir' ? 'descer' : 'subir'
      const mesmo = botoes.current.get(`${alvo.direcao}:${alvo.id}`)
      elemento = mesmo && !mesmo.disabled ? mesmo : botoes.current.get(`${outra}:${alvo.id}`)
    }
    const destino = elemento ?? statusRef.current
    destino?.focus()
  })

  function refDoBotao(chave: string) {
    return (botao: HTMLButtonElement | null) => {
      if (botao) botoes.current.set(chave, botao)
      else botoes.current.delete(chave)
    }
  }

  function mostrar(novo: Recado, foco: Foco | null) {
    setRecado(novo)
    if (foco !== null) focoPendente.current = foco
  }

  /**
   * Mensagem fixa por motivo; o foco vai para o alerta. No aviso, `em_uso` é a chave estrangeira da
   * imagem (`23503`: apagada entre a carga e a escrita). `recarregarSempre`: a ação pode ter gravado em
   * parte (a troca de ordem grava um aviso por vez). Sessão expirada: só `reavaliar()`, sem mensagem e
   * sem recarga (a leitura também falharia).
   */
  function tratarErro(erro: unknown, alvo: Alvo, recarregarSempre: boolean) {
    const motivo = motivoDe(erro)
    const foco: Foco = { tipo: 'erro' }
    if (motivo === 'sessao_expirada') {
      reavaliarAtual.current()
      return
    }
    let recarregar = recarregarSempre
    if (motivo === 'duplicado' && alvo === 'episodio') mostrar({ tom: 'erro', texto: TEXTO_DOS_EPISODIOS.aoVivoDuplicado }, foco)
    else if (motivo === 'em_uso' && alvo === 'aviso') {
      mostrar({ tom: 'erro', texto: TEXTO_DOS_EPISODIOS.imagemInexistente }, foco)
      recarregar = true
    } else if (motivo === 'negado' || motivo === 'nada_alterado') {
      mostrar({ tom: 'erro', texto: TEXTO_DOS_EPISODIOS.mudou }, foco)
      reavaliarAtual.current()
      recarregar = true
    } else mostrar({ tom: 'erro', texto: TEXTO_DOS_EPISODIOS.naoConcluiu }, foco)
    if (recarregar) void carregar()
  }

  /** Escrita da pessoa: uma de cada vez (clique duplo não duplica), recarga, mensagem fixa e foco previsível. */
  async function escrever(
    acao: () => Promise<void>,
    alvo: Alvo,
    textoDoSucesso: string,
    focoNoSucesso: Foco,
    opcoes: { aoDarCerto?: () => void; aoFalhar?: () => void; recarregarSempre?: boolean } = {},
  ) {
    if (escrevendo.current) return
    escrevendo.current = true
    setOcupado(true)
    setRecado(null)
    try {
      await acao()
      if (!montada.current) return
      opcoes.aoDarCerto?.()
      await carregar()
      if (montada.current) mostrar({ tom: 'info', texto: textoDoSucesso }, focoNoSucesso)
    } catch (erro) {
      if (!montada.current) return
      opcoes.aoFalhar?.()
      tratarErro(erro, alvo, opcoes.recarregarSempre ?? false)
    } finally {
      escrevendo.current = false
      if (montada.current) setOcupado(false)
    }
  }

  const dados = carga.tipo === 'pronta' ? carga.dados : null
  const episodio = dados !== null && aberto !== null ? (dados.episodios.find((e) => e.id === aberto) ?? null) : null
  const avisos = episodio !== null && dados?.avisosDe === episodio.id ? ordenados(dados.avisos) : null
  const imagens = (dados?.midias ?? []).filter((m) => m.tipo === 'imagem')

  // ——— Episódios ———

  function aoCriar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (dados === null || escrevendo.current) return
    const novo = { titulo: novoTitulo.trim(), data: novaData }
    const recusa = conferirEpisodio(novo)
    if (recusa !== null) {
      mostrar({ tom: 'erro', texto: TEXTO_DA_RECUSA[recusa] }, { tipo: 'erro' })
      return
    }
    void escrever(() => servicos.episodios.incluir({ titulo: novo.titulo, data: novo.data, criadoPor: usuario.id }), 'episodio', TEXTO_DOS_EPISODIOS.criado, { tipo: 'novo' }, {
      aoDarCerto: () => setNovoTitulo(''),
    })
  }

  function aoAbrir(e: Episodio) {
    definirAberto(e.id)
    setDadosDoEpisodio({ titulo: e.titulo, data: e.data })
    setConfirmarEpisodio(false)
    setFormulario(AVISO_EM_BRANCO)
    definirEditando(null)
    setConfirmarAviso(null)
    setPrevias({})
    setRecado(null)
    focoPendente.current = { tipo: 'cabecalho' }
    void carregar()
  }

  function aoFechar(e: Episodio) {
    definirAberto(null)
    setRecado(null)
    focoPendente.current = { tipo: 'botao', chave: `abrir:${e.id}` }
  }

  /** Grava só título e data, montados um a um: nunca `estado` nem `gestos_ligados` (D2). */
  function aoSalvarEpisodio(evento: FormEvent<HTMLFormElement>, e: Episodio) {
    evento.preventDefault()
    if (escrevendo.current) return
    const mudado = { titulo: dadosDoEpisodio.titulo.trim(), data: dadosDoEpisodio.data }
    const recusa = conferirEpisodio(mudado)
    if (recusa !== null) {
      mostrar({ tom: 'erro', texto: TEXTO_DA_RECUSA[recusa] }, { tipo: 'erro' })
      return
    }
    void escrever(() => servicos.episodios.alterar(e.id, { titulo: mudado.titulo, data: mudado.data }), 'episodio', TEXTO_DOS_EPISODIOS.salvo, { tipo: 'status' }, {
      aoDarCerto: () => setDadosDoEpisodio(mudado),
    })
  }

  function aoConfirmarExclusaoDoEpisodio(e: Episodio) {
    // defesa em profundidade: fora de rascunho o botão nem aparece (o banco ainda deixaria; limite da D2)
    if (!podeExcluirEpisodio(e)) {
      mostrar({ tom: 'erro', texto: TEXTO_DOS_EPISODIOS.soRascunho }, { tipo: 'erro' })
      return
    }
    void escrever(() => servicos.episodios.remover(e.id), 'episodio', TEXTO_DOS_EPISODIOS.excluido, { tipo: 'status' }, {
      aoDarCerto: () => {
        definirAberto(null)
        setConfirmarEpisodio(false)
      },
      aoFalhar: () => setConfirmarEpisodio(false),
    })
  }

  // ——— Avisos ———

  function aoGravarAviso(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (episodio === null || avisos === null || escrevendo.current) return
    const imagemMidiaId = formulario.imagem === '' ? null : formulario.imagem
    const duracaoS = Number(formulario.duracao)
    const recusa = conferirAviso({ titulo: formulario.titulo, link: formulario.link, duracaoS, imagemMidiaId }, imagens)
    if (recusa !== null) {
      mostrar({ tom: 'erro', texto: TEXTO_DA_RECUSA[recusa] }, { tipo: 'erro' })
      if (recusa === 'imagem_inexistente') void carregar()
      return
    }
    const link = normalizarLink(formulario.link)
    // o texto vai como digitado (as quebras de linha contam); o link, já normalizado (`https://…` ou nulo)
    const campos = { titulo: formulario.titulo.trim(), texto: formulario.texto, link: link.ok ? link.link : null, imagemMidiaId, duracaoS }
    const limpar = () => {
      setFormulario(AVISO_EM_BRANCO)
      definirEditando(null)
    }
    if (editando !== null) {
      const id = editando
      const ordem = avisos.find((a) => a.id === id)?.ordem ?? 0
      void escrever(() => servicos.episodios.alterarAviso(id, { ...campos, ordem }), 'aviso', TEXTO_DOS_EPISODIOS.avisoSalvo, { tipo: 'botao', chave: `editar:${id}` }, {
        aoDarCerto: limpar,
      })
      return
    }
    const episodioId = episodio.id
    void escrever(() => servicos.episodios.incluirAviso({ episodioId, ...campos, ordem: proximaOrdem(avisos) }), 'aviso', TEXTO_DOS_EPISODIOS.avisoIncluido, { tipo: 'aviso' }, {
      aoDarCerto: limpar,
    })
  }

  function aoEditarAviso(a: Aviso) {
    setConfirmarAviso(null)
    definirEditando(a.id)
    setFormulario({
      titulo: a.titulo,
      texto: a.texto,
      link: a.link ?? '',
      // imagem que saiu da Biblioteca volta para "Sem imagem" (o banco já pôs nulo ou vai recusar)
      imagem: a.imagemMidiaId !== null && imagens.some((m) => m.id === a.imagemMidiaId) ? a.imagemMidiaId : '',
      duracao: String(a.duracaoS),
    })
    focoPendente.current = { tipo: 'aviso' }
  }

  function aoCancelarEdicao() {
    const id = editando
    definirEditando(null)
    setFormulario(AVISO_EM_BRANCO)
    focoPendente.current = id === null ? { tipo: 'aviso' } : { tipo: 'botao', chave: `editar:${id}` }
  }

  function aoTeclarNoFormulario(evento: KeyboardEvent<HTMLFormElement>) {
    if (evento.key === 'Escape' && editando !== null) {
      evento.preventDefault()
      aoCancelarEdicao()
    }
  }

  /**
   * Sobe ou desce um aviso. `trocarOrdem` devolve o par trocado ou, com ordens repetidas (padrão 0), a
   * lista inteira renumerada; grava só os avisos cuja ordem mudou, um por vez. Falha no meio recarrega.
   */
  function aoMover(a: Aviso, direcao: Direcao) {
    if (avisos === null || escrevendo.current) return
    const atuais = new Map(avisos.map((x) => [x.id, x.ordem]))
    const mudancas = trocarOrdem(avisos, a.id, direcao).filter((m) => atuais.get(m.id) !== m.ordem)
    if (mudancas.length === 0) return
    void escrever(
      async () => {
        for (const m of mudancas) await servicos.episodios.alterarOrdemDoAviso(m.id, m.ordem)
      },
      'aviso',
      TEXTO_DOS_EPISODIOS.ordem,
      { tipo: 'ordem', id: a.id, direcao },
      { recarregarSempre: true },
    )
  }

  function aoConfirmarExclusaoDoAviso(a: Aviso) {
    void escrever(() => servicos.episodios.removerAviso(a.id), 'aviso', TEXTO_DOS_EPISODIOS.avisoExcluido, { tipo: 'status' }, {
      aoDarCerto: () => setConfirmarAviso(null),
      aoFalhar: () => setConfirmarAviso(null),
    })
  }

  /** Miniatura pedida só no clique; a URL assinada só é usada se for `https:` (ou `http:` local), como na Biblioteca. */
  async function aoAlternarPrevia(a: Aviso, m: Midia) {
    if (previas[a.id] !== undefined) {
      setPrevias((p) => {
        const resto = { ...p }
        delete resto[a.id]
        return resto
      })
      return
    }
    if (pedindoPrevia.current.has(a.id)) return
    pedindoPrevia.current.add(a.id)
    try {
      const url = await servicos.armazenamento.urlDePrevia(m.caminho)
      if (!urlDePreviaAceita(url)) throw new ErroDePreparacao('outro')
      if (montada.current) setPrevias((p) => ({ ...p, [a.id]: url }))
    } catch (erro) {
      if (montada.current) tratarErro(erro, 'aviso', false)
    } finally {
      pedindoPrevia.current.delete(a.id)
    }
  }

  // ——— Partes da tela ———

  function linkDoAviso(a: Aviso): ReactNode {
    if (a.link === null) return null
    const conferido = normalizarLink(a.link)
    // só vira `<a>` o link que o domínio aceita (`https:` sem usuário nem senha); o resto é só texto
    if (conferido.ok && conferido.link !== null) {
      return (
        <p className="aviso-cartao__link">
          Link:{' '}
          <a href={conferido.link} target="_blank" rel="noopener noreferrer">
            {conferido.link}
          </a>
        </p>
      )
    }
    return (
      <p className="aviso-cartao__link">
        Link fora do formato (não abre): <span className="aviso-cartao__url">{a.link}</span>
      </p>
    )
  }

  function imagemDoAviso(a: Aviso): ReactNode {
    const m = a.imagemMidiaId === null ? undefined : imagens.find((x) => x.id === a.imagemMidiaId)
    // sem imagem, ou imagem que saiu da Biblioteca: "Sem imagem", sem quebrar o cartão
    if (m === undefined) return <p className="aviso-cartao__fraco">{TEXTO_DOS_EPISODIOS.semImagem}</p>
    const previa = previas[a.id]
    return (
      <div className="aviso-cartao__imagem">
        <p>
          Imagem: <span className="aviso-cartao__nome">{m.nome}</span>
        </p>
        <button type="button" className="botao botao--pequeno botao--contorno" onClick={() => void aoAlternarPrevia(a, m)}>
          {previa !== undefined ? 'Ocultar imagem' : 'Ver imagem'}
        </button>
        {previa !== undefined && <img className="previa" src={previa} alt={m.nome} />}
      </div>
    )
  }

  function acoesDoAviso(a: Aviso, i: number, total: number): ReactNode {
    if (confirmarAviso === a.id) {
      return (
        <div className="confirmacao-na-linha">
          <span>Excluir este aviso?</span>
          <div className="tabela__acoes">
            <button type="button" className="botao botao--pequeno" disabled={ocupado} onClick={() => aoConfirmarExclusaoDoAviso(a)}>
              Confirmar exclusão
            </button>
            <button
              ref={refDoBotao(`manter:${a.id}`)}
              type="button"
              className="botao botao--pequeno botao--contorno"
              disabled={ocupado}
              onClick={() => {
                setConfirmarAviso(null)
                focoPendente.current = { tipo: 'botao', chave: `excluir:${a.id}` }
              }}
            >
              Manter
            </button>
          </div>
        </div>
      )
    }
    return (
      <div className="tabela__acoes">
        <button ref={refDoBotao(`subir:${a.id}`)} type="button" className="botao botao--pequeno botao--contorno" disabled={ocupado || i === 0} onClick={() => aoMover(a, 'subir')}>
          Subir
        </button>
        <button
          ref={refDoBotao(`descer:${a.id}`)}
          type="button"
          className="botao botao--pequeno botao--contorno"
          disabled={ocupado || i === total - 1}
          onClick={() => aoMover(a, 'descer')}
        >
          Descer
        </button>
        {/* uma edição por vez: com um aviso no formulário, "Editar" fica desabilitado em todos */}
        <button ref={refDoBotao(`editar:${a.id}`)} type="button" className="botao botao--pequeno botao--ciano" disabled={ocupado || editando !== null} onClick={() => aoEditarAviso(a)}>
          Editar
        </button>
        <button
          ref={refDoBotao(`excluir:${a.id}`)}
          type="button"
          className="botao botao--pequeno botao--contorno"
          disabled={ocupado || editando === a.id}
          onClick={() => {
            setConfirmarAviso(a.id)
            focoPendente.current = { tipo: 'botao', chave: `manter:${a.id}` }
          }}
        >
          Excluir
        </button>
      </div>
    )
  }

  function lista(): ReactNode {
    const episodios = porData(dados?.episodios ?? [])
    return (
      <>
        <h3 id={`${prefixo}-novo`}>Novo episódio</h3>
        <form className="formulario-em-linha" aria-labelledby={`${prefixo}-novo`} onSubmit={aoCriar} noValidate>
          <div className="campo">
            <label htmlFor={`${prefixo}-titulo`}>Título</label>
            <input ref={novoRef} id={`${prefixo}-titulo`} type="text" autoComplete="off" value={novoTitulo} onChange={(e) => setNovoTitulo(e.target.value)} />
          </div>
          <div className="campo campo--data">
            <label htmlFor={`${prefixo}-data`}>Data</label>
            <input id={`${prefixo}-data`} type="date" value={novaData} onChange={(e) => setNovaData(e.target.value)} />
          </div>
          <button type="submit" className="botao" disabled={ocupado || dados === null}>
            Criar episódio
          </button>
        </form>
        {carga.tipo === 'carregando' && <p role="status">Carregando os episódios…</p>}
        {carga.tipo === 'falha' && (
          <>
            <Mensagem tom="erro">{TEXTO_DOS_EPISODIOS.naoCarregou}</Mensagem>
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
        {dados === null ? null : episodios.length === 0 ? (
          <p className="tabela__fraco">Nenhum episódio ainda.</p>
        ) : (
          <div className="tabela-rolavel">
            <table className="tabela">
              <caption>Episódios ({episodios.length})</caption>
              <thead>
                <tr>
                  <th scope="col">Título</th>
                  <th scope="col">Data</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Ações</th>
                </tr>
              </thead>
              <tbody>
                {episodios.map((e) => (
                  <tr key={e.id}>
                    <td className="tabela__nome">{e.titulo}</td>
                    <td>{dataNaTela(e.data)}</td>
                    <td>{ROTULO_DO_ESTADO[e.estado]}</td>
                    <td>
                      <button ref={refDoBotao(`abrir:${e.id}`)} type="button" className="botao botao--pequeno botao--ciano" disabled={ocupado} onClick={() => aoAbrir(e)}>
                        Abrir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    )
  }

  function episodioAberto(e: Episodio): ReactNode {
    const idForm = `${prefixo}-ep`
    const idAviso = `${prefixo}-aviso`
    return (
      <section className="episodio" aria-labelledby={`${idForm}-cabecalho`}>
        <div className="episodio__cabeca">
          <h3 ref={cabecalhoRef} id={`${idForm}-cabecalho`} tabIndex={-1}>
            {e.titulo}
          </h3>
          <span className="etiqueta">{ROTULO_DO_ESTADO[e.estado]}</span>
          <button type="button" className="botao botao--pequeno botao--contorno" disabled={ocupado} onClick={() => aoFechar(e)}>
            Fechar
          </button>
        </div>

        <form className="formulario-em-linha" aria-label="Dados do episódio" onSubmit={(ev) => aoSalvarEpisodio(ev, e)} noValidate>
          <div className="campo">
            <label htmlFor={`${idForm}-titulo`}>Título</label>
            <input
              id={`${idForm}-titulo`}
              type="text"
              autoComplete="off"
              value={dadosDoEpisodio.titulo}
              onChange={(ev) => setDadosDoEpisodio({ ...dadosDoEpisodio, titulo: ev.target.value })}
            />
          </div>
          <div className="campo campo--data">
            <label htmlFor={`${idForm}-data`}>Data</label>
            <input id={`${idForm}-data`} type="date" value={dadosDoEpisodio.data} onChange={(ev) => setDadosDoEpisodio({ ...dadosDoEpisodio, data: ev.target.value })} />
          </div>
          <button type="submit" className="botao botao--ciano" disabled={ocupado}>
            Salvar
          </button>
        </form>

        {podeExcluirEpisodio(e) ? (
          confirmarEpisodio ? (
            <div className="confirmacao-na-linha">
              <span>{textoDaExclusao(avisos?.length ?? 0)}</span>
              <div className="tabela__acoes">
                <button type="button" className="botao botao--pequeno" disabled={ocupado || avisos === null} onClick={() => aoConfirmarExclusaoDoEpisodio(e)}>
                  Confirmar exclusão
                </button>
                <button
                  ref={refDoBotao('manter-episodio')}
                  type="button"
                  className="botao botao--pequeno botao--contorno"
                  disabled={ocupado}
                  onClick={() => {
                    setConfirmarEpisodio(false)
                    focoPendente.current = { tipo: 'botao', chave: 'excluir-episodio' }
                  }}
                >
                  Manter
                </button>
              </div>
            </div>
          ) : (
            <button
              ref={refDoBotao('excluir-episodio')}
              type="button"
              className="botao botao--pequeno botao--contorno"
              disabled={ocupado}
              onClick={() => {
                setConfirmarEpisodio(true)
                focoPendente.current = { tipo: 'botao', chave: 'manter-episodio' }
              }}
            >
              Excluir episódio
            </button>
          )
        ) : (
          <p className="tabela__fraco">{TEXTO_DOS_EPISODIOS.soRascunho}</p>
        )}

        <h4>Avisos</h4>
        {avisos === null ? (
          <p role="status">Carregando os avisos…</p>
        ) : avisos.length === 0 ? (
          <p className="tabela__fraco">Nenhum aviso ainda.</p>
        ) : (
          <ol className="avisos" aria-label="Avisos do episódio">
            {avisos.map((a, i) => (
              <li key={a.id} className={editando === a.id ? 'aviso-cartao aviso-cartao--editando' : 'aviso-cartao'}>
                <div className="aviso-cartao__cabeca">
                  <span className="aviso-cartao__ordem">{`${i + 1}.`}</span>
                  <strong className="aviso-cartao__titulo">{a.titulo}</strong>
                  <span className="aviso-cartao__duracao">{`${a.duracaoS} s`}</span>
                </div>
                {a.texto !== '' && <p className="aviso-cartao__texto">{a.texto}</p>}
                {linkDoAviso(a)}
                {imagemDoAviso(a)}
                {acoesDoAviso(a, i, avisos.length)}
              </li>
            ))}
          </ol>
        )}

        <h4 id={`${idAviso}-cabecalho`}>{editando !== null ? 'Editar aviso' : 'Novo aviso'}</h4>
        <form className="aviso-formulario" aria-labelledby={`${idAviso}-cabecalho`} onSubmit={aoGravarAviso} onKeyDown={aoTeclarNoFormulario} noValidate>
          <div className="campo">
            <label htmlFor={`${idAviso}-titulo`}>Título do aviso</label>
            <input
              ref={avisoRef}
              id={`${idAviso}-titulo`}
              type="text"
              autoComplete="off"
              value={formulario.titulo}
              onChange={(ev) => setFormulario({ ...formulario, titulo: ev.target.value })}
            />
          </div>
          <div className="campo">
            <label htmlFor={`${idAviso}-texto`}>Texto</label>
            <textarea id={`${idAviso}-texto`} rows={3} value={formulario.texto} onChange={(ev) => setFormulario({ ...formulario, texto: ev.target.value })} />
          </div>
          <div className="campo">
            <label htmlFor={`${idAviso}-link`}>Link</label>
            <input
              id={`${idAviso}-link`}
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="https://"
              aria-describedby={`${idAviso}-dica-link`}
              value={formulario.link}
              onChange={(ev) => setFormulario({ ...formulario, link: ev.target.value })}
            />
            <span id={`${idAviso}-dica-link`} className="formulario-em-linha__dica">
              Opcional; só endereços que começam com https://.
            </span>
          </div>
          <div className="aviso-formulario__linha">
            <div className="campo">
              <label htmlFor={`${idAviso}-imagem`}>Imagem</label>
              <select id={`${idAviso}-imagem`} value={formulario.imagem} onChange={(ev) => setFormulario({ ...formulario, imagem: ev.target.value })}>
                <option value="">{TEXTO_DOS_EPISODIOS.semImagem}</option>
                {imagens.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo campo--curto">
              <label htmlFor={`${idAviso}-duracao`}>Duração (segundos)</label>
              <input
                id={`${idAviso}-duracao`}
                type="number"
                inputMode="numeric"
                min={1}
                max={600}
                step={1}
                value={formulario.duracao}
                onChange={(ev) => setFormulario({ ...formulario, duracao: ev.target.value })}
              />
            </div>
          </div>
          <div className="tabela__acoes">
            <button type="submit" className="botao" disabled={ocupado || avisos === null}>
              {editando !== null ? 'Salvar aviso' : 'Incluir aviso'}
            </button>
            {editando !== null && (
              <button type="button" className="botao botao--contorno" disabled={ocupado} onClick={aoCancelarEdicao}>
                Cancelar edição
              </button>
            )}
          </div>
        </form>
      </section>
    )
  }

  return (
    <div className="episodios">
      <h2>Episódios</h2>
      <p className="episodios__nota">{TEXTO_DOS_EPISODIOS.notaE3}</p>
      {/* Regiões de aviso sempre montadas (o texto entra depois, para o leitor de tela anunciar); vazias, ficam
          fora do fluxo (.so-leitor). `tabIndex={-1}` deixa o foco ir para elas depois de uma ação. */}
      <div ref={statusRef} role="status" tabIndex={-1} className={recado?.tom === 'info' ? 'mensagem' : 'so-leitor'}>
        {recado?.tom === 'info' ? recado.texto : null}
      </div>
      <div ref={erroRef} role="alert" tabIndex={-1} className={recado?.tom === 'erro' ? 'mensagem mensagem--erro' : 'so-leitor'}>
        {recado?.tom === 'erro' ? recado.texto : null}
      </div>

      {episodio !== null ? episodioAberto(episodio) : lista()}
    </div>
  )
}
