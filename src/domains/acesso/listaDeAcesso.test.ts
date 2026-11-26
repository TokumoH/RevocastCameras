import { describe, test, expect } from 'vitest'
import { conferirInclusao, conferirMudanca, montarLista } from './listaDeAcesso'
import type { LinhaDaLista, MembroPermitido, PerfilDeMembro } from './listaDeAcesso'

const permitidos: MembroPermitido[] = [
  { email: 'bia@revocast.test', papel: 'apresentadora', criadoPor: 'id-adm' },
  { email: 'ana@revocast.test', papel: 'equipe', criadoPor: 'id-adm' },
  { email: 'adm@revocast.test', papel: 'admin', criadoPor: null },
]
const perfis: PerfilDeMembro[] = [
  { id: 'id-ana', email: 'ana@revocast.test', nome: 'Ana' },
  { id: 'id-adm', email: 'adm@revocast.test', nome: 'Adm' },
  { id: 'id-fora', email: 'fora@revocast.test', nome: 'Fora' },
]
const lista: LinhaDaLista[] = montarLista(permitidos, perfis)

describe('listaDeAcesso', () => {
  test('monta-lista', () => {
    expect(lista).toEqual([
      { email: 'adm@revocast.test', papel: 'admin', nome: 'Adm', jaEntrou: true },
      { email: 'ana@revocast.test', papel: 'equipe', nome: 'Ana', jaEntrou: true },
      { email: 'bia@revocast.test', papel: 'apresentadora', nome: null, jaEntrou: false },
    ])
  })

  test('monta-lista ordena por papel e depois por e-mail', () => {
    const l = montarLista(
      [
        { email: 'zeca@revocast.test', papel: 'equipe', criadoPor: null },
        { email: 'caio@revocast.test', papel: 'apresentadora', criadoPor: null },
        { email: 'beto@revocast.test', papel: 'equipe', criadoPor: null },
        { email: 'zara@revocast.test', papel: 'admin', criadoPor: null },
        { email: 'abel@revocast.test', papel: 'admin', criadoPor: null },
      ],
      [],
    )
    expect(l.map((x) => x.email)).toEqual([
      'abel@revocast.test',
      'zara@revocast.test',
      'beto@revocast.test',
      'zeca@revocast.test',
      'caio@revocast.test',
    ])
  })

  test('duplicado', () => {
    expect(conferirInclusao(lista, 'ana@revocast.test')).toBe('duplicado')
    expect(conferirInclusao(lista, 'nova@revocast.test')).toBeNull()
  })

  test('propria-linha', () => {
    expect(conferirMudanca(lista, 'adm@revocast.test', { tipo: 'remover' }, 'adm@revocast.test')).toBe('propria_linha')
    expect(
      conferirMudanca(lista, 'adm@revocast.test', { tipo: 'papel', papel: 'equipe' }, 'adm@revocast.test'),
    ).toBe('propria_linha')
  })

  test('propria-linha-com-maiusculas', () => {
    expect(conferirMudanca(lista, 'adm@revocast.test', { tipo: 'remover' }, 'Adm@Revocast.TEST')).toBe('propria_linha')
    expect(
      conferirMudanca(lista, 'adm@revocast.test', { tipo: 'papel', papel: 'equipe' }, 'Adm@Revocast.TEST'),
    ).toBe('propria_linha')
  })

  test('ultimo-admin', () => {
    // sessão fora da lista (lista antiga na tela): adm é o único admin
    expect(conferirMudanca(lista, 'adm@revocast.test', { tipo: 'remover' }, 'outra@revocast.test')).toBe('ultimo_admin')
    expect(
      conferirMudanca(lista, 'adm@revocast.test', { tipo: 'papel', papel: 'equipe' }, 'outra@revocast.test'),
    ).toBe('ultimo_admin')
    expect(conferirMudanca(lista, 'adm@revocast.test', { tipo: 'remover' }, null)).toBe('ultimo_admin')

    const comDois = montarLista(
      [...permitidos, { email: 'adm2@revocast.test', papel: 'admin', criadoPor: 'id-adm' }],
      perfis,
    )
    expect(
      conferirMudanca(comDois, 'adm2@revocast.test', { tipo: 'papel', papel: 'equipe' }, 'adm@revocast.test'),
    ).toBeNull()
    expect(conferirMudanca(comDois, 'adm2@revocast.test', { tipo: 'remover' }, 'adm@revocast.test')).toBeNull()
  })

  test('sem-mudanca e inexistente', () => {
    expect(
      conferirMudanca(lista, 'ana@revocast.test', { tipo: 'papel', papel: 'equipe' }, 'adm@revocast.test'),
    ).toBe('sem_mudanca')
    expect(
      conferirMudanca(lista, 'ana@revocast.test', { tipo: 'papel', papel: 'apresentadora' }, 'adm@revocast.test'),
    ).toBeNull()
    expect(conferirMudanca(lista, 'ana@revocast.test', { tipo: 'remover' }, 'adm@revocast.test')).toBeNull()
    expect(conferirMudanca(lista, 'nada@revocast.test', { tipo: 'remover' }, 'adm@revocast.test')).toBe('inexistente')
  })

  test('ordem de conferência: inexistente, propria_linha, sem_mudanca, ultimo_admin', () => {
    // inexistente antes de propria_linha: e-mail da sessão que não está na lista
    expect(conferirMudanca(lista, 'nada@revocast.test', { tipo: 'remover' }, 'nada@revocast.test')).toBe('inexistente')
    // propria_linha antes de sem_mudanca e de ultimo_admin
    expect(
      conferirMudanca(lista, 'adm@revocast.test', { tipo: 'papel', papel: 'admin' }, 'adm@revocast.test'),
    ).toBe('propria_linha')
    // sem_mudanca antes de ultimo_admin: último admin "trocado" para admin
    expect(
      conferirMudanca(lista, 'adm@revocast.test', { tipo: 'papel', papel: 'admin' }, 'outra@revocast.test'),
    ).toBe('sem_mudanca')
  })
})
