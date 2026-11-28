import type { Cena } from '../preparacao/cenas'
import type { Aviso } from '../preparacao/episodios'
import type { AcaoDoGesto, LinhaDoMapa } from '../preparacao/gestos'
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

/**
 * Autor de uma linha do registro (desde a E5, PLA-006, D6): o toque leva o membro que **declarou** ser o remetente
 * (DES-001 §8); o gesto leva o dispositivo que o **servidor** pôs no payload (`enviar_gesto`, D2). Exatamente um dos
 * dois, como o `check` `registro_acoes_um_autor` da E0.
 */
export type AutorDoRegistro = { origem: 'toque'; membroId: string } | { origem: 'gesto'; dispositivoId: string }

/** Linha de `registro_acoes` (D9): exatamente as colunas que o adaptador grava. */
export type LinhaDoRegistro = {
  episodioId: string
  acao: AcaoDoGesto
  cenaId: string | null
  somId: string | null
  avisoId: string | null
  teste: boolean
} & AutorDoRegistro

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
 * Monta a linha do registro de um comando executado (D9): `origem` e autor vêm de `ctx.autor` (toque → `membroId`, o
 * remetente declarado; gesto → `dispositivoId`, o do servidor; desde a E5, D6), `teste` = modo teste; o alvo vem da ação
 * resolvida (na `proxima_cena`, a cena para onde foi). Comando e ação que não combinam → lança (erro de programação,
 * nunca gravado).
 */
export function linhaDoRegistro(
  c: Comando,
  a: AcaoNoObs,
  ctx: { episodioId: string; modo: 'ao_vivo' | 'teste'; autor: AutorDoRegistro },
): LinhaDoRegistro {
  const esperado = REGISTRO_DO_COMANDO[c.acao]
  if (esperado.tipo !== a.tipo) throw new Error('Comando e ação do OBS não combinam')
  const base = {
    episodioId: ctx.episodioId,
    acao: esperado.acao,
    cenaId: a.tipo === 'trocar_cena' ? a.cenaId : null,
    somId: a.tipo === 'tocar_som' ? a.somId : null,
    avisoId: a.tipo === 'mostrar_aviso' ? a.avisoId : null,
    teste: ctx.modo === 'teste',
  }
  // campo a campo: nunca espalha o autor (um objeto com as duas chaves não passa as duas adiante)
  return ctx.autor.origem === 'toque'
    ? { ...base, origem: 'toque', membroId: ctx.autor.membroId }
    : { ...base, origem: 'gesto', dispositivoId: ctx.autor.dispositivoId }
}

/**
 * O comando que um gesto aceito pede (PLA-006, D6), pela linha do mapa de gestos: `cena` → `{ acao: 'cena', cenaId }`;
 * `som` → `{ acao: 'som', somId }`; `proximo_aviso`, `ocultar_aviso`, `proxima_cena`, `clipe` e `marcador` → a mesma ação,
 * sem alvo; `nenhuma` → `null` (o palco recusa com `gesto_sem_acao`, nada executado). O `id` do comando é o do gesto (o
 * palco deduplica e o estado no ar o mostra como `comandoId`). Só o alvo da própria ação é lido (como `normalizarGesto`);
 * `cena` ou `som` sem alvo (o CHECK `mapa_gestos_equivalencia` não deixa gravar) → `null`, como `nenhuma`.
 */
export function comandoDoGesto(l: LinhaDoMapa, id: string): Comando | null {
  switch (l.acao) {
    case 'cena':
      return l.cenaId === null ? null : { id, acao: 'cena', cenaId: l.cenaId }
    case 'som':
      return l.somId === null ? null : { id, acao: 'som', somId: l.somId }
    case 'proximo_aviso':
    case 'ocultar_aviso':
    case 'proxima_cena':
    case 'clipe':
    case 'marcador':
      return { id, acao: l.acao }
    case 'nenhuma':
      return null
  }
}
