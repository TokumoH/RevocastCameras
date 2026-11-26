import { describe, test, expect } from 'vitest'
import { ACOES, GESTOS, conferirGesto, normalizarGesto, sugestoesDeSom, type LinhaDoMapa } from './gestos'
import type { Som } from './midia'

const CENAS = [{ id: 'c1' }]
const SONS = [{ id: 's1' }]

function som(id: string, rotulo: string): Som {
  return { id, midiaId: `m-${id}`, rotulo, emoji: null, volume: 1, ordem: 0 }
}

function linha(gesto: LinhaDoMapa['gesto'], acao: LinhaDoMapa['acao'], cenaId: string | null = null, somId: string | null = null): LinhaDoMapa {
  return { gesto, acao, cenaId, somId }
}

describe('gestos', () => {
  test('gesto-som-sem-som', () => {
    expect(conferirGesto(linha('Thumb_Up', 'som'), CENAS, SONS)).toBe('falta_som')
    expect(conferirGesto(linha('Victory', 'cena'), CENAS, SONS)).toBe('falta_cena')
    expect(conferirGesto(linha('Thumb_Up', 'som', null, 's-apagado'), CENAS, SONS)).toBe('alvo_inexistente')
    expect(conferirGesto(linha('Victory', 'cena', 'c-apagada'), CENAS, SONS)).toBe('alvo_inexistente')
    expect(conferirGesto(linha('Thumb_Up', 'som', null, 's1'), CENAS, SONS)).toBeNull()
    expect(conferirGesto(linha('Victory', 'cena', 'c1'), CENAS, SONS)).toBeNull()
    expect(conferirGesto(linha('ILoveYou', 'clipe'), CENAS, SONS)).toBeNull()
  })

  test('gesto-zera-alvo', () => {
    expect(normalizarGesto(linha('ILoveYou', 'clipe', 'c', 's'))).toEqual(linha('ILoveYou', 'clipe', null, null))
    expect(normalizarGesto(linha('Victory', 'cena', 'c1', 's'))).toEqual(linha('Victory', 'cena', 'c1', null))
    expect(normalizarGesto(linha('Thumb_Up', 'som', 'c', 's1'))).toEqual(linha('Thumb_Up', 'som', null, 's1'))
    // a conferência só olha o alvo da ação: o alvo que não corresponde (e que `normalizarGesto` zera) não conta
    expect(conferirGesto(linha('ILoveYou', 'clipe', 'c-apagada', 's-apagado'), CENAS, SONS)).toBeNull()
    expect(conferirGesto(linha('Victory', 'cena', 'c1', 's-apagado'), CENAS, SONS)).toBeNull()
  })

  test('sete-gestos', () => {
    const doBanco = ['Closed_Fist', 'Open_Palm', 'Pointing_Up', 'Thumb_Down', 'Thumb_Up', 'Victory', 'ILoveYou']
    expect(GESTOS.map((g) => g.gesto)).toEqual(['ILoveYou', 'Closed_Fist', 'Victory', 'Thumb_Up', 'Thumb_Down', 'Pointing_Up', 'Open_Palm'])
    expect([...GESTOS.map((g) => g.gesto)].sort()).toEqual([...doBanco].sort())
    expect(new Set(GESTOS.map((g) => g.gesto)).size).toBe(7)
    expect(GESTOS.map((g) => g.emoji)).toEqual(['🤟', '✊', '✌️', '👍', '👎', '☝️', '✋'])
    expect(GESTOS.every((g) => g.rotulo.trim() !== '')).toBe(true)
    expect(ACOES.map((a) => a.acao)).toEqual(['clipe', 'marcador', 'cena', 'som', 'proximo_aviso', 'ocultar_aviso', 'proxima_cena', 'nenhuma'])
    expect(ACOES.every((a) => a.rotulo.trim() !== '')).toBe(true)
  })

  test('sugestao-de-som', () => {
    const aplauso = som('s1', 'Aplauso')
    const buuu = som('s2', 'BUUU')
    const mapaInicial = [linha('Thumb_Up', 'nenhuma'), linha('Thumb_Down', 'nenhuma'), linha('ILoveYou', 'clipe')]
    expect(sugestoesDeSom(mapaInicial, [aplauso, buuu])).toEqual([
      { gesto: 'Thumb_Up', som: aplauso },
      { gesto: 'Thumb_Down', som: buuu },
    ])
    const comJoinhaLigado = [linha('Thumb_Up', 'som', null, 's1'), linha('Thumb_Down', 'nenhuma')]
    expect(sugestoesDeSom(comJoinhaLigado, [aplauso, buuu])).toEqual([{ gesto: 'Thumb_Down', som: buuu }])
    // gesto com outra ação (não `nenhuma`) não recebe sugestão
    expect(sugestoesDeSom([linha('Thumb_Up', 'clipe')], [aplauso])).toEqual([])
    expect(sugestoesDeSom(mapaInicial, [som('s3', 'aplausos')])).toEqual([])
    const comAcento = som('s4', ' Áplauso ')
    expect(sugestoesDeSom(mapaInicial, [comAcento])).toEqual([{ gesto: 'Thumb_Up', som: comAcento }])
    expect(sugestoesDeSom(mapaInicial, [])).toEqual([])
  })
})
