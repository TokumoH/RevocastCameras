import { describe, test, expect } from 'vitest'
import {
  EVENTOS_DO_CONTROLE,
  MOTIVOS_DO_RESULTADO,
  REVOGACAO_LEMBRADA_MS,
  Revogados,
  UUID,
  lerComando,
  lerEstadoNoAr,
  lerMensagemDoEstudio,
  lerPresenca,
  lerRemetente,
} from './mensagens'
import type { EstadoNoAr, SituacaoDoObs } from './mensagens'

const ID = '0b6e2b8a-3c1d-4f2a-9e5b-1a2b3c4d5e6f'
const OUTRO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const REMETENTE = 'c0ffee00-1111-4111-8111-11111111abcd'

/** O payload como chega do canal: os campos da mensagem e o `remetente` que o adaptador acrescenta (Tarefa 4). */
const comRemetente = <T extends object>(m: T) => ({ ...m, remetente: REMETENTE })

/** Igual a `JSON.parse` de um corpo malicioso: `__proto__` vira chave própria. */
const comProto = <T extends object>(m: T) => JSON.parse(JSON.stringify(m).replace(/^\{/, '{"__proto__":{"acao":"clipe","admin":true},')) as unknown

const OBS: SituacaoDoObs = {
  navegador: true,
  versaoDoPlugin: '2.24.0',
  nivel: 4,
  websocket: 'conectado',
  versaoObs: '31.0.1',
  replayBuffer: true,
  gravando: false,
}

const ESTADO: EstadoNoAr = {
  episodioId: ID,
  modo: 'ao_vivo',
  cenaObs: 'Câmera 1',
  avisoId: OUTRO,
  avisoAte: 1_800_000_000_000,
  ultimo: { comandoId: OUTRO, acao: 'som', resultado: 'recusado', motivo: 'som_inexistente' },
  obs: OBS,
}

describe('constantes das mensagens', () => {
  test('UUID só em minúsculas; eventos; motivos', () => {
    expect(UUID.test(ID)).toBe(true)
    expect(UUID.test(ID.toUpperCase())).toBe(false)
    expect(UUID.test(`${ID}0`)).toBe(false)
    expect(EVENTOS_DO_CONTROLE).toEqual({ comando: 'comando', estado: 'estado' })
    expect(REVOGACAO_LEMBRADA_MS).toBe(900_000)
    expect(Object.isFrozen(MOTIVOS_DO_RESULTADO)).toBe(true)
    // os motivos de recusa de resolverComando (comandos.ts) estão todos na lista
    for (const m of ['cena_inexistente', 'som_inexistente', 'aviso_inexistente', 'sem_cenas', 'fim_dos_avisos', 'sem_aviso_no_ar']) {
      expect(MOTIVOS_DO_RESULTADO).toContain(m)
    }
  })
})

describe('mensagens-validadas', () => {
  describe('lerMensagemDoEstudio', () => {
    test('aceita as três formas, com ou sem remetente, e devolve objeto novo', () => {
      expect(lerMensagemDoEstudio('episodio_ativo_mudou', comRemetente({}))).toEqual({ evento: 'episodio_ativo_mudou' })
      expect(lerMensagemDoEstudio('episodio_ativo_mudou', {})).toEqual({ evento: 'episodio_ativo_mudou' })
      expect(lerMensagemDoEstudio('dispositivo_mudou', comRemetente({ dispositivoId: ID }))).toEqual({ evento: 'dispositivo_mudou', dispositivoId: ID })
      expect(lerMensagemDoEstudio('revogacao', comRemetente({ usuario: ID }))).toEqual({ evento: 'revogacao', usuario: ID })
      // o evento repetido no corpo é tolerado só se for o mesmo
      expect(lerMensagemDoEstudio('revogacao', { evento: 'revogacao', usuario: ID })).toEqual({ evento: 'revogacao', usuario: ID })
    })

    test.each<[string, string, unknown]>([
      ['evento desconhecido', 'comando', { id: ID }],
      ['evento herdado do protótipo', 'toString', {}],
      ['payload nulo', 'episodio_ativo_mudou', null],
      ['payload texto', 'episodio_ativo_mudou', 'oi'],
      ['payload lista', 'episodio_ativo_mudou', []],
      ['payload de outra classe', 'episodio_ativo_mudou', new Date()],
      ['uuid em maiúsculas', 'revogacao', { usuario: ID.toUpperCase() }],
      ['uuid fora da forma', 'dispositivo_mudou', { dispositivoId: 'x' }],
      ['tipo errado', 'revogacao', { usuario: 42 }],
      ['campo faltando', 'dispositivo_mudou', {}],
      ['campo extra', 'revogacao', { usuario: ID, papel: 'admin' }],
      ['evento diferente no corpo', 'revogacao', { evento: 'dispositivo_mudou', usuario: ID }],
      ['remetente fora da forma', 'revogacao', { usuario: ID, remetente: 'x' }],
      ['__proto__ como chave', 'revogacao', comProto({ usuario: ID })],
    ])('%s → null', (_nome, evento, payload) => {
      expect(lerMensagemDoEstudio(evento, payload)).toBeNull()
    })
  })

  describe('lerComando', () => {
    test.each([
      [{ id: ID, acao: 'cena', cenaId: OUTRO }],
      [{ id: ID, acao: 'som', somId: OUTRO }],
      [{ id: ID, acao: 'aviso', avisoId: OUTRO }],
      [{ id: ID, acao: 'proxima_cena' }],
      [{ id: ID, acao: 'proximo_aviso' }],
      [{ id: ID, acao: 'ocultar_aviso' }],
      [{ id: ID, acao: 'clipe' }],
      [{ id: ID, acao: 'marcador' }],
    ])('aceita %o e devolve um objeto novo só com os campos conhecidos', (comando) => {
      const payload = comRemetente(comando)
      const lido = lerComando(payload)
      expect(lido).toEqual(comando)
      expect(lido).not.toBe(payload)
      expect(Object.getPrototypeOf(lido)).toBe(Object.prototype)
    })

    test.each<[string, unknown]>([
      ['nulo', null],
      ['lista', [ID, 'clipe']],
      ['id em maiúsculas', { id: ID.toUpperCase(), acao: 'clipe' }],
      ['id fora da forma', { id: '1', acao: 'clipe' }],
      ['id numérico', { id: 1, acao: 'clipe' }],
      ['id faltando', { acao: 'clipe' }],
      ['ação desconhecida', { id: ID, acao: 'apagar_tudo' }],
      ['ação nenhuma (só do mapa de gestos)', { id: ID, acao: 'nenhuma' }],
      ['ação faltando', { id: ID }],
      ['cena sem cenaId', { id: ID, acao: 'cena' }],
      ['cena com cenaId nulo', { id: ID, acao: 'cena', cenaId: null }],
      ['som com cenaId', { id: ID, acao: 'som', cenaId: OUTRO }],
      ['som com somId em maiúsculas', { id: ID, acao: 'som', somId: OUTRO.toUpperCase() }],
      ['clipe com alvo extra', { id: ID, acao: 'clipe', somId: OUTRO }],
      ['campo extra', { id: ID, acao: 'clipe', papel: 'admin' }],
      ['remetente fora da forma', { id: ID, acao: 'clipe', remetente: REMETENTE.toUpperCase() }],
      ['__proto__ como chave', comProto({ id: ID, acao: 'marcador' })],
      ['ação herdada do protótipo', Object.assign(Object.create({ acao: 'clipe' }) as object, { id: ID })],
    ])('%s → null', (_nome, payload) => {
      expect(lerComando(payload)).toBeNull()
    })
  })

  describe('lerEstadoNoAr', () => {
    test('aceita a forma certa (com remetente) e devolve objetos novos', () => {
      const payload = comRemetente(ESTADO)
      const lido = lerEstadoNoAr(payload)
      expect(lido).toEqual(ESTADO)
      expect(lido?.obs).not.toBe(payload.obs)
      expect(lido?.ultimo).not.toBe(payload.ultimo)
    })

    test('aceita nulos, modo teste, motivo nulo e cenaObs de 200 caracteres', () => {
      const minimo: EstadoNoAr = {
        episodioId: ID,
        modo: 'teste',
        cenaObs: null,
        avisoId: null,
        avisoAte: null,
        ultimo: null,
        obs: { navegador: false, versaoDoPlugin: null, nivel: null, websocket: 'desligado', versaoObs: null, replayBuffer: null, gravando: null },
      }
      expect(lerEstadoNoAr(minimo)).toEqual(minimo)
      const ok = { ...ESTADO, ultimo: { comandoId: ID, acao: 'clipe', resultado: 'ok', motivo: null } }
      expect(lerEstadoNoAr(ok)).toEqual(ok)
      expect(lerEstadoNoAr({ ...ESTADO, cenaObs: 'é'.repeat(200) })).not.toBeNull()
      // conta pontos de código: 200 emojis (400 unidades UTF-16) cabem; 201 não
      expect(lerEstadoNoAr({ ...ESTADO, cenaObs: '🎬'.repeat(200) })).not.toBeNull()
      expect(lerEstadoNoAr({ ...ESTADO, cenaObs: '🎬'.repeat(201) })).toBeNull()
      expect(lerEstadoNoAr({ ...ESTADO, cenaObs: '' })).not.toBeNull()
    })

    const obs = (o: Partial<Record<keyof SituacaoDoObs, unknown>>) => ({ ...ESTADO, obs: { ...OBS, ...o } })
    const ultimo = (u: Record<string, unknown>) => ({ ...ESTADO, ultimo: { ...ESTADO.ultimo, ...u } })
    const sem = (campo: keyof EstadoNoAr) => {
      const copia: Record<string, unknown> = { ...ESTADO }
      delete copia[campo]
      return copia
    }

    test.each<[string, unknown]>([
      ['nulo', null],
      ['episodioId em maiúsculas', { ...ESTADO, episodioId: ID.toUpperCase() }],
      ['modo desconhecido', { ...ESTADO, modo: 'ensaio' }],
      ['cenaObs com 201 caracteres', { ...ESTADO, cenaObs: 'é'.repeat(201) }],
      ['cenaObs numérico', { ...ESTADO, cenaObs: 1 }],
      ['avisoId fora da forma', { ...ESTADO, avisoId: 'x' }],
      ['avisoAte infinito', { ...ESTADO, avisoAte: Infinity }],
      ['avisoAte NaN', { ...ESTADO, avisoAte: NaN }],
      ['avisoAte negativo', { ...ESTADO, avisoAte: -1 }],
      ['avisoAte texto', { ...ESTADO, avisoAte: '1' }],
      ['campo faltando (obs)', sem('obs')],
      ['campo faltando (cenaObs)', sem('cenaObs')],
      ['campo extra', { ...ESTADO, texto: '<script>' }],
      ['ultimo com ação desconhecida', ultimo({ acao: 'apagar' })],
      ['ultimo com resultado desconhecido', ultimo({ resultado: 'talvez' })],
      ['motivo fora da lista', ultimo({ motivo: 'Erro: senha do OBS é 123' })],
      ['motivo herdado do protótipo', ultimo({ motivo: 'toString' })],
      ['ultimo com comandoId em maiúsculas', ultimo({ comandoId: OUTRO.toUpperCase() })],
      ['ultimo com campo extra', ultimo({ texto: 'x' })],
      ['ultimo sem motivo', { ...ESTADO, ultimo: { comandoId: OUTRO, acao: 'som', resultado: 'ok' } }],
      ['obs navegador texto', obs({ navegador: 'sim' })],
      ['obs nível não finito', obs({ nivel: Infinity })],
      ['obs nível NaN', obs({ nivel: NaN })],
      ['obs nível fora de 0..5', obs({ nivel: 6 })],
      ['obs nível fracionário', obs({ nivel: 2.5 })],
      ['obs websocket desconhecido', obs({ websocket: 'talvez' })],
      ['obs versão longa', obs({ versaoObs: '3'.repeat(41) })],
      ['obs versão do plugin numérica', obs({ versaoDoPlugin: 2 })],
      ['obs replayBuffer texto', obs({ replayBuffer: 'true' })],
      ['obs campo extra (senha)', obs({ senha: 'senha-de-teste' } as Partial<Record<keyof SituacaoDoObs, unknown>>)],
      ['obs nulo', { ...ESTADO, obs: null }],
      ['__proto__ como chave', comProto(ESTADO)],
      ['__proto__ como chave em obs', { ...ESTADO, obs: comProto(OBS) }],
    ])('%s → null', (_nome, payload) => {
      expect(lerEstadoNoAr(payload)).toBeNull()
    })
  })

  describe('lerPresenca', () => {
    test('aceita membro e dispositivo (com o presence_ref do realtime-js) e devolve objeto novo', () => {
      expect(lerPresenca({ tipo: 'membro', papel: 'apresentadora', presence_ref: 'abc' })).toEqual({ tipo: 'membro', papel: 'apresentadora' })
      expect(lerPresenca({ tipo: 'obs_palco', dispositivoId: ID, obs: OBS })).toEqual({ tipo: 'obs_palco', dispositivoId: ID, obs: OBS })
      expect(lerPresenca({ tipo: 'camera', dispositivoId: ID, obs: null, presence_ref: 'x' })).toEqual({ tipo: 'camera', dispositivoId: ID, obs: null })
      expect(lerPresenca({ tipo: 'obs_camera', dispositivoId: ID, obs: null })).toEqual({ tipo: 'obs_camera', dispositivoId: ID, obs: null })
    })

    test.each<[string, unknown]>([
      ['nulo', null],
      ['tipo desconhecido', { tipo: 'painel', papel: 'admin' }],
      ['papel desconhecido', { tipo: 'membro', papel: 'dono' }],
      ['membro com e-mail', { tipo: 'membro', papel: 'admin', email: 'ana@revocast.test' }],
      ['dispositivo sem dispositivoId', { tipo: 'camera', obs: null }],
      ['dispositivo com id em maiúsculas', { tipo: 'camera', dispositivoId: ID.toUpperCase(), obs: null }],
      ['dispositivo sem obs', { tipo: 'camera', dispositivoId: ID }],
      ['dispositivo com obs inválido', { tipo: 'obs_palco', dispositivoId: ID, obs: { ...OBS, nivel: -1 } }],
      ['presence_ref numérico', { tipo: 'membro', papel: 'admin', presence_ref: 1 }],
      ['__proto__ como chave', comProto({ tipo: 'membro', papel: 'admin' })],
    ])('%s → null', (_nome, payload) => {
      expect(lerPresenca(payload)).toBeNull()
    })
  })

  describe('lerRemetente', () => {
    test('uuid minúsculo próprio → texto; o resto → null', () => {
      expect(lerRemetente({ remetente: REMETENTE, id: ID })).toBe(REMETENTE)
      expect(lerRemetente({ remetente: REMETENTE.toUpperCase() })).toBeNull()
      expect(lerRemetente({ remetente: 1 })).toBeNull()
      expect(lerRemetente({})).toBeNull()
      expect(lerRemetente(null)).toBeNull()
      expect(lerRemetente(REMETENTE)).toBeNull()
      expect(lerRemetente(Object.create({ remetente: REMETENTE }))).toBeNull()
    })
  })
})

describe('revogados-expiram', () => {
  test('lembra por 15 minutos (899 999 ms contém; 900 000 não)', () => {
    let agora = 1_000_000
    const revogados = new Revogados(() => agora)
    expect(revogados.contem(REMETENTE)).toBe(false)
    revogados.revogar(REMETENTE)
    expect(revogados.contem(REMETENTE)).toBe(true)
    expect(revogados.contem(ID)).toBe(false)
    agora += 899_999
    expect(revogados.contem(REMETENTE)).toBe(true)
    agora += 1
    expect(revogados.contem(REMETENTE)).toBe(false)
  })

  test('revogar outro remetente mantém o que já estava revogado; cada um vence no próprio prazo', () => {
    let agora = 0
    const revogados = new Revogados(() => agora)
    revogados.revogar(REMETENTE)
    agora = 1_000
    revogados.revogar(OUTRO)
    expect(revogados.contem(REMETENTE)).toBe(true)
    expect(revogados.contem(OUTRO)).toBe(true)
    agora = 900_000
    expect(revogados.contem(REMETENTE)).toBe(false)
    expect(revogados.contem(OUTRO)).toBe(true)
    agora = 900_999
    expect(revogados.contem(OUTRO)).toBe(true)
    agora = 901_000
    expect(revogados.contem(OUTRO)).toBe(false)
  })

  test('revogar de novo renova o prazo; entradas vencidas saem', () => {
    let agora = 0
    const revogados = new Revogados(() => agora)
    revogados.revogar(REMETENTE)
    agora = 600_000
    revogados.revogar(REMETENTE)
    agora = 1_400_000
    expect(revogados.contem(REMETENTE)).toBe(true)
    agora = 1_500_000
    expect(revogados.contem(REMETENTE)).toBe(false)
  })
})
