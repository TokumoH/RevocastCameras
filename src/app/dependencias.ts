import type { Area } from '../domains/acesso/papeis'
import type { ServicosDeMembro } from '../domains/acesso/portas'
import type { ServicosDePreparacao } from '../domains/preparacao/portas'
import { PARAMETROS_DE_RETORNO } from '../domains/acesso/retornoDoLogin'
import type { RetornoDoLogin } from '../domains/acesso/retornoDoLogin'
import { obterServicosDeMembro, obterServicosDePreparacao } from './servicos'

/**
 * O que as telas de membro precisam do mundo de fora (navegador e Supabase). Os testes passam falsos
 * (`servicosFalsos.ts`); o app usa `dependenciasDoNavegador()`.
 */
export interface Dependencias {
  /** Lança `ErroDeConfiguracao`; só é chamado nas rotas de membro. */
  obterServicos: () => ServicosDeMembro
  /**
   * Serviços da Preparação (E2), sobre o mesmo cliente de `obterServicos`. Preguiçoso como ele: só é
   * chamado dentro da guarda de membro, então as rotas de dispositivo nunca criam cliente.
   */
  obterPreparacao: () => ServicosDePreparacao
  navegar: (caminho: string) => void
  /** `window.location.origin` */
  origem: string
  /** `window.location.search` */
  busca: string
  /** `window.location.hash` */
  fragmento: string
  /** Apaga da URL os parâmetros de retorno do login (e o fragmento, se sujo), sem recarregar. */
  limparRetornoDaUrl: (retorno: RetornoDoLogin) => void
  /** Avisa quando a aba volta a ficar visível; devolve a função que cancela. */
  aoVoltarAVer: (ouvinte: () => void) => () => void
}

export function caminhoDaArea(area: Area): '/painel' | '/controle' {
  return area === 'controle' ? '/controle' : '/painel'
}

/**
 * URL para onde o Google devolve a pessoa: só a origem da página e um de três caminhos fixos. Nenhum
 * parâmetro da URL (`?volta=`, `?next=`...) escolhe o destino (sem redirecionamento aberto).
 */
export function urlDeRetorno(origem: string, area: Area | null): string {
  return origem + (area === null ? '/entrar' : caminhoDaArea(area))
}

/** Dependências reais. Não cria o cliente Supabase: `obterServicos` e `obterPreparacao` são preguiçosos. */
export function dependenciasDoNavegador(): Dependencias {
  return {
    obterServicos: obterServicosDeMembro,
    obterPreparacao: obterServicosDePreparacao,
    navegar: (caminho) => window.location.replace(caminho),
    origem: window.location.origin,
    busca: window.location.search,
    fragmento: window.location.hash,
    limparRetornoDaUrl: (retorno) => {
      const url = new URL(window.location.href)
      for (const p of PARAMETROS_DE_RETORNO) url.searchParams.delete(p)
      if (retorno.fragmentoSujo) url.hash = '' // só rotas de membro chegam aqui; o fragmento das rotas de dispositivo é do pareamento
      window.history.replaceState(window.history.state, '', url.toString())
    },
    aoVoltarAVer: (ouvinte) => {
      const aoMudar = () => {
        if (document.visibilityState === 'visible') ouvinte()
      }
      document.addEventListener('visibilitychange', aoMudar)
      return () => document.removeEventListener('visibilitychange', aoMudar)
    },
  }
}
