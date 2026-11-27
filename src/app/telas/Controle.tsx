import { useMemo, useState } from 'react'
import type { Papel } from '../../domains/acesso/papeis'
import type { UsuarioDaSessao } from '../../domains/acesso/sessao'
import type { ServicosDePreparacao } from '../../domains/preparacao/portas'
import { Cartao } from '../../shared/ui/Cartao'
import { Logo } from '../../shared/ui/Logo'
import { Mensagem } from '../../shared/ui/Mensagem'
import { avisoDoCanal, PainelDeComandos, TEXTO_DO_CANAL, TEXTO_DOS_COMANDOS } from '../../shared/ui/PainelDeComandos'
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
  conectando: TEXTO_DO_CANAL.conectando,
  reconectando: TEXTO_DO_CANAL.reconectando,
  semAcesso: TEXTO_DO_CANAL.semAcesso,
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

  // O aviso do estado do canal vem de `avisoDoCanal` (`shared/ui/PainelDeComandos.tsx`), o mesmo da aba Ao vivo
  // do painel (Tarefa 9, rodada 1, N2): `fechado`/`negado` → "Sem acesso ao canal; conferindo o seu acesso."
  // (erro; o `useAoVivo` já chamou `reavaliar()`), `reconectando` → "Reconectando…" e `conectando` →
  // "Conectando…" (info), `conectado` → nenhum. Com aviso de canal na tela, o de palco ausente não aparece
  // (um de cada vez: o do canal explica o outro). As frases ficam também em `TEXTO_DO_CONTROLE` (testes).
  // Os botões seguem `av.podeComandar` (canal conectado e a última consulta do episódio sem falha): com a
  // frase de falha na tela, o episódio mostrado pode não ser o atual, e nenhum toque sai até a próxima consulta.
  const aviso = avisoDoCanal(av.canal)

  return (
    <main className="tela controle">
      <Cartao>
        <Logo />
        <h1>{titulo}</h1>
        {aviso !== null && <Mensagem tom={aviso.tom}>{aviso.texto}</Mensagem>}
        {aviso === null && av.carregado && av.episodio !== null && !av.palcoPresente && <Mensagem tom="erro">{TEXTO_DO_CONTROLE.palcoAusente}</Mensagem>}
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
            habilitado={av.podeComandar}
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
