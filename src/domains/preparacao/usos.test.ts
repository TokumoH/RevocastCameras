import { describe, test, expect } from 'vitest'
import type { LinhaDoMapa } from './gestos'
import type { Midia, Som } from './midia'
import { usosDaCena, usosDaMidia } from './usos'

function midia(id: string, tipo: Midia['tipo']): Midia {
  const ext = tipo === 'som' ? 'mp3' : 'png'
  return { id, tipo, nome: `${id}.${ext}`, caminho: `${tipo}/${id}.${ext}`, mime: tipo === 'som' ? 'audio/mpeg' : 'image/png', tamanhoBytes: 10, enviadoPor: null }
}

const SONS: Som[] = [
  { id: 's-aplauso', midiaId: 'm-aplauso', rotulo: 'aplauso', emoji: '👏', volume: 1, ordem: 0 },
  { id: 's-sino', midiaId: 'm-sino', rotulo: 'sino', emoji: null, volume: 0.5, ordem: 1 },
]

const MAPA: LinhaDoMapa[] = [
  { gesto: 'Thumb_Up', acao: 'som', cenaId: null, somId: 's-aplauso' },
  { gesto: 'Thumb_Down', acao: 'nenhuma', cenaId: null, somId: null },
  { gesto: 'Victory', acao: 'cena', cenaId: 'c1', somId: null },
  { gesto: 'Open_Palm', acao: 'cena', cenaId: 'c1', somId: null },
  { gesto: 'ILoveYou', acao: 'clipe', cenaId: null, somId: null },
]

describe('usos', () => {
  test('usos-da-midia', () => {
    expect(usosDaMidia(midia('m-aplauso', 'som'), { sons: SONS, mapa: MAPA, avisosComImagem: 0 })).toEqual({
      gestos: ['Thumb_Up'],
      avisos: 0,
      bloqueia: true,
    })
    expect(usosDaMidia(midia('m-foto', 'imagem'), { sons: SONS, mapa: MAPA, avisosComImagem: 3 })).toEqual({
      gestos: [],
      avisos: 3,
      bloqueia: false,
    })
    expect(usosDaMidia(midia('m-sino', 'som'), { sons: SONS, mapa: MAPA, avisosComImagem: 0 })).toEqual({
      gestos: [],
      avisos: 0,
      bloqueia: false,
    })
    // som sem linha em `sons` (registro incompleto) também não bloqueia
    expect(usosDaMidia(midia('m-solto', 'som'), { sons: SONS, mapa: MAPA, avisosComImagem: 0 }).bloqueia).toBe(false)
  })

  test('usos-da-cena', () => {
    expect(usosDaCena('c1', MAPA)).toEqual(['Victory', 'Open_Palm'])
    expect(usosDaCena('c2', MAPA)).toEqual([])
  })
})
