import { TelaProvisoria } from '../../shared/ui/TelaProvisoria'
import type { Dependencias } from '../dependencias'
import { GuardaDeMembro } from '../GuardaDeMembro'

/** `/painel` (equipe e admin): guardado desde a Tarefa 4 da E1; as abas chegam na Tarefa 5. */
export function Painel({ titulo, dependencias }: { titulo: string; dependencias: Dependencias }) {
  return (
    <GuardaDeMembro area="painel" titulo={titulo} dependencias={dependencias}>
      {() => <TelaProvisoria titulo={titulo} etapa="E1" />}
    </GuardaDeMembro>
  )
}
