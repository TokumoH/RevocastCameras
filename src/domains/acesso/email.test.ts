import { describe, test, expect } from 'vitest'
import { mesmoEmail, normalizarEmail } from './email'

describe('email', () => {
  test('normaliza-email', () => {
    expect(normalizarEmail('  Nova@Revocast.TEST ')).toEqual({ ok: true, email: 'nova@revocast.test' })
  })

  test('recusa vazio e formato inválido', () => {
    expect(normalizarEmail('   ')).toEqual({ ok: false, motivo: 'vazio' })
    expect(normalizarEmail('')).toEqual({ ok: false, motivo: 'vazio' })
    for (const t of [
      'sem-arroba',
      'a@b',
      'a b@revocast.test',
      'a@@revocast.test',
      '@revocast.test',
      'a@revocast.test.',
      'a@.revocast.test',
      'a@revocast..test',
      `${'a'.repeat(250)}@revocast.test`,
    ]) {
      expect(normalizarEmail(t), t).toEqual({ ok: false, motivo: 'formato' })
    }
  })

  test('aceita até 254 caracteres', () => {
    const local = 'a'.repeat(254 - '@revocast.test'.length)
    expect(normalizarEmail(`${local}@revocast.test`)).toEqual({ ok: true, email: `${local}@revocast.test` })
    expect(normalizarEmail(`${local}a@revocast.test`)).toEqual({ ok: false, motivo: 'formato' })
  })

  test('mesmoEmail ignora caixa e recusa null', () => {
    expect(mesmoEmail('Adm@Revocast.TEST', 'adm@revocast.test')).toBe(true)
    expect(mesmoEmail('ana@revocast.test', 'adm@revocast.test')).toBe(false)
    expect(mesmoEmail(null, 'adm@revocast.test')).toBe(false)
    expect(mesmoEmail('adm@revocast.test', null)).toBe(false)
    expect(mesmoEmail(null, null)).toBe(false)
  })
})
