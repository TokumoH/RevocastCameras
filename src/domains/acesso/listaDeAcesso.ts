import { mesmoEmail } from './email'
import { PAPEIS } from './papeis'
import type { Papel } from './papeis'

/** Linha de `membros_permitidos` (DES-001 §7). */
export interface MembroPermitido {
  email: string
  papel: Papel
  criadoPor: string | null
}

/** Linha de `membros`: o perfil criado no primeiro login (gatilho da E0). */
export interface PerfilDeMembro {
  id: string
  email: string
  nome: string
}

/** O que a aba Membros mostra: o e-mail liberado e, se a pessoa já entrou, o nome do perfil. */
export interface LinhaDaLista {
  email: string
  papel: Papel
  nome: string | null
  jaEntrou: boolean
}

export type Mudanca = { tipo: 'papel'; papel: Papel } | { tipo: 'remover' }

export type Recusa = 'duplicado' | 'inexistente' | 'propria_linha' | 'sem_mudanca' | 'ultimo_admin'

/** Liga cada e-mail liberado ao perfil de mesmo e-mail; ordena por papel e depois por e-mail. */
export function montarLista(
  permitidos: readonly MembroPermitido[],
  perfis: readonly PerfilDeMembro[],
): LinhaDaLista[] {
  return permitidos
    .map((p) => {
      const perfil = perfis.find((q) => mesmoEmail(q.email, p.email))
      return { email: p.email, papel: p.papel, nome: perfil?.nome ?? null, jaEntrou: perfil !== undefined }
    })
    .sort(
      (a, b) =>
        PAPEIS.indexOf(a.papel) - PAPEIS.indexOf(b.papel) || (a.email < b.email ? -1 : a.email > b.email ? 1 : 0),
    )
}

/** Recusa incluir um e-mail que já está na lista. O e-mail chega normalizado (`normalizarEmail`). */
export function conferirInclusao(lista: readonly LinhaDaLista[], email: string): Recusa | null {
  return lista.some((l) => mesmoEmail(l.email, email)) ? 'duplicado' : null
}

/**
 * Confere uma troca de papel ou remoção, nesta ordem: a linha existe; não é a da própria sessão
 * (D1: o banco também recusa); muda alguma coisa; não tira o último `admin` (defesa em
 * profundidade para quando a lista na tela é antiga e a sessão já não aparece nela).
 */
export function conferirMudanca(
  lista: readonly LinhaDaLista[],
  email: string,
  mudanca: Mudanca,
  emailDaSessao: string | null,
): Recusa | null {
  const linha = lista.find((l) => mesmoEmail(l.email, email))
  if (linha === undefined) return 'inexistente'
  if (mesmoEmail(linha.email, emailDaSessao)) return 'propria_linha'
  if (mudanca.tipo === 'papel' && mudanca.papel === linha.papel) return 'sem_mudanca'
  const tiraAdmin = linha.papel === 'admin' && (mudanca.tipo === 'remover' || mudanca.papel !== 'admin')
  if (tiraAdmin && lista.filter((l) => l.papel === 'admin').length <= 1) return 'ultimo_admin'
  return null
}
