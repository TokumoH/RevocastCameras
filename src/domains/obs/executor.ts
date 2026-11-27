import type { AcaoNoObs } from '../aovivo/comandos'
import type { MotivoDoResultado, ResultadoDoComando, SituacaoDoObs } from '../aovivo/mensagens'
import type { ExecutorDeAcoes } from '../aovivo/portas'
import { NIVEL_DE_CONTROLE, type MarcadorObs, type ObsNoNavegador } from './portas'

/** Espera entre o pedido de clipe e o `saveReplayBuffer`, para o clipe pegar a reação (DES-001 §10.1 e §16). */
export const ESPERA_DO_CLIPE_MS = 5000

type Resposta = { resultado: ResultadoDoComando; motivo: MotivoDoResultado | null }

/** O executor do palco, com a leitura da situação do OBS para o estado no ar e a presença (D13). */
export interface ExecutorObs extends ExecutorDeAcoes {
  /** Lê de novo nível, saídas, versão e a cena atual do OBS e devolve a situação atualizada (uma cópia). */
  atualizarSituacao(): Promise<SituacaoDoObs>
  /**
   * A cena do programa no OBS: a lida por `getCurrentScene` na última `atualizarSituacao` (só com nível
   * READ_USER ou mais) ou a que o próprio executor acabou de trocar; sem OBS, sem permissão ou ainda não
   * lida → `null` (VER-044 A1, D9).
   */
  cenaAtual(): string | null
  /**
   * Para o executor (a rota do palco chama junto com `palco.parar()`, ao trocar de episódio ou sair):
   * o clipe que ainda espera os 5 s não é salvo, e toda ação seguinte responde `falhou` sem chamar nada.
   */
  parar(): void
}

/** Estados do websocket sem conexão identificada. */
type EstadoForaDoAr = 'desligado' | 'senha_errada' | 'sem_conexao'

export interface DependenciasDoExecutor {
  obs: ObsNoNavegador
  /** obs-websocket conectado, ou `null` (sem senha configurada, senha errada, sem conexão). Se cair depois, `conectado()` passa a falso e o executor o trata como ausente. Só o pedaço que o executor usa (`MarcadorObs`, N1). */
  ws: MarcadorObs | null
  /** Som da própria página (`<audio>` com a URL assinada); `false` se não tocou. */
  tocarSom(somId: string, volume: number): Promise<boolean>
  mostrarAviso(id: string, duracaoS: number): void
  ocultarAviso(): void
  agendar(f: () => void, ms: number): void
  /**
   * O que a situação diz do websocket quando ele não está conectado. Valor fixo: vale só com `ws` nulo
   * (padrão `desligado`; com objeto caído, `sem_conexao`). Função: lida a cada situação, com ou sem objeto,
   * para a rota mudar o estado (desligado, senha recusada, sem conexão) sem recriar o executor (Tarefa 6).
   * Nunca a senha.
   */
  estadoDoWebsocket?: EstadoForaDoAr | (() => EstadoForaDoAr)
}

const ok = (): Resposta => ({ resultado: 'ok', motivo: null })
const recusado = (motivo: MotivoDoResultado): Resposta => ({ resultado: 'recusado', motivo })
const falhou = (motivo: MotivoDoResultado | null): Resposta => ({ resultado: 'falhou', motivo })

/**
 * Executa as ações do palco no OBS e na própria página (D1, D9, D10). Tabela de cada ação, com a
 * chamada do OBS e o nível exigido, no README de `src/domains/obs/`. Regras:
 * - cena, clipe e marcador sem `window.obsstudio` → `falhou`/`obs_ausente`; som e aviso são da página;
 * - nível abaixo do exigido (ou desconhecido) → `recusado`/`sem_permissao`, sem chamar o OBS;
 * - cena só se o nome exato estiver na lista do OBS (senão `recusado`/`cena_inexistente_no_obs`);
 * - clipe só com o Replay Buffer ativo; um pendente por vez (repetido → `pendente`, ignorado);
 *   o `saveReplayBuffer` sai depois de `ESPERA_DO_CLIPE_MS`, e a promessa resolve `ok` nessa hora;
 * - marcador pelo obs-websocket, só com a gravação em andamento quando o status é conhecido;
 *   capítulo recusado pelo OBS → `falhou`/`sem_gravacao`.
 * O motivo é sempre da lista fixa (`MOTIVOS_DO_RESULTADO`), nunca texto do OBS.
 */
export function criarExecutorObs(d: DependenciasDoExecutor): ExecutorObs {
  let clipePendente = false
  let parado = false
  const lido: { nivel: number | null; replayBuffer: boolean | null; gravando: boolean | null; versaoObs: string | null; cena: string | null } = {
    nivel: null,
    replayBuffer: null,
    gravando: null,
    versaoObs: null,
    cena: null,
  }

  async function lerNivel(): Promise<number | null> {
    const nivel = await d.obs.nivel()
    lido.nivel = nivel
    return nivel
  }

  async function lerStatus() {
    const status = await d.obs.status()
    lido.replayBuffer = status === null ? null : status.replayBuffer
    lido.gravando = status === null ? null : status.gravando
    return status
  }

  const permite = (nivel: number | null, exigido: number) => nivel !== null && nivel >= exigido

  async function trocarCena(nomeObs: string): Promise<Resposta> {
    if (!d.obs.disponivel()) return falhou('obs_ausente')
    if (!permite(await lerNivel(), NIVEL_DE_CONTROLE.ADVANCED)) return recusado('sem_permissao')
    const cenas = await d.obs.cenas()
    if (cenas === null || !cenas.includes(nomeObs)) return recusado('cena_inexistente_no_obs')
    d.obs.trocarCena(nomeObs)
    lido.cena = nomeObs
    return ok()
  }

  async function salvarClipe(): Promise<Resposta> {
    if (!d.obs.disponivel()) return falhou('obs_ausente')
    if (clipePendente) return { resultado: 'pendente', motivo: null }
    clipePendente = true
    try {
      if (!permite(await lerNivel(), NIVEL_DE_CONTROLE.BASIC)) return recusado('sem_permissao')
      const status = await lerStatus()
      if (status === null || !status.replayBuffer) return falhou('replay_desligado')
      await new Promise<void>((resolver) => d.agendar(resolver, ESPERA_DO_CLIPE_MS))
      if (parado) return falhou(null)
      d.obs.salvarClipe()
      return ok()
    } finally {
      clipePendente = false
    }
  }

  async function marcar(nome: string): Promise<Resposta> {
    if (!d.obs.disponivel()) return falhou('obs_ausente')
    if (!wsConectado()) return falhou('sem_websocket')
    if (permite(await lerNivel(), NIVEL_DE_CONTROLE.READ_OBS)) {
      const status = await lerStatus()
      if (status !== null && !status.gravando) return falhou('sem_gravacao')
    }
    const ws = d.ws as MarcadorObs
    if (await ws.marcar(nome)) return ok()
    // caiu durante o pedido: não é falta de gravação
    return wsConectado() ? falhou('sem_gravacao') : falhou('sem_websocket')
  }

  function wsConectado(): boolean {
    return d.ws !== null && d.ws.conectado()
  }

  function estadoDoWebsocket(): SituacaoDoObs['websocket'] {
    if (wsConectado()) return 'conectado'
    if (typeof d.estadoDoWebsocket === 'function') return d.estadoDoWebsocket()
    return d.ws === null ? (d.estadoDoWebsocket ?? 'desligado') : 'sem_conexao'
  }

  function situacao(): SituacaoDoObs {
    const navegador = d.obs.disponivel()
    return {
      navegador,
      versaoDoPlugin: navegador ? d.obs.versaoDoPlugin() : null,
      nivel: navegador ? lido.nivel : null,
      websocket: estadoDoWebsocket(),
      versaoObs: wsConectado() ? lido.versaoObs : null,
      replayBuffer: navegador ? lido.replayBuffer : null,
      gravando: navegador ? lido.gravando : null,
    }
  }

  return {
    async executar(a: AcaoNoObs): Promise<Resposta> {
      if (parado) return falhou(null)
      switch (a.tipo) {
        case 'trocar_cena':
          return trocarCena(a.nomeObs)
        case 'salvar_clipe':
          return salvarClipe()
        case 'marcar':
          return marcar(a.nome)
        case 'tocar_som':
          return (await d.tocarSom(a.somId, a.volume)) ? ok() : falhou(null)
        case 'mostrar_aviso':
          d.mostrarAviso(a.avisoId, a.duracaoS)
          return ok()
        case 'ocultar_aviso':
          d.ocultarAviso()
          return ok()
      }
    },
    situacao,
    cenaAtual: () => (d.obs.disponivel() ? lido.cena : null),
    async atualizarSituacao() {
      if (d.obs.disponivel()) {
        const nivel = await lerNivel()
        if (permite(nivel, NIVEL_DE_CONTROLE.READ_OBS)) await lerStatus()
        else lido.replayBuffer = lido.gravando = null
        // getCurrentScene exige READ_USER: abaixo dele (ou desconhecido), a cena fica "não se sabe"
        lido.cena = permite(nivel, NIVEL_DE_CONTROLE.READ_USER) ? await d.obs.cenaAtual() : null
      } else lido.cena = null
      lido.versaoObs = d.ws !== null && wsConectado() ? await d.ws.versao() : null
      return situacao()
    },
    parar() {
      parado = true
    },
  }
}
