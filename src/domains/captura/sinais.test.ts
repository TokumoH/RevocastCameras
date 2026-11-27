import { describe, test, expect } from 'vitest'
import {
  ESPERAS_DE_RECONEXAO_MS,
  ESPERA_DA_CONEXAO_MS,
  ESPERA_DA_QUEDA_MS,
  ESPERA_DA_RESPOSTA_MS,
  ESPERA_DO_ICE_MS,
  EVENTO_DO_SINAL,
  FALHAS_PARA_SEM_CONEXAO_DIRETA,
  PRESENCA_MINIMA_MS,
  PRONTO_A_CADA_MS,
  TAMANHO_MAXIMO_DO_SDP,
  conferirSdp,
  esperaDaTentativa,
  lerSinalDaCamera,
  lerSinalDaObs,
  lerSituacaoDoVideo,
  topicoDoVideo,
} from './sinais'

const SESSAO = '0b6e2b8a-3c1d-4f2a-9e5b-1a2b3c4d5e6f'
const REMETENTE = 'c0ffee00-1111-4111-8111-11111111abcd'
const ID_DO_SEND = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

/** SDP montado no teste, com IP da faixa de documentação (RFC 5737); nunca um SDP real. */
const SDP = 'v=0\r\no=- 1 2 IN IP4 192.0.2.1\r\ns=-\r\nt=0 0\r\na=candidate:1 1 udp 1 192.0.2.10 9 typ host\r\n'

/** SDP válido com exatamente `n` caracteres (preenchido com uma linha `a=x...`). */
function sdpDe(n: number): string {
  const base = 'v=0\r\na='
  const fim = '\r\n'
  return base + 'x'.repeat(n - base.length - fim.length) + fim
}

/** Como chega do banco: os campos do sinal, o `remetente` posto pela função e o `id` que o `realtime.send` acrescenta. */
const doBanco = <T extends object>(s: T) => ({ ...s, remetente: REMETENTE, id: ID_DO_SEND })

/** Igual a `JSON.parse` de um corpo malicioso: `__proto__` vira chave própria. */
const comProto = <T extends object>(s: T) => JSON.parse(JSON.stringify(s).replace(/^\{/, '{"__proto__":{"tipo":"oferta"},')) as unknown

describe('constantes', () => {
  test('valores do plano (D4, D6, D3, D13)', () => {
    expect(EVENTO_DO_SINAL).toBe('sinal')
    expect(TAMANHO_MAXIMO_DO_SDP).toBe(12_000)
    expect(ESPERA_DO_ICE_MS).toBe(3000)
    expect(ESPERA_DA_RESPOSTA_MS).toBe(15_000)
    expect(ESPERA_DA_QUEDA_MS).toBe(5000)
    expect(ESPERA_DA_CONEXAO_MS).toBe(20_000)
    expect(ESPERAS_DE_RECONEXAO_MS).toEqual([2000, 4000, 8000, 16000, 30000])
    expect(FALHAS_PARA_SEM_CONEXAO_DIRETA).toBe(2)
    expect(PRONTO_A_CADA_MS).toBe(10_000)
    expect(PRESENCA_MINIMA_MS).toBe(10_000)
  })
})

describe('topico-do-video', () => {
  test('video:<uuid da própria sessão>', () => {
    expect(topicoDoVideo(SESSAO)).toBe(`video:${SESSAO}`)
  })

  test.each<[string, string]>([
    ['uuid em maiúsculas', SESSAO.toUpperCase()],
    ['vazio', ''],
    ['sem hífens', SESSAO.replaceAll('-', '')],
    ['com espaço no fim', `${SESSAO} `],
    ['com sufixo', `${SESSAO}:camera`],
  ])('%s → lança', (_nome, id) => {
    expect(() => topicoDoVideo(id)).toThrow()
  })
})

describe('conferir-sdp', () => {
  test('12 000 → ok; 12 001 → grande', () => {
    expect(sdpDe(12_000)).toHaveLength(12_000)
    expect(conferirSdp(sdpDe(12_000))).toBe('ok')
    expect(conferirSdp(sdpDe(12_001))).toBe('grande')
    expect(conferirSdp(SDP)).toBe('ok')
  })

  test.each<[string, string]>([
    ['\\n sem \\r (v=0 seguido só de \\n)', 'v=0\no=- 1 2 IN IP4 192.0.2.1\r\n'],
    ['não ASCII', `${SDP}a=é\r\n`],
    ['começo diferente', `o=- 1\r\n${SDP}`],
    ['controle \\u0000', `${SDP}\u0000`],
    ['controle \\u0001', `${SDP}\u0001`],
    ['tabulação', `${SDP}a=\tx\r\n`],
    ['DEL (\\u007f)', `${SDP}\u007f`],
    ['vazio', ''],
  ])('%s → forma', (_nome, sdp) => {
    expect(conferirSdp(sdp)).toBe('forma')
  })
})

describe('sinais-validados', () => {
  test('lerSinalDaCamera aceita oferta e encerrar e devolve objeto novo só com os campos conhecidos', () => {
    const oferta = doBanco({ tipo: 'oferta', sessao: SESSAO, sdp: SDP })
    const lida = lerSinalDaCamera('sinal', oferta)
    expect(lida).toEqual({ tipo: 'oferta', sessao: SESSAO, sdp: SDP })
    expect(lida).not.toBe(oferta)
    expect(Object.keys(lida ?? {})).toEqual(['tipo', 'sessao', 'sdp'])
    expect(Object.getPrototypeOf(lida)).toBe(Object.prototype)
    expect(lerSinalDaCamera('sinal', doBanco({ tipo: 'encerrar', sessao: SESSAO }))).toEqual({ tipo: 'encerrar', sessao: SESSAO })
    // sem o id e sem o remetente também passa (o remetente é conferido à parte pelo adaptador)
    expect(lerSinalDaCamera('sinal', { tipo: 'encerrar', sessao: SESSAO })).toEqual({ tipo: 'encerrar', sessao: SESSAO })
  })

  test('lerSinalDaObs aceita pronto, resposta e encerrar e devolve objeto novo só com os campos conhecidos', () => {
    expect(lerSinalDaObs('sinal', doBanco({ tipo: 'pronto', sessao: SESSAO }))).toEqual({ tipo: 'pronto', sessao: SESSAO })
    const resposta = doBanco({ tipo: 'resposta', sessao: SESSAO, sdp: SDP })
    const lida = lerSinalDaObs('sinal', resposta)
    expect(lida).toEqual({ tipo: 'resposta', sessao: SESSAO, sdp: SDP })
    expect(Object.keys(lida ?? {})).toEqual(['tipo', 'sessao', 'sdp'])
    expect(lerSinalDaObs('sinal', doBanco({ tipo: 'encerrar', sessao: SESSAO }))).toEqual({ tipo: 'encerrar', sessao: SESSAO })
  })

  const OFERTA = { tipo: 'oferta', sessao: SESSAO, sdp: SDP }
  const RESPOSTA = { tipo: 'resposta', sessao: SESSAO, sdp: SDP }

  const invalidos = (base: Record<string, unknown>): [string, string, unknown][] => [
    ['evento diferente de sinal', 'oferta', doBanco(base)],
    ['evento estado', 'estado', doBanco(base)],
    ['tipo desconhecido', 'sinal', doBanco({ ...base, tipo: 'candidato' })],
    ['sessao fora de uuid', 'sinal', doBanco({ ...base, sessao: 'sessao-1' })],
    ['sessao em maiúsculas', 'sinal', doBanco({ ...base, sessao: SESSAO.toUpperCase() })],
    ['sem sessao', 'sinal', doBanco({ tipo: base.tipo, sdp: base.sdp })],
    ['sdp sem v=0\\r\\n', 'sinal', doBanco({ ...base, sdp: 'v=0\no=- 1\r\n' })],
    ['sdp com \\u0000', 'sinal', doBanco({ ...base, sdp: `${SDP}\u0000` })],
    ['sdp com outro controle (\\u001b)', 'sinal', doBanco({ ...base, sdp: `${SDP}\u001b[0m` })],
    ['sdp com 12 001 caracteres', 'sinal', doBanco({ ...base, sdp: sdpDe(12_001) })],
    ['sdp não texto', 'sinal', doBanco({ ...base, sdp: 42 })],
    ['sem sdp', 'sinal', doBanco({ tipo: base.tipo, sessao: SESSAO })],
    ['sdp nulo', 'sinal', doBanco({ ...base, sdp: null })],
    ['campo extra __proto__', 'sinal', comProto(doBanco(base))],
    ['campo extra qualquer', 'sinal', doBanco({ ...base, rotulo: 'Câmera 1' })],
    ['remetente fora de uuid', 'sinal', { ...base, remetente: 'eu' }],
    ['id fora de uuid', 'sinal', { ...base, id: 7 }],
    ['nulo', 'sinal', null],
    ['texto', 'sinal', 'v=0'],
    ['lista', 'sinal', [base]],
    ['herdado', 'sinal', Object.create(doBanco(base)) as unknown],
    ['protótipo que não é Object.prototype (campos próprios certos)', 'sinal', Object.setPrototypeOf(doBanco(base), { admin: true }) as unknown],
    ['instância de classe', 'sinal', Object.assign(new (class Sinal {})(), doBanco(base)) as unknown],
  ]

  test.each(invalidos(OFERTA))('lerSinalDaCamera: %s → null', (_nome, evento, payload) => {
    expect(lerSinalDaCamera(evento, payload)).toBeNull()
  })

  test.each(invalidos(RESPOSTA))('lerSinalDaObs: %s → null', (_nome, evento, payload) => {
    expect(lerSinalDaObs(evento, payload)).toBeNull()
  })

  test.each<[string, (e: string, p: unknown) => unknown, unknown]>([
    ['encerrar com sdp (câmera)', lerSinalDaCamera, doBanco({ tipo: 'encerrar', sessao: SESSAO, sdp: SDP })],
    ['encerrar com sdp (obs)', lerSinalDaObs, doBanco({ tipo: 'encerrar', sessao: SESSAO, sdp: SDP })],
    ['pronto com sdp', lerSinalDaObs, doBanco({ tipo: 'pronto', sessao: SESSAO, sdp: SDP })],
    ['pronto sem sessao', lerSinalDaObs, doBanco({ tipo: 'pronto' })],
  ])('%s → null', (_nome, ler, payload) => {
    expect(ler('sinal', payload)).toBeNull()
  })

  test('12 000 caracteres de SDP passam no leitor (a mesma fronteira da função)', () => {
    expect(lerSinalDaCamera('sinal', doBanco({ ...OFERTA, sdp: sdpDe(12_000) }))).not.toBeNull()
  })
})

describe('sinal-do-lado-errado', () => {
  test('lerSinalDaCamera recusa resposta e pronto (sinais do obs_camera)', () => {
    expect(lerSinalDaCamera('sinal', doBanco({ tipo: 'resposta', sessao: SESSAO, sdp: SDP }))).toBeNull()
    expect(lerSinalDaCamera('sinal', doBanco({ tipo: 'pronto', sessao: SESSAO }))).toBeNull()
  })

  test('lerSinalDaObs recusa oferta (sinal da câmera)', () => {
    expect(lerSinalDaObs('sinal', doBanco({ tipo: 'oferta', sessao: SESSAO, sdp: SDP }))).toBeNull()
  })
})

describe('situacao-do-video', () => {
  test('aceita a forma certa e devolve objeto novo', () => {
    const s = { estado: 'conectado', telaLigada: 'travada', bateria: 0.5 }
    const lida = lerSituacaoDoVideo(s)
    expect(lida).toEqual(s)
    expect(lida).not.toBe(s)
    expect(lerSituacaoDoVideo({ estado: 'sinal_grande', telaLigada: null, bateria: null })).toEqual({ estado: 'sinal_grande', telaLigada: null, bateria: null })
    expect(lerSituacaoDoVideo({ estado: 'aguardando_toque', telaLigada: 'sem_trava', bateria: 0 })).not.toBeNull()
    expect(lerSituacaoDoVideo({ estado: 'aguardando_toque', telaLigada: 'sem_trava', bateria: 1 })).not.toBeNull()
  })

  test.each<[string, unknown]>([
    ['bateria 1.2', { estado: 'conectado', telaLigada: null, bateria: 1.2 }],
    ['bateria -0.1', { estado: 'conectado', telaLigada: null, bateria: -0.1 }],
    ['bateria NaN', { estado: 'conectado', telaLigada: null, bateria: Number.NaN }],
    ['bateria infinita', { estado: 'conectado', telaLigada: null, bateria: Number.POSITIVE_INFINITY }],
    ['bateria texto', { estado: 'conectado', telaLigada: null, bateria: '0.5' }],
    ['estado fora da lista', { estado: 'gravando', telaLigada: null, bateria: null }],
    ['telaLigada fora da lista', { estado: 'conectado', telaLigada: 'ligada', bateria: null }],
    ['sem bateria', { estado: 'conectado', telaLigada: null }],
    ['campo extra', { estado: 'conectado', telaLigada: null, bateria: null, modelo: 'x' }],
    ['__proto__ como chave', JSON.parse('{"__proto__":{"x":1},"estado":"conectado","telaLigada":null,"bateria":null}') as unknown],
    ['protótipo que não é Object.prototype', Object.setPrototypeOf({ estado: 'conectado', telaLigada: null, bateria: null }, { x: 1 }) as unknown],
    ['nulo', null],
  ])('%s → null', (_nome, x) => {
    expect(lerSituacaoDoVideo(x)).toBeNull()
  })
})

describe('espera-da-tentativa', () => {
  test('0 → 2000; 4 → 30000; 9 → 30000 (depois, 30 s sempre)', () => {
    expect(esperaDaTentativa(0)).toBe(2000)
    expect(esperaDaTentativa(1)).toBe(4000)
    expect(esperaDaTentativa(2)).toBe(8000)
    expect(esperaDaTentativa(3)).toBe(16000)
    expect(esperaDaTentativa(4)).toBe(30000)
    expect(esperaDaTentativa(9)).toBe(30000)
  })
})
