/*
 * Módulo neutro dos canais do app (VER-046, N7): o que as telas de membro (`useEstudio`, `useAoVivo`) e as rotas de
 * dispositivo (`useDispositivo`, `acompanharEstudio`) dividem. Antes a constante ficava em `useDispositivo.ts`, e as
 * telas de membro dependiam do arquivo do hook de dispositivo.
 */

/** Depois de um canal `fechado` ou `negado` com o acesso ainda válido, os canais reabrem em 5 s (D15, N3). */
export const REABRIR_CANAIS_MS = 5000

/** Teto da espera crescente das novas tentativas (1 min): a consulta do `useAoVivo` e o vídeo negado do `/obs/camera`. */
export const ESPERA_MAXIMA_DA_REABERTURA_MS = 60_000

/** Espera da tentativa `n` (0, 1, 2…): 5 s, 10 s, 20 s, 40 s, até `ESPERA_MAXIMA_DA_REABERTURA_MS` (VER-041; VER-056, I1). */
export function esperaDaReabertura(n: number): number {
  return Math.min(REABRIR_CANAIS_MS * 2 ** n, ESPERA_MAXIMA_DA_REABERTURA_MS)
}
