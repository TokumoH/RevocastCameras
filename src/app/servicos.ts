import type { ServicosDeMembro } from '../domains/acesso/portas'
import { criarAutenticacaoSupabase, criarRepositorioDeAcessoSupabase } from '../shared/infra/acessoSupabase'
import { lerConfiguracao } from '../shared/infra/configuracao'
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

/**
 * Composição dos serviços de membro: valida a configuração (lança `ErroDeConfiguracao` antes de criar
 * qualquer cliente) e cria um cliente Supabase do tipo `membro` para os dois adaptadores.
 */
export function criarServicosDeMembro(env: Record<string, string | undefined>): ServicosDeMembro {
  const cliente = criarClienteSupabase(lerConfiguracao(env), 'membro')
  return { auth: criarAutenticacaoSupabase(cliente), repo: criarRepositorioDeAcessoSupabase(cliente) }
}

let servicos: ServicosDeMembro | null = null

/**
 * Serviços de membro desta página, criados na primeira chamada (preguiçoso: só as rotas de membro chamam).
 * Se a configuração falhar, nada é guardado e a próxima chamada tenta (e falha) de novo.
 */
export function obterServicosDeMembro(): ServicosDeMembro {
  servicos ??= criarServicosDeMembro(ambienteDoVite())
  return servicos
}
