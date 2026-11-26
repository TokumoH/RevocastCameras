import { TelaProvisoria } from '../../shared/ui/TelaProvisoria'
import type { Dependencias } from '../dependencias'
import { GuardaDeMembro } from '../GuardaDeMembro'

/** `/controle` (os três papéis, D2): guardado desde a E1; o conteúdo chega na E3. */
export function Controle({ titulo, dependencias }: { titulo: string; dependencias: Dependencias }) {
  return (
    <GuardaDeMembro area="controle" titulo={titulo} dependencias={dependencias}>
      {() => <TelaProvisoria titulo={titulo} etapa="E3" />}
    </GuardaDeMembro>
  )
}
