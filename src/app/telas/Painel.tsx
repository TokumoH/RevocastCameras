import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { podeGerenciarMembros } from '../../domains/acesso/papeis'
import type { Papel } from '../../domains/acesso/papeis'
import type { ServicosDeMembro } from '../../domains/acesso/portas'
import type { UsuarioDaSessao } from '../../domains/acesso/sessao'
import type { RespostaDoEnvio } from '../../domains/aovivo/portas'
import type { ServicosDePreparacao } from '../../domains/preparacao/portas'
import { Abas } from '../../shared/ui/Abas'
import type { Aba } from '../../shared/ui/Abas'
import { Cartao } from '../../shared/ui/Cartao'
import { Logo } from '../../shared/ui/Logo'
import type { Dependencias } from '../dependencias'
import { GuardaDeMembro } from '../GuardaDeMembro'
import type { ServicosDeAoVivo } from '../servicos'
import { useEstudio } from '../useEstudio'
import { AbaAoVivo } from './AbaAoVivo'
import { AbaBiblioteca } from './AbaBiblioteca'
import { AbaCenas } from './AbaCenas'
import { AbaEpisodios } from './AbaEpisodios'
import { AbaGestos } from './AbaGestos'
import { AbaMembros } from './AbaMembros'

/** Abas do DES-001 §9, nesta ordem; todas reais desde a Tarefa 8 da E3 (a Ao vivo ganha o resto na Tarefa 9). */
const ABAS_DO_PAINEL: readonly Aba[] = [
  { id: 'episodios', rotulo: 'Episódios' },
  { id: 'biblioteca', rotulo: 'Biblioteca' },
  { id: 'cenas', rotulo: 'Cenas' },
  { id: 'gestos', rotulo: 'Gestos' },
  { id: 'membros', rotulo: 'Membros' },
  { id: 'ao_vivo', rotulo: 'Ao vivo' },
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
  obterAoVivo,
  origem,
}: {
  titulo: string
  usuario: UsuarioDaSessao
  papel: Papel
  servicos: ServicosDeMembro
  reavaliar: () => void
  obterPreparacao: () => ServicosDePreparacao
  obterAoVivo: () => ServicosDeAoVivo
  origem: string
}) {
  const [escolhida, setEscolhida] = useState(ABA_INICIAL)
  // Serviços da Preparação e do ao vivo obtidos uma vez, já dentro da guarda (o mesmo cliente de membro; E2, Tarefa 4; E3, D5).
  const [preparacao] = useState(obterPreparacao)
  const [aoVivo] = useState(obterAoVivo)
  // O `estudio` é aberto uma vez aqui, para todas as abas (presença de membro, avisos de revogação), e
  // reaberto 5 s depois de `fechado`/`negado`, com um `reavaliar()` (D15, N3, I-A). As abas não abrem outro.
  const canais = useMemo(() => aoVivo.canais(usuario.id), [aoVivo, usuario.id])
  const { estudio } = useEstudio({ canais, papel, reavaliar })
  // Lido na hora do envio: uma remoção que termina depois de uma reabertura usa a alça nova, não a fechada.
  const estudioAtual = useRef(estudio)
  useEffect(() => {
    estudioAtual.current = estudio
  })
  const avisarRevogacao = useCallback(async (usuarioRevogado: string): Promise<RespostaDoEnvio> => {
    const alca = estudioAtual.current
    return alca === null ? 'falhou' : alca.enviar({ evento: 'revogacao', usuario: usuarioRevogado })
  }, [])
  // A área de transferência, quando o navegador a oferece (contexto seguro); sem ela, o link fica selecionável.
  const copiar = useMemo(() => {
    const area = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    return area !== undefined && typeof area.writeText === 'function' ? (texto: string) => area.writeText(texto) : null
  }, [])
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
          {ativa.id === 'episodios' ? (
            <AbaEpisodios servicos={preparacao} usuario={usuario} reavaliar={reavaliar} />
          ) : ativa.id === 'membros' ? (
            <AbaMembros repo={servicos.repo} usuario={usuario} reavaliar={reavaliar} avisarRevogacao={avisarRevogacao} />
          ) : ativa.id === 'biblioteca' ? (
            <AbaBiblioteca servicos={preparacao} usuario={usuario} reavaliar={reavaliar} />
          ) : ativa.id === 'cenas' ? (
            <AbaCenas servicos={preparacao} reavaliar={reavaliar} />
          ) : ativa.id === 'gestos' ? (
            <AbaGestos servicos={preparacao} reavaliar={reavaliar} />
          ) : (
            <AbaAoVivo repo={aoVivo.repo} estudio={estudio} origem={origem} reavaliar={reavaliar} copiar={copiar} />
          )}
        </Abas>
      </Cartao>
    </main>
  )
}

/** `/painel` (equipe e admin): guardado desde a Tarefa 4 da E1; abas por estado desde a Tarefa 5 (D8); Biblioteca real desde a Tarefa 5 da E2; Cenas e Gestos desde a Tarefa 6; Episódios desde a Tarefa 7; Ao vivo (dispositivos) e o `estudio` do painel desde a Tarefa 8 da E3. */
export function Painel({ titulo, dependencias }: { titulo: string; dependencias: Dependencias }) {
  return (
    <GuardaDeMembro area="painel" titulo={titulo} dependencias={dependencias}>
      {(membro) => (
        <ConteudoDoPainel titulo={titulo} {...membro} obterPreparacao={dependencias.obterPreparacao} obterAoVivo={dependencias.obterAoVivo} origem={dependencias.origem} />
      )}
    </GuardaDeMembro>
  )
}
