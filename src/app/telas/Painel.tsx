import { useState } from 'react'
import { podeGerenciarMembros } from '../../domains/acesso/papeis'
import type { Papel } from '../../domains/acesso/papeis'
import type { ServicosDeMembro } from '../../domains/acesso/portas'
import type { UsuarioDaSessao } from '../../domains/acesso/sessao'
import type { ServicosDePreparacao } from '../../domains/preparacao/portas'
import { Abas } from '../../shared/ui/Abas'
import type { Aba } from '../../shared/ui/Abas'
import { Cartao } from '../../shared/ui/Cartao'
import { Logo } from '../../shared/ui/Logo'
import type { Dependencias } from '../dependencias'
import { GuardaDeMembro } from '../GuardaDeMembro'
import { AbaBiblioteca } from './AbaBiblioteca'
import { AbaMembros } from './AbaMembros'

/** Abas do DES-001 §9, nesta ordem; a etapa em que cada provisória fica pronta (DES-001 §14). */
const ABAS_DO_PAINEL: readonly (Aba & { etapa: string | null })[] = [
  { id: 'episodios', rotulo: 'Episódios', etapa: 'E2' },
  { id: 'biblioteca', rotulo: 'Biblioteca', etapa: 'E2' },
  { id: 'cenas', rotulo: 'Cenas', etapa: 'E2' },
  { id: 'gestos', rotulo: 'Gestos', etapa: 'E2' },
  { id: 'membros', rotulo: 'Membros', etapa: null },
  { id: 'ao_vivo', rotulo: 'Ao vivo', etapa: 'E3' },
]

const ABA_INICIAL = 'episodios'

/** Abas que o papel vê: Membros só para quem gerencia a lista (`admin`). Escolhe o que mostrar; a RLS nega. */
function abasDoPapel(papel: Papel) {
  return ABAS_DO_PAINEL.filter((aba) => aba.id !== 'membros' || podeGerenciarMembros(papel))
}

function ConteudoDoPainel({
  titulo,
  usuario,
  papel,
  servicos,
  reavaliar,
  obterPreparacao,
}: {
  titulo: string
  usuario: UsuarioDaSessao
  papel: Papel
  servicos: ServicosDeMembro
  reavaliar: () => void
  obterPreparacao: () => ServicosDePreparacao
}) {
  const [escolhida, setEscolhida] = useState(ABA_INICIAL)
  // Serviços da Preparação obtidos uma vez, já dentro da guarda (o mesmo cliente de membro; E2, Tarefa 4).
  const [preparacao] = useState(obterPreparacao)
  const abas = abasDoPapel(papel)
  // Se o papel mudar e a aba escolhida sumir (admin rebaixado em Membros), a escolha volta para a inicial
  // (ajuste de estado durante o render, padrão do React): se o papel voltar, Membros não reabre sozinha.
  if (!abas.some((aba) => aba.id === escolhida)) setEscolhida(ABA_INICIAL)
  const ativa = abas.find((aba) => aba.id === escolhida) ?? abas[0]

  return (
    <main className="tela tela--larga">
      <Cartao>
        <Logo />
        <h1>{titulo}</h1>
        <Abas abas={abas} ativa={ativa.id} aoEscolher={setEscolhida}>
          {ativa.id === 'membros' ? (
            <AbaMembros repo={servicos.repo} usuario={usuario} reavaliar={reavaliar} />
          ) : ativa.id === 'biblioteca' ? (
            <AbaBiblioteca servicos={preparacao} usuario={usuario} reavaliar={reavaliar} />
          ) : (
            <p>Em construção — etapa {ativa.etapa}</p>
          )}
        </Abas>
      </Cartao>
    </main>
  )
}

/** `/painel` (equipe e admin): guardado desde a Tarefa 4 da E1; abas por estado desde a Tarefa 5 (D8); Biblioteca real desde a Tarefa 5 da E2. */
export function Painel({ titulo, dependencias }: { titulo: string; dependencias: Dependencias }) {
  return (
    <GuardaDeMembro area="painel" titulo={titulo} dependencias={dependencias}>
      {(membro) => <ConteudoDoPainel titulo={titulo} {...membro} obterPreparacao={dependencias.obterPreparacao} />}
    </GuardaDeMembro>
  )
}
