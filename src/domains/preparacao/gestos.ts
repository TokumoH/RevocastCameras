import type { Som } from './midia'

/** Os 7 gestos do reconhecedor (= tipo `public.gesto` do banco). */
export type Gesto = 'Closed_Fist' | 'Open_Palm' | 'Pointing_Up' | 'Thumb_Down' | 'Thumb_Up' | 'Victory' | 'ILoveYou'

/** As ações de um gesto (= tipo `public.acao_gesto` do banco). */
export type AcaoDoGesto = 'clipe' | 'marcador' | 'cena' | 'som' | 'proximo_aviso' | 'ocultar_aviso' | 'proxima_cena' | 'nenhuma'

/** Os 7 gestos, na ordem da tabela do mapa padrão (DES-001 §7). */
export const GESTOS: readonly { gesto: Gesto; emoji: string; rotulo: string }[] = Object.freeze([
  Object.freeze({ gesto: 'ILoveYou', emoji: '🤟', rotulo: 'Mão "eu te amo"' } as const),
  Object.freeze({ gesto: 'Closed_Fist', emoji: '✊', rotulo: 'Punho fechado' } as const),
  Object.freeze({ gesto: 'Victory', emoji: '✌️', rotulo: 'Vitória' } as const),
  Object.freeze({ gesto: 'Thumb_Up', emoji: '👍', rotulo: 'Polegar para cima' } as const),
  Object.freeze({ gesto: 'Thumb_Down', emoji: '👎', rotulo: 'Polegar para baixo' } as const),
  Object.freeze({ gesto: 'Pointing_Up', emoji: '☝️', rotulo: 'Indicador para cima' } as const),
  Object.freeze({ gesto: 'Open_Palm', emoji: '✋', rotulo: 'Mão aberta' } as const),
])

/** As 8 ações, na ordem do tipo do banco, com o rótulo da tela. */
export const ACOES: readonly { acao: AcaoDoGesto; rotulo: string }[] = Object.freeze([
  Object.freeze({ acao: 'clipe', rotulo: 'Clipe' } as const),
  Object.freeze({ acao: 'marcador', rotulo: 'Marcador' } as const),
  Object.freeze({ acao: 'cena', rotulo: 'Cena' } as const),
  Object.freeze({ acao: 'som', rotulo: 'Som' } as const),
  Object.freeze({ acao: 'proximo_aviso', rotulo: 'Próximo aviso' } as const),
  Object.freeze({ acao: 'ocultar_aviso', rotulo: 'Ocultar aviso' } as const),
  Object.freeze({ acao: 'proxima_cena', rotulo: 'Próxima cena' } as const),
  Object.freeze({ acao: 'nenhuma', rotulo: 'Nenhuma' } as const),
])

/** Uma linha do mapa global de gestos (tabela `mapa_gestos`). */
export interface LinhaDoMapa {
  gesto: Gesto
  acao: AcaoDoGesto
  cenaId: string | null
  somId: string | null
}

/** Zera o alvo que não corresponde à ação (o CHECK `mapa_gestos_equivalencia` exige isso). */
export function normalizarGesto(l: LinhaDoMapa): LinhaDoMapa {
  return {
    gesto: l.gesto,
    acao: l.acao,
    cenaId: l.acao === 'cena' ? l.cenaId : null,
    somId: l.acao === 'som' ? l.somId : null,
  }
}

/**
 * Confere o alvo da ação (D12): `cena` exige uma cena da lista e `som`, um som da lista. Só o
 * alvo da ação é olhado; o outro é ignorado, como `normalizarGesto` o zera (quem grava manda a
 * linha normalizada).
 */
export function conferirGesto(
  l: LinhaDoMapa,
  cenas: readonly { id: string }[],
  sons: readonly { id: string }[],
): 'falta_cena' | 'falta_som' | 'alvo_inexistente' | null {
  if (l.acao === 'cena') {
    if (l.cenaId === null) return 'falta_cena'
    if (!cenas.some((c) => c.id === l.cenaId)) return 'alvo_inexistente'
  }
  if (l.acao === 'som') {
    if (l.somId === null) return 'falta_som'
    if (!sons.some((s) => s.id === l.somId)) return 'alvo_inexistente'
  }
  return null
}

/** Sugestões do DES-001 §7: 👍 → som "aplauso" e 👎 → som "buuu". */
const SUGESTOES: readonly { gesto: Gesto; rotulo: string }[] = [
  { gesto: 'Thumb_Up', rotulo: 'aplauso' },
  { gesto: 'Thumb_Down', rotulo: 'buuu' },
]

/** Aparado, sem caixa e sem acento. */
function chave(rotulo: string): string {
  return rotulo.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

/**
 * Sugere ligar 👍/👎 aos sons "aplauso"/"buuu" (D12): só quando a linha do gesto está em
 * `nenhuma` e existe um som com o rótulo igual (sem caixa e sem acento; "aplausos" não conta).
 * Com mais de um som igual, sugere o primeiro da lista.
 */
export function sugestoesDeSom(mapa: readonly LinhaDoMapa[], sons: readonly Som[]): { gesto: Gesto; som: Som }[] {
  const resultado: { gesto: Gesto; som: Som }[] = []
  for (const s of SUGESTOES) {
    const linha = mapa.find((l) => l.gesto === s.gesto)
    if (linha?.acao !== 'nenhuma') continue
    const som = sons.find((x) => chave(x.rotulo) === s.rotulo)
    if (som) resultado.push({ gesto: s.gesto, som })
  }
  return resultado
}
