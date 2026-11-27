/*
 * Portas da Integração OBS (DES-001 §6; PLA-004, D1, D10). Camada anticorrupção: o executor
 * (`executor.ts`) fala com o OBS só por estas duas portas, e o resto do app só conhece o
 * `ExecutorDeAcoes` de `aovivo/portas.ts`. Adaptadores: `src/shared/infra/obsNavegador.ts`
 * (`window.obsstudio` do obs-browser) e `src/shared/infra/obsWebsocket.ts` (obs-websocket v5).
 */

/**
 * Níveis de controle do obs-browser (README do obsproject/obs-browser, "Get webpage control
 * permissions"): o que a página pode pedir depende do nível escolhido na Fonte de navegador.
 */
export const NIVEL_DE_CONTROLE = Object.freeze({ NONE: 0, READ_OBS: 1, READ_USER: 2, BASIC: 3, ADVANCED: 4, ALL: 5 } as const)

/** Saídas do OBS (`getStatus`, nível READ_OBS). A saída conta como no ar com qualquer um verdadeiro (D10). */
export interface StatusDaSaida {
  gravando: boolean
  replayBuffer: boolean
  transmitindo: boolean
  cameraVirtual: boolean
}

/**
 * `window.obsstudio` (obs-browser), com os callbacks transformados em promessas. Leitura sem OBS,
 * sem resposta em 3 s ou fora da forma → `null`; ações sem OBS não fazem nada (nunca lançam).
 */
export interface ObsNoNavegador {
  disponivel(): boolean
  /** `pluginVersion` (sem nível exigido). */
  versaoDoPlugin(): string | null
  /** `getControlLevel` (NONE): 0 NONE, 1 READ_OBS, 2 READ_USER, 3 BASIC, 4 ADVANCED, 5 ALL. */
  nivel(): Promise<number | null>
  /** `getScenes` (READ_USER). */
  cenas(): Promise<string[] | null>
  /** `getCurrentScene` (READ_USER), o `name`. */
  cenaAtual(): Promise<string | null>
  /** `getStatus` (READ_OBS). */
  status(): Promise<StatusDaSaida | null>
  /**
   * Eventos de saída do obs-browser disparados em `window` (início, inclusive os `Starting`, e fim
   * de transmissão, gravação, Replay Buffer e câmera virtual), com o tipo (`inicio` para `*Starting`/`*Started`,
   * `fim` para `*Stopped`) e a saída (`Streaming`, `Recording`, `Replaybuffer`, `Virtualcam`). Devolve a função que solta o ouvinte. O `getStatus` só marca a saída depois do `*Started`:
   * quem guarda a tela usa o tipo para não confiar no status entre o `Starting` e o `Started` (VER-046, rodada 1).
   * Não usa `obsSourceActiveChanged`: a Fonte fica em todas as cenas (I5).
   */
  aoMudarSaida(f: (tipo: 'inicio' | 'fim', saida: string) => void): () => void
  /**
   * Evento `obsSceneChanged` do obs-browser (a cena do programa mudou, inclusive à mão no OBS; README do
   * obs-browser, "Available events"). Só avisa: quem lê a cena é `cenaAtual()`, com o nível conferido
   * (VER-046, A1). Devolve a função que solta o ouvinte.
   */
  aoMudarCena(f: () => void): () => void
  /** `setCurrentScene` (ADVANCED). */
  trocarCena(nome: string): void
  /** `saveReplayBuffer` (BASIC). */
  salvarClipe(): void
}

/**
 * O pedaço do obs-websocket que o executor usa (segregação de interface; VER-046, N1): marcar, saber se
 * está conectado e ler a versão. Quem conecta, ouve a queda e fecha é a rota do palco, no `ObsWebsocket`.
 */
export interface MarcadorObs {
  /** `GetVersion` → `obsVersion`; sem conexão ou sem resposta → `null`. */
  versao(): Promise<string | null>
  /** `CreateRecordChapter` (OBS 30.2, gravação em Hybrid MP4); `requestStatus.result` falso, sem conexão ou sem resposta → `false`. */
  marcar(nome: string): Promise<boolean>
  /** A conexão passou do `Identified` e não caiu nem foi fechada. */
  conectado(): boolean
}

/**
 * obs-websocket v5 no `ws://127.0.0.1:<porta>` (D10). A senha só entra em `conectar` e só sai
 * como o hash de autenticação do `Identify`; nunca é guardada, registrada nem devolvida.
 */
export interface ObsWebsocket extends MarcadorObs {
  conectar(c: { porta: number; senha: string }): Promise<'conectado' | 'senha_errada' | 'sem_conexao'>
  /**
   * Avisa quando uma conexão já identificada cai (fechada pelo OBS ou pela rede; não por `fechar()`).
   * Os pedidos pendentes já estão resolvidos (`null`/`false`) quando o aviso chega. Devolve a função que solta.
   */
  aoFechar(f: () => void): () => void
  fechar(): void
}
