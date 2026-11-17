import { describe, expect, test } from 'vitest'
import { ErroDeConfiguracao, lerConfiguracao } from './configuracao'

const ok = { VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }

describe('lerConfiguracao', () => {
  test('lê as variáveis obrigatórias', () => {
    expect(lerConfiguracao(ok)).toEqual({ supabaseUrl: 'https://abc.supabase.co', supabaseChavePublica: 'sb_publishable_x' })
  })

  test('nomeia a variável que falta', () => {
    const ler = () => lerConfiguracao({ VITE_SUPABASE_URL: 'https://abc.supabase.co' })
    expect(ler).toThrow(ErroDeConfiguracao)
    expect(ler).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/)
    expect(() => lerConfiguracao({ VITE_SUPABASE_PUBLISHABLE_KEY: 'k' })).toThrow(/VITE_SUPABASE_URL/)
  })

  test('variável vazia ou só com espaços conta como ausente', () => {
    expect(() => lerConfiguracao({ ...ok, VITE_SUPABASE_PUBLISHABLE_KEY: '' })).toThrow(/ausente ou vazia: VITE_SUPABASE_PUBLISHABLE_KEY/)
    expect(() => lerConfiguracao({ ...ok, VITE_SUPABASE_PUBLISHABLE_KEY: '   ' })).toThrow(/ausente ou vazia: VITE_SUPABASE_PUBLISHABLE_KEY/)
    expect(() => lerConfiguracao({ ...ok, VITE_SUPABASE_URL: '' })).toThrow(/ausente ou vazia: VITE_SUPABASE_URL/)
    expect(() => lerConfiguracao({ ...ok, VITE_SUPABASE_URL: '   ' })).toThrow(/ausente ou vazia: VITE_SUPABASE_URL/)
  })

  test('remove espaços nas pontas dos valores', () => {
    expect(lerConfiguracao({ VITE_SUPABASE_URL: ' https://abc.supabase.co ', VITE_SUPABASE_PUBLISHABLE_KEY: ' sb_publishable_x ' }))
      .toEqual({ supabaseUrl: 'https://abc.supabase.co', supabaseChavePublica: 'sb_publishable_x' })
  })

  test('recusa URL sem https, inclusive formas malformadas', () => {
    for (const url of ['http://abc.supabase.co', 'ftp://abc.supabase.co', 'abc.supabase.co', 'httpsx://abc.supabase.co', 'xhttps://abc.supabase.co/', 'wss://abc.supabase.co', 'http://127.0.0.1:54321', 'http://localhost:54321', 'https:abc.supabase.co', 'https:/abc.supabase.co']) {
      const ler = () => lerConfiguracao({ ...ok, VITE_SUPABASE_URL: url })
      expect(ler, url).toThrow(ErroDeConfiguracao)
      expect(ler, url).toThrow(/VITE_SUPABASE_URL deve começar com https:\/\//)
    }
  })

  test('aceita a origem do projeto e devolve url.origin (minúsculas, sem barra final)', () => {
    const casos: Record<string, string> = {
      'https://abc.supabase.co': 'https://abc.supabase.co',
      'https://abc.supabase.co/': 'https://abc.supabase.co',
      'HTTPS://abc.supabase.co': 'https://abc.supabase.co',
      'HTTPS://ABC.supabase.co/': 'https://abc.supabase.co',
      'https://meu-dominio.com.br': 'https://meu-dominio.com.br',
      'https://abc.supabase.co:8443': 'https://abc.supabase.co:8443',
    }
    for (const [entrada, saida] of Object.entries(casos)) {
      expect(lerConfiguracao({ ...ok, VITE_SUPABASE_URL: entrada }).supabaseUrl, entrada).toBe(saida)
    }
  })

  test('recusa URL inválida, citando a variável', () => {
    for (const url of ['https://', 'https:// abc', 'https://abc supabase.co']) {
      const ler = () => lerConfiguracao({ ...ok, VITE_SUPABASE_URL: url })
      expect(ler, url).toThrow(ErroDeConfiguracao)
      expect(ler, url).toThrow(/VITE_SUPABASE_URL não é uma URL válida/)
    }
  })

  test('recusa o que não é só a origem (caminho, ?, #, credenciais, barra invertida, espaços, :443)', () => {
    const urls = [
      'https://abc.supabase.co/rest/v1', 'https://abc.supabase.co/rest/v1/', 'https://abc.supabase.co/x', 'https://abc.supabase.co//',
      'https://abc.supabase.co?a=1', 'https://abc.supabase.co#x', 'https://abc.supabase.co?', 'https://abc.supabase.co/#',
      'https://abc.supabase.co\\', 'https://user:pw@localhost', 'https://@abc.supabase.co',
      'https://abc.supa\nbase.co', 'https://abc.supa\tbase.co', 'https://abc.supabase.co/a b', 'https://abc.supabase.co:443',
    ]
    for (const url of urls) {
      const ler = () => lerConfiguracao({ ...ok, VITE_SUPABASE_URL: url })
      expect(ler, JSON.stringify(url)).toThrow(ErroDeConfiguracao)
      expect(ler, JSON.stringify(url)).toThrow(/VITE_SUPABASE_URL deve ser só a origem do projeto/)
    }
  })

  test('TURN só entra completo; valores aparados', () => {
    const t = { VITE_TURN_URL: 'turn:x', VITE_TURN_USUARIO: 'u', VITE_TURN_SENHA: 's' }
    expect(lerConfiguracao({ ...ok, VITE_TURN_URL: 'turn:x' })).not.toHaveProperty('turn')
    expect(lerConfiguracao({ ...ok, VITE_TURN_URL: 'turn:x' }).turn).toBeUndefined()
    expect(lerConfiguracao({ ...ok, VITE_TURN_URL: 'turn:x', VITE_TURN_USUARIO: 'u' }).turn).toBeUndefined()
    expect(lerConfiguracao({ ...ok, VITE_TURN_URL: 'turn:x', VITE_TURN_SENHA: 's' }).turn).toBeUndefined()
    expect(lerConfiguracao({ ...ok, VITE_TURN_USUARIO: 'u', VITE_TURN_SENHA: 's' }).turn).toBeUndefined()
    expect(lerConfiguracao({ ...ok, ...t, VITE_TURN_USUARIO: '   ' }).turn).toBeUndefined()
    expect(lerConfiguracao({ ...ok, ...t }).turn).toEqual({ url: 'turn:x', usuario: 'u', senha: 's' })
    expect(lerConfiguracao({ ...ok, VITE_TURN_URL: ' turn:x ', VITE_TURN_USUARIO: ' u ', VITE_TURN_SENHA: ' s ' }).turn)
      .toEqual({ url: 'turn:x', usuario: 'u', senha: 's' })
  })

  test('recusa chave secreta no lugar da publicável, sem vazar o valor', () => {
    for (const chave of ['sb_secret_x', 'SB_SECRET_Xyz123', ' sb_secret_x ']) {
      const ler = () => lerConfiguracao({ ...ok, VITE_SUPABASE_PUBLISHABLE_KEY: chave })
      expect(ler, chave).toThrow(ErroDeConfiguracao)
      expect(ler, chave).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY.*chave secreta.*navegador/)
      expect(ler, chave).not.toThrow(new RegExp(chave, 'i'))
    }
    expect(lerConfiguracao({ ...ok, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }).supabaseChavePublica).toBe('sb_publishable_x')
    // a regra é por prefixo: o trecho no meio do valor não conta
    expect(lerConfiguracao({ ...ok, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_sb_secret_x' }).supabaseChavePublica).toBe('sb_publishable_sb_secret_x')
  })

  test('o erro se chama ErroDeConfiguracao', () => {
    expect(new ErroDeConfiguracao('x').name).toBe('ErroDeConfiguracao')
    expect(new ErroDeConfiguracao('x')).toBeInstanceOf(Error)
    expect(() => lerConfiguracao({})).toThrow(expect.objectContaining({ name: 'ErroDeConfiguracao' }))
  })
})
