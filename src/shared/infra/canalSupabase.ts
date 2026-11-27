import type { SupabaseClient } from '@supabase/supabase-js'
import { EVENTOS_DO_CONTROLE, EVENTOS_DO_ESTADO, UUID, lerMensagemDoControle, lerMensagemDoEstado, lerMensagemDoEstudio, lerPresenca, lerRemetente, topicoDoControle, topicoDoEstado } from '../../domains/aovivo/mensagens'
import type { PresencaNoEstudio } from '../../domains/aovivo/mensagens'
import type { CanalDoControle, CanalDoEstado, CanalDoEstudio, EstadoDoCanal, FabricaDeCanais, RespostaDoEnvio } from '../../domains/aovivo/portas'

type Canal = ReturnType<SupabaseClient['channel']>

/** Ouvintes brutos de uma alça; cada um já valida e agenda o ouvinte da tela. */
interface OuvintesDaAlca {
  broadcast: Set<(evento: string, payload: unknown) => void>
  presenca: Set<(estado: Record<string, unknown>) => void>
  entrada: Set<() => void>
  estado: Set<(e: EstadoDoCanal) => void>
}

/** O canal atual de um tópico neste cliente, dividido pelas alças (I3). */
interface Registro {
  topico: string
  canal: Canal | null
  refs: number
  estado: EstadoDoCanal
  alcas: Set<OuvintesDaAlca>
  /** A última presença marcada por uma alça; remarcada a cada volta a `conectado` (a reconexão entra de novo no canal). */
  presenca: Record<string, unknown> | null
  /** Fechado pelo servidor, negado ou já removido: não muda mais de estado nem é removido de novo (I-A). */
  morto: boolean
}

/**
 * Remoções ainda pendentes, por cliente e tópico: a janela é o `untrack()`, que espera a resposta do
 * servidor com o canal ainda inscrito na lista (o `removeChannel` em si fecha na hora,
 * `phoenix.cjs.js:461-470`). Fica no módulo, chaveado pelo cliente, e não na fábrica: outra fábrica do
 * mesmo cliente (outro usuário, `canaisPorUsuario`) também precisa esperar, senão o `channel()` dela
 * devolveria o canal que ainda está saindo e a alça nova iria a `fechado` (I2).
 */
const REMOCOES_POR_CLIENTE = new WeakMap<object, Map<string, Promise<void>>>()

function remocoesDo(cliente: SupabaseClient): Map<string, Promise<void>> {
  let remocoes = REMOCOES_POR_CLIENTE.get(cliente)
  if (remocoes === undefined) {
    remocoes = new Map()
    REMOCOES_POR_CLIENTE.set(cliente, remocoes)
  }
  return remocoes
}

/** Como o Realtime nega a entrada num canal privado: o `CHANNEL_ERROR` traz "Unauthorized: ..." na mensagem. */
const NAO_AUTORIZADO = /unauthorized/i

/**
 * Fábrica dos canais privados do ao vivo (o `CanalAoVivo` do DES-001 §6.1; PLA-004, D6, D14, D15, I3,
 * I-A e I-B) sobre o `realtime-js` do cliente Supabase dado.
 *
 * - **Um canal por tópico por cliente** (I3): o `realtime-js` 2.119.0 devolve o canal existente para o
 *   mesmo tópico e recusa `on('presence')` depois do `subscribe()`; por isso o primeiro `abrir` cria o
 *   canal e registra tudo (`broadcast`, presença `sync` e `join`, estado) **antes** do `subscribe()`, e
 *   cada chamada devolve uma alça própria, com contagem de referências; o canal só sai
 *   (`untrack` + `removeChannel`) quando a última alça fecha.
 * - **Canal fechado ou negado** (I-A): o registro sai do mapa na hora (o próximo `abrir` cria um canal
 *   novo); as alças que o seguravam recebem o estado e decidem reabrir. O canal negado (com erro, ainda
 *   na lista do cliente e tentando de novo sozinho) é removido aqui, para o `channel()` seguinte não
 *   devolvê-lo; o fechado pelo servidor já saiu da lista e não é removido de novo (a remoção filtra pelo
 *   tópico e levaria junto o canal novo). Um `abrir` durante uma remoção pendente espera ela terminar.
 * - **Eco local** (I-B): com `self: false`, o que uma alça envia chega às **outras** alças do mesmo
 *   tópico neste cliente pelo mesmo leitor do domínio, qualquer que seja a resposta do `ack`; nunca a
 *   quem enviou.
 * - Toda mensagem recebida passa por `lerRemetente` e pelo leitor do domínio (inválida ou sem remetente
 *   → descartada) e todo ouvinte é chamado por `agendar` (padrão `setTimeout(..., 0)`), nunca dentro do
 *   callback do `realtime-js`.
 * - Enviar só com o canal `conectado`: fora dele, `falhou` sem chamar `send` (o `send` do `realtime-js`
 *   cairia para o REST).
 */
export function criarFabricaDeCanais(cliente: SupabaseClient, usuarioId: string, agendar: (f: () => void) => void = (f) => setTimeout(f, 0)): FabricaDeCanais {
  const registros = new Map<string, Registro>()
  const removendo = remocoesDo(cliente)

  function mudar(r: Registro, e: EstadoDoCanal): void {
    if (r.morto) return
    definirEstado(r, e)
  }

  function definirEstado(r: Registro, e: EstadoDoCanal): void {
    r.estado = e
    if (e === 'conectado' && r.presenca !== null && r.canal !== null) void r.canal.track(r.presenca).catch(() => {})
    for (const a of [...r.alcas]) for (const f of [...a.estado]) f(e)
  }

  /** Remoção do canal: `untrack` (se houver presença) e `removeChannel`; o próximo `abrir` do tópico espera a promessa inteira. */
  function remover(topico: string, canal: Canal, desmarcar: boolean): Promise<void> {
    const remocao = (async () => {
      try {
        if (desmarcar) await canal.untrack()
      } catch {
        /* o canal sai de qualquer jeito */
      }
      try {
        await cliente.removeChannel(canal)
      } catch {
        /* idem */
      }
    })().finally(() => {
      if (removendo.get(topico) === remocao) removendo.delete(topico)
    })
    removendo.set(topico, remocao)
    return remocao
  }

  function encerrar(r: Registro, estado: 'fechado' | 'negado'): void {
    if (r.morto) return
    r.morto = true
    if (registros.get(r.topico) === r) registros.delete(r.topico)
    definirEstado(r, estado)
    if (estado === 'negado' && r.canal !== null) void remover(r.topico, r.canal, false)
  }

  function distribuir(r: Registro, de: OuvintesDaAlca | null, evento: string, payload: unknown): void {
    for (const a of [...r.alcas]) {
      if (a === de) continue
      for (const f of [...a.broadcast]) f(evento, payload)
    }
  }

  /**
   * Cria e inscreve o canal do registro. Qualquer falha vira `fechado` para as alças (das quais o
   * `useEstudio` já sabe sair), nunca uma rejeição solta nem uma alça presa em `conectando` (I2): o
   * `channel()` que devolve um canal que não é novo (inscrito por outro código ou fábrica do mesmo
   * cliente, ou com erro) e o `on`/`subscribe` que lança.
   */
  function criarCanal(r: Registro): void {
    if (registros.get(r.topico) !== r || r.refs === 0) return // fechado antes de nascer
    try {
      inscreverCanal(r)
    } catch {
      r.canal = null // um canal alheio ou com defeito nunca é removido daqui
      encerrar(r, 'fechado')
    }
  }

  function inscreverCanal(r: Registro): void {
    const canal = cliente.channel(r.topico, {
      config: { private: true, broadcast: { ack: true, self: false }, presence: { key: usuarioId } },
    })
    // Só um canal novo (fechado e que nunca entrou) é deste registro: o realtime-js devolve o existente do tópico.
    if (canal.state !== 'closed' || canal.joinedOnce) throw new Error('canal do tópico já em uso neste cliente')
    r.canal = canal
    // Tudo antes do subscribe: o realtime-js recusa presence depois.
    canal.on('broadcast', { event: '*' }, (m: { event: string; payload: unknown }) => distribuir(r, null, m.event, m.payload))
    canal.on('presence', { event: 'sync' }, () => {
      const estado = canal.presenceState() as Record<string, unknown>
      for (const a of [...r.alcas]) for (const f of [...a.presenca]) f(estado)
    })
    canal.on('presence', { event: 'join' }, () => {
      for (const a of [...r.alcas]) for (const f of [...a.entrada]) f()
    })
    canal.subscribe((status: string, erro?: Error) => {
      if (status === 'SUBSCRIBED') mudar(r, 'conectado')
      else if (status === 'CLOSED') encerrar(r, 'fechado')
      else if (status === 'CHANNEL_ERROR' && NAO_AUTORIZADO.test(erro?.message ?? '')) encerrar(r, 'negado')
      else mudar(r, 'reconectando') // TIMED_OUT e CHANNEL_ERROR: o realtime-js tenta de novo sozinho
    })
  }


  function abrir(topico: string): Registro {
    let r = registros.get(topico)
    if (!r) {
      const novo: Registro = { topico, canal: null, refs: 0, estado: 'conectando', alcas: new Set(), presenca: null, morto: false }
      registros.set(topico, novo)
      void (removendo.get(topico) ?? Promise.resolve()).then(() => criarCanal(novo))
      r = novo
    }
    r.refs += 1
    return r
  }

  async function enviar(r: Registro, de: OuvintesDaAlca, evento: string, corpo: Record<string, unknown>): Promise<RespostaDoEnvio> {
    const canal = r.canal
    if (r.estado !== 'conectado' || canal === null) return 'falhou'
    const payload = { ...corpo, remetente: usuarioId }
    let resposta: string
    try {
      resposta = await canal.send({ type: 'broadcast', event: evento, payload })
    } catch {
      resposta = 'error'
    }
    // I-B: o servidor não devolve ao próprio socket (self: false); as outras alças recebem daqui.
    distribuir(r, de, evento, payload)
    return resposta === 'ok' ? 'ok' : resposta === 'timed out' ? 'sem_resposta' : 'falhou'
  }

  /** Alça de um registro: ouvintes só dela, soltos no `fechar` (idempotente). */
  function criarAlca(r: Registro) {
    const ouvintes: OuvintesDaAlca = { broadcast: new Set(), presenca: new Set(), entrada: new Set(), estado: new Set() }
    r.alcas.add(ouvintes)
    let fechada = false

    function inscrever<T>(conjunto: Set<T>, bruto: T): () => void {
      if (fechada) return () => {}
      conjunto.add(bruto)
      return () => {
        conjunto.delete(bruto)
      }
    }

    /** Chama `f` fora do callback do realtime-js, se o ouvinte ainda estiver inscrito. */
    function adiar<T>(conjunto: Set<T>, bruto: T, f: () => void): void {
      agendar(() => {
        if (!fechada && conjunto.has(bruto)) f()
      })
    }

    function aoEstado(f: (e: EstadoDoCanal) => void): () => void {
      const bruto = (e: EstadoDoCanal) => adiar(ouvintes.estado, bruto, () => f(e))
      const cancelar = inscrever(ouvintes.estado, bruto)
      if (!fechada) bruto(r.estado) // quem chega depois (outra alça do mesmo canal) fica sabendo o estado atual
      return cancelar
    }

    function aoBroadcast(f: (evento: string, payload: unknown, remetente: string) => void): () => void {
      const bruto = (evento: string, payload: unknown) => {
        const remetente = lerRemetente(payload)
        if (remetente === null) return
        adiar(ouvintes.broadcast, bruto, () => f(evento, payload, remetente))
      }
      return inscrever(ouvintes.broadcast, bruto)
    }

    async function marcar(p: Record<string, unknown>): Promise<void> {
      if (fechada) return
      r.presenca = p
      if (r.estado === 'conectado' && r.canal !== null) {
        try {
          await r.canal.track(p)
        } catch {
          /* remarcada na próxima volta a conectado */
        }
      }
    }

    async function fechar(): Promise<void> {
      if (fechada) return
      fechada = true
      r.alcas.delete(ouvintes)
      r.refs -= 1
      if (r.refs > 0) return // outra alça (por exemplo, o painel) continua usando o canal
      if (registros.get(r.topico) === r) registros.delete(r.topico)
      const canal = r.canal
      if (r.morto || canal === null) {
        r.morto = true
        return // fechado pelo servidor ou negado (já tratado), ou nunca chegou a nascer (criarCanal confere refs)
      }
      const desmarcar = r.estado === 'conectado' && r.presenca !== null
      r.morto = true // o CLOSED da própria remoção não chega a ninguém
      await remover(r.topico, canal, desmarcar)
    }

    /** Ouvinte de entrada (`join`): o bruto roda no callback; o ouvinte da tela é adiado. */
    function aoPresenca<T>(conjunto: Set<T>, criar: (adiarTela: (f: () => void) => void) => T): () => void {
      const bruto: T = criar((f) => adiar(conjunto, bruto, f))
      return inscrever(conjunto, bruto)
    }

    /** Lista de presença (`sync`): quem se inscreve com o canal já conectado recebe já a presença atual (I1), adiada como o resto. */
    function aoSincronizar(criar: (adiarTela: (f: () => void) => void) => (estado: Record<string, unknown>) => void): () => void {
      const bruto = criar((f) => adiar(ouvintes.presenca, bruto, f))
      const cancelar = inscrever(ouvintes.presenca, bruto)
      if (!fechada && r.estado === 'conectado' && r.canal !== null) bruto(r.canal.presenceState() as Record<string, unknown>)
      return cancelar
    }

    return { ouvintes, aoEstado, aoBroadcast, aoPresenca, aoSincronizar, marcar, fechar, enviar: (evento: string, corpo: Record<string, unknown>) => (fechada ? Promise.resolve<RespostaDoEnvio>('falhou') : enviar(r, ouvintes, evento, corpo)) }
  }

  return {
    estudio(): CanalDoEstudio {
      const alca = criarAlca(abrir('estudio'))
      return {
        aoReceber(f) {
          return alca.aoBroadcast((evento, payload, remetente) => {
            const m = lerMensagemDoEstudio(evento, payload)
            if (m !== null) f(m, remetente)
          })
        },
        aoMudarPresenca(f) {
          return alca.aoSincronizar((adiarTela) => (estado: Record<string, unknown>) => {
            const presentes: { usuario: string; presenca: PresencaNoEstudio }[] = []
            for (const [usuario, lista] of Object.entries(estado)) {
              if (!UUID.test(usuario) || !Array.isArray(lista)) continue
              for (const bruta of lista) {
                const presenca = lerPresenca(bruta)
                if (presenca !== null) presentes.push({ usuario, presenca })
              }
            }
            adiarTela(() => f(presentes))
          })
        },
        aoMudarEstado: alca.aoEstado,
        enviar(m) {
          const { evento, ...corpo } = m
          return alca.enviar(evento, corpo)
        },
        marcarPresenca(p) {
          return alca.marcar({ ...p })
        },
        fechar: alca.fechar,
      }
    },

    controle(episodioId: string): CanalDoControle {
      const alca = criarAlca(abrir(topicoDoControle(episodioId)))
      return {
        // VER-047: deste tópico só sai comando (um `estado` forjado aqui é descartado pelo leitor do domínio)
        aoComando(f) {
          return alca.aoBroadcast((evento, payload, remetente) => {
            const c = lerMensagemDoControle(evento, payload)
            if (c !== null) f(c, remetente)
          })
        },
        aoEntrarAlguem(f) {
          return alca.aoPresenca(alca.ouvintes.entrada, (adiarTela) => () => adiarTela(f))
        },
        aoMudarPresentes(f) {
          return alca.aoSincronizar((adiarTela) => (estado: Record<string, unknown>) => {
            const usuarios = Object.entries(estado)
              .filter(([usuario, lista]) => UUID.test(usuario) && Array.isArray(lista) && lista.length > 0)
              .map(([usuario]) => usuario)
            adiarTela(() => f(usuarios))
          })
        },
        aoMudarEstado: alca.aoEstado,
        enviarComando(c) {
          return alca.enviar(EVENTOS_DO_CONTROLE.comando, { ...c })
        },
        marcarPresenca() {
          return alca.marcar({})
        },
        fechar: alca.fechar,
      }
    },

    /**
     * O estado no ar do palco num tópico próprio (VER-047): só o `obs_palco` envia (RLS), membros e o palco recebem.
     * Mesmo registro dos outros tópicos (um canal por tópico, contagem de referências, eco local, fechado/negado saem
     * do mapa); ninguém marca presença aqui, então a remoção não faz `untrack`.
     */
    estado(episodioId: string): CanalDoEstado {
      const alca = criarAlca(abrir(topicoDoEstado(episodioId)))
      return {
        // deste tópico só sai estado (um `comando` forjado aqui é descartado pelo leitor do domínio)
        aoEstado(f) {
          return alca.aoBroadcast((evento, payload, remetente) => {
            const e = lerMensagemDoEstado(evento, payload)
            if (e !== null) f(e, remetente)
          })
        },
        aoMudarEstado: alca.aoEstado,
        publicarEstado(e) {
          return alca.enviar(EVENTOS_DO_ESTADO.estado, { ...e })
        },
        fechar: alca.fechar,
      }
    },
  }
}
