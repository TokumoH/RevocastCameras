import { afterEach, describe, expect, test, vi } from 'vitest'
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
  /**
   * Uma mensagem publicada pelo banco (`realtime.send`) chegando do servidor ao canal: no real, pelo `onConnMessage` do
   * socket, num quadro de texto (`[join_ref, ref, topic, 'broadcast', { type, event, payload }]`) ou binário (tipo 4,
   * `userBroadcast`), que o serializer 2.0.0 decodifica (`lib/serializer.js:108-153`); no falso, `emitirBroadcast`.
   */
  publicarPeloBanco(c: CanalMinimo, evento: string, payload: unknown, binario: boolean): void
}

/** Mensagem que o canal phoenix entrega ao socket (`push`). */
interface MensagemDoSocket {
  event: string
  ref: string
  join_ref: string
}

interface CanalPhoenix {
  topic: string
  socket: { isConnected: () => boolean; push: (m: MensagemDoSocket) => void; onConnMessage: (m: { data: unknown }) => void }
  trigger: (evento: string, carga: unknown, ref?: string, joinRef?: string) => void
}

function phoenixDe(c: CanalMinimo): CanalPhoenix {
  return (c as unknown as { channelAdapter: { channel: CanalPhoenix } }).channelAdapter.channel
}

const tique = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Quadro binário `userBroadcast` (tipo 4) como o servidor manda: cabeçalho de 5 bytes, tópico, evento, metadados e o JSON. */
function quadroBinario(topico: string, evento: string, payload: unknown, meta: unknown): ArrayBuffer {
  const cod = new TextEncoder()
  const partes = [cod.encode(topico), cod.encode(evento), cod.encode(JSON.stringify(meta)), cod.encode(JSON.stringify(payload))]
  const quadro = new Uint8Array(5 + partes.reduce((n, p) => n + p.length, 0))
  quadro.set([4, partes[0].length, partes[1].length, partes[2].length, 1]) // 1 = JSON
  let pos = 5
  for (const p of partes) {
    quadro.set(p, pos)
    pos += p.length
  }
  return quadro.buffer
}

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
    publicarPeloBanco(c, evento, payload, binario) {
      const phx = phoenixDe(c)
      const data = binario
        ? quadroBinario(phx.topic, evento, payload, { id: (payload as { id?: unknown }).id })
        : JSON.stringify([null, null, phx.topic, 'broadcast', { type: 'broadcast', event: evento, payload }])
      phx.socket.onConnMessage({ data })
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
    publicarPeloBanco(c, evento, payload) {
      rt.emitirBroadcast(c as ReturnType<typeof rt.cliente.channel>, evento, payload)
    },
  }
}

const EU = '5a1c9e2b-7d3f-4b6a-8c1d-2e3f4a5b6c7d'
const TOPICO_VIDEO = `video:${EU}`

/**
 * Uma alça do adaptador no tópico: `estudio()` ou, desde a E4 (PLA-005, Tarefa 3), `videoDaCamera()` no tópico da própria
 * sessão (`video:<usuarioId>`), que usa o mesmo registro (um canal por tópico, contagem de referências).
 */
function abrirAlca(fabrica: ReturnType<typeof criarFabricaDeCanais>, topico: string): { fechar(): Promise<void>; aoMudarEstado(f: (e: string) => void): () => void } {
  return topico === 'estudio' ? fabrica.estudio() : fabrica.videoDaCamera()
}

// E4 (PLA-005, Tarefa 3, `video-contrato`): os casos que valem para `estudio` rodam também com o tópico de vídeo.
describe.each([
  ['realtime-js real', 'estudio', real],
  ['realtimeFalso', 'estudio', falso],
  ['realtime-js real', TOPICO_VIDEO, real],
  ['realtimeFalso', TOPICO_VIDEO, falso],
] as const)('contrato do realtime-js 2.119.0: %s, tópico %s', (_nome, topico, criar) => {
  test('channel-devolve-o-existente', () => {
    const i = criar()
    const a = i.canal(topico)
    expect(i.canal(topico)).toBe(a)
    expect(i.canal('outro')).not.toBe(a)
    expect(i.lista()).toHaveLength(2)
  })

  test('canal-novo-fechado-e-nunca-entrou', () => {
    const i = criar()
    const c = i.canal(topico)
    expect([c.state, c.joinedOnce]).toEqual(['closed', false])
    c.subscribe()
    expect([c.state, c.joinedOnce]).toEqual(['joining', true])
  })

  test('presence-depois-do-subscribe-lanca', () => {
    const i = criar()
    const c = i.canal(topico)
    c.on('presence', { event: 'sync' }, () => {})
    c.subscribe()
    expect(() => c.on('presence', { event: 'join' }, () => {})).toThrow(/cannot add `presence` callbacks/)
    expect(() => c.on('broadcast', { event: '*' }, () => {})).not.toThrow()
  })

  test('fechado-pelo-servidor-sai-da-lista-e-nao-entra-de-novo', () => {
    const i = criar()
    const c = i.canal(topico)
    const status: string[] = []
    c.subscribe((s) => status.push(s))
    i.fecharPeloServidor(c)
    expect(status).toEqual(['CLOSED'])
    expect(i.lista()).toEqual([])
    expect(() => c.subscribe()).toThrow(/tried to join multiple times/)
  })

  test('remocao-filtra-pelo-topico', async () => {
    const i = criar()
    const velho = i.canal(topico)
    velho.subscribe()
    i.fecharPeloServidor(velho)
    const novo = i.canal(topico)
    expect(novo).not.toBe(velho)
    expect(i.lista()).toEqual([novo])
    await i.remover(velho)
    expect(i.lista()).toEqual([]) // o canal novo saiu junto: por isso o adaptador não remove o fechado
  })

  test('remover-fecha-na-hora', () => {
    // o leave() do phoenix põe o estado em leaving antes do canPush() (que exige joined): o ok sai localmente
    // e o close roda dentro da própria chamada (phoenix.cjs.js:461-470); nada fica "saindo" na lista
    const i = criar()
    const c = i.canal(topico)
    const status: string[] = []
    c.subscribe((s) => status.push(s))
    void i.remover(c) // sem await
    expect(i.lista()).toEqual([])
    expect(c.state).toBe('closed')
    expect(status).toEqual(['CLOSED'])
    expect(i.canal(topico)).not.toBe(c)
  })

  test('remover-fecha-na-hora-com-canal-joined', async () => {
    // o caso de produção: o canal já entrou (joined, socket conectado); o leave põe leaving antes do canPush(),
    // então o ok sai localmente e o close roda dentro do removeChannel (phoenix.cjs.js:461-470)
    const i = criar()
    const c = i.canal(topico)
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
    const c = i.canal(topico)
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
    const c = i.canal(topico)
    c.subscribe()
    expect(await i.remover(c)).toBe('ok')
    expect(i.lista()).toEqual([])
    expect(i.canal(topico)).not.toBe(c)
  })

  test('adaptador-sobre-o-cliente', async () => {
    const i = criar()
    const fabrica = criarFabricaDeCanais(i.cliente, EU)
    const a = abrirAlca(fabrica, topico)
    const b = abrirAlca(fabrica, topico)
    await tique()
    abrirAlca(fabrica, topico) // depois do subscribe: não lança nem cria outro canal
    await tique()
    expect(i.lista()).toHaveLength(1)
    if (topico === 'estudio') expect(await fabrica.estudio().enviar({ evento: 'episodio_ativo_mudou' })).toBe('falhou') // sem conexão, sem cair para o REST
    // fechar duas das três alças não tira o canal da lista
    await a.fechar()
    await b.fechar()
    expect(i.lista()).toHaveLength(1) // a terceira alça segura o canal
  })

  test('topico-alheio-vira-fechado', async () => {
    // outro código (ou outra fábrica) do mesmo cliente já inscreveu o tópico (sonda P3 do revisor)
    const i = criar()
    const alheio = i.canal(topico)
    alheio.subscribe()
    const estados: string[] = []
    const a = abrirAlca(criarFabricaDeCanais(i.cliente, EU, (f) => f()), topico)
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
    const a = abrirAlca(fabrica, topico)
    await tique()
    await a.fechar()
    expect(i.lista()).toEqual([])
    const b = abrirAlca(fabrica, topico)
    await tique()
    expect((i.lista() as CanalMinimo[]).map((c) => c.state)).toEqual(['joining'])
    await b.fechar()
  })
})

/*
 * E4 (PLA-005, Tarefa 3, `video-contrato`; F15): o que `enviar_sinal_de_video` publica com `realtime.send` chega ao
 * ouvinte `broadcast` do canal com `event = 'sinal'` e o `payload` com o `id` acrescentado; o adaptador entrega o sinal
 * validado com o remetente posto pelo banco. E o envio do canal de vídeo é só a `rpc`: nada pelo socket nem pelo REST
 * do Broadcast.
 */
const OUTRO = '7b2d0f3c-8e4a-4c7b-9d2e-3f4a5b6c7d8e'
const SESSAO = '3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b'
const ID_DA_MENSAGEM = '4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c'
const SDP = 'v=0\r\no=- 1 2 IN IP4 192.0.2.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n'

afterEach(() => {
  vi.restoreAllMocks()
})

describe.each([
  ['realtime-js real', real],
  ['realtimeFalso', falso],
] as const)('contrato do tópico de vídeo: %s', (nome, criar) => {
  // o falso não tem serializer: o quadro binário só existe no real
  test.each(nome === 'realtimeFalso' ? [false] : [false, true])('video-contrato: mensagem do banco chega com o id (quadro binário: %s)', async (binario) => {
    const i = criar()
    const fabrica = criarFabricaDeCanais(i.cliente, EU, (f) => f())
    const obs = fabrica.videoDaObs()
    const sinais: unknown[] = []
    obs.aoSinal((s, remetente) => sinais.push([s, remetente]))
    await tique()
    const [c] = i.lista() as CanalMinimo[]
    const brutos: unknown[] = []
    c.on('broadcast', { event: '*' }, (m) => brutos.push(m))
    // a forma que o realtime.send grava (F15): o payload montado pela função, com o id acrescentado
    const payload = { tipo: 'oferta', sessao: SESSAO, sdp: SDP, remetente: OUTRO, id: ID_DA_MENSAGEM }
    i.publicarPeloBanco(c, 'sinal', payload, binario)
    expect(brutos).toHaveLength(1)
    expect(brutos[0]).toMatchObject({ type: 'broadcast', event: 'sinal', payload })
    expect(sinais).toEqual([[{ tipo: 'oferta', sessao: SESSAO, sdp: SDP }, OUTRO]])
    await obs.fechar()
  })

  test('video-contrato: enviar só pela rpc', async () => {
    const i = criar()
    const rpc = vi.fn(async () => ({ data: 'enviado', error: null, status: 200 }))
    Object.assign(i.cliente, { rpc })
    const buscas = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('sem rede no teste')
    })
    const fabrica = criarFabricaDeCanais(i.cliente, EU)
    const camera = fabrica.videoDaCamera()
    await tique()
    const [c] = i.lista() as CanalMinimo[]
    const pushes: MensagemDoSocket[] = []
    if (nome === 'realtime-js real') phoenixDe(c).socket.push = (m) => pushes.push(m)
    expect(await camera.enviar({ tipo: 'oferta', sessao: SESSAO, sdp: SDP })).toBe('ok')
    expect(rpc).toHaveBeenCalledWith('enviar_sinal_de_video', { p_tipo: 'oferta', p_sessao: SESSAO, p_sdp: SDP })
    expect(buscas).not.toHaveBeenCalled()
    expect(pushes.filter((m) => m.event === 'broadcast')).toEqual([])
    await camera.fechar()
  })
})

/*
 * E5 (PLA-006, Tarefa 4, `gestos-contrato`; F15): o que `enviar_gesto` e `definir_gestos_ligados` publicam com
 * `realtime.send` chega ao ouvinte `broadcast` do canal com o `event` (`gesto`, `gestos_mudaram`) e o `payload` com o `id`
 * acrescentado, pelo mesmo caminho do vídeo (VER-051); o adaptador entrega o gesto validado com o remetente e o dispositivo
 * postos pelo banco (sem o `id` da mensagem) e o aviso sem valor. Nos tópicos de gestos nada sai pelo socket nem pelo REST.
 */
const GESTO_ID = '6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e'
const DISPOSITIVO_DO_GESTO = '8d9e0f1a-2b3c-4d4e-9f5a-6b7c8d9e0f1a'

describe.each([
  ['realtime-js real', real],
  ['realtimeFalso', falso],
] as const)('contrato do tópico de gestos: %s', (nome, criar) => {
  test.each(nome === 'realtimeFalso' ? [false] : [false, true])('gestos-contrato: mensagens do banco chegam com o id (quadro binário: %s)', async (binario) => {
    const i = criar()
    const buscas = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('sem rede no teste')
    })
    const fabrica = criarFabricaDeCanais(i.cliente, EU, (f) => f())
    const palco = fabrica.gestosDoPalco()
    const recebidos: unknown[] = []
    palco.aoGesto((g, remetente) => recebidos.push(['gesto', g, remetente]))
    palco.aoAviso(() => recebidos.push(['aviso']))
    await tique()
    const [c] = i.lista() as CanalMinimo[]
    const brutos: unknown[] = []
    c.on('broadcast', { event: '*' }, (m) => brutos.push(m))
    const pushes: MensagemDoSocket[] = []
    if (nome === 'realtime-js real') phoenixDe(c).socket.push = (m) => pushes.push(m)
    // as formas que o realtime.send grava (F15): o payload montado pela função, com o id acrescentado
    const gesto = { tipo: 'gesto', gesto_id: GESTO_ID, gesto: 'Victory', dispositivo: DISPOSITIVO_DO_GESTO, remetente: OUTRO, id: ID_DA_MENSAGEM }
    const aviso = { tipo: 'gestos_mudaram', remetente: OUTRO, id: ID_DA_MENSAGEM }
    i.publicarPeloBanco(c, 'gesto', gesto, binario)
    i.publicarPeloBanco(c, 'gestos_mudaram', aviso, binario)
    expect(brutos).toHaveLength(2)
    expect(brutos[0]).toMatchObject({ type: 'broadcast', event: 'gesto', payload: gesto })
    expect(brutos[1]).toMatchObject({ type: 'broadcast', event: 'gestos_mudaram', payload: aviso })
    expect(recebidos).toEqual([['gesto', { id: GESTO_ID, gesto: 'Victory', dispositivoId: DISPOSITIVO_DO_GESTO }, OUTRO], ['aviso']])
    expect(pushes.filter((m) => m.event === 'broadcast')).toEqual([])
    expect(buscas).not.toHaveBeenCalled()
    await palco.fechar()

    // o aparelho que reconhece, no mesmo tópico da própria sessão: só o aviso
    const disp = fabrica.gestos()
    const avisos: unknown[] = []
    disp.aoAviso(() => avisos.push('aviso'))
    await tique()
    const [c2] = i.lista() as CanalMinimo[]
    i.publicarPeloBanco(c2, 'gesto', gesto, binario)
    i.publicarPeloBanco(c2, 'gestos_mudaram', aviso, binario)
    expect(avisos).toEqual(['aviso'])
    await disp.fechar()
  })
})
