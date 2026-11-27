import type { ReactNode } from 'react'

/**
 * Barra de progresso acessível: `<progress max={1}>` com nome dado por `aria-label` (o leitor de tela
 * anuncia "Envio de foto.png, 40 %"), mais a porcentagem visível ao lado, escondida do leitor (que já
 * lê o valor da barra). A fração é presa entre 0 e 1; `NaN` vira 0.
 */
export function BarraDeProgresso({ fracao, rotulo }: { fracao: number; rotulo: string }): ReactNode {
  const valor = Number.isFinite(fracao) ? Math.min(1, Math.max(0, fracao)) : 0
  return (
    <span className="barra-de-progresso">
      <progress max={1} value={valor} aria-label={rotulo} />
      <span aria-hidden="true">{Math.round(valor * 100)} %</span>
    </span>
  )
}
