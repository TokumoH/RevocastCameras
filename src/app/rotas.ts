export type NomeDaRota =
  | 'entrar'
  | 'painel'
  | 'controle'
  | 'camera'
  | 'obs_palco'
  | 'obs_camera'
  | 'nao_encontrada'

export interface Rota {
  nome: NomeDaRota
  titulo: string
}

const ROTAS: Record<string, Rota> = {
  '/entrar': { nome: 'entrar', titulo: 'Entrar' },
  '/painel': { nome: 'painel', titulo: 'Painel' },
  '/controle': { nome: 'controle', titulo: 'Controle' },
  '/camera': { nome: 'camera', titulo: 'Câmera' },
  '/obs/palco': { nome: 'obs_palco', titulo: 'Palco (OBS)' },
  '/obs/camera': { nome: 'obs_camera', titulo: 'Câmera (OBS)' },
}

const NAO_ENCONTRADA: Rota = { nome: 'nao_encontrada', titulo: 'Página não encontrada' }

/** Converte o caminho da URL na rota do app. `/` leva a `entrar`; barra final é ignorada. */
export function resolverRota(caminho: string): Rota {
  const limpo = caminho.length > 1 ? caminho.replace(/\/+$/, '') : caminho
  if (limpo === '/' || limpo === '') return ROTAS['/entrar']
  return Object.hasOwn(ROTAS, limpo) ? ROTAS[limpo] : NAO_ENCONTRADA
}
