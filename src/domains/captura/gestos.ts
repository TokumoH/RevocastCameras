import { GESTOS, type Gesto } from '../preparacao/gestos'
import { UUID } from '../preparacao/midia'
import { campo, ehUuid, extrasValidos, objetoComChaves } from './sinais'

/*
 * Gestos da Captura (PLA-006, D2–D5, D11, D12). O aparelho que reconhece manda o gesto confirmado por
 * `rpc('enviar_gesto')`: a função do banco confere a sessão a cada chamada, põe o `dispositivo` e o `remetente` e publica
 * com `realtime.send` no tópico da sessão atual do palco (`gestos:<uid>`), em que nenhum cliente envia (D2). O aviso
 * `gestos_mudaram` (D4) chega do mesmo jeito, por `definir_gestos_ligados`, e **não leva valor**: quem recebe relê no banco.
 * Mesmo vindo do banco, tudo é validado aqui antes de qualquer efeito (como em `sinais.ts`): objeto simples, só as chaves
 * da forma (nunca `__proto__`), cada campo conferido, objeto **novo** montado campo a campo. Inválido → `null`.
 */

/** Segurar o mesmo gesto por 1 s para confirmar (D3). */
export const SEGURAR_MS = 1000
/** Intervalo mínimo entre dois gestos confirmados no aparelho (D3). */
export const INTERVALO_MS = 3000
/** O intervalo conferido no banco e no palco: 500 ms de margem para os relógios diferentes (D3; revisão 1, I1). */
export const INTERVALO_DO_SERVIDOR_MS = INTERVALO_MS - 500
/** Buraco tolerado entre duas leituras com o gesto; a usada é `max(TOLERANCIA_MS, 2 × período)` (D3; revisão 1, N5). */
export const TOLERANCIA_MS = 300
/** Depois de confirmar, o mesmo gesto só conta de novo depois de 500 ms sem ele (D3). */
export const SOLTAR_MS = 500
/** Abaixo desta confiança, o quadro conta como "sem gesto" (D3). */
export const CONFIANCA_MINIMA = 0.7
/** Taxa normal do reconhecimento (DES-001 §4.2; D11). */
export const QUADROS_POR_SEGUNDO = 10
/** Taxa reduzida quando a média passa de `MS_PARA_REDUZIR` (D11). */
export const QUADROS_REDUZIDOS = 5
/** Quadros na média móvel do tempo por quadro (D11). */
export const JANELA_DA_MEDIA = 20
/** Média acima disto → 5 quadros/s (D11). */
export const MS_PARA_REDUZIR = 120
/** Média acima disto por `TEMPO_LENTO_MS` → para, situação `lento` (D11). */
export const MS_PARA_PARAR = 400
export const TEMPO_LENTO_MS = 10_000
/** Prazo para baixar, conferir e iniciar o reconhecedor (4G lento) → `falhou` (D11). */
export const ESPERA_DO_RECONHECEDOR_MS = 60_000

/**
 * Tópico de recebimento dos gestos (D2): o `auth.uid()` da **própria** sessão (nunca o id do dispositivo, que o
 * repareamento mantém). Fora de uuid minúsculo → lança (a autorização do canal compara o texto exato).
 */
export function topicoDosGestos(usuarioId: string): string {
  if (!UUID.test(usuarioId)) throw new Error('topicoDosGestos: usuário fora do formato uuid')
  return `gestos:${usuarioId}`
}

/** Os eventos do `realtime.send` nos tópicos de gestos: o gesto (para o palco) e o aviso do interruptor (D2, D4). */
export const EVENTOS_DOS_GESTOS = Object.freeze({ gesto: 'gesto', gestosMudaram: 'gestos_mudaram' } as const)

/** Um gesto que chegou ao palco: o `id` é o uuid do gesto (`gesto_id` no fio); o `dispositivoId`, o que o banco pôs. */
export interface GestoRecebido {
  id: string
  gesto: Gesto
  dispositivoId: string
}

const NOMES_DOS_GESTOS: readonly string[] = Object.freeze(GESTOS.map((g) => g.gesto))

/** Um dos 7 gestos (`None` e qualquer outro texto não são gesto); o laço também confere a leitura do worker com ele. */
export function ehGesto(v: unknown): v is Gesto {
  return typeof v === 'string' && NOMES_DOS_GESTOS.includes(v)
}

/**
 * Chaves do gesto no fio (D2): o `realtime.send` acrescenta `id` ao payload, então o uuid do gesto vai como `gesto_id`;
 * o `id` do `realtime.send` e o `remetente` (lido à parte, por `lerRemetente`) são aceitos, se uuid, e nunca entram no gesto.
 */
const CHAVES_DO_GESTO = ['tipo', 'gesto_id', 'gesto', 'dispositivo', 'remetente', 'id']

/**
 * Gesto para o palco: só o evento `gesto` e o `tipo: 'gesto'`, com `gesto_id` e `dispositivo` em uuid minúsculo e o
 * `gesto` entre os 7 (`None` não é gesto). Devolve objeto novo só com `id`, `gesto` e `dispositivoId`.
 */
export function lerGestoParaOPalco(evento: string, payload: unknown): GestoRecebido | null {
  if (evento !== EVENTOS_DOS_GESTOS.gesto) return null
  const o = objetoComChaves(payload, CHAVES_DO_GESTO)
  if (o === null || campo(o, 'tipo') !== 'gesto' || !extrasValidos(o)) return null
  const id = campo(o, 'gesto_id')
  const gesto = campo(o, 'gesto')
  const dispositivo = campo(o, 'dispositivo')
  if (!ehUuid(id) || !ehGesto(gesto) || !ehUuid(dispositivo)) return null
  return { id, gesto, dispositivoId: dispositivo }
}

const CHAVES_DO_AVISO = ['tipo', 'remetente', 'id']

/**
 * Aviso do interruptor (D4): só o evento e o `tipo` `gestos_mudaram`, com `remetente` e `id` opcionais (uuid). Qualquer
 * outro campo, inclusive um `ligados`, → `null`: o aviso não leva valor, quem recebe relê no banco.
 */
export function lerAvisoDosGestos(evento: string, payload: unknown): { tipo: 'gestos_mudaram' } | null {
  if (evento !== EVENTOS_DOS_GESTOS.gestosMudaram) return null
  const o = objetoComChaves(payload, CHAVES_DO_AVISO)
  if (o === null || campo(o, 'tipo') !== 'gestos_mudaram' || !extrasValidos(o)) return null
  return { tipo: 'gestos_mudaram' }
}

/** O que o worker devolve por quadro (D8): só o gesto, a confiança e o tempo; nenhum quadro, ponto da mão ou imagem. */
export interface LeituraDoGesto {
  gesto: Gesto | null
  confianca: number
  ms: number
}

/** Situação do reconhecimento num aparelho (D12). */
export type EstadoDosGestos = 'desligados' | 'outro_aparelho' | 'aguardando_video' | 'carregando' | 'reconhecendo' | 'lento' | 'sem_suporte' | 'falhou'

/** O que vai na presença de `camera` e `obs_camera` (D12): números finitos e não negativos, ou `null`. */
export interface SituacaoDosGestos {
  estado: EstadoDosGestos
  quadrosPorSegundo: number | null
  msPorQuadro: number | null
}

const ESTADOS_DOS_GESTOS: readonly EstadoDosGestos[] = Object.freeze([
  'desligados',
  'outro_aparelho',
  'aguardando_video',
  'carregando',
  'reconhecendo',
  'lento',
  'sem_suporte',
  'falhou',
] as const)
const CHAVES_DA_SITUACAO = ['estado', 'quadrosPorSegundo', 'msPorQuadro']

function numeroOuNulo(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0)
}

/** Situação dos gestos na presença (D12): os três campos presentes; estado da lista; números finitos ≥ 0 ou `null`. */
export function lerSituacaoDosGestos(x: unknown): SituacaoDosGestos | null {
  const o = objetoComChaves(x, CHAVES_DA_SITUACAO)
  if (o === null || !CHAVES_DA_SITUACAO.every((c) => Object.hasOwn(o, c))) return null
  const estado = campo(o, 'estado')
  const quadrosPorSegundo = campo(o, 'quadrosPorSegundo')
  const msPorQuadro = campo(o, 'msPorQuadro')
  if (typeof estado !== 'string' || !(ESTADOS_DOS_GESTOS as readonly string[]).includes(estado)) return null
  if (!numeroOuNulo(quadrosPorSegundo) || !numeroOuNulo(msPorQuadro)) return null
  return { estado: estado as EstadoDosGestos, quadrosPorSegundo, msPorQuadro }
}

/**
 * Resposta de `enviar_gesto` traduzida pelo adaptador (D2): `intervalo` e `desligados` vêm do banco sem erro (nada
 * publicado); `sem_palco` = nenhum `obs_palco` pareado; `limite` = `54000`; `negado` = `42501` ou `55000` (revisão 1, N3);
 * o resto (rede, tempo-limite) = `falhou`. O laço trata `desligados` como `negado`: para e a rota reavalia (revisão 2, N14).
 */
export type RespostaDoGesto = 'enviado' | 'intervalo' | 'desligados' | 'sem_palco' | 'limite' | 'negado' | 'falhou'
