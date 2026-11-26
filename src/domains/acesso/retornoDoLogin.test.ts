import { describe, test, expect } from 'vitest'
import { PARAMETROS_DE_RETORNO, SEM_RETORNO, lerRetornoDoLogin } from './retornoDoLogin'

describe('retornoDoLogin', () => {
  test('PARAMETROS_DE_RETORNO e SEM_RETORNO', () => {
    expect(PARAMETROS_DE_RETORNO).toEqual(['code', 'sb_flow_id', 'error', 'error_code', 'error_description'])
    expect(SEM_RETORNO).toEqual({ erro: null, temCodigo: false, sujo: false, fragmentoSujo: false })
  })

  test('retorno-com-erro', () => {
    expect(
      lerRetornoDoLogin('?error=access_denied&error_code=x&error_description=Ligue+para+tal+n%C3%BAmero', ''),
    ).toEqual({ erro: 'cancelado', temCodigo: false, sujo: true, fragmentoSujo: false })
    expect(lerRetornoDoLogin('?error=server_error', '')).toEqual({
      erro: 'falha',
      temCodigo: false,
      sujo: true,
      fragmentoSujo: false,
    })
    expect(lerRetornoDoLogin('?error_description=x', '')).toEqual({
      erro: 'falha',
      temCodigo: false,
      sujo: true,
      fragmentoSujo: false,
    })
  })

  test('retorno-com-erro-no-fragmento', () => {
    expect(lerRetornoDoLogin('', '#error=access_denied&error_description=x')).toEqual({
      erro: 'cancelado',
      sujo: false,
      fragmentoSujo: true,
      temCodigo: false,
    })
    expect(lerRetornoDoLogin('', '#error_code=500')).toEqual({
      erro: 'falha',
      sujo: false,
      fragmentoSujo: true,
      temCodigo: false,
    })
    expect(lerRetornoDoLogin('', '#qualquer')).toEqual(SEM_RETORNO)
  })

  test('retorno-com-codigo', () => {
    expect(lerRetornoDoLogin('?code=abc', '')).toEqual({ erro: null, temCodigo: true, sujo: true, fragmentoSujo: false })
    expect(lerRetornoDoLogin('', '')).toEqual(SEM_RETORNO)
    expect(lerRetornoDoLogin('?aba=membros', '')).toEqual(SEM_RETORNO)
  })

  test('busca tem prioridade e temCodigo só olha a busca', () => {
    expect(lerRetornoDoLogin('?error=server_error', '#error=access_denied')).toEqual({
      erro: 'falha',
      temCodigo: false,
      sujo: true,
      fragmentoSujo: true,
    })
    expect(lerRetornoDoLogin('', '#code=abc')).toEqual({ erro: null, temCodigo: false, sujo: false, fragmentoSujo: true })
  })

  test('sb_flow_id sozinho suja a busca, sem erro nem código', () => {
    expect(lerRetornoDoLogin('?sb_flow_id=f1', '')).toEqual({ erro: null, temCodigo: false, sujo: true, fragmentoSujo: false })
  })
})
