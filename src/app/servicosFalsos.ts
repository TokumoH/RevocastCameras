/**
 * Serviços e dependências falsos para os testes de tela (só para testes: não importa `vitest` nem Supabase).
 * Implementam as portas do domínio Acesso (e, desde a E2, as da Preparação: vazias em `preparacaoVazia` e,
 * desde a Tarefa 5 da E2, com estado em `criarFalsosDePreparacao`, mais `arquivoDeTeste`)
 * e imitam o que o supabase-js faz e muda a tela: `sair()` põe a sessão em `null` e emite a mudança de
 * sessão (o `SIGNED_OUT`) **antes** de resolver, como o `signOut` real, que só resolve depois do
 * `POST /auth/v1/logout`.
 */
import type { MembroPermitido, PerfilDeMembro } from '../domains/acesso/listaDeAcesso'
import type { Papel } from '../domains/acesso/papeis'
import { ErroDeAcesso } from '../domains/acesso/portas'
import type { RepositorioDeAcesso, ServicoDeAutenticacao, ServicosDeMembro } from '../domains/acesso/portas'
import type { RetornoDoLogin } from '../domains/acesso/retornoDoLogin'
import type { UsuarioDaSessao } from '../domains/acesso/sessao'
import type { Cena } from '../domains/preparacao/cenas'
import type { Aviso, Episodio } from '../domains/preparacao/episodios'
import { GESTOS } from '../domains/preparacao/gestos'
import type { LinhaDoMapa } from '../domains/preparacao/gestos'
import type { Midia, Som } from '../domains/preparacao/midia'
import { ErroDePreparacao } from '../domains/preparacao/portas'
import type { NovaMidia, OpcoesDoEnvio, ServicosDePreparacao } from '../domains/preparacao/portas'
import type { Dependencias } from './dependencias'

/**
 * Serviços da Preparação sem nada: listas vazias; escritas, envio, remoção e prévia resolvem sem efeito
 * (a prévia, com texto vazio). Para os testes de tela que não usam a Preparação (as telas da E1).
 */
export function preparacaoVazia(): ServicosDePreparacao {
  const nada = async () => {}
  return {
    midias: { listar: async () => [], registrar: nada, remover: nada, contarAvisosComImagem: async () => 0 },
    sons: { listar: async () => [], incluir: nada, alterar: nada },
    cenas: { listar: async () => [], incluir: nada, alterar: nada, remover: nada },
    episodios: {
      listar: async () => [],
      incluir: nada,
      alterar: nada,
      remover: nada,
      listarAvisos: async () => [],
      incluirAviso: nada,
      alterarAviso: nada,
      alterarOrdemDoAviso: nada,
      removerAviso: nada,
    },
    gestos: { listar: async () => [], alterar: nada },
    armazenamento: { enviar: nada, remover: nada, urlDePrevia: async () => '' },
  }
}

export function usuarioGoogle(email: string, id: string = `id-${email}`): UsuarioDaSessao {
  return { id, email, anonimo: false, provedor: 'google' }
}

type MetodoQueFalha = 'incluir' | 'alterarPapel' | 'remover' | 'listarPermitidos'

function valorOuErro<T>(valor: T | ErroDeAcesso): T {
  if (valor instanceof ErroDeAcesso) throw valor
  return valor
}

export function criarFalsos(
  inicial: {
    usuario?: UsuarioDaSessao | null | ErroDeAcesso
    papel?: Papel | null | ErroDeAcesso
    permitidos?: MembroPermitido[]
    perfis?: PerfilDeMembro[]
  } = {},
) {
  let usuario = inicial.usuario ?? null
  let papel = inicial.papel ?? null
  let permitidos: MembroPermitido[] = [...(inicial.permitidos ?? [])]
  const perfis: PerfilDeMembro[] = [...(inicial.perfis ?? [])]
  const ouvintesDeSessao = new Set<() => void>()
  const ouvintesDeVolta = new Set<() => void>()
  const falhas = new Map<MetodoQueFalha, ErroDeAcesso>()
  let segurandoSair = false
  const sairPendentes: (() => void)[] = []

  const chamadas = {
    usuarioAtual: 0,
    entrar: [] as string[],
    sair: 0,
    obterServicos: 0,
    navegar: [] as string[],
    limpar: [] as RetornoDoLogin[],
    incluir: [] as unknown[][],
    alterar: [] as unknown[][],
    remover: [] as string[],
  }

  function falhaPendente(metodo: MetodoQueFalha): void {
    const erro = falhas.get(metodo)
    if (erro) {
      falhas.delete(metodo)
      throw erro
    }
  }

  function dispararMudancaDeSessao(): void {
    for (const ouvinte of [...ouvintesDeSessao]) ouvinte()
  }

  const auth: ServicoDeAutenticacao = {
    async usuarioAtual() {
      chamadas.usuarioAtual++
      return valorOuErro(usuario)
    },
    aoMudarSessao(ouvinte) {
      ouvintesDeSessao.add(ouvinte)
      return () => {
        ouvintesDeSessao.delete(ouvinte)
      }
    },
    async entrarComGoogle(urlDeRetorno) {
      chamadas.entrar.push(urlDeRetorno)
    },
    sair() {
      chamadas.sair++
      usuario = null
      // Ordem do supabase-js real: o SIGNED_OUT sai antes de o signOut resolver.
      queueMicrotask(dispararMudancaDeSessao)
      return new Promise<void>((resolve) => {
        if (segurandoSair) sairPendentes.push(resolve)
        else setTimeout(resolve, 0)
      })
    },
  }

  const repo: RepositorioDeAcesso = {
    async papelAtual() {
      return valorOuErro(papel)
    },
    async listarPermitidos() {
      falhaPendente('listarPermitidos')
      return permitidos.map((m) => ({ ...m }))
    },
    async listarPerfis() {
      return perfis.map((p) => ({ ...p }))
    },
    async incluir(email, novoPapel, criadoPor) {
      chamadas.incluir.push([email, novoPapel, criadoPor])
      falhaPendente('incluir')
      if (permitidos.some((m) => m.email === email)) throw new ErroDeAcesso('duplicado')
      permitidos.push({ email, papel: novoPapel, criadoPor })
    },
    async alterarPapel(email, novoPapel) {
      chamadas.alterar.push([email, novoPapel])
      falhaPendente('alterarPapel')
      const linha = permitidos.find((m) => m.email === email)
      if (!linha) throw new ErroDeAcesso('nada_alterado')
      linha.papel = novoPapel
    },
    async remover(email) {
      chamadas.remover.push(email)
      falhaPendente('remover')
      if (!permitidos.some((m) => m.email === email)) throw new ErroDeAcesso('nada_alterado')
      permitidos = permitidos.filter((m) => m.email !== email)
    },
  }

  const servicos: ServicosDeMembro = { auth, repo }

  return {
    servicos,
    chamadas,
    dependencias(extra: Partial<Dependencias> = {}): Dependencias {
      return {
        obterServicos: () => {
          chamadas.obterServicos++
          return servicos
        },
        obterPreparacao: () => preparacaoVazia(),
        navegar: (caminho) => {
          chamadas.navegar.push(caminho)
        },
        origem: 'https://app.revocast.test',
        busca: '',
        fragmento: '',
        limparRetornoDaUrl: (retorno) => {
          chamadas.limpar.push(retorno)
        },
        aoVoltarAVer: (ouvinte) => {
          ouvintesDeVolta.add(ouvinte)
          return () => {
            ouvintesDeVolta.delete(ouvinte)
          }
        },
        ...extra,
      }
    },
    definirUsuario(u: UsuarioDaSessao | null | ErroDeAcesso): void {
      usuario = u
    },
    definirPapel(p: Papel | null | ErroDeAcesso): void {
      papel = p
    },
    /** A partir daqui, `sair()` emite a mudança de sessão e só resolve quando `liberarSair()` for chamado. */
    segurarSair(): void {
      segurandoSair = true
    },
    liberarSair(): void {
      segurandoSair = false
      for (const resolve of sairPendentes.splice(0)) resolve()
    },
    falharProxima(metodo: MetodoQueFalha, erro: ErroDeAcesso): void {
      falhas.set(metodo, erro)
    },
    dispararMudancaDeSessao,
    /** Quantos ouvintes de sessão e de volta à aba estão assinados (para conferir o cancelamento na desmontagem). */
    ouvintesAtivos(): { sessao: number; volta: number } {
      return { sessao: ouvintesDeSessao.size, volta: ouvintesDeVolta.size }
    },
    dispararVolta(): void {
      for (const ouvinte of [...ouvintesDeVolta]) ouvinte()
    },
  }
}

/** Envio segurado por `segurarEnvio()`: resolve quando o teste mandar. */
interface EnvioPendente {
  opcoes: OpcoesDoEnvio
  resolver: () => void
}

/**
 * Serviços da Preparação com estado, para os testes de tela (E2, Tarefa 5). Imitam o que muda a tela:
 * o envio emite progresso antes de resolver e respeita o `AbortSignal` (rejeita `cancelado`, como o
 * adaptador); `midias.remover` recusa som ligado a um gesto (`em_uso`, como o `23503` do banco) e tira
 * em cascata o som e a imagem dos avisos; 0 linhas → `nada_alterado`. Cada chamada é anotada **antes**
 * de uma falha programada (`falharProxima('midias.remover', erro)`), que vale para uma chamada só.
 */
export function criarFalsosDePreparacao(
  inicial: {
    midias?: Midia[]
    sons?: Som[]
    cenas?: Cena[]
    episodios?: Episodio[]
    avisos?: Aviso[]
    mapa?: LinhaDoMapa[]
    avisosComImagem?: Record<string, number>
  } = {},
) {
  let midias: Midia[] = (inicial.midias ?? []).map((m) => ({ ...m }))
  let sons: Som[] = (inicial.sons ?? []).map((x) => ({ ...x }))
  let cenas: Cena[] = (inicial.cenas ?? []).map((c) => ({ ...c }))
  let episodios: Episodio[] = (inicial.episodios ?? []).map((e) => ({ ...e }))
  let avisos: Aviso[] = (inicial.avisos ?? []).map((a) => ({ ...a }))
  const mapa: LinhaDoMapa[] = (inicial.mapa ?? GESTOS.map((g) => ({ gesto: g.gesto, acao: 'nenhuma' as const, cenaId: null, somId: null }))).map((l) => ({ ...l }))
  const avisosComImagem: Record<string, number> = { ...(inicial.avisosComImagem ?? {}) }
  const falhas = new Map<string, ErroDePreparacao>()
  let segurando = false
  let pendente: EnvioPendente | null = null
  let proximoId = 1

  const chamadas = {
    enviar: [] as { caminho: string; mime: string }[],
    registrar: [] as NovaMidia[],
    removerMidia: [] as string[],
    removerArquivo: [] as string[],
    incluirSom: [] as unknown[][],
    alterarSom: [] as unknown[][],
    cenas: [] as unknown[][],
    episodios: [] as unknown[][],
    avisos: [] as unknown[][],
    gestos: [] as LinhaDoMapa[],
    /** Caminhos pedidos a `urlDePrevia` (a prévia só pode ser pedida quando a pessoa clica). */
    previa: [] as string[],
  }

  function falhaPendente(metodo: string): void {
    const erro = falhas.get(metodo)
    if (erro) {
      falhas.delete(metodo)
      throw erro
    }
  }

  const nadaAlterado = () => new ErroDePreparacao('nada_alterado')

  const servicos: ServicosDePreparacao = {
    midias: {
      async listar() {
        falhaPendente('midias.listar')
        return midias.map((m) => ({ ...m }))
      },
      async registrar(m) {
        chamadas.registrar.push({ ...m })
        falhaPendente('midias.registrar')
        midias.push({ ...m })
      },
      async remover(id) {
        chamadas.removerMidia.push(id)
        falhaPendente('midias.remover')
        if (!midias.some((m) => m.id === id)) throw nadaAlterado()
        const idsDosSons = new Set(sons.filter((x) => x.midiaId === id).map((x) => x.id))
        if (mapa.some((l) => l.somId !== null && idsDosSons.has(l.somId))) throw new ErroDePreparacao('em_uso')
        midias = midias.filter((m) => m.id !== id)
        sons = sons.filter((x) => x.midiaId !== id)
        avisos = avisos.map((a) => (a.imagemMidiaId === id ? { ...a, imagemMidiaId: null } : a))
        delete avisosComImagem[id]
      },
      async contarAvisosComImagem(id) {
        falhaPendente('midias.contarAvisosComImagem')
        return avisosComImagem[id] ?? avisos.filter((a) => a.imagemMidiaId === id).length
      },
    },
    sons: {
      async listar() {
        falhaPendente('sons.listar')
        return sons.map((x) => ({ ...x }))
      },
      async incluir(midiaId, s) {
        chamadas.incluirSom.push([midiaId, { ...s }])
        falhaPendente('sons.incluir')
        sons.push({ id: `som-${proximoId++}`, midiaId, ...s })
      },
      async alterar(id, s) {
        chamadas.alterarSom.push([id, { ...s }])
        falhaPendente('sons.alterar')
        const i = sons.findIndex((x) => x.id === id)
        if (i < 0) throw nadaAlterado()
        sons[i] = { ...sons[i], ...s }
      },
    },
    cenas: {
      async listar() {
        falhaPendente('cenas.listar')
        return cenas.map((c) => ({ ...c }))
      },
      async incluir(c) {
        chamadas.cenas.push(['incluir', { ...c }])
        falhaPendente('cenas.incluir')
        if (cenas.some((x) => x.nomeObs === c.nomeObs)) throw new ErroDePreparacao('duplicado')
        cenas.push({ id: `cena-${proximoId++}`, ...c })
      },
      async alterar(id, c) {
        chamadas.cenas.push(['alterar', id, { ...c }])
        falhaPendente('cenas.alterar')
        const i = cenas.findIndex((x) => x.id === id)
        if (i < 0) throw nadaAlterado()
        if (cenas.some((x) => x.id !== id && x.nomeObs === c.nomeObs)) throw new ErroDePreparacao('duplicado')
        cenas[i] = { id, ...c }
      },
      async remover(id) {
        chamadas.cenas.push(['remover', id])
        falhaPendente('cenas.remover')
        if (!cenas.some((x) => x.id === id)) throw nadaAlterado()
        if (mapa.some((l) => l.cenaId === id)) throw new ErroDePreparacao('em_uso')
        cenas = cenas.filter((x) => x.id !== id)
      },
    },
    episodios: {
      async listar() {
        falhaPendente('episodios.listar')
        return episodios.map((e) => ({ ...e }))
      },
      async incluir(e) {
        chamadas.episodios.push(['incluir', { ...e }])
        falhaPendente('episodios.incluir')
        episodios.push({ id: `episodio-${proximoId++}`, titulo: e.titulo, data: e.data, estado: 'rascunho' })
      },
      async alterar(id, e) {
        chamadas.episodios.push(['alterar', id, { ...e }])
        falhaPendente('episodios.alterar')
        const i = episodios.findIndex((x) => x.id === id)
        if (i < 0) throw nadaAlterado()
        episodios[i] = { ...episodios[i], titulo: e.titulo, data: e.data }
      },
      async remover(id) {
        chamadas.episodios.push(['remover', id])
        falhaPendente('episodios.remover')
        if (!episodios.some((x) => x.id === id)) throw nadaAlterado()
        episodios = episodios.filter((x) => x.id !== id)
        avisos = avisos.filter((a) => a.episodioId !== id)
      },
      async listarAvisos(episodioId) {
        falhaPendente('episodios.listarAvisos')
        return avisos.filter((a) => a.episodioId === episodioId).map((a) => ({ ...a }))
      },
      async incluirAviso(a) {
        chamadas.avisos.push(['incluir', { ...a }])
        falhaPendente('episodios.incluirAviso')
        avisos.push({ id: `aviso-${proximoId++}`, ...a })
      },
      async alterarAviso(id, a) {
        chamadas.avisos.push(['alterar', id, { ...a }])
        falhaPendente('episodios.alterarAviso')
        const i = avisos.findIndex((x) => x.id === id)
        if (i < 0) throw nadaAlterado()
        avisos[i] = { ...avisos[i], ...a }
      },
      async alterarOrdemDoAviso(id, ordem) {
        chamadas.avisos.push(['ordem', id, ordem])
        falhaPendente('episodios.alterarOrdemDoAviso')
        const i = avisos.findIndex((x) => x.id === id)
        if (i < 0) throw nadaAlterado()
        avisos[i] = { ...avisos[i], ordem }
      },
      async removerAviso(id) {
        chamadas.avisos.push(['remover', id])
        falhaPendente('episodios.removerAviso')
        if (!avisos.some((x) => x.id === id)) throw nadaAlterado()
        avisos = avisos.filter((x) => x.id !== id)
      },
    },
    gestos: {
      async listar() {
        falhaPendente('gestos.listar')
        return mapa.map((l) => ({ ...l }))
      },
      async alterar(l) {
        chamadas.gestos.push({ ...l })
        falhaPendente('gestos.alterar')
        const i = mapa.findIndex((x) => x.gesto === l.gesto)
        if (i < 0) throw nadaAlterado()
        mapa[i] = { ...l }
      },
    },
    armazenamento: {
      enviar(caminho, _corpo, mime, opcoes) {
        chamadas.enviar.push({ caminho, mime })
        return new Promise<void>((resolve, reject) => {
          const { sinal } = opcoes
          if (sinal.aborted) {
            reject(new ErroDePreparacao('cancelado'))
            return
          }
          let terminou = false
          const aoAbortar = () => {
            if (terminou) return
            terminou = true
            if (pendente?.opcoes === opcoes) pendente = null
            reject(new ErroDePreparacao('cancelado'))
          }
          sinal.addEventListener('abort', aoAbortar, { once: true })
          const concluir = () => {
            if (terminou) return
            sinal.removeEventListener('abort', aoAbortar)
            try {
              falhaPendente('armazenamento.enviar')
            } catch (erro) {
              terminou = true
              reject(erro)
              return
            }
            terminou = true
            resolve()
          }
          if (segurando) {
            pendente = { opcoes, resolver: concluir }
            return
          }
          // como o adaptador: progresso antes de resolver
          queueMicrotask(() => {
            if (terminou) return
            opcoes.aoProgredir(0.5)
            opcoes.aoProgredir(1)
            concluir()
          })
        })
      },
      async remover(caminho) {
        chamadas.removerArquivo.push(caminho)
        falhaPendente('armazenamento.remover')
      },
      async urlDePrevia(caminho) {
        chamadas.previa.push(caminho)
        falhaPendente('armazenamento.urlDePrevia')
        return `https://armazenamento.revocast.test/assinada/${caminho}?token=teste`
      },
    },
  }

  return {
    servicos,
    chamadas,
    /** A próxima chamada de `metodo` (por exemplo `'midias.remover'`) lança `erro`; vale uma vez. */
    falharProxima(metodo: string, erro: ErroDePreparacao): void {
      falhas.set(metodo, erro)
    },
    /**
     * A partir daqui, todo envio fica pendente até o teste mandar: `progredir(fracao)` avisa a tela do
     * progresso do envio pendente e `concluir()` o resolve (o próximo envio também fica pendente). O
     * "Cancelar" da tela rejeita o pendente com `cancelado`; `concluir()` depois disso não faz nada.
     */
    segurarEnvio(): { progredir(fracao: number): void; concluir(): void } {
      segurando = true
      return {
        progredir(fracao) {
          pendente?.opcoes.aoProgredir(fracao)
        },
        concluir() {
          const atual = pendente
          pendente = null
          atual?.resolver()
        },
      }
    },
  }
}

/** Primeiros bytes de cada tipo de arquivo de teste (bytes mágicos). */
const CABECALHO_DE_TESTE: Record<'png' | 'mp3' | 'html' | 'svg', number[]> = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  mp3: [0x49, 0x44, 0x33, 0x04, 0x00, 0x00],
  html: Array.from('<!doctype html><script>', (c) => c.charCodeAt(0)),
  svg: Array.from('<svg xmlns="http://www.w3.org/2000/svg">', (c) => c.charCodeAt(0)),
}

/** O `File.type` que o navegador daria pela extensão do nome (a tela não confia nele: o tipo vem dos bytes). */
const TIPO_PELO_NOME: Record<string, string> = {
  png: 'image/png',
  mp3: 'audio/mpeg',
  html: 'text/html',
  svg: 'image/svg+xml',
}

/**
 * Arquivo gerado em memória (nenhum binário versionado): os bytes mágicos do `tipo` e enchimento com
 * zeros até `tamanho` (padrão 1 024 bytes; com `tamanho` menor que o cabeçalho, o cabeçalho é cortado).
 */
export function arquivoDeTeste(tipo: 'png' | 'mp3' | 'html' | 'svg', nome: string, tamanho = 1024): File {
  const bytes = new Uint8Array(tamanho)
  bytes.set(CABECALHO_DE_TESTE[tipo].slice(0, tamanho))
  const extensao = /\.([^./\\]+)$/.exec(nome)?.[1]?.toLowerCase() ?? ''
  return new File([bytes], nome, { type: TIPO_PELO_NOME[extensao] ?? '' })
}
