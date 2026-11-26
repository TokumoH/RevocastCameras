import { useCallback, useEffect, useRef, useState } from 'react'
import type { Area } from '../domains/acesso/papeis'
import type { ServicosDeMembro } from '../domains/acesso/portas'
import { resolverAcesso } from '../domains/acesso/resolverAcesso'
import { lerRetornoDoLogin, SEM_RETORNO } from '../domains/acesso/retornoDoLogin'
import type { RetornoDoLogin } from '../domains/acesso/retornoDoLogin'
import { combinarEstados } from '../domains/acesso/sessao'
import type { EstadoDeAcesso } from '../domains/acesso/sessao'
import { ErroDeConfiguracao } from '../shared/infra/configuracao'
import { urlDeRetorno } from './dependencias'
import type { Dependencias } from './dependencias'

export type EstadoDaTela =
  | EstadoDeAcesso
  | { tipo: 'erro_de_configuracao'; mensagem: string }
  | { tipo: 'erro_inesperado' }

/**
 * `primeira`: com o retorno da URL, aplicada direto; `automatica` (evento de sessão, volta à aba, escrita
 * negada): `SEM_RETORNO` e `combinarEstados`; `acao` (Tentar de novo): `SEM_RETORNO`, aplicada direto.
 */
type TipoDeAvaliacao = 'primeira' | 'automatica' | 'acao'

/** Estado de uma montagem do hook. Cada montagem tem o seu (o StrictMode monta duas vezes em dev). */
interface Montagem {
  ativo: boolean
  servicos: ServicosDeMembro | null
  retorno: RetornoDoLogin
  /** Último estado aplicado por esta montagem (o `atual` de `combinarEstados`). */
  estado: EstadoDaTela
  /** Quantos estados esta montagem já aplicou (o `catch` da fila só põe `falha` se a tarefa não aplicou nada). */
  aplicacoes: number
  /** Fila das avaliações e ações: cada uma começa só depois de a anterior terminar e aplicar o resultado. */
  fila: Promise<void>
}

const CARREGANDO: EstadoDaTela = { tipo: 'carregando' }

/**
 * Estado de tela do acesso de membro. As avaliações são serializadas: uma reavaliação pedida durante
 * outra (por exemplo, a do SIGNED_OUT que o `sair()` de dentro do `resolverAcesso` emite antes de
 * resolver) espera, roda depois e passa por `combinarEstados`; assim `sem_papel` e os avisos fixos ficam.
 */
export function useAcesso(dep: Dependencias): {
  estado: EstadoDaTela
  servicos: ServicosDeMembro | null
  reavaliar: () => void
  tentarDeNovo: () => void
  entrar: (area: Area | null) => void
  sair: () => void
} {
  const [estado, setEstado] = useState<EstadoDaTela>(CARREGANDO)
  const [servicos, setServicos] = useState<ServicosDeMembro | null>(null)
  const montagem = useRef<Montagem | null>(null)

  /** Aplica o estado se a montagem ainda está ativa; devolve se aplicou. */
  const aplicar = useCallback((m: Montagem, novo: EstadoDaTela): boolean => {
    if (!m.ativo) return false
    m.estado = novo
    m.aplicacoes++
    setEstado(novo)
    return true
  }, [])

  const enfileirar = useCallback((m: Montagem, tarefa: (s: ServicosDeMembro) => Promise<void>) => {
    m.fila = m.fila
      .then(async () => {
        if (!m.ativo || m.servicos === null) return
        const antes = m.aplicacoes
        try {
          await tarefa(m.servicos)
        } catch {
          // resolverAcesso não lança pelas portas; um erro aqui é defeito. Se a tarefa ainda não aplicou nada,
          // tela de falha (com "Tentar de novo"), para não ficar em "Conferindo seu acesso…". Se já aplicou (por
          // exemplo, `membro` e depois `limparRetornoDaUrl` lançou), o estado decidido fica: a URL suja não muda o acesso.
          if (m.aplicacoes === antes) aplicar(m, { tipo: 'falha' })
        }
      })
      .catch(() => undefined)
  }, [aplicar])

  const pedirAvaliacao = useCallback((m: Montagem, tipo: TipoDeAvaliacao) => {
    enfileirar(m, async (s) => {
      const novo = await resolverAcesso(s, tipo === 'primeira' ? m.retorno : SEM_RETORNO)
      const final =
        tipo === 'automatica' && m.estado.tipo !== 'erro_de_configuracao' && m.estado.tipo !== 'erro_inesperado'
          ? combinarEstados(m.estado, novo)
          : novo
      if (!aplicar(m, final)) return // desmontada: nem estado nem limpeza da URL
      // Só depois da primeira avaliação: o auth-js troca o `code` ao criar o cliente; limpar antes quebraria o login.
      if (tipo === 'primeira' && (m.retorno.sujo || m.retorno.fragmentoSujo)) dep.limparRetornoDaUrl(m.retorno)
    })
  }, [aplicar, dep, enfileirar])

  useEffect(() => {
    const m: Montagem = { ativo: true, servicos: null, retorno: SEM_RETORNO, estado: CARREGANDO, aplicacoes: 0, fila: Promise.resolve() }
    montagem.current = m

    let s: ServicosDeMembro
    try {
      s = dep.obterServicos()
    } catch (erro) {
      aplicar(
        m,
        erro instanceof ErroDeConfiguracao
          ? { tipo: 'erro_de_configuracao', mensagem: erro.message }
          : { tipo: 'erro_inesperado' },
      )
      return () => {
        m.ativo = false
      }
    }
    m.servicos = s
    setServicos(s)
    m.retorno = lerRetornoDoLogin(dep.busca, dep.fragmento)
    pedirAvaliacao(m, 'primeira')

    const reavaliarNoEvento = () => pedirAvaliacao(m, 'automatica')
    const cancelarSessao = s.auth.aoMudarSessao(reavaliarNoEvento)
    const cancelarVolta = dep.aoVoltarAVer(reavaliarNoEvento)
    return () => {
      m.ativo = false
      cancelarSessao()
      cancelarVolta()
    }
  }, [aplicar, dep, pedirAvaliacao])

  const reavaliar = useCallback(() => {
    if (montagem.current) pedirAvaliacao(montagem.current, 'automatica')
  }, [pedirAvaliacao])

  const tentarDeNovo = useCallback(() => {
    if (montagem.current) pedirAvaliacao(montagem.current, 'acao')
  }, [pedirAvaliacao])

  const entrar = useCallback((area: Area | null) => {
    const m = montagem.current
    if (!m) return
    enfileirar(m, async (s) => {
      try {
        await s.auth.entrarComGoogle(urlDeRetorno(dep.origem, area))
      } catch {
        aplicar(m, { tipo: 'falha' })
      }
    })
  }, [aplicar, dep, enfileirar])

  const sair = useCallback(() => {
    const m = montagem.current
    if (!m) return
    enfileirar(m, async (s) => {
      try {
        await s.auth.sair() // a porta promete não lançar; o SIGNED_OUT que ela emite já pediu uma reavaliação
      } catch {
        /* a sessão local já saiu ou sai na próxima leitura */
      }
      aplicar(m, { tipo: 'sem_sessao', aviso: null })
    })
  }, [aplicar, enfileirar])

  return { estado, servicos, reavaliar, tentarDeNovo, entrar, sair }
}
