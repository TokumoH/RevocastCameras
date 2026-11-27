import type { Dispositivo, TipoDeDispositivo } from '../acesso/dispositivos'
import type { Cena } from '../preparacao/cenas'
import type { Aviso, Episodio } from '../preparacao/episodios'
import type { Som } from '../preparacao/midia'
import type { AcaoNoObs, LinhaDoRegistro } from './comandos'
import type { Comando, EstadoNoAr, MensagemDoEstudio, MotivoDoResultado, PresencaNoEstudio, ResultadoDoComando, SituacaoDoObs } from './mensagens'

/** Motivos que as telas do ao vivo sabem explicar; os adaptadores traduzem os erros do Supabase para eles (D7: `55000` → `estado_invalido`, `23505` → `duplicado`). */
export type MotivoDoAoVivo = 'negado' | 'invalido' | 'estado_invalido' | 'duplicado' | 'nada_alterado' | 'sessao_expirada' | 'rede' | 'outro'

/** Erro das portas do ao vivo. A mensagem leva só o motivo: nunca código de pareamento, token, URL assinada ou texto do servidor. */
export class ErroDoAoVivo extends Error {
  readonly motivo: MotivoDoAoVivo
  constructor(motivo: MotivoDoAoVivo) {
    super(`Erro do ao vivo: ${motivo}`)
    this.name = 'ErroDoAoVivo'
    this.motivo = motivo
  }
}

/** Estados de um canal (D15): `fechado` (pelo servidor) é tratado como `negado` pelas telas (N3). */
export type EstadoDoCanal = 'conectando' | 'conectado' | 'reconectando' | 'fechado' | 'negado'

/** Resposta do `broadcast` com `ack` (D15): `sem_resposta` = `timed out` (rede ruim ou sem permissão de escrita); nada é reenviado sozinho. */
export type RespostaDoEnvio = 'ok' | 'sem_resposta' | 'falhou'

/**
 * Alça do canal privado `estudio` (D6, D14). Os ouvintes recebem só mensagens já validadas pelos
 * leitores de `mensagens.ts`, com o remetente declarado, e nunca dentro do callback do
 * `realtime-js` (são agendados). Cada função `ao*` devolve a que cancela.
 */
export interface CanalDoEstudio {
  aoReceber(f: (m: MensagemDoEstudio, remetente: string) => void): () => void
  /** Lista de presença validada; a chave (`usuario`) é o `auth.uid()` de cada cliente. */
  aoMudarPresenca(f: (presentes: { usuario: string; presenca: PresencaNoEstudio }[]) => void): () => void
  aoMudarEstado(f: (e: EstadoDoCanal) => void): () => void
  /** Só `equipe`/`admin` têm permissão de enviar em `estudio` (a RLS decide, não a tela). */
  enviar(m: MensagemDoEstudio): Promise<RespostaDoEnvio>
  marcarPresenca(p: PresencaNoEstudio): Promise<void>
  /** Solta só esta alça; o canal sai quando a última alça do tópico fecha (I3). */
  fechar(): Promise<void>
}

/**
 * Alça do canal privado `episodio:<id>:controle` (D6, D9): só os comandos dos membros (e a presença deles). Desde o
 * VER-047, só membros enviam aqui (RLS); o `obs_palco` só recebe, e o estado no ar vai em `CanalDoEstado`.
 */
export interface CanalDoControle {
  /** Só o evento `comando` deste tópico (`lerMensagemDoControle`): um `estado` forjado aqui é descartado. */
  aoComando(f: (c: Comando, remetente: string) => void): () => void
  /** Alguém entrou na presença do tópico: o palco republica o estado (em `:estado`). */
  aoEntrarAlguem(f: () => void): () => void
  /**
   * Quem está na presença do tópico (a chave de cada um, só uuid), a cada mudança; quem se inscreve com o
   * canal já conectado recebe a lista atual. Só membros podem marcar presença em `:controle` (RLS, D6), então
   * o palco aceita comando só de quem está aqui (VER-046, I4: o remetente continua declarado).
   */
  aoMudarPresentes(f: (usuarios: string[]) => void): () => void
  aoMudarEstado(f: (e: EstadoDoCanal) => void): () => void
  enviarComando(c: Comando): Promise<RespostaDoEnvio>
  /** Só membros marcam presença em `:controle` (D14). */
  marcarPresenca(): Promise<void>
  fechar(): Promise<void>
}

/**
 * Alça do canal privado `episodio:<id>:estado` (VER-047): o estado no ar que o palco publica. Só o `obs_palco` envia
 * (RLS; no máximo um não revogado, índice `dispositivos_um_palco_ativo`); membros e o palco recebem; ninguém marca presença.
 */
export interface CanalDoEstado {
  /** Só o evento `estado` deste tópico (`lerMensagemDoEstado`): um `comando` forjado aqui é descartado. */
  aoEstado(f: (e: EstadoNoAr, remetente: string) => void): () => void
  aoMudarEstado(f: (e: EstadoDoCanal) => void): () => void
  publicarEstado(e: EstadoNoAr): Promise<RespostaDoEnvio>
  fechar(): Promise<void>
}

/** Cada chamada devolve uma alça nova; o mesmo tópico no mesmo cliente divide um canal só (I3). */
export interface FabricaDeCanais {
  estudio(): CanalDoEstudio
  controle(episodioId: string): CanalDoControle
  /** O tópico do estado no ar do episódio (VER-047). */
  estado(episodioId: string): CanalDoEstado
}

/** Porta do ao vivo no painel e no `/controle` (cliente de membro): funções do banco (D2, D5, D7) e a lista de dispositivos. */
export interface RepositorioDoAoVivo {
  /** `episodio_ativo()`: o ao vivo ou, sem ele, o episódio do modo teste. */
  episodioAtivo(): Promise<{ id: string; modo: 'ao_vivo' | 'teste' } | null>
  /** `iniciar_ao_vivo`: outro ao vivo → `duplicado`; fora de rascunho → `estado_invalido`. */
  iniciar(id: string): Promise<void>
  encerrar(id: string): Promise<void>
  /** `definir_modo_teste`; `null` desliga; com ao vivo → `estado_invalido`. */
  definirModoTeste(id: string | null): Promise<void>
  listarDispositivos(): Promise<Dispositivo[]>
  /** `criar_codigo_pareamento`: o código volta **uma vez** e nunca é gravado em claro (D2). */
  criarCodigo(p: { tipo: TipoDeDispositivo; rotulo: string; dispositivoId: string | null; cameraId: string | null }): Promise<{ dispositivoId: string; codigo: string; expiraEm: string }>
  /** `revogar_dispositivo`: devolve a sessão anônima revogada, para o aviso em `estudio` (D5). */
  revogar(id: string): Promise<{ usuario: string | null }>
}

/** Porta do palco (cliente `obs_palco`): episódio ativo, listas, URLs assinadas e o registro (D9). */
export interface RepositorioDoPalco {
  episodioAtivo(): Promise<{ id: string; modo: 'ao_vivo' | 'teste' } | null>
  carregar(episodioId: string): Promise<{ episodio: Episodio; cenas: Cena[]; sons: (Som & { caminho: string })[]; avisos: (Aviso & { caminhoDaImagem: string | null })[] }>
  /** URL assinada do bucket `midias`, válida por `VALIDADE_NO_PALCO_S` (Tarefa 4); nunca em `console`. */
  urlDoArquivo(caminho: string): Promise<string>
  /** Insert em `registro_acoes`; a falha não desfaz nem bloqueia a ação (D9). */
  registrar(l: LinhaDoRegistro): Promise<void>
}

/** Quem executa as ações no palco (Integração OBS, Tarefa 5). `aovivo` não conhece o OBS (D1). */
export interface ExecutorDeAcoes {
  /** O motivo, quando há, é sempre da lista fixa (`MOTIVOS_DO_RESULTADO`), nunca texto do OBS. */
  executar(a: AcaoNoObs): Promise<{ resultado: ResultadoDoComando; motivo: MotivoDoResultado | null }>
  situacao(): SituacaoDoObs
}
