import type { TipoDeDispositivo } from './dispositivos'

/** Motivos que as telas de dispositivo sabem explicar; o adaptador traduz os erros do Supabase para eles. */
export type MotivoDoDispositivo = 'rede' | 'negado' | 'outro'

/** Erro da porta de dispositivo. A mensagem leva só o motivo: nunca código de pareamento, token ou texto do servidor. */
export class ErroDeDispositivo extends Error {
  readonly motivo: MotivoDoDispositivo
  constructor(motivo: MotivoDoDispositivo) {
    super(`Erro de dispositivo: ${motivo}`)
    this.name = 'ErroDeDispositivo'
    this.motivo = motivo
  }
}

/**
 * Porta da sessão de um dispositivo (E3, D4): um cliente Supabase por tipo, com login anônimo.
 * Adaptador em `src/shared/infra/dispositivoSupabase.ts` (Tarefa 4). O código de pareamento só
 * passa por `parear` e nunca vai para armazenamento, `console` ou mensagem de erro.
 */
export interface ServicoDeDispositivo {
  /** Sessão guardada neste cliente. Erro ao ler → `ErroDeDispositivo('rede')`. */
  sessaoAtual(): Promise<{ usuarioId: string; anonima: boolean } | null>
  /** Login anônimo novo (`signInAnonymously`). Login anônimo desligado → `negado`; sem resposta → `rede`. */
  entrarAnonimo(): Promise<{ usuarioId: string }>
  /** `rpc('parear_dispositivo', { p_codigo, p_tipo })` com o tipo da rota (D2). */
  parear(
    codigo: string,
    tipo: TipoDeDispositivo,
  ): Promise<{ resultado: 'pareado' | 'invalido' | 'tipo_errado' | 'limite'; dispositivo: { id: string; rotulo: string } | null }>
  /** `rpc('meu_dispositivo')`, lido pelas colunas de `COLUNAS_DE_MEU_DISPOSITIVO` (D4, I2); sem linha → `null`. */
  dispositivoAtual(): Promise<{ id: string; tipo: TipoDeDispositivo; rotulo: string; cameraId: string | null } | null>
  /** Saída local (`signOut({ scope: 'local' })`); nunca lança. */
  sair(): Promise<void>
}
