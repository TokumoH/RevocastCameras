import type { ReactNode } from 'react'

/** Aviso em destaque. `erro` é anunciado na hora pelo leitor de tela (`alert`); `info`, com educação (`status`). */
export function Mensagem({ tom, children }: { tom: 'info' | 'erro'; children: ReactNode }) {
  return tom === 'erro' ? (
    <p className="mensagem mensagem--erro" role="alert">{children}</p>
  ) : (
    <p className="mensagem" role="status">{children}</p>
  )
}
