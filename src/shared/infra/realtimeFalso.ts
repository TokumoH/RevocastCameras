/**
 * Cliente Realtime falso (só para testes: não importa `vitest` nem o supabase-js em tempo de execução).
 * Imita o pedaço do `realtime-js` 2.119.0 (e do `@supabase/phoenix` 0.4.5) que muda o comportamento de
 * `canalSupabase.ts` (conferido no código instalado; citações no VER-038):
 *
 * - `channel(topico)` devolve o canal que já existe na lista para o mesmo tópico, inclusive um que
 *   está entrando, dentro ou com erro (`RealtimeClient.js:338-349`);
 * - `on('presence', ...)` depois de `subscribe()` (canal entrando ou dentro) lança
 *   (`RealtimeChannel.js:416-421`);
 * - `subscribe()` só faz algo com o canal fechado (`RealtimeChannel.js:140`); num canal fechado que já
 *   entrou uma vez lança "tried to join multiple times" (`phoenix.cjs.js:321-323`);
 * - o canal só sai da lista no `close` (`RealtimeChannel.js:106-108`), e a saída filtra **pelo
 *   tópico** (`RealtimeClient.js:446-447`); no `close` o callback do `subscribe` recebe `CLOSED`
 *   (`RealtimeChannel.js:154`);
 * - `send` de `broadcast` sem `ack` na configuração resolve `'ok'` na hora (`RealtimeChannel.js:620-622`);
 * - `state` e `joinedOnce` públicos (`RealtimeChannel.js:43-51`): `closed`, `joining`, `joined`, `errored`,
 *   `leaving`; um canal novo é `closed` e nunca entrou;
 * - `removeChannel` fecha o canal **na hora**: o `leave()` do phoenix põe o estado em `leaving` antes do
 *   `canPush()` (que exige `joined`), então dispara o `ok` localmente e o `close` roda dentro da própria
 *   chamada (`phoenix.cjs.js:461-470`, `RealtimeClient.js:257-262`); o canal sai da lista e o callback
 *   recebe `CLOSED` antes de a promessa resolver, e uma resposta do servidor ao `leave` que chegue
 *   depois é ignorada;
 * - a janela real de remoção pendente é o `untrack()` (um `send` de `presence` que espera a resposta do
 *   servidor, até 10 s, com o canal ainda na lista; `RealtimeChannel.js:235-252`); aqui, `segurarUntrack`
 *   faz os próximos `untrack` esperarem até `liberarUntracks()`.
 *
 * Os estados do `subscribe` (`SUBSCRIBED`, `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`) só chegam quando o
 * teste os emite, ou sozinhos com `conectarSozinho` (o `SUBSCRIBED` num microtask).
 */

type EstadoDoFalso = 'fechado' | 'entrando' | 'dentro' | 'erro' | 'saindo'
type RespostaDoSend = 'ok' | 'timed out' | 'error'

interface Ligacao {
  tipo: string
  filtro: { event: string }
  f: (carga: unknown) => void
}

const ESTADO_DO_REALTIME: Readonly<Record<EstadoDoFalso, 'closed' | 'joining' | 'joined' | 'errored' | 'leaving'>> = {
  fechado: 'closed',
  entrando: 'joining',
  dentro: 'joined',
  erro: 'errored',
  saindo: 'leaving',
}

export interface CanalRealtimeFalso {
  readonly topico: string
  /** Como o `state` do `RealtimeChannel`. */
  readonly state: 'closed' | 'joining' | 'joined' | 'errored' | 'leaving'
  /** Como o `joinedOnce` do `RealtimeChannel`. */
  readonly joinedOnce: boolean
  readonly config: unknown
  estado: EstadoDoFalso
  entrouUmaVez: boolean
  ligacoes: Ligacao[]
  aoStatus: ((status: string, erro?: Error) => void) | null
  enviados: { type: string; event: string; payload: unknown }[]
  presencas: unknown[]
  untracks: number
  estadoDePresenca: Record<string, unknown[]>
  on(tipo: string, filtro: { event: string }, f: (carga: unknown) => void): CanalRealtimeFalso
  subscribe(f?: (status: string, erro?: Error) => void): CanalRealtimeFalso
  send(args: { type: string; event: string; payload: unknown }): Promise<RespostaDoSend>
  track(payload: unknown): Promise<RespostaDoSend>
  untrack(): Promise<RespostaDoSend>
  presenceState(): Record<string, unknown[]>
}

export interface OpcoesDoRealtimeFalso {
  /** `SUBSCRIBED` sozinho, num microtask depois do `subscribe()` (falsos das telas). */
  conectarSozinho?: boolean
}

export function criarRealtimeFalso(opcoes: OpcoesDoRealtimeFalso = {}) {
  /** A lista de canais do cliente (`client.channels`). */
  let lista: CanalRealtimeFalso[] = []
  /** Todo canal já criado, na ordem. */
  const criados: CanalRealtimeFalso[] = []
  const registro: unknown[][] = []
  let respostaDoSend: RespostaDoSend = 'ok'
  let segurandoUntrack = false
  const untracksPendentes: (() => void)[] = []

  function fechar(canal: CanalRealtimeFalso): void {
    if (canal.estado === 'fechado' && !lista.includes(canal)) return
    canal.estado = 'fechado'
    // RealtimeClient._remove filtra pelo tópico, não pelo objeto
    lista = lista.filter((c) => c.topico !== canal.topico)
    canal.aoStatus?.('CLOSED')
  }

  function novoCanal(topico: string, config: unknown): CanalRealtimeFalso {
    const canal: CanalRealtimeFalso = {
      topico,
      config,
      estado: 'fechado',
      entrouUmaVez: false,
      ligacoes: [],
      aoStatus: null,
      enviados: [],
      presencas: [],
      untracks: 0,
      estadoDePresenca: {},
      get state() {
        return ESTADO_DO_REALTIME[canal.estado]
      },
      get joinedOnce() {
        return canal.entrouUmaVez
      },
      on(tipo, filtro, f) {
        registro.push(['on', topico, tipo, filtro.event])
        if ((canal.estado === 'entrando' || canal.estado === 'dentro') && tipo === 'presence') {
          throw new Error(`cannot add \`presence\` callbacks for realtime:${topico} after \`subscribe()\`.`)
        }
        canal.ligacoes.push({ tipo, filtro, f })
        return canal
      },
      subscribe(f) {
        registro.push(['subscribe', topico])
        if (canal.estado !== 'fechado') return canal
        if (canal.entrouUmaVez) throw new Error("tried to join multiple times. 'join' can only be called a single time per channel instance")
        canal.entrouUmaVez = true
        canal.estado = 'entrando'
        canal.aoStatus = f ?? null
        if (opcoes.conectarSozinho) queueMicrotask(() => falso.emitirStatus(canal, 'SUBSCRIBED'))
        return canal
      },
      async send(args) {
        registro.push(['send', topico, args.event])
        canal.enviados.push(args)
        // Sem `ack`, o realtime-js resolve 'ok' na hora, sem esperar o servidor (RealtimeChannel.js:620-622).
        const ack = (canal.config as { broadcast?: { ack?: boolean } } | undefined)?.broadcast?.ack === true
        if (args.type === 'broadcast' && !ack) return 'ok'
        return respostaDoSend
      },
      async track(payload) {
        registro.push(['track', topico])
        canal.presencas.push(payload)
        return 'ok'
      },
      untrack() {
        registro.push(['untrack', topico])
        canal.untracks++
        if (!segurandoUntrack) return Promise.resolve('ok')
        return new Promise<RespostaDoSend>((resolve) => untracksPendentes.push(() => resolve('ok')))
      },
      presenceState() {
        return canal.estadoDePresenca
      },
    }
    return canal
  }

  const cliente = {
    channel(topico: string, params: { config?: unknown } = {}) {
      registro.push(['channel', topico])
      const existe = lista.find((c) => c.topico === topico)
      if (existe) return existe
      const canal = novoCanal(topico, params.config)
      lista.push(canal)
      criados.push(canal)
      return canal
    },
    removeChannel(canal: CanalRealtimeFalso): Promise<'ok'> {
      registro.push(['removeChannel', canal.topico])
      // leave → estado leaving → canPush() falso → ok local → close, tudo dentro da chamada
      canal.estado = 'saindo'
      fechar(canal)
      return Promise.resolve('ok')
    },
  }

  const falso = {
    /** Passe como `SupabaseClient` (`as unknown as SupabaseClient`). */
    cliente,
    criados,
    registro,
    canais: () => [...lista],
    /** Último canal criado para o tópico. */
    canal(topico: string): CanalRealtimeFalso {
      const achado = [...criados].reverse().find((c) => c.topico === topico)
      if (!achado) throw new Error(`nenhum canal para ${topico}`)
      return achado
    },
    contar(tipo: string, topico?: string): number {
      return registro.filter((r) => r[0] === tipo && (topico === undefined || r[1] === topico)).length
    },
    emitirStatus(canal: CanalRealtimeFalso, status: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED', erro?: Error): void {
      if (status === 'CLOSED') {
        fechar(canal)
        return
      }
      canal.estado = status === 'SUBSCRIBED' ? 'dentro' : 'erro'
      canal.aoStatus?.(status, erro)
    },
    emitirBroadcast(canal: CanalRealtimeFalso, event: string, payload: unknown): void {
      for (const l of [...canal.ligacoes]) {
        if (l.tipo === 'broadcast' && (l.filtro.event === '*' || l.filtro.event === event)) l.f({ type: 'broadcast', event, payload })
      }
    },
    emitirPresenca(canal: CanalRealtimeFalso, event: 'sync' | 'join' | 'leave', estado?: Record<string, unknown[]>): void {
      if (estado) canal.estadoDePresenca = estado
      for (const l of [...canal.ligacoes]) {
        if (l.tipo === 'presence' && l.filtro.event === event) l.f({ event })
      }
    },
    responderSend(r: RespostaDoSend): void {
      respostaDoSend = r
    },
    /** A partir daqui, o `untrack` só resolve quando `liberarUntracks()` for chamado (o servidor demorando a responder). */
    segurarUntrack(): void {
      segurandoUntrack = true
    },
    liberarUntracks(): void {
      segurandoUntrack = false
      for (const f of untracksPendentes.splice(0)) f()
    },
  }
  return falso
}

export type RealtimeFalso = ReturnType<typeof criarRealtimeFalso>
