import { describe, test, expect } from 'vitest'
import { RELEITURAS_PARA_LIBERAR, SELO_VISIVEL_MS, SITUACAO_A_CADA_MS, criarGuardaDaSaida, saidaParada } from './saida'
import type { ObsNoNavegador, StatusDaSaida } from './portas'

/**
 * OBS falso para a guarda (VER-046; movida do `PalcoNoAr.tsx` no VER-053): disponível ou não, nível e status programáveis.
 * `segurarStatus` faz o próximo `status()` esperar `soltar()` (para simular um evento que chega durante a leitura).
 */
function obsFalso(o: { disponivel?: boolean; nivel?: number | null; status?: Partial<StatusDaSaida> | null } = {}) {
  const estado = {
    disponivel: o.disponivel ?? true,
    nivel: o.nivel === undefined ? 4 : o.nivel,
    status: o.status === null ? null : ({ gravando: false, replayBuffer: false, transmitindo: false, cameraVirtual: false, ...o.status } as StatusDaSaida | null),
    leituras: 0,
  }
  let segurar = false
  let soltar: (() => void) | null = null
  const obs: ObsNoNavegador = {
    disponivel: () => estado.disponivel,
    versaoDoPlugin: () => null,
    nivel: async () => estado.nivel,
    cenas: async () => null,
    cenaAtual: async () => null,
    status: async () => {
      estado.leituras++
      if (segurar) {
        segurar = false
        await new Promise<void>((r) => (soltar = r))
      }
      return estado.status === null ? null : { ...estado.status }
    },
    aoMudarSaida: () => () => {},
    aoMudarCena: () => () => {},
    trocarCena: () => {},
    salvarClipe: () => {},
  }
  return {
    obs,
    estado,
    segurarStatus() {
      segurar = true
    },
    soltar() {
      soltar?.()
    },
  }
}

const esvaziar = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('guarda da saída do OBS (VER-046; em domains/obs desde o VER-053)', () => {
  test('constantes movidas sem mudar valor', () => {
    expect(RELEITURAS_PARA_LIBERAR).toBe(2)
    expect(SITUACAO_A_CADA_MS).toBe(15_000)
    expect(SELO_VISIVEL_MS).toBe(5000)
  })

  test.each([
    ['parada', {}, true],
    ['transmitindo', { status: { transmitindo: true } }, false],
    ['gravando', { status: { gravando: true } }, false],
    ['Replay Buffer', { status: { replayBuffer: true } }, false],
    ['câmera virtual', { status: { cameraVirtual: true } }, false],
    ['status null', { status: null }, false],
    ['nível null', { nivel: null }, false],
    ['nível abaixo de READ_OBS', { nivel: 0 }, false],
    ['nível READ_OBS basta', { nivel: 1 }, true],
    ['sem window.obsstudio', { disponivel: false }, false],
  ] as const)('saidaParada: %s', async (_nome, o, esperado) => {
    const f = obsFalso(o)
    expect(await saidaParada(f.obs)).toBe(esperado)
  })

  test('sem evento de início, livre() é a saidaParada', async () => {
    const f = obsFalso()
    const g = criarGuardaDaSaida(f.obs)
    expect(await g.livre()).toBe(true)
    f.estado.status = { gravando: true, replayBuffer: false, transmitindo: false, cameraVirtual: false }
    expect(await g.livre()).toBe(false)
  })

  test('início sem fim recusa, mesmo com o status ainda "parado" (a janela entre o Starting e o Started)', async () => {
    const f = obsFalso()
    const g = criarGuardaDaSaida(f.obs)
    g.evento('inicio', 'Streaming')
    expect(await g.livre()).toBe(false)
    // o fim de outra saída não libera
    g.evento('fim', 'Recording')
    expect(await g.livre()).toBe(false)
  })

  test('o *Stopped da mesma saída libera', async () => {
    const f = obsFalso()
    const g = criarGuardaDaSaida(f.obs)
    g.evento('inicio', 'Recording')
    expect(await g.livre()).toBe(false)
    g.evento('fim', 'Recording')
    expect(await g.livre()).toBe(true)
  })

  test('duas releituras periódicas com a saída parada liberam (um início que falhou); uma só não', async () => {
    const f = obsFalso()
    const g = criarGuardaDaSaida(f.obs)
    g.evento('inicio', 'Replaybuffer')
    g.contarReleitura()
    expect(await g.livre()).toBe(false)
    g.contarReleitura()
    expect(await g.livre()).toBe(true)
    // liberado: um início novo recomeça a contagem
    g.evento('inicio', 'Streaming')
    expect(await g.livre()).toBe(false)
    g.contarReleitura()
    expect(await g.livre()).toBe(false)
  })

  test('releituras com a saída no ar não liberam, nem depois de pararem de contar', async () => {
    const f = obsFalso({ status: { transmitindo: true } })
    const g = criarGuardaDaSaida(f.obs)
    g.evento('inicio', 'Streaming')
    g.contarReleitura()
    g.contarReleitura()
    g.contarReleitura()
    expect(await g.livre()).toBe(false)
  })

  test('releituras sem início pendente não contam para um início que chega depois', async () => {
    const f = obsFalso()
    const g = criarGuardaDaSaida(f.obs)
    g.contarReleitura()
    g.contarReleitura()
    g.evento('inicio', 'Streaming')
    expect(await g.livre()).toBe(false)
  })

  test('início durante a leitura vence', async () => {
    const f = obsFalso()
    const g = criarGuardaDaSaida(f.obs)
    f.segurarStatus()
    const pedido = g.livre()
    await esvaziar()
    expect(f.estado.leituras).toBe(1)
    // a transmissão começa antes de o getStatus responder "parado"
    g.evento('inicio', 'Streaming')
    f.soltar()
    expect(await pedido).toBe(false)
  })

  test('nível abaixo de READ_OBS → false, mesmo depois do fim da saída', async () => {
    const f = obsFalso({ nivel: 0 })
    const g = criarGuardaDaSaida(f.obs)
    expect(await g.livre()).toBe(false)
    g.evento('inicio', 'Streaming')
    g.evento('fim', 'Streaming')
    expect(await g.livre()).toBe(false)
    expect(f.estado.leituras).toBe(0) // sem nível, o status nem é pedido
  })
})
