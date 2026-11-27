import { describe, test, expect } from 'vitest'
import { VERSAO_MINIMA_DO_OBS, versaoAtende } from './versao'

describe('versão mínima do OBS (D13; CreateRecordChapter exige o OBS 30.2)', () => {
  test('versao-minima', () => {
    expect(VERSAO_MINIMA_DO_OBS).toBe('30.2.0')
    expect(versaoAtende('30.2.0')).toBe(true)
    expect(versaoAtende('30.2')).toBe(true)
    expect(versaoAtende('31.0.1')).toBe(true)
    expect(versaoAtende('30.10.0')).toBe(true)
    expect(versaoAtende('100.0.0')).toBe(true)
    expect(versaoAtende('30.1.2')).toBe(false)
    expect(versaoAtende('29.9.9')).toBe(false)
    expect(versaoAtende('30.1')).toBe(false)
    expect(versaoAtende('31.0.0-beta1')).toBe(true)
    expect(versaoAtende('30.2.0-rc1')).toBe(true)
    expect(versaoAtende('30.1.9-rc1')).toBe(false)
    expect(versaoAtende(null)).toBeNull()
    expect(versaoAtende('x')).toBeNull()
    expect(versaoAtende('')).toBeNull()
    expect(versaoAtende('30')).toBeNull()
    expect(versaoAtende('30.2.0.1')).toBeNull()
    expect(versaoAtende(' 30.2.0')).toBeNull()
    expect(versaoAtende('30.2.0 ')).toBeNull()
    expect(versaoAtende(`30.2.0-${'a'.repeat(40)}`)).toBeNull()
  })
})
