// @vitest-environment jsdom
import { afterEach, describe, test, expect } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ErroDeAcesso } from '../domains/acesso/portas'
import type { Papel } from '../domains/acesso/papeis'
import type { UsuarioDaSessao } from '../domains/acesso/sessao'
import { ErroDeConfiguracao } from '../shared/infra/configuracao'
import { App } from './App'
import type { Dependencias } from './dependencias'
import { criarFalsos, usuarioGoogle } from './servicosFalsos'

afterEach(cleanup)

const ORIGEM = 'https://app.revocast.test'
type Falsos = ReturnType<typeof criarFalsos>

function abrir(caminho: string, f: Falsos, extra: Partial<Dependencias> = {}) {
  return render(<App caminho={caminho} dependencias={f.dependencias({ origem: ORIGEM, ...extra })} />)
}

/** Espera a avaliação de número `n` começar e deixa as promessas e os `setTimeout(0)` pendentes terminarem. */
async function esperarAvaliacoes(f: Falsos, n: number) {
  await waitFor(() => expect(f.chamadas.usuarioAtual).toBe(n))
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
  })
}

const ana = usuarioGoogle('ana@revocast.test')
const anonima: UsuarioDaSessao = { id: 'id-anonima', anonimo: true, email: 'ana@revocast.test', provedor: 'google' }

describe('entrada e guarda', () => {
  test('erro-de-configuracao-nomeia-variavel', async () => {
    for (const caminho of ['/entrar', '/painel', '/controle']) {
      const f = criarFalsos()
      abrir(caminho, f, {
        obterServicos: () => {
          throw new ErroDeConfiguracao('Variável de ambiente ausente ou vazia: VITE_SUPABASE_URL')
        },
      })
      expect(await screen.findByRole('heading', { name: 'Configuração incompleta' })).toBeTruthy()
      expect(screen.getByText(/VITE_SUPABASE_URL/)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Entrar com Google' })).toBeNull()
      cleanup()
    }
  })

  test('erro-inesperado-ao-iniciar', async () => {
    const f = criarFalsos()
    const { container } = abrir('/painel', f, {
      obterServicos: () => {
        throw new Error('detalhe interno')
      },
    })
    expect(await screen.findByRole('heading', { name: 'Não foi possível abrir esta página' })).toBeTruthy()
    expect(screen.queryByText(/detalhe interno/)).toBeNull()
    expect(container.textContent?.trim()).not.toBe('')
  })

  test('dispositivo-nao-cria-cliente-de-membro', async () => {
    const casos: [string, string][] = [
      ['/camera', 'Em construção — etapa E4'],
      ['/obs/palco', 'Em construção — etapa E3'],
      ['/obs/camera', 'Em construção — etapa E4'],
      ['/xyz', 'Esse endereço não existe.'],
    ]
    for (const [caminho, frase] of casos) {
      const f = criarFalsos({ usuario: ana, papel: 'admin' })
      abrir(caminho, f)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })
      expect(screen.getByText(frase)).toBeTruthy()
      expect(f.chamadas.obterServicos).toBe(0)
      expect(f.chamadas.usuarioAtual).toBe(0)
      cleanup()
    }
  })

  test('sem-sessao-mostra-entrada', async () => {
    const f = criarFalsos()
    abrir('/painel', f)
    fireEvent.click(await screen.findByRole('button', { name: 'Entrar com Google' }))
    await waitFor(() => expect(f.chamadas.entrar).toEqual([`${ORIGEM}/painel`]))
    expect(f.chamadas.obterServicos).toBe(1)
  })

  test('url-de-retorno-fixa', async () => {
    const casos: [string, string, string][] = [
      ['/entrar', '?volta=https://outro.revocast.test/x', `${ORIGEM}/entrar`],
      ['/controle', '?next=//outro.revocast.test', `${ORIGEM}/controle`],
    ]
    for (const [caminho, busca, esperado] of casos) {
      const f = criarFalsos()
      abrir(caminho, f, { busca })
      fireEvent.click(await screen.findByRole('button', { name: 'Entrar com Google' }))
      await waitFor(() => expect(f.chamadas.entrar).toEqual([esperado]))
      cleanup()
    }
  })

  test('entrar-leva-a-area-do-papel', async () => {
    const casos: [Papel, string][] = [
      ['admin', '/painel'],
      ['equipe', '/painel'],
      ['apresentadora', '/controle'],
    ]
    for (const [papel, destino] of casos) {
      const f = criarFalsos({ usuario: ana, papel })
      abrir('/entrar', f)
      await waitFor(() => expect(f.chamadas.navegar).toEqual([destino]))
      cleanup()
    }
  })

  test('fora-da-lista-sai-e-mensagem-fica', async () => {
    const f = criarFalsos({ usuario: usuarioGoogle('estranho@revocast.test'), papel: null })
    abrir('/painel', f)
    expect(await screen.findByRole('heading', { name: 'Acesso não liberado' })).toBeTruthy()
    expect(screen.getByText(/estranho@revocast\.test/)).toBeTruthy()
    expect(f.chamadas.sair).toBe(1)
    await esperarAvaliacoes(f, 2)
    expect(screen.getByRole('heading', { name: 'Acesso não liberado' })).toBeTruthy()
    expect(screen.getByText(/estranho@revocast\.test/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com outra conta' }))
    await waitFor(() => expect(f.chamadas.entrar).toEqual([`${ORIGEM}/painel`]))
  })

  test('anonima-sai', async () => {
    const f = criarFalsos({ usuario: anonima, papel: 'admin' })
    abrir('/painel', f)
    expect(await screen.findByText(/Esta sessão não é de membro/)).toBeTruthy()
    expect(f.chamadas.sair).toBe(1)
    await esperarAvaliacoes(f, 2)
    expect(screen.getByText(/Esta sessão não é de membro/)).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sair' })).toBeNull()
  })

  test('sessao-expirada-fica', async () => {
    const f = criarFalsos({ usuario: ana, papel: new ErroDeAcesso('sessao_expirada') })
    abrir('/painel', f)
    expect(await screen.findByText('Sua sessão expirou. Entre de novo.')).toBeTruthy()
    expect(f.chamadas.sair).toBe(1)
    await esperarAvaliacoes(f, 2)
    expect(screen.getByText('Sua sessão expirou. Entre de novo.')).toBeTruthy()
  })

  test('sair-lento-nao-apaga-mensagem', async () => {
    const casos: [string, Parameters<typeof criarFalsos>[0], RegExp][] = [
      ['fora da lista', { usuario: usuarioGoogle('estranho@revocast.test'), papel: null }, /estranho@revocast\.test/],
      ['anônima', { usuario: anonima, papel: 'admin' }, /Esta sessão não é de membro/],
      ['sessão expirada', { usuario: ana, papel: new ErroDeAcesso('sessao_expirada') }, /Sua sessão expirou/],
    ]
    for (const [nome, inicial, texto] of casos) {
      const f = criarFalsos(inicial)
      f.segurarSair()
      abrir('/painel', f)
      await waitFor(() => expect(f.chamadas.sair).toBe(1))
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
        await new Promise((r) => setTimeout(r, 0))
      })
      // o SIGNED_OUT já foi emitido, mas a reavaliação dele espera a primeira terminar
      expect(f.chamadas.usuarioAtual, nome).toBe(1)
      await act(async () => f.liberarSair())
      await esperarAvaliacoes(f, 2)
      expect(screen.getByText(texto), nome).toBeTruthy()
      if (nome === 'fora da lista') expect(screen.getByRole('heading', { name: 'Acesso não liberado' })).toBeTruthy()
      cleanup()
    }
  })

  test('erro-do-google-sem-texto-da-url', async () => {
    const texto = 'error=access_denied&error_description=Ligue%20para%20o%20suporte'
    const casos: [Partial<Dependencias>, 'sujo' | 'fragmentoSujo'][] = [
      [{ busca: `?${texto}` }, 'sujo'],
      [{ fragmento: `#${texto}` }, 'fragmentoSujo'],
    ]
    for (const [extra, campo] of casos) {
      const f = criarFalsos()
      abrir('/entrar', f, extra)
      expect(await screen.findByText('O login com o Google foi cancelado.')).toBeTruthy()
      expect(screen.getByRole('status').textContent).toBe('O login com o Google foi cancelado.')
      expect(screen.queryByText(/Ligue para o suporte/)).toBeNull()
      await waitFor(() => expect(f.chamadas.limpar).toHaveLength(1))
      expect(f.chamadas.limpar[0][campo]).toBe(true)
      cleanup()
    }
  })

  test('erro-nao-volta-na-troca-de-aba', async () => {
    const f = criarFalsos()
    abrir('/entrar', f, { busca: '?error=access_denied' })
    expect(await screen.findByText('O login com o Google foi cancelado.')).toBeTruthy()
    act(() => f.dispararVolta())
    await esperarAvaliacoes(f, 2)
    expect(screen.queryByText('O login com o Google foi cancelado.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Entrar com Google' })).toBeTruthy()
  })

  test('codigo-sem-sessao', async () => {
    const f = criarFalsos()
    abrir('/painel', f, { busca: '?code=abc' })
    expect(await screen.findByText(/O login não terminou neste navegador/)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('O login não terminou neste navegador. Tente de novo por aqui.')
    await waitFor(() => expect(f.chamadas.limpar).toHaveLength(1))
    expect(f.chamadas.limpar[0].sujo).toBe(true)
  })

  test('sair-depois-de-codigo', async () => {
    const f = criarFalsos({ usuario: ana, papel: 'equipe' })
    abrir('/painel', f, { busca: '?code=abc' })
    fireEvent.click(await screen.findByRole('button', { name: 'Sair' }))
    await waitFor(() => expect(f.chamadas.sair).toBe(1))
    await esperarAvaliacoes(f, 2)
    expect(screen.getByRole('button', { name: 'Entrar com Google' })).toBeTruthy()
    expect(screen.queryByText(/não terminou/)).toBeNull()
  })

  test('limpa-depois-de-resolver', async () => {
    const f = criarFalsos({ usuario: ana, papel: 'equipe' })
    let liberar: (() => void) | null = null
    f.servicos.repo.papelAtual = () =>
      new Promise<Papel | null>((resolve) => {
        liberar = () => resolve('equipe')
      })
    abrir('/painel', f, { busca: '?code=abc' })
    await waitFor(() => expect(liberar).not.toBeNull())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(f.chamadas.limpar).toEqual([])
    await act(async () => liberar?.())
    await waitFor(() => expect(f.chamadas.limpar).toHaveLength(1))
    expect(await screen.findByRole('button', { name: 'Sair' })).toBeTruthy()
  })

  test('sem-acesso-por-papel', async () => {
    const f = criarFalsos({ usuario: ana, papel: 'apresentadora' })
    abrir('/painel', f)
    expect(await screen.findByRole('heading', { name: 'Sem acesso a esta página' })).toBeTruthy()
    expect(screen.getByText('Seu papel (Apresentadora) não abre esta área.')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Ir para/ }).getAttribute('href')).toBe('/controle')
    expect(f.chamadas.sair).toBe(0)
  })

  test('troca-de-papel-ao-voltar', async () => {
    const f = criarFalsos({ usuario: ana, papel: 'equipe' })
    abrir('/painel', f)
    expect(await screen.findByRole('button', { name: 'Sair' })).toBeTruthy()
    f.definirPapel('apresentadora')
    act(() => f.dispararVolta())
    await esperarAvaliacoes(f, 2)
    expect(screen.getByRole('heading', { name: 'Sem acesso a esta página' })).toBeTruthy()
    f.definirPapel(null)
    act(() => f.dispararVolta())
    expect(await screen.findByRole('heading', { name: 'Acesso não liberado' })).toBeTruthy()
    expect(f.chamadas.sair).toBe(1)
    // a 3ª avaliação trouxe sem_papel e saiu; a 4ª é a do SIGNED_OUT desse sair
    await esperarAvaliacoes(f, 4)
    expect(screen.getByRole('heading', { name: 'Acesso não liberado' })).toBeTruthy()
    expect(screen.getByText(/ana@revocast\.test/)).toBeTruthy()
  })

  test('falha-ao-ler-sessao-na-tela', async () => {
    const f = criarFalsos({ usuario: new ErroDeAcesso('rede') })
    abrir('/painel', f)
    expect(await screen.findByRole('heading', { name: 'Não foi possível falar com o servidor' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Entrar com Google' })).toBeNull()
    expect(f.chamadas.sair).toBe(0)
  })

  test('falha-e-tentar-de-novo', async () => {
    const f = criarFalsos({ usuario: ana, papel: new ErroDeAcesso('rede') })
    abrir('/painel', f)
    expect(await screen.findByRole('heading', { name: 'Não foi possível falar com o servidor' })).toBeTruthy()
    expect(f.chamadas.sair).toBe(0)
    f.definirPapel('equipe')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('button', { name: 'Sair' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Painel' })).toBeTruthy()
    expect(f.chamadas.sair).toBe(0)
  })

  test('controle-guardado', async () => {
    const f = criarFalsos({ usuario: ana, papel: 'apresentadora' })
    abrir('/controle', f)
    expect(await screen.findByText('Em construção — etapa E3')).toBeTruthy()
    expect(screen.getByText('ana@revocast.test')).toBeTruthy()
    expect(screen.getByText('Apresentadora')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy()
  })

  test('erro-na-fila-mostra-falha', async () => {
    // usuário com um campo que lança ao ser lido: resolverAcesso rejeita fora dos seus try (defeito, não porta)
    const defeituoso = { id: 'id-x', email: 'ana@revocast.test', provedor: 'google' } as UsuarioDaSessao
    Object.defineProperty(defeituoso, 'anonimo', {
      get() {
        throw new Error('defeito interno')
      },
    })
    const f = criarFalsos({ usuario: defeituoso, papel: 'equipe' })
    abrir('/painel', f)
    expect(await screen.findByRole('heading', { name: 'Não foi possível falar com o servidor' })).toBeTruthy()
    expect(screen.queryByText(/defeito interno/)).toBeNull()
    f.definirUsuario(ana)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('button', { name: 'Sair' })).toBeTruthy()
  })

  test('limpar-que-lanca-nao-troca-membro', async () => {
    const f = criarFalsos({ usuario: ana, papel: 'equipe' })
    abrir('/painel', f, {
      busca: '?code=abc',
      limparRetornoDaUrl: () => {
        f.chamadas.limpar.push({ erro: null, temCodigo: true, sujo: true, fragmentoSujo: false })
        throw new Error('history indisponível')
      },
    })
    await waitFor(() => expect(f.chamadas.limpar).toHaveLength(1))
    await esperarAvaliacoes(f, 1)
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Não foi possível falar com o servidor' })).toBeNull()
  })

  test('nao-limpa-sem-retorno', async () => {
    const f = criarFalsos({ usuario: ana, papel: 'equipe' })
    abrir('/painel', f, { busca: '?outro=1', fragmento: '#ancora' })
    expect(await screen.findByRole('button', { name: 'Sair' })).toBeTruthy()
    await esperarAvaliacoes(f, 1)
    expect(f.chamadas.limpar).toEqual([])
  })

  test('desmontagem-cancela-e-nao-aplica', async () => {
    const f = criarFalsos({ usuario: ana, papel: 'equipe' })
    let liberar: (() => void) | null = null
    f.servicos.repo.papelAtual = () =>
      new Promise<Papel | null>((resolve) => {
        liberar = () => resolve('equipe')
      })
    const { unmount } = abrir('/painel', f, { busca: '?code=abc' })
    await waitFor(() => expect(liberar).not.toBeNull())
    expect(f.ouvintesAtivos()).toEqual({ sessao: 1, volta: 1 })
    unmount()
    expect(f.ouvintesAtivos()).toEqual({ sessao: 0, volta: 0 })
    // a avaliação que estava pendente termina depois da desmontagem: nada é aplicado nem limpo
    await act(async () => liberar?.())
    f.dispararMudancaDeSessao()
    f.dispararVolta()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(f.chamadas.limpar).toEqual([])
    expect(f.chamadas.usuarioAtual).toBe(1)
  })

  test('sair-aplica-sem-sessao-direto', async () => {
    const f = criarFalsos({ usuario: ana, papel: 'admin' })
    // sair que não emite a mudança de sessão: só a ação do hook pode trocar a tela
    f.servicos.auth.sair = async () => {
      f.chamadas.sair++
      f.definirUsuario(null)
    }
    abrir('/painel', f)
    fireEvent.click(await screen.findByRole('button', { name: 'Sair' }))
    expect(await screen.findByRole('button', { name: 'Entrar com Google' })).toBeTruthy()
    expect(f.chamadas.sair).toBe(1)
    expect(f.chamadas.usuarioAtual).toBe(1)
  })

  test('sair', async () => {
    const f = criarFalsos({ usuario: ana, papel: 'admin' })
    abrir('/painel', f)
    fireEvent.click(await screen.findByRole('button', { name: 'Sair' }))
    await waitFor(() => expect(f.chamadas.sair).toBe(1))
    expect(await screen.findByRole('button', { name: 'Entrar com Google' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sair' })).toBeNull()
  })
})
