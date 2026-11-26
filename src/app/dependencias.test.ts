// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { SEM_RETORNO } from '../domains/acesso/retornoDoLogin'
import { caminhoDaArea, dependenciasDoNavegador, urlDeRetorno } from './dependencias'
import { obterServicosDeMembro, obterServicosDePreparacao } from './servicos'

function visibilidade(estado: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => estado })
  document.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => {
  window.history.replaceState(null, '', '/')
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('dependencias', () => {
  test('url-e-caminho-fixos', () => {
    expect(caminhoDaArea('painel')).toBe('/painel')
    expect(caminhoDaArea('controle')).toBe('/controle')
    expect(urlDeRetorno('https://app.revocast.test', null)).toBe('https://app.revocast.test/entrar')
    expect(urlDeRetorno('https://app.revocast.test', 'controle')).toBe('https://app.revocast.test/controle')
  })

  test('navegador-le-a-url-e-e-preguicoso', () => {
    window.history.replaceState(null, '', '/painel?code=abc#x=1')
    const dep = dependenciasDoNavegador()
    expect(dep.origem).toBe(window.location.origin)
    expect(dep.busca).toBe('?code=abc')
    expect(dep.fragmento).toBe('#x=1')
    expect(dep.obterServicos).toBe(obterServicosDeMembro)
    expect(dep.obterPreparacao).toBe(obterServicosDePreparacao)
  })

  test('limpar-tira-so-os-parametros-de-retorno', () => {
    window.history.replaceState({ marca: 1 }, '', '/painel?code=abc&sb_flow_id=f&error=e&error_code=c&error_description=d&fica=1#ancora')
    dependenciasDoNavegador().limparRetornoDaUrl({ ...SEM_RETORNO, temCodigo: true, sujo: true })
    expect(window.location.pathname).toBe('/painel')
    expect(window.location.search).toBe('?fica=1')
    expect(window.location.hash).toBe('#ancora') // sem fragmentoSujo, o fragmento fica
    expect(window.history.state).toEqual({ marca: 1 })
  })

  test('limpar-apaga-o-fragmento-so-se-sujo', () => {
    window.history.replaceState(null, '', '/entrar#error=access_denied&error_description=x')
    dependenciasDoNavegador().limparRetornoDaUrl({ ...SEM_RETORNO, erro: 'cancelado', fragmentoSujo: true })
    expect(window.location.hash).toBe('')
    expect(window.location.pathname + window.location.search).toBe('/entrar')
  })

  test('volta-a-ver-so-quando-visivel-e-cancela', () => {
    const ouvinte = vi.fn()
    const cancelar = dependenciasDoNavegador().aoVoltarAVer(ouvinte)
    visibilidade('hidden')
    expect(ouvinte).toHaveBeenCalledTimes(0)
    visibilidade('visible')
    expect(ouvinte).toHaveBeenCalledTimes(1)
    cancelar()
    visibilidade('visible')
    expect(ouvinte).toHaveBeenCalledTimes(1)
  })
})
