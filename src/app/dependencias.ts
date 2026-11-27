import type { Area } from '../domains/acesso/papeis'
import type { TipoDeDispositivo } from '../domains/acesso/dispositivos'
import type { ServicosDeMembro } from '../domains/acesso/portas'
import type { ServicosDePreparacao } from '../domains/preparacao/portas'
import { PARAMETROS_DE_RETORNO } from '../domains/acesso/retornoDoLogin'
import type { RetornoDoLogin } from '../domains/acesso/retornoDoLogin'
import { obterServicosDeAoVivo, obterServicosDeDispositivo, obterServicosDeMembro, obterServicosDePreparacao } from './servicos'
import type { ServicosDeAoVivo, ServicosDoDispositivo } from './servicos'

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
  /** Ao vivo (E3) sobre o mesmo cliente de membro; só nas rotas de membro, dentro da guarda. */
  obterAoVivo: () => ServicosDeAoVivo
  /**
   * Serviços da rota de dispositivo do `tipo` (E3, D4), sobre o cliente **daquele tipo**; só as rotas de
   * dispositivo chamam, e nunca criam o cliente de membro. Lança `ErroDeConfiguracao`.
   */
  obterDispositivo: (tipo: TipoDeDispositivo) => ServicosDoDispositivo
  /** Apaga o fragmento da URL (o código de pareamento, D3) sem recarregar; chamado antes de qualquer rede. */
  limparFragmento: () => void
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

/** Dependências reais. Não cria cliente Supabase: `obterServicos`, `obterPreparacao`, `obterAoVivo` e `obterDispositivo` são preguiçosos. */
export function dependenciasDoNavegador(): Dependencias {
  return {
    obterServicos: obterServicosDeMembro,
    obterPreparacao: obterServicosDePreparacao,
    obterAoVivo: obterServicosDeAoVivo,
    obterDispositivo: obterServicosDeDispositivo,
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
    limparFragmento: () => {
      // O código sai da URL (e do histórico da entrada atual) antes de qualquer chamada de rede (D3).
      const url = new URL(window.location.href)
      url.hash = ''
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
