import type { Papel } from './papeis'

/** O que o domínio precisa saber da sessão do Supabase Auth. */
export interface UsuarioDaSessao {
  id: string
  email: string | null
  anonimo: boolean
  provedor: string | null
}

export type AvisoDeEntrada =
  | 'login_cancelado'
  | 'login_falhou'
  | 'login_incompleto'
  | 'sessao_anonima'
  | 'provedor_invalido'
  | 'sessao_expirada'

export type EstadoDeAcesso =
  | { tipo: 'carregando' }
  | { tipo: 'sem_sessao'; aviso: AvisoDeEntrada | null }
  | { tipo: 'sem_papel'; email: string | null }
  | { tipo: 'falha' }
  | { tipo: 'membro'; usuario: UsuarioDaSessao; papel: Papel }

/** Avisos que nascem de um sair() do próprio app: o SIGNED_OUT que ele emite não pode apagá-los. */
export const AVISOS_FIXOS: readonly AvisoDeEntrada[] = ['sessao_anonima', 'provedor_invalido', 'sessao_expirada']

/** Fixo: a pessoa já está fora e a tela explica por quê (`sem_papel` ou aviso de `AVISOS_FIXOS`). */
function ehFixo(estado: EstadoDeAcesso): boolean {
  return (
    estado.tipo === 'sem_papel' ||
    (estado.tipo === 'sem_sessao' && estado.aviso !== null && AVISOS_FIXOS.includes(estado.aviso))
  )
}

/**
 * Estado que fica na tela depois de uma reavaliação automática (evento de sessão ou volta à aba).
 * Um estado fixo só é trocado por algo que diga mais: membro (entrou em outra aba), outro
 * `sem_papel` ou outro aviso. `sem_sessao` sem aviso (o SIGNED_OUT do próprio sair) e `falha`
 * (a pessoa já está fora) não apagam a mensagem. Em qualquer outro caso vale o novo estado.
 * As ações da pessoa (Entrar, Sair, Tentar de novo) não passam por aqui.
 */
export function combinarEstados(atual: EstadoDeAcesso, novo: EstadoDeAcesso): EstadoDeAcesso {
  if (!ehFixo(atual)) return novo
  if (novo.tipo === 'falha') return atual
  if (novo.tipo === 'sem_sessao' && novo.aviso === null) return atual
  return novo
}
