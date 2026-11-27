/*
 * Módulo neutro dos canais do app (VER-046, N7): o que as telas de membro (`useEstudio`, `useAoVivo`) e as rotas de
 * dispositivo (`useDispositivo`, `acompanharEstudio`) dividem. Antes a constante ficava em `useDispositivo.ts`, e as
 * telas de membro dependiam do arquivo do hook de dispositivo.
 */

/** Depois de um canal `fechado` ou `negado` com o acesso ainda válido, os canais reabrem em 5 s (D15, N3). */
export const REABRIR_CANAIS_MS = 5000
