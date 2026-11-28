import { describe, test, expect } from 'vitest'
import { SHA256_DO_MODELO, SHA256_DO_WASM, conferirSha256 } from './integridadeDosGestos'

/**
 * Integridade dos arquivos dos gestos (PLA-006, Tarefa 5; VER-062). O tsconfig não carrega os tipos do Node: o `node:fs`
 * e o `node:crypto` vêm por import dinâmico tipado à mão (como em `obsWebsocket.test.ts`). O Vitest roda na raiz.
 */
type Bytes = Uint8Array & { buffer: ArrayBuffer; byteOffset: number; byteLength: number }
const { readFileSync } = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as {
  readFileSync(caminho: string): Bytes
}
const { createHash } = (await import(/* @vite-ignore */ ['node', 'crypto'].join(':'))) as {
  createHash(algoritmo: 'sha256'): { update(b: Uint8Array): { digest(f: 'hex'): string } }
}

const WASM = 'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.wasm'
const PASTA = 'src/shared/infra/modelos'
const MODELO = `${PASTA}/gesture_recognizer.task`
const TAMANHO_DO_MODELO = 8_373_440
/** SHA-256 do texto baixado de https://www.apache.org/licenses/LICENSE-2.0.txt em 2026-11-28 (VER-062). */
const SHA256_DA_LICENCA = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30'

const sha256Node = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
/** Cópia exata dos bytes num `ArrayBuffer` próprio (o `Buffer` do Node pode ser uma fatia de um buffer maior). */
const arrayBufferDe = (b: Uint8Array): ArrayBuffer => b.slice().buffer as ArrayBuffer
const texto = (s: string) => new TextEncoder().encode(s)

describe('integridade dos arquivos dos gestos (VER-062)', () => {
  test('integridade-do-wasm: o vision_wasm_module_internal.wasm instalado bate com SHA256_DO_WASM (F3)', async () => {
    const bytes = readFileSync(WASM)
    expect(SHA256_DO_WASM).toMatch(/^[0-9a-f]{64}$/)
    expect(sha256Node(bytes)).toBe(SHA256_DO_WASM)
    expect(await conferirSha256(arrayBufferDe(bytes), SHA256_DO_WASM)).toBe(true)
  })

  test('integridade-do-modelo: o gesture_recognizer.task versionado bate com SHA256_DO_MODELO e tem 8 373 440 bytes (F10)', async () => {
    const bytes = readFileSync(MODELO)
    expect(bytes.byteLength).toBe(TAMANHO_DO_MODELO)
    expect(SHA256_DO_MODELO).toMatch(/^[0-9a-f]{64}$/)
    expect(sha256Node(bytes)).toBe(SHA256_DO_MODELO)
    expect(await conferirSha256(arrayBufferDe(bytes), SHA256_DO_MODELO)).toBe(true)
  })

  test('conferir-sha256: igual → true; um byte trocado → false; esperado fora da forma → false; usa o digest recebido', async () => {
    // vetor do FIPS 180-2: SHA-256("abc")
    const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    expect(await conferirSha256(arrayBufferDe(texto('abc')), abc)).toBe(true)
    expect(await conferirSha256(arrayBufferDe(texto('abd')), abc)).toBe(false)
    const umByteTrocado = texto('abc')
    umByteTrocado[0] ^= 0x01
    expect(await conferirSha256(arrayBufferDe(umByteTrocado), abc)).toBe(false)
    // falha fechada: texto que não é um SHA-256 em hexadecimal minúsculo nunca confere
    expect(await conferirSha256(arrayBufferDe(texto('abc')), abc.toUpperCase())).toBe(false)
    expect(await conferirSha256(arrayBufferDe(texto('abc')), '')).toBe(false)
    expect(await conferirSha256(arrayBufferDe(texto('abc')), `${abc} `)).toBe(false)
    // o digest injetado é o usado (o worker e os testes podem trocá-lo)
    const recebidos: ArrayBuffer[] = []
    const digestFalso = async (b: ArrayBuffer) => {
      recebidos.push(b)
      return new Uint8Array(32).fill(0xab).buffer
    }
    const entrada = arrayBufferDe(texto('qualquer'))
    expect(await conferirSha256(entrada, 'ab'.repeat(32), digestFalso)).toBe(true)
    expect(await conferirSha256(entrada, 'ac'.repeat(32), digestFalso)).toBe(false)
    // difere só no último ou só no primeiro caractere (rodada 1, N4): a comparação é do texto inteiro
    expect(await conferirSha256(entrada, 'ab'.repeat(31) + 'ac', digestFalso)).toBe(false)
    expect(await conferirSha256(entrada, 'bb' + 'ab'.repeat(31), digestFalso)).toBe(false)
    expect(recebidos).toEqual([entrada, entrada, entrada, entrada])
    // digest de tamanho errado nunca confere, nem com o esperado vazio (sem a guarda da forma, '' === '' daria true)
    expect(await conferirSha256(entrada, 'ab'.repeat(32), async () => new Uint8Array(31).fill(0xab).buffer)).toBe(false)
    expect(await conferirSha256(entrada, '', async () => new ArrayBuffer(0))).toBe(false)
  })

  test('licenca-junto-dos-arquivos: LICENSE-APACHE-2.0.txt é o texto da Apache-2.0 e o NOTICE.txt cita o pacote, a versão e o modelo (N8)', () => {
    const licenca = readFileSync(`${PASTA}/LICENSE-APACHE-2.0.txt`)
    const textoDaLicenca = new TextDecoder().decode(licenca)
    expect(textoDaLicenca).toContain('Apache License')
    expect(textoDaLicenca).toContain('Version 2.0')
    expect(sha256Node(licenca)).toBe(SHA256_DA_LICENCA)
    const aviso = new TextDecoder().decode(readFileSync(`${PASTA}/NOTICE.txt`))
    expect(aviso).toContain('@mediapipe/tasks-vision')
    expect(aviso).toContain('1.2.3')
    expect(aviso).toContain('gesture_recognizer.task')
    expect(aviso).toContain('Google LLC')
    expect(aviso).toContain('Apache License, Version 2.0')
  })
})
