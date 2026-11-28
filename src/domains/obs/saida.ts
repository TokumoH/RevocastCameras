import { NIVEL_DE_CONTROLE } from './portas'
import type { ObsNoNavegador } from './portas'

/*
 * Guarda da saída do OBS (D10 e D16 do PLA-004; VER-046), movida do `src/app/telas/PalcoNoAr.tsx` sem mudar uma regra no
 * VER-053 (D8 do PLA-005): o palco (`/obs/palco`) e a câmera do OBS (`/obs/camera`) usam a mesma. Só conhece a porta
 * `ObsNoNavegador`; a casca React que esconde as telas de erro (`SoComSaidaParada`) fica em `TelaDeDispositivo.tsx`.
 */

/** O selo de estado fica visível por 5 s depois da tecla `s` (D16 do PLA-004; o mesmo no `/obs/camera`, D8 do PLA-005). */
export const SELO_VISIVEL_MS = 5000
/** A situação do OBS (nível, saídas, versão) é lida de novo a cada 15 s e a cada evento de saída (VER-039, Riscos). */
export const SITUACAO_A_CADA_MS = 15_000

/**
 * Saída do OBS parada **e** status conhecido (D10, D16): `window.obsstudio` presente, nível READ_OBS ou mais e
 * `getStatus` com transmissão, gravação, Replay Buffer e câmera virtual desligados. Qualquer dúvida → `false`.
 */
export async function saidaParada(obs: ObsNoNavegador): Promise<boolean> {
  if (!obs.disponivel()) return false
  const nivel = await obs.nivel()
  if (nivel === null || nivel < NIVEL_DE_CONTROLE.READ_OBS) return false
  const st = await obs.status()
  if (st === null) return false
  return !st.transmitindo && !st.gravando && !st.replayBuffer && !st.cameraVirtual
}

/** Releituras periódicas (a cada `SITUACAO_A_CADA_MS`) depois do último início de saída sem o fim, para voltar a confiar no status: 2, ao menos um período inteiro. */
export const RELEITURAS_PARA_LIBERAR = 2

/**
 * Guarda da saída do OBS (D10, D16; VER-046, rodada 1). O `getStatus` do obs-browser só marca a saída depois do
 * `*Started`; entre o `*Starting` e o `*Started` ele ainda diz "parada". Por isso, depois de um evento de início, a guarda
 * recusa até chegar o `*Stopped` da mesma saída ou até `RELEITURAS_PARA_LIBERAR` releituras periódicas seguidas
 * (`contarReleitura`) acharem a saída parada (um início que falhou e não teve fim). Sem bloqueio, vale `saidaParada`.
 * Usada pelas telas de erro (`SoComSaidaParada`), pelo selo e pelo painel de configuração do palco e pelo selo do
 * `/obs/camera`.
 */
export function criarGuardaDaSaida(obs: ObsNoNavegador): {
  evento(tipo: 'inicio' | 'fim', saida: string): void
  contarReleitura(): void
  livre(): Promise<boolean>
} {
  const iniciadas = new Set<string>()
  let releituras = 0
  return {
    evento(tipo, saida) {
      if (tipo === 'inicio') {
        iniciadas.add(saida)
        releituras = 0
      } else iniciadas.delete(saida)
    },
    contarReleitura() {
      if (iniciadas.size > 0) releituras++
    },
    async livre() {
      const parada = await saidaParada(obs)
      // conferido depois do `await`: um início que chega durante a leitura vence
      if (iniciadas.size > 0) {
        if (!parada || releituras < RELEITURAS_PARA_LIBERAR) return false
        iniciadas.clear()
      }
      return parada
    },
  }
}
