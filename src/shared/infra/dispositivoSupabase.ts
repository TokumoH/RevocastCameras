import type { SupabaseClient } from '@supabase/supabase-js'
import { COLUNAS_DE_MEU_DISPOSITIVO } from '../../domains/acesso/dispositivos'
import type { TipoDeDispositivo } from '../../domains/acesso/dispositivos'
import { ErroDeDispositivo } from '../../domains/acesso/portasDeDispositivo'
import type { MotivoDoDispositivo, ServicoDeDispositivo } from '../../domains/acesso/portasDeDispositivo'
import { classificarErro } from './errosSupabase'

/** Texto fixo do aviso de `sair()` (o mesmo da E1): nunca leva token, sessão nem o objeto de erro. */
const AVISO_SAIR = 'sair: o servidor não confirmou a saída; a sessão local foi apagada'

const TIPOS: readonly TipoDeDispositivo[] = ['camera', 'obs_palco', 'obs_camera']
const RESULTADOS = ['pareado', 'invalido', 'tipo_errado', 'limite'] as const
type ResultadoDoPareamento = (typeof RESULTADOS)[number]

/** Erro do PostgREST → motivo do dispositivo: só `negado` (`42501`) e `rede` (falha do `fetch`) têm tela própria. */
function motivoDoPostgrest(erro: { code?: string } | null, status: number | undefined): MotivoDoDispositivo {
  const motivo = classificarErro(erro, status)
  return motivo === 'negado' || motivo === 'rede' ? motivo : 'outro'
}

/** Aguarda o `rpc` e traduz todo erro (devolvido ou lançado) para `ErroDeDispositivo`; a mensagem do servidor não sai daqui. */
async function chamarRpc(promessa: () => PromiseLike<{ data: unknown; error: { code?: string } | null; status: number }>): Promise<unknown> {
  let resposta: { data: unknown; error: { code?: string } | null; status: number }
  try {
    resposta = await promessa()
  } catch {
    throw new ErroDeDispositivo('outro')
  }
  if (resposta.error) throw new ErroDeDispositivo(motivoDoPostgrest(resposta.error, resposta.status))
  return resposta.data
}

/** Primeira linha de uma função `returns table` (o PostgREST devolve uma lista). */
function primeiraLinha(data: unknown): Record<string, unknown> | null {
  if (!Array.isArray(data) || data.length === 0) return null
  const linha: unknown = data[0]
  return typeof linha === 'object' && linha !== null && !Array.isArray(linha) ? (linha as Record<string, unknown>) : null
}

/**
 * Login anônimo recusado: login anônimo desligado no projeto (o Auth responde 422,
 * `anonymous_provider_disabled`, "Anonymous sign-ins are disabled") → `negado`; sem resposta
 * (`AuthRetryableFetchError`, status 0) → `rede`; o resto (por exemplo, o limite por IP, 429) → `outro`.
 */
function motivoDoLoginAnonimo(erro: { name?: unknown; status?: unknown; code?: unknown; message?: unknown }): MotivoDoDispositivo {
  if (erro.status === 422 || erro.code === 'anonymous_provider_disabled') return 'negado'
  if (typeof erro.message === 'string' && /anonymous sign-ins are disabled/i.test(erro.message)) return 'negado'
  if (erro.name === 'AuthRetryableFetchError' || erro.status === 0) return 'rede'
  return 'outro'
}

/**
 * Adaptador da porta `ServicoDeDispositivo` (E3, D4) sobre o cliente Supabase **do tipo** do
 * dispositivo (`storageKey` `revocast-auth-<tipo>`). Não cria cliente nem decide acesso: quem nega
 * é o banco (`parear_dispositivo` só para sessão anônima; `meu_dispositivo` só devolve a linha da
 * própria sessão). O código de pareamento só passa pelo corpo do `rpc` e nunca vai para `console`
 * nem para a mensagem de um erro.
 */
export function criarServicoDeDispositivoSupabase(cliente: SupabaseClient): ServicoDeDispositivo {
  return {
    async sessaoAtual() {
      let resultado: Awaited<ReturnType<typeof cliente.auth.getSession>>
      try {
        resultado = await cliente.auth.getSession()
      } catch {
        throw new ErroDeDispositivo('rede')
      }
      // Com a sessão expirada e a rede caída o auth-js devolve session: null E error, mas a sessão
      // continua guardada (VER-017): tratar como "sem sessão" faria o aparelho sair e perder o pareamento.
      if (resultado.error) throw new ErroDeDispositivo('rede')
      const u = resultado.data.session?.user
      if (!u) return null
      return { usuarioId: u.id, anonima: u.is_anonymous === true }
    },

    async entrarAnonimo() {
      let resultado: Awaited<ReturnType<typeof cliente.auth.signInAnonymously>>
      try {
        resultado = await cliente.auth.signInAnonymously()
      } catch {
        throw new ErroDeDispositivo('rede')
      }
      if (resultado.error) throw new ErroDeDispositivo(motivoDoLoginAnonimo(resultado.error))
      const id = resultado.data.user?.id
      if (typeof id !== 'string') throw new ErroDeDispositivo('outro')
      return { usuarioId: id }
    },

    async parear(codigo, tipo) {
      const data = await chamarRpc(() => cliente.rpc('parear_dispositivo', { p_codigo: codigo, p_tipo: tipo }))
      const linha = primeiraLinha(data)
      const resultado = linha?.resultado
      if (!RESULTADOS.includes(resultado as ResultadoDoPareamento)) return { resultado: 'invalido', dispositivo: null }
      const id = linha?.dispositivo
      const rotulo = linha?.nome
      const dispositivo = resultado === 'pareado' && typeof id === 'string' && typeof rotulo === 'string' ? { id, rotulo } : null
      return { resultado: resultado as ResultadoDoPareamento, dispositivo }
    },

    async dispositivoAtual() {
      // Nunca rpc('dispositivo_atual'): ela não devolve o rótulo (D4, I2).
      const linha = primeiraLinha(await chamarRpc(() => cliente.rpc('meu_dispositivo')))
      if (linha === null) return null
      const [colunaId, colunaTipo, colunaRotulo, colunaCamera] = COLUNAS_DE_MEU_DISPOSITIVO
      const id = linha[colunaId]
      const tipo = linha[colunaTipo]
      const rotulo = linha[colunaRotulo]
      const camera = linha[colunaCamera]
      if (typeof id !== 'string' || typeof rotulo !== 'string' || !TIPOS.includes(tipo as TipoDeDispositivo)) return null
      return { id, tipo: tipo as TipoDeDispositivo, rotulo, cameraId: typeof camera === 'string' ? camera : null }
    },

    async sair() {
      // scope 'local': o auth-js apaga a sessão deste navegador antes de pedir a revogação ao servidor;
      // um erro aqui é só do servidor. Nunca lança.
      try {
        const { error } = await cliente.auth.signOut({ scope: 'local' })
        if (error) console.warn(AVISO_SAIR)
      } catch {
        console.warn(AVISO_SAIR)
      }
    },
  }
}
