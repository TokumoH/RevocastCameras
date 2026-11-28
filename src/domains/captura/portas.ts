import type { EstadoDoCanal } from '../canal/estados'
import type { Gesto } from '../preparacao/gestos'
import type { LeituraDoGesto, RespostaDoGesto } from './gestos'
import type { SinalDaCamera, SinalDaObs } from './sinais'

/*
 * Portas da Captura (PLA-005, D1). O domínio não conhece o navegador: a faixa e o fluxo de vídeo são tipos opacos, e
 * quem guarda o `MediaStreamTrack`, o `MediaStream`, o `RTCPeerConnection` e a Wake Lock são os adaptadores de
 * `src/shared/infra/` (Tarefa 3). Cada função `ao*` devolve a que cancela; os adaptadores chamam os ouvintes fora dos
 * callbacks do navegador e do `realtime-js` (agendados).
 */

/** Opaco: o adaptador guarda o `MediaStreamTrack`. */
export type FaixaDeVideo = { readonly __faixa: unique symbol }
/** Opaco: o adaptador guarda o `MediaStream`. */
export type FluxoDeVideo = { readonly __fluxo: unique symbol }

/**
 * Resposta do envio de um sinal (`rpc('enviar_sinal_de_video')`): `sem_par` = nenhum par pareado (nada publicado);
 * `limite` = `54000` do limite por remetente (revisão 2, I7); qualquer outro erro (`42501`, `55000`, `22023`, rede,
 * tempo-limite) = `falhou`.
 */
export type RespostaDoSinal = 'ok' | 'sem_par' | 'limite' | 'falhou'

/**
 * Canal de vídeo de um lado (D2): recebe só no tópico da própria sessão (`video:<auth.uid()>`) e envia só pela função do
 * banco, nunca pelo Broadcast direto.
 */
export interface CanalDeVideo<Envia, Recebe> {
  /** Sinais do tópico da própria sessão, já validados pelo leitor do lado; o remetente é posto pelo banco (D2). */
  aoSinal(f: (s: Recebe, remetente: string) => void): () => void
  aoMudarEstado(f: (e: EstadoDoCanal) => void): () => void
  /**
   * `rpc('enviar_sinal_de_video')`; nunca Broadcast direto. Não depende do estado do canal (a `rpc` não vai pelo socket),
   * mas depois de `fechar()` devolve `falhou` sem chamar a função: quem precisa do `encerrar` o envia antes de fechar.
   */
  enviar(s: Envia): Promise<RespostaDoSinal>
  fechar(): Promise<void>
}

export interface FabricaDeCanaisDeVideo {
  /** O banco decide o destinatário (o `obs_camera` não revogado da câmera); o cliente não diz qual é o par. */
  videoDaCamera(): CanalDeVideo<SinalDaCamera, SinalDaObs>
  videoDaObs(): CanalDeVideo<SinalDaObs, SinalDaCamera>
}

/** `connectionState` traduzido (D6): `caiu` = `disconnected`; `falhou` = `failed` ou `closed` sem pedido. */
export type EstadoDaConexao = 'conectando' | 'conectado' | 'caiu' | 'falhou'

/** Uma conexão WebRTC (DES-001 §6.1, `ConexaoDeVideo`): ICE não incremental (D4). */
export interface ConexaoDeVideo {
  /** `sendonly`; espera o ICE (`ESPERA_DO_ICE_MS`) e devolve o SDP local. */
  oferecer(faixa: FaixaDeVideo): Promise<string>
  aceitarResposta(sdp: string): Promise<void>
  /** `recvonly`; espera o ICE e devolve o SDP local. */
  responder(oferta: string): Promise<string>
  /** `replaceTrack`; `false` = precisa de oferta nova (F8). */
  trocarFaixa(faixa: FaixaDeVideo): Promise<boolean>
  aoMudar(f: (e: EstadoDaConexao) => void): () => void
  /** O fluxo recebido (evento `track`). Não quer dizer vídeo no ar: o receptor só o mostra com a conexão em `conectado` (D3). */
  aoVideo(f: (fluxo: FluxoDeVideo) => void): () => void
  /** Fechar a pedido não gera `falhou`. */
  fechar(): void
}

export interface FabricaDeConexoes {
  /**
   * Uma conexão nova. O adaptador não lança: se o navegador recusar a construção, devolve uma conexão cujas descrições
   * rejeitam (o emissor e o receptor tratam como falha); o domínio também protege a chamada (VER-051, rodada 1, I2).
   */
  criar(): ConexaoDeVideo
}

export type FalhaDaCamera = 'sem_permissao' | 'sem_camera' | 'inseguro' | 'outro'

/** A câmera traseira, só vídeo (D7). */
export interface CameraDoAparelho {
  /**
   * Pede a câmera. **Para o fluxo atual antes do pedido novo** (solta a câmera em aparelhos que não a abrem duas vezes):
   * só chame sem faixa boa (primeira vez ou faixa perdida), senão a imagem some até o fluxo novo chegar (VER-051, N2).
   */
  ligar(): Promise<{ ok: true; faixa: FaixaDeVideo } | { ok: false; motivo: FalhaDaCamera }>
  /** `ended`, ou `mute` por mais de 3 s. */
  aoPerderFaixa(f: () => void): () => void
  /** Para todas as faixas; idempotente. */
  desligar(): void
  /** O fluxo já ligado (sem segundo `getUserMedia`), para a prévia. */
  fluxoDaPrevia(): FluxoDeVideo | null
}

/** Tela ligada (DES-001 §6.1, `ManterTelaLigada`; F7). */
export interface ManterTelaLigada {
  travar(): Promise<'travada' | 'sem_trava'>
  soltar(): void
}

/*
 * Portas dos gestos (PLA-006, D1, D2, D5, D8, D11). O domínio não vê quadros: a `FonteDeQuadros` devolve um
 * `QuadroDeVideo` opaco e o `ReconhecedorDeGestos` o consome; quem guarda o `ImageBitmap`, o `<video>` fora do DOM e o
 * Web Worker são os adaptadores de `src/shared/infra/` (Tarefa 6). Nenhum quadro sai do aparelho (D8).
 */

/** Opaco: o adaptador guarda o `ImageBitmap` (transferível). */
export type QuadroDeVideo = { readonly __quadro: unique symbol }

/** Quadros reduzidos do vídeo que o aparelho já tem (D10). */
export interface FonteDeQuadros {
  /** Um quadro atual; `null` = sem vídeo agora (vídeo pausado ou sem dimensões). */
  quadro(): Promise<QuadroDeVideo | null>
  /** Solta o `<video>` fora do DOM; idempotente. Não para a câmera (a faixa é da rota). */
  fechar(): void
}

/** Por que o reconhecedor não iniciou (D9, D11): `sem_suporte` (sem Worker, WASM ou delegado), `integridade` (SHA-256 diferente), `tempo`, `outro`. */
export type FalhaDoReconhecedor = 'sem_suporte' | 'integridade' | 'tempo' | 'outro'

/** O reconhecedor do DES-001 §6.1, num Web Worker da própria origem (D8, D9). */
export interface ReconhecedorDeGestos {
  /** Cria o worker, confere a integridade e carrega o modelo. */
  iniciar(): Promise<{ ok: true } | { ok: false; motivo: FalhaDoReconhecedor }>
  /** `null` = falha neste quadro; o quadro é transferido ao worker (não reutilizável). */
  reconhecer(q: QuadroDeVideo, em: number): Promise<LeituraDoGesto | null>
  /** Encerra o worker (`terminate`: libera a memória do WASM e o GPU); idempotente. */
  fechar(): void
}

export interface FabricaDeReconhecedores {
  /** Um reconhecedor novo, ainda sem worker (o worker só nasce no `iniciar`, D11). */
  criar(): ReconhecedorDeGestos
}

/**
 * Canal dos gestos da câmera e do `obs_camera` (D2, D4): só recebe, no tópico da própria sessão (`gestos:<auth.uid()>`),
 * o aviso `gestos_mudaram` (já validado por `lerAvisoDosGestos`); ninguém envia pelo Broadcast nos tópicos de gestos.
 */
export interface CanalDeGestos {
  aoAviso(f: () => void): () => void
  aoMudarEstado(f: (e: EstadoDoCanal) => void): () => void
  fechar(): Promise<void>
}

/** Cada chamada devolve uma alça nova do tópico da própria sessão (a estrutura de arquivos do PLA-006 a põe na Tarefa 1). */
export interface FabricaDeCanaisDeGestos {
  gestos(): CanalDeGestos
}

/** As funções do banco do aparelho que reconhece (D2, D5). */
export interface RepositorioDosGestos {
  /** `situacao_dos_gestos()`. */
  situacao(): Promise<{ ligados: boolean; reconhecerAqui: boolean }>
  /** `rpc('enviar_gesto', { p_id, p_gesto })`: só o uuid e o nome do gesto saem do aparelho (D8). */
  enviar(g: { id: string; gesto: Gesto }): Promise<RespostaDoGesto>
}
