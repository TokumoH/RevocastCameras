import { describe, expect, test, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EstadoNoAr } from '../../domains/aovivo/mensagens'
import { criarFabricaDeCanais } from './canalSupabase'
import { criarRealtimeFalso } from './realtimeFalso'

const EU = '5a1c9e2b-7d3f-4b6a-8c1d-2e3f4a5b6c7d'
const OUTRO = '7b2d0f3c-8e4a-4c7b-9d2e-3f4a5b6c7d8e'
const EP = '0b6f3c1e-2a4d-4f8b-9c7e-1d2e3f4a5b6c'
const EP2 = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
const DISP = '9e8d7c6b-5a4f-4e3d-9c2b-1a0f9e8d7c6b'
const CMD = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a'
const TOPICO_CONTROLE = `episodio:${EP}:controle`

const OBS = { navegador: true, versaoDoPlugin: '2.24.0', nivel: 4, websocket: 'desligado', versaoObs: null, replayBuffer: null, gravando: null } as const
const ESTADO: EstadoNoAr = { episodioId: EP, modo: 'teste', cenaObs: 'Cena Abertura', avisoId: null, avisoAte: null, ultimo: null, obs: { ...OBS } }

/** Fila de agendamento manual: nenhum ouvinte roda até `rodar()` (prova que nada roda dentro do callback). */
function montar() {
  const fila: (() => void)[] = []
  const rt = criarRealtimeFalso()
  const fabrica = criarFabricaDeCanais(rt.cliente as unknown as SupabaseClient, EU, (f) => fila.push(f))
  return {
    rt,
    fabrica,
    fila,
    rodar() {
      while (fila.length > 0) fila.shift()!()
    },
  }
}

/** Deixa os microtasks (criação do canal depois de `abrir`, remoções) andarem. */
const tique = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('criarFabricaDeCanais', () => {
  test('canal-privado', async () => {
    const m = montar()
    m.fabrica.estudio()
    m.fabrica.controle(EP)
    await tique()
    const config = { private: true, broadcast: { ack: true, self: false }, presence: { key: EU } }
    expect(m.rt.canal('estudio').config).toEqual(config)
    expect(m.rt.canal(TOPICO_CONTROLE).config).toEqual(config)
    expect(m.rt.criados.map((c) => c.topico)).toEqual(['estudio', TOPICO_CONTROLE])
  })

  test('envia-com-remetente', async () => {
    const m = montar()
    const estudio = m.fabrica.estudio()
    const controle = m.fabrica.controle(EP)
    await tique()
    m.rt.emitirStatus(m.rt.canal('estudio'), 'SUBSCRIBED')
    m.rt.emitirStatus(m.rt.canal(TOPICO_CONTROLE), 'SUBSCRIBED')

    expect(await estudio.enviar({ evento: 'episodio_ativo_mudou' })).toBe('ok')
    expect(await estudio.enviar({ evento: 'dispositivo_mudou', dispositivoId: DISP })).toBe('ok')
    expect(await estudio.enviar({ evento: 'revogacao', usuario: OUTRO })).toBe('ok')
    expect(m.rt.canal('estudio').enviados).toEqual([
      { type: 'broadcast', event: 'episodio_ativo_mudou', payload: { remetente: EU } },
      { type: 'broadcast', event: 'dispositivo_mudou', payload: { dispositivoId: DISP, remetente: EU } },
      { type: 'broadcast', event: 'revogacao', payload: { usuario: OUTRO, remetente: EU } },
    ])

    expect(await controle.enviarComando({ id: CMD, acao: 'som', somId: DISP })).toBe('ok')
    expect(await controle.publicarEstado(ESTADO)).toBe('ok')
    expect(m.rt.canal(TOPICO_CONTROLE).enviados).toEqual([
      { type: 'broadcast', event: 'comando', payload: { id: CMD, acao: 'som', somId: DISP, remetente: EU } },
      { type: 'broadcast', event: 'estado', payload: { ...ESTADO, remetente: EU } },
    ])
  })

  test('recebe-valida', async () => {
    const m = montar()
    const estudio = m.fabrica.estudio()
    const controle = m.fabrica.controle(EP)
    const mensagens = vi.fn()
    const comandos = vi.fn()
    const estados = vi.fn()
    estudio.aoReceber(mensagens)
    controle.aoComando(comandos)
    controle.aoEstado(estados)
    await tique()
    const e = m.rt.canal('estudio')
    const c = m.rt.canal(TOPICO_CONTROLE)

    m.rt.emitirBroadcast(e, 'revogacao', { usuario: OUTRO.toUpperCase(), remetente: OUTRO }) // uuid em maiúsculas
    m.rt.emitirBroadcast(e, 'revogacao', { usuario: DISP }) // sem remetente
    m.rt.emitirBroadcast(e, 'revogacao', { usuario: DISP, remetente: OUTRO.toUpperCase() }) // remetente em maiúsculas
    m.rt.emitirBroadcast(e, 'revogacao', { usuario: DISP, remetente: OUTRO, extra: 1 }) // chave a mais
    m.rt.emitirBroadcast(e, 'comando', { id: CMD, acao: 'clipe', remetente: OUTRO }) // evento de outro tópico
    m.rt.emitirBroadcast(c, 'comando', { id: CMD, acao: 'cena', remetente: OUTRO }) // cena sem alvo
    m.rt.emitirBroadcast(c, 'estado', { ...ESTADO, cenaObs: 'x'.repeat(201), remetente: OUTRO })
    m.rt.emitirBroadcast(c, 'estado', { ...ESTADO }) // sem remetente
    m.rt.emitirBroadcast(c, 'outro', { id: CMD, acao: 'clipe', remetente: OUTRO })
    m.rodar()
    expect(mensagens).not.toHaveBeenCalled()
    expect(comandos).not.toHaveBeenCalled()
    expect(estados).not.toHaveBeenCalled()

    m.rt.emitirBroadcast(e, 'revogacao', { usuario: DISP, remetente: OUTRO })
    m.rt.emitirBroadcast(c, 'comando', { id: CMD, acao: 'clipe', remetente: OUTRO })
    m.rt.emitirBroadcast(c, 'estado', { ...ESTADO, remetente: OUTRO })
    m.rodar()
    expect(mensagens.mock.calls).toEqual([[{ evento: 'revogacao', usuario: DISP }, OUTRO]])
    expect(comandos.mock.calls).toEqual([[{ id: CMD, acao: 'clipe' }, OUTRO]])
    expect(estados.mock.calls).toEqual([[ESTADO, OUTRO]])
  })

  test('estados-do-canal', async () => {
    const m = montar()
    const estados = vi.fn()
    m.fabrica.estudio().aoMudarEstado(estados)
    await tique()
    const canal = m.rt.canal('estudio')
    m.rt.emitirStatus(canal, 'SUBSCRIBED')
    m.rt.emitirStatus(canal, 'TIMED_OUT')
    m.rt.emitirStatus(canal, 'SUBSCRIBED')
    m.rt.emitirStatus(canal, 'CHANNEL_ERROR', new Error('channel error: transport failure'))
    m.rt.emitirStatus(canal, 'CHANNEL_ERROR') // sem erro
    m.rt.emitirStatus(canal, 'SUBSCRIBED')
    m.rt.emitirStatus(canal, 'CHANNEL_ERROR', new Error('Unauthorized: You do not have permissions to read from this Channel topic: estudio'))
    m.rodar()
    expect(estados.mock.calls.map((c) => c[0])).toEqual(['conectando', 'conectado', 'reconectando', 'conectado', 'reconectando', 'reconectando', 'conectado', 'negado'])

    const m2 = montar()
    const estados2 = vi.fn()
    m2.fabrica.controle(EP).aoMudarEstado(estados2)
    await tique()
    m2.rt.emitirStatus(m2.rt.canal(TOPICO_CONTROLE), 'SUBSCRIBED')
    m2.rt.emitirStatus(m2.rt.canal(TOPICO_CONTROLE), 'CLOSED')
    m2.rodar()
    expect(estados2.mock.calls.map((c) => c[0])).toEqual(['conectando', 'conectado', 'fechado'])
  })

  test('ack', async () => {
    const m = montar()
    const estudio = m.fabrica.estudio()
    const controle = m.fabrica.controle(EP)
    await tique()
    // não conectado: falhou, sem chamar send (o realtime-js cairia para o REST)
    expect(await controle.enviarComando({ id: CMD, acao: 'clipe' })).toBe('falhou')
    expect(m.rt.contar('send')).toBe(0)

    m.rt.emitirStatus(m.rt.canal('estudio'), 'SUBSCRIBED')
    m.rt.emitirStatus(m.rt.canal(TOPICO_CONTROLE), 'SUBSCRIBED')
    m.rt.responderSend('ok')
    expect(await controle.enviarComando({ id: CMD, acao: 'clipe' })).toBe('ok')
    m.rt.responderSend('timed out')
    expect(await controle.enviarComando({ id: CMD, acao: 'clipe' })).toBe('sem_resposta')
    expect(await estudio.enviar({ evento: 'episodio_ativo_mudou' })).toBe('sem_resposta')
    m.rt.responderSend('error')
    expect(await controle.publicarEstado(ESTADO)).toBe('falhou')
    expect(m.rt.contar('send')).toBe(4)

    m.rt.emitirStatus(m.rt.canal(TOPICO_CONTROLE), 'TIMED_OUT')
    expect(await controle.enviarComando({ id: CMD, acao: 'clipe' })).toBe('falhou')
    expect(m.rt.contar('send')).toBe(4)
  })

  test('presenca', async () => {
    const m = montar()
    const estudio = m.fabrica.estudio()
    const presentes = vi.fn()
    estudio.aoMudarPresenca(presentes)
    await estudio.marcarPresenca({ tipo: 'membro', papel: 'equipe' }) // antes de conectar: guardada
    await tique()
    const canal = m.rt.canal('estudio')
    expect(canal.presencas).toEqual([])
    m.rt.emitirStatus(canal, 'SUBSCRIBED')
    await tique()
    expect(canal.presencas).toEqual([{ tipo: 'membro', papel: 'equipe' }])
    await estudio.marcarPresenca({ tipo: 'membro', papel: 'admin' })
    expect(canal.presencas).toEqual([{ tipo: 'membro', papel: 'equipe' }, { tipo: 'membro', papel: 'admin' }])
    // a reconexão entra de novo no canal: a presença é marcada de novo
    m.rt.emitirStatus(canal, 'TIMED_OUT')
    m.rt.emitirStatus(canal, 'SUBSCRIBED')
    await tique()
    expect(canal.presencas.at(-1)).toEqual({ tipo: 'membro', papel: 'admin' })
    expect(canal.presencas).toHaveLength(3)

    m.rt.emitirPresenca(canal, 'sync', {
      [OUTRO]: [{ tipo: 'obs_palco', dispositivoId: DISP, obs: { ...OBS }, presence_ref: 'r1' }],
      [EU]: [{ tipo: 'membro', papel: 'admin', presence_ref: 'r2' }, { tipo: 'membro', papel: 'dono', presence_ref: 'r3' }],
      'nao-e-uuid': [{ tipo: 'membro', papel: 'equipe' }],
      [DISP.toUpperCase()]: [{ tipo: 'membro', papel: 'equipe' }],
    })
    m.rodar()
    expect(presentes.mock.calls).toEqual([
      [
        [
          { usuario: OUTRO, presenca: { tipo: 'obs_palco', dispositivoId: DISP, obs: { ...OBS } } },
          { usuario: EU, presenca: { tipo: 'membro', papel: 'admin' } },
        ],
      ],
    ])

    // em :controle, só membros marcam presença, com o corpo vazio
    const controle = m.fabrica.controle(EP)
    await tique()
    m.rt.emitirStatus(m.rt.canal(TOPICO_CONTROLE), 'SUBSCRIBED')
    await controle.marcarPresenca()
    expect(m.rt.canal(TOPICO_CONTROLE).presencas).toEqual([{}])
  })

  test('entrar-alguem', async () => {
    const m = montar()
    const controle = m.fabrica.controle(EP)
    const entrou = vi.fn()
    const cancelar = controle.aoEntrarAlguem(entrou)
    await tique()
    m.rt.emitirPresenca(m.rt.canal(TOPICO_CONTROLE), 'join')
    m.rodar()
    expect(entrou).toHaveBeenCalledTimes(1)
    cancelar()
    m.rt.emitirPresenca(m.rt.canal(TOPICO_CONTROLE), 'join')
    m.rodar()
    expect(entrou).toHaveBeenCalledTimes(1)
  })

  test('ouvinte-adiado', async () => {
    const m = montar()
    const estudio = m.fabrica.estudio()
    const controle = m.fabrica.controle(EP)
    const chamados: string[] = []
    estudio.aoReceber(() => chamados.push('mensagem'))
    estudio.aoMudarPresenca(() => chamados.push('presenca'))
    estudio.aoMudarEstado((e) => chamados.push(`estado:${e}`))
    controle.aoComando(() => chamados.push('comando'))
    controle.aoEstado(() => chamados.push('estado-no-ar'))
    controle.aoEntrarAlguem(() => chamados.push('entrou'))
    await tique()
    const e = m.rt.canal('estudio')
    const c = m.rt.canal(TOPICO_CONTROLE)
    m.rt.emitirStatus(e, 'SUBSCRIBED')
    m.rt.emitirBroadcast(e, 'episodio_ativo_mudou', { remetente: OUTRO })
    m.rt.emitirPresenca(e, 'sync', { [OUTRO]: [{ tipo: 'membro', papel: 'equipe' }] })
    m.rt.emitirBroadcast(c, 'comando', { id: CMD, acao: 'clipe', remetente: OUTRO })
    m.rt.emitirBroadcast(c, 'estado', { ...ESTADO, remetente: OUTRO })
    m.rt.emitirPresenca(c, 'join')
    // nada rodou dentro dos callbacks do realtime-js
    expect(chamados).toEqual([])
    m.rodar()
    expect(chamados.sort()).toEqual(['comando', 'entrou', 'estado-no-ar', 'estado:conectado', 'estado:conectando', 'mensagem', 'presenca'].sort())

    // agendado e cancelado antes de rodar: não chama
    const tarde = vi.fn()
    const cancelar = estudio.aoReceber(tarde)
    m.rt.emitirBroadcast(e, 'episodio_ativo_mudou', { remetente: OUTRO })
    cancelar()
    m.rodar()
    expect(tarde).not.toHaveBeenCalled()
  })

  test('fechar-remove-canal', async () => {
    const m = montar()
    const estudio = m.fabrica.estudio()
    const mensagens = vi.fn()
    const estados = vi.fn()
    estudio.aoReceber(mensagens)
    estudio.aoMudarEstado(estados)
    await tique()
    const canal = m.rt.canal('estudio')
    m.rt.emitirStatus(canal, 'SUBSCRIBED')
    m.rodar()
    estados.mockClear()
    m.rt.emitirBroadcast(canal, 'episodio_ativo_mudou', { remetente: OUTRO }) // agendado antes de fechar
    await estudio.fechar()
    await estudio.fechar() // idempotente
    m.rt.emitirBroadcast(canal, 'episodio_ativo_mudou', { remetente: OUTRO })
    m.rodar()
    expect(m.rt.contar('removeChannel', 'estudio')).toBe(1)
    expect(mensagens).not.toHaveBeenCalled()
    expect(estados).not.toHaveBeenCalled() // o CLOSED da própria remoção não chega a ninguém
    expect(m.rt.canais()).toEqual([])
    expect(await estudio.enviar({ evento: 'episodio_ativo_mudou' })).toBe('falhou')

    // alça fechada antes de o canal nascer: nenhum canal é criado
    const cedo = m.fabrica.controle(EP)
    await cedo.fechar()
    await tique()
    expect(m.rt.contar('channel', TOPICO_CONTROLE)).toBe(0)
  })

  test('um-canal-por-topico', async () => {
    const m = montar()
    const a = m.fabrica.estudio()
    const b = m.fabrica.estudio()
    const ma = vi.fn()
    const mb = vi.fn()
    const eb = vi.fn()
    a.aoReceber(ma)
    b.aoReceber(mb)
    await tique()
    expect(m.rt.contar('channel', 'estudio')).toBe(1)
    expect(m.rt.contar('subscribe', 'estudio')).toBe(1)
    m.rt.emitirStatus(m.rt.canal('estudio'), 'SUBSCRIBED')
    // uma alça aberta depois de conectado fica sabendo do estado atual
    const c = m.fabrica.estudio()
    c.aoMudarEstado(eb)
    await tique()
    expect(m.rt.contar('channel', 'estudio')).toBe(1)
    m.rt.emitirBroadcast(m.rt.canal('estudio'), 'revogacao', { usuario: DISP, remetente: OUTRO })
    m.rodar()
    expect(ma).toHaveBeenCalledTimes(1)
    expect(mb).toHaveBeenCalledTimes(1)
    expect(eb.mock.calls).toEqual([['conectado']])

    m.fabrica.controle(EP)
    m.fabrica.controle(EP2)
    await tique()
    expect(m.rt.criados.map((x) => x.topico)).toEqual(['estudio', TOPICO_CONTROLE, `episodio:${EP2}:controle`])
  })

  test('fechar-um-nao-derruba-o-outro', async () => {
    const m = montar()
    const a = m.fabrica.estudio()
    const b = m.fabrica.estudio()
    const mb = vi.fn()
    b.aoReceber(mb)
    await tique()
    const canal = m.rt.canal('estudio')
    m.rt.emitirStatus(canal, 'SUBSCRIBED')
    await a.marcarPresenca({ tipo: 'membro', papel: 'equipe' })
    await a.fechar()
    await a.fechar() // fechar a mesma alça de novo não conta como a saída de outra
    expect(m.rt.contar('removeChannel')).toBe(0)
    expect(m.rt.contar('untrack')).toBe(0)
    m.rt.emitirBroadcast(canal, 'episodio_ativo_mudou', { remetente: OUTRO })
    m.rodar()
    expect(mb).toHaveBeenCalledTimes(1)
    expect(await b.enviar({ evento: 'episodio_ativo_mudou' })).toBe('ok')
    // a alça fechada não troca mais a presença do canal: a reconexão remarca a última presença válida
    await a.marcarPresenca({ tipo: 'membro', papel: 'admin' })
    m.rt.emitirStatus(canal, 'TIMED_OUT')
    m.rt.emitirStatus(canal, 'SUBSCRIBED')
    await tique()
    expect(canal.presencas.at(-1)).toEqual({ tipo: 'membro', papel: 'equipe' })
    expect(canal.presencas).not.toContainEqual({ tipo: 'membro', papel: 'admin' })
    await b.fechar()
    expect(m.rt.contar('untrack', 'estudio')).toBe(1)
    expect(m.rt.contar('removeChannel', 'estudio')).toBe(1)
    // untrack antes do removeChannel
    const ordem = m.rt.registro.filter((r) => r[0] === 'untrack' || r[0] === 'removeChannel').map((r) => r[0])
    expect(ordem).toEqual(['untrack', 'removeChannel'])
  })

  test('presence-antes-do-subscribe', async () => {
    const m = montar()
    m.fabrica.estudio()
    m.fabrica.controle(EP)
    await tique()
    for (const topico of ['estudio', TOPICO_CONTROLE]) {
      const doTopico = m.rt.registro.filter((r) => r[1] === topico)
      const iSubscribe = doTopico.findIndex((r) => r[0] === 'subscribe')
      const ons = doTopico.map((r, i) => [r, i] as const).filter(([r]) => r[0] === 'on')
      expect(ons.map(([r]) => [r[2], r[3]])).toEqual([
        ['broadcast', '*'],
        ['presence', 'sync'],
        ['presence', 'join'],
      ])
      expect(ons.every(([, i]) => i < iSubscribe)).toBe(true)
    }
    m.rt.emitirStatus(m.rt.canal('estudio'), 'SUBSCRIBED')
    const antes = m.rt.contar('on')
    m.fabrica.estudio()
    await tique()
    expect(m.rt.contar('on')).toBe(antes)
  })

  test('canal-fechado-sai-do-registro', async () => {
    const m = montar()
    const a = m.fabrica.estudio()
    const b = m.fabrica.estudio()
    const ea = vi.fn()
    const eb = vi.fn()
    a.aoMudarEstado(ea)
    b.aoMudarEstado(eb)
    await tique()
    const velho = m.rt.canal('estudio')
    m.rt.emitirStatus(velho, 'SUBSCRIBED')
    m.rt.emitirStatus(velho, 'CLOSED') // o servidor fecha (por exemplo, na renovação do token depois de uma revogação)
    m.rodar()
    expect(ea.mock.calls.at(-1)).toEqual(['fechado'])
    expect(eb.mock.calls.at(-1)).toEqual(['fechado'])
    // com a e b ainda abertas, um abrir() novo cria outro canal
    const c = m.fabrica.estudio()
    const ec = vi.fn()
    c.aoMudarEstado(ec)
    await tique()
    expect(m.rt.contar('channel', 'estudio')).toBe(2)
    expect(m.rt.contar('subscribe', 'estudio')).toBe(2)
    expect(m.rt.canal('estudio')).not.toBe(velho)
    m.rt.emitirStatus(m.rt.canal('estudio'), 'SUBSCRIBED')
    m.rodar()
    expect(ec.mock.calls.map((x) => x[0])).toEqual(['conectando', 'conectado'])
    expect(ea.mock.calls.at(-1)).toEqual(['fechado']) // as alças velhas não voltam a conectado
    expect(await a.enviar({ evento: 'episodio_ativo_mudou' })).toBe('falhou')
  })

  test('reabrir-depois-de-fechado', async () => {
    const m = montar()
    const a = m.fabrica.estudio()
    const b = m.fabrica.estudio()
    await tique()
    const velho = m.rt.canal('estudio')
    m.rt.emitirStatus(velho, 'SUBSCRIBED')
    m.rt.emitirStatus(velho, 'CLOSED')
    // a alça que recebeu fechado se fecha e abre de novo
    await a.fechar()
    const a2 = m.fabrica.estudio()
    const ea2 = vi.fn()
    const ma2 = vi.fn()
    a2.aoMudarEstado(ea2)
    a2.aoReceber(ma2)
    await tique()
    const novo = m.rt.canal('estudio')
    expect(novo).not.toBe(velho)
    m.rt.emitirStatus(novo, 'SUBSCRIBED')
    m.rodar()
    expect(ea2.mock.calls.at(-1)).toEqual(['conectado'])
    // fechar depois a outra alça antiga não remove o canal novo (nem chama removeChannel do velho, já fechado)
    await b.fechar()
    await tique()
    expect(m.rt.contar('removeChannel')).toBe(0)
    expect(m.rt.canais()).toEqual([novo])
    m.rt.emitirBroadcast(novo, 'episodio_ativo_mudou', { remetente: OUTRO })
    m.rodar()
    expect(ma2).toHaveBeenCalledTimes(1)
    expect(await a2.enviar({ evento: 'episodio_ativo_mudou' })).toBe('ok')
  })

  test('abrir-durante-remocao', async () => {
    // a janela real da remoção pendente é o untrack: o canal continua inscrito na lista até o servidor responder
    const m = montar()
    m.rt.segurarUntrack()
    const a = m.fabrica.estudio()
    await tique()
    m.rt.emitirStatus(m.rt.canal('estudio'), 'SUBSCRIBED')
    await a.marcarPresenca({ tipo: 'membro', papel: 'equipe' })
    const fechando = a.fechar()
    expect(m.rt.canais()).toHaveLength(1) // ainda inscrito, esperando o untrack
    const b = m.fabrica.estudio()
    const eb = vi.fn()
    b.aoMudarEstado(eb)
    await tique()
    m.rodar()
    expect(eb.mock.calls).toEqual([['conectando']])
    expect(m.rt.contar('channel', 'estudio')).toBe(1) // nenhum canal novo enquanto o velho está saindo
    expect(m.rt.contar('removeChannel')).toBe(0)
    m.rt.liberarUntracks()
    await fechando
    await tique()
    expect(m.rt.contar('channel', 'estudio')).toBe(2)
    expect(m.rt.contar('subscribe', 'estudio')).toBe(2)
    m.rt.emitirStatus(m.rt.canal('estudio'), 'SUBSCRIBED')
    m.rodar()
    expect(eb.mock.calls.map((x) => x[0])).toEqual(['conectando', 'conectado'])
  })

  test('negado-remove-o-canal', async () => {
    const m = montar()
    const a = m.fabrica.estudio()
    const ea = vi.fn()
    a.aoMudarEstado(ea)
    await tique()
    const velho = m.rt.canal('estudio')
    m.rt.emitirStatus(velho, 'CHANNEL_ERROR', new Error('Unauthorized: You do not have permissions to read from this Channel topic: estudio'))
    m.rodar()
    expect(ea.mock.calls.at(-1)).toEqual(['negado'])
    // o canal com erro continua na lista do cliente (e tentaria de novo): é removido aqui
    expect(m.rt.contar('removeChannel', 'estudio')).toBe(1)
    expect(m.rt.canais()).toEqual([]) // o removeChannel fecha na hora
    const b = m.fabrica.estudio()
    await tique()
    await tique()
    expect(m.rt.contar('channel', 'estudio')).toBe(2)
    expect(m.rt.canal('estudio')).not.toBe(velho)
    // fechar a alça negada depois não remove de novo; o CLOSED da remoção não muda o estado dela
    await a.fechar()
    m.rodar()
    expect(m.rt.contar('removeChannel')).toBe(1)
    expect(ea.mock.calls.at(-1)).toEqual(['negado'])
    await b.fechar()
  })

  test('eco-local', async () => {
    const m = montar()
    const a = m.fabrica.estudio()
    const b = m.fabrica.estudio()
    const ma = vi.fn()
    const mb = vi.fn()
    a.aoReceber(ma)
    b.aoReceber(mb)
    await tique()
    m.rt.emitirStatus(m.rt.canal('estudio'), 'SUBSCRIBED')
    expect(await a.enviar({ evento: 'episodio_ativo_mudou' })).toBe('ok')
    m.rodar()
    expect(mb.mock.calls).toEqual([[{ evento: 'episodio_ativo_mudou' }, EU]])
    expect(ma).not.toHaveBeenCalled()
    // com o ack sem resposta, a outra alça recebe do mesmo jeito (a mudança no banco já aconteceu)
    m.rt.responderSend('timed out')
    expect(await a.enviar({ evento: 'revogacao', usuario: OUTRO })).toBe('sem_resposta')
    m.rodar()
    expect(mb.mock.calls).toEqual([
      [{ evento: 'episodio_ativo_mudou' }, EU],
      [{ evento: 'revogacao', usuario: OUTRO }, EU],
    ])
    expect(ma).not.toHaveBeenCalled()

    // também em :controle: o estado publicado por uma alça chega às outras do mesmo cliente
    const p = m.fabrica.controle(EP)
    const q = m.fabrica.controle(EP)
    const eq = vi.fn()
    const ep = vi.fn()
    p.aoEstado(ep)
    q.aoEstado(eq)
    await tique()
    m.rt.emitirStatus(m.rt.canal(TOPICO_CONTROLE), 'SUBSCRIBED')
    m.rt.responderSend('ok')
    await p.publicarEstado(ESTADO)
    m.rodar()
    expect(eq.mock.calls).toEqual([[ESTADO, EU]])
    expect(ep).not.toHaveBeenCalled()
  })

  test('untrack-so-conectado-com-presenca', async () => {
    // presença marcada, mas o canal nunca entrou: sem untrack (ficaria até 10 s na fila do phoenix)
    const m = montar()
    const a = m.fabrica.estudio()
    await tique()
    await a.marcarPresenca({ tipo: 'membro', papel: 'equipe' })
    await a.fechar()
    expect(m.rt.contar('untrack')).toBe(0)
    expect(m.rt.contar('removeChannel')).toBe(1)
    // conectado, mas sem presença marcada: sem untrack
    const b = m.fabrica.controle(EP)
    await tique()
    m.rt.emitirStatus(m.rt.canal(TOPICO_CONTROLE), 'SUBSCRIBED')
    await b.fechar()
    expect(m.rt.contar('untrack')).toBe(0)
    expect(m.rt.contar('removeChannel')).toBe(2)
    // conectado e com presença: untrack antes da remoção
    const c = m.fabrica.estudio()
    await tique()
    m.rt.emitirStatus(m.rt.canal('estudio'), 'SUBSCRIBED')
    await c.marcarPresenca({ tipo: 'membro', papel: 'equipe' })
    await c.fechar()
    expect(m.rt.contar('untrack')).toBe(1)
  })

  test('presenca-para-quem-chega-depois', async () => {
    const m = montar()
    const a = m.fabrica.estudio()
    const pa = vi.fn()
    a.aoMudarPresenca(pa)
    await tique()
    m.rodar()
    expect(pa).not.toHaveBeenCalled() // antes de conectar, nada a entregar
    const canal = m.rt.canal('estudio')
    // canal já criado, mas ainda conectando: quem se inscreve agora não recebe nada até o sync
    const cedo = vi.fn()
    m.fabrica.estudio().aoMudarPresenca(cedo)
    m.rodar()
    expect(cedo).not.toHaveBeenCalled()
    m.rt.emitirStatus(canal, 'SUBSCRIBED')
    m.rt.emitirPresenca(canal, 'sync', { [OUTRO]: [{ tipo: 'obs_palco', dispositivoId: DISP, obs: null, presence_ref: 'r1' }] })
    m.rodar()
    expect(pa).toHaveBeenCalledTimes(1)
    // a alça aberta depois do sync (o painel depois do useAoVivo) recebe logo a presença atual, adiada
    const b = m.fabrica.estudio()
    const pb = vi.fn()
    b.aoMudarPresenca(pb)
    expect(pb).not.toHaveBeenCalled()
    m.rodar()
    expect(pb.mock.calls).toEqual([[[{ usuario: OUTRO, presenca: { tipo: 'obs_palco', dispositivoId: DISP, obs: null } }]]])
    expect(pa).toHaveBeenCalledTimes(1) // a primeira alça não recebe de novo
    // reconectando: a presença guardada pode estar velha; nada é entregue até o próximo sync
    m.rt.emitirStatus(canal, 'TIMED_OUT')
    const tarde = vi.fn()
    m.fabrica.estudio().aoMudarPresenca(tarde)
    m.rodar()
    expect(tarde).not.toHaveBeenCalled()
    m.rt.emitirStatus(canal, 'SUBSCRIBED')
    m.rt.emitirPresenca(canal, 'sync')
    m.rodar()
    expect(tarde).toHaveBeenCalledTimes(1)
    expect(cedo).toHaveBeenCalledTimes(2) // o sync depois de conectar e este
  })

  test('criar-canal-que-falha-vira-fechado', async () => {
    // outro código do mesmo cliente já inscreveu o tópico: o channel() devolve esse canal
    const m = montar()
    const alheio = m.rt.cliente.channel('estudio')
    alheio.subscribe()
    const a = m.fabrica.estudio()
    const ea = vi.fn()
    a.aoMudarEstado(ea)
    await tique()
    m.rodar()
    expect(ea.mock.calls.map((c) => c[0])).toEqual(['conectando', 'fechado'])
    expect(m.rt.contar('on')).toBe(0) // nada registrado no canal alheio
    expect(m.rt.contar('removeChannel')).toBe(0) // nem removido daqui
    expect(m.rt.contar('subscribe', 'estudio')).toBe(1)
    await a.fechar()
    expect(m.rt.contar('removeChannel')).toBe(0)

    // channel() que lança: também fechado, sem rejeição solta
    const m2 = montar()
    vi.spyOn(m2.rt.cliente, 'channel').mockImplementationOnce(() => {
      throw new Error('falhou')
    })
    const b = m2.fabrica.controle(EP)
    const eb = vi.fn()
    b.aoMudarEstado(eb)
    await tique()
    m2.rodar()
    expect(eb.mock.calls.map((c) => c[0])).toEqual(['conectando', 'fechado'])
    // a reabertura cria um canal novo
    await b.fechar()
    const c = m2.fabrica.controle(EP)
    await tique()
    m2.rt.emitirStatus(m2.rt.canal(TOPICO_CONTROLE), 'SUBSCRIBED')
    const ec = vi.fn()
    c.aoMudarEstado(ec)
    m2.rodar()
    expect(ec.mock.calls).toEqual([['conectado']])
  })

  test('outra-fabrica-espera-a-remocao', async () => {
    const fila: (() => void)[] = []
    const rt = criarRealtimeFalso()
    rt.segurarUntrack()
    const cliente = rt.cliente as unknown as SupabaseClient
    const fab1 = criarFabricaDeCanais(cliente, EU, (f) => fila.push(f))
    const a = fab1.estudio()
    await tique()
    rt.emitirStatus(rt.canal('estudio'), 'SUBSCRIBED')
    await a.marcarPresenca({ tipo: 'membro', papel: 'equipe' })
    const fechando = a.fechar() // remoção pendente: o untrack espera o servidor, com o canal ainda inscrito
    // outro usuário no mesmo cliente (canaisPorUsuario): outra fábrica, mesma remoção a esperar
    const fab2 = criarFabricaDeCanais(cliente, OUTRO, (f) => fila.push(f))
    const b = fab2.estudio()
    const eb = vi.fn()
    b.aoMudarEstado(eb)
    await tique()
    while (fila.length > 0) fila.shift()!()
    expect(eb.mock.calls).toEqual([['conectando']]) // sem esperar, o channel() devolveria o canal inscrito → fechado
    expect(rt.contar('channel', 'estudio')).toBe(1)
    rt.liberarUntracks()
    await fechando
    await tique()
    expect(rt.contar('channel', 'estudio')).toBe(2)
    rt.emitirStatus(rt.canal('estudio'), 'SUBSCRIBED')
    while (fila.length > 0) fila.shift()!()
    expect(eb.mock.calls.map((x) => x[0])).toEqual(['conectando', 'conectado'])
    expect((rt.canal('estudio').config as { presence: { key: string } }).presence.key).toBe(OUTRO)
  })
})
