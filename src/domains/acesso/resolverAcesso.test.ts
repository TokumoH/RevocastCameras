import { describe, test, expect } from 'vitest'
import { ErroDeAcesso } from './portas'
import type { RepositorioDeAcesso, ServicoDeAutenticacao, ServicosDeMembro } from './portas'
import type { Papel } from './papeis'
import { resolverAcesso } from './resolverAcesso'
import { SEM_RETORNO } from './retornoDoLogin'
import type { RetornoDoLogin } from './retornoDoLogin'
import type { UsuarioDaSessao } from './sessao'

interface Cenario {
  usuario?: UsuarioDaSessao | null | Error
  papel?: Papel | null | Error
  sairFalha?: boolean
}

/** Serviços falsos que implementam as portas e contam as chamadas de `sair` e `papelAtual`. */
function falsos({ usuario = null, papel = null, sairFalha = false }: Cenario) {
  const contagem = { sair: 0, papelAtual: 0 }
  const auth: ServicoDeAutenticacao = {
    async usuarioAtual() {
      if (usuario instanceof Error) throw usuario
      return usuario
    },
    aoMudarSessao() {
      return () => {}
    },
    async entrarComGoogle() {},
    async sair() {
      contagem.sair++
      if (sairFalha) throw new Error('sem rede')
    },
  }
  const naoUsado = async (): Promise<never> => {
    throw new Error('não usado neste teste')
  }
  const repo: RepositorioDeAcesso = {
    async papelAtual() {
      contagem.papelAtual++
      if (papel instanceof Error) throw papel
      return papel
    },
    listarPermitidos: naoUsado,
    listarPerfis: naoUsado,
    incluir: naoUsado,
    alterarPapel: naoUsado,
    remover: naoUsado,
  }
  const servicos: ServicosDeMembro = { auth, repo }
  return { servicos, contagem }
}

const google: UsuarioDaSessao = { id: 'id-ana', email: 'ana@revocast.test', anonimo: false, provedor: 'google' }
const retorno = (r: Partial<RetornoDoLogin>): RetornoDoLogin => ({ ...SEM_RETORNO, ...r })

describe('resolverAcesso', () => {
  test('sem-sessao', async () => {
    const { servicos, contagem } = falsos({ usuario: null })
    expect(await resolverAcesso(servicos, SEM_RETORNO)).toEqual({ tipo: 'sem_sessao', aviso: null })
    expect(contagem).toEqual({ sair: 0, papelAtual: 0 })
  })

  test('cancelado-no-google', async () => {
    const { servicos } = falsos({ usuario: null })
    expect(await resolverAcesso(servicos, retorno({ erro: 'cancelado', sujo: true }))).toEqual({
      tipo: 'sem_sessao',
      aviso: 'login_cancelado',
    })
    expect(await resolverAcesso(servicos, retorno({ erro: 'falha', fragmentoSujo: true }))).toEqual({
      tipo: 'sem_sessao',
      aviso: 'login_falhou',
    })
    // erro tem prioridade sobre código
    expect(await resolverAcesso(servicos, retorno({ erro: 'falha', temCodigo: true, sujo: true }))).toEqual({
      tipo: 'sem_sessao',
      aviso: 'login_falhou',
    })
  })

  test('codigo-sem-sessao', async () => {
    const { servicos, contagem } = falsos({ usuario: null })
    expect(await resolverAcesso(servicos, retorno({ temCodigo: true, sujo: true }))).toEqual({
      tipo: 'sem_sessao',
      aviso: 'login_incompleto',
    })
    expect(contagem).toEqual({ sair: 0, papelAtual: 0 })
  })

  test('falha-ao-ler-sessao', async () => {
    for (const erro of [new ErroDeAcesso('rede'), new Error('qualquer')]) {
      const { servicos, contagem } = falsos({ usuario: erro, papel: 'admin' })
      expect(await resolverAcesso(servicos, SEM_RETORNO), erro.message).toEqual({ tipo: 'falha' })
      expect(contagem, erro.message).toEqual({ sair: 0, papelAtual: 0 })
    }
  })

  test('anonima-nunca-membro', async () => {
    const { servicos, contagem } = falsos({ usuario: { ...google, anonimo: true }, papel: 'admin' })
    expect(await resolverAcesso(servicos, SEM_RETORNO)).toEqual({ tipo: 'sem_sessao', aviso: 'sessao_anonima' })
    expect(contagem).toEqual({ sair: 1, papelAtual: 0 })
  })

  test('provedor-nao-google', async () => {
    for (const provedor of ['email', null]) {
      const { servicos, contagem } = falsos({ usuario: { ...google, provedor }, papel: 'admin' })
      expect(await resolverAcesso(servicos, SEM_RETORNO), String(provedor)).toEqual({
        tipo: 'sem_sessao',
        aviso: 'provedor_invalido',
      })
      expect(contagem, String(provedor)).toEqual({ sair: 1, papelAtual: 0 })
    }
  })

  test('fora-da-lista', async () => {
    const { servicos, contagem } = falsos({ usuario: google, papel: null })
    expect(await resolverAcesso(servicos, SEM_RETORNO)).toEqual({ tipo: 'sem_papel', email: 'ana@revocast.test' })
    expect(contagem).toEqual({ sair: 1, papelAtual: 1 })
  })

  test('membro', async () => {
    const { servicos, contagem } = falsos({ usuario: google, papel: 'equipe' })
    expect(await resolverAcesso(servicos, SEM_RETORNO)).toEqual({ tipo: 'membro', papel: 'equipe', usuario: google })
    expect(contagem).toEqual({ sair: 0, papelAtual: 1 })
  })

  test('falha-de-rede', async () => {
    for (const erro of [new ErroDeAcesso('rede'), new Error('qualquer'), new ErroDeAcesso('negado')]) {
      const { servicos, contagem } = falsos({ usuario: google, papel: erro })
      expect(await resolverAcesso(servicos, SEM_RETORNO), erro.message).toEqual({ tipo: 'falha' })
      expect(contagem, erro.message).toEqual({ sair: 0, papelAtual: 1 })
    }
  })

  test('sessao-expirada', async () => {
    const { servicos, contagem } = falsos({ usuario: google, papel: new ErroDeAcesso('sessao_expirada') })
    expect(await resolverAcesso(servicos, SEM_RETORNO)).toEqual({ tipo: 'sem_sessao', aviso: 'sessao_expirada' })
    expect(contagem).toEqual({ sair: 1, papelAtual: 1 })
  })

  test('sair-que-falha-nao-derruba', async () => {
    const casos: [Cenario, unknown][] = [
      [{ usuario: google, papel: null }, { tipo: 'sem_papel', email: 'ana@revocast.test' }],
      [{ usuario: { ...google, anonimo: true }, papel: 'admin' }, { tipo: 'sem_sessao', aviso: 'sessao_anonima' }],
      [{ usuario: google, papel: new ErroDeAcesso('sessao_expirada') }, { tipo: 'sem_sessao', aviso: 'sessao_expirada' }],
    ]
    for (const [cenario, esperado] of casos) {
      const { servicos, contagem } = falsos({ ...cenario, sairFalha: true })
      await expect(resolverAcesso(servicos, SEM_RETORNO)).resolves.toEqual(esperado)
      expect(contagem.sair).toBe(1)
    }
  })

  test('so-termina-depois-do-sair', async () => {
    const casos: [Cenario, unknown][] = [
      [{ usuario: google, papel: null }, { tipo: 'sem_papel', email: 'ana@revocast.test' }],
      [{ usuario: { ...google, anonimo: true }, papel: 'admin' }, { tipo: 'sem_sessao', aviso: 'sessao_anonima' }],
      [{ usuario: google, papel: new ErroDeAcesso('sessao_expirada') }, { tipo: 'sem_sessao', aviso: 'sessao_expirada' }],
    ]
    for (const [cenario, esperado] of casos) {
      const { servicos, contagem } = falsos(cenario)
      let liberar = () => {}
      servicos.auth.sair = () => {
        contagem.sair++
        return new Promise<void>((r) => (liberar = r))
      }
      let resolvido = false
      const promessa = resolverAcesso(servicos, SEM_RETORNO).then((e) => {
        resolvido = true
        return e
      })
      await new Promise((r) => setTimeout(r, 0))
      expect(contagem.sair, JSON.stringify(esperado)).toBe(1)
      expect(resolvido, JSON.stringify(esperado)).toBe(false)
      liberar()
      expect(await promessa).toEqual(esperado)
      expect(resolvido).toBe(true)
    }
  })
})
