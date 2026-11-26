import { describe, expect, test } from 'vitest'
import { ErroDePreparacao } from '../../domains/preparacao/portas'
import { classificarErro, exigirLinhas, type MotivoComum } from './errosSupabase'

type Erro = { code?: string; message?: string; name?: string } | null

describe('classificarErro', () => {
  test('traduz-erros-da-preparacao', () => {
    const casos: [Erro, number | undefined, MotivoComum][] = [
      // (1) sessão expirada antes de tudo, inclusive do 42501 que o PostgREST manda com 401
      [{ code: '42501', message: 'permission denied' }, 401, 'sessao_expirada'],
      [{ code: '23503' }, 401, 'sessao_expirada'],
      [{ code: 'PGRST301' }, undefined, 'sessao_expirada'],
      [{ code: 'PGRST303' }, 403, 'sessao_expirada'],
      [null, 401, 'sessao_expirada'],
      // (2) duplicado, inclusive o índice de "no máximo um ao vivo"
      [{ code: '23505', message: 'duplicate key value violates unique constraint "episodios_um_ao_vivo"' }, 409, 'duplicado'],
      [{ code: '23505', message: 'duplicate key value violates unique constraint "cenas_nome_obs_key"' }, 409, 'duplicado'],
      // (3) em uso (chave estrangeira sem ação de delete: som ou cena num gesto)
      [{ code: '23503' }, 409, 'em_uso'],
      // (4) inválido: CHECK e texto inválido para o tipo (uuid malformado)
      [{ code: '23514' }, 400, 'invalido'],
      [{ code: '22P02' }, 400, 'invalido'],
      // (5) negado
      [{ code: '42501' }, 403, 'negado'],
      [{ code: '42501' }, undefined, 'negado'],
      // (6) falha do fetch no postgrest-js: code '' (ou ausente) e status 0
      [{ code: '', message: 'TypeError: Failed to fetch' }, 0, 'rede'],
      [{ message: 'TimeoutError: signal timed out' }, 0, 'rede'],
      [null, 0, 'rede'],
      // (7) o resto
      [{ code: 'XX000' }, 0, 'outro'],
      [{ code: '', message: 'x' }, 500, 'outro'],
      [{ code: 'PGRST116' }, 406, 'outro'],
      [{ name: 'AuthRetryableFetchError' }, undefined, 'outro'],
      [{}, undefined, 'outro'],
      [null, undefined, 'outro'],
    ]
    for (const [erro, status, motivo] of casos) {
      expect(classificarErro(erro, status), JSON.stringify([erro, status])).toBe(motivo)
    }
  })
})

describe('exigirLinhas', () => {
  test('vazio ou nulo → nada_alterado; com linhas, nada acontece', () => {
    for (const data of [[], null]) {
      let erro: unknown
      try {
        exigirLinhas(data)
      } catch (e) {
        erro = e
      }
      expect(erro).toBeInstanceOf(ErroDePreparacao)
      expect((erro as ErroDePreparacao).motivo).toBe('nada_alterado')
    }
    expect(() => exigirLinhas([{ id: 'a' }])).not.toThrow()
  })
})
