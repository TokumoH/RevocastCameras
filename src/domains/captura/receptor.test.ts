import { describe, test, expect } from 'vitest'
import { SDP_DA_OFERTA, SDP_DA_RESPOSTA, criarCanalFalso, criarConexoesFalsas, criarRelogioFalso, fluxoDeTeste } from './falsos'
import type { FluxoDeVideo } from './portas'
import { criarReceptorDeVideo } from './receptor'
import { lerSinalDaCamera, type EstadoDoVideo, type SinalDaCamera, type SinalDaObs } from './sinais'

const CAMERA = 'c0ffee00-1111-4111-8111-11111111abcd'
const OUTRO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const ID_DO_SEND = 'dddddddd-0000-4000-8000-000000000001'

const sessao = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

function montar() {
  const relogio = criarRelogioFalso()
  const canal = criarCanalFalso<SinalDaObs, SinalDaCamera>(lerSinalDaCamera)
  const conexoes = criarConexoesFalsas()
  const situacoes: EstadoDoVideo[] = []
  const videos: (FluxoDeVideo | null)[] = []
  const revogados = new Set<string>()
  let n = 100
  const receptor = criarReceptorDeVideo({
    canal: canal.canal,
    conexoes: conexoes.fabrica,
    revogado: (u) => revogados.has(u),
    novaSessao: () => sessao(++n),
    agendar: relogio.agendar,
    aoMudarSituacao: (e) => situacoes.push(e),
    aoVideo: (f) => videos.push(f),
  })
  return {
    relogio,
    canal,
    conexoes,
    situacoes,
    videos,
    revogados,
    receptor,
    situacao: () => situacoes.at(-1),
    prontos: () => canal.enviados.filter((s) => s.tipo === 'pronto').length,
    respostas: () => canal.enviados.filter((s): s is Extract<SinalDaObs, { tipo: 'resposta' }> => s.tipo === 'resposta'),
    async oferta(s: string, remetente = CAMERA): Promise<void> {
      canal.entregar('sinal', { tipo: 'oferta', sessao: s, sdp: SDP_DA_OFERTA, remetente, id: ID_DO_SEND })
      await relogio.avancar(0)
    },
    async sinal(s: Record<string, unknown>, remetente = CAMERA): Promise<void> {
      canal.entregar('sinal', { ...s, remetente, id: ID_DO_SEND })
      await relogio.avancar(0)
    },
  }
}

type Montado = ReturnType<typeof montar>

async function noAr(m: Montado): Promise<void> {
  m.canal.mudarEstado('conectado')
  m.receptor.definirEpisodio(true)
  await m.relogio.avancar(0)
}

async function emitir(m: Montado, e: 'conectando' | 'conectado' | 'caiu' | 'falhou'): Promise<void> {
  m.conexoes.ultima()?.emitir(e)
  await m.relogio.avancar(0)
}

/** Oferta respondida, vídeo chegando e a conexão em `conectado`. */
async function comVideo(m: Montado, s = sessao(1)): Promise<FluxoDeVideo> {
  await noAr(m)
  await m.oferta(s)
  const fluxo = fluxoDeTeste()
  m.conexoes.ultima()?.mostrarVideo(fluxo)
  await emitir(m, 'conectado')
  return fluxo
}

describe('receptor-pronto', () => {
  test('episódio ativo e canal conectado → pronto; sem vídeo, a cada 10 000 ms; em conectando, sai sem fechar nada; com conectado, não', async () => {
    const m = montar()
    expect(m.situacao()).toBe('aguardando_episodio')
    await noAr(m)
    expect(m.prontos()).toBe(1)
    expect(m.situacao()).toBe('aguardando_par')
    await m.relogio.avancar(9999)
    expect(m.prontos()).toBe(1)
    await m.relogio.avancar(1)
    expect(m.prontos()).toBe(2)
    await m.oferta(sessao(1))
    await emitir(m, 'conectando')
    await m.relogio.avancar(10_000)
    expect(m.prontos()).toBe(3)
    expect(m.conexoes.criadas[0].fechada()).toBe(false)
    expect(m.conexoes.criadas).toHaveLength(1)
    await emitir(m, 'conectado')
    await m.relogio.avancar(60_000)
    expect(m.prontos()).toBe(3)
  })

  test('sem episódio ou com o canal fora de conectado → nenhum pronto', async () => {
    const m = montar()
    m.canal.mudarEstado('conectado')
    await m.relogio.avancar(60_000)
    expect(m.prontos()).toBe(0)
    const n = montar()
    n.receptor.definirEpisodio(true)
    await n.relogio.avancar(60_000)
    expect(n.prontos()).toBe(0)
    n.canal.mudarEstado('conectado')
    await n.relogio.avancar(0)
    expect(n.prontos()).toBe(1)
  })

  test('canal que volta a conectado sem vídeo → pronto na hora; com vídeo → nada', async () => {
    const m = montar()
    await comVideo(m)
    const antes = m.prontos()
    m.canal.mudarEstado('reconectando')
    m.canal.mudarEstado('conectado')
    await m.relogio.avancar(0)
    expect(m.prontos()).toBe(antes)
  })
})

describe('receptor-responde', () => {
  test('oferta → responder(sdp) → resposta com a mesma sessão', async () => {
    const m = montar()
    await noAr(m)
    await m.oferta(sessao(7))
    expect(m.conexoes.criadas[0].ofertasRespondidas).toEqual([SDP_DA_OFERTA])
    expect(m.respostas()).toEqual([{ tipo: 'resposta', sessao: sessao(7), sdp: SDP_DA_RESPOSTA }])
    expect(m.situacao()).toBe('conectando')
  })
})

describe('receptor-oferta-nova-fecha-a-antiga', () => {
  test('oferta de outra sessão → a conexão anterior fecha antes da nova; aoVideo(null) e depois o fluxo novo', async () => {
    const m = montar()
    const primeiro = await comVideo(m, sessao(1))
    await m.oferta(sessao(2))
    expect(m.conexoes.registro).toEqual(['criar#0', 'fechar#0', 'criar#1'])
    const segundo = fluxoDeTeste()
    m.conexoes.criadas[1].mostrarVideo(segundo)
    await m.relogio.avancar(0)
    expect(m.videos).toEqual([primeiro, null])
    await emitir(m, 'conectado')
    expect(m.videos).toEqual([primeiro, null, segundo])
    expect(m.videos[0]).toBe(primeiro)
    expect(m.videos[2]).toBe(segundo)
    // o vídeo da conexão antiga não volta a aparecer
    m.conexoes.criadas[0].mostrarVideo(fluxoDeTeste())
    m.conexoes.criadas[0].emitir('falhou')
    await m.relogio.avancar(0)
    expect(m.videos).toHaveLength(3)
  })
})

describe('receptor-oferta-repetida', () => {
  test('mesma sessão duas vezes → uma resposta', async () => {
    const m = montar()
    await noAr(m)
    await m.oferta(sessao(3))
    await m.oferta(sessao(3))
    expect(m.respostas()).toHaveLength(1)
    expect(m.conexoes.criadas).toHaveLength(1)
  })
})

describe('receptor-ignora-resposta', () => {
  test('uma resposta entregue pelo caminho do leitor real não chega ao receptor', async () => {
    const m = montar()
    await noAr(m)
    const antes = m.canal.enviados.length
    expect(m.canal.entregar('sinal', { tipo: 'resposta', sessao: sessao(1), sdp: SDP_DA_RESPOSTA, remetente: CAMERA, id: ID_DO_SEND })).toBe(false)
    expect(m.canal.entregar('sinal', { tipo: 'pronto', sessao: sessao(1), remetente: CAMERA, id: ID_DO_SEND })).toBe(false)
    await m.relogio.avancar(0)
    expect(m.conexoes.criadas).toHaveLength(0)
    expect(m.canal.enviados).toHaveLength(antes)
  })
})

describe('receptor-encerrar', () => {
  test('encerrar da sessão atual → fecha e aoVideo(null); de outra sessão → nada', async () => {
    const m = montar()
    const fluxo = await comVideo(m, sessao(1))
    await m.sinal({ tipo: 'encerrar', sessao: sessao(9) })
    expect(m.conexoes.criadas[0].fechada()).toBe(false)
    expect(m.videos).toEqual([fluxo])
    await m.sinal({ tipo: 'encerrar', sessao: sessao(1) }, OUTRO)
    expect(m.conexoes.criadas[0].fechada()).toBe(false)
    await m.sinal({ tipo: 'encerrar', sessao: sessao(1) })
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
    expect(m.videos).toEqual([fluxo, null])
  })
})

describe('receptor-revoga-par', () => {
  test('revogar o remetente da oferta → fecha e aoVideo(null); ofertas dele com revogado verdadeiro → ignoradas', async () => {
    const m = montar()
    const fluxo = await comVideo(m, sessao(1))
    m.receptor.revogarPar(OUTRO)
    await m.relogio.avancar(0)
    expect(m.conexoes.criadas[0].fechada()).toBe(false)
    m.receptor.revogarPar(CAMERA)
    await m.relogio.avancar(0)
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
    expect(m.videos).toEqual([fluxo, null])
    m.revogados.add(CAMERA)
    await m.oferta(sessao(2))
    expect(m.conexoes.criadas).toHaveLength(1)
    expect(m.respostas()).toHaveLength(1)
  })
})

describe('receptor-sem-episodio', () => {
  test('fecha, aoVideo(null), sem pronto; oferta sem episódio é ignorada', async () => {
    const m = montar()
    const fluxo = await comVideo(m)
    const prontos = m.prontos()
    m.receptor.definirEpisodio(false)
    await m.relogio.avancar(0)
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
    expect(m.videos).toEqual([fluxo, null])
    expect(m.situacao()).toBe('aguardando_episodio')
    await m.oferta(sessao(5))
    await m.relogio.avancar(60_000)
    expect(m.prontos()).toBe(prontos)
    expect(m.conexoes.criadas).toHaveLength(1)
  })
})

describe('receptor-falhou', () => {
  test('conexão falhou → aoVideo(null) e pronto de novo', async () => {
    const m = montar()
    const fluxo = await comVideo(m)
    const prontos = m.prontos()
    await emitir(m, 'falhou')
    expect(m.videos).toEqual([fluxo, null])
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
    expect(m.prontos()).toBe(prontos + 1)
    await m.relogio.avancar(10_000)
    expect(m.prontos()).toBe(prontos + 2)
  })

  test('caiu → pronto volta a sair, sem fechar a conexão', async () => {
    const m = montar()
    await comVideo(m)
    const prontos = m.prontos()
    await emitir(m, 'caiu')
    expect(m.prontos()).toBe(prontos + 1)
    expect(m.conexoes.criadas[0].fechada()).toBe(false)
  })
})

describe('receptor-sem-conexao-direta', () => {
  test('duas falhas seguidas depois de responder → sem_conexao_direta; conectado → conectado', async () => {
    const m = montar()
    await noAr(m)
    await m.oferta(sessao(1))
    await emitir(m, 'falhou')
    expect(m.situacao()).not.toBe('sem_conexao_direta')
    // a câmera desiste pelo prazo da conexão e manda outra oferta: conta como falha da anterior
    await m.oferta(sessao(2))
    await m.oferta(sessao(3))
    expect(m.situacao()).toBe('sem_conexao_direta')
    await emitir(m, 'conectado')
    expect(m.situacao()).toBe('conectado')
  })
})

describe('receptor-sdp-grande', () => {
  test('resposta acima do teto → nada enviado, sinal_grande, conexão fechada e sem pronto até nova oferta', async () => {
    const m = montar()
    await noAr(m)
    const prontos = m.prontos()
    m.conexoes.config.sdpDaResposta = 'v=0\r\na=' + 'x'.repeat(12_001) + '\r\n'
    await m.oferta(sessao(1))
    expect(m.respostas()).toHaveLength(0)
    expect(m.situacao()).toBe('sinal_grande')
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
    await m.relogio.avancar(60_000)
    expect(m.prontos()).toBe(prontos)
    m.conexoes.config.sdpDaResposta = SDP_DA_RESPOSTA
    await m.oferta(sessao(2))
    expect(m.respostas()).toEqual([{ tipo: 'resposta', sessao: sessao(2), sdp: SDP_DA_RESPOSTA }])
    expect(m.situacao()).toBe('conectando')
  })
})

describe('receptor-limite', () => {
  test('pronto → limite → o próximo pronto só depois da espera crescente (nunca antes dos 10 s)', async () => {
    const m = montar()
    m.canal.responderCom(() => 'limite')
    await noAr(m)
    expect(m.prontos()).toBe(1)
    for (const espera of [10_000, 10_000, 10_000, 16_000, 30_000, 30_000]) {
      const antes = m.prontos()
      await m.relogio.avancar(espera - 1)
      expect(m.prontos()).toBe(antes)
      await m.relogio.avancar(1)
      expect(m.prontos()).toBe(antes + 1)
    }
  })

  test('resposta → limite → o próximo pronto só depois da espera', async () => {
    const m = montar()
    await noAr(m)
    m.canal.responderCom((s) => (s.tipo === 'resposta' ? 'limite' : 'ok'))
    await m.relogio.avancar(5000)
    await m.oferta(sessao(1))
    const antes = m.prontos()
    // sem o limite, o pronto periódico sairia em 5 000 ms
    await m.relogio.avancar(9999)
    expect(m.prontos()).toBe(antes)
    await m.relogio.avancar(1)
    expect(m.prontos()).toBe(antes + 1)
  })

  test('canal que volta a conectado durante a espera do limite não fura a espera', async () => {
    const m = montar()
    m.canal.responderCom(() => 'limite')
    await noAr(m)
    m.canal.mudarEstado('reconectando')
    m.canal.mudarEstado('conectado')
    await m.relogio.avancar(9999)
    expect(m.prontos()).toBe(1)
  })
})

describe('receptor-parar', () => {
  test('encerrar da sessão atual, fecha, aoVideo(null) e nenhum agendamento sobra', async () => {
    const m = montar()
    const fluxo = await comVideo(m, sessao(4))
    m.receptor.parar()
    await m.relogio.avancar(0)
    expect(m.canal.enviados.at(-1)).toEqual({ tipo: 'encerrar', sessao: sessao(4) })
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
    expect(m.videos).toEqual([fluxo, null])
    expect(m.relogio.pendentes()).toBe(0)
    expect(m.canal.ouvintes()).toBe(0)
    expect(m.conexoes.criadas[0].ouvintes()).toBe(0)
    const enviados = m.canal.enviados.length
    m.canal.mudarEstado('conectado')
    m.receptor.definirEpisodio(true)
    await m.oferta(sessao(5))
    await m.relogio.avancar(60_000)
    expect(m.canal.enviados).toHaveLength(enviados)
    expect(m.conexoes.criadas).toHaveLength(1)
  })

  test('com o ciclo do pronto correndo: nenhum agendamento sobra e nada mais sai', async () => {
    const m = montar()
    await noAr(m)
    expect(m.relogio.pendentes()).toBe(1)
    m.receptor.parar()
    expect(m.relogio.pendentes()).toBe(0)
    await m.relogio.avancar(60_000)
    expect(m.canal.enviados).toEqual([{ tipo: 'pronto', sessao: sessao(101) }])
  })
})

describe('receptor-video-so-conectado', () => {
  test('o fluxo do evento track só vai à tela com a conexão em conectado', async () => {
    const m = montar()
    await noAr(m)
    await m.oferta(sessao(1))
    const fluxo = fluxoDeTeste()
    m.conexoes.ultima()?.mostrarVideo(fluxo)
    await m.relogio.avancar(0)
    expect(m.videos).toEqual([])
    await emitir(m, 'conectando')
    expect(m.videos).toEqual([])
    await emitir(m, 'conectado')
    expect(m.videos).toEqual([fluxo])
    // o mesmo fluxo de novo não repete a entrega
    m.conexoes.ultima()?.mostrarVideo(fluxo)
    await m.relogio.avancar(0)
    expect(m.videos).toEqual([fluxo])
  })

  test('ao sair de conectado (caiu) o vídeo sai da tela, e volta com o conectado', async () => {
    const m = montar()
    const fluxo = await comVideo(m)
    expect(m.videos).toEqual([fluxo])
    await emitir(m, 'caiu')
    expect(m.videos).toEqual([fluxo, null])
    expect(m.conexoes.criadas[0].fechada()).toBe(false)
    await emitir(m, 'conectando')
    expect(m.videos).toEqual([fluxo, null])
    await emitir(m, 'conectado')
    expect(m.videos).toEqual([fluxo, null, fluxo])
    await emitir(m, 'falhou')
    expect(m.videos).toEqual([fluxo, null, fluxo, null])
  })

  test('fluxo novo, diferente, com o antigo na tela: retira o antigo e mostra o novo', async () => {
    const m = montar()
    const antigo = await comVideo(m)
    const novo = fluxoDeTeste()
    m.conexoes.ultima()?.mostrarVideo(novo)
    await m.relogio.avancar(0)
    expect(m.videos).toEqual([antigo, null, novo])
    expect(m.videos[2]).toBe(novo)
  })
})

describe('ouvinte-adiado', () => {
  test('nenhum ouvinte de porta chama outra porta antes do agendar com 0 ms', async () => {
    const m = montar()
    m.canal.mudarEstado('conectado')
    m.receptor.definirEpisodio(true)
    expect(m.prontos()).toBe(0)
    await m.relogio.avancar(0)
    expect(m.prontos()).toBe(1)
    // oferta: nenhuma conexão criada dentro do ouvinte do canal
    m.canal.entregar('sinal', { tipo: 'oferta', sessao: sessao(1), sdp: SDP_DA_OFERTA, remetente: CAMERA, id: ID_DO_SEND })
    expect(m.conexoes.criadas).toHaveLength(0)
    await m.relogio.avancar(0)
    expect(m.conexoes.criadas).toHaveLength(1)
    // vídeo e conectado: nada vai à tela dentro do ouvinte da conexão
    const fluxo = fluxoDeTeste()
    m.conexoes.criadas[0].mostrarVideo(fluxo)
    m.conexoes.criadas[0].emitir('conectado')
    expect(m.videos).toEqual([])
    await m.relogio.avancar(0)
    expect(m.videos).toEqual([fluxo])
    // falhou: a conexão não é fechada e o pronto não sai dentro do ouvinte
    const prontos = m.prontos()
    m.conexoes.criadas[0].emitir('falhou')
    expect(m.conexoes.criadas[0].fechada()).toBe(false)
    expect(m.prontos()).toBe(prontos)
    await m.relogio.avancar(0)
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
    expect(m.prontos()).toBe(prontos + 1)
  })
})

describe('receptor-falha-so-depois-de-responder', () => {
  test('falhou antes de a resposta sair não conta para sem_conexao_direta', async () => {
    const m = montar()
    await noAr(m)
    m.conexoes.config.segurarRespostas = true
    for (const n of [1, 2, 3]) {
      await m.oferta(sessao(n))
      await emitir(m, 'falhou')
    }
    expect(m.respostas()).toHaveLength(0)
    expect(m.situacao()).not.toBe('sem_conexao_direta')
    m.conexoes.soltarRespostas()
    await m.relogio.avancar(0)
    expect(m.respostas()).toHaveLength(0)
  })
})

/** Rejeições soltas durante `f` (Node): o teste falha por conta própria, não só pelo relatório do Vitest (VER-051, rodada 1). */
async function rejeicoesSoltas(f: () => Promise<void>): Promise<unknown[]> {
  type Processo = { on(e: string, h: (r: unknown) => void): void; off(e: string, h: (r: unknown) => void): void }
  const processo = (globalThis as unknown as { process: Processo }).process
  const soltas: unknown[] = []
  const anotar = (r: unknown) => soltas.push(r)
  processo.on('unhandledRejection', anotar)
  try {
    await f()
    await new Promise((r) => setTimeout(r, 0))
  } finally {
    processo.off('unhandledRejection', anotar)
  }
  return soltas
}

describe('receptor-criar-que-lanca', () => {
  // VER-051, rodada 1 (I2): uma fábrica de conexões que lança não deixa rejeição solta; a oferta seguinte é respondida
  test('criar() que lança → nenhuma resposta, nenhuma rejeição solta; a próxima oferta é respondida', async () => {
    const m = montar()
    const original = m.conexoes.fabrica.criar
    let lancou = 0
    m.conexoes.fabrica.criar = () => {
      if (lancou === 0) {
        lancou += 1
        throw new Error('construtor do RTCPeerConnection recusou')
      }
      return original()
    }
    await noAr(m)
    expect(await rejeicoesSoltas(() => m.oferta(sessao(1)))).toEqual([])
    expect(lancou).toBe(1)
    expect(m.respostas()).toHaveLength(0)
    expect(m.situacao()).not.toBe('conectado')
    await m.oferta(sessao(2))
    expect(m.respostas().map((r) => r.sessao)).toEqual([sessao(2)])
  })
})
