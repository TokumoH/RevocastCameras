import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Configuracao } from './configuracao'

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

export function criarClienteSupabase(config: Configuracao, tipo: TipoDeSessao): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseChavePublica, { auth: opcoesDeAuth(tipo) })
}
