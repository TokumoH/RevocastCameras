import type { ReactNode } from 'react'
import { podeAbrir } from '../domains/acesso/papeis'
import type { Area, Papel } from '../domains/acesso/papeis'
import type { ServicosDeMembro } from '../domains/acesso/portas'
import type { UsuarioDaSessao } from '../domains/acesso/sessao'
import type { Dependencias } from './dependencias'
import { CabecalhoDoMembro, TelaDeAcesso, TelaSemAcesso } from './telas/EstadosDeAcesso'
import { useAcesso } from './useAcesso'

/**
 * Guarda de uma área de membro (`/painel`, `/controle`): mostra a tela de cada estado de acesso e só
 * entrega o conteúdo a um membro cujo papel abre a área. Escolhe o que mostrar; quem nega o dado é a RLS.
 */
export function GuardaDeMembro({
  area,
  titulo,
  dependencias,
  children,
}: {
  area: Area
  titulo: string
  dependencias: Dependencias
  children: (membro: { usuario: UsuarioDaSessao; papel: Papel; servicos: ServicosDeMembro; reavaliar: () => void }) => ReactNode
}): ReactNode {
  const { estado, servicos, reavaliar, tentarDeNovo, entrar, sair } = useAcesso(dependencias)

  if (estado.tipo !== 'membro') {
    return <TelaDeAcesso estado={estado} titulo={titulo} aoEntrar={() => entrar(area)} aoTentarDeNovo={tentarDeNovo} />
  }
  if (!podeAbrir(area, estado.papel)) return <TelaSemAcesso papel={estado.papel} />
  if (servicos === null) return null // não acontece: o estado `membro` só nasce depois de obter os serviços
  return (
    <>
      <CabecalhoDoMembro usuario={estado.usuario} papel={estado.papel} aoSair={sair} />
      {children({ usuario: estado.usuario, papel: estado.papel, servicos, reavaliar })}
    </>
  )
}
