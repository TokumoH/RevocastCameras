import { TelaProvisoria } from '../../shared/ui/TelaProvisoria'

export function Entrar({ titulo }: { titulo: string }) {
  return <TelaProvisoria titulo={titulo} etapa="E1" />
}
