/**
 * Serviços e dependências falsos para os testes de tela (só para testes: não importa `vitest` nem Supabase).
 * Implementam as portas do domínio Acesso e imitam o que o supabase-js faz e muda a tela: `sair()` põe a
 * sessão em `null` e emite a mudança de sessão (o `SIGNED_OUT`) **antes** de resolver, como o `signOut`
 * real, que só resolve depois do `POST /auth/v1/logout`.
 */
import type { MembroPermitido, PerfilDeMembro } from '../domains/acesso/listaDeAcesso'
import type { Papel } from '../domains/acesso/papeis'
import { ErroDeAcesso } from '../domains/acesso/portas'
import type { RepositorioDeAcesso, ServicoDeAutenticacao, ServicosDeMembro } from '../domains/acesso/portas'
import type { RetornoDoLogin } from '../domains/acesso/retornoDoLogin'
import type { UsuarioDaSessao } from '../domains/acesso/sessao'
import type { Dependencias } from './dependencias'

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
