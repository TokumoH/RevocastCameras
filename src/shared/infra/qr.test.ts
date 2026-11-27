import { describe, test, expect } from 'vitest'
import { matrizDoQr, TAMANHO_MAXIMO_DO_TEXTO_DO_QR } from './qr'

/** Padrão de posição (7×7) com o canto em (x0, y0): borda escura, anel claro, miolo 3×3 escuro. */
function temPadraoDePosicao(m: boolean[][], x0: number, y0: number): boolean {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const borda = x === 0 || x === 6 || y === 0 || y === 6
      const miolo = x >= 2 && x <= 4 && y >= 2 && y <= 4
      if (m[y0 + y][x0 + x] !== (borda || miolo)) return false
    }
  }
  return true
}

describe('QR (D11)', () => {
  test('qr-matriz', () => {
    // link de pareamento de 80 caracteres: origem + caminho + `#` + código de 43
    const link = 'https://app.revocast.test/obs/camera#' + 'A'.repeat(43)
    expect(link).toHaveLength(80)
    const m = matrizDoQr(link)
    expect(m.length).toBeGreaterThanOrEqual(25)
    expect(m.length).toBeLessThanOrEqual(177)
    expect((m.length - 17) % 4).toBe(0) // versões 1 a 40: 21 + 4(v-1) módulos
    for (const linha of m) {
      expect(linha).toHaveLength(m.length)
      for (const modulo of linha) expect(typeof modulo).toBe('boolean')
    }
    const n = m.length
    expect(temPadraoDePosicao(m, 0, 0)).toBe(true)
    expect(temPadraoDePosicao(m, n - 7, 0)).toBe(true)
    expect(temPadraoDePosicao(m, 0, n - 7)).toBe(true)
    // o quarto canto não tem padrão de posição
    expect(temPadraoDePosicao(m, n - 7, n - 7)).toBe(false)
    // o mesmo texto dá a mesma matriz; outro texto, outra
    expect(matrizDoQr(link)).toEqual(m)
    expect(matrizDoQr(link.replace('AAAA', 'BBBB'))).not.toEqual(m)

    expect(TAMANHO_MAXIMO_DO_TEXTO_DO_QR).toBe(300)
    expect(() => matrizDoQr('x'.repeat(300))).not.toThrow()
    expect(() => matrizDoQr('x'.repeat(301))).toThrow()
  })

  test('qr-erro-sem-o-texto', () => {
    // a mensagem do erro nunca repete o texto (o link leva o código de pareamento)
    const texto = 'https://app.revocast.test/camera#' + 'S'.repeat(268)
    let mensagem = ''
    try {
      matrizDoQr(texto)
    } catch (e) {
      mensagem = (e as Error).message
    }
    expect(mensagem).not.toBe('')
    expect(mensagem).not.toContain('SSSS')
    expect(() => matrizDoQr('')).toThrow()
  })
})
