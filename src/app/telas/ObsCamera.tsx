import type { Dependencias } from '../dependencias'
import { CameraPareada, TelaDeDispositivo } from './TelaDeDispositivo'

/** `/obs/camera` (Fonte de navegador com o vídeo da câmera): pareamento pelo link (E3); o vídeo chega na E4. */
export function ObsCamera({ titulo, dependencias }: { titulo: string; dependencias: Dependencias }) {
  return (
    <TelaDeDispositivo tipo="obs_camera" titulo={titulo} dependencias={dependencias}>
      {(pareado) => <CameraPareada tipo="obs_camera" titulo={titulo} pareado={pareado} />}
    </TelaDeDispositivo>
  )
}
