import type { ObsWebsocket } from '../../domains/obs/portas'

/*
 * obs-websocket v5 com o `WebSocket` nativo, sem biblioteca (D10; protocolo em
 * obsproject/obs-websocket, `docs/generated/protocol.md`, conferido no VER-039):
 * `Hello` (op 0) → `Identify` (op 1) → `Identified` (op 2) → `Request` (op 6) / `RequestResponse` (op 7);
 * fechamento `4009` (`AuthenticationFailed`) = senha errada.
 *
 * A senha só existe dentro de `conectar` até o `Hello` chegar; sai só como o hash de autenticação
 * (base64(SHA-256(base64(SHA-256(senha + salt)) + challenge))) para o OBS **local**
 * (`ws://127.0.0.1`). Nunca é guardada no objeto, enviada em claro nem passada a `console`.
 */

/** Tempo-limite do aperto de mão (sem `Hello`/`Identified`) e de cada pedido. */
export const ESPERA_DO_OBS_MS = 5000

/** O pedaço do `WebSocket` que o adaptador usa (o real serve; os testes passam um falso). */
export interface SocketDoObs {
  send(dados: string): void
  close(): void
  onmessage: ((e: MessageEvent) => void) | null
  onclose: ((e: CloseEvent) => void) | null
  onerror: ((e: Event) => void) | null
}

const FECHAMENTO_SENHA_ERRADA = 4009
const RPC_VERSAO = 1
const TAMANHO_DA_VERSAO = 40

async function sha256Base64(texto: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))
  return btoa(String.fromCharCode(...bytes))
}

type Objeto = Record<string, unknown>
const ehObjeto = (v: unknown): v is Objeto => typeof v === 'object' && v !== null && !Array.isArray(v)

function lerQuadro(dados: unknown): { op: number; d: Objeto } | null {
  if (typeof dados !== 'string') return null
  let o: unknown
  try {
    o = JSON.parse(dados)
  } catch {
    return null
  }
  if (!ehObjeto(o) || typeof o.op !== 'number' || !ehObjeto(o.d)) return null
  return { op: o.op, d: o.d }
}

type Resposta = { ok: boolean; dados: Objeto | null }

export function criarObsWebsocket(criarSocket: (url: string) => SocketDoObs = (url) => new WebSocket(url, 'obswebsocket.json')): ObsWebsocket {
  let socket: SocketDoObs | null = null
  let identificado = false
  let proximoPedido = 0
  /** Termina como `sem_conexao` a conexão que ainda espera o `Identified` (usado por `fechar`). */
  let cancelarConexao: (() => void) | null = null
  const pendentes = new Map<string, (r: Resposta | null) => void>()
  const aoFecharOuvintes = new Set<() => void>()

  function encerrarPendentes(): void {
    for (const resolver of pendentes.values()) resolver(null)
    pendentes.clear()
  }

  function desligar(s: SocketDoObs): void {
    s.onmessage = null
    s.onclose = null
    s.onerror = null
    try {
      s.close()
    } catch {
      // já fechado
    }
  }

  function pedir(requestType: string, requestData?: Objeto): Promise<Resposta | null> {
    const s = socket
    if (s === null || !identificado) return Promise.resolve(null)
    const requestId = `revocast-${++proximoPedido}`
    return new Promise<Resposta | null>((resolver) => {
      const limite = setTimeout(() => terminar(null), ESPERA_DO_OBS_MS)
      function terminar(r: Resposta | null) {
        clearTimeout(limite)
        pendentes.delete(requestId)
        resolver(r)
      }
      pendentes.set(requestId, terminar)
      try {
        s.send(JSON.stringify({ op: 6, d: requestData === undefined ? { requestType, requestId } : { requestType, requestId, requestData } }))
      } catch {
        terminar(null)
      }
    })
  }

  function fechar(): void {
    const s = socket
    socket = null
    identificado = false
    encerrarPendentes()
    const cancelar = cancelarConexao
    cancelarConexao = null
    cancelar?.()
    if (s !== null) desligar(s)
  }

  return {
    conectar({ porta, senha }) {
      fechar()
      return new Promise((resolver) => {
        let s: SocketDoObs
        try {
          s = criarSocket(`ws://127.0.0.1:${porta}`)
        } catch {
          resolver('sem_conexao')
          return
        }
        socket = s
        let segredo: string | null = senha
        let terminado = false
        const limite = setTimeout(() => terminar('sem_conexao'), ESPERA_DO_OBS_MS)
        const cancelar = () => terminar('sem_conexao')
        cancelarConexao = cancelar
        function terminar(r: 'conectado' | 'senha_errada' | 'sem_conexao') {
          if (terminado) return
          terminado = true
          segredo = null
          clearTimeout(limite)
          if (cancelarConexao === cancelar) cancelarConexao = null
          if (r !== 'conectado' && socket === s) fechar()
          resolver(r)
        }
        s.onerror = () => terminar('sem_conexao')
        s.onclose = (e) => {
          if (socket === s) {
            const estavaIdentificado = identificado
            socket = null
            identificado = false
            encerrarPendentes()
            if (estavaIdentificado) {
              for (const f of [...aoFecharOuvintes]) {
                try {
                  f()
                } catch {
                  // um ouvinte com erro não impede os outros
                }
              }
            }
          }
          terminar(e.code === FECHAMENTO_SENHA_ERRADA ? 'senha_errada' : 'sem_conexao')
        }
        s.onmessage = (e) => {
          const q = lerQuadro(e.data)
          if (q === null || socket !== s) return
          if (q.op === 0 && !terminado && segredo !== null) {
            const senhaDoHello = segredo
            segredo = null
            const auth = q.d.authentication
            const identify = async () => {
              const d: Objeto = { rpcVersion: RPC_VERSAO }
              if (ehObjeto(auth) && typeof auth.challenge === 'string' && typeof auth.salt === 'string') {
                d.authentication = await sha256Base64((await sha256Base64(senhaDoHello + auth.salt)) + auth.challenge)
              }
              d.eventSubscriptions = 0
              if (socket === s && !terminado) s.send(JSON.stringify({ op: 1, d }))
            }
            identify().catch(() => terminar('sem_conexao'))
          } else if (q.op === 2 && !terminado) {
            identificado = true
            terminar('conectado')
          } else if (q.op === 7 && typeof q.d.requestId === 'string') {
            const resolverPedido = pendentes.get(q.d.requestId)
            if (resolverPedido === undefined) return
            const status = q.d.requestStatus
            resolverPedido({ ok: ehObjeto(status) && status.result === true, dados: ehObjeto(q.d.responseData) ? q.d.responseData : null })
          }
        }
      })
    },
    async versao() {
      const r = await pedir('GetVersion')
      const v = r?.ok ? r.dados?.obsVersion : null
      return typeof v === 'string' && v.length <= TAMANHO_DA_VERSAO ? v : null
    },
    async marcar(nome) {
      const r = await pedir('CreateRecordChapter', { chapterName: nome })
      return r?.ok === true
    },
    conectado: () => socket !== null && identificado,
    aoFechar(f) {
      aoFecharOuvintes.add(f)
      return () => {
        aoFecharOuvintes.delete(f)
      }
    },
    fechar,
  }
}
