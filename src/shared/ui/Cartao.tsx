import type { ReactNode } from 'react'

/** Cartão-adesivo do RevoCast: borda grossa, sombra dura e tom opcional. */
export function Cartao({ tom, children }: { tom?: 'rosa' | 'ciano' | 'areia'; children: ReactNode }) {
  const classe = tom ? `cartao cartao--${tom}` : 'cartao'
  return <section className={classe}>{children}</section>
}
