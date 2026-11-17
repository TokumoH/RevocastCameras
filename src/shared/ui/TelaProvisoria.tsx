import { Cartao } from './Cartao'
import { Logo } from './Logo'

/** Estrutura das telas provisórias: logo, título da rota e a etapa em que a tela fica pronta. */
export function TelaProvisoria({ titulo, etapa }: { titulo: string; etapa: string }) {
  return (
    <main className="tela">
      <Cartao>
        <Logo />
        <h1>{titulo}</h1>
        <p>Em construção — etapa {etapa}</p>
      </Cartao>
    </main>
  )
}
