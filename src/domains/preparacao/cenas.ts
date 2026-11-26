/** Cena do OBS (tabela `cenas`): o nome mostrado na equipe e o nome exato da cena no OBS. */
export interface Cena {
  id: string
  nomeExibicao: string
  nomeObs: string
  ordem: number
}

export type RecusaDaCena = 'nome_vazio' | 'nome_obs_vazio' | 'nome_obs_duplicado'

/**
 * Confere uma cena nova (`idEditado` nulo) ou editada. O nome de exibição é aparado; o nome no
 * OBS é comparado **exato** (o OBS diferencia caixa e espaços, e o banco tem `unique` exato em
 * `nome_obs`): só o vazio ou só com espaços é recusado.
 */
export function conferirCena(c: { nomeExibicao: string; nomeObs: string }, cenas: readonly Cena[], idEditado: string | null): RecusaDaCena | null {
  if (c.nomeExibicao.trim() === '') return 'nome_vazio'
  if (c.nomeObs.trim() === '') return 'nome_obs_vazio'
  if (cenas.some((outra) => outra.id !== idEditado && outra.nomeObs === c.nomeObs)) return 'nome_obs_duplicado'
  return null
}
