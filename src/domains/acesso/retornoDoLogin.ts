/** Parâmetros que o Supabase Auth acrescenta à URL de retorno do login Google (PKCE). */
export const PARAMETROS_DE_RETORNO = ['code', 'sb_flow_id', 'error', 'error_code', 'error_description'] as const

/**
 * Resumo do retorno do login. `erro` vem só do código do erro, nunca do `error_description`
 * (texto controlado por quem montou o link; a tela mostra só mensagens fixas). `sujo` e
 * `fragmentoSujo` dizem se a busca ou o fragmento têm parâmetros de retorno a limpar.
 */
export interface RetornoDoLogin {
  erro: 'cancelado' | 'falha' | null
  temCodigo: boolean
  sujo: boolean
  fragmentoSujo: boolean
}

export const SEM_RETORNO: RetornoDoLogin = { erro: null, temCodigo: false, sujo: false, fragmentoSujo: false }

const PARAMETROS_DE_ERRO = ['error', 'error_code', 'error_description'] as const

function lerErro(parametros: URLSearchParams): RetornoDoLogin['erro'] {
  if (parametros.get('error') === 'access_denied') return 'cancelado'
  return PARAMETROS_DE_ERRO.some((p) => parametros.has(p)) ? 'falha' : null
}

function temRetorno(parametros: URLSearchParams): boolean {
  return PARAMETROS_DE_RETORNO.some((p) => parametros.has(p))
}

/**
 * Lê `location.search` e `location.hash` (só nas rotas de membro: nas de dispositivo o fragmento
 * é do código de pareamento). O código PKCE só vale na busca; o erro pode vir em qualquer um dos
 * dois (o GoTrue usa o fragmento quando não identifica o fluxo), com a busca tendo prioridade.
 */
export function lerRetornoDoLogin(busca: string, fragmento: string): RetornoDoLogin {
  const naBusca = new URLSearchParams(busca.startsWith('?') ? busca.slice(1) : busca)
  const noFragmento = new URLSearchParams(fragmento.startsWith('#') ? fragmento.slice(1) : fragmento)
  const sujo = temRetorno(naBusca)
  const fragmentoSujo = temRetorno(noFragmento)
  if (!sujo && !fragmentoSujo) return SEM_RETORNO
  return {
    erro: lerErro(naBusca) ?? lerErro(noFragmento),
    temCodigo: naBusca.has('code'),
    sujo,
    fragmentoSujo,
  }
}
