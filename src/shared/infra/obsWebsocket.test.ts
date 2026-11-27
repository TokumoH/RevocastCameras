import { afterEach, describe, test, expect, vi } from 'vitest'
import { ESPERA_DO_OBS_MS, criarObsWebsocket, type SocketDoObs } from './obsWebsocket'

/** O tsconfig não carrega os tipos do Node; o vetor de autenticação usa o `node:crypto` por import dinâmico tipado à mão. */
const MODULO_CRYPTO = 'node:crypto'
type Hash = { update(t: string): Hash; digest(f: 'base64'): string }
const { createHash } = (await import(/* @vite-ignore */ MODULO_CRYPTO)) as { createHash(algoritmo: 'sha256'): Hash }
const sha256Base64 = (t: string) => createHash('sha256').update(t).digest('base64')

const SENHA = 'senha-de-teste'
const SALT = 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI='
const CHALLENGE = '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY='

/** WebSocket falso: guarda a URL, o subprotocolo e os quadros enviados; o teste faz o papel do OBS. */
class SocketFalso implements SocketDoObs {
  readonly url: string
  readonly enviados: string[] = []
  fechado = false
  onmessage: ((e: MessageEvent) => void) | null = null
  onclose: ((e: CloseEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  constructor(url: string) {
    this.url = url
  }
  send(dados: string) {
    this.enviados.push(dados)
  }
  close() {
    this.fechado = true
  }
  receber(o: unknown) {
    this.onmessage?.({ data: JSON.stringify(o) } as MessageEvent)
  }
  fechar(code: number) {
    this.onclose?.({ code } as CloseEvent)
  }
  quadros(): { op: number; d: Record<string, unknown> }[] {
    return this.enviados.map((t) => JSON.parse(t))
  }
}

function montar() {
  const sockets: SocketFalso[] = []
  const ws = criarObsWebsocket((url) => {
    const s = new SocketFalso(url)
    sockets.push(s)
    return s
  })
  return { ws, sockets, ultimo: () => sockets[sockets.length - 1] }
}

const esperar = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

const HELLO_COM_SENHA = { op: 0, d: { obsStudioVersion: '31.0.1', obsWebSocketVersion: '5.5.4', rpcVersion: 1, authentication: { challenge: CHALLENGE, salt: SALT } } }
const HELLO_SEM_SENHA = { op: 0, d: { obsStudioVersion: '31.0.1', obsWebSocketVersion: '5.5.4', rpcVersion: 1 } }

async function conectado(m = montar()) {
  const p = m.ws.conectar({ porta: 4455, senha: SENHA })
  m.ultimo().receber(HELLO_COM_SENHA)
  await esperar()
  m.ultimo().receber({ op: 2, d: { negotiatedRpcVersion: 1 } })
  expect(await p).toBe('conectado')
  return m
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('obs-websocket v5 sem biblioteca (D10)', () => {
  test('autenticacao', async () => {
    const m = montar()
    const p = m.ws.conectar({ porta: 4455, senha: SENHA })
    expect(m.ultimo().url).toBe('ws://127.0.0.1:4455')
    m.ultimo().receber(HELLO_COM_SENHA)
    await esperar()
    const esperado = sha256Base64(sha256Base64(SENHA + SALT) + CHALLENGE)
    expect(m.ultimo().quadros()).toEqual([{ op: 1, d: { rpcVersion: 1, authentication: esperado, eventSubscriptions: 0 } }])
    m.ultimo().receber({ op: 2, d: { negotiatedRpcVersion: 1 } })
    expect(await p).toBe('conectado')
    // senha, salt e challenge de exemplo do protocolo (docs/generated/protocol.md); o valor fixo foi calculado à parte com o node:crypto
    const doc = montar()
    const pd = doc.ws.conectar({ porta: 4455, senha: 'supersecretpassword' })
    doc.ultimo().receber(HELLO_COM_SENHA)
    await esperar()
    expect(doc.ultimo().quadros()[0].d.authentication).toBe('1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=')
    doc.ws.fechar()
    expect(await pd).toBe('sem_conexao')
  })

  test('subprotocolo-padrao', () => {
    const original = globalThis.WebSocket
    const criados: { url: string; protocolos: unknown }[] = []
    globalThis.WebSocket = class {
      constructor(url: string, protocolos: unknown) {
        criados.push({ url, protocolos })
      }
      close() {}
    } as unknown as typeof WebSocket
    try {
      const ws = criarObsWebsocket()
      void ws.conectar({ porta: 4460, senha: '' })
      expect(criados).toEqual([{ url: 'ws://127.0.0.1:4460', protocolos: 'obswebsocket.json' }])
      ws.fechar()
    } finally {
      globalThis.WebSocket = original
    }
  })

  test('identify-sem-senha', async () => {
    const m = montar()
    const p = m.ws.conectar({ porta: 4455, senha: SENHA })
    m.ultimo().receber(HELLO_SEM_SENHA)
    await esperar()
    expect(m.ultimo().quadros()).toEqual([{ op: 1, d: { rpcVersion: 1, eventSubscriptions: 0 } }])
    m.ultimo().receber({ op: 2, d: { negotiatedRpcVersion: 1 } })
    expect(await p).toBe('conectado')
  })

  test('senha-errada', async () => {
    const m = montar()
    const p = m.ws.conectar({ porta: 4455, senha: 'outra-senha-de-teste' })
    m.ultimo().receber(HELLO_COM_SENHA)
    await esperar()
    m.ultimo().fechar(4009)
    expect(await p).toBe('senha_errada')
    // depois disso, nada é pedido ao OBS
    expect(await m.ws.versao()).toBeNull()
    expect(await m.ws.marcar('X')).toBe(false)
  })

  test('sem-conexao', async () => {
    // erro do socket
    const a = montar()
    const pa = a.ws.conectar({ porta: 4455, senha: SENHA })
    a.ultimo().onerror?.({} as Event)
    expect(await pa).toBe('sem_conexao')
    expect(a.ultimo().fechado).toBe(true)
    // fechado com outro código antes de identificar
    const b = montar()
    const pb = b.ws.conectar({ porta: 4455, senha: SENHA })
    b.ultimo().fechar(1006)
    expect(await pb).toBe('sem_conexao')
    // criar o socket lança (porta inválida)
    const c = criarObsWebsocket(() => {
      throw new Error('porta inválida')
    })
    expect(await c.conectar({ porta: 4455, senha: SENHA })).toBe('sem_conexao')
    // 5 s sem Hello
    vi.useFakeTimers()
    const d = montar()
    let resultado: unknown = 'esperando'
    const pd = d.ws.conectar({ porta: 4455, senha: SENHA }).then((r) => (resultado = r))
    await vi.advanceTimersByTimeAsync(4999)
    expect(resultado).toBe('esperando')
    await vi.advanceTimersByTimeAsync(1)
    await pd
    expect(resultado).toBe('sem_conexao')
    expect(d.ultimo().fechado).toBe(true)
    expect(ESPERA_DO_OBS_MS).toBe(5000)
  })

  test('get-version', async () => {
    const m = await conectado()
    const p = m.ws.versao()
    const pedido = m.ultimo().quadros().at(-1)!
    expect(pedido.op).toBe(6)
    expect(pedido.d.requestType).toBe('GetVersion')
    expect(typeof pedido.d.requestId).toBe('string')
    m.ultimo().receber({ op: 7, d: { requestType: 'GetVersion', requestId: pedido.d.requestId, requestStatus: { result: true, code: 100 }, responseData: { obsVersion: '31.0.1', obsWebSocketVersion: '5.5.4' } } })
    expect(await p).toBe('31.0.1')
    // resposta com outro id não resolve; versão fora da forma → null
    const p2 = m.ws.versao()
    const pedido2 = m.ultimo().quadros().at(-1)!
    m.ultimo().receber({ op: 7, d: { requestType: 'GetVersion', requestId: 'outro', requestStatus: { result: true, code: 100 }, responseData: { obsVersion: '1.0.0' } } })
    m.ultimo().receber({ op: 7, d: { requestType: 'GetVersion', requestId: pedido2.d.requestId, requestStatus: { result: true, code: 100 }, responseData: { obsVersion: 42 } } })
    expect(await p2).toBeNull()
    // sem conexão → null, sem quadro
    const n = montar()
    expect(await n.ws.versao()).toBeNull()
  })

  test('create-record-chapter', async () => {
    const m = await conectado()
    const p1 = m.ws.marcar('Episódio de teste 12:00:00')
    const p2 = m.ws.marcar('Episódio de teste 12:00:05')
    const [r1, r2] = m.ultimo().quadros().slice(-2)
    expect(r1).toEqual({ op: 6, d: { requestType: 'CreateRecordChapter', requestId: r1.d.requestId, requestData: { chapterName: 'Episódio de teste 12:00:00' } } })
    expect(r2.d.requestData).toEqual({ chapterName: 'Episódio de teste 12:00:05' })
    expect(r1.d.requestId).not.toBe(r2.d.requestId)
    m.ultimo().receber({ op: 7, d: { requestType: 'CreateRecordChapter', requestId: r2.d.requestId, requestStatus: { result: false, code: 501, comment: 'Output not running' } } })
    m.ultimo().receber({ op: 7, d: { requestType: 'CreateRecordChapter', requestId: r1.d.requestId, requestStatus: { result: true, code: 100 } } })
    expect(await p1).toBe(true)
    expect(await p2).toBe(false)
    // só `result === true` vale: sem `result`, texto "true" ou sem `requestStatus` → false
    for (const requestStatus of [{ code: 100 }, { result: 'true', code: 100 }, undefined]) {
      const p = m.ws.marcar('W')
      const pedido = m.ultimo().quadros().at(-1)!
      m.ultimo().receber({ op: 7, d: { requestType: 'CreateRecordChapter', requestId: pedido.d.requestId, requestStatus } })
      expect(await p).toBe(false)
    }
    // conexão cai com pedido pendente → false
    const p3 = m.ws.marcar('X')
    m.ultimo().fechar(1006)
    expect(await p3).toBe(false)
    expect(await m.ws.marcar('Y')).toBe(false)
    // pedido sem resposta em 5 s → false
    vi.useFakeTimers()
    const t = montar()
    const pc = t.ws.conectar({ porta: 4455, senha: SENHA })
    t.ultimo().receber(HELLO_SEM_SENHA)
    await vi.advanceTimersByTimeAsync(0)
    t.ultimo().receber({ op: 2, d: { negotiatedRpcVersion: 1 } })
    expect(await pc).toBe('conectado')
    let r: unknown = 'esperando'
    const pm = t.ws.marcar('Z').then((v) => (r = v))
    await vi.advanceTimersByTimeAsync(4999)
    expect(r).toBe('esperando')
    await vi.advanceTimersByTimeAsync(1)
    await pm
    expect(r).toBe(false)
  })

  test('queda-depois-de-conectado', async () => {
    const m = await conectado()
    expect(m.ws.conectado()).toBe(true)
    let avisos = 0
    let outro = 0
    m.ws.aoFechar(() => avisos++)
    const soltar = m.ws.aoFechar(() => outro++)
    soltar()
    const pendente = m.ws.marcar('X')
    m.ultimo().fechar(1006)
    expect(m.ws.conectado()).toBe(false)
    expect(avisos).toBe(1)
    expect(outro).toBe(0)
    expect(await pendente).toBe(false)
    expect(await m.ws.versao()).toBeNull()
    // reconectar no mesmo objeto volta a valer; `fechar()` de quem chama não avisa
    await conectado(m)
    expect(m.ws.conectado()).toBe(true)
    m.ws.fechar()
    expect(m.ws.conectado()).toBe(false)
    expect(avisos).toBe(1)
    // falha antes do Identified não avisa
    const n = montar()
    let avisosN = 0
    n.ws.aoFechar(() => avisosN++)
    const pn = n.ws.conectar({ porta: 4455, senha: SENHA })
    n.ultimo().fechar(4009)
    expect(await pn).toBe('senha_errada')
    expect(avisosN).toBe(0)
    expect(n.ws.conectado()).toBe(false)
  })

  test('ouvinte-de-queda-que-lanca', async () => {
    const m = await conectado()
    const chamados: string[] = []
    m.ws.aoFechar(() => {
      chamados.push('primeiro')
      throw new Error('ouvinte com defeito')
    })
    m.ws.aoFechar(() => chamados.push('segundo'))
    expect(() => m.ultimo().fechar(1006)).not.toThrow()
    expect(chamados).toEqual(['primeiro', 'segundo'])
    expect(m.ws.conectado()).toBe(false)
  })

  test('fechar-resolve-pendentes', async () => {
    vi.useFakeTimers()
    const m = montar()
    const pc = m.ws.conectar({ porta: 4455, senha: SENHA })
    m.ultimo().receber(HELLO_SEM_SENHA)
    await vi.advanceTimersByTimeAsync(0)
    m.ultimo().receber({ op: 2, d: { negotiatedRpcVersion: 1 } })
    expect(await pc).toBe('conectado')
    let versao: unknown = 'esperando'
    let marcado: unknown = 'esperando'
    const pv = m.ws.versao().then((v) => (versao = v))
    const pm = m.ws.marcar('X').then((v) => (marcado = v))
    m.ws.fechar()
    await vi.advanceTimersByTimeAsync(0)
    expect(versao).toBeNull()
    expect(marcado).toBe(false)
    await Promise.all([pv, pm])
    expect(m.ultimo().fechado).toBe(true)
  })

  test('nenhum-pedido-antes-do-identified', async () => {
    const m = montar()
    const p = m.ws.conectar({ porta: 4455, senha: SENHA })
    expect(await m.ws.versao()).toBeNull()
    m.ultimo().receber(HELLO_COM_SENHA)
    await esperar()
    expect(await m.ws.marcar('X')).toBe(false)
    expect(m.ws.conectado()).toBe(false)
    expect(m.ultimo().quadros().map((q) => q.op)).toEqual([1])
    m.ultimo().receber({ op: 2, d: { negotiatedRpcVersion: 1 } })
    expect(await p).toBe('conectado')
    void m.ws.versao()
    expect(m.ultimo().quadros().map((q) => q.op)).toEqual([1, 6])
  })

  test('senha-nunca-sai', async () => {
    const espioes = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((n) => vi.spyOn(console, n).mockImplementation(() => {}))
    const m = montar()
    const p = m.ws.conectar({ porta: 4455, senha: SENHA })
    m.ultimo().receber(HELLO_COM_SENHA)
    await esperar()
    m.ultimo().receber('não é json')
    m.ultimo().receber({ op: 99, d: null })
    m.ultimo().receber({ op: 2, d: { negotiatedRpcVersion: 1 } })
    expect(await p).toBe('conectado')
    void m.ws.versao()
    void m.ws.marcar('capítulo')
    m.ultimo().fechar(1006)
    // senha errada e sem Hello também
    const e = montar()
    const pe = e.ws.conectar({ porta: 4455, senha: SENHA })
    e.ultimo().receber(HELLO_COM_SENHA)
    await esperar()
    e.ultimo().fechar(4009)
    await pe
    const todos = [...m.sockets, ...e.sockets]
    expect(todos.flatMap((s) => s.enviados).some((q) => q.includes(SENHA))).toBe(false)
    expect(todos.flatMap((s) => s.enviados).some((q) => q.includes(sha256Base64(SENHA + SALT)))).toBe(false)
    for (const espiao of espioes) {
      for (const chamada of espiao.mock.calls) expect(JSON.stringify(chamada.map(String))).not.toContain(SENHA)
    }
    // o objeto não guarda a senha em nenhuma propriedade
    expect(JSON.stringify(m.ws)).not.toContain(SENHA)
  })
})
