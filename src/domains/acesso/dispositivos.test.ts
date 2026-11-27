import { describe, test, expect } from 'vitest'
import {
  CAMINHO_DO_TIPO,
  COLUNAS_DE_MEU_DISPOSITIVO,
  FORMA_DO_CODIGO,
  ROTULO_DO_TIPO,
  codigoDoFragmento,
  conferirRotulo,
  linkDePareamento,
  resolverDispositivo,
  situacaoDoDispositivo,
} from './dispositivos'
import type { Dispositivo, EstadoDoDispositivo, TipoDeDispositivo } from './dispositivos'
import { ErroDeDispositivo } from './portasDeDispositivo'
import type { ServicoDeDispositivo } from './portasDeDispositivo'

/** 43 caracteres do alfabeto base64url, como os que `criar_codigo_pareamento` gera (D2). */
const CODIGO = 'Ab0_-cdEFghIJklMNopQRstUVwxYZ0123456789abcd'
const USUARIO_ANTIGO = '11111111-1111-4111-8111-111111111111'
const USUARIO_NOVO = '22222222-2222-4222-8222-222222222222'
const DISPOSITIVO = '33333333-3333-4333-8333-333333333333'

describe('constantes de dispositivos', () => {
  test('tipos, rótulos, caminhos e colunas de meu_dispositivo', () => {
    expect(CODIGO).toHaveLength(43)
    expect(ROTULO_DO_TIPO).toEqual({ camera: 'Câmera', obs_palco: 'Palco (OBS)', obs_camera: 'Câmera (OBS)' })
    expect(CAMINHO_DO_TIPO).toEqual({ camera: '/camera', obs_palco: '/obs/palco', obs_camera: '/obs/camera' })
    expect(Object.isFrozen(ROTULO_DO_TIPO)).toBe(true)
    expect(Object.isFrozen(CAMINHO_DO_TIPO)).toBe(true)
    expect(COLUNAS_DE_MEU_DISPOSITIVO).toEqual(['id', 'tipo', 'rotulo', 'camera_id'])
    expect(FORMA_DO_CODIGO.test(CODIGO)).toBe(true)
  })
})

describe('codigo-do-fragmento', () => {
  test('vazio ou só "#" → null', () => {
    expect(codigoDoFragmento('')).toBeNull()
    expect(codigoDoFragmento('#')).toBeNull()
  })

  test('"#" + 43 caracteres base64url → código', () => {
    expect(codigoDoFragmento(`#${CODIGO}`)).toEqual({ codigo: CODIGO })
  })

  test.each([
    ['42 caracteres', `#${CODIGO.slice(1)}`],
    ['44 caracteres', `#${CODIGO}x`],
    ['com +', `#${CODIGO.slice(1)}+`],
    ['com /', `#${CODIGO.slice(1)}/`],
    ['com =', `#${CODIGO.slice(1)}=`],
    ['com %2F', `#${CODIGO.slice(3)}%2F`],
    ['42 válidos + %41 (só valeria decodificado)', `#${CODIGO.slice(1)}%41`],
    ['com espaço', `#${CODIGO.slice(1)} `],
    ['espaço no começo', `# ${CODIGO.slice(1)}`],
    ['sem o "#"', CODIGO],
    ['dois "#"', `##${CODIGO.slice(1)}`],
    ['quebra de linha no fim', `#${CODIGO}\n`],
  ])('%s → invalido', (_nome, fragmento) => {
    expect(codigoDoFragmento(fragmento)).toEqual({ invalido: true })
  })
})

describe('link-de-pareamento', () => {
  test('https: usa só a origem e o caminho do tipo', () => {
    expect(linkDePareamento('https://app.revocast.test/x?y', 'obs_palco', CODIGO)).toBe(`https://app.revocast.test/obs/palco#${CODIGO}`)
    expect(linkDePareamento('https://app.revocast.test', 'camera', CODIGO)).toBe(`https://app.revocast.test/camera#${CODIGO}`)
    expect(linkDePareamento('https://u:s@revocast.test:8443/painel#aba', 'obs_camera', CODIGO)).toBe(
      `https://revocast.test:8443/obs/camera#${CODIGO}`,
    )
  })

  test('http: só em localhost e 127.0.0.1', () => {
    expect(linkDePareamento('http://localhost:5173', 'camera', CODIGO)).toBe(`http://localhost:5173/camera#${CODIGO}`)
    expect(linkDePareamento('http://127.0.0.1:4173/painel', 'obs_palco', CODIGO)).toBe(`http://127.0.0.1:4173/obs/palco#${CODIGO}`)
  })

  test.each([
    ['http fora de localhost', 'http://revocast.test'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,oi'],
    ['relativo', '/painel'],
    ['vazio', ''],
    ['localhost parecido', 'http://localhost.revocast.test'],
  ])('%s → lança', (_nome, origem) => {
    expect(() => linkDePareamento(origem, 'camera', CODIGO)).toThrow()
  })

  test('código fora da forma → lança, sem o código na mensagem', () => {
    const ruim = `${CODIGO.slice(1)}=`
    let mensagem = ''
    try {
      linkDePareamento('https://app.revocast.test', 'camera', ruim)
    } catch (erro) {
      mensagem = (erro as Error).message
    }
    expect(mensagem).not.toBe('')
    expect(mensagem).not.toContain(ruim)
  })

  test('tipo fora da lista → lança', () => {
    expect(() => linkDePareamento('https://app.revocast.test', 'painel' as TipoDeDispositivo, CODIGO)).toThrow()
  })
})

describe('rotulo', () => {
  test('vazio, só espaços e 61 caracteres → recusa; 1 e 60 → null', () => {
    expect(conferirRotulo('')).toBe('rotulo_vazio')
    expect(conferirRotulo('   ')).toBe('rotulo_vazio')
    expect(conferirRotulo('a'.repeat(61))).toBe('rotulo_longo')
    expect(conferirRotulo('a'.repeat(60))).toBeNull()
    expect(conferirRotulo('  a  ')).toBeNull()
    // aparado antes de contar, como o btrim da função
    expect(conferirRotulo(` ${'a'.repeat(60)} `)).toBeNull()
    // conta pontos de código, como o char_length do Postgres (um emoji = 1)
    expect(conferirRotulo('📷'.repeat(60))).toBeNull()
    expect(conferirRotulo('📷'.repeat(61))).toBe('rotulo_longo')
  })
})

describe('situacao', () => {
  const base: Dispositivo = {
    id: DISPOSITIVO,
    tipo: 'obs_palco',
    rotulo: 'PC do estúdio',
    cameraId: null,
    usuarioAnonimoId: USUARIO_ANTIGO,
    pareadoEm: '2026-11-27T10:00:00Z',
    revogadoEm: null,
  }
  const presentes = new Set([DISPOSITIVO])

  test('revogado vence presença', () => {
    expect(situacaoDoDispositivo({ ...base, revogadoEm: '2026-11-27T11:00:00Z' }, presentes)).toBe('revogado')
    expect(situacaoDoDispositivo({ ...base, pareadoEm: null, revogadoEm: '2026-11-27T11:00:00Z' }, presentes)).toBe('revogado')
  })

  test('pareadoEm nulo → nunca_pareado, mesmo presente', () => {
    expect(situacaoDoDispositivo({ ...base, pareadoEm: null }, presentes)).toBe('nunca_pareado')
  })

  test('presente → conectado; ausente → desconectado', () => {
    expect(situacaoDoDispositivo(base, presentes)).toBe('conectado')
    expect(situacaoDoDispositivo(base, new Set())).toBe('desconectado')
  })
})

type Chamada = 'sessaoAtual' | 'dispositivoAtual' | 'sair' | 'entrarAnonimo' | `parear(${string}, ${string})`

interface Cenario {
  sessao?: { usuarioId: string; anonima: boolean } | null
  dispositivo?: { id: string; tipo: TipoDeDispositivo; rotulo: string; cameraId: string | null } | null
  resultado?: 'pareado' | 'invalido' | 'tipo_errado' | 'limite'
  lanca?: Exclude<Chamada, `parear(${string}, ${string})`> | 'parear'
}

/** `ServicoDeDispositivo` falso que anota a ordem das chamadas e lança quando pedido. */
function falso({ sessao = null, dispositivo = null, resultado = 'pareado', lanca }: Cenario) {
  const chamadas: Chamada[] = []
  const talvezLance = (nome: NonNullable<Cenario['lanca']>) => {
    if (lanca === nome) throw new ErroDeDispositivo('rede')
  }
  const servico: ServicoDeDispositivo = {
    async sessaoAtual() {
      chamadas.push('sessaoAtual')
      talvezLance('sessaoAtual')
      return sessao
    },
    async entrarAnonimo() {
      chamadas.push('entrarAnonimo')
      talvezLance('entrarAnonimo')
      return { usuarioId: USUARIO_NOVO }
    },
    async parear(codigo, tipo) {
      chamadas.push(`parear(${codigo}, ${tipo})`)
      talvezLance('parear')
      return { resultado, dispositivo: resultado === 'pareado' ? { id: DISPOSITIVO, rotulo: 'PC do estúdio' } : null }
    },
    async dispositivoAtual() {
      chamadas.push('dispositivoAtual')
      talvezLance('dispositivoAtual')
      return dispositivo
    },
    async sair() {
      chamadas.push('sair')
      talvezLance('sair')
    },
  }
  return { servico, chamadas }
}

const ANONIMA = { usuarioId: USUARIO_ANTIGO, anonima: true }
const DE_MEMBRO = { usuarioId: USUARIO_ANTIGO, anonima: false }
const DO_PALCO = { id: DISPOSITIVO, tipo: 'obs_palco' as const, rotulo: 'PC do estúdio', cameraId: null }
const PAREADO_NOVO: EstadoDoDispositivo = {
  tipo: 'pareado',
  dispositivo: { id: DISPOSITIVO, tipo: 'obs_palco', rotulo: 'PC do estúdio', usuarioId: USUARIO_NOVO },
}
const PAREADO_ANTIGO: EstadoDoDispositivo = {
  tipo: 'pareado',
  dispositivo: { id: DISPOSITIVO, tipo: 'obs_palco', rotulo: 'PC do estúdio', usuarioId: USUARIO_ANTIGO },
}
const COM_CODIGO = { codigo: CODIGO }
const PAREAR = `parear(${CODIGO}, obs_palco)` as const

describe('resolver-ordem', () => {
  test.each<[string, Cenario, ReturnType<typeof codigoDoFragmento>, EstadoDoDispositivo, Chamada[]]>([
    ['sem sessão, sem fragmento', {}, null, { tipo: 'sem_link' }, ['sessaoAtual']],
    ['sem sessão, fragmento inválido', {}, { invalido: true }, { tipo: 'link_invalido' }, ['sessaoAtual']],
    ['sem sessão, código, pareado', {}, COM_CODIGO, PAREADO_NOVO, ['sessaoAtual', 'entrarAnonimo', PAREAR]],
    ['sessão anônima com dispositivo do mesmo tipo, com código', { sessao: ANONIMA, dispositivo: DO_PALCO }, COM_CODIGO, PAREADO_ANTIGO, ['sessaoAtual', 'dispositivoAtual']],
    ['sessão anônima com dispositivo do mesmo tipo, sem código', { sessao: ANONIMA, dispositivo: DO_PALCO }, null, PAREADO_ANTIGO, ['sessaoAtual', 'dispositivoAtual']],
    [
      'sessão anônima com dispositivo de outro tipo (não deveria existir no cliente do tipo) → sai',
      { sessao: ANONIMA, dispositivo: { ...DO_PALCO, tipo: 'camera' } },
      null,
      { tipo: 'sem_link' },
      ['sessaoAtual', 'dispositivoAtual', 'sair'],
    ],
    ['sessão anônima sem dispositivo, fragmento inválido', { sessao: ANONIMA }, { invalido: true }, { tipo: 'link_invalido' }, ['sessaoAtual', 'dispositivoAtual', 'sair']],
  ])('%s', async (_nome, cenario, fragmento, esperado, ordem) => {
    const { servico, chamadas } = falso(cenario)
    expect(await resolverDispositivo(servico, 'obs_palco', fragmento)).toEqual(esperado)
    expect(chamadas).toEqual(ordem)
  })

  test.each<[Cenario['resultado'], EstadoDoDispositivo['tipo']]>([
    ['invalido', 'link_invalido'],
    ['limite', 'limite'],
    ['tipo_errado', 'tipo_errado'],
  ])('sem-sessao-orfa: parear → %s termina com sair()', async (resultado, esperado) => {
    const { servico, chamadas } = falso({ resultado })
    expect(await resolverDispositivo(servico, 'obs_palco', COM_CODIGO)).toEqual({ tipo: esperado })
    expect(chamadas).toEqual(['sessaoAtual', 'entrarAnonimo', PAREAR, 'sair'])
  })

  test('recarga-nao-diz-revogado: sessão anônima sem dispositivo e sem código → sair() e sem_link', async () => {
    const { servico, chamadas } = falso({ sessao: ANONIMA, dispositivo: null })
    const estado = await resolverDispositivo(servico, 'obs_palco', null)
    expect(estado).toEqual({ tipo: 'sem_link' })
    expect(estado.tipo).not.toBe('revogado')
    expect(chamadas).toEqual(['sessaoAtual', 'dispositivoAtual', 'sair'])
  })

  test('nova-sessao-ao-reparear: sessão anônima sem dispositivo, com código → sair() → entrarAnonimo → parear', async () => {
    const { servico, chamadas } = falso({ sessao: ANONIMA, dispositivo: null })
    expect(await resolverDispositivo(servico, 'obs_palco', COM_CODIGO)).toEqual(PAREADO_NOVO)
    expect(chamadas).toEqual(['sessaoAtual', 'dispositivoAtual', 'sair', 'entrarAnonimo', PAREAR])
  })

  test('sessao-nao-anonima-sai: sai e segue como sem sessão', async () => {
    for (const [fragmento, esperado, depois] of [
      [null, { tipo: 'sem_link' }, []],
      [{ invalido: true }, { tipo: 'link_invalido' }, []],
      [COM_CODIGO, PAREADO_NOVO, ['entrarAnonimo', PAREAR]],
    ] as const) {
      const { servico, chamadas } = falso({ sessao: DE_MEMBRO, dispositivo: DO_PALCO })
      expect(await resolverDispositivo(servico, 'obs_palco', fragmento)).toEqual(esperado)
      // nunca pergunta o dispositivo de uma sessão de membro
      expect(chamadas).toEqual(['sessaoAtual', 'sair', ...depois])
    }
  })

  test('pareado sem dispositivo na resposta → sair() e falha', async () => {
    const { servico, chamadas } = falso({})
    servico.parear = async (codigo, tipo) => {
      chamadas.push(`parear(${codigo}, ${tipo})`)
      return { resultado: 'pareado', dispositivo: null }
    }
    expect(await resolverDispositivo(servico, 'obs_palco', COM_CODIGO)).toEqual({ tipo: 'falha' })
    expect(chamadas).toEqual(['sessaoAtual', 'entrarAnonimo', PAREAR, 'sair'])
  })

  test('resultado fora da lista (adaptador com defeito) → sair() e falha, nunca pareado', async () => {
    const { servico, chamadas } = falso({})
    servico.parear = async (codigo, tipo) => {
      chamadas.push(`parear(${codigo}, ${tipo})`)
      return { resultado: 'toString' as 'invalido', dispositivo: { id: DISPOSITIVO, rotulo: 'x' } }
    }
    expect(await resolverDispositivo(servico, 'obs_palco', COM_CODIGO)).toEqual({ tipo: 'falha' })
    expect(chamadas).toEqual(['sessaoAtual', 'entrarAnonimo', PAREAR, 'sair'])
  })

  test.each<[NonNullable<Cenario['lanca']>, Cenario, Chamada[]]>([
    ['sessaoAtual', {}, ['sessaoAtual']],
    ['dispositivoAtual', { sessao: ANONIMA }, ['sessaoAtual', 'dispositivoAtual']],
    ['entrarAnonimo', {}, ['sessaoAtual', 'entrarAnonimo']],
    ['parear', {}, ['sessaoAtual', 'entrarAnonimo', PAREAR]],
    ['sair', { sessao: DE_MEMBRO }, ['sessaoAtual', 'sair']],
  ])('%s lança ErroDeDispositivo("rede") → falha, sem seguir', async (lanca, cenario, ordem) => {
    const { servico, chamadas } = falso({ ...cenario, lanca })
    expect(await resolverDispositivo(servico, 'obs_palco', COM_CODIGO)).toEqual({ tipo: 'falha' })
    expect(chamadas).toEqual(ordem)
  })

  test('erro qualquer (fora de ErroDeDispositivo) também → falha', async () => {
    const { servico } = falso({})
    servico.sessaoAtual = async () => {
      throw new TypeError('inesperado')
    }
    expect(await resolverDispositivo(servico, 'camera', null)).toEqual({ tipo: 'falha' })
  })

  test('nunca devolve revogado', async () => {
    const cenarios: Cenario[] = [{}, { sessao: ANONIMA }, { sessao: ANONIMA, dispositivo: DO_PALCO }, { sessao: DE_MEMBRO }]
    for (const cenario of cenarios) {
      for (const fragmento of [null, { invalido: true } as const, COM_CODIGO]) {
        for (const resultado of ['pareado', 'invalido', 'tipo_errado', 'limite'] as const) {
          const { servico } = falso({ ...cenario, resultado })
          expect((await resolverDispositivo(servico, 'obs_palco', fragmento)).tipo).not.toBe('revogado')
        }
      }
    }
  })
})

describe('ErroDeDispositivo', () => {
  test('mensagem só com o motivo', () => {
    const erro = new ErroDeDispositivo('negado')
    expect(erro).toBeInstanceOf(Error)
    expect(erro.motivo).toBe('negado')
    expect(erro.name).toBe('ErroDeDispositivo')
    expect(erro.message).toBe('Erro de dispositivo: negado')
  })
})
