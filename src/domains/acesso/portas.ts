import type { MembroPermitido, PerfilDeMembro } from './listaDeAcesso'
import type { Papel } from './papeis'
import type { UsuarioDaSessao } from './sessao'

/** Motivos que as telas sabem explicar; os adaptadores traduzem os erros do Supabase para eles. */
export type MotivoDoErro = 'duplicado' | 'invalido' | 'negado' | 'nada_alterado' | 'sessao_expirada' | 'rede' | 'outro'

/** Erro das portas. A mensagem leva só o motivo: nunca e-mail, token ou texto vindo do servidor. */
export class ErroDeAcesso extends Error {
  readonly motivo: MotivoDoErro
  constructor(motivo: MotivoDoErro) {
    super(`Erro de acesso: ${motivo}`)
    this.name = 'ErroDeAcesso'
    this.motivo = motivo
  }
}

/** Porta da autenticação de membro (adaptador em `shared/infra`, Tarefa 3). */
export interface ServicoDeAutenticacao {
  /** Erro ao ler a sessão → lança `ErroDeAcesso('rede')`. */
  usuarioAtual(): Promise<UsuarioDaSessao | null>
  /** Devolve a função que cancela. */
  aoMudarSessao(ouvinte: () => void): () => void
  entrarComGoogle(urlDeRetorno: string): Promise<void>
  /** Nunca lança; emite a mudança de sessão (SIGNED_OUT), como o supabase-js, antes de resolver. */
  sair(): Promise<void>
}

/** Porta do agregado de acesso: papel da sessão e lista de acesso (decisão D6). */
export interface RepositorioDeAcesso {
  papelAtual(): Promise<Papel | null>
  listarPermitidos(): Promise<MembroPermitido[]>
  listarPerfis(): Promise<PerfilDeMembro[]>
  incluir(email: string, papel: Papel, criadoPor: string): Promise<void>
  /** 0 linhas → `ErroDeAcesso('nada_alterado')`. */
  alterarPapel(email: string, papel: Papel): Promise<void>
  /** 0 linhas → `ErroDeAcesso('nada_alterado')`. */
  remover(email: string): Promise<void>
}

export interface ServicosDeMembro {
  auth: ServicoDeAutenticacao
  repo: RepositorioDeAcesso
}
