import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ESPERA_DO_RECONHECEDOR_MS } from '../../domains/captura/gestos'
import type { QuadroDeVideo } from '../../domains/captura/portas'
import { criarFabricaDeReconhecedores } from './reconhecedorMediapipe'

/*
 * O reconhecedor do lado da página (PLA-006, D8, D11; registro VER-063). `Worker` falso injetado (o worker real do
 * MediaPipe não roda no Node): guarda as mensagens e os transferíveis e deixa o teste responder pelo `onmessage`. O
 * `agendar` é manual: as respostas só resolvem quando o teste roda a fila (nenhuma resolução dentro do `onmessage`).
 */

class WorkerFalso {
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onmessageerror: ((e: unknown) => void) | null = null
  readonly postados: { mensagem: unknown; transferir: unknown[] }[] = []
  terminados = 0
  postMessage(mensagem: unknown, transferir: unknown[] = []): void {
    this.postados.push({ mensagem, transferir })
  }
  terminate(): void {
    this.terminados += 1
  }
  responder(data: unknown): void {
    this.onmessage?.({ data })
  }
}

function montar() {
  const workers: WorkerFalso[] = []
  const fila: { f: () => void; ms: number; cancelado: boolean }[] = []
  const fabrica = criarFabricaDeReconhecedores({
    criarWorker: () => {
      const w = new WorkerFalso()
      workers.push(w)
      return w as unknown as Worker
    },
    agendar: (f, ms) => {
      const item = { f, ms, cancelado: false }
      fila.push(item)
      return () => {
        item.cancelado = true
      }
    },
  })
  return {
    fabrica,
    workers,
    fila,
    /** Roda os agendamentos com `ms` até `ate` (os de 0 ms, por padrão), na ordem. */
    rodar(ate = 0): void {
      for (let i = 0; i < fila.length; i++) {
        const item = fila[i]
        if (!item.cancelado && item.ms <= ate) {
          item.cancelado = true
          item.f()
        }
      }
    },
  }
}

function quadroFalso() {
  const q = { close: vi.fn() }
  return { q, quadro: q as unknown as QuadroDeVideo }
}

/** Deixa as promessas resolvidas rodarem os `then`. */
const microtarefas = () => new Promise<void>((r) => setTimeout(r, 0))

// o Node não tem `Worker` global: cada teste parte de um navegador com suporte (o `WebAssembly` do Node é o real)
beforeEach(() => {
  vi.stubGlobal('Worker', class {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function pronto(m: ReturnType<typeof montar>) {
  const r = m.fabrica.criar()
  const p = r.iniciar()
  m.workers[0].responder({ tipo: 'pronto' })
  m.rodar()
  expect(await p).toEqual({ ok: true })
  return r
}

describe('criarFabricaDeReconhecedores', () => {
  test('preguiçoso: criar não cria worker; iniciar cria um e pede iniciar', async () => {
    const m = montar()
    const r = m.fabrica.criar()
    expect(m.workers).toEqual([])
    void r.iniciar()
    expect(m.workers).toHaveLength(1)
    expect(m.workers[0].postados).toEqual([{ mensagem: { tipo: 'iniciar' }, transferir: [] }])
  })

  test.each([
    ['sem Worker', 'Worker'],
    ['sem WebAssembly', 'WebAssembly'],
  ])('sem-suporte: %s → sem_suporte, nenhum worker criado', async (_nome, global) => {
    vi.stubGlobal(global, undefined)
    const m = montar()
    expect(await m.fabrica.criar().iniciar()).toEqual({ ok: false, motivo: 'sem_suporte' })
    expect(m.workers).toEqual([])
  })

  test('iniciar-com-prazo: sem pronto em 60 000 ms → tempo e terminate', async () => {
    const m = montar()
    const p = m.fabrica.criar().iniciar()
    expect(ESPERA_DO_RECONHECEDOR_MS).toBe(60_000)
    expect(m.fila.filter((i) => !i.cancelado).map((i) => i.ms)).toEqual([60_000])
    m.rodar(59_999)
    await microtarefas()
    expect(m.workers[0].terminados).toBe(0)
    m.rodar(60_000)
    expect(await p).toEqual({ ok: false, motivo: 'tempo' })
    expect(m.workers[0].terminados).toBe(1)
    // um pronto atrasado não muda nada
    m.workers[0].responder({ tipo: 'pronto' })
    m.rodar()
    expect(m.workers[0].terminados).toBe(1)
  })

  test('pronto a tempo cancela o prazo; falha do worker → o motivo e terminate', async () => {
    const m = montar()
    await pronto(m)
    expect(m.fila.find((i) => i.ms === 60_000)?.cancelado).toBe(true)
    for (const motivo of ['sem_suporte', 'integridade', 'outro'] as const) {
      const n = montar()
      const p = n.fabrica.criar().iniciar()
      n.workers[0].responder({ tipo: 'falha', motivo })
      n.rodar()
      expect(await p).toEqual({ ok: false, motivo })
      expect(n.workers[0].terminados).toBe(1)
    }
    const e = montar()
    const p = e.fabrica.criar().iniciar()
    e.workers[0].onerror?.({})
    e.rodar()
    expect(await p).toEqual({ ok: false, motivo: 'outro' })
    expect(e.workers[0].terminados).toBe(1)
    const f = montar()
    const pf = f.fabrica.criar().iniciar()
    f.workers[0].responder({ tipo: 'falha', motivo: 'inventado' })
    f.rodar()
    expect(await pf).toEqual({ ok: false, motivo: 'outro' })
  })

  test('um-quadro-transferido: o postMessage leva o quadro na lista de transferíveis', async () => {
    const m = montar()
    const r = await pronto(m)
    const { quadro } = quadroFalso()
    void r.reconhecer(quadro, 1234)
    expect(m.workers[0].postados[1]).toEqual({ mensagem: { tipo: 'quadro', quadro, em: 1234 }, transferir: [quadro] })
  })

  test('resposta-adiada: nenhuma resolução dentro do onmessage; a leitura chega pelo agendar(0)', async () => {
    const m = montar()
    const r = m.fabrica.criar()
    let iniciou = false
    void r.iniciar().then(() => {
      iniciou = true
    })
    m.workers[0].responder({ tipo: 'pronto' })
    await microtarefas()
    expect(iniciou).toBe(false)
    m.rodar()
    await microtarefas()
    expect(iniciou).toBe(true)

    let leitura: unknown = 'pendente'
    void r.reconhecer(quadroFalso().quadro, 1).then((l) => {
      leitura = l
    })
    m.workers[0].responder({ tipo: 'leitura', gesto: 'Victory', confianca: 0.9, ms: 12 })
    await microtarefas()
    expect(leitura).toBe('pendente')
    m.rodar()
    await microtarefas()
    expect(leitura).toEqual({ gesto: 'Victory', confianca: 0.9, ms: 12 })
  })

  test('leituras em ordem; sem_leitura e leitura fora da forma → null', async () => {
    const m = montar()
    const r = await pronto(m)
    const a = r.reconhecer(quadroFalso().quadro, 1)
    const b = r.reconhecer(quadroFalso().quadro, 2)
    const c = r.reconhecer(quadroFalso().quadro, 3)
    const d = r.reconhecer(quadroFalso().quadro, 4)
    m.workers[0].responder({ tipo: 'leitura', gesto: null, confianca: 0.2, ms: 5 })
    m.workers[0].responder({ tipo: 'sem_leitura' })
    m.workers[0].responder({ tipo: 'leitura', gesto: 'None', confianca: 0.9, ms: 5 })
    m.workers[0].responder({ tipo: 'leitura', gesto: 'Victory', confianca: 2, ms: 5, quadro: 'x' })
    m.rodar()
    expect(await a).toEqual({ gesto: null, confianca: 0.2, ms: 5 })
    expect(await b).toBeNull()
    expect(await c).toBeNull()
    expect(await d).toBeNull()
  })

  test.each([['onerror'], ['onmessageerror']] as const)(
    'worker-morto-depois-do-pronto (%s): terminate, pendentes e reconhecer seguinte rejeitam e o quadro é fechado (rodada 1, I1 e N6)',
    async (evento) => {
      const m = montar()
      const r = await pronto(m)
      const p1 = r.reconhecer(quadroFalso().quadro, 1)
      const p2 = r.reconhecer(quadroFalso().quadro, 2)
      m.workers[0][evento]?.({})
      await microtarefas()
      expect(m.workers[0].terminados).toBe(0) // adiado: nada dentro do callback do worker
      m.rodar()
      expect(m.workers[0].terminados).toBe(1)
      await expect(p1).rejects.toThrow('reconhecedor encerrado')
      await expect(p2).rejects.toThrow('reconhecedor encerrado')
      const depois = quadroFalso()
      await expect(r.reconhecer(depois.quadro, 3)).rejects.toThrow('reconhecedor encerrado')
      expect(depois.q.close).toHaveBeenCalledTimes(1)
      expect(m.workers[0].postados).toHaveLength(3) // iniciar + 2 quadros; nada depois da morte
      // o fechar pedido depois da morte: sem erro, sem segundo terminate, e daí em diante null
      r.fechar()
      expect(m.workers[0].terminados).toBe(1)
      expect(await r.reconhecer(quadroFalso().quadro, 4)).toBeNull()
    },
  )

  test('postMessage que lança: o quadro é fechado e a leitura é null (falha só deste quadro)', async () => {
    const m = montar()
    const r = await pronto(m)
    m.workers[0].postMessage = () => {
      throw new DOMException('quadro já transferido', 'DataCloneError')
    }
    const f = quadroFalso()
    expect(await r.reconhecer(f.quadro, 1)).toBeNull()
    expect(f.q.close).toHaveBeenCalledTimes(1)
    expect(m.workers[0].terminados).toBe(0)
  })

  test('leitura com ms negativo ou não finito → null', async () => {
    const m = montar()
    const r = await pronto(m)
    const a = r.reconhecer(quadroFalso().quadro, 1)
    const b = r.reconhecer(quadroFalso().quadro, 2)
    const c = r.reconhecer(quadroFalso().quadro, 3)
    m.workers[0].responder({ tipo: 'leitura', gesto: null, confianca: 0.1, ms: -1 })
    m.workers[0].responder({ tipo: 'leitura', gesto: null, confianca: 0.1, ms: Number.POSITIVE_INFINITY })
    m.workers[0].responder({ tipo: 'leitura', gesto: 'Victory', confianca: 0.9, ms: 0 })
    m.rodar()
    expect(await a).toBeNull()
    expect(await b).toBeNull()
    expect(await c).toEqual({ gesto: 'Victory', confianca: 0.9, ms: 0 })
  })

  test('reconhecer sem pronto ou depois de fechar: null sem postar, e o quadro é fechado', async () => {
    const m = montar()
    const r = m.fabrica.criar()
    const antes = quadroFalso()
    expect(await r.reconhecer(antes.quadro, 1)).toBeNull()
    expect(antes.q.close).toHaveBeenCalledTimes(1)
    expect(m.workers).toEqual([])
  })

  test('fechar-encerra-o-worker: terminate uma vez; pendentes resolvem null; segunda chamada sem erro', async () => {
    const m = montar()
    const r = await pronto(m)
    const p1 = r.reconhecer(quadroFalso().quadro, 1)
    const p2 = r.reconhecer(quadroFalso().quadro, 2)
    r.fechar()
    expect(m.workers[0].terminados).toBe(1)
    expect(await p1).toBeNull()
    expect(await p2).toBeNull()
    expect(() => r.fechar()).not.toThrow()
    expect(m.workers[0].terminados).toBe(1)
    const depois = quadroFalso()
    expect(await r.reconhecer(depois.quadro, 3)).toBeNull()
    expect(depois.q.close).toHaveBeenCalledTimes(1)
    expect(m.workers[0].postados).toHaveLength(3)
  })

  test('fechar-encerra-o-worker: fechar durante o iniciar → outro e terminate; iniciar depois de fechar não cria worker (VER-058)', async () => {
    const m = montar()
    const r = m.fabrica.criar()
    const p = r.iniciar()
    r.fechar()
    expect(await p).toEqual({ ok: false, motivo: 'outro' })
    expect(m.workers[0].terminados).toBe(1)
    expect(m.fila.every((i) => i.cancelado)).toBe(true)
    const n = montar()
    const s = n.fabrica.criar()
    s.fechar()
    expect(await s.iniciar()).toEqual({ ok: false, motivo: 'outro' })
    expect(n.workers).toEqual([])
  })

  test('iniciar duas vezes: um worker e a mesma resposta', async () => {
    const m = montar()
    const r = m.fabrica.criar()
    const a = r.iniciar()
    const b = r.iniciar()
    m.workers[0].responder({ tipo: 'pronto' })
    m.rodar()
    expect(await a).toEqual({ ok: true })
    expect(await b).toEqual({ ok: true })
    expect(m.workers).toHaveLength(1)
  })

  test('criarWorker que lança → outro, sem worker', async () => {
    const fabrica = criarFabricaDeReconhecedores({
      criarWorker: () => {
        throw new Error('SecurityError')
      },
      agendar: () => () => undefined,
    })
    expect(await fabrica.criar().iniciar()).toEqual({ ok: false, motivo: 'outro' })
  })
})
