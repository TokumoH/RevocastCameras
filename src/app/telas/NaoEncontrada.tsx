import { Cartao } from '../../shared/ui/Cartao'
import { Logo } from '../../shared/ui/Logo'

export function NaoEncontrada({ titulo }: { titulo: string }) {
  return (
    <main className="tela">
      <Cartao tom="rosa">
        <Logo />
        <h1>{titulo}</h1>
        <p>Esse endereço não existe.</p>
        <a className="botao" href="/entrar">Ir para a entrada</a>
      </Cartao>
    </main>
  )
}
