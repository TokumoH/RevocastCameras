import type { Cena } from '../preparacao/cenas'
import type { Aviso } from '../preparacao/episodios'
import type { AcaoDoGesto } from '../preparacao/gestos'
import type { Som } from '../preparacao/midia'
import type { Comando, EstadoNoAr } from './mensagens'

/** O que o palco pede ao OBS (ou à própria página: som e aviso). `aovivo` não conhece o OBS; quem executa é o `ExecutorDeAcoes` (D1). */
export type AcaoNoObs =
  | { tipo: 'trocar_cena'; nomeObs: string; cenaId: string }
  | { tipo: 'tocar_som'; somId: string; volume: number }
  | { tipo: 'mostrar_aviso'; avisoId: string; duracaoS: number }
  | { tipo: 'ocultar_aviso' }
  | { tipo: 'salvar_clipe' }
  | { tipo: 'marcar'; nome: string }

/** Recusas do domínio, antes de qualquer execução (todas estão em `MOTIVOS_DO_RESULTADO`). */
export type MotivoDaRecusa = 'cena_inexistente' | 'som_inexistente' | 'aviso_inexistente' | 'sem_cenas' | 'fim_dos_avisos' | 'sem_aviso_no_ar'

/** Tamanho máximo do nome do marcador (capítulo da gravação). */
export const TAMANHO_DO_MARCADOR = 100

/** As listas do episódio ativo (cenas, sons e avisos): o palco as carrega para resolver; as telas de membro, para mostrar (o estado no ar só traz ids, D9). */
export interface ListasDoAoVivo {
  cenas: readonly Cena[]
  sons: readonly Som[]
  avisos: readonly Aviso[]
}

/** Contexto da resolução: as listas que o palco carregou, o estado no ar e o título do episódio. */
export interface ContextoDoComando extends ListasDoAoVivo {
  estado: Pick<EstadoNoAr, 'cenaObs' | 'avisoId'>
  episodioTitulo: string
  /** Relógio do marcador (hora local do computador do OBS); padrão: agora. */
  agora?: Date
}

/** Ordena pela `ordem`; empate fica na ordem da lista (o `sort` é estável). */
function pelaOrdem<T extends { ordem: number }>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) => a.ordem - b.ordem)
}

const doisDigitos = (n: number) => String(n).padStart(2, '0')

/** `<título aparado> HH:MM:SS`, com até 100 pontos de código; a hora nunca é cortada (corta o título). */
function nomeDoMarcador(titulo: string, agora: Date): string {
  const hora = `${doisDigitos(agora.getHours())}:${doisDigitos(agora.getMinutes())}:${doisDigitos(agora.getSeconds())}`
  const limpo = titulo.trim()
  if (limpo === '') return hora
  const cabe = TAMANHO_DO_MARCADOR - hora.length - 1
  const cortado = Array.from(limpo).slice(0, cabe).join('').trimEnd()
  return `${cortado} ${hora}`
}

/**
 * Resolve um comando contra as listas carregadas (D9): alvo que não existe → recusa com motivo, e
 * nada é executado. `proxima_cena` segue a `ordem` a partir da cena atual do OBS (comparada pelo
 * nome exato; desconhecida → a primeira; volta ao início no fim). `proximo_aviso` segue a `ordem` a
 * partir do aviso no ar (nenhum ou desconhecido → o primeiro) e para no último (`fim_dos_avisos`;
 * lista vazia também). `ocultar_aviso` sem aviso no ar → `sem_aviso_no_ar`.
 */
export function resolverComando(c: Comando, ctx: ContextoDoComando): { ok: true; acao: AcaoNoObs } | { ok: false; motivo: MotivoDaRecusa } {
  switch (c.acao) {
    case 'cena': {
      const cena = ctx.cenas.find((x) => x.id === c.cenaId)
      return cena ? { ok: true, acao: { tipo: 'trocar_cena', nomeObs: cena.nomeObs, cenaId: cena.id } } : { ok: false, motivo: 'cena_inexistente' }
    }
    case 'proxima_cena': {
      const cenas = pelaOrdem(ctx.cenas)
      if (cenas.length === 0) return { ok: false, motivo: 'sem_cenas' }
      const atual = cenas.findIndex((x) => x.nomeObs === ctx.estado.cenaObs)
      const proxima = cenas[atual < 0 ? 0 : (atual + 1) % cenas.length]
      return { ok: true, acao: { tipo: 'trocar_cena', nomeObs: proxima.nomeObs, cenaId: proxima.id } }
    }
    case 'som': {
      const som = ctx.sons.find((x) => x.id === c.somId)
      return som ? { ok: true, acao: { tipo: 'tocar_som', somId: som.id, volume: som.volume } } : { ok: false, motivo: 'som_inexistente' }
    }
    case 'aviso': {
      const aviso = ctx.avisos.find((x) => x.id === c.avisoId)
      return aviso ? { ok: true, acao: { tipo: 'mostrar_aviso', avisoId: aviso.id, duracaoS: aviso.duracaoS } } : { ok: false, motivo: 'aviso_inexistente' }
    }
    case 'proximo_aviso': {
      const avisos = pelaOrdem(ctx.avisos)
      const atual = ctx.estado.avisoId === null ? -1 : avisos.findIndex((x) => x.id === ctx.estado.avisoId)
      const proximo = avisos[atual + 1]
      return proximo ? { ok: true, acao: { tipo: 'mostrar_aviso', avisoId: proximo.id, duracaoS: proximo.duracaoS } } : { ok: false, motivo: 'fim_dos_avisos' }
    }
    case 'ocultar_aviso':
      return ctx.estado.avisoId === null ? { ok: false, motivo: 'sem_aviso_no_ar' } : { ok: true, acao: { tipo: 'ocultar_aviso' } }
    case 'clipe':
      return { ok: true, acao: { tipo: 'salvar_clipe' } }
    case 'marcador':
      return { ok: true, acao: { tipo: 'marcar', nome: nomeDoMarcador(ctx.episodioTitulo, ctx.agora ?? new Date()) } }
  }
}

/** Linha de `registro_acoes` (D9): exatamente as colunas que o adaptador grava. */
export interface LinhaDoRegistro {
  episodioId: string
  origem: 'toque'
  acao: AcaoDoGesto
  cenaId: string | null
  somId: string | null
  avisoId: string | null
  /** Remetente declarado (DES-001 §8). */
  membroId: string
  teste: boolean
}

/**
 * Ação do registro e a ação do OBS que cada comando produz. O enum `acao_gesto` não tem
 * "mostrar o aviso X": esse toque é gravado como `proximo_aviso` com o `avisoId` mostrado
 * (significado: "aviso no ar"; D9). Nunca `nenhuma`.
 */
const REGISTRO_DO_COMANDO: Readonly<Record<Comando['acao'], { acao: Exclude<AcaoDoGesto, 'nenhuma'>; tipo: AcaoNoObs['tipo'] }>> = Object.freeze({
  cena: { acao: 'cena', tipo: 'trocar_cena' },
  proxima_cena: { acao: 'proxima_cena', tipo: 'trocar_cena' },
  som: { acao: 'som', tipo: 'tocar_som' },
  aviso: { acao: 'proximo_aviso', tipo: 'mostrar_aviso' },
  proximo_aviso: { acao: 'proximo_aviso', tipo: 'mostrar_aviso' },
  ocultar_aviso: { acao: 'ocultar_aviso', tipo: 'ocultar_aviso' },
  clipe: { acao: 'clipe', tipo: 'salvar_clipe' },
  marcador: { acao: 'marcador', tipo: 'marcar' },
})

/**
 * Monta a linha do registro de um comando executado (D9): `origem = 'toque'`, `membroId` = o
 * remetente declarado, `teste` = modo teste; o alvo vem da ação resolvida (na `proxima_cena`, a
 * cena para onde foi). Comando e ação que não combinam → lança (erro de programação, nunca gravado).
 */
export function linhaDoRegistro(c: Comando, a: AcaoNoObs, ctx: { episodioId: string; modo: 'ao_vivo' | 'teste'; remetente: string }): LinhaDoRegistro {
  const esperado = REGISTRO_DO_COMANDO[c.acao]
  if (esperado.tipo !== a.tipo) throw new Error('Comando e ação do OBS não combinam')
  return {
    episodioId: ctx.episodioId,
    origem: 'toque',
    acao: esperado.acao,
    cenaId: a.tipo === 'trocar_cena' ? a.cenaId : null,
    somId: a.tipo === 'tocar_som' ? a.somId : null,
    avisoId: a.tipo === 'mostrar_aviso' ? a.avisoId : null,
    membroId: ctx.remetente,
    teste: ctx.modo === 'teste',
  }
}
