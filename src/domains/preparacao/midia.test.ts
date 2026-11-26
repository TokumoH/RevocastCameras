import { describe, test, expect } from 'vitest'
import {
  BYTES_PARA_DETECTAR,
  LIMITE_POR_ARQUIVO_BYTES,
  LIMITE_TOTAL_BYTES,
  TIPOS_ACEITOS,
  caminhoDaMidia,
  conferirArquivo,
  conferirSom,
  detectarTipo,
  nomeDeExibicao,
  usoDaBiblioteca,
  type Midia,
  type TipoAceito,
} from './midia'

/** Bytes montados no próprio teste (nenhum arquivo binário versionado). */
const bytes = (...b: number[]) => Uint8Array.from(b)
const ascii = (texto: string) => Array.from(texto, (c) => c.charCodeAt(0))
/** Início com a assinatura e enchimento até 16 bytes, como o `Blob.slice(0, 16)` da tela. */
const inicio = (...b: number[]) => Uint8Array.from([...b, ...new Array(Math.max(0, 16 - b.length)).fill(0)])

function tipo(extensao: string): TipoAceito {
  const achado = TIPOS_ACEITOS.find((t) => t.extensao === extensao)
  if (!achado) throw new Error(`tipo ${extensao} não está nos aceitos`)
  return achado
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const UUID = '0b6e2b8a-3c1d-4f2a-9e5b-1a2b3c4d5e6f'

function midia(id: string, tamanhoBytes: number): Midia {
  return { id, tipo: 'som', nome: `${id}.mp3`, caminho: `som/${id}.mp3`, mime: 'audio/mpeg', tamanhoBytes, enviadoPor: null }
}

describe('midia', () => {
  test('constantes: os 8 tipos da D4 na ordem, 50 MB do CHECK do banco e 1 GB da D7', () => {
    expect(TIPOS_ACEITOS.map((t) => [t.tipo, t.mime, t.extensao])).toEqual([
      ['som', 'audio/mpeg', 'mp3'],
      ['som', 'audio/wav', 'wav'],
      ['som', 'audio/ogg', 'ogg'],
      ['som', 'audio/mp4', 'm4a'],
      ['imagem', 'image/png', 'png'],
      ['imagem', 'image/jpeg', 'jpg'],
      ['imagem', 'image/webp', 'webp'],
      ['imagem', 'image/gif', 'gif'],
    ])
    expect(Object.isFrozen(TIPOS_ACEITOS)).toBe(true)
    expect(TIPOS_ACEITOS.every((t) => Object.isFrozen(t))).toBe(true)
    expect(LIMITE_POR_ARQUIVO_BYTES).toBe(52_428_800)
    expect(LIMITE_TOTAL_BYTES).toBe(1_000_000_000)
    expect(BYTES_PARA_DETECTAR).toBe(16)
  })

  test.each([
    ['ID3 v2.4 (mp3)', bytes(0x49, 0x44, 0x33, 0x04, 0x00), 'mp3'],
    ['ID3 v2.3 (mp3)', bytes(0x49, 0x44, 0x33, 0x03, 0x00), 'mp3'],
    ['texto que começa por "ID3" (não é mp3)', bytes(...ascii('ID3<html><script>')), null],
    ['ID3 só com 3 bytes', bytes(0x49, 0x44, 0x33), null],
    ['FF FB (mp3, quadro MPEG-1 camada III)', bytes(0xff, 0xfb), 'mp3'],
    ['FF F3 (mp3, MPEG-2 camada III)', bytes(0xff, 0xf3, 0x90), 'mp3'],
    ['FF E3 (mp3, MPEG-2.5 camada III)', bytes(0xff, 0xe3, 0x90), 'mp3'],
    ['RIFF....WAVE', bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVE')), 'wav'],
    ['OggS', bytes(...ascii('OggS'), 0), 'ogg'],
    ['....ftypM4A ', bytes(0, 0, 0, 0x20, ...ascii('ftypM4A ')), 'm4a'],
    ['PNG', bytes(...PNG), 'png'],
    ['FF D8 FF (jpg)', bytes(0xff, 0xd8, 0xff, 0xe0), 'jpg'],
    ['GIF89a', bytes(...ascii('GIF89a')), 'gif'],
    ['GIF87a', bytes(...ascii('GIF87a')), 'gif'],
    ['RIFF....WEBP', bytes(...ascii('RIFF'), 9, 9, 9, 9, ...ascii('WEBP')), 'webp'],
    ['RIFF....AVI ', bytes(...ascii('RIFF'), 9, 9, 9, 9, ...ascii('AVI ')), null],
    ['....ftypisom (vídeo MP4)', bytes(0, 0, 0, 0x20, ...ascii('ftypisom')), null],
    ['FF D8 sem o terceiro byte', bytes(0xff, 0xd8), null],
    ['3 bytes de PNG', bytes(0x89, 0x50, 0x4e), null],
    ['FF FE 3C 00 (texto UTF-16 com "<", não é quadro de mp3)', bytes(0xff, 0xfe, 0x3c, 0x00), null],
    ['FF FD (MPEG-1 camada II, não é mp3)', bytes(0xff, 0xfd, 0x90), null],
    ['vazio', bytes(), null],
  ])('tipo-pelos-bytes: %s', (_nome, inicioDoArquivo, extensao) => {
    const detectado = detectarTipo(inicioDoArquivo)
    if (extensao === null) expect(detectado).toBeNull()
    else expect(detectado).toBe(tipo(extensao))
  })

  test('mp3-que-e-png: o nome nunca decide, só os bytes', () => {
    const arquivo = { nome: 'foto.mp3', tamanho: 10, inicio: inicio(...PNG) }
    expect(conferirArquivo(arquivo, 0)).toEqual({ ok: true, tipo: tipo('png') })
  })

  test('svg-e-html-recusados', () => {
    for (const texto of ['<svg xmlns="http://www.w3.org/2000/svg">', '<?xml version="1.0"?>', '<!DOCTYPE html>', '%PDF-1.7']) {
      const b = inicio(...ascii(texto).slice(0, 16))
      expect(detectarTipo(b), texto).toBeNull()
      expect(conferirArquivo({ tamanho: 100, inicio: b }, 0), texto).toEqual({ ok: false, motivo: 'tipo_recusado' })
    }
  })

  test('limite-50mb (e a ordem vazio, grande_demais, tipo_recusado, sem_espaco)', () => {
    const png = inicio(...PNG)
    expect(conferirArquivo({ tamanho: 52_428_800, inicio: png }, 0)).toEqual({ ok: true, tipo: tipo('png') })
    expect(conferirArquivo({ tamanho: 52_428_801, inicio: png }, 0)).toEqual({ ok: false, motivo: 'grande_demais' })
    expect(conferirArquivo({ tamanho: 0, inicio: png }, 0)).toEqual({ ok: false, motivo: 'vazio' })
    const html = inicio(...ascii('<!DOCTYPE html>'))
    // ordem: vazio antes de tipo; grande_demais antes de tipo; tipo antes de sem_espaco
    expect(conferirArquivo({ tamanho: 0, inicio: html }, LIMITE_TOTAL_BYTES)).toEqual({ ok: false, motivo: 'vazio' })
    expect(conferirArquivo({ tamanho: 52_428_801, inicio: html }, LIMITE_TOTAL_BYTES)).toEqual({ ok: false, motivo: 'grande_demais' })
    expect(conferirArquivo({ tamanho: 10, inicio: html }, LIMITE_TOTAL_BYTES)).toEqual({ ok: false, motivo: 'tipo_recusado' })
    // tamanho que não é número finito positivo nunca passa
    expect(conferirArquivo({ tamanho: Number.NaN, inicio: png }, 0)).toEqual({ ok: false, motivo: 'vazio' })
    expect(conferirArquivo({ tamanho: Number.POSITIVE_INFINITY, inicio: png }, 0)).toEqual({ ok: false, motivo: 'grande_demais' })
  })

  test('sem-espaco', () => {
    const png = inicio(...PNG)
    expect(conferirArquivo({ tamanho: 1_001, inicio: png }, 999_999_000)).toEqual({ ok: false, motivo: 'sem_espaco' })
    expect(conferirArquivo({ tamanho: 1_000, inicio: png }, 999_999_000)).toEqual({ ok: true, tipo: tipo('png') })
    expect(conferirArquivo({ tamanho: 1, inicio: png }, Number.NaN)).toEqual({ ok: false, motivo: 'sem_espaco' })
  })

  test('caminho-sem-nome-do-arquivo', () => {
    expect(caminhoDaMidia(tipo('png'), UUID)).toBe(`imagem/${UUID}.png`)
    expect(caminhoDaMidia(tipo('mp3'), UUID)).toBe(`som/${UUID}.mp3`)
    for (const id of [UUID.toUpperCase(), `../${UUID}`, `${UUID}/x`, `${UUID.slice(0, -2)}..`, '', `${UUID}\n`, 'aplauso']) {
      expect(() => caminhoDaMidia(tipo('png'), id), JSON.stringify(id)).toThrow(Error)
    }
  })

  test('nome-de-exibicao', () => {
    expect(nomeDeExibicao('../../etc/aplauso.mp3')).toBe('aplauso.mp3')
    expect(nomeDeExibicao('C:\\Pasta\\foto.png')).toBe('foto.png')
    expect(nomeDeExibicao('  \u0000x\u0007.mp3 ')).toBe('x.mp3')
    expect(nomeDeExibicao('a'.repeat(300))).toBe('a'.repeat(120))
    expect(nomeDeExibicao('/')).toBe('sem nome')
    expect(nomeDeExibicao('')).toBe('sem nome')
    expect(nomeDeExibicao(' \u0007 ')).toBe('sem nome')
    // controles de direção do texto (troca visual da extensão) também saem
    expect(nomeDeExibicao('foto\u202Egnp.mp3')).toBe('fotognp.mp3')
    // o corte em 120 não parte um emoji ao meio
    expect(Array.from(nomeDeExibicao('👍'.repeat(130)))).toHaveLength(120)
  })

  test('uso-da-biblioteca', () => {
    expect(usoDaBiblioteca([midia('a', 400_000_000), midia('b', 400_000_001)])).toEqual({
      bytes: 800_000_001,
      fracao: 0.800000001,
      alerta: true,
    })
    expect(usoDaBiblioteca([midia('a', 800_000_000)]).alerta).toBe(true)
    expect(usoDaBiblioteca([midia('a', 799_999_999)]).alerta).toBe(false)
    expect(usoDaBiblioteca([midia('a', 1)])).toEqual({ bytes: 1, fracao: 1e-9, alerta: false })
    expect(usoDaBiblioteca([])).toEqual({ bytes: 0, fracao: 0, alerta: false })
  })

  test('conferir-som', () => {
    expect(conferirSom({ rotulo: '   ', volume: 0.5 })).toBe('rotulo_vazio')
    for (const volume of [-0.01, 1.01, Number.NaN]) expect(conferirSom({ rotulo: 'aplauso', volume }), String(volume)).toBe('volume_invalido')
    expect(conferirSom({ rotulo: 'aplauso', volume: 0 })).toBeNull()
    expect(conferirSom({ rotulo: 'aplauso', volume: 1 })).toBeNull()
  })
})
