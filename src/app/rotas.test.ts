import { describe, test, expect } from 'vitest'
import { resolverRota } from './rotas'

describe('resolverRota', () => {
  test.each([
    ['/entrar', 'entrar', 'Entrar'],
    ['/painel', 'painel', 'Painel'],
    ['/painel/', 'painel', 'Painel'],
    ['/painel//', 'painel', 'Painel'],
    ['/controle', 'controle', 'Controle'],
    ['/camera', 'camera', 'Câmera'],
    ['/obs/palco', 'obs_palco', 'Palco (OBS)'],
    ['/obs/camera', 'obs_camera', 'Câmera (OBS)'],
    ['/', 'entrar', 'Entrar'],
    ['/xyz', 'nao_encontrada', 'Página não encontrada'],
    ['/obs', 'nao_encontrada', 'Página não encontrada'],
  ])('resolverRota(%s) → %s (%s)', (caminho, nome, titulo) => {
    const rota = resolverRota(caminho)
    expect(rota.nome).toBe(nome)
    expect(rota.titulo).toBe(titulo)
  })
})
