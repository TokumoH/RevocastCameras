import { describe, test, expect } from 'vitest'
import type { Gesto } from '../preparacao/gestos'
import { criarFonteFalsa, criarReconhecedoresFalsos, criarRelogioFalso, criarRepoDosGestosFalso } from './falsos'
import { ESPERA_DO_RECONHECEDOR_MS, MS_PARA_PARAR, TEMPO_LENTO_MS, type RespostaDoGesto, type SituacaoDosGestos } from './gestos'
import { criarReconhecimento } from './reconhecimento'

const ATIVO = { ligados: true, reconhecerAqui: true, episodio: true, video: true, visivel: true }
const IDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']

function montar() {
  const relogio = criarRelogioFalso()
  const rec = criarReconhecedoresFalsos(relogio.agendar)
  const fontes = criarFonteFalsa()
  const repo = criarRepoDosGestosFalso()
  const situacoes: SituacaoDosGestos[] = []
  const gestos: { gesto: Gesto; resposta: RespostaDoGesto; em: number }[] = []
  let proximoId = 0
  const r = criarReconhecimento({
    fabrica: rec.fabrica,
    fonte: fontes.fonte,
    repo: repo.repo,
    novoId: () => {
      const id = IDS[proximoId % IDS.length]
      proximoId += 1
      return id
    },
    agora: relogio.agora,
    agendar: relogio.agendar,
    aoMudarSituacao: (s) => situacoes.push(s),
    aoGesto: (g) => gestos.push(g),
  })
  const estado = (): string | undefined => situacoes.at(-1)?.estado
  return { relogio, rec, fontes, repo, situacoes, gestos, r, estado }
}

/** Intervalos entre os inícios de quadro (instantes passados ao `reconhecer`). */
function passos(ems: readonly number[]): number[] {
  return ems.slice(1).map((em, i) => em - ems[i])
}

describe('laco-parado-com-desligados', () => {
  test('ligados: false → nenhum criar; situação desligados', async () => {
    const m = montar()
    m.r.definir({ ...ATIVO, ligados: false })
    await m.relogio.avancar(5000)
    expect(m.rec.criados).toHaveLength(0)
    expect(m.fontes.pedidas()).toBe(0)
    expect(m.situacoes).toEqual([{ estado: 'desligados', quadrosPorSegundo: null, msPorQuadro: null }])
  })

  test('sem episódio → também desligados, nenhum worker', async () => {
    const m = montar()
    m.r.definir({ ...ATIVO, episodio: false })
    await m.relogio.avancar(5000)
    expect(m.rec.criados).toHaveLength(0)
    expect(m.estado()).toBe('desligados')
  })

  test('desligar com o laço rodando → fechar e nenhum quadro depois', async () => {
    const m = montar()
    m.r.definir(ATIVO)
    await m.relogio.avancar(500)
    const quadros = m.rec.ultimo()?.reconhecidos.length ?? 0
    m.r.definir({ ...ATIVO, ligados: false })
    await m.relogio.avancar(5000)
    expect(m.rec.ultimo()?.fechado()).toBe(true)
    expect(m.rec.ultimo()?.reconhecidos.length).toBe(quadros)
    expect(m.fontes.fechadas()).toBe(1)
    expect(m.estado()).toBe('desligados')
  })
})

describe('outro-aparelho', () => {
  test('reconhecerAqui: false → nada; outro_aparelho', async () => {
    const m = montar()
    m.r.definir({ ...ATIVO, reconhecerAqui: false })
    await m.relogio.avancar(5000)
    expect(m.rec.criados).toHaveLength(0)
    expect(m.fontes.pedidas()).toBe(0)
    expect(m.estado()).toBe('outro_aparelho')
  })
})

describe('aguardando-video', () => {
  test('video: false → aguardando_video, nenhum worker', async () => {
    const m = montar()
    m.r.definir({ ...ATIVO, video: false })
    await m.relogio.avancar(5000)
    expect(m.rec.criados).toHaveLength(0)
    expect(m.fontes.pedidas()).toBe(0)
    expect(m.estado()).toBe('aguardando_video')
  })

  test('a fonte sem vídeo (null) → aguardando_video, nenhum worker', async () => {
    const m = montar()
    m.fontes.config.sem = true
    m.r.definir(ATIVO)
    await m.relogio.avancar(5000)
    expect(m.rec.criados).toHaveLength(0)
    expect(m.estado()).toBe('aguardando_video')
  })

  test('quadro null no meio do laço → aguardando_video com o worker vivo; o quadro de volta → reconhecendo', async () => {
    const m = montar()
    m.r.definir(ATIVO)
    await m.relogio.avancar(300)
    expect(m.estado()).toBe('reconhecendo')
    m.fontes.config.quadroNulo = true
    await m.relogio.avancar(300)
    expect(m.estado()).toBe('aguardando_video')
    expect(m.rec.ultimo()?.fechado()).toBe(false)
    m.fontes.config.quadroNulo = false
    await m.relogio.avancar(300)
    expect(m.estado()).toBe('reconhecendo')
    expect(m.rec.criados).toHaveLength(1)
  })
})

describe('carrega-uma-vez', () => {
  test('ligar duas vezes → criar e iniciar uma vez; carregando → reconhecendo', async () => {
    const m = montar()
    m.rec.config.segurarIniciar = true
    m.r.definir(ATIVO)
    m.r.definir({ ...ATIVO })
    await m.relogio.avancar(1000)
    expect(m.rec.criados).toHaveLength(1)
    expect(m.rec.registro.filter((x) => x.startsWith('iniciar'))).toEqual(['iniciar#0'])
    expect(m.estado()).toBe('carregando')
    m.rec.soltarIniciar()
    await m.relogio.avancar(0)
    expect(m.situacoes.map((s) => s.estado)).toEqual(['carregando', 'reconhecendo'])
    m.r.definir(ATIVO)
    await m.relogio.avancar(1000)
    expect(m.rec.criados).toHaveLength(1)
  })

  test('desligar durante o carregamento fecha o worker; o iniciar que chega depois é ignorado', async () => {
    const m = montar()
    m.rec.config.segurarIniciar = true
    m.r.definir(ATIVO)
    await m.relogio.avancar(100)
    m.r.definir({ ...ATIVO, ligados: false })
    m.rec.soltarIniciar()
    await m.relogio.avancar(1000)
    expect(m.rec.ultimo()?.fechado()).toBe(true)
    expect(m.rec.ultimo()?.reconhecidos).toEqual([])
    expect(m.estado()).toBe('desligados')
  })
})

describe('laco-um-quadro-por-vez', () => {
  test('com o reconhecer pendurado, avançar 1 s não pede outro quadro', async () => {
    const m = montar()
    m.rec.config.segurarReconhecer = true
    m.r.definir(ATIVO)
    await m.relogio.avancar(1000)
    expect(m.fontes.quadrosPedidos()).toBe(1)
    expect(m.rec.ultimo()?.reconhecidos).toHaveLength(1)
  })
})

describe('laco-10-por-segundo', () => {
  test('respostas de 20 ms → um quadro a cada 100 ms; situação com 10 quadros/s', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 20
    m.r.definir(ATIVO)
    await m.relogio.avancar(2000)
    const ems = m.rec.ultimo()?.reconhecidos ?? []
    expect(ems.length).toBeGreaterThanOrEqual(20)
    expect(new Set(passos(ems))).toEqual(new Set([100]))
    expect(m.situacoes.at(-1)).toEqual({ estado: 'reconhecendo', quadrosPorSegundo: 10, msPorQuadro: 20 })
  })
})

describe('laco-reduz-para-5', () => {
  test('média de 130 ms → um quadro a cada 200 ms; situação com quadrosPorSegundo: 5', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 130
    m.r.definir(ATIVO)
    await m.relogio.avancar(3000)
    const ems = m.rec.ultimo()?.reconhecidos ?? []
    expect(ems.length).toBeGreaterThanOrEqual(10)
    expect(new Set(passos(ems))).toEqual(new Set([200]))
    expect(m.situacoes.at(-1)).toEqual({ estado: 'reconhecendo', quadrosPorSegundo: 5, msPorQuadro: 130 })
  })

  test('a média volta para baixo de 120 ms → volta a 10 quadros/s', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 130
    m.r.definir(ATIVO)
    await m.relogio.avancar(1000)
    m.rec.config.msPorQuadro = 20
    await m.relogio.avancar(10_000)
    const ems = m.rec.ultimo()?.reconhecidos ?? []
    expect(passos(ems).slice(-5)).toEqual([100, 100, 100, 100, 100])
    expect(m.situacoes.at(-1)?.quadrosPorSegundo).toBe(10)
  })
})

describe('laco-para-quando-lento', () => {
  test('média de 450 ms por 10 000 ms → fechar, situação lento, nenhum quadro depois; tentarDeNovo recomeça uma vez', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 450
    expect(450).toBeGreaterThan(MS_PARA_PARAR)
    m.r.definir(ATIVO)
    await m.relogio.avancar(TEMPO_LENTO_MS)
    expect(m.rec.ultimo()?.fechado()).toBe(false)
    expect(m.estado()).toBe('reconhecendo')
    await m.relogio.avancar(1000)
    expect(m.rec.ultimo()?.fechado()).toBe(true)
    expect(m.situacoes.at(-1)).toEqual({ estado: 'lento', quadrosPorSegundo: null, msPorQuadro: null })
    const quadros = m.rec.ultimo()?.reconhecidos.length
    await m.relogio.avancar(30_000)
    expect(m.rec.ultimo()?.reconhecidos.length).toBe(quadros)
    expect(m.rec.criados).toHaveLength(1)
    // nunca sozinho: a mesma definir não recomeça
    m.r.definir(ATIVO)
    await m.relogio.avancar(1000)
    expect(m.rec.criados).toHaveLength(1)
    expect(m.estado()).toBe('lento')
    m.r.tentarDeNovo()
    m.r.tentarDeNovo()
    await m.relogio.avancar(100)
    expect(m.rec.criados).toHaveLength(2)
    expect(m.estado()).toBe('reconhecendo')
  })

  test('uma média alta por menos de 10 s, que depois baixa, não para', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 450
    m.r.definir(ATIVO)
    await m.relogio.avancar(5000)
    m.rec.config.msPorQuadro = 20
    await m.relogio.avancar(20_000)
    expect(m.rec.ultimo()?.fechado()).toBe(false)
    expect(m.estado()).toBe('reconhecendo')
  })
})

describe('gesto-confirmado-vai-ao-repo', () => {
  test('leituras de Victory por 1 s → repo.enviar({ id: <novoId>, gesto: Victory }) uma vez e aoGesto com a resposta', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 20
    m.rec.config.gesto = 'Victory'
    m.r.definir(ATIVO)
    await m.relogio.avancar(990)
    expect(m.repo.enviados).toEqual([])
    await m.relogio.avancar(5000)
    expect(m.repo.enviados).toEqual([{ id: IDS[0], gesto: 'Victory' }])
    expect(m.gestos).toEqual([{ gesto: 'Victory', resposta: 'enviado', em: 1000 }])
  })

  test('a leitura com confiança baixa não confirma', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 20
    m.rec.config.gesto = 'Victory'
    m.rec.config.confianca = 0.69
    m.r.definir(ATIVO)
    await m.relogio.avancar(5000)
    expect(m.repo.enviados).toEqual([])
  })

  test('uma leitura fora dos 7 gestos (None, vinda de um worker que não traduziu) não confirma', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 20
    m.rec.config.gesto = 'None' as Gesto
    m.rec.config.confianca = 0.99
    m.r.definir(ATIVO)
    await m.relogio.avancar(5000)
    expect(m.repo.enviados).toEqual([])
  })

  test.each<RespostaDoGesto>(['intervalo', 'sem_palco', 'limite', 'falhou'])('resposta %s → chega ao aoGesto e o laço continua', async (resposta) => {
    const m = montar()
    m.rec.config.msPorQuadro = 20
    m.rec.config.gesto = 'Victory'
    m.repo.responderCom(async () => resposta)
    m.r.definir(ATIVO)
    await m.relogio.avancar(1500)
    const quadros = m.rec.ultimo()?.reconhecidos.length ?? 0
    await m.relogio.avancar(1000)
    expect(m.gestos).toEqual([{ gesto: 'Victory', resposta, em: 1000 }])
    expect(m.rec.ultimo()?.fechado()).toBe(false)
    expect(m.rec.ultimo()?.reconhecidos.length).toBeGreaterThan(quadros)
  })
})

describe('resposta-do-repo-nao-trava', () => {
  test('enviar rejeitado → falhou no aoGesto, o laço continua', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 20
    m.rec.config.gesto = 'Victory'
    m.repo.responderCom(async () => {
      throw new Error('rede')
    })
    m.r.definir(ATIVO)
    await m.relogio.avancar(1500)
    const quadros = m.rec.ultimo()?.reconhecidos.length ?? 0
    await m.relogio.avancar(1000)
    expect(m.gestos).toEqual([{ gesto: 'Victory', resposta: 'falhou', em: 1000 }])
    expect(m.rec.ultimo()?.reconhecidos.length).toBeGreaterThan(quadros)
    expect(m.estado()).toBe('reconhecendo')
  })

  test('enviar pendurado não segura o laço', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 20
    m.rec.config.gesto = 'Victory'
    m.repo.responderCom(() => new Promise<RespostaDoGesto>(() => {}))
    m.r.definir(ATIVO)
    await m.relogio.avancar(1500)
    const quadros = m.rec.ultimo()?.reconhecidos.length ?? 0
    await m.relogio.avancar(1000)
    expect(m.rec.ultimo()?.reconhecidos.length).toBeGreaterThan(quadros)
    expect(m.gestos).toEqual([])
  })
})

describe.each<RespostaDoGesto>(['desligados', 'negado'])('%s-reavalia', (resposta) => {
  test(`enviar → ${resposta}: o laço para (fechar), situação desligados até a próxima definir, e aoGesto leva a resposta`, async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 20
    m.rec.config.gesto = 'Victory'
    m.repo.responderCom(async () => resposta)
    m.r.definir(ATIVO)
    await m.relogio.avancar(1100)
    expect(m.gestos).toEqual([{ gesto: 'Victory', resposta, em: 1000 }])
    expect(m.rec.ultimo()?.fechado()).toBe(true)
    expect(m.fontes.fechadas()).toBe(1)
    expect(m.estado()).toBe('desligados')
    const quadros = m.rec.ultimo()?.reconhecidos.length
    await m.relogio.avancar(30_000)
    expect(m.rec.ultimo()?.reconhecidos.length).toBe(quadros)
    expect(m.rec.criados).toHaveLength(1)
    // a rota chama reavaliar(); a situação nova chega por definir
    m.r.definir(ATIVO)
    await m.relogio.avancar(100)
    expect(m.rec.criados).toHaveLength(2)
    expect(m.estado()).toBe('reconhecendo')
  })
})

describe('falha-do-iniciar', () => {
  test('sem_suporte → situação sem_suporte, sem nova tentativa sozinho', async () => {
    const m = montar()
    m.rec.config.iniciar = 'sem_suporte'
    m.r.definir(ATIVO)
    await m.relogio.avancar(100)
    expect(m.estado()).toBe('sem_suporte')
    expect(m.rec.ultimo()?.fechado()).toBe(true)
    expect(m.fontes.fechadas()).toBe(1)
    m.r.definir(ATIVO)
    await m.relogio.avancar(120_000)
    expect(m.rec.criados).toHaveLength(1)
    expect(m.estado()).toBe('sem_suporte')
    m.r.tentarDeNovo()
    await m.relogio.avancar(100)
    expect(m.rec.criados).toHaveLength(2)
  })

  test.each<['integridade' | 'tempo' | 'outro' | 'rejeitar']>([['integridade'], ['tempo'], ['outro'], ['rejeitar']])('%s → falhou', async (iniciar) => {
    const m = montar()
    m.rec.config.iniciar = iniciar
    m.r.definir(ATIVO)
    await m.relogio.avancar(100)
    expect(m.estado()).toBe('falhou')
    expect(m.rec.ultimo()?.fechado()).toBe(true)
    await m.relogio.avancar(120_000)
    expect(m.rec.criados).toHaveLength(1)
  })

  test('a fábrica que lança → falhou, sem rejeição solta', async () => {
    const m = montar()
    m.rec.config.criarLanca = true
    m.r.definir(ATIVO)
    await m.relogio.avancar(100)
    expect(m.estado()).toBe('falhou')
    expect(m.fontes.fechadas()).toBe(1)
  })

  test('iniciar sem resposta por ESPERA_DO_RECONHECEDOR_MS → falhou e fechar', async () => {
    const m = montar()
    m.rec.config.segurarIniciar = true
    m.r.definir(ATIVO)
    await m.relogio.avancar(ESPERA_DO_RECONHECEDOR_MS - 1)
    expect(m.estado()).toBe('carregando')
    await m.relogio.avancar(1)
    expect(m.estado()).toBe('falhou')
    expect(m.rec.ultimo()?.fechado()).toBe(true)
    m.rec.soltarIniciar()
    await m.relogio.avancar(1000)
    expect(m.estado()).toBe('falhou')
    expect(m.rec.ultimo()?.reconhecidos).toEqual([])
  })

  test('desligar e ligar de novo os gestos (um evento novo) tenta outra vez', async () => {
    const m = montar()
    m.rec.config.iniciar = 'sem_suporte'
    m.r.definir(ATIVO)
    await m.relogio.avancar(100)
    m.rec.config.iniciar = 'ok'
    m.r.definir({ ...ATIVO, ligados: false })
    m.r.definir(ATIVO)
    await m.relogio.avancar(100)
    expect(m.rec.criados).toHaveLength(2)
    expect(m.estado()).toBe('reconhecendo')
  })
})

describe('pagina-escondida-para', () => {
  test('visivel: false → fechar, sem quadros; visível de novo → worker novo', async () => {
    const m = montar()
    m.r.definir(ATIVO)
    await m.relogio.avancar(500)
    m.r.definir({ ...ATIVO, visivel: false })
    const quadros = m.rec.ultimo()?.reconhecidos.length
    await m.relogio.avancar(5000)
    expect(m.rec.ultimo()?.fechado()).toBe(true)
    expect(m.rec.ultimo()?.reconhecidos.length).toBe(quadros)
    expect(m.fontes.fechadas()).toBe(1)
    expect(m.estado()).toBe('aguardando_video')
    m.r.definir(ATIVO)
    await m.relogio.avancar(500)
    expect(m.rec.criados).toHaveLength(2)
    expect(m.estado()).toBe('reconhecendo')
  })
})

describe('laco-parar-nao-deixa-agendamento', () => {
  test('parar → fechar e, avançando 60 s, nada mais é chamado', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 20
    m.rec.config.gesto = 'Victory'
    m.r.definir(ATIVO)
    await m.relogio.avancar(950)
    m.r.parar()
    const quadros = m.rec.ultimo()?.reconhecidos.length
    const situacoes = m.situacoes.length
    await m.relogio.avancar(60_000)
    expect(m.rec.ultimo()?.fechado()).toBe(true)
    expect(m.fontes.fechadas()).toBe(1)
    expect(m.rec.ultimo()?.reconhecidos.length).toBe(quadros)
    expect(m.situacoes.length).toBe(situacoes)
    expect(m.repo.enviados).toEqual([])
    expect(m.gestos).toEqual([])
    expect(m.relogio.pendentes()).toBe(0)
    m.r.definir(ATIVO)
    m.r.tentarDeNovo()
    await m.relogio.avancar(1000)
    expect(m.rec.criados).toHaveLength(1)
  })

  test('parar durante o carregamento: o iniciar que chega depois não liga nada', async () => {
    const m = montar()
    m.rec.config.segurarIniciar = true
    m.r.definir(ATIVO)
    await m.relogio.avancar(100)
    m.r.parar()
    m.rec.soltarIniciar()
    await m.relogio.avancar(60_000)
    expect(m.rec.ultimo()?.fechado()).toBe(true)
    expect(m.rec.ultimo()?.reconhecidos).toEqual([])
    expect(m.relogio.pendentes()).toBe(0)
  })

  test('a resposta do repo que chega depois de parar não chama aoGesto', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 20
    m.rec.config.gesto = 'Victory'
    let soltar: (r: RespostaDoGesto) => void = () => {}
    m.repo.responderCom(() => new Promise<RespostaDoGesto>((r) => (soltar = r)))
    m.r.definir(ATIVO)
    await m.relogio.avancar(1100)
    expect(m.repo.enviados).toHaveLength(1)
    m.r.parar()
    soltar('enviado')
    await m.relogio.avancar(1000)
    expect(m.gestos).toEqual([])
  })
})

describe('rodada 1 da revisão (VER-058)', () => {
  test('punho mantido com uma piscada do vídeo → uma confirmação só (I1: zerar não conta como soltar)', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 20
    m.rec.config.gesto = 'Closed_Fist'
    m.r.definir(ATIVO)
    await m.relogio.avancar(1500)
    m.r.definir({ ...ATIVO, video: false })
    m.r.definir(ATIVO)
    await m.relogio.avancar(10_000)
    expect(m.rec.criados).toHaveLength(2)
    expect(m.gestos).toEqual([{ gesto: 'Closed_Fist', resposta: 'enviado', em: 1000 }])
  })

  test('reinício do laço zera a contagem (Si): Victory desde 0, piscada em 500 → confirma em 1500, não em 1000', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 20
    m.rec.config.gesto = 'Victory'
    m.r.definir(ATIVO)
    await m.relogio.avancar(450)
    m.r.definir({ ...ATIVO, video: false })
    await m.relogio.avancar(50)
    m.r.definir(ATIVO)
    await m.relogio.avancar(3000)
    expect(m.gestos).toEqual([{ gesto: 'Victory', resposta: 'enviado', em: 1500 }])
  })

  test('leitura null do worker não para o agendamento (Sg): o laço segue no período e depois confirma', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 20
    m.rec.config.leituraNula = true
    m.r.definir(ATIVO)
    await m.relogio.avancar(1000)
    const ems = m.rec.ultimo()?.reconhecidos ?? []
    expect(ems.length).toBeGreaterThanOrEqual(10)
    expect(new Set(passos(ems))).toEqual(new Set([100]))
    expect(m.estado()).toBe('reconhecendo')
    m.rec.config.leituraNula = false
    m.rec.config.gesto = 'Victory'
    await m.relogio.avancar(2000)
    expect(m.gestos).toHaveLength(1)
  })

  test('o período passado ao confirmador acompanha a taxa (Sf): a 5 quadros/s, um quadro sem gesto no meio ainda confirma em 1000', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 130
    m.rec.config.gesto = 'Victory'
    m.rec.config.gestoNoQuadro = (em) => (em === 400 ? null : 'Victory')
    m.r.definir(ATIVO)
    await m.relogio.avancar(3000)
    expect(m.rec.ultimo()?.reconhecidos.slice(0, 6)).toEqual([0, 200, 400, 600, 800, 1000])
    expect(m.gestos[0]).toEqual({ gesto: 'Victory', resposta: 'enviado', em: 1000 })
  })

  test('quadro que chega depois de parar não vai ao worker (Sb)', async () => {
    const m = montar()
    m.fontes.config.segurarQuadro = true
    m.r.definir(ATIVO)
    await m.relogio.avancar(100)
    expect(m.fontes.quadrosPedidos()).toBe(1)
    m.r.parar()
    m.fontes.soltarQuadros()
    await m.relogio.avancar(1000)
    expect(m.rec.ultimo()?.reconhecidos).toEqual([])
  })

  test('quadro que chega depois de definir desligados também não vai ao worker (Sb)', async () => {
    const m = montar()
    m.fontes.config.segurarQuadro = true
    m.r.definir(ATIVO)
    await m.relogio.avancar(100)
    m.r.definir({ ...ATIVO, ligados: false })
    m.fontes.soltarQuadros()
    await m.relogio.avancar(1000)
    expect(m.rec.ultimo()?.reconhecidos).toEqual([])
  })

  test.each<['parar' | 'desligar']>([['parar'], ['desligar']])(
    '%s de dentro do aoMudarSituacao(carregando) → o reconhecedor fechado nunca recebe iniciar (N1)',
    async (como) => {
      const relogio = criarRelogioFalso()
      const rec = criarReconhecedoresFalsos(relogio.agendar)
      const fontes = criarFonteFalsa()
      const repo = criarRepoDosGestosFalso()
      const alca: { r: ReturnType<typeof criarReconhecimento> | null } = { r: null }
      alca.r = criarReconhecimento({
        fabrica: rec.fabrica,
        fonte: fontes.fonte,
        repo: repo.repo,
        novoId: () => IDS[0],
        agora: relogio.agora,
        agendar: relogio.agendar,
        aoMudarSituacao: (s) => {
          if (s.estado !== 'carregando') return
          if (como === 'parar') alca.r?.parar()
          else alca.r?.definir({ ...ATIVO, ligados: false })
        },
        aoGesto: () => {},
      })
      alca.r.definir(ATIVO)
      await relogio.avancar(70_000)
      expect(rec.registro).toEqual(['criar#0', 'fechar#0'])
      expect(fontes.fechadas()).toBe(1)
      expect(relogio.pendentes()).toBe(0)
    },
  )

  test('o bloqueio vem antes do vídeo (Sh): lento continua lento com video: false e com a página escondida', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 450
    m.r.definir(ATIVO)
    await m.relogio.avancar(11_000)
    expect(m.estado()).toBe('lento')
    m.r.definir({ ...ATIVO, video: false })
    expect(m.estado()).toBe('lento')
    m.r.definir({ ...ATIVO, visivel: false })
    expect(m.estado()).toBe('lento')
  })

  test('a situação não se repete (Sm): definir igual várias vezes publica uma vez só', async () => {
    const m = montar()
    m.r.definir({ ...ATIVO, ligados: false })
    m.r.definir({ ...ATIVO, ligados: false })
    m.r.definir({ ...ATIVO, episodio: false })
    m.r.definir({ ...ATIVO, video: false })
    m.r.definir({ ...ATIVO, video: false, visivel: false })
    await m.relogio.avancar(1000)
    expect(m.situacoes.map((s) => s.estado)).toEqual(['desligados', 'aguardando_video'])
  })

  test('tempo por quadro = max(ms do worker, ida e volta) (Sj): o worker diz 300 ms e responde em 20 → 5 quadros/s', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 20
    m.rec.config.msDoWorker = 300
    m.r.definir(ATIVO)
    await m.relogio.avancar(2000)
    expect(m.situacoes.at(-1)).toEqual({ estado: 'reconhecendo', quadrosPorSegundo: 5, msPorQuadro: 300 })
  })

  test('tempo por quadro = max(ms do worker, ida e volta) (Sj): o worker diz 0 ms e responde em 130 → 5 quadros/s', async () => {
    const m = montar()
    m.rec.config.msPorQuadro = 130
    m.rec.config.msDoWorker = 0
    m.r.definir(ATIVO)
    await m.relogio.avancar(2000)
    expect(m.situacoes.at(-1)).toEqual({ estado: 'reconhecendo', quadrosPorSegundo: 5, msPorQuadro: 130 })
  })
})
