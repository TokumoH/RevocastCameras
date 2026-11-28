import { useCallback, useEffect, useRef, useState } from 'react'
import { codigoDoFragmento, resolverDispositivo } from '../domains/acesso/dispositivos'
import type { EstadoDoDispositivo, TipoDeDispositivo } from '../domains/acesso/dispositivos'
import type { PresencaNoEstudio } from '../domains/aovivo/mensagens'
import type { CanalDoEstudio, EstadoDoCanal } from '../domains/aovivo/portas'
import { PRESENCA_MINIMA_MS } from '../domains/captura/sinais'
import { ErroDeConfiguracao } from '../shared/infra/configuracao'
import { REABRIR_CANAIS_MS } from './canais'
import type { Dependencias } from './dependencias'
import type { ServicosDoDispositivo } from './servicos'

/** Estado da rota de dispositivo na tela: o do domínio, mais a avaliação em curso e a configuração ausente. */
export type EstadoDaRotaDeDispositivo = EstadoDoDispositivo | { tipo: 'carregando' } | { tipo: 'configuracao'; variavel: string }

/** O dispositivo pareado, como `resolverDispositivo` o devolve. */
export type DispositivoPareado = Extract<EstadoDoDispositivo, { tipo: 'pareado' }>['dispositivo']

// `REABRIR_CANAIS_MS` (5 s) mora em `canais.ts`, módulo neutro que as telas de membro também importam (VER-046, N7);
// `acompanharEstudio`, abaixo, é do dispositivo e só as rotas de dispositivo o usam.

/** Nome da variável na mensagem do `ErroDeConfiguracao` (as mensagens de `lerConfiguracao` sempre a citam). */
function variavelDoErro(erro: ErroDeConfiguracao): string {
  return /VITE_[A-Z_]+/.exec(erro.message)?.[0] ?? 'VITE_SUPABASE_URL'
}

/**
 * Pareamento e estado de uma rota de dispositivo (D3, D4, N1). Na primeira avaliação lê o fragmento
 * **uma vez** (`codigoDoFragmento`) e chama `limparFragmento()` **antes** de `obterDispositivo(tipo)` e de
 * qualquer rede; depois chama `resolverDispositivo`. O código vive só numa referência em memória: é
 * esquecido quando a avaliação termina com qualquer resposta que não seja `falha` (consumido ou inútil) e
 * guardado só para o "Tentar de novo" de uma `falha` (a URL já não o tem). Nunca vai para estado do
 * React, armazenamento, `console` ou URL.
 *
 * A avaliação em curso é reaproveitada pelo segundo efeito do `StrictMode` (sem um segundo pareamento,
 * que consumiria o código à toa e terminaria com `sair()`). `revogado` só chega por `marcarRevogado`
 * (o aviso do canal), nunca pela avaliação (N1).
 */
export function useDispositivo(
  tipo: TipoDeDispositivo,
  dependencias: Dependencias,
): {
  estado: EstadoDaRotaDeDispositivo
  /** Os serviços do tipo, depois de obtidos (nulos antes e com a configuração ausente). */
  servicos: ServicosDoDispositivo | null
  tentarDeNovo(): void
  marcarRevogado(): void
} {
  const [estado, setEstado] = useState<EstadoDaRotaDeDispositivo>({ tipo: 'carregando' })
  const [servicos, setServicos] = useState<ServicosDoDispositivo | null>(null)
  const [geracao, setGeracao] = useState(0)
  // `undefined` = fragmento ainda não lido; `null` = sem código (ou já esquecido).
  const codigo = useRef<ReturnType<typeof codigoDoFragmento> | undefined>(undefined)
  const avaliacao = useRef<Promise<{ estado: EstadoDaRotaDeDispositivo; servicos: ServicosDoDispositivo | null }> | null>(null)
  const revogado = useRef(false)

  useEffect(() => {
    let vivo = true
    avaliacao.current ??= (async () => {
      if (codigo.current === undefined) {
        codigo.current = codigoDoFragmento(dependencias.fragmento)
        dependencias.limparFragmento()
      }
      let s: ServicosDoDispositivo
      try {
        s = dependencias.obterDispositivo(tipo)
      } catch (erro) {
        return {
          estado: erro instanceof ErroDeConfiguracao ? { tipo: 'configuracao', variavel: variavelDoErro(erro) } : { tipo: 'falha' },
          servicos: null,
        }
      }
      const resultado = await resolverDispositivo(s.servico, tipo, codigo.current)
      if (resultado.tipo !== 'falha') codigo.current = null
      return { estado: resultado, servicos: s }
    })()
    void avaliacao.current.then((r) => {
      if (!vivo || revogado.current) return
      setServicos(r.servicos)
      setEstado(r.estado)
    })
    return () => {
      vivo = false
    }
  }, [geracao, tipo, dependencias])

  const tentarDeNovo = useCallback(() => {
    if (revogado.current) return
    avaliacao.current = null
    setEstado({ tipo: 'carregando' })
    setGeracao((g) => g + 1)
  }, [])

  const marcarRevogado = useCallback(() => {
    revogado.current = true
    codigo.current = null
    setEstado({ tipo: 'revogado' })
  }, [])

  return { estado, servicos, tentarDeNovo, marcarRevogado }
}

/** Opções de `acompanharEstudio`. */
export interface OpcoesDoEstudio {
  tipo: TipoDeDispositivo
  dispositivo: DispositivoPareado
  servicos: ServicosDoDispositivo
  /** Corpo da presença em `estudio` (D14), lido a cada marcação. */
  presenca(): PresencaNoEstudio
  /**
   * Janela mínima entre duas marcações pedidas por `atualizarPresenca` (D13 do PLA-005; F1: 5 chamadas de presença por
   * cliente a cada 30 s). Padrão `PRESENCA_MINIMA_MS` (10 s); `0` marca na hora, sem janela.
   */
  presencaMinimaMs?: number
  marcarRevogado(): void
  /** `setTimeout` que devolve o cancelamento. */
  agendar(f: () => void, ms: number): () => void
  /** O canal `estudio` chegou a `conectado` (a primeira vez e a cada volta). */
  aoConectar?(): void
  aoEpisodioMudar?(): void
  /** `revogacao` de outro usuário (o palco descarta o remetente por 15 min, D5). */
  aoRevogarOutro?(usuario: string): void
  /** Os canais caíram, o dispositivo foi revogado ou a rota saiu: o palco fecha o `:controle` e o `:estado` e para. */
  aoFecharCanais?(): void
}

/**
 * O canal `estudio` de um dispositivo pareado (D5, D14, D15, N3), igual para as três rotas:
 * - marca a presença ao abrir (o adaptador a remarca a cada volta a `conectado`);
 * - `atualizarPresenca()` (desde a E4, D13 do PLA-005) coalesce: depois de cada marcação abre uma janela de
 *   `presencaMinimaMs`; o que mudar dentro dela sai **uma vez**, no fim, com o corpo lido na hora; um corpo igual ao último
 *   marcado nunca é remarcado (fora da janela, a mudança sai na hora e abre outra janela);
 * - `revogacao` do próprio `usuarioId` → fecha os canais, `sair()` e `marcarRevogado()`; de outro
 *   usuário → `aoRevogarOutro`;
 * - canal `fechado` ou `negado` (o mesmo vale para o `:controle` e o `:estado` do palco, por `canalPerdido`) → fecha
 *   os canais e refaz `resolverDispositivo` sem código: sem dispositivo → tela de revogado (o `sair()`
 *   já foi feito pela avaliação, se havia sessão); com dispositivo → reabre em 5 s; `falha` (rede) →
 *   tenta de novo em 5 s, sem dizer "revogado".
 * Os ouvintes do adaptador já chegam fora do callback do `realtime-js`.
 */
export function acompanharEstudio(o: OpcoesDoEstudio): { atualizarPresenca(): void; canalPerdido(): void; parar(): void } {
  let parado = false
  let reavaliando = false
  let canal: CanalDoEstudio | null = null
  let soltar: (() => void)[] = []
  let cancelarEspera: (() => void) | null = null
  const janelaMs = o.presencaMinimaMs ?? PRESENCA_MINIMA_MS
  /** O último corpo marcado (JSON), para nunca remarcar o mesmo. */
  let marcada: string | null = null
  let cancelarJanela: (() => void) | null = null
  let presencaPendente = false

  function fecharJanela(): void {
    cancelarJanela?.()
    cancelarJanela = null
    presencaPendente = false
  }

  /** Marca a presença (`sempre`: canal novo, mesmo com o corpo igual) e abre a janela da D13. */
  function marcar(c: CanalDoEstudio, sempre: boolean): void {
    const p = o.presenca()
    const texto = JSON.stringify(p)
    if (!sempre && texto === marcada) return
    marcada = texto
    void c.marcarPresenca(p).catch(() => {})
    fecharJanela()
    if (janelaMs <= 0) return
    cancelarJanela = o.agendar(() => {
      cancelarJanela = null
      if (!presencaPendente || parado || canal === null) return
      presencaPendente = false
      marcar(canal, false)
    }, janelaMs)
  }

  function fecharCanais(): void {
    fecharJanela()
    for (const s of soltar) s()
    soltar = []
    const c = canal
    canal = null
    void c?.fechar().catch(() => {})
    o.aoFecharCanais?.()
  }

  function esperar(f: () => void): void {
    cancelarEspera?.()
    cancelarEspera = o.agendar(() => {
      cancelarEspera = null
      f()
    }, REABRIR_CANAIS_MS)
  }

  function abrir(): void {
    if (parado || canal !== null) return
    const c = o.servicos.canais(o.dispositivo.usuarioId).estudio()
    canal = c
    soltar = [
      c.aoReceber((m) => {
        if (parado || canal !== c) return
        if (m.evento === 'revogacao') {
          if (m.usuario === o.dispositivo.usuarioId) revogar()
          else o.aoRevogarOutro?.(m.usuario)
        } else if (m.evento === 'episodio_ativo_mudou') o.aoEpisodioMudar?.()
      }),
      c.aoMudarEstado((e: EstadoDoCanal) => {
        if (parado || canal !== c) return
        if (e === 'conectado') o.aoConectar?.()
        else if (e === 'fechado' || e === 'negado') canalPerdido()
      }),
    ]
    marcar(c, true)
  }

  function revogar(): void {
    parado = true
    cancelarEspera?.()
    fecharCanais()
    void o.servicos.servico.sair().catch(() => {})
    o.marcarRevogado()
  }

  function reavaliar(): void {
    reavaliando = true
    void resolverDispositivo(o.servicos.servico, o.tipo, null).then((r) => {
      reavaliando = false
      if (parado) return
      if (r.tipo === 'pareado') esperar(abrir)
      else if (r.tipo === 'falha') esperar(reavaliar)
      else {
        parado = true
        o.marcarRevogado()
      }
    })
  }

  function canalPerdido(): void {
    if (parado || reavaliando) return
    fecharCanais()
    reavaliar()
  }

  abrir()

  return {
    atualizarPresenca() {
      if (parado || canal === null) return
      if (cancelarJanela !== null) presencaPendente = true
      else marcar(canal, false)
    },
    canalPerdido,
    parar() {
      if (parado) return
      parado = true
      cancelarEspera?.()
      fecharCanais()
    },
  }
}
