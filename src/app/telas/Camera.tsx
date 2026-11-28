import type { Dependencias } from '../dependencias'
import { CameraNoAr } from './CameraNoAr'
import { TelaDeDispositivo } from './TelaDeDispositivo'

/** `/camera` (celular de gravação): pareamento pelo link ou QR (E3) e, pareado, a tela preta com o vídeo (E4, `CameraNoAr`). */
export function Camera({ titulo, dependencias }: { titulo: string; dependencias: Dependencias }) {
  return (
    <TelaDeDispositivo tipo="camera" titulo={titulo} dependencias={dependencias}>
      {(pareado) => <CameraNoAr {...pareado} aoVoltarAVer={dependencias.aoVoltarAVer} />}
    </TelaDeDispositivo>
  )
}
