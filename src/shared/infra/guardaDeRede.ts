/**
 * Guarda de rede do worker do reconhecedor de gestos (PLA-006, D8 e D9; revisão 1, I5 e N11; registro VER-063). Roda
 * **dentro** do worker, instalada pelo núcleo (`nucleoDoReconhecedor.ts`) antes de buscar qualquer arquivo e antes de
 * importar o MediaPipe. Só deixa passar a própria origem e `blob:` da própria origem pelos caminhos de rede que o worker
 * tem e que a fonte do `@mediapipe/tasks-vision` 1.2.3 usa ou poderia usar: `fetch` (a telemetria `POST
 * https://odml.pa.googleapis.com/v1/log` do registrador embutido, F6, e a busca do WASM pelo carregador), o
 * `XMLHttpRequest` do Emscripten, `importScripts` e `self.import` (o carregador `Mh` tenta `importScripts`, depois
 * `self.import`, depois `import()`, F4). `WebSocket` e `EventSource` lançam sempre (nenhum uso legítimo no worker). Fora
 * disso → `TypeError` antes de sair do aparelho. Desde a rodada 1 do VER-063 (N3), também `Worker`, `SharedWorker`,
 * `WebTransport` e `WebSocketStream` (sempre lançam) e `Cache.prototype.add`/`addAll` (só a própria origem): caminhos que
 * o worker tem e a fonte 1.2.3 não usa. Fica de fora o redirecionamento de uma URL da própria origem para fora (o
 * `fetch` segue `redirect: 'follow'`; Riscos do VER-063). O `import()` nativo não é interceptável: por isso o worker não tem
 * import estático do MediaPipe (I6) e a guarda define `self.import`, que o `Mh` prefere ao `import()`.
 */

/**
 * O pedaço do escopo do worker que a guarda troca. A `lib` do projeto não tem `WebWorker`: o worker passa `self` com
 * este tipo. Os opcionais faltam em alguns escopos (o teste usa um escopo falso).
 */
export interface EscopoDoWorker {
  fetch: typeof fetch
  XMLHttpRequest?: { prototype: { open: (...a: never[]) => void } }
  importScripts?: (...urls: string[]) => void
  import?: (url: string) => Promise<unknown>
  WebSocket?: unknown
  EventSource?: unknown
  /** Desde a rodada 1 do VER-063 (N3): construtores que sempre lançam, como `WebSocket` e `EventSource`. */
  Worker?: unknown
  SharedWorker?: unknown
  WebTransport?: unknown
  WebSocketStream?: unknown
  /** `Cache.prototype.add`/`addAll` buscam pela rede: só a própria origem (N3). */
  Cache?: { prototype: { add: (...a: never[]) => Promise<void>; addAll: (...a: never[]) => Promise<void> } }
}

/** A mensagem dos erros da guarda: fixa, sem a URL (nada da URL vai para erro, `console` ou contador; N11). */
const MENSAGEM = 'guarda de rede: só a própria origem'

const RequestDoAmbiente = (globalThis as { Request?: typeof Request }).Request

/** A origem normalizada (`https://host[:porta]`), ou `null` se não for uma origem de rede (falha fechada). */
function normalizarOrigem(origem: string): string | null {
  try {
    const o = new URL(origem).origin
    return o === 'null' ? null : o
  } catch {
    return null
  }
}

/**
 * O texto que o navegador usaria para a entrada: o `url` de um `Request` (imutável) ou o texto da entrada, lido **uma
 * vez** (um `toString` que muda entre a conferência e o uso não engana a guarda: quem chama recebe este mesmo texto).
 */
function textoDaEntrada(url: unknown): string {
  if (RequestDoAmbiente !== undefined && url instanceof RequestDoAmbiente) return url.url
  if (url instanceof URL) return url.href
  return String(url)
}

function textoPermitido(texto: string, origem: string): boolean {
  const propria = normalizarOrigem(origem)
  if (propria === null) return false
  let alvo: URL
  try {
    alvo = new URL(texto, propria)
  } catch {
    return false
  }
  // `blob:https://host/uuid` tem a origem do URL de dentro; `data:`, `ws:`, `file:`, `javascript:` → recusados
  if (alvo.protocol !== 'https:' && alvo.protocol !== 'http:' && alvo.protocol !== 'blob:') return false
  return alvo.origin === propria
}

/**
 * `true` só para a própria origem: resolve com `new URL(<url ou request.url>, origem)`; relativa (`/assets/x`,
 * `assets/x`) é da própria origem; `//host/x` é outra origem; `blob:` só com a mesma origem; `data:`, `ws:`, outro host,
 * outra porta ou outro protocolo → `false`. Origem inválida ou opaca → `false` para tudo.
 */
export function permitida(url: string | URL | Request, origem: string): boolean {
  return textoPermitido(textoDaEntrada(url), origem)
}

/** Troca a propriedade sem deixar desfazer (nem por atribuição nem por `defineProperty`). */
function travar(alvo: object, nome: string, valor: unknown): void {
  Object.defineProperty(alvo, nome, { value: valor, writable: false, configurable: false, enumerable: true })
}

const importarNativo = (url: string): Promise<unknown> => import(/* @vite-ignore */ url)

/**
 * Instala a guarda no escopo (uma vez por escopo: as propriedades ficam travadas). `fetch`, `XMLHttpRequest.prototype.open`,
 * `importScripts` e `self.import` passam por `permitida`; fora dela → `TypeError` (o `fetch` e o `import` rejeitam) sem
 * chamar o original. `self.import` sempre existe depois da guarda: embrulha o do escopo, se houver, ou o `import()`
 * nativo, com a URL já resolvida pela origem (o `import()` resolveria pelo endereço deste módulo). `WebSocket` e
 * `EventSource` viram construtores que lançam. `aoBloquear` é chamado sem argumentos uma vez por tentativa bloqueada.
 */
export function instalarGuardaDeRede(escopo: EscopoDoWorker, origem: string, aoBloquear: () => void = () => undefined): void {
  const bloquear = (): TypeError => {
    aoBloquear()
    return new TypeError(MENSAGEM)
  }

  const fetchOriginal = escopo.fetch
  const fetchGuardado = (entrada: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const ehPedido = RequestDoAmbiente !== undefined && entrada instanceof RequestDoAmbiente
    let texto: string
    try {
      texto = textoDaEntrada(entrada)
    } catch (e) {
      return Promise.reject(e) // uma entrada que nem vira texto (`toString` que lança): o `fetch` também rejeitaria
    }
    if (!textoPermitido(texto, origem)) return Promise.reject(bloquear())
    const alvo = ehPedido ? entrada : texto
    return init === undefined ? fetchOriginal.call(escopo, alvo) : fetchOriginal.call(escopo, alvo, init)
  }
  travar(escopo, 'fetch', fetchGuardado)

  const prototipo = escopo.XMLHttpRequest?.prototype
  if (prototipo !== undefined) {
    const abrirOriginal = prototipo.open as (this: unknown, ...a: unknown[]) => void
    travar(prototipo, 'open', function (this: unknown, metodo: unknown, url: unknown, ...resto: unknown[]): void {
      const texto = textoDaEntrada(url)
      if (!textoPermitido(texto, origem)) throw bloquear()
      abrirOriginal.call(this, metodo, texto, ...resto)
    })
  }

  const importScriptsOriginal = escopo.importScripts
  if (typeof importScriptsOriginal === 'function') {
    travar(escopo, 'importScripts', (...urls: unknown[]): void => {
      const textos = urls.map(textoDaEntrada)
      if (!textos.every((t) => textoPermitido(t, origem))) throw bloquear()
      importScriptsOriginal.apply(escopo, textos)
    })
  }

  const importarOriginal = typeof escopo.import === 'function' ? escopo.import.bind(escopo) : importarNativo
  travar(escopo, 'import', (url: unknown): Promise<unknown> => {
    const texto = textoDaEntrada(url)
    if (!textoPermitido(texto, origem)) return Promise.reject(bloquear())
    return importarOriginal(new URL(texto, normalizarOrigem(origem) ?? undefined).href)
  })

  const Bloqueado = class {
    constructor() {
      throw bloquear()
    }
  }
  for (const nome of ['WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'WebTransport', 'WebSocketStream'] as const)
    travar(escopo, nome, class extends Bloqueado {})

  const prototipoDoCache = escopo.Cache?.prototype
  if (prototipoDoCache !== undefined) {
    const adicionar = prototipoDoCache.add as (this: unknown, pedido: unknown) => Promise<void>
    const adicionarTodos = prototipoDoCache.addAll as (this: unknown, pedidos: unknown) => Promise<void>
    const entradaOuTexto = (entrada: unknown, texto: string): unknown =>
      RequestDoAmbiente !== undefined && entrada instanceof RequestDoAmbiente ? entrada : texto
    travar(prototipoDoCache, 'add', function (this: unknown, pedido: unknown): Promise<void> {
      let texto: string
      try {
        texto = textoDaEntrada(pedido)
      } catch (e) {
        return Promise.reject(e)
      }
      if (!textoPermitido(texto, origem)) return Promise.reject(bloquear())
      return adicionar.call(this, entradaOuTexto(pedido, texto))
    })
    travar(prototipoDoCache, 'addAll', function (this: unknown, pedidos: unknown): Promise<void> {
      let lista: unknown[]
      let textos: string[]
      try {
        lista = Array.from(pedidos as Iterable<unknown>)
        textos = lista.map(textoDaEntrada)
      } catch (e) {
        return Promise.reject(e)
      }
      if (!textos.every((t) => textoPermitido(t, origem))) return Promise.reject(bloquear())
      return adicionarTodos.call(this, lista.map((p, i) => entradaOuTexto(p, textos[i])))
    })
  }
}
