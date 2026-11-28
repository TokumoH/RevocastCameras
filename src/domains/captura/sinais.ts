import { UUID } from '../preparacao/midia'

/*
 * Sinais do vídeo da câmera (PLA-005, D2–D4, D6, D13). Cada sinal sai por `rpc('enviar_sinal_de_video')`: a função do
 * banco confere a sessão a cada chamada, põe o `remetente` (`auth.uid()` de quem chamou) e publica com `realtime.send`
 * no tópico da sessão atual do par (`video:<uid>`), em que nenhum cliente envia (D2). O `payload` que chega é
 * `{ tipo, sessao, sdp?, remetente, id }` (o `id` é o que o `realtime.send` acrescenta).
 * Mesmo vindo do banco, tudo é validado aqui antes de qualquer efeito (defesa em profundidade, como em
 * `aovivo/mensagens.ts`): objeto simples, só chaves próprias da forma (nunca `__proto__`), cada campo conferido,
 * objeto **novo** montado campo a campo. Inválido → `null`. Cada leitor aceita só os sinais do outro lado (D3).
 */

/** Nome do evento do `realtime.send` nos tópicos de vídeo (D4): um só. */
export const EVENTO_DO_SINAL = 'sinal'

/**
 * Tópico de recebimento do vídeo (D2): o `auth.uid()` da **própria** sessão (nunca o id do dispositivo, que o
 * repareamento mantém). Fora de uuid minúsculo → lança (a autorização do canal compara o texto exato).
 */
export function topicoDoVideo(usuarioId: string): string {
  if (!UUID.test(usuarioId)) throw new Error('topicoDoVideo: usuário fora do formato uuid')
  return `video:${usuarioId}`
}

/**
 * Teto do SDP (D4): ≈ 2,8 × a oferta medida no Chromium 153 com câmera falsa (4 224 caracteres, F21). O mesmo valor da
 * função do banco (revisão 2, I7).
 */
export const TAMANHO_MAXIMO_DO_SDP = 12_000

export type SinalDaCamera = { tipo: 'oferta'; sessao: string; sdp: string } | { tipo: 'encerrar'; sessao: string }
export type SinalDaObs = { tipo: 'pronto'; sessao: string } | { tipo: 'resposta'; sessao: string; sdp: string } | { tipo: 'encerrar'; sessao: string }

/**
 * Situação do vídeo de um lado (D6, D13): o que a tela, o selo e a presença mostram. `sem_video_direto` (VER-052, rodada 1,
 * I2): o navegador não tem `RTCPeerConnection`; quem a publica é a rota (o emissor e o receptor nunca chegam a ela), para a
 * aba Ao vivo mostrar a causa em vez de `aguardando_toque`.
 */
export type EstadoDoVideo =
  | 'aguardando_toque'
  | 'aguardando_episodio'
  | 'aguardando_par'
  | 'conectando'
  | 'conectado'
  | 'sem_conexao_direta'
  | 'sem_permissao'
  | 'sem_camera'
  | 'inseguro'
  | 'sinal_grande'
  | 'sem_video_direto'

/** O que vai na presença de `camera` e `obs_camera` em `estudio` (D13); nenhum dado de pessoa. */
export interface SituacaoDoVideo {
  estado: EstadoDoVideo
  telaLigada: 'travada' | 'sem_trava' | null
  /** De 0 a 1; `null` onde o navegador não informa. */
  bateria: number | null
}

/** Espera do fim da coleta dos candidatos ICE (D4: não incremental). */
export const ESPERA_DO_ICE_MS = 3000
/** Oferta enviada sem resposta: falha (D6). */
export const ESPERA_DA_RESPOSTA_MS = 15_000
/** `caiu` (disconnected): espera o ICE se recuperar antes de uma oferta nova (D6). */
export const ESPERA_DA_QUEDA_MS = 5000
/** Resposta aceita sem chegar a `conectado`: conta como falha (revisão 1, I2). */
export const ESPERA_DA_CONEXAO_MS = 20_000
/** Esperas crescentes entre tentativas (D6); depois da última, 30 s sempre. */
export const ESPERAS_DE_RECONEXAO_MS = [2000, 4000, 8000, 16000, 30000] as const
/** Falhas seguidas, depois de uma resposta aceita, que levam a `sem_conexao_direta` (D6). */
export const FALHAS_PARA_SEM_CONEXAO_DIRETA = 2
/** O `obs_camera` repete o `pronto` enquanto a conexão não está `conectado` (D3). */
export const PRONTO_A_CADA_MS = 10_000
/** A presença com a situação do vídeo é remarcada no máximo a cada 10 s (D13; F1). */
export const PRESENCA_MINIMA_MS = 10_000

/** Espera antes da tentativa `n` (0, 1, 2…): 2000, 4000, 8000, 16000, 30000, 30000… */
export function esperaDaTentativa(n: number): number {
  const ultima = ESPERAS_DE_RECONEXAO_MS.length - 1
  const i = Number.isInteger(n) && n > 0 ? Math.min(n, ultima) : 0
  return ESPERAS_DE_RECONEXAO_MS[i]
}

const COMECO_DO_SDP = 'v=0\r\n'
/** Só ASCII imprimível (espaço a `~`), `\r` e `\n`. */
const CARACTERES_DO_SDP = /^[\x20-\x7e\r\n]*$/

/**
 * A mesma regra do leitor e da função do banco (D4; revisão 2, N8): até 12 000 caracteres (`grande`), começa com
 * `v=0\r\n` e só tem ASCII imprimível, `\r` e `\n` (`forma`). O emissor e o receptor conferem o próprio SDP antes de
 * enviar (revisão 3, N13).
 */
export function conferirSdp(sdp: string): 'ok' | 'grande' | 'forma' {
  if (sdp.length > TAMANHO_MAXIMO_DO_SDP) return 'grande'
  if (!sdp.startsWith(COMECO_DO_SDP) || !CARACTERES_DO_SDP.test(sdp)) return 'forma'
  return 'ok'
}

export type Objeto = Record<string, unknown>

/**
 * Objeto simples, sem chave fora de `permitidas` (inclusive símbolos e `__proto__`). Exportado desde a E5 para os leitores
 * do tópico de gestos (`gestos.ts`) usarem a mesma regra.
 */
export function objetoComChaves(valor: unknown, permitidas: readonly string[]): Objeto | null {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return null
  const prototipo: unknown = Object.getPrototypeOf(valor)
  if (prototipo !== Object.prototype && prototipo !== null) return null
  for (const chave of Reflect.ownKeys(valor)) {
    if (typeof chave !== 'string' || !permitidas.includes(chave)) return null
  }
  return valor as Objeto
}

/** Só a chave própria; herdada → `undefined`. */
export function campo(o: Objeto, chave: string): unknown {
  return Object.hasOwn(o, chave) ? o[chave] : undefined
}

export function ehUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v)
}

/** `remetente` (posto pela função) e `id` (do `realtime.send`), quando presentes, são uuid; nunca entram no sinal. */
export function extrasValidos(o: Objeto): boolean {
  return (!Object.hasOwn(o, 'remetente') || ehUuid(o.remetente)) && (!Object.hasOwn(o, 'id') || ehUuid(o.id))
}

const COM_SDP = ['tipo', 'sessao', 'sdp', 'remetente', 'id']
const SEM_SDP = ['tipo', 'sessao', 'remetente', 'id']

type Lido = { tipo: string; sessao: string; sdp: string | null }

/** Lê `tipo`, `sessao` e, só nos tipos `comSdp`, o `sdp` (obrigatório ali e proibido nos outros). */
function lerSinal(evento: string, payload: unknown, tipos: readonly string[], comSdp: readonly string[]): Lido | null {
  if (evento !== EVENTO_DO_SINAL) return null
  if (typeof payload !== 'object' || payload === null) return null
  const tipo = campo(payload as Objeto, 'tipo')
  if (typeof tipo !== 'string' || !tipos.includes(tipo)) return null
  const levaSdp = comSdp.includes(tipo)
  const o = objetoComChaves(payload, levaSdp ? COM_SDP : SEM_SDP)
  if (o === null || !extrasValidos(o)) return null
  const sessao = campo(o, 'sessao')
  if (!ehUuid(sessao)) return null
  if (!levaSdp) return { tipo, sessao, sdp: null }
  const sdp = campo(o, 'sdp')
  if (typeof sdp !== 'string' || conferirSdp(sdp) !== 'ok') return null
  return { tipo, sessao, sdp }
}

/**
 * Sinal que a **câmera** enviou (lido pelo `obs_camera`): `oferta` ou `encerrar`. O remetente fica no `payload` e é lido
 * à parte pelo adaptador (`lerRemetente`).
 */
export function lerSinalDaCamera(evento: string, payload: unknown): SinalDaCamera | null {
  const s = lerSinal(evento, payload, ['oferta', 'encerrar'], ['oferta'])
  if (s === null) return null
  if (s.tipo === 'oferta' && s.sdp !== null) return { tipo: 'oferta', sessao: s.sessao, sdp: s.sdp }
  return s.tipo === 'encerrar' ? { tipo: 'encerrar', sessao: s.sessao } : null
}

/** Sinal que o **`obs_camera`** enviou (lido pela câmera): `pronto`, `resposta` ou `encerrar`. */
export function lerSinalDaObs(evento: string, payload: unknown): SinalDaObs | null {
  const s = lerSinal(evento, payload, ['pronto', 'resposta', 'encerrar'], ['resposta'])
  if (s === null) return null
  if (s.tipo === 'resposta' && s.sdp !== null) return { tipo: 'resposta', sessao: s.sessao, sdp: s.sdp }
  if (s.tipo === 'pronto') return { tipo: 'pronto', sessao: s.sessao }
  return s.tipo === 'encerrar' ? { tipo: 'encerrar', sessao: s.sessao } : null
}

const ESTADOS_DO_VIDEO: readonly EstadoDoVideo[] = Object.freeze([
  'aguardando_toque',
  'aguardando_episodio',
  'aguardando_par',
  'conectando',
  'conectado',
  'sem_conexao_direta',
  'sem_permissao',
  'sem_camera',
  'inseguro',
  'sinal_grande',
  'sem_video_direto',
] as const)
const TELA_LIGADA: readonly string[] = Object.freeze(['travada', 'sem_trava'] as const)
const CHAVES_DA_SITUACAO = ['estado', 'telaLigada', 'bateria']

/** Situação do vídeo na presença (D13): os três campos presentes; bateria finita em [0, 1] ou `null`. */
export function lerSituacaoDoVideo(x: unknown): SituacaoDoVideo | null {
  const o = objetoComChaves(x, CHAVES_DA_SITUACAO)
  if (o === null || !CHAVES_DA_SITUACAO.every((c) => Object.hasOwn(o, c))) return null
  const { estado, telaLigada, bateria } = o
  if (typeof estado !== 'string' || !(ESTADOS_DO_VIDEO as readonly string[]).includes(estado)) return null
  if (telaLigada !== null && !(typeof telaLigada === 'string' && TELA_LIGADA.includes(telaLigada))) return null
  if (bateria !== null && !(typeof bateria === 'number' && Number.isFinite(bateria) && bateria >= 0 && bateria <= 1)) return null
  return { estado: estado as EstadoDoVideo, telaLigada: telaLigada as SituacaoDoVideo['telaLigada'], bateria }
}
