import type { Gesto, LinhaDoMapa } from './gestos'
import type { Midia, Som } from './midia'

/**
 * Onde uma mídia é usada (D11): gestos ligados ao som dela e quantos avisos usam a imagem.
 * Som num gesto bloqueia a exclusão (o banco também recusa, `23503`); imagem em avisos não
 * bloqueia (o banco põe `imagem_midia_id` em nulo) e a tela pede confirmação com o número.
 */
export function usosDaMidia(
  m: Midia,
  ctx: { sons: readonly Som[]; mapa: readonly LinhaDoMapa[]; avisosComImagem: number },
): { gestos: Gesto[]; avisos: number; bloqueia: boolean } {
  const idsDosSons = new Set(ctx.sons.filter((s) => s.midiaId === m.id).map((s) => s.id))
  const gestos = m.tipo === 'som' ? ctx.mapa.filter((l) => l.somId !== null && idsDosSons.has(l.somId)).map((l) => l.gesto) : []
  const avisos = m.tipo === 'imagem' ? ctx.avisosComImagem : 0
  return { gestos, avisos, bloqueia: gestos.length > 0 }
}

/** Gestos ligados a uma cena: cena num gesto não sai (mesma regra do som, D11). */
export function usosDaCena(cenaId: string, mapa: readonly LinhaDoMapa[]): Gesto[] {
  return mapa.filter((l) => l.cenaId === cenaId).map((l) => l.gesto)
}
