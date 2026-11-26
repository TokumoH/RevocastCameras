/** Os dois tipos de mídia da Biblioteca (= tipo `public.tipo_midia` do banco). */
export type TipoDeMidia = 'som' | 'imagem'

export interface TipoAceito {
  tipo: TipoDeMidia
  mime: string
  extensao: string
}

/**
 * Os 8 tipos aceitos (PLA-003, D4), na ordem: sons e depois imagens. São os mesmos do
 * `allowed_mime_types` do bucket e das extensões da política de `insert` (Tarefa 3).
 * SVG fica fora (carrega script), assim como HTML, PDF e vídeo.
 */
export const TIPOS_ACEITOS: readonly TipoAceito[] = Object.freeze(
  (
    [
      { tipo: 'som', mime: 'audio/mpeg', extensao: 'mp3' },
      { tipo: 'som', mime: 'audio/wav', extensao: 'wav' },
      { tipo: 'som', mime: 'audio/ogg', extensao: 'ogg' },
      { tipo: 'som', mime: 'audio/mp4', extensao: 'm4a' },
      { tipo: 'imagem', mime: 'image/png', extensao: 'png' },
      { tipo: 'imagem', mime: 'image/jpeg', extensao: 'jpg' },
      { tipo: 'imagem', mime: 'image/webp', extensao: 'webp' },
      { tipo: 'imagem', mime: 'image/gif', extensao: 'gif' },
    ] as const
  ).map((t) => Object.freeze({ ...t })),
)

/** 50 MB por arquivo: o mesmo valor do CHECK `midias_tamanho_ate_50mb` e do `file_size_limit` do bucket. */
export const LIMITE_POR_ARQUIVO_BYTES = 52_428_800

/** 1 GB do Storage do plano Free, no sentido menor (10⁹; D7). */
export const LIMITE_TOTAL_BYTES = 1_000_000_000

/** Quantos bytes do começo do arquivo a tela lê para detectar o tipo (`Blob.slice(0, 16)`). */
export const BYTES_PARA_DETECTAR = 16

/** Um trecho da assinatura: `bytes` a partir de `deslocamento`, comparados depois da `mascara` (se houver). */
interface Trecho {
  deslocamento: number
  bytes: readonly number[]
  mascara?: readonly number[]
}

/** Uma assinatura casa quando todos os trechos casam; um tipo casa quando alguma das suas assinaturas casa. */
type Assinatura = readonly Trecho[]

const texto = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0))

/**
 * Tabela fixa de assinaturas (bytes mágicos), por extensão. Nada de procurar texto no arquivo:
 * cada trecho tem posição exata.
 *
 * MP3: etiqueta `ID3` das versões 2.3 ou 2.4 (byte 3 = `03` ou `04`, para que um texto que
 * comece por "ID3" não passe) ou um cabeçalho de quadro MPEG **camada III** (`FF` seguido de `FA`/`FB`
 * MPEG-1, `F2`/`F3` MPEG-2 ou `E2`/`E3` MPEG-2.5; o último bit é o da proteção por CRC). A camada
 * III no segundo byte deixa de fora a camada I/II, as versões reservadas e o `FF FE` (marca de
 * texto UTF-16), e não colide com o JPEG (`FF D8`, porque `D8` não começa com `111`).
 */
const ASSINATURAS: Readonly<Record<string, readonly Assinatura[]>> = {
  mp3: [
    [{ deslocamento: 0, bytes: [...texto('ID3'), 0x03] }],
    [{ deslocamento: 0, bytes: [...texto('ID3'), 0x04] }],
    [{ deslocamento: 0, bytes: [0xff, 0xfa], mascara: [0xff, 0xfe] }],
    [{ deslocamento: 0, bytes: [0xff, 0xf2], mascara: [0xff, 0xfe] }],
    [{ deslocamento: 0, bytes: [0xff, 0xe2], mascara: [0xff, 0xfe] }],
  ],
  wav: [[{ deslocamento: 0, bytes: texto('RIFF') }, { deslocamento: 8, bytes: texto('WAVE') }]],
  ogg: [[{ deslocamento: 0, bytes: texto('OggS') }]],
  m4a: [[{ deslocamento: 4, bytes: texto('ftypM4A ') }]],
  png: [[{ deslocamento: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }]],
  jpg: [[{ deslocamento: 0, bytes: [0xff, 0xd8, 0xff] }]],
  webp: [[{ deslocamento: 0, bytes: texto('RIFF') }, { deslocamento: 8, bytes: texto('WEBP') }]],
  gif: [[{ deslocamento: 0, bytes: texto('GIF87a') }], [{ deslocamento: 0, bytes: texto('GIF89a') }]],
}

function casaTrecho(inicio: Uint8Array, t: Trecho): boolean {
  if (inicio.length < t.deslocamento + t.bytes.length) return false
  return t.bytes.every((b, i) => {
    const m = t.mascara?.[i] ?? 0xff
    return (inicio[t.deslocamento + i] & m) === b
  })
}

/** Tipo pelos primeiros bytes do arquivo; o nome e o `File.type` do navegador nunca decidem. */
export function detectarTipo(inicio: Uint8Array): TipoAceito | null {
  for (const tipo of TIPOS_ACEITOS) {
    const assinaturas = ASSINATURAS[tipo.extensao] ?? []
    if (assinaturas.some((a) => a.every((t) => casaTrecho(inicio, t)))) return tipo
  }
  return null
}

export type RecusaDoArquivo = 'vazio' | 'grande_demais' | 'tipo_recusado' | 'sem_espaco'
export type ConferenciaDoArquivo = { ok: true; tipo: TipoAceito } | { ok: false; motivo: RecusaDoArquivo }

/**
 * Confere um arquivo antes do envio, nesta ordem: vazio, grande demais, tipo recusado, sem espaço.
 * Comparações escritas para falhar fechado com `NaN`.
 */
export function conferirArquivo(a: { tamanho: number; inicio: Uint8Array }, usoAtualBytes: number): ConferenciaDoArquivo {
  if (!(a.tamanho > 0)) return { ok: false, motivo: 'vazio' }
  if (a.tamanho > LIMITE_POR_ARQUIVO_BYTES) return { ok: false, motivo: 'grande_demais' }
  const tipo = detectarTipo(a.inicio)
  if (tipo === null) return { ok: false, motivo: 'tipo_recusado' }
  if (!(usoAtualBytes + a.tamanho <= LIMITE_TOTAL_BYTES)) return { ok: false, motivo: 'sem_espaco' }
  return { ok: true, tipo }
}

/** uuid em minúsculas, forma 8-4-4-4-12: a mesma da política de `insert` em `storage.objects` (D3). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Caminho no Storage: `som|imagem/<uuid>.<ext>`. O nome do arquivo do computador nunca entra aqui. */
export function caminhoDaMidia(tipo: TipoAceito, id: string): string {
  if (!UUID.test(id)) throw new Error('caminhoDaMidia: id fora do formato uuid')
  return `${tipo.tipo}/${id}.${tipo.extensao}`
}

/** Tamanho máximo do nome mostrado, em caracteres (pontos de código). */
const TAMANHO_DO_NOME = 120

/** Controles (C0, DEL, C1) e os controles de direção do texto (que trocariam a extensão de lugar na tela). */
const CONTROLES = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g

/** Nome mostrado na tela e guardado em `midias.nome`: só o último trecho, sem controles, aparado, até 120. */
export function nomeDeExibicao(nomeDoArquivo: string): string {
  const ultimo = nomeDoArquivo.split(/[/\\]/).pop() ?? ''
  const limpo = ultimo.replace(CONTROLES, '').trim()
  const cortado = Array.from(limpo).slice(0, TAMANHO_DO_NOME).join('').trim()
  return cortado === '' ? 'sem nome' : cortado
}

export interface Midia {
  id: string
  tipo: TipoDeMidia
  nome: string
  caminho: string
  mime: string
  tamanhoBytes: number
  enviadoPor: string | null
}

/** Uso da Biblioteca pela soma de `midias.tamanho_bytes` (D7); alerta a partir de 80 %. */
export function usoDaBiblioteca(midias: readonly Midia[]): { bytes: number; fracao: number; alerta: boolean } {
  const bytes = midias.reduce((soma, m) => soma + m.tamanhoBytes, 0)
  const fracao = bytes / LIMITE_TOTAL_BYTES
  return { bytes, fracao, alerta: fracao >= 0.8 }
}

/** Som da Biblioteca (tabela `sons`): uma mídia do tipo som com rótulo, emoji e volume. */
export interface Som {
  id: string
  midiaId: string
  rotulo: string
  emoji: string | null
  volume: number
  ordem: number
}

/** Rótulo não vazio; volume de 0 a 1 (CHECK `sons_volume_0_a_1`). */
export function conferirSom(s: { rotulo: string; volume: number }): 'rotulo_vazio' | 'volume_invalido' | null {
  if (s.rotulo.trim() === '') return 'rotulo_vazio'
  if (!(s.volume >= 0 && s.volume <= 1)) return 'volume_invalido'
  return null
}
