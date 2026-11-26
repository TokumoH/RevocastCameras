import { describe, test, expect } from 'vitest'
import { conferirCena, type Cena } from './cenas'

const CENAS: Cena[] = [
  { id: 'c1', nomeExibicao: 'Geral', nomeObs: 'Geral', ordem: 0 },
  { id: 'c2', nomeExibicao: 'Close', nomeObs: 'Câmera 2', ordem: 1 },
]

describe('cenas', () => {
  test('nome-obs-exato', () => {
    // o OBS diferencia caixa e espaços; o banco tem unique exato
    expect(conferirCena({ nomeExibicao: 'Geral minúsculo', nomeObs: 'geral' }, CENAS, null)).toBeNull()
    expect(conferirCena({ nomeExibicao: 'Geral com espaço', nomeObs: 'Geral ' }, CENAS, null)).toBeNull()
    expect(conferirCena({ nomeExibicao: 'Outra', nomeObs: 'Geral' }, CENAS, null)).toBe('nome_obs_duplicado')
    // editar a própria cena sem mudar o nome no OBS
    expect(conferirCena({ nomeExibicao: 'Geral (novo rótulo)', nomeObs: 'Geral' }, CENAS, 'c1')).toBeNull()
    // editar outra cena para um nome que já existe
    expect(conferirCena({ nomeExibicao: 'Close', nomeObs: 'Geral' }, CENAS, 'c2')).toBe('nome_obs_duplicado')
  })

  test('nomes-vazios', () => {
    expect(conferirCena({ nomeExibicao: '   ', nomeObs: 'Nova' }, CENAS, null)).toBe('nome_vazio')
    expect(conferirCena({ nomeExibicao: 'Nova', nomeObs: '' }, CENAS, null)).toBe('nome_obs_vazio')
    expect(conferirCena({ nomeExibicao: 'Nova', nomeObs: '  \t ' }, CENAS, null)).toBe('nome_obs_vazio')
    expect(conferirCena({ nomeExibicao: '', nomeObs: '' }, CENAS, null)).toBe('nome_vazio')
  })
})
