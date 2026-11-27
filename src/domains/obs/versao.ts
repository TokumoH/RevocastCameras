/**
 * Versão mínima do OBS (D13; DES-001 §3): o `CreateRecordChapter` do obs-websocket (marcador)
 * existe a partir do OBS 30.2.0 (obs-websocket 5.5.0).
 */
export const VERSAO_MINIMA_DO_OBS = '30.2.0'

/** `maior.menor[.correção]`, com sufixo de pré-lançamento opcional (`31.0.0-beta1`); até 40 caracteres, como no estado no ar. */
const VERSAO = /^(\d{1,6})\.(\d{1,6})(?:\.(\d{1,6}))?(?:-[0-9A-Za-z.]+)?$/
const TAMANHO_DA_VERSAO = 40

function partes(v: string): [number, number, number] | null {
  if (v.length > TAMANHO_DA_VERSAO) return null
  const m = VERSAO.exec(v)
  if (m === null) return null
  return [Number(m[1]), Number(m[2]), m[3] === undefined ? 0 : Number(m[3])]
}

const MINIMA = partes(VERSAO_MINIMA_DO_OBS) as [number, number, number]

/**
 * A versão do OBS atende a mínima? `null` ou fora da forma → `null` ("versão desconhecida", D13).
 * Um pré-lançamento conta como a própria versão (`30.2.0-rc1` atende), porque o recurso já está
 * no pré-lançamento da mesma versão.
 */
export function versaoAtende(v: string | null): boolean | null {
  if (v === null) return null
  const p = partes(v)
  if (p === null) return null
  for (let i = 0; i < 3; i++) {
    if (p[i] !== MINIMA[i]) return p[i] > MINIMA[i]
  }
  return true
}
