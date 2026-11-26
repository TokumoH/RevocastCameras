/** Papéis de membro, na ordem em que a lista de acesso os mostra (DES-001 §7 e §9). */
export const PAPEIS = ['admin', 'equipe', 'apresentadora'] as const

export type Papel = (typeof PAPEIS)[number]

/** Áreas de membro guardadas por papel: `/painel` e `/controle`. */
export type Area = 'painel' | 'controle'

export const ROTULO_DO_PAPEL: Record<Papel, string> = {
  admin: 'Admin',
  equipe: 'Equipe',
  apresentadora: 'Apresentadora',
}

const QUEM_ABRE: Record<Area, readonly Papel[]> = {
  painel: ['admin', 'equipe'],
  controle: ['admin', 'equipe', 'apresentadora'],
}

/** Só os três textos exatos; `in` não serve porque aceitaria `toString` e outras chaves herdadas. */
export function ehPapel(valor: unknown): valor is Papel {
  return typeof valor === 'string' && (PAPEIS as readonly string[]).includes(valor)
}

export function podeAbrir(area: Area, papel: Papel): boolean {
  return QUEM_ABRE[area].includes(papel)
}

/** Para onde a pessoa vai depois do login (decisão D2 do PLA-002). */
export function areaInicial(papel: Papel): Area {
  return papel === 'apresentadora' ? 'controle' : 'painel'
}

export function podeGerenciarMembros(papel: Papel): boolean {
  return papel === 'admin'
}
