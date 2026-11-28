import { ESPERA_DO_RECONHECEDOR_MS, ehGesto, type LeituraDoGesto } from '../../domains/captura/gestos'
import type { FabricaDeReconhecedores, FalhaDoReconhecedor, QuadroDeVideo, ReconhecedorDeGestos } from '../../domains/captura/portas'

/*
 * O reconhecedor de gestos do lado da página (DES-001 §6.1; PLA-006, D8, D9, D11; registro VER-063): a porta
 * `ReconhecedorDeGestos` sobre o Web Worker de módulo `reconhecedor.worker.ts`. O worker só nasce no `iniciar` (D11) e
 * morre no `fechar` (`terminate`: solta a memória do WASM e o GPU). O quadro vai transferido (a página não o guarda) e
 * volta só `{ gesto, confianca, ms }` (D8).
 */

export interface DependenciasDoReconhecedor {
  /** Padrão: `new Worker(new URL('./reconhecedor.worker.ts', import.meta.url), { type: 'module' })` (formato `es`, N6). */
  criarWorker?: () => Worker
  /** Padrão: `setTimeout`. As respostas do worker resolvem por `agendar(0)`, nunca dentro do `onmessage`. */
  agendar?: (f: () => void, ms: number) => () => void
}

/** A rejeição do `reconhecer` quando o worker morreu depois do `pronto` (texto fixo, sem dados do quadro). */
const MENSAGEM_DA_MORTE = 'reconhecedor encerrado'

const MOTIVOS_DO_WORKER: readonly FalhaDoReconhecedor[] = ['sem_suporte', 'integridade', 'outro']

function criarWorkerPadrao(): Worker {
  return new Worker(new URL('./reconhecedor.worker.ts', import.meta.url), { type: 'module' })
}

function agendarPadrao(f: () => void, ms: number): () => void {
  const t = setTimeout(f, ms)
  return () => clearTimeout(t)
}

/** O navegador tem `Worker` e `WebAssembly`, lidos na hora (D11: sem um deles, `sem_suporte`). */
function temSuporte(): boolean {
  const g = globalThis as { Worker?: unknown; WebAssembly?: unknown }
  return typeof g.Worker === 'function' && typeof g.WebAssembly === 'object' && g.WebAssembly !== null
}

function fecharQuadro(q: QuadroDeVideo): void {
  try {
    ;(q as unknown as { close?: () => void }).close?.()
  } catch {
    /* já transferido ou solto */
  }
}

/** A leitura que o worker mandou, conferida (gesto entre os 7 ou `null`; confiança de 0 a 1; ms finito ≥ 0) e copiada campo a campo; fora disso, `null`. */
function lerLeitura(m: { gesto?: unknown; confianca?: unknown; ms?: unknown }): LeituraDoGesto | null {
  const { gesto, confianca, ms } = m
  if (gesto !== null && !ehGesto(gesto)) return null
  if (typeof confianca !== 'number' || !Number.isFinite(confianca) || confianca < 0 || confianca > 1) return null
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null
  return { gesto, confianca, ms }
}

type Inicio = { ok: true } | { ok: false; motivo: FalhaDoReconhecedor }

/**
 * A fábrica (uma por página): `criar()` não cria worker. Cada reconhecedor:
 * - `iniciar`: sem `Worker` ou `WebAssembly` → `sem_suporte` sem criar nada; fechado antes → `outro` sem criar nada
 *   (VER-058, Riscos); senão cria o worker, manda `{ tipo: 'iniciar' }` e espera `pronto` ou `falha` por
 *   `ESPERA_DO_RECONHECEDOR_MS` (60 s; sem resposta → `tempo`); qualquer falha (inclusive `onerror` e o worker que não
 *   nasce) encerra o worker. A mesma promessa nas chamadas seguintes.
 * - `reconhecer`: só com o worker pronto; o quadro vai na lista de transferíveis; as respostas chegam em ordem (o worker
 *   atende uma mensagem por vez). Sem worker pronto → `null` e o quadro é fechado aqui; `postMessage` que lança → `null`
 *   (falha só deste quadro). Erro do worker depois do `pronto` (`onerror`/`onmessageerror`) → `terminate`, os pendentes
 *   e todo `reconhecer` seguinte **rejeitam** (o quadro é fechado): pela porta, o reconhecedor morreu e o laço vai a
 *   `falhou` (VER-063, rodada 1, N6).
 * - `fechar`: `terminate` uma vez, cancela o prazo e resolve o que estiver pendente (`outro` no `iniciar`, `null` nos
 *   quadros); idempotente.
 */
export function criarFabricaDeReconhecedores(d: DependenciasDoReconhecedor = {}): FabricaDeReconhecedores {
  const criarWorker = d.criarWorker ?? criarWorkerPadrao
  const agendar = d.agendar ?? agendarPadrao

  function criar(): ReconhecedorDeGestos {
    let worker: Worker | null = null
    let fechado = false
    let pronto = false
    let inicio: Promise<Inicio> | null = null
    let resolverInicio: ((r: Inicio) => void) | null = null
    let cancelarPrazo: (() => void) | null = null
    /** O worker morreu depois do `pronto` (erro não capturado): todo `reconhecer` rejeita, para o laço chegar a `falhou`. */
    let morto = false
    const pendentes: { resolver: (l: LeituraDoGesto | null) => void; rejeitar: (e: Error) => void }[] = []

    /** Solta o worker; `morte` = erro do worker já pronto (pendentes rejeitam), senão pedido ou falha do início (pendentes `null`). */
    function encerrar(morte = false): void {
      cancelarPrazo?.()
      cancelarPrazo = null
      const w = worker
      worker = null
      pronto = false
      if (w !== null) {
        w.onmessage = null
        w.onerror = null
        w.onmessageerror = null
        try {
          w.terminate()
        } catch {
          /* já encerrado */
        }
      }
      if (morte) morto = true
      for (const p of pendentes.splice(0)) {
        if (morte) p.rejeitar(new Error(MENSAGEM_DA_MORTE))
        else p.resolver(null)
      }
    }

    function terminarInicio(r: Inicio): void {
      const resolver = resolverInicio
      resolverInicio = null
      if (resolver === null) return
      if (r.ok) {
        cancelarPrazo?.()
        cancelarPrazo = null
        pronto = true
      } else {
        encerrar()
      }
      resolver(r)
    }

    function aoMensagem(dados: unknown): void {
      if (typeof dados !== 'object' || dados === null) return
      const m = dados as { tipo?: unknown; motivo?: unknown; gesto?: unknown; confianca?: unknown; ms?: unknown }
      if (m.tipo === 'pronto') terminarInicio({ ok: true })
      else if (m.tipo === 'falha') {
        const motivo = MOTIVOS_DO_WORKER.find((x) => x === m.motivo) ?? 'outro'
        terminarInicio({ ok: false, motivo })
      } else if (m.tipo === 'leitura' || m.tipo === 'sem_leitura') {
        pendentes.shift()?.resolver(m.tipo === 'leitura' ? lerLeitura(m) : null)
      }
    }

    function comecar(): Promise<Inicio> {
      if (fechado) return Promise.resolve({ ok: false, motivo: 'outro' })
      if (!temSuporte()) return Promise.resolve({ ok: false, motivo: 'sem_suporte' })
      let w: Worker
      try {
        w = criarWorker()
      } catch {
        return Promise.resolve({ ok: false, motivo: 'outro' })
      }
      worker = w
      const promessa = new Promise<Inicio>((r) => {
        resolverInicio = r
      })
      // nada resolve dentro do callback do worker: a resposta é tratada no próximo giro (`agendar(0)`)
      w.onmessage = (e: MessageEvent) => {
        const dados: unknown = e.data
        agendar(() => {
          if (worker === w) aoMensagem(dados)
        }, 0)
      }
      const falhar = () => {
        agendar(() => {
          if (worker === w) {
            if (resolverInicio !== null) terminarInicio({ ok: false, motivo: 'outro' })
            else encerrar(true)
          }
        }, 0)
      }
      w.onerror = falhar
      w.onmessageerror = falhar
      cancelarPrazo = agendar(() => {
        cancelarPrazo = null
        terminarInicio({ ok: false, motivo: 'tempo' })
      }, ESPERA_DO_RECONHECEDOR_MS)
      try {
        w.postMessage({ tipo: 'iniciar' })
      } catch {
        terminarInicio({ ok: false, motivo: 'outro' })
      }
      return promessa
    }

    return {
      iniciar() {
        inicio ??= comecar()
        return inicio
      },
      reconhecer(q, em) {
        const w = worker
        if (morto && !fechado) {
          fecharQuadro(q)
          return Promise.reject(new Error(MENSAGEM_DA_MORTE))
        }
        if (fechado || !pronto || w === null) {
          fecharQuadro(q)
          return Promise.resolve(null)
        }
        return new Promise<LeituraDoGesto | null>((resolver, rejeitar) => {
          try {
            w.postMessage({ tipo: 'quadro', quadro: q, em }, [q as unknown as Transferable])
            pendentes.push({ resolver, rejeitar })
          } catch {
            fecharQuadro(q)
            resolver(null)
          }
        })
      },
      fechar() {
        if (fechado) return
        fechado = true
        terminarInicio({ ok: false, motivo: 'outro' })
        encerrar()
      },
    }
  }

  return { criar }
}
