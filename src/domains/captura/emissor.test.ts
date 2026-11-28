import { describe, test, expect } from 'vitest'
import { criarEmissorDeVideo } from './emissor'
import { SDP_DA_OFERTA, SDP_DA_RESPOSTA, criarCameraFalsa, criarCanalFalso, criarConexoesFalsas, criarRelogioFalso } from './falsos'
import type { FalhaDaCamera } from './portas'
import { lerSinalDaObs, type EstadoDoVideo, type SinalDaCamera, type SinalDaObs } from './sinais'

const PAR = 'c0ffee00-1111-4111-8111-11111111abcd'
const OUTRO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const ID_DO_SEND = 'dddddddd-0000-4000-8000-000000000001'

/** Sessão de vídeo n (uuid minúsculo de teste). */
const sessao = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

/** SDP válido de teste com exatamente `n` caracteres. */
function sdpDe(n: number): string {
  const base = 'v=0\r\na='
  return base + 'x'.repeat(n - base.length - 2) + '\r\n'
}

function montar() {
  const relogio = criarRelogioFalso()
  const canal = criarCanalFalso<SinalDaCamera, SinalDaObs>(lerSinalDaObs)
  const conexoes = criarConexoesFalsas()
  const camera = criarCameraFalsa()
  const situacoes: EstadoDoVideo[] = []
  const revogados = new Set<string>()
  let n = 0
  const emissor = criarEmissorDeVideo({
    canal: canal.canal,
    conexoes: conexoes.fabrica,
    camera: camera.camera,
    revogado: (u) => revogados.has(u),
    novaSessao: () => sessao(++n),
    agendar: relogio.agendar,
    aoMudarSituacao: (e) => situacoes.push(e),
  })
  const ofertas = () => canal.enviados.filter((s): s is Extract<SinalDaCamera, { tipo: 'oferta' }> => s.tipo === 'oferta')
  return {
    relogio,
    canal,
    conexoes,
    camera,
    situacoes,
    revogados,
    emissor,
    ofertas,
    situacao: () => situacoes.at(-1),
    ultimaSessao: () => ofertas().at(-1)?.sessao ?? '',
    /** O obs_camera manda um sinal (pelo leitor real). */
    async sinal(s: Record<string, unknown>, remetente = PAR): Promise<void> {
      canal.entregar('sinal', { ...s, remetente, id: ID_DO_SEND })
      await relogio.avancar(0)
    },
  }
}

type Montado = ReturnType<typeof montar>

/** Canal conectado, episódio ativo e o toque: a primeira oferta sai. */
async function noAr(m: Montado): Promise<void> {
  m.canal.mudarEstado('conectado')
  m.emissor.definirEpisodio(true)
  await m.relogio.avancar(0)
  await m.emissor.ligarPeloToque()
  await m.relogio.avancar(0)
}

async function responder(m: Montado, remetente = PAR): Promise<void> {
  await m.sinal({ tipo: 'resposta', sessao: m.ultimaSessao(), sdp: SDP_DA_RESPOSTA }, remetente)
}

async function emitir(m: Montado, e: 'conectando' | 'conectado' | 'caiu' | 'falhou'): Promise<void> {
  m.conexoes.ultima()?.emitir(e)
  await m.relogio.avancar(0)
}

/** Vídeo conectado: oferta, resposta aceita e a conexão em `conectado`. */
async function conectado(m: Montado): Promise<void> {
  await noAr(m)
  await responder(m)
  await emitir(m, 'conectado')
}

describe('emissor-so-liga-depois-do-toque', () => {
  test('com episódio ativo e canal conectado, a câmera só liga depois do toque', async () => {
    const m = montar()
    expect(m.situacao()).toBe('aguardando_toque')
    m.canal.mudarEstado('conectado')
    m.emissor.definirEpisodio(true)
    await m.relogio.avancar(60_000)
    expect(m.camera.estado.ligacoes).toBe(0)
    expect(m.canal.enviados).toEqual([])
    expect(m.situacao()).toBe('aguardando_toque')
    await m.emissor.ligarPeloToque()
    await m.relogio.avancar(0)
    expect(m.camera.estado.ligacoes).toBe(1)
    expect(m.ofertas()).toHaveLength(1)
    expect(m.situacao()).toBe('conectando')
  })

  test('toque sem episódio: não liga a câmera e espera o episódio', async () => {
    const m = montar()
    m.canal.mudarEstado('conectado')
    await m.emissor.ligarPeloToque()
    await m.relogio.avancar(0)
    expect(m.camera.estado.ligacoes).toBe(0)
    expect(m.situacao()).toBe('aguardando_episodio')
    m.emissor.definirEpisodio(true)
    await m.relogio.avancar(0)
    expect(m.camera.estado.ligacoes).toBe(1)
    expect(m.ofertas()).toHaveLength(1)
  })
})

describe('emissor-desliga-sem-episodio', () => {
  test('sem episódio: encerrar, fecha a conexão e desliga a câmera; com episódio de novo, liga sozinho e oferece', async () => {
    const m = montar()
    await conectado(m)
    const primeira = m.ultimaSessao()
    m.emissor.definirEpisodio(false)
    await m.relogio.avancar(0)
    expect(m.canal.enviados.at(-1)).toEqual({ tipo: 'encerrar', sessao: primeira })
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
    expect(m.camera.estado.desligadas).toBe(1)
    expect(m.situacao()).toBe('aguardando_episodio')
    await m.relogio.avancar(60_000)
    expect(m.ofertas()).toHaveLength(1)
    m.emissor.definirEpisodio(true)
    await m.relogio.avancar(0)
    expect(m.camera.estado.ligacoes).toBe(2)
    expect(m.ofertas()).toHaveLength(2)
    expect(m.ultimaSessao()).not.toBe(primeira)
  })

  test('definirEpisodio repetido com o mesmo valor não faz nada', async () => {
    const m = montar()
    await conectado(m)
    m.emissor.definirEpisodio(true)
    m.emissor.definirEpisodio(true)
    await m.relogio.avancar(0)
    expect(m.camera.estado.ligacoes).toBe(1)
    expect(m.ofertas()).toHaveLength(1)
    m.emissor.definirEpisodio(false)
    m.emissor.definirEpisodio(false)
    await m.relogio.avancar(0)
    expect(m.canal.enviados.filter((s) => s.tipo === 'encerrar')).toHaveLength(1)
    expect(m.camera.estado.desligadas).toBe(1)
  })
})

describe('emissor-oferece', () => {
  test('sessão nova por oferta; a oferta leva o SDP da conexão e a faixa da câmera', async () => {
    const m = montar()
    await noAr(m)
    expect(m.ofertas()).toEqual([{ tipo: 'oferta', sessao: sessao(1), sdp: SDP_DA_OFERTA }])
    expect(m.conexoes.criadas[0].ofertas).toEqual([m.camera.faixas[0]])
    await emitir(m, 'falhou')
    await m.relogio.avancar(2000)
    expect(m.ofertas().map((o) => o.sessao)).toEqual([sessao(1), sessao(2)])
    expect(m.conexoes.criadas).toHaveLength(2)
  })
})

describe('emissor-oferece-ao-pronto', () => {
  test('um pronto sem sessão pendente → oferta nova; dois pronto em seguida → uma oferta só', async () => {
    const m = montar()
    await conectado(m)
    await m.sinal({ tipo: 'encerrar', sessao: m.ultimaSessao() })
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
    await m.relogio.avancar(60_000)
    expect(m.ofertas()).toHaveLength(1)
    await m.sinal({ tipo: 'pronto', sessao: sessao(90) })
    expect(m.ofertas()).toHaveLength(2)
    m.canal.entregar('sinal', { tipo: 'pronto', sessao: sessao(91), remetente: PAR, id: ID_DO_SEND })
    m.canal.entregar('sinal', { tipo: 'pronto', sessao: sessao(92), remetente: PAR, id: ID_DO_SEND })
    await m.relogio.avancar(0)
    expect(m.ofertas()).toHaveLength(2)
  })

  test('dois pronto entregues juntos, sem sessão pendente → uma oferta só', async () => {
    const m = montar()
    await conectado(m)
    await m.sinal({ tipo: 'encerrar', sessao: m.ultimaSessao() })
    m.canal.entregar('sinal', { tipo: 'pronto', sessao: sessao(91), remetente: PAR, id: ID_DO_SEND })
    m.canal.entregar('sinal', { tipo: 'pronto', sessao: sessao(92), remetente: PAR, id: ID_DO_SEND })
    await m.relogio.avancar(0)
    expect(m.ofertas()).toHaveLength(2)
  })
})

describe('emissor-pronto-respeita-a-espera', () => {
  test('pronto com oferta aguardando resposta → nada, e a conexão não é fechada', async () => {
    const m = montar()
    await noAr(m)
    await m.sinal({ tipo: 'pronto', sessao: sessao(90) })
    expect(m.ofertas()).toHaveLength(1)
    expect(m.conexoes.criadas[0].fechada()).toBe(false)
  })

  test('pronto com a conexão em conectando → nada', async () => {
    const m = montar()
    await noAr(m)
    await responder(m)
    await emitir(m, 'conectando')
    await m.sinal({ tipo: 'pronto', sessao: sessao(90) })
    expect(m.ofertas()).toHaveLength(1)
    expect(m.conexoes.criadas[0].fechada()).toBe(false)
  })

  test('pronto com a conexão conectado → nada', async () => {
    const m = montar()
    await conectado(m)
    await m.sinal({ tipo: 'pronto', sessao: sessao(90) })
    expect(m.ofertas()).toHaveLength(1)
    expect(m.conexoes.criadas[0].fechada()).toBe(false)
  })

  test('pronto durante a espera crescente → nada até o fim dela, e uma oferta só no fim, mesmo com três pronto', async () => {
    const m = montar()
    await noAr(m)
    await emitir(m, 'falhou')
    for (const t of [500, 500, 500]) {
      await m.relogio.avancar(t)
      await m.sinal({ tipo: 'pronto', sessao: sessao(90 + t) })
    }
    await m.relogio.avancar(499)
    expect(m.ofertas()).toHaveLength(1)
    await m.relogio.avancar(1)
    expect(m.ofertas()).toHaveLength(2)
    await m.relogio.avancar(1000)
    expect(m.ofertas()).toHaveLength(2)
  })
})

describe('emissor-sdp-grande', () => {
  test.each<[string, string]>([
    ['12 001 caracteres', sdpDe(12_001)],
    ['sem v=0\\r\\n', 'v=0\no=- 1 2 IN IP4 192.0.2.1\r\n'],
  ])('SDP próprio com %s → nada enviado, sinal_grande, conexão fechada, sem nova tentativa sozinha', async (_nome, sdp) => {
    const m = montar()
    m.conexoes.config.sdpDaOferta = sdp
    await noAr(m)
    expect(m.canal.enviados).toEqual([])
    expect(m.situacao()).toBe('sinal_grande')
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
    // nada vai sair: a câmera desliga (consumo, luz acesa à toa)
    expect(m.camera.registro).toEqual(['ligar#0', 'faixa#0', 'desligar'])
    await m.sinal({ tipo: 'pronto', sessao: sessao(90) })
    m.canal.mudarEstado('reconectando')
    m.canal.mudarEstado('conectado')
    await m.relogio.avancar(600_000)
    expect(m.conexoes.criadas).toHaveLength(1)
    expect(m.canal.enviados).toEqual([])
    expect(m.camera.estado.ligacoes).toBe(1)
    await m.emissor.ligarPeloToque()
    await m.relogio.avancar(0)
    expect(m.camera.estado.ligacoes).toBe(2)
    expect(m.conexoes.criadas).toHaveLength(2)
    expect(m.conexoes.criadas[1].ofertas).toEqual([m.camera.faixas[1]])
    expect(m.canal.enviados).toEqual([])
    expect(m.camera.estado.desligadas).toBe(2)
    await m.relogio.avancar(600_000)
    expect(m.conexoes.criadas).toHaveLength(2)
  })

  test('um novo episódio também tenta de novo uma vez', async () => {
    const m = montar()
    m.conexoes.config.sdpDaOferta = sdpDe(12_001)
    await noAr(m)
    m.conexoes.config.sdpDaOferta = SDP_DA_OFERTA
    m.emissor.definirEpisodio(false)
    m.emissor.definirEpisodio(true)
    await m.relogio.avancar(0)
    expect(m.ofertas()).toHaveLength(1)
    expect(m.situacao()).toBe('conectando')
  })
})

describe('emissor-sem-par', () => {
  test('sem_par → aguardando_par e nova tentativa pela espera crescente', async () => {
    const m = montar()
    m.canal.responderCom(() => 'sem_par')
    await noAr(m)
    expect(m.situacao()).toBe('aguardando_par')
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
    await m.relogio.avancar(1999)
    expect(m.ofertas()).toHaveLength(1)
    await m.relogio.avancar(1)
    expect(m.ofertas()).toHaveLength(2)
    await m.relogio.avancar(3999)
    expect(m.ofertas()).toHaveLength(2)
    await m.relogio.avancar(1)
    expect(m.ofertas()).toHaveLength(3)
  })
})

describe('emissor-limite', () => {
  test('limite → nenhuma oferta antes da próxima espera crescente, que avança como numa falha', async () => {
    const m = montar()
    m.canal.responderCom(() => 'limite')
    await noAr(m)
    await m.sinal({ tipo: 'pronto', sessao: sessao(90) })
    await m.relogio.avancar(1999)
    expect(m.ofertas()).toHaveLength(1)
    await m.relogio.avancar(1)
    expect(m.ofertas()).toHaveLength(2)
    await m.relogio.avancar(3999)
    expect(m.ofertas()).toHaveLength(2)
    await m.relogio.avancar(1)
    expect(m.ofertas()).toHaveLength(3)
  })

  test('limite não conta para sem_conexao_direta', async () => {
    const m = montar()
    m.canal.responderCom(() => 'limite')
    await noAr(m)
    m.canal.responderCom(() => 'ok')
    await m.relogio.avancar(2000)
    await responder(m)
    await emitir(m, 'falhou')
    expect(m.situacao()).not.toBe('sem_conexao_direta')
  })
})

describe('emissor-primeira-resposta-vale', () => {
  test('duas respostas da mesma sessão → aceitarResposta uma vez; resposta de sessão antiga → ignorada', async () => {
    const m = montar()
    await noAr(m)
    const antiga = m.ultimaSessao()
    await responder(m)
    await responder(m)
    expect(m.conexoes.criadas[0].respostasAceitas).toEqual([SDP_DA_RESPOSTA])
    await emitir(m, 'falhou')
    await m.relogio.avancar(2000)
    expect(m.ofertas()).toHaveLength(2)
    await m.sinal({ tipo: 'resposta', sessao: antiga, sdp: SDP_DA_RESPOSTA })
    expect(m.conexoes.criadas[1].respostasAceitas).toEqual([])
    await responder(m)
    expect(m.conexoes.criadas[1].respostasAceitas).toEqual([SDP_DA_RESPOSTA])
  })
})

describe('emissor-descarta-revogado', () => {
  test('resposta de remetente revogado → ignorada', async () => {
    const m = montar()
    m.revogados.add(PAR)
    await noAr(m)
    await responder(m)
    expect(m.conexoes.criadas[0].respostasAceitas).toEqual([])
    await responder(m, OUTRO)
    expect(m.conexoes.criadas[0].respostasAceitas).toEqual([SDP_DA_RESPOSTA])
  })

  test('pronto e encerrar de remetente revogado → ignorados', async () => {
    const m = montar()
    await conectado(m)
    m.revogados.add(PAR)
    await m.sinal({ tipo: 'encerrar', sessao: m.ultimaSessao() })
    expect(m.conexoes.criadas[0].fechada()).toBe(false)
    m.revogados.delete(PAR)
    await m.sinal({ tipo: 'encerrar', sessao: m.ultimaSessao() })
    m.revogados.add(PAR)
    await m.sinal({ tipo: 'pronto', sessao: sessao(90) })
    expect(m.ofertas()).toHaveLength(1)
  })
})

describe('emissor-ignora-oferta', () => {
  test('uma oferta entregue pelo caminho do leitor real não chega ao emissor', async () => {
    const m = montar()
    await noAr(m)
    const antes = m.canal.enviados.length
    expect(m.canal.entregar('sinal', { tipo: 'oferta', sessao: m.ultimaSessao(), sdp: SDP_DA_OFERTA, remetente: PAR, id: ID_DO_SEND })).toBe(false)
    await m.relogio.avancar(0)
    expect(m.conexoes.criadas).toHaveLength(1)
    expect(m.conexoes.criadas[0].respostasAceitas).toEqual([])
    expect(m.conexoes.criadas[0].ofertasRespondidas).toEqual([])
    expect(m.canal.enviados).toHaveLength(antes)
  })
})

describe('emissor-revoga-par', () => {
  test('revogar o remetente da resposta aceita → conexão fechada e oferta nova; outro usuário → nada', async () => {
    const m = montar()
    await conectado(m)
    m.emissor.revogarPar(OUTRO)
    await m.relogio.avancar(0)
    expect(m.conexoes.criadas[0].fechada()).toBe(false)
    expect(m.ofertas()).toHaveLength(1)
    m.emissor.revogarPar(PAR)
    await m.relogio.avancar(0)
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
    expect(m.ofertas()).toHaveLength(2)
    expect(m.ultimaSessao()).not.toBe(sessao(1))
  })
})

describe('emissor-queda-breve', () => {
  test('caiu e conectado em 4 999 ms → nenhuma oferta nova; caiu por 5 000 ms → oferta nova', async () => {
    const m = montar()
    await conectado(m)
    await emitir(m, 'caiu')
    await m.relogio.avancar(4999)
    await emitir(m, 'conectado')
    await m.relogio.avancar(60_000)
    expect(m.ofertas()).toHaveLength(1)
    expect(m.conexoes.criadas[0].fechada()).toBe(false)
    await emitir(m, 'caiu')
    await m.relogio.avancar(4999)
    expect(m.ofertas()).toHaveLength(1)
    await m.relogio.avancar(1)
    expect(m.ofertas()).toHaveLength(2)
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
  })
})

describe('emissor-espera-crescente', () => {
  test('falhou seguidos → ofertas em 2 000, 4 000, 8 000, 16 000, 30 000, 30 000 ms; um conectado zera', async () => {
    const m = montar()
    await noAr(m)
    for (const espera of [2000, 4000, 8000, 16000, 30000, 30000]) {
      const antes = m.ofertas().length
      await emitir(m, 'falhou')
      await m.relogio.avancar(espera - 1)
      expect(m.ofertas()).toHaveLength(antes)
      await m.relogio.avancar(1)
      expect(m.ofertas()).toHaveLength(antes + 1)
    }
    await responder(m)
    await emitir(m, 'conectado')
    const antes = m.ofertas().length
    await emitir(m, 'falhou')
    await m.relogio.avancar(1999)
    expect(m.ofertas()).toHaveLength(antes)
    await m.relogio.avancar(1)
    expect(m.ofertas()).toHaveLength(antes + 1)
  })
})

describe('emissor-sem-resposta', () => {
  test('15 000 ms sem resposta → aguardando_par e nova tentativa pela espera', async () => {
    const m = montar()
    await noAr(m)
    await m.relogio.avancar(14_999)
    expect(m.situacao()).toBe('conectando')
    expect(m.conexoes.criadas[0].fechada()).toBe(false)
    await m.relogio.avancar(1)
    expect(m.situacao()).toBe('aguardando_par')
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
    await m.relogio.avancar(1999)
    expect(m.ofertas()).toHaveLength(1)
    await m.relogio.avancar(1)
    expect(m.ofertas()).toHaveLength(2)
  })
})

describe('emissor-sem-conexao-direta', () => {
  test('duas falhou depois de resposta aceita → sem_conexao_direta; uma só → não; conectado depois → conectado', async () => {
    const m = montar()
    await noAr(m)
    await responder(m)
    await emitir(m, 'falhou')
    expect(m.situacao()).toBe('conectando')
    await m.relogio.avancar(2000)
    await responder(m)
    await emitir(m, 'falhou')
    expect(m.situacao()).toBe('sem_conexao_direta')
    await m.relogio.avancar(4000)
    expect(m.situacao()).toBe('sem_conexao_direta')
    await responder(m)
    await emitir(m, 'conectado')
    expect(m.situacao()).toBe('conectado')
  })

  test('falhou sem resposta aceita não conta', async () => {
    const m = montar()
    await noAr(m)
    await emitir(m, 'falhou')
    await m.relogio.avancar(2000)
    await emitir(m, 'falhou')
    expect(m.situacao()).not.toBe('sem_conexao_direta')
  })
})

describe('emissor-prazo-da-conexao', () => {
  test('resposta aceita parada em conectando: 19 999 ms → nada; 20 000 ms → falha, fecha e tenta pela espera; dois prazos → sem_conexao_direta', async () => {
    const m = montar()
    await noAr(m)
    await responder(m)
    await emitir(m, 'conectando')
    await m.relogio.avancar(19_999)
    expect(m.conexoes.criadas[0].fechada()).toBe(false)
    expect(m.ofertas()).toHaveLength(1)
    await m.relogio.avancar(1)
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
    expect(m.situacao()).toBe('conectando')
    await m.relogio.avancar(1999)
    expect(m.ofertas()).toHaveLength(1)
    await m.relogio.avancar(1)
    expect(m.ofertas()).toHaveLength(2)
    await responder(m)
    await m.relogio.avancar(20_000)
    expect(m.situacao()).toBe('sem_conexao_direta')
  })
})

describe('emissor-canal-volta', () => {
  test('canal reconectando → conectado sem vídeo → oferta nova; com vídeo conectado → nada', async () => {
    const m = montar()
    await conectado(m)
    m.canal.mudarEstado('reconectando')
    m.canal.mudarEstado('conectado')
    await m.relogio.avancar(0)
    expect(m.ofertas()).toHaveLength(1)
    await m.sinal({ tipo: 'encerrar', sessao: m.ultimaSessao() })
    m.canal.mudarEstado('reconectando')
    await m.relogio.avancar(0)
    expect(m.ofertas()).toHaveLength(1)
    m.canal.mudarEstado('conectado')
    await m.relogio.avancar(0)
    expect(m.ofertas()).toHaveLength(2)
  })

  test('com o canal fora de conectado, a câmera liga mas não oferece; oferece quando o canal conecta', async () => {
    const m = montar()
    m.emissor.definirEpisodio(true)
    await m.emissor.ligarPeloToque()
    await m.relogio.avancar(60_000)
    expect(m.camera.estado.ligacoes).toBe(1)
    expect(m.ofertas()).toHaveLength(0)
    m.canal.mudarEstado('conectado')
    await m.relogio.avancar(0)
    expect(m.ofertas()).toHaveLength(1)
  })
})

describe('emissor-falha-da-camera', () => {
  test.each<FalhaDaCamera & EstadoDoVideo>(['sem_permissao', 'sem_camera', 'inseguro'])('%s → situação igual, nenhuma oferta; um novo toque tenta de novo', async (motivo) => {
    const m = montar()
    m.camera.estado.proximo = motivo
    await noAr(m)
    expect(m.situacao()).toBe(motivo)
    expect(m.conexoes.criadas).toHaveLength(0)
    expect(m.canal.enviados).toEqual([])
    // o consentimento caiu: um novo episódio não liga sozinho
    m.emissor.definirEpisodio(false)
    m.emissor.definirEpisodio(true)
    await m.relogio.avancar(60_000)
    expect(m.camera.estado.ligacoes).toBe(1)
    expect(m.situacao()).toBe(motivo)
    m.camera.estado.proximo = null
    await m.emissor.ligarPeloToque()
    await m.relogio.avancar(0)
    expect(m.camera.estado.ligacoes).toBe(2)
    expect(m.ofertas()).toHaveLength(1)
  })

  test('outro → volta a pedir o toque', async () => {
    const m = montar()
    m.camera.estado.proximo = 'outro'
    await noAr(m)
    expect(m.situacao()).toBe('aguardando_toque')
    expect(m.conexoes.criadas).toHaveLength(0)
  })

  test('câmera que liga depois de o episódio acabar: a faixa que chega atrasada é desligada na hora', async () => {
    const m = montar()
    m.canal.mudarEstado('conectado')
    m.emissor.definirEpisodio(true)
    m.camera.estado.segurar = true
    const ligando = m.emissor.ligarPeloToque()
    await m.relogio.avancar(0)
    m.emissor.definirEpisodio(false)
    expect(m.camera.registro).toEqual(['ligar#0', 'desligar'])
    m.camera.soltarLigacoes()
    await ligando
    await m.relogio.avancar(0)
    // a faixa 0 chegou depois do fim do episódio e foi desligada depois de chegar
    expect(m.camera.registro).toEqual(['ligar#0', 'desligar', 'faixa#0', 'desligar'])
    expect(m.conexoes.criadas).toHaveLength(0)
    await m.relogio.avancar(60_000)
    expect(m.camera.registro).toHaveLength(4)
  })

  test('câmera que liga depois do parar: a faixa que chega atrasada é desligada', async () => {
    const m = montar()
    m.canal.mudarEstado('conectado')
    m.emissor.definirEpisodio(true)
    m.camera.estado.segurar = true
    const ligando = m.emissor.ligarPeloToque()
    await m.relogio.avancar(0)
    m.emissor.parar()
    expect(m.camera.registro).toEqual(['ligar#0', 'desligar'])
    m.camera.soltarLigacoes()
    await ligando
    await m.relogio.avancar(0)
    expect(m.camera.registro).toEqual(['ligar#0', 'desligar', 'faixa#0', 'desligar'])
    expect(m.conexoes.criadas).toHaveLength(0)
  })
})

describe('faixa-terminada-religa', () => {
  test('faixa perdida → liga a câmera de novo e troca a faixa; troca recusada → oferta nova', async () => {
    const m = montar()
    await conectado(m)
    m.camera.perder()
    await m.relogio.avancar(0)
    expect(m.camera.estado.ligacoes).toBe(2)
    expect(m.conexoes.criadas[0].trocas).toEqual([m.camera.faixas[1]])
    expect(m.ofertas()).toHaveLength(1)
    m.conexoes.config.trocaDaFaixa = false
    m.camera.perder()
    await m.relogio.avancar(0)
    expect(m.camera.estado.ligacoes).toBe(3)
    expect(m.ofertas()).toHaveLength(2)
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
    expect(m.conexoes.criadas[1].ofertas).toEqual([m.camera.faixas[2]])
  })

  test('religar recusado pelo navegador → fecha a conexão, desliga e mostra o motivo', async () => {
    const m = montar()
    await conectado(m)
    m.camera.estado.proximo = 'sem_permissao'
    m.camera.perder()
    await m.relogio.avancar(0)
    expect(m.situacao()).toBe('sem_permissao')
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
    expect(m.camera.estado.desligadas).toBeGreaterThanOrEqual(1)
  })
})

describe('emissor-voltar-a-ver', () => {
  test('com tudo bem → nada; com a faixa perdida (religar falhou com a página escondida) → religa', async () => {
    const m = montar()
    await conectado(m)
    m.emissor.voltarAVer()
    await m.relogio.avancar(0)
    expect(m.camera.estado.ligacoes).toBe(1)
    m.camera.estado.proximo = 'outro'
    m.camera.perder()
    await m.relogio.avancar(0)
    expect(m.camera.estado.ligacoes).toBe(2)
    m.camera.estado.proximo = null
    m.emissor.voltarAVer()
    await m.relogio.avancar(0)
    expect(m.camera.estado.ligacoes).toBe(3)
    expect(m.conexoes.criadas[0].trocas).toHaveLength(1)
    m.emissor.voltarAVer()
    await m.relogio.avancar(0)
    expect(m.camera.estado.ligacoes).toBe(3)
  })
})

describe('emissor-parar', () => {
  test('encerrar, fecha, desliga e nenhum agendamento sobra', async () => {
    const m = montar()
    await conectado(m)
    await emitir(m, 'caiu')
    m.emissor.parar()
    await m.relogio.avancar(0)
    expect(m.canal.enviados.at(-1)).toEqual({ tipo: 'encerrar', sessao: sessao(1) })
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
    expect(m.camera.estado.desligadas).toBe(1)
    expect(m.relogio.pendentes()).toBe(0)
    expect(m.canal.ouvintes()).toBe(0)
    expect(m.camera.ouvintes()).toBe(0)
    expect(m.conexoes.criadas[0].ouvintes()).toBe(0)
    const enviados = m.canal.enviados.length
    const situacoes = m.situacoes.length
    m.canal.mudarEstado('conectado')
    m.camera.perder()
    m.emissor.definirEpisodio(true)
    await m.emissor.ligarPeloToque()
    m.emissor.voltarAVer()
    await m.relogio.avancar(60_000)
    expect(m.canal.enviados).toHaveLength(enviados)
    expect(m.conexoes.criadas).toHaveLength(1)
    expect(m.camera.estado.ligacoes).toBe(1)
    expect(m.situacoes).toHaveLength(situacoes)
  })

  test('durante a espera crescente: nenhum agendamento sobra e nada mais sai', async () => {
    const m = montar()
    await noAr(m)
    await emitir(m, 'falhou')
    expect(m.relogio.pendentes()).toBe(1)
    m.emissor.parar()
    expect(m.relogio.pendentes()).toBe(0)
    await m.relogio.avancar(60_000)
    expect(m.ofertas()).toHaveLength(1)
    expect(m.conexoes.criadas).toHaveLength(1)
  })
})

describe('ouvinte-adiado', () => {
  test('nenhum ouvinte de porta chama outra porta antes do agendar com 0 ms', async () => {
    const m = montar()
    await noAr(m)
    // resposta: nada aceito antes do agendar
    m.canal.entregar('sinal', { tipo: 'resposta', sessao: m.ultimaSessao(), sdp: SDP_DA_RESPOSTA, remetente: PAR, id: ID_DO_SEND })
    expect(m.conexoes.criadas[0].respostasAceitas).toEqual([])
    await m.relogio.avancar(0)
    expect(m.conexoes.criadas[0].respostasAceitas).toEqual([SDP_DA_RESPOSTA])
    // conexão conectado e depois a faixa perdida: nenhum ligar antes do agendar
    m.conexoes.criadas[0].emitir('conectado')
    m.camera.perder()
    expect(m.camera.estado.ligacoes).toBe(1)
    await m.relogio.avancar(0)
    expect(m.camera.estado.ligacoes).toBe(2)
    // falhou: a conexão não é fechada dentro do ouvinte
    m.conexoes.criadas[0].emitir('falhou')
    expect(m.conexoes.criadas[0].fechada()).toBe(false)
    await m.relogio.avancar(0)
    expect(m.conexoes.criadas[0].fechada()).toBe(true)
    // encerrar do par seguido de pronto e do canal que volta: nenhuma conexão criada antes do agendar
    await m.relogio.avancar(2000)
    await m.sinal({ tipo: 'resposta', sessao: m.ultimaSessao(), sdp: SDP_DA_RESPOSTA })
    await m.sinal({ tipo: 'encerrar', sessao: m.ultimaSessao() })
    const criadas = m.conexoes.criadas.length
    m.canal.entregar('sinal', { tipo: 'pronto', sessao: sessao(90), remetente: PAR, id: ID_DO_SEND })
    m.canal.mudarEstado('reconectando')
    m.canal.mudarEstado('conectado')
    expect(m.conexoes.criadas).toHaveLength(criadas)
    await m.relogio.avancar(0)
    expect(m.conexoes.criadas).toHaveLength(criadas + 1)
  })
})

describe('emissor-encerrar-so-do-par', () => {
  test('encerrar da sessão atual vindo de outro remetente que não o da resposta aceita → ignorado', async () => {
    const m = montar()
    await conectado(m)
    await m.sinal({ tipo: 'encerrar', sessao: m.ultimaSessao() }, OUTRO)
    expect(m.conexoes.criadas[0].fechada()).toBe(false)
    expect(m.situacao()).toBe('conectado')
  })
})

describe('emissor-sem-faixa-velha', () => {
  test('sem episódio a faixa é esquecida: o canal que volta enquanto a câmera religa não oferece com a faixa parada', async () => {
    const m = montar()
    await conectado(m)
    m.emissor.definirEpisodio(false)
    m.camera.estado.segurar = true
    m.emissor.definirEpisodio(true)
    await m.relogio.avancar(0)
    m.canal.mudarEstado('reconectando')
    m.canal.mudarEstado('conectado')
    await m.relogio.avancar(0)
    expect(m.conexoes.criadas).toHaveLength(1)
    m.camera.soltarLigacoes()
    await m.relogio.avancar(0)
    expect(m.conexoes.criadas).toHaveLength(2)
    expect(m.conexoes.criadas[1].ofertas).toEqual([m.camera.faixas[1]])
  })
})

describe('emissor-sem-par-zera-falhas', () => {
  test('sem_par entre duas falhas depois de resposta aceita zera a conta: não vira sem_conexao_direta', async () => {
    const m = montar()
    await noAr(m)
    await responder(m)
    await emitir(m, 'falhou')
    m.canal.responderCom(() => 'sem_par')
    await m.relogio.avancar(2000)
    expect(m.situacao()).toBe('aguardando_par')
    m.canal.responderCom(() => 'ok')
    await m.relogio.avancar(4000)
    await responder(m)
    await emitir(m, 'falhou')
    expect(m.situacao()).not.toBe('sem_conexao_direta')
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

describe('emissor-criar-que-lanca', () => {
  // VER-051, rodada 1 (I2): uma fábrica de conexões que lança não deixa rejeição solta e conta como falha (espera crescente)
  test('criar() que lança → nenhuma oferta, nenhuma rejeição solta; nova tentativa pela espera crescente', async () => {
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
    expect(await rejeicoesSoltas(() => noAr(m))).toEqual([])
    expect(lancou).toBe(1)
    expect(m.ofertas()).toHaveLength(0)
    expect(m.situacao()).toBe('conectando')
    await m.relogio.avancar(1999)
    expect(m.ofertas()).toHaveLength(0)
    await m.relogio.avancar(1)
    expect(m.ofertas()).toHaveLength(1)
  })
})
