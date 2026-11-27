import { useMemo, useState } from 'react'
import type { Papel } from '../../domains/acesso/papeis'
import type { UsuarioDaSessao } from '../../domains/acesso/sessao'
import type { ServicosDePreparacao } from '../../domains/preparacao/portas'
import { Cartao } from '../../shared/ui/Cartao'
import { Logo } from '../../shared/ui/Logo'
import { Mensagem } from '../../shared/ui/Mensagem'
import { PainelDeComandos, TEXTO_DOS_COMANDOS } from '../../shared/ui/PainelDeComandos'
import type { Dependencias } from '../dependencias'
import { GuardaDeMembro } from '../GuardaDeMembro'
import type { ServicosDeAoVivo } from '../servicos'
import { useAoVivo } from '../useAoVivo'

/** Frases fixas do `/controle` (D15, N3); as do envio vêm de `TEXTO_DOS_COMANDOS`. */
export const TEXTO_DO_CONTROLE = Object.freeze({
  carregando: 'Carregando o episódio…',
  falhaAoCarregar: 'Não foi possível carregar o episódio; tentando de novo.',
  semEpisodio: 'Nenhum episódio no ar nem em teste.',
  palcoAusente: 'O palco não está conectado.',
  conectando: 'Conectando…',
  reconectando: 'Reconectando…',
  semAcesso: 'Sem acesso ao canal; conferindo o seu acesso.',
  semResposta: TEXTO_DOS_COMANDOS.semResposta,
  falhou: TEXTO_DOS_COMANDOS.falhou,
} as const)

/**
 * O conteúdo do `/controle` para um membro (os três papéis comandam, D5): `useAoVivo` e o
 * `PainelDeComandos`. Os botões só ficam habilitados com o canal `conectado`; `fechado`/`negado` dizem que
 * o acesso está sendo conferido (o `useAoVivo` já chamou `reavaliar()`); palco fora da presença só avisa
 * (o comando ainda pode chegar quando ele voltar). Interruptor de gestos fica para a E5 (D8).
 */
export function ConteudoDoControle({
  titulo,
  usuario,
  papel,
  reavaliar,
  aoVivo,
  preparacao,
  aoVoltarAVer,
}: {
  titulo: string
  usuario: UsuarioDaSessao
  papel: Papel
  reavaliar: () => void
  aoVivo: ServicosDeAoVivo
  preparacao: ServicosDePreparacao
  aoVoltarAVer: Dependencias['aoVoltarAVer']
}) {
  const canais = useMemo(() => aoVivo.canais(usuario.id), [aoVivo, usuario.id])
  const av = useAoVivo({ repo: aoVivo.repo, preparacao, canais, usuario, papel, reavaliar, aoVoltarAVer })

  const avisoDoCanal =
    av.canal === 'fechado' || av.canal === 'negado'
      ? TEXTO_DO_CONTROLE.semAcesso
      : av.canal === 'reconectando'
        ? TEXTO_DO_CONTROLE.reconectando
        : av.canal === 'conectando'
          ? TEXTO_DO_CONTROLE.conectando
          : null

  return (
    <main className="tela controle">
      <Cartao>
        <Logo />
        <h1>{titulo}</h1>
        {avisoDoCanal !== null && <Mensagem tom={avisoDoCanal === TEXTO_DO_CONTROLE.semAcesso ? 'erro' : 'info'}>{avisoDoCanal}</Mensagem>}
        {avisoDoCanal === null && av.carregado && av.episodio !== null && !av.palcoPresente && <Mensagem tom="erro">{TEXTO_DO_CONTROLE.palcoAusente}</Mensagem>}
        {av.falhaAoCarregar && <Mensagem tom="erro">{TEXTO_DO_CONTROLE.falhaAoCarregar}</Mensagem>}
        {!av.carregado ? (
          <p>{TEXTO_DO_CONTROLE.carregando}</p>
        ) : av.episodio === null ? (
          !av.falhaAoCarregar && <p>{TEXTO_DO_CONTROLE.semEpisodio}</p>
        ) : (
          <PainelDeComandos
            episodio={av.episodio}
            listas={av.listas}
            estadoNoAr={av.estadoNoAr}
            pedidoDoUltimo={av.pedidoDoUltimo}
            habilitado={av.canal === 'conectado'}
            enviar={av.enviar}
          />
        )}
      </Cartao>
    </main>
  )
}

/** Os serviços do ao vivo e da Preparação obtidos uma vez por montagem, já dentro da guarda (o mesmo cliente de membro). */
function ControleDoMembro(props: {
  titulo: string
  usuario: UsuarioDaSessao
  papel: Papel
  reavaliar: () => void
  dependencias: Dependencias
}) {
  const [aoVivo] = useState(props.dependencias.obterAoVivo)
  const [preparacao] = useState(props.dependencias.obterPreparacao)
  return (
    <ConteudoDoControle
      titulo={props.titulo}
      usuario={props.usuario}
      papel={props.papel}
      reavaliar={props.reavaliar}
      aoVivo={aoVivo}
      preparacao={preparacao}
      aoVoltarAVer={props.dependencias.aoVoltarAVer}
    />
  )
}

/** `/controle` (os três papéis, D2): guardado desde a E1; comandos por toque desde a Tarefa 7 da E3. */
export function Controle({ titulo, dependencias }: { titulo: string; dependencias: Dependencias }) {
  return (
    <GuardaDeMembro area="controle" titulo={titulo} dependencias={dependencias}>
      {(membro) => <ControleDoMembro titulo={titulo} usuario={membro.usuario} papel={membro.papel} reavaliar={membro.reavaliar} dependencias={dependencias} />}
    </GuardaDeMembro>
  )
}
