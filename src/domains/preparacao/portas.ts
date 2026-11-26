import type { Cena } from './cenas'
import type { Aviso, Episodio } from './episodios'
import type { LinhaDoMapa } from './gestos'
import type { Midia, Som, TipoDeMidia } from './midia'

/** Motivos que as telas da Preparação sabem explicar; os adaptadores traduzem os erros do Supabase para eles. */
export type MotivoDaPreparacao =
  | 'duplicado'
  | 'em_uso'
  | 'invalido'
  | 'negado'
  | 'nada_alterado'
  | 'sessao_expirada'
  | 'rede'
  | 'cancelado'
  | 'sem_resposta'
  | 'outro'

/** Erro das portas. A mensagem leva só o motivo: nunca nome de arquivo, token, URL ou texto do servidor. */
export class ErroDePreparacao extends Error {
  readonly motivo: MotivoDaPreparacao
  constructor(motivo: MotivoDaPreparacao) {
    super(`Erro de preparação: ${motivo}`)
    this.name = 'ErroDePreparacao'
    this.motivo = motivo
  }
}

/** Linha nova de `midias`, já conferida no domínio (o `id` vem do app, como o caminho). */
export interface NovaMidia {
  id: string
  tipo: TipoDeMidia
  nome: string
  caminho: string
  mime: string
  tamanhoBytes: number
  enviadoPor: string
}

/** Porta do agregado Mídia (tabela `midias`). */
export interface RepositorioDeMidias {
  listar(): Promise<Midia[]>
  registrar(m: NovaMidia): Promise<void>
  /** 0 linhas → `nada_alterado`; som num gesto (`23503`) → `em_uso`. */
  remover(id: string): Promise<void>
  /** Avisos (de qualquer episódio) com esta imagem. */
  contarAvisosComImagem(id: string): Promise<number>
}

/** Porta dos sons (tabela `sons`; a linha sai em cascata com a mídia). */
export interface RepositorioDeSons {
  listar(): Promise<Som[]>
  incluir(midiaId: string, s: { rotulo: string; emoji: string | null; volume: number; ordem: number }): Promise<void>
  /** 0 linhas → `nada_alterado`. */
  alterar(id: string, s: { rotulo: string; emoji: string | null; volume: number; ordem: number }): Promise<void>
}

/** Porta do agregado Cena (tabela `cenas`). */
export interface RepositorioDeCenas {
  listar(): Promise<Cena[]>
  /** `nome_obs` repetido → `duplicado`. */
  incluir(c: Omit<Cena, 'id'>): Promise<void>
  /** 0 linhas → `nada_alterado`; `nome_obs` repetido → `duplicado`. */
  alterar(id: string, c: Omit<Cena, 'id'>): Promise<void>
  /** 0 linhas → `nada_alterado`; cena num gesto → `em_uso`. */
  remover(id: string): Promise<void>
}

/** Porta do agregado Episódio → Aviso (tabelas `episodios` e `avisos`). Nunca escreve `estado` nem `gestos_ligados` (D2). */
export interface RepositorioDeEpisodios {
  listar(): Promise<Episodio[]>
  incluir(e: { titulo: string; data: string; criadoPor: string }): Promise<void>
  /** Só `titulo` e `data`; 0 linhas → `nada_alterado`. */
  alterar(id: string, e: { titulo: string; data: string }): Promise<void>
  /** 0 linhas → `nada_alterado`. */
  remover(id: string): Promise<void>
  listarAvisos(episodioId: string): Promise<Aviso[]>
  incluirAviso(a: Omit<Aviso, 'id'>): Promise<void>
  /** 0 linhas → `nada_alterado`. */
  alterarAviso(id: string, a: Omit<Aviso, 'id' | 'episodioId'>): Promise<void>
  /** 0 linhas → `nada_alterado`. */
  alterarOrdemDoAviso(id: string, ordem: number): Promise<void>
  /** 0 linhas → `nada_alterado`. */
  removerAviso(id: string): Promise<void>
}

/** Porta do mapa global de gestos (as 7 linhas existem desde a E0; só `update`, D12). */
export interface RepositorioDeGestos {
  listar(): Promise<LinhaDoMapa[]>
  /** 0 linhas → `nada_alterado`. */
  alterar(l: LinhaDoMapa): Promise<void>
}

export interface OpcoesDoEnvio {
  /** Fração de 0 a 1 dos bytes já enviados. */
  aoProgredir: (fracao: number) => void
  /** O "Cancelar" da pessoa. */
  sinal: AbortSignal
}

/** Porta do armazenamento dos arquivos (bucket privado `midias`; adaptador por `XMLHttpRequest`, D8). */
export interface ArmazenamentoDeMidia {
  /**
   * Envia sem sobrescrever (D5). Cancelado → `ErroDePreparacao('cancelado')`; 30 s sem progresso
   * → `'sem_resposta'`; falha de rede → `'rede'`; recusa do servidor → `'negado'` ou outro motivo.
   */
  enviar(caminho: string, corpo: Blob, mime: string, opcoes: OpcoesDoEnvio): Promise<void>
  /** Remover um caminho que não existe não dá erro. */
  remover(caminho: string): Promise<void>
  /** URL assinada, de curta duração, para a prévia (nunca registrada em `console`). */
  urlDePrevia(caminho: string): Promise<string>
}

export interface ServicosDePreparacao {
  midias: RepositorioDeMidias
  sons: RepositorioDeSons
  cenas: RepositorioDeCenas
  episodios: RepositorioDeEpisodios
  gestos: RepositorioDeGestos
  armazenamento: ArmazenamentoDeMidia
}
