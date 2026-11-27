import type { SupabaseClient } from '@supabase/supabase-js'
import { ErroDePreparacao } from '../../domains/preparacao/portas'
import type { ArmazenamentoDeMidia, MotivoDaPreparacao, OpcoesDoEnvio } from '../../domains/preparacao/portas'

/** O bucket privado da Biblioteca (migração `biblioteca_storage`, D3 e D4 do PLA-003). */
export const BUCKET_DE_MIDIAS = 'midias'

/**
 * Corte por **inatividade** do envio (D8): 30 s sem evento de progresso enquanto os bytes sobem.
 * Não é tempo total, que cortaria um envio grande e saudável numa rede lenta.
 */
export const INATIVIDADE_DO_ENVIO_MS = 30_000

/** Validade da URL assinada da prévia: 10 min (curta; a tela pede outra se precisar). */
export const VALIDADE_DA_PREVIA_S = 600

/**
 * Só o caminho que o domínio gera (`caminhoDaMidia`): `som/<uuid>.(mp3|wav|ogg|m4a)` ou
 * `imagem/<uuid>.(png|jpg|webp|gif)`, uuid em minúsculas, a mesma forma da política de envio da
 * migração `biblioteca_storage`. Recusa `.`/`..`, subpasta, outra pasta e extensão trocada (defesa em
 * profundidade: o `URL` normalizaria `imagem/../../outro/x.png` para fora do bucket).
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const CAMINHO_SEGURO = new RegExp(`^(som/${UUID}\\.(mp3|wav|ogg|m4a)|imagem/${UUID}\\.(png|jpg|webp|gif))$`)

/** Código HTTP (ou o `statusCode` do Storage) → motivo da Preparação. */
function motivoDoCodigo(codigo: string): MotivoDaPreparacao {
  if (codigo === '401') return 'sessao_expirada'
  if (codigo === '403') return 'negado'
  if (codigo === '409') return 'duplicado'
  if (['400', '413', '415', '422'].includes(codigo)) return 'invalido'
  return 'outro'
}

/**
 * JWT inválido ou expirado: o Storage o recusa com `error` (ou `code`) `InvalidJWT` no corpo, e o
 * `statusCode` pode vir "400" ou "403" (VER-032). Decide só pelo nome do erro, sem diferenciar maiúsculas;
 * a `message` é texto livre e nunca decide.
 */
function ehJwtInvalido(valor: unknown): boolean {
  return typeof valor === 'string' && valor.toLowerCase() === 'invalidjwt'
}

/**
 * Lê a resposta de erro do Storage: primeiro o JWT inválido (`error` ou `code` `InvalidJWT` do corpo →
 * `sessao_expirada`, com prioridade sobre o resto), depois o `statusCode` **texto, não vazio** do corpo JSON
 * (o Storage costuma responder 400 com `statusCode` "403", "409" ou "413" no corpo; é o caso que o
 * `storage-js` 2.119.0 recebe em `dist/index.mjs`, linha 326), depois o status HTTP. Diferente do SDK
 * (`statusCode || code || status`), o `code` do corpo só conta quando é `InvalidJWT`, para não esconder o
 * status HTTP; um `statusCode` de outro tipo é ignorado. O texto do corpo nunca sai daqui.
 */
export function motivoDaResposta(status: number, corpo: string): MotivoDaPreparacao {
  let codigo = String(status)
  try {
    const json: unknown = JSON.parse(corpo)
    if (json && typeof json === 'object') {
      if (('error' in json && ehJwtInvalido(json.error)) || ('code' in json && ehJwtInvalido(json.code))) return 'sessao_expirada'
      if ('statusCode' in json && typeof json.statusCode === 'string' && json.statusCode !== '') codigo = json.statusCode
    }
  } catch {
    /* corpo vazio ou não JSON: fica o status HTTP */
  }
  return ehJwtInvalido(codigo) ? 'sessao_expirada' : motivoDoCodigo(codigo)
}

/**
 * Erro devolvido (ou lançado) pelo `storage-js` em `remove` e `createSignedUrl`: `StorageUnknownError`
 * é a falha do `fetch` → `rede`; `StorageApiError` traz `code` e `statusCode` (do corpo) e `status` (HTTP):
 * `InvalidJWT` em `code` ou `statusCode` (o SDK põe o `code` no `statusCode` quando o corpo não traz um)
 * → `sessao_expirada`, depois `statusCode` e `status`, na mesma ordem de `motivoDaResposta`; qualquer
 * outra coisa → `outro`. O SDK descarta o campo `error` do corpo; a `message` não decide.
 */
function motivoDoStorage(erro: unknown): MotivoDaPreparacao {
  if (!erro || typeof erro !== 'object') return 'outro'
  const e = erro as { name?: unknown; status?: unknown; statusCode?: unknown; code?: unknown; error?: unknown }
  if (e.name === 'StorageUnknownError') return 'rede'
  if (ehJwtInvalido(e.code) || ehJwtInvalido(e.error) || ehJwtInvalido(e.statusCode)) return 'sessao_expirada'
  if (typeof e.statusCode === 'string' && e.statusCode !== '') return motivoDoCodigo(e.statusCode)
  if (typeof e.status === 'number') return motivoDoCodigo(String(e.status))
  return 'outro'
}

/**
 * Adaptador da porta `ArmazenamentoDeMidia` (D8 do PLA-003). O envio é um `XMLHttpRequest` próprio, com
 * progresso, cancelamento e corte por inatividade (o `upload()` do `storage-js` 2.119.0 não aceita
 * `AbortSignal` nem informa progresso), e por isso não passa pelo `fetch` com tempo-limite de 15 s do
 * cliente (que nem alcança `/storage/v1/`). Remoção e prévia usam o `storage-js` do mesmo cliente.
 * Nada aqui registra token, sessão ou URL assinada em `console`.
 */
export function criarArmazenamentoSupabase(
  cliente: SupabaseClient,
  supabaseUrl: string,
  chavePublica: string,
  criarXhr: () => XMLHttpRequest = () => new XMLHttpRequest(),
): ArmazenamentoDeMidia {
  const origem = new URL(supabaseUrl).origin // sem barra no fim: nunca `//storage`

  /** O `access_token` lido **na hora** de cada envio (o auth-js renova a sessão); nunca guardado. */
  async function tokenAtual(): Promise<string> {
    let resultado: Awaited<ReturnType<typeof cliente.auth.getSession>>
    try {
      resultado = await cliente.auth.getSession()
    } catch {
      throw new ErroDePreparacao('rede')
    }
    // Com erro (por exemplo, sessão expirada e rede caída), não confiar no token que vier junto.
    if (resultado.error) throw new ErroDePreparacao('rede')
    const jwt = resultado.data.session?.access_token
    if (!jwt) throw new ErroDePreparacao('sessao_expirada')
    return jwt
  }

  async function enviar(caminho: string, corpo: Blob, mime: string, { aoProgredir, sinal }: OpcoesDoEnvio): Promise<void> {
    if (!CAMINHO_SEGURO.test(caminho)) throw new Error('caminho inválido') // o domínio já gera assim; defesa em profundidade
    if (sinal.aborted) throw new ErroDePreparacao('cancelado')
    const token = await tokenAtual()
    // A pessoa pode ter cancelado durante o await: o evento 'abort' já passou e o ouvinte abaixo nunca o veria.
    if (sinal.aborted) throw new ErroDePreparacao('cancelado')

    await new Promise<void>((resolver, rejeitar) => {
      let xhr: XMLHttpRequest | undefined
      let terminou = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const pararCorte = () => {
        if (timer !== undefined) clearTimeout(timer)
        timer = undefined
      }
      // Guarda de fim único: um evento depois do corte, do cancelamento ou da resposta não muda nada.
      const acabar = (erro?: ErroDePreparacao) => {
        if (terminou) return
        terminou = true
        pararCorte()
        sinal.removeEventListener('abort', cancelar)
        if (erro) rejeitar(erro)
        else resolver()
      }
      // Primeiro decide o fim, depois aborta: o `abort()` do navegador dispara eventos na hora.
      const interromper = (motivo: MotivoDaPreparacao) => {
        acabar(new ErroDePreparacao(motivo))
        xhr?.abort()
      }
      const armarCorte = () => {
        pararCorte()
        timer = setTimeout(() => interromper('sem_resposta'), INATIVIDADE_DO_ENVIO_MS)
      }
      function cancelar() {
        interromper('cancelado')
      }

      sinal.addEventListener('abort', cancelar, { once: true })
      try {
        const x = criarXhr()
        xhr = x
        x.upload.onprogress = (e) => {
          if (terminou) return
          armarCorte()
          if (e.lengthComputable && e.total > 0) aoProgredir(e.loaded / e.total)
        }
        // Bytes todos enviados: daí em diante, só a resposta, a rede ou o "Cancelar" terminam a espera.
        x.upload.onload = pararCorte
        x.onload = () => {
          if (x.status >= 200 && x.status < 300) acabar()
          else acabar(new ErroDePreparacao(motivoDaResposta(x.status, x.responseText)))
        }
        x.onerror = () => acabar(new ErroDePreparacao('rede'))
        x.open('POST', `${origem}/storage/v1/object/${BUCKET_DE_MIDIAS}/${caminho}`)
        x.setRequestHeader('authorization', `Bearer ${token}`)
        x.setRequestHeader('apikey', chavePublica)
        x.setRequestHeader('x-upsert', 'false') // D5: nunca sobrescreve
        x.setRequestHeader('cache-control', 'max-age=3600')
        x.setRequestHeader('content-type', mime) // o tipo detectado pelos bytes, nunca o `type` do navegador
        armarCorte()
        x.send(corpo)
      } catch {
        // XHR que não abre ou não envia: nada fica pendurado (ouvinte, timer) e o erro tem motivo.
        interromper('outro')
      }
    })
  }

  return {
    enviar,

    async remover(caminho) {
      let resposta: Awaited<ReturnType<ReturnType<typeof cliente.storage.from>['remove']>>
      try {
        resposta = await cliente.storage.from(BUCKET_DE_MIDIAS).remove([caminho])
      } catch (e) {
        throw new ErroDePreparacao(motivoDoStorage(e))
      }
      // Remover um caminho que não existe não dá erro no Storage (a porta conta com isso, D6).
      if (resposta.error) throw new ErroDePreparacao(motivoDoStorage(resposta.error))
    },

    async urlDePrevia(caminho) {
      let resposta: Awaited<ReturnType<ReturnType<typeof cliente.storage.from>['createSignedUrl']>>
      try {
        resposta = await cliente.storage.from(BUCKET_DE_MIDIAS).createSignedUrl(caminho, VALIDADE_DA_PREVIA_S)
      } catch (e) {
        throw new ErroDePreparacao(motivoDoStorage(e))
      }
      if (resposta.error) throw new ErroDePreparacao(motivoDoStorage(resposta.error))
      const url = resposta.data?.signedUrl
      if (!url) throw new ErroDePreparacao('outro')
      return url
    },
  }
}
