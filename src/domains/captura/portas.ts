import type { EstadoDoCanal } from '../aovivo/portas'
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
  /** `rpc('enviar_sinal_de_video')`; nunca Broadcast direto. */
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
  criar(): ConexaoDeVideo
}

export type FalhaDaCamera = 'sem_permissao' | 'sem_camera' | 'inseguro' | 'outro'

/** A câmera traseira, só vídeo (D7). */
export interface CameraDoAparelho {
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
