/**
 * Tempo-limite das chamadas do supabase-js ao PostgREST (`/rest/v1/`) e ao Auth (`/auth/v1/`): 15 s.
 * Uma chamada sem resposta (rede que não responde nem dá erro) vira erro de rede, que o app já trata
 * (`traduzirErro` → `rede`; `usuarioAtual` → `ErroDeAcesso('rede')`; tela de falha com "Tentar de novo").
 * Sem isso, uma avaliação de acesso presa segurava a fila de `useAcesso` até recarregar a página (VER-020).
 * 15 s: folga para uma rede móvel ruim responder um `rpc` ou um refresh de token, e curto o bastante para
 * a pessoa ver a tela de falha antes de desistir.
 */
export const TEMPO_LIMITE_SUPABASE_MS = 15_000

/** Caminhos com tempo-limite. O Storage (`/storage/v1/`) fica fora: envios de até 50 MB na E2 (DES-001 §15). */
const CAMINHOS_LIMITADOS = ['/rest/v1', '/auth/v1']

function urlDaEntrada(entrada: RequestInfo | URL): string {
  if (typeof entrada === 'string') return entrada
  if (entrada instanceof URL) return entrada.href
  return entrada.url
}

/**
 * Regra de quais URLs têm tempo-limite: mesma origem do projeto (`supabaseUrl`, já validado por
 * `lerConfiguracao`) e caminho `/rest/v1` ou `/auth/v1` (ou abaixo deles). Storage, Functions,
 * Realtime (o `fetch` do Realtime só serve ao broadcast por REST) e outros hosts não têm.
 */
export function limitarRestEAuth(supabaseUrl: string): (url: string) => boolean {
  const origem = new URL(supabaseUrl).origin
  return (url) => {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return false
    }
    if (u.origin !== origem) return false
    return CAMINHOS_LIMITADOS.some((c) => u.pathname === c || u.pathname.startsWith(`${c}/`))
  }
}

/**
 * Envolve um `fetch`: para as URLs em que `deveLimitar` é verdadeiro, aborta a chamada depois de `ms`
 * milissegundos com um `DOMException` `TimeoutError` (o mesmo nome do `AbortSignal.timeout`). O sinal de
 * quem chama (de `init.signal` ou do `Request`) continua abortando, com o motivo dele. O timer e o ouvinte
 * do sinal do chamador são soltos quando o `fetch` termina (resposta, erro ou abort): sem vazamento.
 *
 * Feito com `AbortController` + `setTimeout`, e não com `AbortSignal.any`/`AbortSignal.timeout`: funciona
 * em navegadores sem `AbortSignal.any` (Safari < 17.4) e os testes controlam o tempo com timers falsos.
 * O tempo-limite cobre até a chegada dos cabeçalhos da resposta; a leitura do corpo não é limitada
 * (como o `timeout` do próprio `postgrest-js`).
 */
export function fetchComTempoLimite(
  fetchBase: typeof fetch,
  ms: number,
  deveLimitar: (url: string) => boolean,
): typeof fetch {
  return (entrada, init) => {
    if (!deveLimitar(urlDaEntrada(entrada))) return fetchBase(entrada, init)

    const sinalDoChamador = init?.signal ?? (entrada instanceof Request ? entrada.signal : null)
    if (sinalDoChamador?.aborted) return fetchBase(entrada, init)

    const controlador = new AbortController()
    const aoAbortarChamador = () => controlador.abort(sinalDoChamador?.reason)
    sinalDoChamador?.addEventListener('abort', aoAbortarChamador, { once: true })
    const timer = setTimeout(() => {
      controlador.abort(new DOMException(`Sem resposta do Supabase em ${ms} ms`, 'TimeoutError'))
    }, ms)
    const soltar = () => {
      clearTimeout(timer)
      sinalDoChamador?.removeEventListener('abort', aoAbortarChamador)
    }

    let resposta: Promise<Response>
    try {
      resposta = fetchBase(entrada, { ...init, signal: controlador.signal })
    } catch (erro) {
      soltar()
      return Promise.reject(erro)
    }
    return resposta.finally(soltar)
  }
}
