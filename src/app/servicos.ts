import type { SupabaseClient } from '@supabase/supabase-js'
import type { ServicosDeMembro } from '../domains/acesso/portas'
import type { ServicosDePreparacao } from '../domains/preparacao/portas'
import { criarAutenticacaoSupabase, criarRepositorioDeAcessoSupabase } from '../shared/infra/acessoSupabase'
import { criarArmazenamentoSupabase } from '../shared/infra/armazenamentoSupabase'
import { lerConfiguracao } from '../shared/infra/configuracao'
import type { Configuracao } from '../shared/infra/configuracao'
import { criarRepositoriosDePreparacao } from '../shared/infra/preparacaoSupabase'
import { criarClienteSupabase } from '../shared/infra/supabase'

/**
 * Só as duas variáveis do Supabase, lidas de `import.meta.env` uma a uma: o Vite troca cada acesso
 * estático pelo valor, e nada mais do ambiente (`DEV`, `MODE`, TURN) entra no objeto.
 */
export function ambienteDoVite(): Record<string, string | undefined> {
  return {
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL as string | undefined,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined,
  }
}

function montarServicosDeMembro(cliente: SupabaseClient): ServicosDeMembro {
  return { auth: criarAutenticacaoSupabase(cliente), repo: criarRepositorioDeAcessoSupabase(cliente) }
}

/**
 * Composição dos serviços de membro: valida a configuração (lança `ErroDeConfiguracao` antes de criar
 * qualquer cliente) e cria um cliente Supabase do tipo `membro` para os dois adaptadores.
 */
export function criarServicosDeMembro(env: Record<string, string | undefined>): ServicosDeMembro {
  return montarServicosDeMembro(criarClienteSupabase(lerConfiguracao(env), 'membro'))
}

/** Composição da Preparação sobre um cliente já criado: os repositórios e o armazenamento (D8, D10). */
export function criarServicosDePreparacao(cliente: SupabaseClient, config: Configuracao): ServicosDePreparacao {
  return {
    ...criarRepositoriosDePreparacao(cliente),
    armazenamento: criarArmazenamentoSupabase(cliente, config.supabaseUrl, config.supabaseChavePublica),
  }
}

/** O cliente de membro desta página e a configuração com que foi criado (uma vez por página). */
let base: { cliente: SupabaseClient; config: Configuracao } | null = null
let servicos: ServicosDeMembro | null = null
let preparacao: ServicosDePreparacao | null = null

/**
 * Cliente de membro desta página, criado na primeira chamada (preguiçoso: só as rotas de membro chamam).
 * Se a configuração falhar, nada é guardado e a próxima chamada tenta (e falha) de novo.
 */
function obterBase(): { cliente: SupabaseClient; config: Configuracao } {
  if (base === null) {
    const config = lerConfiguracao(ambienteDoVite())
    base = { cliente: criarClienteSupabase(config, 'membro'), config }
  }
  return base
}

/** Serviços de membro desta página, sobre o cliente único (`obterBase`). */
export function obterServicosDeMembro(): ServicosDeMembro {
  servicos ??= montarServicosDeMembro(obterBase().cliente)
  return servicos
}

/**
 * Serviços da Preparação desta página, sobre o **mesmo** cliente de `obterServicosDeMembro` (uma sessão,
 * um refresh de token). Lança `ErroDeConfiguracao` como ele, sem criar cliente.
 */
export function obterServicosDePreparacao(): ServicosDePreparacao {
  if (preparacao === null) {
    const { cliente, config } = obterBase()
    preparacao = criarServicosDePreparacao(cliente, config)
  }
  return preparacao
}
