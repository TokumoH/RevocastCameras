import { useState } from 'react'
import type { ObsNoNavegador } from '../../domains/obs/portas'
import { criarObsNoNavegador } from '../../shared/infra/obsNavegador'
import type { Dependencias } from '../dependencias'
import { ObsCameraNoAr } from './ObsCameraNoAr'
import { SoComSaidaParada, TelaDeDispositivo } from './TelaDeDispositivo'

/**
 * `/obs/camera` (Fonte de navegador do OBS com o vídeo da câmera): pareamento pelo link (E3) e, pareado, só o vídeo
 * (`ObsCameraNoAr`, E4). A porta do OBS vem do navegador; os testes passam um falso. O fundo transparente vem da classe
 * `obs-camera` que o `index.html` põe antes da primeira pintura (D8 do PLA-005). As telas de pareamento e de erro
 * (revogado, sem link...) só aparecem com nada no ar (`SoComSaidaParada`, a mesma guarda do palco; D8, D10).
 */
export function ObsCamera({ titulo, dependencias, obs }: { titulo: string; dependencias: Dependencias; obs?: ObsNoNavegador }) {
  const [portas] = useState(() => ({ obs: obs ?? criarObsNoNavegador() }))
  return (
    <TelaDeDispositivo
      tipo="obs_camera"
      titulo={titulo}
      dependencias={dependencias}
      cobrirTela={(tela) => <SoComSaidaParada obs={portas.obs}>{tela}</SoComSaidaParada>}
    >
      {(pareado) => <ObsCameraNoAr {...pareado} obs={portas.obs} />}
    </TelaDeDispositivo>
  )
}
