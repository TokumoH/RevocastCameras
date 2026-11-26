export type ResultadoDoEmail = { ok: true; email: string } | { ok: false; motivo: 'vazio' | 'formato' }

/** Limite prático de um endereço (RFC 5321: caminho de 256 menos os sinais de maior e menor). */
const TAMANHO_MAXIMO = 254

/**
 * Forma: algo sem espaço nem arroba, uma arroba, e um domínio com pelo menos um ponto e sem
 * rótulo vazio (recusa ponto no começo, no fim ou dois seguidos). Não tenta validar o RFC
 * inteiro: quem decide o acesso é o banco, que compara o e-mail da sessão Google.
 */
const FORMATO = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/

/** Tira os espaços das pontas e passa para minúsculas, a mesma forma que `papel_atual()` usa. */
export function normalizarEmail(texto: string): ResultadoDoEmail {
  const email = texto.trim().toLowerCase()
  if (email === '') return { ok: false, motivo: 'vazio' }
  if (email.length > TAMANHO_MAXIMO || !FORMATO.test(email)) return { ok: false, motivo: 'formato' }
  return { ok: true, email }
}

/** Compara sem diferenciar maiúsculas; `null` (sessão sem e-mail) nunca é igual a nada. */
export function mesmoEmail(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false
  return a.toLowerCase() === b.toLowerCase()
}
