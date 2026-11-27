import type { Dependencias } from '../dependencias'
import { CameraPareada, TelaDeDispositivo } from './TelaDeDispositivo'

/** `/camera` (celular de gravação): pareamento pelo link ou QR (E3); o vídeo chega na E4. */
export function Camera({ titulo, dependencias }: { titulo: string; dependencias: Dependencias }) {
  return (
    <TelaDeDispositivo tipo="camera" titulo={titulo} dependencias={dependencias}>
      {(pareado) => <CameraPareada tipo="camera" titulo={titulo} pareado={pareado} />}
    </TelaDeDispositivo>
  )
}
