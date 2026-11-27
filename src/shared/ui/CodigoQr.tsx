import { useMemo } from 'react'
import type { ReactNode } from 'react'

/** Zona quieta do QR (ISO/IEC 18004): 4 módulos claros em volta, sem os quais muitos leitores não acham o código. */
export const MARGEM_DO_QR = 4

/**
 * Caminho SVG dos módulos escuros: um retângulo de altura 1 por sequência escura de cada linha
 * (`M x y h n v 1 h -n z`), já deslocado pela margem. Só números e comandos de desenho.
 */
function caminhoDosModulos(matriz: readonly (readonly boolean[])[]): string {
  let d = ''
  matriz.forEach((linha, y) => {
    let x = 0
    while (x < linha.length) {
      if (!linha[x]) {
        x++
        continue
      }
      const inicio = x
      while (x < linha.length && linha[x]) x++
      const n = x - inicio
      d += `M${inicio + MARGEM_DO_QR} ${y + MARGEM_DO_QR}h${n}v1h-${n}z`
    }
  })
  return d
}

/**
 * QR desenhado pelo React (D11): um `<svg role="img">` com o `aria-label` dado e um `<path>` só,
 * montado a partir da matriz de módulos de `matrizDoQr` (`src/shared/infra/qr.ts`). Não aceita
 * texto nem SVG pronto: nada vira HTML (sem `innerHTML`). As cores são fixas nos dois modos
 * (`--qr-fundo`, `--qr-modulo`): escuro sobre claro, que é o que os leitores de QR esperam.
 */
export function CodigoQr({ matriz, rotulo }: { matriz: readonly (readonly boolean[])[]; rotulo: string }): ReactNode {
  const d = useMemo(() => caminhoDosModulos(matriz), [matriz])
  const lado = matriz.length + 2 * MARGEM_DO_QR
  return (
    <svg className="qr" role="img" aria-label={rotulo} viewBox={`0 0 ${lado} ${lado}`} shapeRendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
      <path className="qr__modulos" d={d} />
    </svg>
  )
}
