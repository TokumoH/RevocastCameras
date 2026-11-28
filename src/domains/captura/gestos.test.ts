import { describe, test, expect } from 'vitest'
import {
  CONFIANCA_MINIMA,
  ESPERA_DO_RECONHECEDOR_MS,
  EVENTOS_DOS_GESTOS,
  INTERVALO_DO_SERVIDOR_MS,
  INTERVALO_MS,
  JANELA_DA_MEDIA,
  MS_PARA_PARAR,
  MS_PARA_REDUZIR,
  QUADROS_POR_SEGUNDO,
  QUADROS_REDUZIDOS,
  SEGURAR_MS,
  SOLTAR_MS,
  TEMPO_LENTO_MS,
  TOLERANCIA_MS,
  lerAvisoDosGestos,
  lerGestoParaOPalco,
  lerSituacaoDosGestos,
  topicoDosGestos,
} from './gestos'

const USUARIO = '0b6e2b8a-3c1d-4f2a-9e5b-1a2b3c4d5e6f'
const GESTO_ID = '5d1e8a2c-7b3f-4e9a-8c6d-2f4a6b8c0d1e'
const DISPOSITIVO = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f2a3b4c5d'
const REMETENTE = 'c0ffee00-1111-4111-8111-11111111abcd'
const ID_DO_SEND = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

/** Como chega do banco (D2): os campos montados por `enviar_gesto` e o `id` que o `realtime.send` acrescenta. */
const DO_BANCO = { tipo: 'gesto', gesto_id: GESTO_ID, gesto: 'Victory', dispositivo: DISPOSITIVO, remetente: REMETENTE, id: ID_DO_SEND }

/** Igual a `JSON.parse` de um corpo malicioso: `__proto__` vira chave própria. */
const comProto = <T extends object>(m: T) => JSON.parse(JSON.stringify(m).replace(/^\{/, '{"__proto__":{"gesto":"ILoveYou"},')) as unknown

class Carta {
  tipo = 'gesto'
  gesto_id = GESTO_ID
  gesto = 'Victory'
  dispositivo = DISPOSITIVO
}

describe('constantes', () => {
  test('valores do plano (D3, D11)', () => {
    expect(SEGURAR_MS).toBe(1000)
    expect(INTERVALO_MS).toBe(3000)
    expect(INTERVALO_DO_SERVIDOR_MS).toBe(2500)
    expect(TOLERANCIA_MS).toBe(300)
    expect(SOLTAR_MS).toBe(500)
    expect(CONFIANCA_MINIMA).toBe(0.7)
    expect(QUADROS_POR_SEGUNDO).toBe(10)
    expect(QUADROS_REDUZIDOS).toBe(5)
    expect(JANELA_DA_MEDIA).toBe(20)
    expect(MS_PARA_REDUZIR).toBe(120)
    expect(MS_PARA_PARAR).toBe(400)
    expect(TEMPO_LENTO_MS).toBe(10_000)
    expect(ESPERA_DO_RECONHECEDOR_MS).toBe(60_000)
    expect(EVENTOS_DOS_GESTOS).toEqual({ gesto: 'gesto', gestosMudaram: 'gestos_mudaram' })
    expect(Object.isFrozen(EVENTOS_DOS_GESTOS)).toBe(true)
  })
})

describe('topico-dos-gestos', () => {
  test('gestos:<uuid minúsculo da sessão>', () => {
    expect(topicoDosGestos(USUARIO)).toBe(`gestos:${USUARIO}`)
  })

  test.each<[string, string]>([
    ['maiúsculas', USUARIO.toUpperCase()],
    ['vazio', ''],
    ['com espaço no fim', `${USUARIO} `],
    ['sem hífens', USUARIO.replaceAll('-', '')],
    ['com sufixo', `${USUARIO}:x`],
    ['texto qualquer', 'palco'],
  ])('%s → lança', (_nome, id) => {
    expect(() => topicoDosGestos(id)).toThrow()
  })
})

describe('le-gesto-para-o-palco', () => {
  test('aceita a forma certa (com o id do realtime.send, ignorado) e devolve objeto novo só com id, gesto e dispositivoId', () => {
    const lido = lerGestoParaOPalco('gesto', DO_BANCO)
    expect(lido).toEqual({ id: GESTO_ID, gesto: 'Victory', dispositivoId: DISPOSITIVO })
    expect(Object.keys(lido ?? {}).sort()).toEqual(['dispositivoId', 'gesto', 'id'])
    expect(lido).not.toBe(DO_BANCO)
  })

  test('sem remetente e sem id → aceito (o remetente é lido à parte, por lerRemetente)', () => {
    expect(lerGestoParaOPalco('gesto', { tipo: 'gesto', gesto_id: GESTO_ID, gesto: 'ILoveYou', dispositivo: DISPOSITIVO })).toEqual({
      id: GESTO_ID,
      gesto: 'ILoveYou',
      dispositivoId: DISPOSITIVO,
    })
  })

  test('cada um dos 7 gestos é aceito', () => {
    for (const gesto of ['Closed_Fist', 'Open_Palm', 'Pointing_Up', 'Thumb_Down', 'Thumb_Up', 'Victory', 'ILoveYou']) {
      expect(lerGestoParaOPalco('gesto', { ...DO_BANCO, gesto })?.gesto, gesto).toBe(gesto)
    }
  })

  test.each<[string, string, unknown]>([
    ['evento gestos_mudaram', 'gestos_mudaram', DO_BANCO],
    ['evento comando', 'comando', DO_BANCO],
    ['evento sinal', 'sinal', DO_BANCO],
    ['tipo diferente', 'gesto', { ...DO_BANCO, tipo: 'comando' }],
    ['tipo gestos_mudaram', 'gesto', { ...DO_BANCO, tipo: 'gestos_mudaram' }],
    ['gesto None', 'gesto', { ...DO_BANCO, gesto: 'None' }],
    ['gesto fora dos 7', 'gesto', { ...DO_BANCO, gesto: 'Wave' }],
    ['gesto em minúsculas', 'gesto', { ...DO_BANCO, gesto: 'victory' }],
    ['gesto número', 'gesto', { ...DO_BANCO, gesto: 3 }],
    ['gesto_id em maiúsculas', 'gesto', { ...DO_BANCO, gesto_id: GESTO_ID.toUpperCase() }],
    ['gesto_id fora de uuid', 'gesto', { ...DO_BANCO, gesto_id: 'x' }],
    ['dispositivo em maiúsculas', 'gesto', { ...DO_BANCO, dispositivo: DISPOSITIVO.toUpperCase() }],
    ['dispositivo fora de uuid', 'gesto', { ...DO_BANCO, dispositivo: 'palco' }],
    ['remetente fora de uuid', 'gesto', { ...DO_BANCO, remetente: 'x' }],
    ['id do send fora de uuid', 'gesto', { ...DO_BANCO, id: 1 }],
    ['falta gesto_id', 'gesto', { tipo: 'gesto', gesto: 'Victory', dispositivo: DISPOSITIVO }],
    ['só id (sem gesto_id)', 'gesto', { tipo: 'gesto', id: GESTO_ID, gesto: 'Victory', dispositivo: DISPOSITIVO }],
    ['falta dispositivo', 'gesto', { tipo: 'gesto', gesto_id: GESTO_ID, gesto: 'Victory' }],
    ['falta gesto', 'gesto', { tipo: 'gesto', gesto_id: GESTO_ID, dispositivo: DISPOSITIVO }],
    ['chave extra', 'gesto', { ...DO_BANCO, acao: 'clipe' }],
    ['chave extra ligados', 'gesto', { ...DO_BANCO, ligados: true }],
    ['__proto__ como chave própria', 'gesto', comProto(DO_BANCO)],
    ['objeto com protótipo de classe', 'gesto', new Carta()],
    ['objeto com protótipo herdado', 'gesto', Object.assign(Object.create({ tipo: 'gesto' }) as object, { gesto_id: GESTO_ID, gesto: 'Victory', dispositivo: DISPOSITIVO })],
    ['nulo', 'gesto', null],
    ['texto', 'gesto', 'Victory'],
    ['lista', 'gesto', [DO_BANCO]],
  ])('%s → null', (_nome, evento, payload) => {
    expect(lerGestoParaOPalco(evento, payload)).toBeNull()
  })
})

describe('le-aviso-dos-gestos', () => {
  test('só gestos_mudaram, com tipo, remetente e id', () => {
    expect(lerAvisoDosGestos('gestos_mudaram', { tipo: 'gestos_mudaram', remetente: REMETENTE, id: ID_DO_SEND })).toEqual({ tipo: 'gestos_mudaram' })
    expect(lerAvisoDosGestos('gestos_mudaram', { tipo: 'gestos_mudaram' })).toEqual({ tipo: 'gestos_mudaram' })
  })

  test.each<[string, string, unknown]>([
    ['um ligados no payload (D4: o aviso não leva valor)', 'gestos_mudaram', { tipo: 'gestos_mudaram', remetente: REMETENTE, ligados: true }],
    ['ligados falso', 'gestos_mudaram', { tipo: 'gestos_mudaram', ligados: false }],
    ['campo extra qualquer', 'gestos_mudaram', { tipo: 'gestos_mudaram', episodio: USUARIO }],
    ['evento gesto', 'gesto', { tipo: 'gestos_mudaram' }],
    ['tipo gesto', 'gestos_mudaram', { tipo: 'gesto' }],
    ['sem tipo', 'gestos_mudaram', { remetente: REMETENTE }],
    ['remetente fora de uuid', 'gestos_mudaram', { tipo: 'gestos_mudaram', remetente: 'x' }],
    ['id fora de uuid', 'gestos_mudaram', { tipo: 'gestos_mudaram', id: 'x' }],
    ['__proto__', 'gestos_mudaram', comProto({ tipo: 'gestos_mudaram' })],
    ['nulo', 'gestos_mudaram', null],
  ])('%s → null', (_nome, evento, payload) => {
    expect(lerAvisoDosGestos(evento, payload)).toBeNull()
  })
})

describe('situacao-dos-gestos', () => {
  test('os oito estados, números finitos e não negativos ou null → objeto novo', () => {
    for (const estado of ['desligados', 'outro_aparelho', 'aguardando_video', 'carregando', 'reconhecendo', 'lento', 'sem_suporte', 'falhou']) {
      expect(lerSituacaoDosGestos({ estado, quadrosPorSegundo: null, msPorQuadro: null }), estado).toEqual({ estado, quadrosPorSegundo: null, msPorQuadro: null })
    }
    const x = { estado: 'reconhecendo', quadrosPorSegundo: 10, msPorQuadro: 0 }
    const lida = lerSituacaoDosGestos(x)
    expect(lida).toEqual(x)
    expect(lida).not.toBe(x)
  })

  test.each<[string, unknown]>([
    ['estado fora da lista', { estado: 'gravando', quadrosPorSegundo: null, msPorQuadro: null }],
    ['estado com espaço', { estado: 'lento ', quadrosPorSegundo: null, msPorQuadro: null }],
    ['número negativo', { estado: 'reconhecendo', quadrosPorSegundo: -1, msPorQuadro: 20 }],
    ['ms negativo', { estado: 'reconhecendo', quadrosPorSegundo: 10, msPorQuadro: -0.5 }],
    ['NaN', { estado: 'reconhecendo', quadrosPorSegundo: Number.NaN, msPorQuadro: 20 }],
    ['Infinity', { estado: 'reconhecendo', quadrosPorSegundo: 10, msPorQuadro: Number.POSITIVE_INFINITY }],
    ['número em texto', { estado: 'reconhecendo', quadrosPorSegundo: '10', msPorQuadro: 20 }],
    ['campo faltando', { estado: 'reconhecendo', quadrosPorSegundo: 10 }],
    ['campo extra (pontuação)', { estado: 'reconhecendo', quadrosPorSegundo: 10, msPorQuadro: 20, confianca: 0.9 }],
    ['__proto__', comProto({ estado: 'lento', quadrosPorSegundo: null, msPorQuadro: null })],
    ['nulo', null],
    ['lista', ['lento', null, null]],
  ])('%s → null', (_nome, x) => {
    expect(lerSituacaoDosGestos(x)).toBeNull()
  })
})
