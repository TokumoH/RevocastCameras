/**
 * Serviços e dependências falsos para os testes de tela (só para testes: não importa `vitest` nem o
 * supabase-js em tempo de execução).
 * Implementam as portas do domínio Acesso (e, desde a E2, as da Preparação: vazias em `preparacaoVazia` e,
 * desde a Tarefa 5 da E2, com estado em `criarFalsosDePreparacao`, mais `arquivoDeTeste`; desde a E3, as do
 * ao vivo e do dispositivo: `aoVivoVazio`, `criarCanalFalso` e `criarFalsosDeDispositivo`)
 * e imitam o que o supabase-js faz e muda a tela: `sair()` põe a sessão em `null` e emite a mudança de
 * sessão (o `SIGNED_OUT`) **antes** de resolver, como o `signOut` real, que só resolve depois do
 * `POST /auth/v1/logout`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TipoDeDispositivo } from '../domains/acesso/dispositivos'
import type { MembroPermitido, PerfilDeMembro } from '../domains/acesso/listaDeAcesso'
import type { Papel } from '../domains/acesso/papeis'
import { ErroDeAcesso } from '../domains/acesso/portas'
import type { RepositorioDeAcesso, ServicoDeAutenticacao, ServicosDeMembro } from '../domains/acesso/portas'
import type { RetornoDoLogin } from '../domains/acesso/retornoDoLogin'
import type { UsuarioDaSessao } from '../domains/acesso/sessao'
import { ErroDeDispositivo } from '../domains/acesso/portasDeDispositivo'
import type { ServicoDeDispositivo } from '../domains/acesso/portasDeDispositivo'
import type { LinhaDoRegistro } from '../domains/aovivo/comandos'
import { ErroDoAoVivo } from '../domains/aovivo/portas'
import type { EstadoDoCanal, RepositorioDoAoVivo, RepositorioDoPalco, RespostaDoEnvio } from '../domains/aovivo/portas'
import type {
  CameraDoAparelho,
  ConexaoDeVideo,
  EstadoDaConexao,
  FabricaDeConexoes,
  FaixaDeVideo,
  FalhaDaCamera,
  FluxoDeVideo,
  FonteDeQuadros,
  ManterTelaLigada,
  RespostaDoSinal,
} from '../domains/captura/portas'
import { criarFonteFalsa, criarReconhecedoresFalsos, criarRepoDosGestosFalso } from '../domains/captura/falsos'
import type { Cena } from '../domains/preparacao/cenas'
import type { Aviso, Episodio } from '../domains/preparacao/episodios'
import { GESTOS } from '../domains/preparacao/gestos'
import type { LinhaDoMapa } from '../domains/preparacao/gestos'
import type { Midia, Som } from '../domains/preparacao/midia'
import { ErroDePreparacao } from '../domains/preparacao/portas'
import type { NovaMidia, OpcoesDoEnvio, ServicosDePreparacao } from '../domains/preparacao/portas'
import { criarFabricaDeCanais } from '../shared/infra/canalSupabase'
import { criarRealtimeFalso } from '../shared/infra/realtimeFalso'
import type { Dependencias } from './dependencias'
import type { AparelhoDoDispositivo, CanaisDoDispositivo, ServicosDeAoVivo, ServicosDoDispositivo } from './servicos'

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
    obterAoVivo: 0,
    obterDispositivo: [] as TipoDeDispositivo[],
    limparFragmento: 0,
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
  // Um ao vivo e um dispositivo por tipo para todas as dependências deste conjunto de falsos (como na página).
  let aoVivo: ServicosDeAoVivo | null = null
  const dispositivos = new Map<TipoDeDispositivo, ServicosDoDispositivo>()

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
        obterAoVivo: () => {
          chamadas.obterAoVivo++
          aoVivo ??= aoVivoVazio()
          return aoVivo
        },
        obterDispositivo: (tipo) => {
          chamadas.obterDispositivo.push(tipo)
          let d = dispositivos.get(tipo)
          if (d === undefined) {
            d = criarFalsosDeDispositivo().servicos
            dispositivos.set(tipo, d)
          }
          return d
        },
        limparFragmento: () => {
          chamadas.limparFragmento++
        },
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

/** Status do `realtime-js` que leva cada estado do canal (o adaptador real traduz de volta). */
const STATUS_DO_ESTADO: Readonly<Record<Exclude<EstadoDoCanal, 'conectando'>, ['SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED', Error?]>> = {
  conectado: ['SUBSCRIBED'],
  reconectando: ['TIMED_OUT'],
  fechado: ['CLOSED'],
  negado: ['CHANNEL_ERROR', new Error('Unauthorized: You do not have permissions to read from this Channel topic')],
}

const RESPOSTA_DO_SEND: Readonly<Record<RespostaDoEnvio, 'ok' | 'timed out' | 'error'>> = { ok: 'ok', sem_resposta: 'timed out', falhou: 'error' }

/** O que a `rpc('enviar_sinal_de_video')` devolve para cada resposta do canal de vídeo (o adaptador real traduz de volta). */
const RESPOSTA_DA_FUNCAO: Readonly<Record<RespostaDoSinal, { data: unknown; error: { code: string } | null }>> = {
  ok: { data: 'enviado', error: null },
  sem_par: { data: 'sem_par', error: null },
  limite: { data: null, error: { code: '54000' } },
  falhou: { data: null, error: { code: '42501' } },
}

/**
 * Canais falsos para os testes de tela (E3): o **adaptador real** (`criarFabricaDeCanais`) sobre o
 * cliente Realtime falso de `realtimeFalso.ts`, para que as telas recebam exatamente o que o adaptador
 * entrega (mensagem inválida descartada pelos leitores do domínio, eco local, um canal por tópico com
 * contagem de referências, estado atual para quem chega depois). Por padrão o canal passa sozinho de
 * `conectando` a `conectado` (num microtask); `definirEstado` o derruba para `reconectando`, `fechado`
 * ou `negado` e o traz de volta; `responderEnvio('sem_resposta')` faz o `ack` não responder. Os
 * ouvintes são agendados por `queueMicrotask` (fora do callback, como o `setTimeout` do app, e sem
 * depender dos relógios falsos). `entregar` manda pelo canal o que vier, válido ou não. Desde a E4, o canal
 * de vídeo (`videoDaCamera`, `videoDaObs`) usa o mesmo adaptador e envia pela `rpc` falsa: `sinaisDeVideo()`
 * lista o que saiu e `responderSinal` escolhe a resposta da função.
 */
export function criarCanalFalso(opcoes: { conectarSozinho?: boolean } = {}) {
  const realtime = criarRealtimeFalso({ conectarSozinho: opcoes.conectarSozinho ?? true })
  const fabricas = new Map<string, CanaisDoDispositivo>()
  // E4: o canal de vídeo envia pela `rpc('enviar_sinal_de_video')` (D2); o cliente falso junta o Realtime falso a uma `rpc` falsa.
  const sinais: Record<string, unknown>[] = []
  let respostaDoSinal: RespostaDoSinal = 'ok'
  const cliente = {
    channel: realtime.cliente.channel,
    removeChannel: realtime.cliente.removeChannel,
    async rpc(fn: string, args: Record<string, unknown>) {
      if (fn !== 'enviar_sinal_de_video') return { data: null, error: { code: 'PGRST202' }, status: 404 }
      sinais.push({ ...args })
      return { ...RESPOSTA_DA_FUNCAO[respostaDoSinal], status: 200 }
    },
  }
  return {
    realtime,
    /** A mesma fábrica para o mesmo usuário, como `obterServicosDeAoVivo` e `obterServicosDeDispositivo`. */
    canais(usuarioId: string): CanaisDoDispositivo {
      let fabrica = fabricas.get(usuarioId)
      if (fabrica === undefined) {
        fabrica = criarFabricaDeCanais(cliente as unknown as SupabaseClient, usuarioId, (f) => queueMicrotask(f))
        fabricas.set(usuarioId, fabrica)
      }
      return fabrica
    },
    /** Tópicos com canal na lista do cliente agora (`estudio`, `episodio:<id>:controle`, `episodio:<id>:estado`). */
    abertos(): string[] {
      return realtime.canais().map((c) => c.topico)
    },
    definirEstado(topico: string, estado: Exclude<EstadoDoCanal, 'conectando'>): void {
      const [status, erro] = STATUS_DO_ESTADO[estado]
      realtime.emitirStatus(realtime.canal(topico), status, erro)
    },
    responderEnvio(r: RespostaDoEnvio): void {
      realtime.responderSend(RESPOSTA_DO_SEND[r])
    },
    /** Mensagem chegando de outro cliente pelo `broadcast` do tópico (passa pelos leitores do adaptador). */
    entregar(topico: string, evento: string, payload: unknown): void {
      realtime.emitirBroadcast(realtime.canal(topico), evento, payload)
    },
    /** Presença do tópico mudou (`sync`) para `estado` (chave → registros). */
    sincronizarPresenca(topico: string, estado: Record<string, unknown[]>): void {
      realtime.emitirPresenca(realtime.canal(topico), 'sync', estado)
    },
    entrarAlguem(topico: string): void {
      realtime.emitirPresenca(realtime.canal(topico), 'join')
    },
    /** O que este cliente enviou no tópico (`event` e `payload`, com o `remetente`). */
    enviados(topico: string): { event: string; payload: unknown }[] {
      return realtime.criados.filter((c) => c.topico === topico).flatMap((c) => c.enviados.map(({ event, payload }) => ({ event, payload })))
    },
    /** Presenças marcadas (`track`) no tópico, na ordem. */
    presencas(topico: string): unknown[] {
      return realtime.criados.filter((c) => c.topico === topico).flatMap((c) => c.presencas)
    },
    /** Sinais de vídeo enviados pela `rpc` (`p_tipo`, `p_sessao`, `p_sdp`), na ordem. */
    sinaisDeVideo(): Record<string, unknown>[] {
      return sinais.map((x) => ({ ...x }))
    },
    /** O que a função responde aos próximos sinais de vídeo (padrão: `ok`). */
    responderSinal(r: RespostaDoSinal): void {
      respostaDoSinal = r
    },
  }
}

export type CanalFalso = ReturnType<typeof criarCanalFalso>

/** SDPs de teste do vídeo (IP da faixa de documentação, RFC 5737): nunca um SDP real. */
const SDP_DA_OFERTA_FALSA = 'v=0\r\no=- 1 2 IN IP4 192.0.2.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\n'
const SDP_DA_RESPOSTA_FALSA = 'v=0\r\no=- 3 4 IN IP4 192.0.2.2\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=recvonly\r\n'

/** Uma conexão falsa e o que o teste faz com ela. */
export interface ConexaoDeVideoFalsa {
  readonly conexao: ConexaoDeVideo
  readonly ofertas: FaixaDeVideo[]
  readonly respostasAceitas: string[]
  readonly ofertasRespondidas: string[]
  readonly trocas: FaixaDeVideo[]
  fechada(): boolean
  /** `conectando` → `conectado` (e, no lado que respondeu, o fluxo recebido antes). */
  conectar(): void
  cair(): void
  falhar(): void
}

/**
 * Vídeo falso para os testes de tela (E4; jsdom não tem WebRTC, `getUserMedia` nem Wake Lock): as portas da Captura que a
 * composição real monta em `obterServicosDeDispositivo` (`conexoes` e `aparelho`), com o que muda a tela:
 * - **conexão:** com `config.conectarSozinha` (padrão), passa sozinha por `conectando` → `conectado` depois de
 *   `aceitarResposta` (câmera) ou de `responder` (`obs_camera`, que antes recebe `fluxoRecebido`); `cair()` e `falhar()`
 *   derrubam; `config.trocaDaFaixa = false` recusa o `replaceTrack`; depois de `fechar()` nada mais é avisado;
 * - **câmera:** uma nova a cada `aparelho.camera()`, como na composição real (`camera.criadas` conta); `camera.proxima`
 *   faz o próximo `ligar` recusar (`sem_permissao`, `sem_camera`...); `camera.perder()` avisa a faixa perdida na última
 *   criada; `fluxoDaPrevia` só com a câmera ligada;
 * - **tela:** uma nova a cada `aparelho.tela()` (`tela.criadas`); `tela.proxima` decide o próximo `travar` (`travada` ou
 *   `sem_trava`);
 * - **bateria:** `null` até `definirBateria`;
 * - **WebRTC:** `aparelho.videoDireto()` devolve `config.videoDireto` (padrão `true`; `false` imita o navegador sem
 *   `RTCPeerConnection`, VER-052).
 * Os avisos são agendados por `queueMicrotask` (fora da chamada, como o `setTimeout` dos adaptadores).
 */
/**
 * Quadros falsos (E5, PLA-006, Tarefa 6): `quadros(fluxo)` guarda o fluxo pedido e devolve uma fonte de `criarFonteFalsa`
 * do domínio (quadros opacos; `fontes.config` e as contagens para o teste). Sempre uma fonte, como a composição real
 * (`criarFonteDeQuadros`); quem decide se há vídeo é a rota.
 */
export function criarQuadrosFalsos() {
  const fontes = criarFonteFalsa()
  const fluxos: FluxoDeVideo[] = []
  const semVideo: FonteDeQuadros = { quadro: async () => null, fechar: () => undefined }
  return {
    fontes,
    fluxos,
    quadros(fluxo: FluxoDeVideo): FonteDeQuadros {
      fluxos.push(fluxo)
      return fontes.fonte() ?? semVideo
    },
  }
}

export function criarVideoFalso() {
  const config = { conectarSozinha: true, trocaDaFaixa: true, videoDireto: true }
  const conexoesCriadas: ConexaoDeVideoFalsa[] = []
  const fluxoRecebido = { fluxo: 'recebido' } as unknown as FluxoDeVideo
  const fluxoDaCamera = { fluxo: 'camera' } as unknown as FluxoDeVideo

  const conexoes: FabricaDeConexoes = {
    criar() {
      const ouvintesDoEstado = new Set<(e: EstadoDaConexao) => void>()
      const ouvintesDoVideo = new Set<(f: FluxoDeVideo) => void>()
      let fechada = false
      let respondeu = false
      const avisar = (e: EstadoDaConexao) =>
        queueMicrotask(() => {
          if (!fechada) for (const f of [...ouvintesDoEstado]) f(e)
        })
      const falsa: ConexaoDeVideoFalsa = {
        ofertas: [],
        respostasAceitas: [],
        ofertasRespondidas: [],
        trocas: [],
        fechada: () => fechada,
        conectar() {
          if (respondeu) {
            queueMicrotask(() => {
              if (!fechada) for (const f of [...ouvintesDoVideo]) f(fluxoRecebido)
            })
          }
          avisar('conectando')
          avisar('conectado')
        },
        cair: () => avisar('caiu'),
        falhar: () => avisar('falhou'),
        conexao: {
          async oferecer(faixa) {
            falsa.ofertas.push(faixa)
            return SDP_DA_OFERTA_FALSA
          },
          async aceitarResposta(sdp) {
            falsa.respostasAceitas.push(sdp)
            if (config.conectarSozinha) falsa.conectar()
          },
          async responder(oferta) {
            falsa.ofertasRespondidas.push(oferta)
            respondeu = true
            if (config.conectarSozinha) falsa.conectar()
            return SDP_DA_RESPOSTA_FALSA
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
            fechada = true
          },
        },
      }
      conexoesCriadas.push(falsa)
      return falsa.conexao
    },
  }

  const controleDaCamera = {
    proxima: null as FalhaDaCamera | null,
    /** Chamadas de `aparelho.camera()` (a composição real cria uma câmera nova a cada chamada). */
    criadas: 0,
    ligacoes: 0,
    desligadas: 0,
    /** A última câmera criada está ligada. */
    ligada: () => cameras.at(-1)?.ligada === true,
    /** Faixa perdida na última câmera criada. */
    perder(): void {
      const ultima = cameras.at(-1)
      if (ultima === undefined) return
      queueMicrotask(() => {
        for (const f of [...ultima.ouvintes]) f()
      })
    },
  }
  const cameras: { ligada: boolean; ouvintes: Set<() => void> }[] = []
  function criarCamera(): CameraDoAparelho {
    const estado = { ligada: false, ouvintes: new Set<() => void>() }
    cameras.push(estado)
    controleDaCamera.criadas += 1
    return {
      async ligar() {
        controleDaCamera.ligacoes += 1
        const motivo = controleDaCamera.proxima
        if (motivo !== null) return { ok: false, motivo }
        estado.ligada = true
        return { ok: true, faixa: { faixa: controleDaCamera.ligacoes } as unknown as FaixaDeVideo }
      },
      aoPerderFaixa(f) {
        estado.ouvintes.add(f)
        return () => {
          estado.ouvintes.delete(f)
        }
      },
      desligar() {
        controleDaCamera.desligadas += 1
        estado.ligada = false
      },
      fluxoDaPrevia: () => (estado.ligada ? fluxoDaCamera : null),
    }
  }

  const controleDaTela = { proxima: 'travada' as 'travada' | 'sem_trava', criadas: 0, travadas: 0, soltas: 0 }
  function criarTela(): ManterTelaLigada {
    controleDaTela.criadas += 1
    return {
      async travar() {
        controleDaTela.travadas += 1
        return controleDaTela.proxima
      },
      soltar() {
        controleDaTela.soltas += 1
      },
    }
  }

  let bateria: number | null = null
  const aparelho: AparelhoDoDispositivo = { camera: criarCamera, tela: criarTela, bateria: async () => bateria, videoDireto: () => config.videoDireto }

  return {
    conexoes,
    aparelho,
    config,
    conexoesCriadas,
    fluxoRecebido,
    fluxoDaCamera,
    sdpDaOferta: SDP_DA_OFERTA_FALSA,
    sdpDaResposta: SDP_DA_RESPOSTA_FALSA,
    camera: controleDaCamera,
    tela: controleDaTela,
    definirBateria(n: number | null): void {
      bateria = n
    },
  }
}

export type VideoFalso = ReturnType<typeof criarVideoFalso>

/**
 * Ao vivo sem nada, para as telas de membro que não o usam: nenhum episódio ativo, nenhum dispositivo;
 * iniciar, encerrar e modo teste resolvem sem efeito; criar código recusa (`outro`: um falso vazio não
 * inventa código); canais pelo canal falso.
 */
export function aoVivoVazio(): ServicosDeAoVivo {
  const nada = async () => {}
  const repo: RepositorioDoAoVivo = {
    episodioAtivo: async () => null,
    iniciar: nada,
    encerrar: nada,
    definirModoTeste: nada,
    listarDispositivos: async () => [],
    criarCodigo: async () => {
      throw new ErroDoAoVivo('outro')
    },
    revogar: async () => ({ usuario: null }),
    // E5 (PLA-006, Tarefa 4): o interruptor devolve o valor pedido (o que a função grava); onde reconhecer, sem efeito
    definirGestosLigados: async (_episodioId, ligado) => ligado,
    definirReconhecimento: nada,
  }
  return { repo, canais: criarCanalFalso().canais }
}

type RespostaDoPareamento = Awaited<ReturnType<ServicoDeDispositivo['parear']>>
type DispositivoAtual = NonNullable<Awaited<ReturnType<ServicoDeDispositivo['dispositivoAtual']>>>
type CargaDoPalco = Awaited<ReturnType<RepositorioDoPalco['carregar']>>
type MetodoDoDispositivo = 'sessaoAtual' | 'entrarAnonimo' | 'parear' | 'dispositivoAtual' | 'sair'

/**
 * Sessão de dispositivo falsa (E3, D4), com o que muda a tela: `entrarAnonimo` cria uma sessão anônima
 * nova (um `usuarioId` novo a cada vez); `parear` responde o que foi programado (padrão: `pareado`) e,
 * pareado, liga o dispositivo à sessão; `dispositivoAtual` só devolve o dispositivo com sessão anônima;
 * `sair` apaga a sessão. `ordem` anota cada chamada (para conferir, por exemplo, que o fragmento foi
 * limpo antes de qualquer rede). Uma falha programada (`falharProxima`) vale uma chamada. Desde a E4, os
 * serviços trazem as conexões e o aparelho de `criarVideoFalso` (em `video`).
 */
export function criarFalsosDeDispositivo(
  inicial: {
    sessao?: { usuarioId: string; anonima: boolean } | null
    dispositivo?: DispositivoAtual | null
    pareamento?: RespostaDoPareamento
    episodioAtivo?: { id: string; modo: 'ao_vivo' | 'teste' } | null
    carga?: CargaDoPalco
  } = {},
) {
  let sessao = inicial.sessao ?? null
  let dispositivo = inicial.dispositivo ?? null
  let pareamento: RespostaDoPareamento = inicial.pareamento ?? { resultado: 'pareado', dispositivo: { id: '0b6f3c1e-2a4d-4f8b-9c7e-1d2e3f4a5b6c', rotulo: 'Dispositivo de teste' } }
  let episodioAtivo = inicial.episodioAtivo ?? null
  let carga: CargaDoPalco | null = inicial.carga ?? null
  let proximoUsuario = 1
  const falhas = new Map<MetodoDoDispositivo, ErroDeDispositivo>()
  const canal = criarCanalFalso()
  const video = criarVideoFalso()
  // E5 (PLA-006, Tarefa 4): os mesmos falsos do domínio que provam o laço (`captura/falsos.ts`); o reconhecedor, pelo
  // relógio do teste (`setTimeout`, que os relógios falsos do Vitest controlam), porque o worker do MediaPipe não roda no jsdom
  const gestos = criarRepoDosGestosFalso()
  const reconhecedores = criarReconhecedoresFalsos((f, ms) => {
    const t = setTimeout(f, ms)
    return () => clearTimeout(t)
  })
  // E5 (PLA-006, Tarefa 6): a fonte de quadros falsa do domínio, pedida por fluxo como na composição real (`servicos.ts`)
  const quadros = criarQuadrosFalsos()
  const chamadas = {
    ordem: [] as string[],
    parear: [] as { codigo: string; tipo: TipoDeDispositivo }[],
    sair: 0,
    registros: [] as LinhaDoRegistro[],
    urls: [] as string[],
  }

  function anotar(metodo: MetodoDoDispositivo): void {
    chamadas.ordem.push(metodo)
    const erro = falhas.get(metodo)
    if (erro) {
      falhas.delete(metodo)
      throw erro
    }
  }

  const servico: ServicoDeDispositivo = {
    async sessaoAtual() {
      anotar('sessaoAtual')
      return sessao === null ? null : { ...sessao }
    },
    async entrarAnonimo() {
      anotar('entrarAnonimo')
      const usuarioId = `5a1c9e2b-7d3f-4b6a-8c1d-${String(proximoUsuario++).padStart(12, '0')}`
      sessao = { usuarioId, anonima: true }
      dispositivo = null
      return { usuarioId }
    },
    async parear(codigo, tipo) {
      anotar('parear')
      chamadas.parear.push({ codigo, tipo })
      if (pareamento.resultado === 'pareado' && pareamento.dispositivo !== null) {
        dispositivo = { id: pareamento.dispositivo.id, tipo, rotulo: pareamento.dispositivo.rotulo, cameraId: null }
      }
      return { resultado: pareamento.resultado, dispositivo: pareamento.dispositivo === null ? null : { ...pareamento.dispositivo } }
    },
    async dispositivoAtual() {
      anotar('dispositivoAtual')
      return sessao?.anonima === true && dispositivo !== null ? { ...dispositivo } : null
    },
    async sair() {
      chamadas.sair++
      chamadas.ordem.push('sair')
      sessao = null
      dispositivo = null
    },
  }

  const palco: RepositorioDoPalco = {
    async episodioAtivo() {
      return episodioAtivo === null ? null : { ...episodioAtivo }
    },
    async carregar(episodioId) {
      if (carga === null || carga.episodio.id !== episodioId) throw new ErroDoAoVivo('invalido')
      return JSON.parse(JSON.stringify(carga)) as CargaDoPalco
    },
    async urlDoArquivo(caminho) {
      chamadas.urls.push(caminho)
      return `https://armazenamento.revocast.test/assinada/${caminho}?token=teste`
    },
    async registrar(l) {
      chamadas.registros.push({ ...l })
    },
    // E5 (PLA-006, Tarefa 2): neutro (desligados) até a Tarefa 7 programar o interruptor nos falsos
    async gestosLigados() {
      return false
    },
  }

  return {
    servicos: {
      servico,
      palco,
      canais: canal.canais,
      conexoes: video.conexoes,
      aparelho: video.aparelho,
      gestos: gestos.repo,
      reconhecedores: reconhecedores.fabrica,
      quadros: quadros.quadros,
    } satisfies ServicosDoDispositivo,
    canal,
    video,
    gestos,
    reconhecedores,
    quadros,
    chamadas,
    definirSessao(s: { usuarioId: string; anonima: boolean } | null): void {
      sessao = s
    },
    definirDispositivo(d: DispositivoAtual | null): void {
      dispositivo = d
    },
    responderPareamento(r: RespostaDoPareamento): void {
      pareamento = r
    },
    definirEpisodioAtivo(e: { id: string; modo: 'ao_vivo' | 'teste' } | null): void {
      episodioAtivo = e
    },
    definirCarga(c: CargaDoPalco | null): void {
      carga = c
    },
    /** A próxima chamada de `metodo` lança `erro` (vale uma vez; `sair` nunca lança, como a porta promete). */
    falharProxima(metodo: Exclude<MetodoDoDispositivo, 'sair'>, erro: ErroDeDispositivo): void {
      falhas.set(metodo, erro)
    },
  }
}
