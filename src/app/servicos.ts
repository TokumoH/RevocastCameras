import type { SupabaseClient } from '@supabase/supabase-js'
import type { TipoDeDispositivo } from '../domains/acesso/dispositivos'
import type { ServicosDeMembro } from '../domains/acesso/portas'
import type { ServicoDeDispositivo } from '../domains/acesso/portasDeDispositivo'
import type { FabricaDeCanais, RepositorioDoAoVivo, RepositorioDoPalco } from '../domains/aovivo/portas'
import type { ServicosDePreparacao } from '../domains/preparacao/portas'
import { criarAutenticacaoSupabase, criarRepositorioDeAcessoSupabase } from '../shared/infra/acessoSupabase'
import { criarRepositorioDoAoVivo, criarRepositorioDoPalco } from '../shared/infra/aoVivoSupabase'
import { criarArmazenamentoSupabase } from '../shared/infra/armazenamentoSupabase'
import { criarFabricaDeCanais } from '../shared/infra/canalSupabase'
import { lerConfiguracao } from '../shared/infra/configuracao'
import type { Configuracao } from '../shared/infra/configuracao'
import { criarServicoDeDispositivoSupabase } from '../shared/infra/dispositivoSupabase'
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

/** Ao vivo no painel e no `/controle` (E3): repositório e canais sobre o cliente de membro. */
export interface ServicosDeAoVivo {
  repo: RepositorioDoAoVivo
  /** A fábrica de canais do usuário da sessão; a mesma a cada chamada com o mesmo usuário (I3). */
  canais: (usuarioId: string) => FabricaDeCanais
}

/** Serviços de uma rota de dispositivo (E3, D4): sessão anônima e pareamento, palco e canais, sobre o cliente do tipo. */
export interface ServicosDoDispositivo {
  servico: ServicoDeDispositivo
  palco: RepositorioDoPalco
  canais: (usuarioId: string) => FabricaDeCanais
}

/**
 * Canais de um cliente, por usuário: a fábrica guarda o registro de um canal por tópico (I3), então
 * quem usa o mesmo cliente (o painel e o `useAoVivo`) precisa da **mesma** fábrica, senão o segundo
 * `on('presence')` cairia no canal já inscrito pelo primeiro. Usuário novo no mesmo cliente → fábrica
 * nova (Riscos do VER-038: os canais do usuário anterior já devem estar fechados).
 */
function canaisPorUsuario(cliente: SupabaseClient): (usuarioId: string) => FabricaDeCanais {
  const fabricas = new Map<string, FabricaDeCanais>()
  return (usuarioId) => {
    let fabrica = fabricas.get(usuarioId)
    if (fabrica === undefined) {
      fabrica = criarFabricaDeCanais(cliente, usuarioId)
      fabricas.set(usuarioId, fabrica)
    }
    return fabrica
  }
}

let aoVivo: ServicosDeAoVivo | null = null

/**
 * Ao vivo desta página, sobre o **mesmo** cliente de `obterServicosDeMembro` (uma sessão, um refresh de
 * token, um socket Realtime). Lança `ErroDeConfiguracao` como ele, sem criar cliente.
 */
export function obterServicosDeAoVivo(): ServicosDeAoVivo {
  if (aoVivo === null) {
    const { cliente } = obterBase()
    aoVivo = { repo: criarRepositorioDoAoVivo(cliente), canais: canaisPorUsuario(cliente) }
  }
  return aoVivo
}

/** Um cliente por tipo de dispositivo nesta página (D4), criado só quando a rota daquele tipo pede. */
const dispositivos = new Map<TipoDeDispositivo, ServicosDoDispositivo>()

/**
 * Serviços da rota de dispositivo do `tipo`: cliente próprio (`storageKey` `revocast-auth-<tipo>`,
 * `detectSessionInUrl: false`), preguiçoso e uma vez por página; nunca o cliente de membro nem o de
 * outro tipo. Configuração inválida → `ErroDeConfiguracao`, sem cliente e sem guardar nada.
 */
export function obterServicosDeDispositivo(tipo: TipoDeDispositivo): ServicosDoDispositivo {
  let servicosDoTipo = dispositivos.get(tipo)
  if (servicosDoTipo === undefined) {
    const cliente = criarClienteSupabase(lerConfiguracao(ambienteDoVite()), tipo)
    servicosDoTipo = {
      servico: criarServicoDeDispositivoSupabase(cliente),
      palco: criarRepositorioDoPalco(cliente),
      canais: canaisPorUsuario(cliente),
    }
    dispositivos.set(tipo, servicosDoTipo)
  }
  return servicosDoTipo
}
