import { describe, test, expect } from 'vitest'
import { PAPEIS, ROTULO_DO_PAPEL, areaInicial, ehPapel, podeAbrir, podeGerenciarMembros } from './papeis'

describe('papeis', () => {
  test.each([
    ['painel', 'admin', true],
    ['painel', 'equipe', true],
    ['painel', 'apresentadora', false],
    ['controle', 'admin', true],
    ['controle', 'equipe', true],
    ['controle', 'apresentadora', true],
  ] as const)('podeAbrir(%s, %s) → %s', (area, papel, esperado) => {
    expect(podeAbrir(area, papel)).toBe(esperado)
  })

  test('areaInicial e quem gerencia membros', () => {
    expect(areaInicial('apresentadora')).toBe('controle')
    expect(areaInicial('equipe')).toBe('painel')
    expect(areaInicial('admin')).toBe('painel')
    expect(PAPEIS.filter(podeGerenciarMembros)).toEqual(['admin'])
  })

  test('ehPapel só aceita os três valores exatos', () => {
    for (const v of ['admin', 'equipe', 'apresentadora']) expect(ehPapel(v)).toBe(true)
    for (const v of ['ADMIN', 'Admin', ' admin', 'toString', 'constructor', '', null, undefined, 1, {}]) {
      expect(ehPapel(v)).toBe(false)
    }
  })

  test('rótulos dos papéis', () => {
    expect(ROTULO_DO_PAPEL).toEqual({ admin: 'Admin', equipe: 'Equipe', apresentadora: 'Apresentadora' })
  })
})
