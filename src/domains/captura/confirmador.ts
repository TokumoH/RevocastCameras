import type { Gesto } from '../preparacao/gestos'
import { CONFIANCA_MINIMA, INTERVALO_MS, SEGURAR_MS, SOLTAR_MS, TOLERANCIA_MS } from './gestos'

/**
 * Confirmador do gesto (PLA-006, D3): recebe uma leitura por quadro (o gesto, a confiança, o instante `em` e o período
 * atual do laço) e devolve o gesto confirmado ou `null`. Puro: o relógio vem nas leituras.
 *
 * - Leitura sem gesto: `gesto` nulo ou `confianca < CONFIANCA_MINIMA`.
 * - A contagem começa na primeira leitura com o gesto; um gesto diferente recomeça na leitura dele; se a distância entre
 *   duas leituras **com** o gesto passar da tolerância (`max(TOLERANCIA_MS, 2 × periodoMs)`), recomeça na leitura nova
 *   (revisão 1, N4 e N5).
 * - Confirma quando o mesmo gesto foi visto do começo da contagem até agora por pelo menos `SEGURAR_MS`, **e** já se
 *   passaram `INTERVALO_MS` da última confirmação (de qualquer gesto), **e** o gesto foi solto depois da última
 *   confirmação dele: uma leitura sem ele pelo menos `SOLTAR_MS` depois da última vez em que foi visto. Um gesto mantido
 *   confirma uma vez só.
 * - `zerar()` (o laço parou: página escondida, worker fechado, piscada do vídeo): a contagem recomeça do zero e o
 *   intervalo da última confirmação continua valendo. **Não conta como soltar** (VER-058, rodada 1, I1): sem leituras, o
 *   lado seguro é supor que a mão não desceu; a primeira leitura sem o gesto depois do reinício já solta, porque passaram
 *   mais de `SOLTAR_MS` desde a última vez em que ele foi visto.
 */
export function criarConfirmador(): {
  ler(l: { gesto: Gesto | null; confianca: number }, em: number, periodoMs: number): Gesto | null
  zerar(): void
} {
  /** O gesto em contagem, o começo da contagem e a última leitura com ele. */
  let atual: Gesto | null = null
  let inicio = 0
  let vistoEm = 0
  /** A última confirmação (de qualquer gesto), o gesto dela e se ele já foi solto. */
  let confirmadoEm: number | null = null
  let confirmado: Gesto | null = null
  let confirmadoVistoEm = 0
  let solto = true

  function ler(l: { gesto: Gesto | null; confianca: number }, em: number, periodoMs: number): Gesto | null {
    const gesto = l.gesto !== null && l.confianca >= CONFIANCA_MINIMA ? l.gesto : null
    const tolerancia = Math.max(TOLERANCIA_MS, 2 * periodoMs)

    if (confirmado !== null && !solto) {
      if (gesto === confirmado) confirmadoVistoEm = em
      else if (em - confirmadoVistoEm >= SOLTAR_MS) {
        solto = true
        // mostrado de novo, conta do zero; só faz diferença quando a tolerância passa de SOLTAR_MS (período de 250 ms
        // ou mais): com os períodos do laço (100 e 200 ms), o buraco de 500 ms já recomeça a contagem
        if (atual === confirmado) atual = null
      }
    }

    if (gesto === null) return null
    if (gesto !== atual || em - vistoEm > tolerancia) {
      atual = gesto
      inicio = em
    }
    vistoEm = em

    const segurou = em - inicio >= SEGURAR_MS
    const passouOIntervalo = confirmadoEm === null || em - confirmadoEm >= INTERVALO_MS
    const liberado = gesto !== confirmado || solto
    if (!segurou || !passouOIntervalo || !liberado) return null

    confirmadoEm = em
    confirmado = gesto
    confirmadoVistoEm = em
    solto = false
    return gesto
  }

  function zerar(): void {
    atual = null
  }

  return { ler, zerar }
}
