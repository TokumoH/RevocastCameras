import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Configuracao } from './configuracao'
import { fetchComTempoLimite, limitarRestEAuth, TEMPO_LIMITE_SUPABASE_MS } from './tempoLimite'

export type TipoDeSessao = 'membro' | 'camera' | 'obs_palco' | 'obs_camera'

export function chaveDeArmazenamento(tipo: TipoDeSessao): string {
  return `revocast-auth-${tipo}`
}

export function opcoesDeAuth(tipo: TipoDeSessao): {
  storageKey: string
  flowType: 'pkce'
  persistSession: true
  autoRefreshToken: true
  detectSessionInUrl: boolean
} {
  return {
    storageKey: chaveDeArmazenamento(tipo),
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: tipo === 'membro',
  }
}

/**
 * O `fetch` do cliente tem tempo-limite de 15 s só para `/rest/v1/` e `/auth/v1/` do projeto
 * (`tempoLimite.ts`); Storage e o resto seguem sem limite. O `fetch` global é lido na hora de cada
 * chamada (e chamado sem `this`, como o supabase-js faz com o padrão).
 */
export function criarClienteSupabase(config: Configuracao, tipo: TipoDeSessao): SupabaseClient {
  const fetchDaPagina: typeof fetch = (entrada, init) => globalThis.fetch(entrada, init)
  return createClient(config.supabaseUrl, config.supabaseChavePublica, {
    auth: opcoesDeAuth(tipo),
    global: {
      fetch: fetchComTempoLimite(fetchDaPagina, TEMPO_LIMITE_SUPABASE_MS, limitarRestEAuth(config.supabaseUrl)),
    },
  })
}
