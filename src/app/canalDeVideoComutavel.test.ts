import { describe, test, expect } from 'vitest'
import type { EstadoDoCanal } from '../domains/aovivo/portas'
import type { CanalDeVideo, RespostaDoSinal } from '../domains/captura/portas'
import { criarCanalComutavel } from './canalDeVideoComutavel'

/** Canal real mínimo: guarda ouvintes, conta envios e fechamentos; `estado` e `sinal` disparam os ouvintes. */
function canalReal(resposta: RespostaDoSinal = 'ok') {
  const sinais = new Set<(s: string, r: string) => void>()
  const estados = new Set<(e: EstadoDoCanal) => void>()
  const registro = { enviados: [] as string[], fechado: 0 }
  const canal: CanalDeVideo<string, string> = {
    aoSinal(f) {
      sinais.add(f)
      return () => sinais.delete(f)
    },
    aoMudarEstado(f) {
      estados.add(f)
      f('conectando') // como o adaptador: quem chega fica sabendo o estado atual
      return () => estados.delete(f)
    },
    async enviar(s) {
      registro.enviados.push(s)
      return resposta
    },
    async fechar() {
      registro.fechado += 1
    },
  }
  return {
    canal,
    registro,
    estado: (e: EstadoDoCanal) => {
      for (const f of [...estados]) f(e)
    },
    sinal: (s: string, r: string) => {
      for (const f of [...sinais]) f(s, r)
    },
    ouvintes: () => sinais.size + estados.size,
  }
}

describe('criarCanalComutavel (PLA-005, D5)', () => {
  test('sem canal real: enviar devolve falhou sem chamar nada; nenhum estado', async () => {
    const c = criarCanalComutavel<string, string>()
    const estados: EstadoDoCanal[] = []
    c.canal.aoMudarEstado((e) => estados.push(e))
    expect(await c.canal.enviar('oferta')).toBe('falhou')
    expect(estados).toEqual([])
    expect(c.desligar()).toBeNull()
  })

  test('ligado: repassa estado, sinais e envio do canal real', async () => {
    const c = criarCanalComutavel<string, string>()
    const estados: EstadoDoCanal[] = []
    const sinais: string[] = []
    c.canal.aoMudarEstado((e) => estados.push(e))
    c.canal.aoSinal((s, r) => sinais.push(`${s}/${r}`))
    const r = canalReal('sem_par')
    c.ligar(r.canal)
    r.estado('conectado')
    r.sinal('pronto', 'obs')
    expect(estados).toEqual(['conectando', 'conectado'])
    expect(sinais).toEqual(['pronto/obs'])
    expect(await c.canal.enviar('oferta')).toBe('sem_par')
    expect(r.registro.enviados).toEqual(['oferta'])
  })

  test('desligar: avisa fechado, solta os ouvintes do real e o devolve sem fechar', async () => {
    const c = criarCanalComutavel<string, string>()
    const estados: EstadoDoCanal[] = []
    const sinais: string[] = []
    c.canal.aoMudarEstado((e) => estados.push(e))
    c.canal.aoSinal((s) => sinais.push(s))
    const r = canalReal()
    c.ligar(r.canal)
    const devolvido = c.desligar()
    expect(devolvido).toBe(r.canal)
    expect(r.registro.fechado).toBe(0) // a rota manda o `encerrar` antes de fechar
    expect(r.ouvintes()).toBe(0)
    expect(estados.at(-1)).toBe('fechado')
    r.sinal('pronto', 'obs')
    r.estado('conectado')
    expect(sinais).toEqual([])
    expect(estados.at(-1)).toBe('fechado')
    expect(await c.canal.enviar('oferta')).toBe('falhou')
    expect(r.registro.enviados).toEqual([])
  })

  test('ligar outro real fecha o anterior; fechar desliga e fecha o atual', async () => {
    const c = criarCanalComutavel<string, string>()
    const a = canalReal()
    const b = canalReal()
    c.ligar(a.canal)
    c.ligar(b.canal)
    await Promise.resolve()
    expect(a.registro.fechado).toBe(1)
    expect(a.ouvintes()).toBe(0)
    await c.canal.fechar()
    expect(b.registro.fechado).toBe(1)
    // desligado: o envio volta a `falhou` sem chamar o real (estado observável no lugar da antiga consulta `ligado`)
    expect(await c.canal.enviar('oferta')).toBe('falhou')
    expect(b.registro.enviados).toEqual([])
  })
})
