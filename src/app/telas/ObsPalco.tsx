import { useState } from 'react'
import type { ObsNoNavegador, ObsWebsocket } from '../../domains/obs/portas'
import { criarObsNoNavegador } from '../../shared/infra/obsNavegador'
import { criarObsWebsocket } from '../../shared/infra/obsWebsocket'
import type { Dependencias } from '../dependencias'
import { PalcoNoAr } from './PalcoNoAr'
import { SoComSaidaParada, TelaDeDispositivo, useGuardaDaRota } from './TelaDeDispositivo'

type Armazenamento = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * `localStorage` da Fonte de navegador, sem lançar: com o armazenamento bloqueado, ler devolve `null`
 * e gravar lança só para quem chamou (o palco mostra a mensagem fixa).
 */
function armazenamentoDoNavegador(): Armazenamento {
  return {
    getItem: (chave) => {
      try {
        return window.localStorage.getItem(chave)
      } catch {
        return null
      }
    },
    setItem: (chave, valor) => window.localStorage.setItem(chave, valor),
    removeItem: (chave) => {
      try {
        window.localStorage.removeItem(chave)
      } catch {
        /* nada guardado */
      }
    },
  }
}

/**
 * `/obs/palco` (Fonte de navegador do OBS, em todas as cenas): pareamento pelo link (D3, D4) e o palco no
 * ar (`PalcoNoAr`). As portas do OBS e o armazenamento local vêm do navegador; os testes passam falsos.
 * O fundo transparente vem da classe `palco` que o `index.html` põe antes da primeira pintura (N2). As telas
 * de pareamento e de erro (revogado, sem link...) só aparecem com nada no ar (`SoComSaidaParada`; D16, VER-046 I1), pela
 * guarda da rota, a mesma do palco pareado (`useGuardaDaRota`, VER-056, N2).
 */
export function ObsPalco({
  titulo,
  dependencias,
  obs,
  criarWs,
  armazenamentoLocal,
}: {
  titulo: string
  dependencias: Dependencias
  obs?: ObsNoNavegador
  criarWs?: () => ObsWebsocket
  armazenamentoLocal?: Armazenamento
}) {
  const [portas] = useState(() => ({
    obs: obs ?? criarObsNoNavegador(),
    criarWs: criarWs ?? (() => criarObsWebsocket()),
    armazenamentoLocal: armazenamentoLocal ?? armazenamentoDoNavegador(),
  }))
  const guarda = useGuardaDaRota(portas.obs) // uma guarda por rota, a mesma da casca e do palco (VER-056, N2)
  return (
    <TelaDeDispositivo
      tipo="obs_palco"
      titulo={titulo}
      dependencias={dependencias}
      cobrirTela={(tela) => <SoComSaidaParada obs={portas.obs} guarda={guarda}>{tela}</SoComSaidaParada>}
    >
      {(pareado) => <PalcoNoAr {...pareado} {...portas} guarda={guarda} />}
    </TelaDeDispositivo>
  )
}
