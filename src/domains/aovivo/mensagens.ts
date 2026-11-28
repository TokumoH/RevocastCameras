import type { TipoDeDispositivo } from '../acesso/dispositivos'
import { lerSituacaoDosGestos, type SituacaoDosGestos } from '../captura/gestos'
import { lerSituacaoDoVideo, type SituacaoDoVideo } from '../captura/sinais'
import { UUID } from '../preparacao/midia'

/*
 * Mensagens dos canais `estudio`, `episodio:<id>:controle` e, desde o VER-047, `episodio:<id>:estado` (DES-001 §8;
 * PLA-004, D6, D9, D14).
 * Tudo que chega pelo canal vem de fora: o Broadcast não autentica o remetente nem o conteúdo, e
 * a autorização de canal só separa tópicos. Por isso cada leitor:
 * - aceita só um objeto simples (protótipo `Object.prototype` ou nulo; nunca lista nem classe);
 * - lê só chaves próprias (nada herdado do protótipo) e recusa qualquer chave fora da forma,
 *   inclusive `__proto__` (que o `JSON.parse` cria como chave própria);
 * - confere tipo, tamanho e lista fechada de cada campo; uuid só em minúsculas;
 * - monta um objeto **novo**, campo a campo (nunca espalha o `payload`).
 * Inválido → `null`, e quem chama descarta sem efeito.
 *
 * Forma no fio (contrato com o adaptador da Tarefa 4): o evento do Broadcast leva o nome
 * (`episodio_ativo_mudou`, `dispositivo_mudou`, `revogacao`, `comando`, `estado`) e o `payload`
 * leva os campos da mensagem mais o `remetente` declarado (`auth.uid()` de quem enviou). Na
 * presença, o `realtime-js` acrescenta `presence_ref` a cada registro.
 */

/** uuid em minúsculas (a forma que o Postgres devolve): a de `preparacao/midia.ts`, a única do app (VER-046, N4). */
export { UUID }

/**
 * Nome do evento do Broadcast no tópico `episodio:<id>:controle`: só comandos dos membros. Desde o VER-047, o estado
 * no ar tem tópico próprio (`EVENTOS_DO_ESTADO`), porque o Realtime autoriza o envio por tópico, não por evento.
 */
export const EVENTOS_DO_CONTROLE = Object.freeze({ comando: 'comando' } as const)

/** Nome do evento do Broadcast no tópico `episodio:<id>:estado` (VER-047): só o estado no ar, que só o palco publica (RLS). */
export const EVENTOS_DO_ESTADO = Object.freeze({ estado: 'estado' } as const)

/** Tópico dos comandos do episódio (D6): membros enviam e recebem; o `obs_palco` só recebe (VER-047). */
export function topicoDoControle(episodioId: string): string {
  return `episodio:${episodioId}:controle`
}

/** Tópico do estado no ar do episódio (VER-047): só o `obs_palco` envia; membros e o palco recebem. */
export function topicoDoEstado(episodioId: string): string {
  return `episodio:${episodioId}:estado`
}

/** Mensagens de `estudio` (só `equipe`/`admin` publicam, D6). */
export type MensagemDoEstudio = { evento: 'episodio_ativo_mudou' } | { evento: 'dispositivo_mudou'; dispositivoId: string } | { evento: 'revogacao'; usuario: string }

/** Situação do OBS que o palco publica na presença e no estado (D13); nunca a senha do websocket. */
export interface SituacaoDoObs {
  navegador: boolean
  versaoDoPlugin: string | null
  nivel: number | null
  websocket: 'desligado' | 'conectado' | 'senha_errada' | 'sem_conexao'
  versaoObs: string | null
  replayBuffer: boolean | null
  gravando: boolean | null
}

/**
 * Corpo da presença em `estudio` (D14): a chave é o `auth.uid()`; sem e-mail e sem nome. Desde a E4 (PLA-005, D13), a
 * presença de `camera` e `obs_camera` pode levar `video` (a situação do vídeo daquele lado); no `obs_palco`, não. Desde a E5
 * (PLA-006, D12), as mesmas duas podem levar `gestos` (a situação do reconhecimento; nenhum quadro, ponto ou pontuação).
 */
export type PresencaNoEstudio =
  | { tipo: 'membro'; papel: 'admin' | 'equipe' | 'apresentadora' }
  | { tipo: TipoDeDispositivo; dispositivoId: string; obs: SituacaoDoObs | null; video?: SituacaoDoVideo; gestos?: SituacaoDosGestos }

/** Comando por toque (D9); o `id` (uuid) deduplica no palco. */
export type Comando = { id: string } & (
  | { acao: 'cena'; cenaId: string }
  | { acao: 'som'; somId: string }
  | { acao: 'aviso'; avisoId: string }
  | { acao: 'proxima_cena' | 'proximo_aviso' | 'ocultar_aviso' | 'clipe' | 'marcador' }
)

/** Tira uma chave de cada membro de uma união (o `Omit` comum só vê as chaves comuns e perderia `cenaId`, `somId` e `avisoId`). */
type SemChave<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** O que a tela pede (`/controle`, aba Ao vivo): o `Comando` sem o `id`, que quem envia gera (`crypto.randomUUID()`). */
export type PedidoDeComando = SemChave<Comando, 'id'>

export type ResultadoDoComando = 'ok' | 'pendente' | 'recusado' | 'falhou'

/**
 * Lista fechada dos motivos de recusa ou falha que o estado no ar pode levar: os de
 * `resolverComando` (`comandos.ts`) e os do executor do OBS (Tarefa 5). Texto livre (por exemplo,
 * uma mensagem de erro do OBS) nunca vai no estado. Motivo novo entra aqui.
 */
export const MOTIVOS_DO_RESULTADO = Object.freeze([
  'cena_inexistente',
  'som_inexistente',
  'aviso_inexistente',
  'sem_cenas',
  'fim_dos_avisos',
  'sem_aviso_no_ar',
  'cena_inexistente_no_obs',
  'sem_permissao',
  'replay_desligado',
  'sem_websocket',
  'sem_gravacao',
  'obs_ausente',
] as const)
export type MotivoDoResultado = (typeof MOTIVOS_DO_RESULTADO)[number]

/** Estado no ar que o palco publica em `:estado` (D9; em `:controle` até o VER-047): só ids e o nome da cena do OBS. */
export interface EstadoNoAr {
  episodioId: string
  modo: 'ao_vivo' | 'teste'
  cenaObs: string | null
  avisoId: string | null
  /** Instante (ms desde 1970) em que o aviso no ar sai. */
  avisoAte: number | null
  ultimo: { comandoId: string; acao: Comando['acao']; resultado: ResultadoDoComando; motivo: MotivoDoResultado | null } | null
  obs: SituacaoDoObs
}

const ACOES: readonly Comando['acao'][] = Object.freeze(['cena', 'som', 'aviso', 'proxima_cena', 'proximo_aviso', 'ocultar_aviso', 'clipe', 'marcador'] as const)
const RESULTADOS: readonly ResultadoDoComando[] = Object.freeze(['ok', 'pendente', 'recusado', 'falhou'] as const)
const PAPEIS = Object.freeze(['admin', 'equipe', 'apresentadora'] as const)
const TIPOS_DE_DISPOSITIVO: readonly TipoDeDispositivo[] = Object.freeze(['camera', 'obs_palco', 'obs_camera'] as const)
const ESTADOS_DO_WEBSOCKET: readonly SituacaoDoObs['websocket'][] = Object.freeze(['desligado', 'conectado', 'senha_errada', 'sem_conexao'] as const)

/** Nome de cena do OBS no estado (o OBS não limita; 200 basta e corta abuso). */
const TAMANHO_DA_CENA_OBS = 200
/** Versões (`31.0.1`, `2.24.0`). */
const TAMANHO_DA_VERSAO = 40
/** `presence_ref` do realtime-js. */
const TAMANHO_DA_REFERENCIA = 100
/** Níveis de controle do obs-browser: 0 NONE … 5 ALL. */
const NIVEL_MAXIMO = 5

type Objeto = Record<string, unknown>

/** Objeto simples, sem chave fora de `permitidas` (inclusive símbolos e `__proto__`). */
function objetoComChaves(valor: unknown, permitidas: readonly string[]): Objeto | null {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return null
  const prototipo: unknown = Object.getPrototypeOf(valor)
  if (prototipo !== Object.prototype && prototipo !== null) return null
  for (const chave of Reflect.ownKeys(valor)) {
    if (typeof chave !== 'string' || !permitidas.includes(chave)) return null
  }
  return valor as Objeto
}

/** Só a chave própria; herdada → `undefined`. */
function campo(o: Objeto, chave: string): unknown {
  return Object.hasOwn(o, chave) ? o[chave] : undefined
}

function ehUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v)
}

function daLista<T extends string>(v: unknown, lista: readonly T[]): v is T {
  return typeof v === 'string' && (lista as readonly string[]).includes(v)
}

function textoAte(v: unknown, tamanho: number): v is string {
  return typeof v === 'string' && Array.from(v).length <= tamanho
}

/** `remetente`, quando presente, tem de ser uuid; ausente é aceito (o adaptador confere à parte com `lerRemetente`). */
function remetenteValido(o: Objeto): boolean {
  return !Object.hasOwn(o, 'remetente') || ehUuid(o.remetente)
}

/** Remetente declarado no `payload` (DES-001 §8: não autenticado; serve para descartar revogados e registrar). */
export function lerRemetente(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const v = campo(payload as Objeto, 'remetente')
  return ehUuid(v) ? v : null
}

/**
 * Mensagem de `estudio`. O `payload` leva os campos da mensagem e o `remetente`; um `evento` no
 * corpo só é tolerado se for o mesmo do Broadcast.
 */
export function lerMensagemDoEstudio(evento: string, payload: unknown): MensagemDoEstudio | null {
  const comuns = ['evento', 'remetente']
  let o: Objeto | null
  switch (evento) {
    case 'episodio_ativo_mudou':
      o = objetoComChaves(payload, comuns)
      break
    case 'dispositivo_mudou':
      o = objetoComChaves(payload, [...comuns, 'dispositivoId'])
      break
    case 'revogacao':
      o = objetoComChaves(payload, [...comuns, 'usuario'])
      break
    default:
      return null
  }
  if (o === null || !remetenteValido(o)) return null
  if (Object.hasOwn(o, 'evento') && o.evento !== evento) return null
  if (evento === 'episodio_ativo_mudou') return { evento }
  if (evento === 'dispositivo_mudou') {
    const dispositivoId = campo(o, 'dispositivoId')
    return ehUuid(dispositivoId) ? { evento, dispositivoId } : null
  }
  const usuario = campo(o, 'usuario')
  return ehUuid(usuario) ? { evento: 'revogacao', usuario } : null
}

const ALVO_DA_ACAO: Readonly<Partial<Record<Comando['acao'], 'cenaId' | 'somId' | 'avisoId'>>> = Object.freeze({
  cena: 'cenaId',
  som: 'somId',
  aviso: 'avisoId',
})

/** Comando de `:controle`: `id` uuid, ação da lista e, em `cena`/`som`/`aviso`, o alvo uuid (e nenhum outro campo). */
export function lerComando(payload: unknown): Comando | null {
  if (typeof payload !== 'object' || payload === null) return null
  const acao = campo(payload as Objeto, 'acao')
  if (!daLista(acao, ACOES)) return null
  const alvo = ALVO_DA_ACAO[acao]
  const o = objetoComChaves(payload, alvo === undefined ? ['id', 'acao', 'remetente'] : ['id', 'acao', 'remetente', alvo])
  if (o === null || !remetenteValido(o)) return null
  const id = campo(o, 'id')
  if (!ehUuid(id)) return null
  if (alvo === undefined) {
    return acao === 'cena' || acao === 'som' || acao === 'aviso' ? null : { id, acao }
  }
  const valor = campo(o, alvo)
  if (!ehUuid(valor)) return null
  if (acao === 'cena') return { id, acao, cenaId: valor }
  if (acao === 'som') return { id, acao, somId: valor }
  return { id, acao: 'aviso', avisoId: valor }
}

const CHAVES_DO_OBS = ['navegador', 'versaoDoPlugin', 'nivel', 'websocket', 'versaoObs', 'replayBuffer', 'gravando']

function todasPresentes(o: Objeto, chaves: readonly string[]): boolean {
  return chaves.every((c) => Object.hasOwn(o, c))
}

function booleanoOuNulo(v: unknown): v is boolean | null {
  return v === null || typeof v === 'boolean'
}

function versaoOuNula(v: unknown): v is string | null {
  return v === null || textoAte(v, TAMANHO_DA_VERSAO)
}

function lerSituacaoDoObs(valor: unknown): SituacaoDoObs | null {
  const o = objetoComChaves(valor, CHAVES_DO_OBS)
  if (o === null || !todasPresentes(o, CHAVES_DO_OBS)) return null
  const { navegador, versaoDoPlugin, nivel, websocket, versaoObs, replayBuffer, gravando } = o
  if (typeof navegador !== 'boolean') return null
  if (!versaoOuNula(versaoDoPlugin) || !versaoOuNula(versaoObs)) return null
  if (nivel !== null && !(typeof nivel === 'number' && Number.isInteger(nivel) && nivel >= 0 && nivel <= NIVEL_MAXIMO)) return null
  if (!daLista(websocket, ESTADOS_DO_WEBSOCKET)) return null
  if (!booleanoOuNulo(replayBuffer) || !booleanoOuNulo(gravando)) return null
  return { navegador, versaoDoPlugin, nivel, websocket, versaoObs, replayBuffer, gravando }
}

const CHAVES_DO_ULTIMO = ['comandoId', 'acao', 'resultado', 'motivo']

function lerUltimo(valor: unknown): EstadoNoAr['ultimo'] | undefined {
  if (valor === null) return null
  const o = objetoComChaves(valor, CHAVES_DO_ULTIMO)
  if (o === null || !todasPresentes(o, CHAVES_DO_ULTIMO)) return undefined
  const { comandoId, acao, resultado, motivo } = o
  if (!ehUuid(comandoId) || !daLista(acao, ACOES) || !daLista(resultado, RESULTADOS)) return undefined
  if (motivo !== null && !daLista(motivo, MOTIVOS_DO_RESULTADO)) return undefined
  return { comandoId, acao, resultado, motivo }
}

const CHAVES_DO_ESTADO = ['episodioId', 'modo', 'cenaObs', 'avisoId', 'avisoAte', 'ultimo', 'obs']

/** Estado no ar: `cenaObs` até 200 caracteres; `avisoAte` finito e ≥ 0; `motivo` da lista fixa; todos os campos presentes. */
export function lerEstadoNoAr(payload: unknown): EstadoNoAr | null {
  const o = objetoComChaves(payload, [...CHAVES_DO_ESTADO, 'remetente'])
  if (o === null || !remetenteValido(o) || !todasPresentes(o, CHAVES_DO_ESTADO)) return null
  const { episodioId, modo, cenaObs, avisoId, avisoAte } = o
  if (!ehUuid(episodioId)) return null
  if (modo !== 'ao_vivo' && modo !== 'teste') return null
  if (cenaObs !== null && !textoAte(cenaObs, TAMANHO_DA_CENA_OBS)) return null
  if (avisoId !== null && !ehUuid(avisoId)) return null
  if (avisoAte !== null && !(typeof avisoAte === 'number' && Number.isFinite(avisoAte) && avisoAte >= 0)) return null
  const ultimo = lerUltimo(o.ultimo)
  if (ultimo === undefined) return null
  const obs = lerSituacaoDoObs(o.obs)
  if (obs === null) return null
  return { episodioId, modo, cenaObs, avisoId, avisoAte, ultimo, obs }
}

function referenciaValida(o: Objeto): boolean {
  return !Object.hasOwn(o, 'presence_ref') || textoAte(o.presence_ref, TAMANHO_DA_REFERENCIA)
}

/**
 * Mensagem de `:controle` (VER-047): só o evento `comando`, lido por `lerComando`. Qualquer outro evento (um `estado`
 * forjado por quem pode enviar ali, mesmo válido) → `null`: o estado só é aceito vindo de `:estado`.
 */
export function lerMensagemDoControle(evento: string, payload: unknown): Comando | null {
  return evento === EVENTOS_DO_CONTROLE.comando ? lerComando(payload) : null
}

/**
 * Mensagem de `:estado` (VER-047): só o evento `estado`, lido por `lerEstadoNoAr`. Qualquer outro evento (um `comando`
 * forjado, mesmo válido) → `null`: comando só é aceito vindo de `:controle`.
 */
export function lerMensagemDoEstado(evento: string, payload: unknown): EstadoNoAr | null {
  return evento === EVENTOS_DO_ESTADO.estado ? lerEstadoNoAr(payload) : null
}

/** Tipos de dispositivo cuja presença pode levar `video` (D13 do PLA-005) e `gestos` (D12 do PLA-006): só os dois lados do vídeo. */
const TIPOS_COM_VIDEO: readonly TipoDeDispositivo[] = Object.freeze(['camera', 'obs_camera'] as const)

/**
 * Um registro de presença de `estudio` (o `presence_ref` do realtime-js é tolerado e descartado). O `video` opcional
 * (desde a E4) só vale em `camera` e `obs_camera` e passa por `lerSituacaoDoVideo`; no `obs_palco`, ou inválido → `null`.
 * O `gestos` opcional (desde a E5, D12 do PLA-006) segue a mesma regra, por `lerSituacaoDosGestos`; os dois juntos valem.
 */
export function lerPresenca(payload: unknown): PresencaNoEstudio | null {
  if (typeof payload !== 'object' || payload === null) return null
  const tipo = campo(payload as Objeto, 'tipo')
  if (tipo === 'membro') {
    const o = objetoComChaves(payload, ['tipo', 'papel', 'presence_ref'])
    if (o === null || !referenciaValida(o)) return null
    const papel = campo(o, 'papel')
    return daLista(papel, PAPEIS) ? { tipo, papel } : null
  }
  if (!daLista(tipo, TIPOS_DE_DISPOSITIVO)) return null
  const o = objetoComChaves(payload, ['tipo', 'dispositivoId', 'obs', 'video', 'gestos', 'presence_ref'])
  if (o === null || !referenciaValida(o) || !todasPresentes(o, ['dispositivoId', 'obs'])) return null
  const dispositivoId = campo(o, 'dispositivoId')
  if (!ehUuid(dispositivoId)) return null
  const obs = o.obs === null ? null : lerSituacaoDoObs(o.obs)
  if (o.obs !== null && obs === null) return null
  const temVideo = Object.hasOwn(o, 'video')
  const temGestos = Object.hasOwn(o, 'gestos')
  if (!temVideo && !temGestos) return { tipo, dispositivoId, obs }
  if (!TIPOS_COM_VIDEO.includes(tipo)) return null
  const video = temVideo ? lerSituacaoDoVideo(o.video) : undefined
  const gestos = temGestos ? lerSituacaoDosGestos(o.gestos) : undefined
  if (video === null || gestos === null) return null
  return {
    tipo,
    dispositivoId,
    obs,
    ...(video === undefined ? {} : { video }),
    ...(gestos === undefined ? {} : { gestos }),
  }
}

/** Por quanto tempo um remetente revogado é descartado: 15 min, mais que os 10 min do JWT (D5). */
export const REVOGACAO_LEMBRADA_MS = 900_000

/**
 * Remetentes revogados (aviso `revogacao` de `estudio`), descartados por 15 min (D5); depois disso
 * vale a revalidação do Realtime na renovação do token, sem bloquear para sempre quem for
 * liberado de novo. Revogar de novo renova o prazo; entradas vencidas saem a cada `revogar`.
 */
export class Revogados {
  readonly #agora: () => number
  readonly #ate = new Map<string, number>()

  constructor(agora: () => number) {
    this.#agora = agora
  }

  revogar(usuario: string): void {
    const agora = this.#agora()
    for (const [u, ate] of this.#ate) if (ate <= agora) this.#ate.delete(u)
    this.#ate.set(usuario, agora + REVOGACAO_LEMBRADA_MS)
  }

  contem(usuario: string): boolean {
    const ate = this.#ate.get(usuario)
    return ate !== undefined && this.#agora() < ate
  }
}
