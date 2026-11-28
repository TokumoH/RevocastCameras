import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ListasDoAoVivo } from '../../domains/aovivo/comandos'
import type { EstadoNoAr, MotivoDoResultado, PedidoDeComando } from '../../domains/aovivo/mensagens'
import type { EstadoDoCanal, RespostaDoEnvio } from '../../domains/aovivo/portas'
import { Mensagem } from './Mensagem'

/** Frases fixas dos comandos: a resposta do envio (D15, N3) e os motivos de recusa ou falha do palco (lista fechada, D9). */
export const TEXTO_DOS_COMANDOS = Object.freeze({
  aoVivo: 'AO VIVO',
  teste: 'TESTE',
  estado: 'Estado',
  cena: 'Cena',
  noAr: 'No ar',
  nenhumAviso: 'nenhum aviso',
  semCena: '—',
  ultimo: 'Último',
  avisos: 'Avisos',
  sons: 'Sons',
  cenas: 'Cenas',
  proximoAviso: 'Próximo aviso',
  ocultarAviso: 'Ocultar aviso',
  clipe: '✂️ CLIPE',
  marcar: '🔖 MARCAR',
  semAvisos: 'Nenhum aviso neste episódio.',
  semSons: 'Nenhum som na Biblioteca.',
  semCenas: 'Nenhuma cena cadastrada.',
  semResposta: 'O comando não chegou (rede ou acesso). Tente de novo.',
  falhou: 'O comando não foi enviado. Tente de novo.',
  recusado: 'O palco recusou o comando.',
  falhaNoPalco: 'O palco não conseguiu executar o comando.',
} as const)

/** Frases fixas do estado do canal (D15, N3), as mesmas no `/controle` e na aba Ao vivo do painel. */
export const TEXTO_DO_CANAL = Object.freeze({
  conectando: 'Conectando…',
  reconectando: 'Reconectando…',
  semAcesso: 'Sem acesso ao canal; conferindo o seu acesso.',
} as const)

/**
 * O aviso de uma tela de comandos para o estado do canal: `fechado`/`negado` → "Sem acesso…" (erro; quem usa
 * o `useAoVivo` já chamou `reavaliar()`), `reconectando` e `conectando` (info); `conectado` → nenhum.
 * Usado pelo `/controle` e pela aba Ao vivo (Tarefa 9, rodada 1, N2).
 */
export function avisoDoCanal(canal: EstadoDoCanal): { tom: 'info' | 'erro'; texto: string } | null {
  if (canal === 'fechado' || canal === 'negado') return { tom: 'erro', texto: TEXTO_DO_CANAL.semAcesso }
  if (canal === 'reconectando') return { tom: 'info', texto: TEXTO_DO_CANAL.reconectando }
  if (canal === 'conectando') return { tom: 'info', texto: TEXTO_DO_CANAL.conectando }
  return null
}

/** Um motivo da lista fechada → uma frase fixa; nunca texto do OBS nem do servidor. */
export const TEXTO_DO_MOTIVO: Readonly<Record<MotivoDoResultado, string>> = Object.freeze({
  cena_inexistente: 'Cena não está na lista do palco',
  som_inexistente: 'Som não está na lista do palco',
  aviso_inexistente: 'Aviso não está na lista do palco',
  sem_cenas: 'Nenhuma cena cadastrada',
  fim_dos_avisos: 'Não há próximo aviso',
  sem_aviso_no_ar: 'Nenhum aviso no ar',
  cena_inexistente_no_obs: 'Cena não existe no OBS',
  sem_permissao: 'O OBS não deu acesso Avançado à Fonte do palco',
  replay_desligado: 'Replay Buffer desligado no OBS',
  sem_websocket: 'obs-websocket não conectado no palco',
  sem_gravacao: 'Gravação parada no OBS',
  obs_ausente: 'OBS não detectado no palco',
  gesto_sem_acao: 'Gesto sem ação no mapa',
})

/** Ícone e nome de cada ação no "Último" (o alvo, quando a tela sabe qual foi, vem das listas). */
const NOME_DA_ACAO: Readonly<Record<PedidoDeComando['acao'], string>> = Object.freeze({
  cena: '🎬 Cena',
  proxima_cena: '🎬 Próxima cena',
  som: '🎵 Som',
  aviso: '📢 Aviso',
  proximo_aviso: '📢 Próximo aviso',
  ocultar_aviso: '📢 Aviso oculto',
  clipe: '✂️ Clipe',
  marcador: '🔖 Marcador',
})

/** "🎵 aplauso", "🎬 Close", "📢 Inscrições JIF"; sem o pedido (comando de outra pessoa) ou alvo fora da lista, só a ação. */
function descreverAcao(acao: PedidoDeComando['acao'], pedido: PedidoDeComando | null, listas: ListasDoAoVivo): string {
  if (pedido !== null && pedido.acao === acao) {
    if (pedido.acao === 'som') {
      const som = listas.sons.find((s) => s.id === pedido.somId)
      if (som) return `🎵 ${som.rotulo}`
    } else if (pedido.acao === 'cena') {
      const cena = listas.cenas.find((c) => c.id === pedido.cenaId)
      if (cena) return `🎬 ${cena.nomeExibicao}`
    } else if (pedido.acao === 'aviso') {
      const aviso = listas.avisos.find((a) => a.id === pedido.avisoId)
      if (aviso) return `📢 ${aviso.titulo}`
    }
  }
  return NOME_DA_ACAO[acao]
}

/** O último resultado do palco: `ok` → "… ✓"; `pendente` → "… …"; recusa ou falha → a frase do motivo. */
function descreverUltimo(ultimo: NonNullable<EstadoNoAr['ultimo']>, pedido: PedidoDeComando | null, listas: ListasDoAoVivo): string {
  if (ultimo.motivo !== null) return TEXTO_DO_MOTIVO[ultimo.motivo]
  if (ultimo.resultado === 'recusado') return TEXTO_DOS_COMANDOS.recusado
  if (ultimo.resultado === 'falhou') return TEXTO_DOS_COMANDOS.falhaNoPalco
  // `nenhuma` só vem com `gesto_sem_acao` (o leitor confere), já tratado acima; a frase da confirmação é da Tarefa 7
  if (ultimo.acao === 'nenhuma') return TEXTO_DO_MOTIVO.gesto_sem_acao
  const descricao = descreverAcao(ultimo.acao, pedido, listas)
  return ultimo.resultado === 'ok' ? `${descricao} ✓` : `${descricao} …`
}

/**
 * Os comandos por toque do `/controle` (e, na Tarefa 9, da aba Ao vivo), no esboço do DES-001 §9:
 * estado (selo "AO VIVO" ou "TESTE", título, cena no OBS pelo nome de exibição da lista, aviso no ar pelo
 * título da lista, último resultado), avisos (▶ por aviso, "Próximo aviso", "Ocultar aviso"), sons (emoji
 * e rótulo), cenas (nome de exibição) e os botões CLIPE e MARCAR. Escolhe o que mostrar; quem decide se o
 * comando chega é a RLS do canal. Todo texto de fora (títulos, rótulos, nome de cena do OBS) é texto React,
 * nunca HTML. Botões de pelo menos 44 px, sem depender de `hover` (`botao-grande`).
 */
export function PainelDeComandos({
  episodio,
  listas,
  estadoNoAr,
  pedidoDoUltimo = null,
  habilitado,
  enviar,
  nivelDoTitulo = 2,
}: {
  episodio: { modo: 'ao_vivo' | 'teste'; titulo: string }
  listas: ListasDoAoVivo
  estadoNoAr: EstadoNoAr | null
  /** O pedido que gerou o `ultimo` do estado, quando foi desta tela (para dizer o alvo: "🎵 aplauso ✓"). */
  pedidoDoUltimo?: PedidoDeComando | null
  habilitado: boolean
  enviar: (c: PedidoDeComando) => Promise<RespostaDoEnvio>
  /** Nível dos títulos dos grupos: `h2` no `/controle` (abaixo do `h1`), `h3` dentro de uma seção com `h2` (aba Ao vivo; rodada 1, N1). */
  nivelDoTitulo?: 2 | 3
}): ReactNode {
  const Titulo = nivelDoTitulo === 3 ? 'h3' : 'h2'
  const [aviso, setAviso] = useState<string | null>(null)
  const montado = useRef(true)
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  function tocar(pedido: PedidoDeComando): void {
    void enviar(pedido).then(
      (r) => {
        if (montado.current) setAviso(r === 'ok' ? null : r === 'sem_resposta' ? TEXTO_DOS_COMANDOS.semResposta : TEXTO_DOS_COMANDOS.falhou)
      },
      () => {
        if (montado.current) setAviso(TEXTO_DOS_COMANDOS.falhou)
      },
    )
  }

  const cenaObs = estadoNoAr?.cenaObs ?? null
  const cena = cenaObs === null ? TEXTO_DOS_COMANDOS.semCena : (listas.cenas.find((c) => c.nomeObs === cenaObs)?.nomeExibicao ?? cenaObs)
  const avisoNoAr = estadoNoAr?.avisoId == null ? null : (listas.avisos.find((a) => a.id === estadoNoAr.avisoId) ?? null)
  const ultimo = estadoNoAr?.ultimo ?? null

  const botao = (chave: string, rotulo: ReactNode, pedido: PedidoDeComando, extra = '') => (
    <button key={chave} type="button" className={`botao botao-grande ${extra}`.trim()} disabled={!habilitado} onClick={() => tocar(pedido)}>
      {rotulo}
    </button>
  )

  return (
    <div className="comandos">
      <section className="comandos__estado" aria-label={TEXTO_DOS_COMANDOS.estado}>
        <p className="comandos__cabeca">
          <span className={episodio.modo === 'ao_vivo' ? 'selo-no-ar selo-no-ar--ao-vivo' : 'selo-no-ar'}>{episodio.modo === 'ao_vivo' ? TEXTO_DOS_COMANDOS.aoVivo : TEXTO_DOS_COMANDOS.teste}</span>{' '}
          <span className="comandos__titulo">{episodio.titulo}</span>
        </p>
        <p>
          {TEXTO_DOS_COMANDOS.cena}: <strong>{cena}</strong> · {TEXTO_DOS_COMANDOS.noAr}: <strong>{avisoNoAr === null ? TEXTO_DOS_COMANDOS.nenhumAviso : avisoNoAr.titulo}</strong>
        </p>
        {ultimo !== null && (
          <p>
            {TEXTO_DOS_COMANDOS.ultimo}: <strong>{descreverUltimo(ultimo, pedidoDoUltimo, listas)}</strong>
          </p>
        )}
      </section>
      {aviso !== null && <Mensagem tom="erro">{aviso}</Mensagem>}
      <section className="comandos__grupo" aria-label={TEXTO_DOS_COMANDOS.avisos}>
        <Titulo>{TEXTO_DOS_COMANDOS.avisos}</Titulo>
        {listas.avisos.length === 0 ? (
          <p>{TEXTO_DOS_COMANDOS.semAvisos}</p>
        ) : (
          <div className="comandos__lista comandos__lista--coluna">{listas.avisos.map((a) => botao(a.id, <>{a.titulo} ▶</>, { acao: 'aviso', avisoId: a.id }))}</div>
        )}
        <div className="comandos__lista">
          {botao('proximo', TEXTO_DOS_COMANDOS.proximoAviso, { acao: 'proximo_aviso' }, 'botao--contorno')}
          {botao('ocultar', TEXTO_DOS_COMANDOS.ocultarAviso, { acao: 'ocultar_aviso' }, 'botao--contorno')}
        </div>
      </section>
      <section className="comandos__grupo" aria-label={TEXTO_DOS_COMANDOS.sons}>
        <Titulo>{TEXTO_DOS_COMANDOS.sons}</Titulo>
        {listas.sons.length === 0 ? (
          <p>{TEXTO_DOS_COMANDOS.semSons}</p>
        ) : (
          <div className="comandos__lista">{listas.sons.map((s) => botao(s.id, `${s.emoji ?? '🎵'} ${s.rotulo}`, { acao: 'som', somId: s.id }, 'botao--ciano'))}</div>
        )}
      </section>
      <section className="comandos__grupo" aria-label={TEXTO_DOS_COMANDOS.cenas}>
        <Titulo>{TEXTO_DOS_COMANDOS.cenas}</Titulo>
        {listas.cenas.length === 0 ? (
          <p>{TEXTO_DOS_COMANDOS.semCenas}</p>
        ) : (
          <div className="comandos__lista">{listas.cenas.map((c) => botao(c.id, c.nomeExibicao, { acao: 'cena', cenaId: c.id }, 'botao--contorno'))}</div>
        )}
      </section>
      <div className="comandos__lista comandos__lista--coluna">
        {botao('clipe', TEXTO_DOS_COMANDOS.clipe, { acao: 'clipe' })}
        {botao('marcar', TEXTO_DOS_COMANDOS.marcar, { acao: 'marcador' })}
      </div>
    </div>
  )
}
