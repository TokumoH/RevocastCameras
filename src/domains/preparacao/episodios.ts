import type { Midia } from './midia'

/** Estado do episódio (= tipo `public.estado_episodio`). A E2 só mostra; iniciar e encerrar ficam para a E3 (D2). */
export type EstadoDoEpisodio = 'rascunho' | 'ao_vivo' | 'encerrado'

export interface Episodio {
  id: string
  titulo: string
  /** `AAAA-MM-DD` (coluna `date`). */
  data: string
  estado: EstadoDoEpisodio
}

export interface Aviso {
  id: string
  episodioId: string
  titulo: string
  texto: string
  link: string | null
  imagemMidiaId: string | null
  duracaoS: number
  ordem: number
}

const TAMANHO_DO_TITULO = 120
const DATA = /^(\d{4})-(\d{2})-(\d{2})$/

/** Data `AAAA-MM-DD` que existe no calendário (recusa `2026-02-30`) e ano ≥ 0001 (o Postgres não tem ano 0). */
function dataReal(texto: string): boolean {
  const m = DATA.exec(texto)
  if (!m) return false
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(2000, mes - 1, dia))
  d.setUTCFullYear(ano)
  return ano >= 1 && d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
}

/** Título aparado, não vazio e com até 120 caracteres; data real. */
export function conferirEpisodio(e: { titulo: string; data: string }): 'titulo_vazio' | 'titulo_longo' | 'data_invalida' | null {
  const titulo = e.titulo.trim()
  if (titulo === '') return 'titulo_vazio'
  if (Array.from(titulo).length > TAMANHO_DO_TITULO) return 'titulo_longo'
  if (!dataReal(e.data)) return 'data_invalida'
  return null
}

/** Só rascunho sai (D2): a exclusão apagaria em cascata os avisos e o histórico do `registro_acoes`. */
export function podeExcluirEpisodio(e: Episodio): boolean {
  return e.estado === 'rascunho'
}

/**
 * Link de aviso: vazio → sem link; senão uma URL absoluta `https:` sem usuário nem senha,
 * devolvida já normalizada (`url.href`, que sempre começa por `https://`, como pede o CHECK
 * `avisos_link_https`). `http:`, `javascript:`, `data:`, relativo e sem esquema são recusados.
 */
export function normalizarLink(texto: string): { ok: true; link: string | null } | { ok: false } {
  const t = texto.trim()
  if (t === '') return { ok: true, link: null }
  let url: URL
  try {
    url = new URL(t)
  } catch {
    return { ok: false }
  }
  if (url.protocol !== 'https:') return { ok: false }
  if (url.username !== '' || url.password !== '') return { ok: false }
  return { ok: true, link: url.href }
}

const DURACAO_MAXIMA_S = 600

/** Título não vazio, link válido (ou vazio), duração inteira de 1 a 600 s e imagem da lista de imagens. */
export function conferirAviso(
  a: { titulo: string; link: string; duracaoS: number; imagemMidiaId: string | null },
  imagens: readonly Midia[],
): 'titulo_vazio' | 'link_invalido' | 'duracao_invalida' | 'imagem_inexistente' | null {
  if (a.titulo.trim() === '') return 'titulo_vazio'
  if (!normalizarLink(a.link).ok) return 'link_invalido'
  if (!Number.isInteger(a.duracaoS) || a.duracaoS < 1 || a.duracaoS > DURACAO_MAXIMA_S) return 'duracao_invalida'
  if (a.imagemMidiaId !== null && !imagens.some((m) => m.id === a.imagemMidiaId && m.tipo === 'imagem')) return 'imagem_inexistente'
  return null
}

/**
 * Troca um item com o vizinho de cima ou de baixo, pela ordem do campo `ordem` (empates na
 * ordem da lista). Devolve as ordens a gravar: o par trocado; `[]` nas pontas ou com `id`
 * desconhecido. Com ordens repetidas, renumera tudo de 0 a n-1 antes de trocar e devolve
 * **todos** os itens (ordenados pela ordem nova), para o banco sair sem empate.
 */
export function trocarOrdem<T extends { id: string; ordem: number }>(lista: readonly T[], id: string, direcao: 'subir' | 'descer'): { id: string; ordem: number }[] {
  const ordenada = [...lista].sort((a, b) => a.ordem - b.ordem)
  const repetidas = new Set(ordenada.map((x) => x.ordem)).size !== ordenada.length
  const itens = ordenada.map((x, i) => ({ id: x.id, ordem: repetidas ? i : x.ordem }))
  const i = itens.findIndex((x) => x.id === id)
  const j = direcao === 'subir' ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= itens.length) return []
  const ordemDeI = itens[i].ordem
  itens[i] = { id: itens[i].id, ordem: itens[j].ordem }
  itens[j] = { id: itens[j].id, ordem: ordemDeI }
  if (repetidas) return itens.sort((a, b) => a.ordem - b.ordem)
  const [primeiro, segundo] = i < j ? [itens[i], itens[j]] : [itens[j], itens[i]]
  return [primeiro, segundo]
}
