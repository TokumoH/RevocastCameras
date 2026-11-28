import { afterEach, describe, expect, test, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { COLUNAS_DE_MEU_DISPOSITIVO } from '../../domains/acesso/dispositivos'
import { ErroDeDispositivo } from '../../domains/acesso/portasDeDispositivo'
import { criarRepositorioDosGestosSupabase, criarServicoDeDispositivoSupabase } from './dispositivoSupabase'

const UID = '5a1c9e2b-7d3f-4b6a-8c1d-2e3f4a5b6c7d'
const DISP = '0b6f3c1e-2a4d-4f8b-9c7e-1d2e3f4a5b6c'
/** Código de pareamento de teste: 43 caracteres na forma, sem nada de real. */
const CODIGO = 'Codigo_de_teste-0123456789abcdefghijKLMNOPQ'

interface RespostaRpc {
  data?: unknown
  error?: unknown
  status?: number
}

/** Cliente falso: só o que o adaptador usa (`auth.getSession`, `auth.signInAnonymously`, `auth.signOut`, `rpc`). */
function criarFalso() {
  const chamadas: unknown[][] = []
  let rpc: RespostaRpc | (() => never) = { data: null, error: null, status: 200 }
  let sessao: (() => Promise<unknown>) = async () => ({ data: { session: null }, error: null })
  let anonimo: (() => Promise<unknown>) = async () => ({ data: { user: { id: UID, is_anonymous: true }, session: {} }, error: null })
  let saida: (() => Promise<unknown>) = async () => ({ error: null })
  const cliente = {
    auth: {
      getSession: () => {
        chamadas.push(['getSession'])
        return sessao()
      },
      signInAnonymously: (...args: unknown[]) => {
        chamadas.push(['signInAnonymously', ...args])
        return anonimo()
      },
      signOut: (...args: unknown[]) => {
        chamadas.push(['signOut', ...args])
        return saida()
      },
    },
    rpc: (...args: unknown[]) => {
      chamadas.push(['rpc', ...args])
      if (typeof rpc === 'function') return rpc()
      return Promise.resolve({ data: null, error: null, status: 200, ...rpc })
    },
  } as unknown as SupabaseClient
  return {
    servico: criarServicoDeDispositivoSupabase(cliente),
    cliente,
    chamadas,
    responderRpc(r: RespostaRpc | (() => never)) {
      rpc = r
    },
    sessao(f: () => Promise<unknown>) {
      sessao = f
    },
    anonimo(f: () => Promise<unknown>) {
      anonimo = f
    },
    saida(f: () => Promise<unknown>) {
      saida = f
    },
  }
}

async function motivoDe(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa
  } catch (e) {
    if (e instanceof ErroDeDispositivo) return e.motivo
    throw e
  }
  throw new Error('esperava ErroDeDispositivo')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('criarServicoDeDispositivoSupabase', () => {
  test('sessao-atual', async () => {
    const f = criarFalso()
    expect(await f.servico.sessaoAtual()).toBeNull()

    f.sessao(async () => ({ data: { session: { user: { id: UID, is_anonymous: true } } }, error: null }))
    expect(await f.servico.sessaoAtual()).toEqual({ usuarioId: UID, anonima: true })

    // is_anonymous ausente ou falso → não anônima (só o `true` literal conta)
    f.sessao(async () => ({ data: { session: { user: { id: UID } } }, error: null }))
    expect(await f.servico.sessaoAtual()).toEqual({ usuarioId: UID, anonima: false })
    f.sessao(async () => ({ data: { session: { user: { id: UID, is_anonymous: 'true' } } }, error: null }))
    expect(await f.servico.sessaoAtual()).toEqual({ usuarioId: UID, anonima: false })

    // erro devolvido (com ou sem sessão) e erro lançado → rede, nunca "sem sessão"
    f.sessao(async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 0 } }))
    expect(await motivoDe(f.servico.sessaoAtual())).toBe('rede')
    f.sessao(async () => {
      throw new Error('falhou')
    })
    expect(await motivoDe(f.servico.sessaoAtual())).toBe('rede')
  })

  test('entrar-anonimo', async () => {
    const f = criarFalso()
    expect(await f.servico.entrarAnonimo()).toEqual({ usuarioId: UID })
    expect(f.chamadas).toEqual([['signInAnonymously']])

    // login anônimo desligado no projeto: 422, o código do auth ou a frase → negado
    f.anonimo(async () => ({ data: { user: null, session: null }, error: { status: 422, code: 'outro', message: 'x' } }))
    expect(await motivoDe(f.servico.entrarAnonimo())).toBe('negado')
    f.anonimo(async () => ({ data: { user: null, session: null }, error: { status: 400, message: 'Anonymous sign-ins are disabled' } }))
    expect(await motivoDe(f.servico.entrarAnonimo())).toBe('negado')
    f.anonimo(async () => ({ data: { user: null, session: null }, error: { status: 400, code: 'anonymous_provider_disabled', message: '' } }))
    expect(await motivoDe(f.servico.entrarAnonimo())).toBe('negado')

    // sem resposta: o auth-js devolve AuthRetryableFetchError (status 0); lançado também é rede
    f.anonimo(async () => ({ data: { user: null, session: null }, error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } }))
    expect(await motivoDe(f.servico.entrarAnonimo())).toBe('rede')
    f.anonimo(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await motivoDe(f.servico.entrarAnonimo())).toBe('rede')

    // outro erro (limite de logins por IP, 429) → outro; resposta sem usuário → outro
    f.anonimo(async () => ({ data: { user: null, session: null }, error: { status: 429, code: 'over_request_rate_limit', message: 'x' } }))
    expect(await motivoDe(f.servico.entrarAnonimo())).toBe('outro')
    f.anonimo(async () => ({ data: { user: null, session: null }, error: null }))
    expect(await motivoDe(f.servico.entrarAnonimo())).toBe('outro')
  })

  test('parear-chama-rpc', async () => {
    const f = criarFalso()
    f.responderRpc({ data: [{ resultado: 'pareado', dispositivo: DISP, nome: 'PC do estúdio' }] })
    expect(await f.servico.parear(CODIGO, 'obs_palco')).toEqual({ resultado: 'pareado', dispositivo: { id: DISP, rotulo: 'PC do estúdio' } })
    expect(f.chamadas).toEqual([['rpc', 'parear_dispositivo', { p_codigo: CODIGO, p_tipo: 'obs_palco' }]])

    for (const resultado of ['invalido', 'tipo_errado', 'limite'] as const) {
      f.responderRpc({ data: [{ resultado, dispositivo: null, nome: null }] })
      expect(await f.servico.parear(CODIGO, 'camera')).toEqual({ resultado, dispositivo: null })
    }

    // resultado fora da lista, sem linha ou linha estranha → invalido (nunca pareado)
    for (const data of [[{ resultado: 'aceito', dispositivo: DISP, nome: 'x' }], [], null, [null], 'pareado']) {
      f.responderRpc({ data })
      expect(await f.servico.parear(CODIGO, 'camera'), JSON.stringify(data)).toEqual({ resultado: 'invalido', dispositivo: null })
    }
    // "pareado" sem dispositivo legível: o domínio decide (pareado sem dispositivo vira falha)
    f.responderRpc({ data: [{ resultado: 'pareado', dispositivo: null, nome: null }] })
    expect(await f.servico.parear(CODIGO, 'camera')).toEqual({ resultado: 'pareado', dispositivo: null })

    // erros: sessão de membro → 42501 → negado; falha do fetch → rede; o resto → outro
    f.responderRpc({ data: null, error: { code: '42501', message: 'só sessão anônima' }, status: 403 })
    expect(await motivoDe(f.servico.parear(CODIGO, 'camera'))).toBe('negado')
    f.responderRpc({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 })
    expect(await motivoDe(f.servico.parear(CODIGO, 'camera'))).toBe('rede')
    f.responderRpc({ data: null, error: { code: 'PGRST202', message: 'x' }, status: 404 })
    expect(await motivoDe(f.servico.parear(CODIGO, 'camera'))).toBe('outro')
    f.responderRpc(() => {
      throw new Error('lançado')
    })
    expect(await motivoDe(f.servico.parear(CODIGO, 'camera'))).toBe('outro')
  })

  test('parear-sem-console', async () => {
    const espioes = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const f = criarFalso()
    f.responderRpc({ data: [{ resultado: 'pareado', dispositivo: DISP, nome: 'Celular' }] })
    await f.servico.parear(CODIGO, 'camera')
    f.responderRpc({ data: [{ resultado: 'aceito' }] })
    await f.servico.parear(CODIGO, 'camera')
    for (const erro of [{ code: '42501', message: CODIGO }, { code: '', message: CODIGO }, { code: 'XX000', message: CODIGO }]) {
      f.responderRpc({ data: null, error: erro, status: 400 })
      const e = await f.servico.parear(CODIGO, 'camera').catch((x: unknown) => x)
      expect(e).toBeInstanceOf(ErroDeDispositivo)
      expect(String((e as Error).message)).not.toContain(CODIGO)
      expect(JSON.stringify(e)).not.toContain(CODIGO)
    }
    f.responderRpc(() => {
      throw new Error(CODIGO)
    })
    const lancado = await f.servico.parear(CODIGO, 'camera').catch((x: unknown) => x)
    expect(String((lancado as Error).message)).not.toContain(CODIGO)
    for (const espiao of espioes) {
      for (const args of espiao.mock.calls) expect(JSON.stringify(args)).not.toContain(CODIGO)
    }
  })

  test('dispositivo-atual', async () => {
    const f = criarFalso()
    // a linha só com as colunas de COLUNAS_DE_MEU_DISPOSITIVO, valores diferentes em cada uma
    expect([...COLUNAS_DE_MEU_DISPOSITIVO]).toEqual(['id', 'tipo', 'rotulo', 'camera_id'])
    f.responderRpc({ data: [{ id: DISP, tipo: 'obs_palco', rotulo: 'PC do estúdio', camera_id: null }] })
    expect(await f.servico.dispositivoAtual()).toEqual({ id: DISP, tipo: 'obs_palco', rotulo: 'PC do estúdio', cameraId: null })
    expect(f.chamadas).toEqual([['rpc', 'meu_dispositivo']])
    expect(f.chamadas.some((c) => c[1] === 'dispositivo_atual')).toBe(false)

    // o rótulo vem da coluna `rotulo` (e só dela): `nome` no lugar dele não é lido
    f.responderRpc({ data: [{ id: DISP, tipo: 'obs_camera', nome: 'Errado', camera_id: UID }] })
    expect(await f.servico.dispositivoAtual()).toBeNull()
    f.responderRpc({ data: [{ id: DISP, tipo: 'obs_camera', rotulo: 'OBS da câmera', camera_id: UID }] })
    expect(await f.servico.dispositivoAtual()).toEqual({ id: DISP, tipo: 'obs_camera', rotulo: 'OBS da câmera', cameraId: UID })

    // sem linha, tipo fora da lista, id que não é texto → null
    for (const data of [[], null, [{ id: DISP, tipo: 'tablet', rotulo: 'x', camera_id: null }], [{ id: 7, tipo: 'camera', rotulo: 'x', camera_id: null }]]) {
      f.responderRpc({ data })
      expect(await f.servico.dispositivoAtual(), JSON.stringify(data)).toBeNull()
    }

    f.responderRpc({ data: null, error: { code: '', message: 'x' }, status: 0 })
    expect(await motivoDe(f.servico.dispositivoAtual())).toBe('rede')
    f.responderRpc({ data: null, error: { code: '42501', message: 'x' }, status: 403 })
    expect(await motivoDe(f.servico.dispositivoAtual())).toBe('negado')
  })

  test('sair-local', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = criarFalso()
    await f.servico.sair()
    expect(f.chamadas).toEqual([['signOut', { scope: 'local' }]])

    f.saida(async () => ({ error: { status: 0, name: 'AuthRetryableFetchError' } }))
    await expect(f.servico.sair()).resolves.toBeUndefined()
    f.saida(async () => {
      throw new Error('sem rede')
    })
    await expect(f.servico.sair()).resolves.toBeUndefined()
    expect(f.chamadas.filter((c) => c[0] === 'signOut')).toEqual([['signOut', { scope: 'local' }], ['signOut', { scope: 'local' }], ['signOut', { scope: 'local' }]])
    // só o texto fixo vai para o console
    for (const args of aviso.mock.calls) expect(args).toEqual(['sair: o servidor não confirmou a saída; a sessão local foi apagada'])
  })
})

/*
 * Repositório dos gestos do aparelho que reconhece (PLA-006, D2, D5, D8; Tarefa 4): `situacao_dos_gestos()` e
 * `enviar_gesto(p_id, p_gesto)`. Só o uuid e o nome do gesto saem do aparelho; as respostas e os erros viram a lista fixa
 * de `RespostaDoGesto` (revisão 1, N3: `42501` e `55000` → `negado`).
 */
const GESTO_ID = '6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e'

describe('criarRepositorioDosGestosSupabase', () => {
  test('rpc-so-com-gesto-e-id', async () => {
    const f = criarFalso()
    const repo = criarRepositorioDosGestosSupabase(f.cliente)
    f.responderRpc({ data: 'enviado' })
    // um objeto com campos a mais (como um laço que passasse a leitura inteira) não leva nada além do id e do gesto
    const comExtras = { id: GESTO_ID, gesto: 'ILoveYou' as const, confianca: 0.93, quadro: 'nunca', pontos: [[0, 0]] }
    expect(await repo.enviar(comExtras)).toBe('enviado')
    expect(f.chamadas).toEqual([['rpc', 'enviar_gesto', { p_id: GESTO_ID, p_gesto: 'ILoveYou' }]])
    const [, , args] = f.chamadas[0] as [string, string, Record<string, unknown>]
    expect(Object.keys(args).sort()).toEqual(['p_gesto', 'p_id'])
    // id fora de uuid minúsculo ou gesto fora dos 7: falhou sem sair do aparelho
    for (const g of [
      { id: GESTO_ID.toUpperCase(), gesto: 'ILoveYou' },
      { id: 'x', gesto: 'Victory' },
      { id: GESTO_ID, gesto: 'None' },
      { id: GESTO_ID, gesto: 'victory' },
    ]) {
      expect(await repo.enviar(g as { id: string; gesto: 'Victory' })).toBe('falhou')
    }
    expect(f.chamadas).toHaveLength(1)
  })

  test.each([
    ['enviado', { data: 'enviado' }, 'enviado'],
    ['intervalo', { data: 'intervalo' }, 'intervalo'],
    ['desligados', { data: 'desligados' }, 'desligados'],
    ['sem_palco', { data: 'sem_palco' }, 'sem_palco'],
    ['54000 (600 por hora)', { error: { code: '54000', message: 'limite de gestos' }, status: 400 }, 'limite'],
    ['42501 (não reconhece aqui ou sessão caiu)', { error: { code: '42501', message: 'não reconhece aqui' }, status: 403 }, 'negado'],
    ['42501 com 401', { error: { code: '42501', message: 'x' }, status: 401 }, 'negado'],
    ['55000 (sem episódio ativo ou câmera revogada)', { error: { code: '55000', message: 'câmera revogada' }, status: 400 }, 'negado'],
    ['22023', { error: { code: '22023', message: 'gesto inválido' }, status: 400 }, 'falhou'],
    ['22P02', { error: { code: '22P02', message: 'x' }, status: 400 }, 'falhou'],
    ['JWT expirado', { error: { code: 'PGRST303', message: 'x' }, status: 401 }, 'falhou'],
    ['rede ou tempo-limite de 15 s', { error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 }, 'falhou'],
    ['texto fora da lista', { data: 'outra coisa' }, 'falhou'],
    ['sem dado', { data: null, status: 204 }, 'falhou'],
    ['lista', { data: ['enviado'] }, 'falhou'],
  ] as const)('respostas-do-gesto: %s', async (_nome, resposta, esperado) => {
    const f = criarFalso()
    f.responderRpc(resposta)
    expect(await criarRepositorioDosGestosSupabase(f.cliente).enviar({ id: GESTO_ID, gesto: 'Thumb_Up' })).toBe(esperado)
  })

  test('respostas-do-gesto: rpc que lança → falhou', async () => {
    const f = criarFalso()
    f.responderRpc(() => {
      throw new Error('rede')
    })
    expect(await criarRepositorioDosGestosSupabase(f.cliente).enviar({ id: GESTO_ID, gesto: 'Thumb_Up' })).toBe('falhou')
  })

  test('situacao-dos-gestos', async () => {
    const f = criarFalso()
    const repo = criarRepositorioDosGestosSupabase(f.cliente)
    f.responderRpc({ data: [{ ligados: true, reconhecer_aqui: false }] })
    expect(await repo.situacao()).toEqual({ ligados: true, reconhecerAqui: false })
    f.responderRpc({ data: [{ ligados: false, reconhecer_aqui: true }] })
    expect(await repo.situacao()).toEqual({ ligados: false, reconhecerAqui: true })
    expect(f.chamadas).toEqual([['rpc', 'situacao_dos_gestos'], ['rpc', 'situacao_dos_gestos']])
    // forma errada → a promessa falha (motivo outro); a rota a trata como { ligados: false, reconhecerAqui: false }
    for (const data of [[], null, [{ ligados: 'sim', reconhecer_aqui: true }], [{ ligados: true }], [{ ligados: null, reconhecer_aqui: null }], { ligados: true, reconhecer_aqui: true }, [null]]) {
      f.responderRpc({ data })
      expect(await motivoDe(repo.situacao())).toBe('outro')
    }
    // erros: 42501 → negado; rede → rede; o resto → outro; a mensagem do servidor nunca vai para o erro
    f.responderRpc({ error: { code: '42501', message: 'sem permissão' }, status: 403 })
    expect(await motivoDe(repo.situacao())).toBe('negado')
    f.responderRpc({ error: { code: '', message: 'x' }, status: 0 })
    expect(await motivoDe(repo.situacao())).toBe('rede')
    f.responderRpc({ error: { code: 'XX000', message: 'segredo do servidor' }, status: 500 })
    const e = await repo.situacao().catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ErroDeDispositivo)
    expect((e as Error).message).not.toContain('segredo')
  })
})
