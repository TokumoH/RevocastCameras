import type { SupabaseClient } from '@supabase/supabase-js'
import { COLUNAS_DE_MEU_DISPOSITIVO } from '../../domains/acesso/dispositivos'
import type { TipoDeDispositivo } from '../../domains/acesso/dispositivos'
import { ErroDeDispositivo } from '../../domains/acesso/portasDeDispositivo'
import type { MotivoDoDispositivo, ServicoDeDispositivo } from '../../domains/acesso/portasDeDispositivo'
import { ehGesto } from '../../domains/captura/gestos'
import type { RespostaDoGesto } from '../../domains/captura/gestos'
import type { RepositorioDosGestos } from '../../domains/captura/portas'
import { ehUuid } from '../../domains/captura/sinais'
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

/** O que `enviar_gesto` devolve sem erro (nada publicado, exceto `enviado`), igual na porta (PLA-006, D2). */
const RESPOSTAS_DO_GESTO: readonly RespostaDoGesto[] = ['enviado', 'intervalo', 'desligados', 'sem_palco']

/**
 * Erro de `enviar_gesto` → resposta (PLA-006, D2; revisão 1, N3): `54000` (600 por hora por remetente) → `limite`;
 * `42501` (não é câmera nem `obs_camera`, ou não é o aparelho que reconhece, ou a sessão caiu) e `55000` (sem episódio
 * ativo, ou a câmera do par revogada) → `negado` (o laço para e a rota reavalia); qualquer outro (`22023`, `22P02`, JWT,
 * rede, o tempo-limite de 15 s do `fetch`, VER-021) → `falhou`. Só o código decide; a mensagem do servidor não sai daqui.
 */
function respostaDoErroDoGesto(codigo: string | undefined): RespostaDoGesto {
  if (codigo === '54000') return 'limite'
  return codigo === '42501' || codigo === '55000' ? 'negado' : 'falhou'
}

/**
 * Adaptador da porta `RepositorioDosGestos` (PLA-006, D2, D5, D8) sobre o cliente do tipo do aparelho que reconhece
 * (`camera` ou `obs_camera`). Quem decide é o banco (sessão, episódio ativo, interruptor, aparelho que reconhece,
 * intervalo e limite, a cada chamada): o adaptador só traduz.
 * - `enviar`: a `rpc('enviar_gesto')` recebe **exatamente** `{ p_id, p_gesto }` (D8: nenhum quadro, ponto da mão,
 *   confiança ou outro campo sai do aparelho; o objeto é montado aqui, nunca espalhado). Id fora de uuid minúsculo ou
 *   gesto fora dos 7 → `falhou` sem chamar o banco. Nunca pelo Broadcast (o tópico de gestos é só de recebimento).
 * - `situacao`: `situacao_dos_gestos()`; forma errada → a promessa falha (`ErroDeDispositivo('outro')`), e a rota a trata
 *   como `{ ligados: false, reconhecerAqui: false }` (Tarefa 8); `42501` com 403 → `negado` (com 401, `outro`: a sessão
 *   expirada vem antes na classificação comum); falha do `fetch` → `rede`.
 */
export function criarRepositorioDosGestosSupabase(cliente: SupabaseClient): RepositorioDosGestos {
  return {
    async situacao() {
      const linha = primeiraLinha(await chamarRpc(() => cliente.rpc('situacao_dos_gestos')))
      const ligados = linha?.ligados
      const reconhecerAqui = linha?.reconhecer_aqui
      if (typeof ligados !== 'boolean' || typeof reconhecerAqui !== 'boolean') throw new ErroDeDispositivo('outro')
      return { ligados, reconhecerAqui }
    },

    async enviar(g) {
      if (!ehUuid(g.id) || !ehGesto(g.gesto)) return 'falhou'
      let resposta: { data: unknown; error: { code?: string } | null }
      try {
        resposta = await cliente.rpc('enviar_gesto', { p_id: g.id, p_gesto: g.gesto })
      } catch {
        return 'falhou'
      }
      if (resposta.error) return respostaDoErroDoGesto(resposta.error.code)
      return RESPOSTAS_DO_GESTO.includes(resposta.data as RespostaDoGesto) ? (resposta.data as RespostaDoGesto) : 'falhou'
    },
  }
}
