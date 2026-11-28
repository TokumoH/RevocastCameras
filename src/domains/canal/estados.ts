/*
 * Núcleo comum dos tipos de canal (PLA-006, D1): o que `aovivo` e `captura` usam igual e que não é de nenhum dos dois.
 * Antes da E5, `EstadoDoCanal` ficava em `aovivo/portas.ts` e `captura` o importava de lá, um ciclo só de tipo
 * (VER-049, Riscos; VER-056, N6). Este arquivo não importa nenhum domínio (`arquitetura.test.ts`,
 * `canal-nao-importa-dominio`); `aovivo/portas.ts` o reexporta, então nenhum importador fora de `domains` muda.
 */

/** Estados de um canal (D15 do PLA-004): `fechado` (pelo servidor) é tratado como `negado` pelas telas (N3). */
export type EstadoDoCanal = 'conectando' | 'conectado' | 'reconectando' | 'fechado' | 'negado'
