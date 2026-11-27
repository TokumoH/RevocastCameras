// @vitest-environment jsdom
import { afterEach, describe, test, expect, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Papel } from '../../domains/acesso/papeis'
import { App } from '../App'
import type { Dependencias } from '../dependencias'
import { criarFalsos, criarFalsosDePreparacao, preparacaoVazia, usuarioGoogle } from '../servicosFalsos'

afterEach(cleanup)

const ABAS_DA_EQUIPE = ['Episódios', 'Biblioteca', 'Cenas', 'Gestos', 'Ao vivo']
const ABAS_DO_ADMIN = ['Episódios', 'Biblioteca', 'Cenas', 'Gestos', 'Membros', 'Ao vivo']

async function abrirPainel(papel: Papel, extra: Partial<Dependencias> = {}) {
  const f = criarFalsos({
    usuario: usuarioGoogle('adm@revocast.test'),
    papel,
    permitidos: [{ email: 'adm@revocast.test', papel: 'admin', criadoPor: null }],
  })
  const tela = render(<App caminho="/painel" dependencias={f.dependencias(extra)} />)
  await screen.findByRole('tablist')
  return { f, ...tela }
}

const rotulos = () => screen.getAllByRole('tab').map((t) => t.textContent)

describe('painel com abas (D8)', () => {
  test('equipe-ve-abas-sem-membros', async () => {
    await abrirPainel('equipe')
    expect(rotulos()).toEqual(ABAS_DA_EQUIPE)
    expect(screen.queryByRole('tab', { name: 'Membros' })).toBeNull()
  })

  test('admin-ve-membros', async () => {
    await abrirPainel('admin')
    expect(rotulos()).toEqual(ABAS_DO_ADMIN)
  })

  test('aba-provisoria', async () => {
    // desde a Tarefa 7 da E2, só "Ao vivo" continua provisória (etapa E3)
    await abrirPainel('equipe')
    const episodios = screen.getByRole('tab', { name: 'Episódios' })
    expect(episodios.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').textContent).not.toContain('Em construção')

    const aoVivo = screen.getByRole('tab', { name: 'Ao vivo' })
    fireEvent.click(aoVivo)
    expect(aoVivo.getAttribute('aria-selected')).toBe('true')
    expect(episodios.getAttribute('aria-selected')).toBe('false')
    expect(within(screen.getByRole('tabpanel')).getByText('Em construção — etapa E3')).toBeTruthy()

    for (const rotulo of ['Episódios', 'Biblioteca', 'Cenas', 'Gestos']) {
      fireEvent.click(screen.getByRole('tab', { name: rotulo }))
      expect(screen.getByRole('tabpanel').textContent, rotulo).not.toContain('Em construção')
    }
  })

  test('episodios-no-painel', async () => {
    const preparacao = criarFalsosDePreparacao({ episodios: [{ id: 'ep-1', titulo: 'Episódio de teste', data: '2026-11-20', estado: 'rascunho' }] })
    const obterPreparacao = vi.fn(() => preparacao.servicos)
    await abrirPainel('equipe', { obterPreparacao })
    // a aba inicial "Episódios" mostra a lista, sem "Em construção"
    const painel = screen.getByRole('tabpanel')
    expect(await within(painel).findByText('Episódio de teste')).toBeTruthy()
    expect(within(painel).getByRole('button', { name: 'Criar episódio' })).toBeTruthy()
    expect(within(painel).getByText('Iniciar e encerrar o ao vivo chegam na etapa E3.')).toBeTruthy()
    expect(painel.textContent).not.toContain('Em construção')
    expect(obterPreparacao).toHaveBeenCalledTimes(1)
  })

  test('biblioteca-no-painel', async () => {
    const obterPreparacao = vi.fn(preparacaoVazia)
    await abrirPainel('equipe', { obterPreparacao })
    fireEvent.click(screen.getByRole('tab', { name: 'Biblioteca' }))
    const painel = screen.getByRole('tabpanel')
    expect(await within(painel).findByLabelText('Enviar sons e imagens')).toBeTruthy()
    expect(await within(painel).findByText('0,0 MB de 1 GB')).toBeTruthy()
    expect(painel.textContent).not.toContain('Em construção')
    // os serviços da Preparação são obtidos uma vez, mesmo trocando de aba
    fireEvent.click(screen.getByRole('tab', { name: 'Episódios' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Biblioteca' }))
    await within(screen.getByRole('tabpanel')).findByText('0,0 MB de 1 GB')
    expect(obterPreparacao).toHaveBeenCalledTimes(1)
  })

  test('cenas-e-gestos-no-painel', async () => {
    const preparacao = criarFalsosDePreparacao()
    const obterPreparacao = vi.fn(() => preparacao.servicos)
    await abrirPainel('equipe', { obterPreparacao })
    fireEvent.click(screen.getByRole('tab', { name: 'Cenas' }))
    let painel = screen.getByRole('tabpanel')
    expect(await within(painel).findByRole('button', { name: 'Incluir' })).toBeTruthy()
    expect(within(painel).getByLabelText('Nome no OBS')).toBeTruthy()
    expect(painel.textContent).not.toContain('Em construção')
    fireEvent.click(screen.getByRole('tab', { name: 'Gestos' }))
    painel = screen.getByRole('tabpanel')
    const lista = await within(painel).findByRole('list', { name: 'Mapa de gestos' })
    expect(within(lista).getAllByRole('listitem')).toHaveLength(7)
    expect(painel.textContent).not.toContain('Em construção')
    // os serviços da Preparação continuam obtidos uma vez só
    expect(obterPreparacao).toHaveBeenCalledTimes(1)
  })

  test('abas-acessiveis', async () => {
    for (const papel of ['admin', 'equipe'] as const) {
      const { container } = await abrirPainel(papel)
      expect(screen.getAllByRole('tablist')).toHaveLength(1)
      const abas = screen.getAllByRole('tab')
      for (const aba of abas) {
        const id = aba.getAttribute('aria-controls')
        expect(id, aba.textContent ?? '').toBeTruthy()
        const painel = container.querySelector(`[id="${id}"]`)
        expect(painel?.getAttribute('role')).toBe('tabpanel')
        expect(painel?.getAttribute('aria-labelledby')).toBe(aba.id)
      }
      // só o painel da aba ativa fica visível
      expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
      cleanup()
    }
  })

  test('abas-com-teclado', async () => {
    await abrirPainel('admin')
    const abas = screen.getAllByRole('tab')
    expect(abas.map((a) => a.tabIndex)).toEqual([0, -1, -1, -1, -1, -1])
    abas[0].focus()
    fireEvent.keyDown(abas[0], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Ao vivo' }))
    expect(screen.getByRole('tab', { name: 'Ao vivo' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(screen.getByRole('tab', { name: 'Episódios' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Biblioteca' }))
    // as teclas das abas não rolam a página (preventDefault: fireEvent devolve false)
    expect(fireEvent.keyDown(document.activeElement!, { key: 'End' })).toBe(false)
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Home' })).toBe(false)
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Tab' })).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Ao vivo' }).tabIndex).toBe(0)
  })

  test('membros-abre-a-lista', async () => {
    await abrirPainel('admin')
    fireEvent.click(screen.getByRole('tab', { name: 'Membros' }))
    expect(await within(screen.getByRole('tabpanel')).findByRole('table')).toBeTruthy()
    expect(within(screen.getByRole('table')).getByText('adm@revocast.test')).toBeTruthy()
  })

  test('membros-some-quando-rebaixado', async () => {
    const { f } = await abrirPainel('admin')
    fireEvent.click(screen.getByRole('tab', { name: 'Membros' }))
    await within(screen.getByRole('tabpanel')).findByRole('table')
    f.definirPapel('equipe')
    act(() => f.dispararMudancaDeSessao())
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Membros' })).toBeNull())
    expect(rotulos()).toEqual(ABAS_DA_EQUIPE)
    expect(screen.getByRole('tab', { name: 'Episódios' }).getAttribute('aria-selected')).toBe('true')
    expect(within(screen.getByRole('tabpanel')).getByRole('heading', { name: 'Episódios' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  test('rebaixado-e-promovido-nao-reabre-membros', async () => {
    const { f } = await abrirPainel('admin')
    fireEvent.click(screen.getByRole('tab', { name: 'Membros' }))
    await within(screen.getByRole('tabpanel')).findByRole('table')
    f.definirPapel('equipe')
    act(() => f.dispararMudancaDeSessao())
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Membros' })).toBeNull())
    f.definirPapel('admin')
    act(() => f.dispararMudancaDeSessao())
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Membros' })).toBeTruthy())
    expect(screen.getByRole('tab', { name: 'Episódios' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Membros' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.queryByRole('table')).toBeNull()
  })
})
