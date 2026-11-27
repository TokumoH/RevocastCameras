import { describe, expect, test } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { criarFabricaDeCanais } from './canalSupabase'
import { criarRealtimeFalso } from './realtimeFalso'

/*
 * Teste de contrato do realtime-js 2.119.0 (VER-038, rodada 1): as premissas de que `canalSupabase.ts`
 * depende rodam contra o cliente **real** (sem rede: o `connect` do socket é anulado, então nenhum canal
 * chega a entrar) e contra `realtimeFalso.ts`, com os mesmos casos. Assim as imitações do falso têm
 * teste que as sustente: se o falso divergir do real, o caso do falso cai.
 */

interface CanalMinimo {
  readonly state: string
  readonly joinedOnce: boolean
  on(tipo: string, filtro: { event: string }, f: (carga: unknown) => void): unknown
  subscribe(f?: (status: string, erro?: Error) => void): unknown
  untrack(): Promise<unknown>
}

interface Implementacao {
  cliente: SupabaseClient
  canal(topico: string): CanalMinimo
  remover(c: CanalMinimo): Promise<unknown>
  lista(): unknown[]
  fecharPeloServidor(c: CanalMinimo): void
  /** Inscreve o canal e o leva a `joined` (o servidor respondeu `ok` ao `phx_join`). */
  entrar(c: CanalMinimo, f?: (status: string) => void): Promise<void>
  /** Chama `untrack()` sem que o servidor responda; `responder()` manda a resposta `ok`. */
  untrackSemResposta(c: CanalMinimo): { promessa: Promise<unknown>; responder(): void }
}

/** Mensagem que o canal phoenix entrega ao socket (`push`). */
interface MensagemDoSocket {
  event: string
  ref: string
  join_ref: string
}

interface CanalPhoenix {
  socket: { isConnected: () => boolean; push: (m: MensagemDoSocket) => void }
  trigger: (evento: string, carga: unknown, ref?: string, joinRef?: string) => void
}

function phoenixDe(c: CanalMinimo): CanalPhoenix {
  return (c as unknown as { channelAdapter: { channel: CanalPhoenix } }).channelAdapter.channel
}

const tique = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function real(): Implementacao {
  const cliente = createClient('https://contrato.revocast.test', 'sb_publishable_contrato', { auth: { persistSession: false, autoRefreshToken: false } })
  ;(cliente.realtime as unknown as { connect: () => void }).connect = () => {}
  const enviadas: MensagemDoSocket[] = []
  return {
    cliente,
    canal: (topico) => cliente.channel(topico, { config: { private: true } }) as unknown as CanalMinimo,
    remover: (c) => cliente.removeChannel(c as unknown as Parameters<SupabaseClient['removeChannel']>[0]),
    lista: () => cliente.realtime.getChannels(),
    // o servidor fecha o canal (phx_close), como na renovação do token depois de uma revogação
    fecharPeloServidor: (c) => phoenixDe(c).trigger('phx_close', 'leave'),
    // Socket do phoenix controlado, sem rede: "conectado", e cada push só é anotado; o teste responde como o servidor.
    async entrar(c, f) {
      const phx = phoenixDe(c)
      phx.socket.isConnected = () => true
      phx.socket.push = (m) => enviadas.push(m)
      c.subscribe(f)
      await tique()
      const join = enviadas.find((m) => m.event === 'phx_join')
      if (!join) throw new Error('phx_join não enviado')
      phx.trigger('phx_reply', { status: 'ok', response: {} }, join.ref, join.join_ref)
    },
    untrackSemResposta(c) {
      const antes = enviadas.length
      const promessa = c.untrack()
      const push = enviadas.slice(antes).find((m) => m.event === 'presence')
      if (!push) throw new Error('untrack não enviado ao socket')
      return { promessa, responder: () => phoenixDe(c).trigger('phx_reply', { status: 'ok', response: {} }, push.ref, push.join_ref) }
    },
  }
}

function falso(): Implementacao {
  const rt = criarRealtimeFalso()
  return {
    cliente: rt.cliente as unknown as SupabaseClient,
    canal: (topico) => rt.cliente.channel(topico, { config: { private: true } }),
    remover: (c) => rt.cliente.removeChannel(c as ReturnType<typeof rt.cliente.channel>),
    lista: () => rt.canais(),
    fecharPeloServidor: (c) => rt.emitirStatus(c as ReturnType<typeof rt.cliente.channel>, 'CLOSED'),
    async entrar(c, f) {
      c.subscribe(f)
      await tique()
      rt.emitirStatus(c as ReturnType<typeof rt.cliente.channel>, 'SUBSCRIBED')
    },
    untrackSemResposta(c) {
      rt.segurarUntrack()
      const promessa = c.untrack()
      return { promessa, responder: () => rt.liberarUntracks() }
    },
  }
}

const EU = '5a1c9e2b-7d3f-4b6a-8c1d-2e3f4a5b6c7d'

describe.each([
  ['realtime-js real', real],
  ['realtimeFalso', falso],
] as const)('contrato do realtime-js 2.119.0: %s', (_nome, criar) => {
  test('channel-devolve-o-existente', () => {
    const i = criar()
    const a = i.canal('estudio')
    expect(i.canal('estudio')).toBe(a)
    expect(i.canal('outro')).not.toBe(a)
    expect(i.lista()).toHaveLength(2)
  })

  test('canal-novo-fechado-e-nunca-entrou', () => {
    const i = criar()
    const c = i.canal('estudio')
    expect([c.state, c.joinedOnce]).toEqual(['closed', false])
    c.subscribe()
    expect([c.state, c.joinedOnce]).toEqual(['joining', true])
  })

  test('presence-depois-do-subscribe-lanca', () => {
    const i = criar()
    const c = i.canal('estudio')
    c.on('presence', { event: 'sync' }, () => {})
    c.subscribe()
    expect(() => c.on('presence', { event: 'join' }, () => {})).toThrow(/cannot add `presence` callbacks/)
    expect(() => c.on('broadcast', { event: '*' }, () => {})).not.toThrow()
  })

  test('fechado-pelo-servidor-sai-da-lista-e-nao-entra-de-novo', () => {
    const i = criar()
    const c = i.canal('estudio')
    const status: string[] = []
    c.subscribe((s) => status.push(s))
    i.fecharPeloServidor(c)
    expect(status).toEqual(['CLOSED'])
    expect(i.lista()).toEqual([])
    expect(() => c.subscribe()).toThrow(/tried to join multiple times/)
  })

  test('remocao-filtra-pelo-topico', async () => {
    const i = criar()
    const velho = i.canal('estudio')
    velho.subscribe()
    i.fecharPeloServidor(velho)
    const novo = i.canal('estudio')
    expect(novo).not.toBe(velho)
    expect(i.lista()).toEqual([novo])
    await i.remover(velho)
    expect(i.lista()).toEqual([]) // o canal novo saiu junto: por isso o adaptador não remove o fechado
  })

  test('remover-fecha-na-hora', () => {
    // o leave() do phoenix põe o estado em leaving antes do canPush() (que exige joined): o ok sai localmente
    // e o close roda dentro da própria chamada (phoenix.cjs.js:461-470); nada fica "saindo" na lista
    const i = criar()
    const c = i.canal('estudio')
    const status: string[] = []
    c.subscribe((s) => status.push(s))
    void i.remover(c) // sem await
    expect(i.lista()).toEqual([])
    expect(c.state).toBe('closed')
    expect(status).toEqual(['CLOSED'])
    expect(i.canal('estudio')).not.toBe(c)
  })

  test('remover-fecha-na-hora-com-canal-joined', async () => {
    // o caso de produção: o canal já entrou (joined, socket conectado); o leave põe leaving antes do canPush(),
    // então o ok sai localmente e o close roda dentro do removeChannel (phoenix.cjs.js:461-470)
    const i = criar()
    const c = i.canal('estudio')
    const status: string[] = []
    await i.entrar(c, (s) => status.push(s))
    expect(c.state).toBe('joined')
    expect(status).toEqual(['SUBSCRIBED'])
    void i.remover(c) // sem await
    expect(i.lista()).toEqual([])
    expect(c.state).toBe('closed')
    expect(status).toEqual(['SUBSCRIBED', 'CLOSED'])
  })

  test('untrack-pendente-ate-o-servidor', async () => {
    // a janela real da remoção pendente: o untrack espera a resposta do servidor, com o canal ainda inscrito
    const i = criar()
    const c = i.canal('estudio')
    await i.entrar(c)
    const { promessa, responder } = i.untrackSemResposta(c)
    let resposta: unknown = 'pendente'
    void promessa.then((r) => {
      resposta = r
    })
    await tique()
    await tique()
    expect(resposta).toBe('pendente')
    expect(i.lista()).toEqual([c])
    expect(c.state).toBe('joined')
    responder()
    await tique()
    expect(resposta).toBe('ok')
  })

  test('remover-tira-da-lista', async () => {
    const i = criar()
    const c = i.canal('estudio')
    c.subscribe()
    expect(await i.remover(c)).toBe('ok')
    expect(i.lista()).toEqual([])
    expect(i.canal('estudio')).not.toBe(c)
  })

  test('adaptador-sobre-o-cliente', async () => {
    const i = criar()
    const fabrica = criarFabricaDeCanais(i.cliente, EU)
    const a = fabrica.estudio()
    const b = fabrica.estudio()
    await tique()
    fabrica.estudio() // depois do subscribe: não lança nem cria outro canal
    await tique()
    expect(i.lista()).toHaveLength(1)
    expect(await a.enviar({ evento: 'episodio_ativo_mudou' })).toBe('falhou') // sem conexão, sem cair para o REST
    // fechar duas das três alças não tira o canal da lista
    await a.fechar()
    await b.fechar()
    expect(i.lista()).toHaveLength(1) // a terceira alça segura o canal
  })

  test('topico-alheio-vira-fechado', async () => {
    // outro código (ou outra fábrica) do mesmo cliente já inscreveu o tópico (sonda P3 do revisor)
    const i = criar()
    const alheio = i.canal('estudio')
    alheio.subscribe()
    const estados: string[] = []
    const a = criarFabricaDeCanais(i.cliente, EU, (f) => f()).estudio()
    a.aoMudarEstado((e) => estados.push(e))
    await tique()
    await tique()
    expect(estados).toEqual(['conectando', 'fechado'])
    expect(i.lista()).toEqual([alheio])
  })

  test('fechar-e-reabrir', async () => {
    // sonda P4 do revisor: depois do fechar, nenhum canal; reabrir → canal novo entrando
    const i = criar()
    const fabrica = criarFabricaDeCanais(i.cliente, EU)
    const a = fabrica.estudio()
    await tique()
    await a.fechar()
    expect(i.lista()).toEqual([])
    const b = fabrica.estudio()
    await tique()
    expect((i.lista() as CanalMinimo[]).map((c) => c.state)).toEqual(['joining'])
    await b.fechar()
  })
})
