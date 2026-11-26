// @vitest-environment jsdom
import { afterEach, describe, test, expect } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Papel } from '../../domains/acesso/papeis'
import { App } from '../App'
import { criarFalsos, usuarioGoogle } from '../servicosFalsos'

afterEach(cleanup)

const ABAS_DA_EQUIPE = ['Episódios', 'Biblioteca', 'Cenas', 'Gestos', 'Ao vivo']
const ABAS_DO_ADMIN = ['Episódios', 'Biblioteca', 'Cenas', 'Gestos', 'Membros', 'Ao vivo']

async function abrirPainel(papel: Papel) {
  const f = criarFalsos({
    usuario: usuarioGoogle('adm@revocast.test'),
    papel,
    permitidos: [{ email: 'adm@revocast.test', papel: 'admin', criadoPor: null }],
  })
  const tela = render(<App caminho="/painel" dependencias={f.dependencias()} />)
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
    await abrirPainel('equipe')
    const episodios = screen.getByRole('tab', { name: 'Episódios' })
    expect(episodios.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').textContent).toContain('Em construção — etapa E2')

    const aoVivo = screen.getByRole('tab', { name: 'Ao vivo' })
    fireEvent.click(aoVivo)
    expect(aoVivo.getAttribute('aria-selected')).toBe('true')
    expect(episodios.getAttribute('aria-selected')).toBe('false')
    expect(within(screen.getByRole('tabpanel')).getByText('Em construção — etapa E3')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Biblioteca' }))
    expect(within(screen.getByRole('tabpanel')).getByText('Em construção — etapa E2')).toBeTruthy()
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
    expect(screen.getByRole('tabpanel').textContent).toContain('Em construção — etapa E2')
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
