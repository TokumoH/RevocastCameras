// @vitest-environment jsdom
import { afterEach, describe, test, expect } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { App } from './App'
import { resolverRota } from './rotas'

afterEach(cleanup)

describe('App', () => {
  test('mostra a tela de controle com o logo', () => {
    render(<App caminho="/controle" />)
    expect(screen.getByRole('heading', { name: 'Controle' })).toBeTruthy()
    expect(screen.getByAltText('RevoCast')).toBeTruthy()
  })

  test('mostra "Página não encontrada" no cartão rosa, com link para /entrar, para caminho desconhecido', () => {
    const { container } = render(<App caminho="/xyz" />)
    expect(screen.getByRole('heading', { name: 'Página não encontrada' })).toBeTruthy()
    expect(container.querySelector('section.cartao.cartao--rosa')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ir para a entrada' }).getAttribute('href')).toBe('/entrar')
  })

  test.each([
    ['/entrar', 'Em construção — etapa E1'],
    ['/painel', 'Em construção — etapa E1'],
    ['/controle', 'Em construção — etapa E3'],
    ['/camera', 'Em construção — etapa E4'],
    ['/obs/palco', 'Em construção — etapa E3'],
    ['/obs/camera', 'Em construção — etapa E4'],
    ['/xyz', 'Esse endereço não existe.'],
  ])('%s: logo, título de resolverRota (heading e document.title) e a frase "%s"', (caminho, frase) => {
    const { titulo } = resolverRota(caminho)
    render(<App caminho={caminho} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(titulo)
    expect(document.title).toBe(`${titulo} · RevoCast Câmeras`)
    expect(screen.getByText(frase)).toBeTruthy()
    expect(screen.getByAltText('RevoCast')).toBeTruthy()
  })
})
