import { afterEach, describe, expect, test, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ErroDeAcesso } from '../../domains/acesso/portas'
import { criarAutenticacaoSupabase, criarRepositorioDeAcessoSupabase, traduzirErro } from './acessoSupabase'

interface Resposta {
  data?: unknown
  error?: unknown
  status?: number
}

type Ouvinte = (evento: string, sessao: unknown) => void

/**
 * Cliente Supabase falso: registra cada chamada da cadeia do PostgREST (`from`, `select`, `insert`,
 * `update`, `delete`, `eq`, `order`, `rpc`) e devolve a resposta configurada quando aguardado.
 * Os métodos de `auth` usados pelo adaptador são `vi.fn` que cada teste configura.
 */
function criarFalso() {
  const chamadas: unknown[][] = []
  let resposta: Resposta = {}
  const construtor: Record<string, unknown> = {}
  for (const metodo of ['select', 'insert', 'update', 'delete', 'eq', 'order']) {
    construtor[metodo] = (...args: unknown[]) => {
      chamadas.push([metodo, ...args])
      return construtor
    }
  }
  construtor.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null, status: 200, ...resposta }).then(ok, falha)

  let ouvinte: Ouvinte | null = null
  const unsubscribe = vi.fn()
  const auth = {
    getSession: vi.fn(async (): Promise<Resposta> => ({ data: { session: null }, error: null })),
    signInWithOAuth: vi.fn(async (_opcoes: unknown): Promise<Resposta> => ({ data: {}, error: null })),
    signOut: vi.fn(async (_opcoes: unknown): Promise<Resposta> => ({ error: null })),
    onAuthStateChange: vi.fn((cb: Ouvinte) => {
      ouvinte = cb
      return { data: { subscription: { unsubscribe } } }
    }),
  }
  const cliente = {
    from: (...args: unknown[]) => {
      chamadas.push(['from', ...args])
      return construtor
    },
    rpc: (...args: unknown[]) => {
      chamadas.push(['rpc', ...args])
      return construtor
    },
    auth,
  } as unknown as SupabaseClient

  return {
    cliente,
    chamadas,
    auth,
    unsubscribe,
    responder(r: Resposta) {
      resposta = r
    },
    emitir(evento: string) {
      if (!ouvinte) throw new Error('nenhum ouvinte registrado')
      ouvinte(evento, null)
    },
  }
}

/** Erro como o `auth-js` 2.119.0 devolve com a rede caída (`name` é o que `isAuthRetryableFetchError` confere). */
function erroDeRede(): Error {
  const e = new Error('Failed to fetch')
  e.name = 'AuthRetryableFetchError'
  return e
}

async function motivoDe(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa
  } catch (e) {
    if (e instanceof ErroDeAcesso) return e.motivo
    throw e
  }
  throw new Error('esperava ErroDeAcesso')
}

const AVISO_SAIR = 'sair: o servidor não confirmou a saída; a sessão local foi apagada'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('criarAutenticacaoSupabase', () => {
  test('usuario-da-sessao', async () => {
    const f = criarFalso()
    const auth = criarAutenticacaoSupabase(f.cliente)
    const sessao = (user: unknown) => ({ data: { session: { user } }, error: null })

    f.auth.getSession.mockResolvedValueOnce(
      sessao({ id: 'id-ana', email: 'ana@revocast.test', is_anonymous: false, app_metadata: { provider: 'google' } }),
    )
    expect(await auth.usuarioAtual()).toEqual({ id: 'id-ana', email: 'ana@revocast.test', anonimo: false, provedor: 'google' })

    f.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null })
    expect(await auth.usuarioAtual()).toBeNull()

    f.auth.getSession.mockResolvedValueOnce(sessao({ id: 'id-ana', email: 'ana@revocast.test', app_metadata: { provider: 'google' } }))
    expect(await auth.usuarioAtual()).toEqual({ id: 'id-ana', email: 'ana@revocast.test', anonimo: false, provedor: 'google' })

    f.auth.getSession.mockResolvedValueOnce(sessao({ id: 'id-x', is_anonymous: true, app_metadata: {} }))
    expect(await auth.usuarioAtual()).toEqual({ id: 'id-x', email: null, anonimo: true, provedor: null })
  })

  test('usuario-da-sessao-com-erro', async () => {
    const f = criarFalso()
    const auth = criarAutenticacaoSupabase(f.cliente)
    f.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: erroDeRede() })
    expect(await motivoDe(auth.usuarioAtual())).toBe('rede')
    f.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: new Error('outro') })
    expect(await motivoDe(auth.usuarioAtual())).toBe('rede')
  })

  test('usuario-da-sessao-que-lanca', async () => {
    const f = criarFalso()
    const auth = criarAutenticacaoSupabase(f.cliente)
    f.auth.getSession.mockRejectedValueOnce(new Error('ana@revocast.test token-secreto'))
    const erro = await auth.usuarioAtual().catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(ErroDeAcesso)
    expect((erro as ErroDeAcesso).motivo).toBe('rede')
    expect((erro as ErroDeAcesso).message).not.toContain('ana@revocast.test')
  })

  test('entrar-com-google', async () => {
    const f = criarFalso()
    const auth = criarAutenticacaoSupabase(f.cliente)
    await auth.entrarComGoogle('https://app.revocast.test/painel')
    expect(f.auth.signInWithOAuth).toHaveBeenCalledTimes(1)
    expect(f.auth.signInWithOAuth.mock.calls[0]).toEqual([
      {
        provider: 'google',
        options: { redirectTo: 'https://app.revocast.test/painel', queryParams: { prompt: 'select_account' } },
      },
    ])
    f.auth.signInWithOAuth.mockResolvedValueOnce({ data: {}, error: erroDeRede() })
    expect(await motivoDe(auth.entrarComGoogle('https://app.revocast.test/painel'))).toBe('rede')
  })

  test('sair-local', async () => {
    const f = criarFalso()
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await criarAutenticacaoSupabase(f.cliente).sair()
    expect(f.auth.signOut.mock.calls).toEqual([[{ scope: 'local' }]])
    expect(aviso).not.toHaveBeenCalled()
  })

  test('sair-sem-rede', async () => {
    const f = criarFalso()
    const auth = criarAutenticacaoSupabase(f.cliente)
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})

    f.auth.signOut.mockResolvedValueOnce({ error: erroDeRede() })
    await expect(auth.sair()).resolves.toBeUndefined()
    f.auth.signOut.mockRejectedValueOnce(new Error('ana@revocast.test token-secreto'))
    await expect(auth.sair()).resolves.toBeUndefined()

    expect(aviso.mock.calls).toEqual([[AVISO_SAIR], [AVISO_SAIR]])
  })

  test('aoMudarSessao-adia-e-cancela', () => {
    vi.useFakeTimers()
    const f = criarFalso()
    const ouvinte = vi.fn()
    const cancelar = criarAutenticacaoSupabase(f.cliente).aoMudarSessao(ouvinte)

    f.emitir('SIGNED_IN')
    expect(ouvinte).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(ouvinte).toHaveBeenCalledTimes(1)

    f.emitir('INITIAL_SESSION')
    vi.runAllTimers()
    expect(ouvinte).toHaveBeenCalledTimes(1)

    f.emitir('SIGNED_OUT')
    f.emitir('TOKEN_REFRESHED')
    expect(ouvinte).toHaveBeenCalledTimes(1)
    vi.runAllTimers()
    expect(ouvinte).toHaveBeenCalledTimes(3)

    expect(f.unsubscribe).not.toHaveBeenCalled()
    cancelar()
    expect(f.unsubscribe).toHaveBeenCalledTimes(1)
  })

  test('aoMudarSessao-cancelado-nao-chama-agendado', () => {
    vi.useFakeTimers()
    const f = criarFalso()
    const ouvinte = vi.fn()
    const cancelar = criarAutenticacaoSupabase(f.cliente).aoMudarSessao(ouvinte)
    f.emitir('SIGNED_OUT')
    cancelar()
    vi.runAllTimers()
    expect(ouvinte).toHaveBeenCalledTimes(0)
  })
})

describe('criarRepositorioDeAcessoSupabase', () => {
  test('papel-atual', async () => {
    const f = criarFalso()
    const repo = criarRepositorioDeAcessoSupabase(f.cliente)
    f.responder({ data: 'admin' })
    expect(await repo.papelAtual()).toBe('admin')
    expect(f.chamadas).toEqual([['rpc', 'papel_atual']])
    f.responder({ data: null })
    expect(await repo.papelAtual()).toBeNull()
    f.responder({ data: 'superadmin' })
    expect(await repo.papelAtual()).toBeNull()
    f.responder({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 })
    expect(await motivoDe(repo.papelAtual())).toBe('rede')
  })

  test('listar', async () => {
    const f = criarFalso()
    const repo = criarRepositorioDeAcessoSupabase(f.cliente)

    f.responder({
      data: [
        { email: 'adm@revocast.test', papel: 'admin', criado_por: null },
        { email: 'ana@revocast.test', papel: 'equipe', criado_por: 'id-adm' },
        { email: 'zed@revocast.test', papel: 'superadmin', criado_por: 'id-adm' },
      ],
    })
    expect(await repo.listarPermitidos()).toEqual([
      { email: 'adm@revocast.test', papel: 'admin', criadoPor: null },
      { email: 'ana@revocast.test', papel: 'equipe', criadoPor: 'id-adm' },
    ])
    expect(f.chamadas).toEqual([
      ['from', 'membros_permitidos'],
      ['select', 'email, papel, criado_por'],
      ['order', 'email'],
    ])

    f.chamadas.length = 0
    f.responder({ data: [{ id: 'id-ana', email: 'ana@revocast.test', nome: 'Ana' }] })
    expect(await repo.listarPerfis()).toEqual([{ id: 'id-ana', email: 'ana@revocast.test', nome: 'Ana' }])
    expect(f.chamadas).toEqual([
      ['from', 'membros'],
      ['select', 'id, email, nome'],
      ['order', 'email'],
    ])

    f.responder({ data: null, error: { code: '42501', message: 'permission denied' }, status: 403 })
    expect(await motivoDe(repo.listarPermitidos())).toBe('negado')
    expect(await motivoDe(repo.listarPerfis())).toBe('negado')
  })

  test('incluir', async () => {
    const f = criarFalso()
    const repo = criarRepositorioDeAcessoSupabase(f.cliente)
    f.responder({ data: null, status: 201 })
    await repo.incluir('Nova@Revocast.TEST', 'equipe', 'id-adm')
    expect(f.chamadas).toEqual([
      ['from', 'membros_permitidos'],
      ['insert', { email: 'Nova@Revocast.TEST', papel: 'equipe', criado_por: 'id-adm' }],
    ])

    f.responder({
      data: null,
      error: { code: '23505', message: 'Key (email)=(nova@revocast.test) already exists.' },
      status: 409,
    })
    const erro = await repo.incluir('nova@revocast.test', 'equipe', 'id-adm').catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(ErroDeAcesso)
    expect((erro as ErroDeAcesso).motivo).toBe('duplicado')
    expect((erro as ErroDeAcesso).message).not.toContain('nova@revocast.test')
  })

  test('alterar-e-remover-com-retorno', async () => {
    const f = criarFalso()
    const repo = criarRepositorioDeAcessoSupabase(f.cliente)

    f.responder({ data: [{ email: 'ana@revocast.test' }] })
    await repo.alterarPapel('ana@revocast.test', 'apresentadora')
    expect(f.chamadas).toEqual([
      ['from', 'membros_permitidos'],
      ['update', { papel: 'apresentadora' }],
      ['eq', 'email', 'ana@revocast.test'],
      ['select', 'email'],
    ])

    f.chamadas.length = 0
    await repo.remover('ana@revocast.test')
    expect(f.chamadas).toEqual([
      ['from', 'membros_permitidos'],
      ['delete'],
      ['eq', 'email', 'ana@revocast.test'],
      ['select', 'email'],
    ])

    f.responder({ data: [] })
    expect(await motivoDe(repo.alterarPapel('adm@revocast.test', 'equipe'))).toBe('nada_alterado')
    expect(await motivoDe(repo.remover('adm@revocast.test'))).toBe('nada_alterado')

    f.responder({ data: null, error: { code: '42501', message: 'x' }, status: 401 })
    expect(await motivoDe(repo.alterarPapel('ana@revocast.test', 'equipe'))).toBe('sessao_expirada')
    expect(await motivoDe(repo.remover('ana@revocast.test'))).toBe('sessao_expirada')
  })
})

describe('traduzirErro', () => {
  test('traduz-erros', () => {
    const casos: [{ code?: string; message?: string } | null, number | undefined, string][] = [
      // (1) sessão expirada vem antes de tudo, inclusive do 42501 que o PostgREST manda com 401
      [{ code: '42501', message: 'permission denied' }, 401, 'sessao_expirada'],
      [{ code: '23505' }, 401, 'sessao_expirada'],
      [{ code: 'PGRST301' }, 401, 'sessao_expirada'],
      [{ code: 'PGRST301' }, undefined, 'sessao_expirada'],
      [{ code: 'PGRST303' }, 403, 'sessao_expirada'],
      [{}, 401, 'sessao_expirada'],
      [null, 401, 'sessao_expirada'],
      // (2) e (3)
      [{ code: '23505' }, 409, 'duplicado'],
      [{ code: '23514' }, 400, 'invalido'],
      // (4)
      [{ code: '42501' }, 403, 'negado'],
      [{ code: '42501' }, undefined, 'negado'],
      // (5) falha do fetch no postgrest-js: code '' e status 0
      [{ code: '', message: 'TypeError: Failed to fetch' }, 0, 'rede'],
      [{ message: 'TypeError: Failed to fetch' }, 0, 'rede'],
      [null, 0, 'rede'],
      // (6)
      [{ code: '', message: 'x' }, 500, 'outro'],
      [{ code: 'XX000' }, 500, 'outro'],
      [{ code: 'PGRST116' }, 406, 'outro'],
      [{}, undefined, 'outro'],
      [null, undefined, 'outro'],
    ]
    for (const [erro, status, motivo] of casos) {
      const traduzido = traduzirErro(erro, status)
      expect(traduzido, JSON.stringify([erro, status])).toBeInstanceOf(ErroDeAcesso)
      expect(traduzido.motivo, JSON.stringify([erro, status])).toBe(motivo)
    }
  })

  test('a mensagem não leva o e-mail nem o texto do servidor', () => {
    const e = traduzirErro({ code: '23514', message: 'new row for (Nova@Revocast.TEST) violates check' }, 400)
    expect(e.message).not.toContain('Nova@Revocast.TEST')
    expect(e.message).not.toContain('violates')
  })
})
