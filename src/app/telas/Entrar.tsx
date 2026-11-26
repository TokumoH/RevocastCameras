import { useEffect } from 'react'
import { areaInicial } from '../../domains/acesso/papeis'
import { Cartao } from '../../shared/ui/Cartao'
import { Logo } from '../../shared/ui/Logo'
import { caminhoDaArea } from '../dependencias'
import type { Dependencias } from '../dependencias'
import { useAcesso } from '../useAcesso'
import { TelaDeAcesso } from './EstadosDeAcesso'

/** `/entrar`: quem já é membro vai para a área do seu papel (D2); os demais veem a tela do seu estado. */
export function Entrar({ titulo, dependencias }: { titulo: string; dependencias: Dependencias }) {
  const { estado, tentarDeNovo, entrar } = useAcesso(dependencias)
  const destino = estado.tipo === 'membro' ? caminhoDaArea(areaInicial(estado.papel)) : null

  useEffect(() => {
    if (destino !== null) dependencias.navegar(destino)
  }, [dependencias, destino])

  if (estado.tipo !== 'membro') {
    return <TelaDeAcesso estado={estado} titulo={titulo} aoEntrar={() => entrar(null)} aoTentarDeNovo={tentarDeNovo} />
  }
  return (
    <main className="tela">
      <Cartao>
        <Logo />
        <h1>{titulo}</h1>
        <p role="status">Abrindo a sua área…</p>
      </Cartao>
    </main>
  )
}
