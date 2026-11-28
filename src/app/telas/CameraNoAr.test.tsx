// @vitest-environment jsdom
import { afterEach, beforeEach, describe, test, expect, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SinalDaCamera, SinalDaObs } from '../../domains/captura/sinais'
import { PRESENCA_MINIMA_MS } from '../../domains/captura/sinais'
import type { EstadoDoVideo } from '../../domains/captura/sinais'
import type { CanalDeVideo } from '../../domains/captura/portas'
import type { ServicosDoDispositivo } from '../servicos'
import { lerArquivoDoRepositorio } from '../lerArquivoDoRepositorio'
import { criarFalsos, criarFalsosDeDispositivo } from '../servicosFalsos'
import { Camera } from './Camera'
import { PREVIA_MS, STATUS_VISIVEL_MS, TEXTO_DA_CAMERA } from './CameraNoAr'
import { TEXTO_DO_DISPOSITIVO } from './TelaDeDispositivo'

const EP = 'e0000000-0000-4000-8000-000000000001'
const EP2 = 'e0000000-0000-4000-8000-000000000002'
const EU = 'b0000000-0000-4000-8000-0000000000bb'
const OBS = 'c0000000-0000-4000-8000-0000000000cc'
const MEMBRO = 'a0000000-0000-4000-8000-000000000001'
const DISPOSITIVO = 'd0000000-0000-4000-8000-0000000000dd'
const VIDEO = `video:${EU}`
/** SDP acima do teto de 12 000 caracteres (D4), montado no teste. */
const SDP_GRANDE = `v=0\r\n${'a'.repeat(12_001)}`

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

type Falsos = ReturnType<typeof criarFalsosDeDispositivo>
type Episodio = { id: string; modo: 'ao_vivo' | 'teste' } | null

/**
 * Esvazia as promessas e os `setTimeout(..., 0)` que o emissor agenda (no relógio falso, um 0 ms agendado durante o avanço
 * vence em +1 ms; VER-051, P7) e anda `ms` no relógio.
 */
async function esperar(ms = 0) {
  await act(async () => {
    for (let r = 0; r < 6; r++) {
      for (let i = 0; i < 20; i++) await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1)
    }
    if (ms > 0) await vi.advanceTimersByTimeAsync(ms)
    for (let r = 0; r < 6; r++) {
      for (let i = 0; i < 20; i++) await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1)
    }
  })
}

function montar(
  o: {
    episodio?: Episodio
    /** Antes de desenhar (configura os falsos). */
    antes?: (d: Falsos) => void
    /** Troca a fábrica de canais (para espiar o canal de vídeo). */
    canais?: (d: Falsos) => ServicosDoDispositivo['canais']
  } = {},
) {
  const episodio = o.episodio === undefined ? { id: EP, modo: 'teste' as const } : o.episodio
  const d = criarFalsosDeDispositivo({
    sessao: { usuarioId: EU, anonima: true },
    dispositivo: { id: DISPOSITIVO, tipo: 'camera', rotulo: 'Celular de gravação', cameraId: null },
    episodioAtivo: episodio,
  })
  o.antes?.(d)
  const episodioAtivo = vi.spyOn(d.servicos.palco, 'episodioAtivo')
  const servicos: ServicosDoDispositivo = o.canais ? { ...d.servicos, canais: o.canais(d) } : d.servicos
  const voltas = new Set<() => void>()
  const dep = criarFalsos().dependencias({
    obterDispositivo: () => servicos,
    aoVoltarAVer: (f) => {
      voltas.add(f)
      return () => {
        voltas.delete(f)
      }
    },
  })
  const r = render(<Camera titulo="Câmera" dependencias={dep} />)
  return {
    d,
    r,
    episodioAtivo,
    main: () => r.container.querySelector('main'),
    criados: (topico: string) => d.canal.realtime.criados.filter((c) => c.topico === topico).length,
    ofertas: () => d.canal.sinaisDeVideo().filter((s) => s.p_tipo === 'oferta'),
    tipos: () => d.canal.sinaisDeVideo().map((s) => s.p_tipo),
    vezes: (metodo: string) => d.chamadas.ordem.filter((x) => x === metodo).length,
    voltarAVer: () =>
      act(() => {
        for (const f of [...voltas]) f()
      }),
  }
}
type Montado = ReturnType<typeof montar>

async function tocar(m: Montado) {
  const area = m.r.container.querySelector('.toque-da-camera')
  if (area === null) throw new Error('sem área de toque')
  act(() => {
    fireEvent.click(area)
  })
  await esperar()
}

/** O `obs_camera` responde à última oferta (pelo tópico da câmera, com o remetente posto pelo "banco"). */
function responder(m: Montado, remetente = OBS) {
  const sessao = m.ofertas().at(-1)?.p_sessao
  act(() => m.d.canal.entregar(VIDEO, 'sinal', { tipo: 'resposta', sessao, sdp: m.d.video.sdpDaResposta, remetente }))
}

async function conectar(m: Montado) {
  await esperar()
  await tocar(m)
  responder(m)
  await esperar()
}

function avisarEstudio(m: Montado, evento: string, payload: Record<string, unknown>) {
  act(() => m.d.canal.entregar('estudio', evento, { ...payload, remetente: MEMBRO }))
}

async function mudarEpisodio(m: Montado, ep: Episodio) {
  m.d.definirEpisodioAtivo(ep)
  avisarEstudio(m, 'episodio_ativo_mudou', {})
  await esperar()
}

/** Duas falhas seguidas depois de resposta aceita (D6): a primeira espera 2 s pela tentativa nova. */
async function falharDuasVezes(m: Montado) {
  await tocar(m)
  for (let i = 0; i < 2; i++) {
    responder(m)
    await esperar()
    m.d.video.conexoesCriadas.at(-1)?.falhar()
    await esperar()
    if (i === 0) await esperar(2000)
  }
}

function sdpGrande(d: Falsos) {
  const criar = d.video.conexoes.criar.bind(d.video.conexoes)
  d.video.conexoes.criar = () => {
    const c = criar()
    return { ...c, oferecer: async () => SDP_GRANDE }
  }
}

/** Situações que pedem ação de quem está com o celular: a frase fica na tela sem toque. */
const PERMANENTES: readonly EstadoDoVideo[] = ['aguardando_toque', 'sem_permissao', 'sem_camera', 'inseguro', 'sinal_grande', 'sem_video_direto']

const SITUACOES: { estado: EstadoDoVideo; opcoes?: Parameters<typeof montar>[0]; agir?: (m: Montado) => Promise<void> }[] = [
  { estado: 'aguardando_toque' },
  { estado: 'aguardando_episodio', opcoes: { episodio: null }, agir: tocar },
  { estado: 'aguardando_par', opcoes: { antes: (d) => d.canal.responderSinal('sem_par') }, agir: tocar },
  { estado: 'conectando', opcoes: { antes: (d) => (d.video.config.conectarSozinha = false) }, agir: tocar },
  { estado: 'conectado', agir: conectar },
  { estado: 'sem_conexao_direta', opcoes: { antes: (d) => (d.video.config.conectarSozinha = false) }, agir: falharDuasVezes },
  { estado: 'sem_permissao', opcoes: { antes: (d) => (d.video.camera.proxima = 'sem_permissao') }, agir: tocar },
  { estado: 'sem_camera', opcoes: { antes: (d) => (d.video.camera.proxima = 'sem_camera') }, agir: tocar },
  { estado: 'inseguro', opcoes: { antes: (d) => (d.video.camera.proxima = 'inseguro') }, agir: tocar },
  { estado: 'sinal_grande', opcoes: { antes: sdpGrande }, agir: tocar },
  { estado: 'sem_video_direto', opcoes: { antes: (d) => (d.video.config.videoDireto = false) }, agir: tocar },
]

describe('/camera no ar: tela preta e vídeo (PLA-005, D5–D7, D10, D13)', () => {
  test.each(SITUACOES)('tela-preta-sem-video ($estado)', async ({ estado, opcoes, agir }) => {
    const m = montar(opcoes)
    await esperar()
    await agir?.(m)
    if (!PERMANENTES.includes(estado)) await tocar(m) // o status aparece pelo toque
    const frase = TEXTO_DA_CAMERA[estado]
    expect(m.r.container.querySelector('video')).toBeNull()
    const main = m.main()
    expect(main?.classList.contains('tela-preta')).toBe(true)
    expect(screen.getByRole('img', { name: frase }).classList.contains('ponto-da-camera')).toBe(true)
    // nenhum texto além da frase da situação (e do botão da prévia, com a câmera ligada)
    expect(main?.textContent).toBe(frase + (m.d.video.camera.ligada() ? TEXTO_DA_CAMERA.previa : ''))
    // depois do status, a tela volta a ficar preta (só as situações que pedem ação continuam escritas)
    await esperar(STATUS_VISIVEL_MS + 100)
    expect(m.r.container.querySelector('video')).toBeNull()
    expect(main?.textContent).toBe(PERMANENTES.includes(estado) ? frase : '')
  })

  test('toque-liga-a-camera', async () => {
    const m = montar()
    await esperar(60_000)
    expect(screen.getByText(TEXTO_DA_CAMERA.aguardando_toque)).toBeTruthy()
    expect(m.d.video.camera.ligacoes).toBe(0)
    expect(m.d.video.tela.travadas).toBe(0)
    expect(m.ofertas()).toHaveLength(0)
    await tocar(m)
    expect(m.d.video.camera.ligacoes).toBe(1)
    expect(m.d.video.tela.travadas).toBe(1)
    expect(m.ofertas()).toHaveLength(1)
    // a câmera e a tela pertencem à rota: uma de cada
    expect(m.d.video.camera.criadas).toBe(1)
    expect(m.d.video.tela.criadas).toBe(1)
  })

  test('sem-episodio-camera-desligada', async () => {
    const m = montar({ episodio: null })
    await esperar()
    await tocar(m)
    expect(m.d.video.camera.ligacoes).toBe(0)
    expect(screen.getByText(TEXTO_DA_CAMERA.aguardando_episodio)).toBeTruthy()
    expect(m.criados(VIDEO)).toBe(0)
  })

  test('episodio-encerrado-desliga', async () => {
    const ordem: string[] = []
    const canais = (d: Falsos): ServicosDoDispositivo['canais'] => (usuario) => {
      const f = d.servicos.canais(usuario)
      return {
        ...f,
        videoDaCamera: () => {
          const c: CanalDeVideo<SinalDaCamera, SinalDaObs> = f.videoDaCamera()
          return {
            ...c,
            enviar: (s) => {
              ordem.push(`enviar:${s.tipo}`)
              return c.enviar(s)
            },
            fechar: () => {
              ordem.push('fechar')
              return c.fechar()
            },
          }
        },
      }
    }
    const m = montar({ canais })
    await conectar(m)
    expect(m.d.canal.abertos()).toContain(VIDEO)
    expect(m.d.video.camera.desligadas).toBe(0)
    await mudarEpisodio(m, null)
    expect(ordem).toEqual(['enviar:oferta', 'enviar:encerrar', 'fechar']) // o `encerrar` sai antes de o canal fechar
    expect(m.tipos()).toEqual(['oferta', 'encerrar'])
    expect(m.d.video.camera.desligadas).toBe(1)
    expect(m.d.video.camera.ligada()).toBe(false)
    expect(m.d.video.conexoesCriadas[0].fechada()).toBe(true)
    expect(m.d.canal.abertos()).toEqual(['estudio'])
  })

  test('episodio-encerrado-desliga: a função recusa o encerrar e nada mais é tentado', async () => {
    const m = montar()
    await conectar(m)
    m.d.canal.responderSinal('falhou')
    await mudarEpisodio(m, null)
    await esperar(60_000)
    expect(m.tipos()).toEqual(['oferta', 'encerrar'])
    expect(m.d.video.camera.desligadas).toBe(1)
    expect(m.d.canal.abertos()).toEqual(['estudio'])
  })

  test('status-por-3s', async () => {
    const m = montar({ antes: (d) => d.video.definirBateria(0.87) })
    await conectar(m)
    await esperar(STATUS_VISIVEL_MS + 100)
    expect(m.main()?.textContent).toBe('')
    await tocar(m)
    expect(screen.getByText(TEXTO_DA_CAMERA.conectado)).toBeTruthy()
    expect(screen.getByText('Bateria: 87%')).toBeTruthy()
    await esperar(STATUS_VISIVEL_MS - 200)
    expect(screen.queryByText(TEXTO_DA_CAMERA.conectado)).not.toBeNull()
    await esperar(300)
    expect(screen.queryByText(TEXTO_DA_CAMERA.conectado)).toBeNull()
    expect(screen.queryByText('Bateria: 87%')).toBeNull()
    expect(m.main()?.textContent).toBe('')
    // novo toque dentro do prazo recomeça a contagem
    await tocar(m)
    await esperar(STATUS_VISIVEL_MS - 200)
    await tocar(m)
    await esperar(STATUS_VISIVEL_MS - 200)
    expect(screen.queryByText(TEXTO_DA_CAMERA.conectado)).not.toBeNull()
  })

  test('previa-por-15s', async () => {
    const m = montar()
    await conectar(m)
    await tocar(m)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: TEXTO_DA_CAMERA.previa }))
    })
    await esperar()
    const video = m.r.container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video?.muted).toBe(true)
    expect(video?.hasAttribute('playsinline')).toBe(true)
    expect(video?.srcObject).toBe(m.d.video.fluxoDaCamera)
    expect(video?.getAttribute('src')).toBeNull() // o fluxo vai por `srcObject`, nunca por URL
    await esperar(PREVIA_MS - 200)
    expect(m.r.container.querySelector('video')).not.toBeNull()
    await esperar(300)
    expect(m.r.container.querySelector('video')).toBeNull()
    // "Esconder" antes do prazo
    await tocar(m)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: TEXTO_DA_CAMERA.previa }))
    })
    await esperar()
    expect(m.r.container.querySelector('video')).not.toBeNull()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: TEXTO_DA_CAMERA.esconder }))
    })
    await esperar()
    expect(m.r.container.querySelector('video')).toBeNull()
    expect(m.d.video.camera.ligacoes).toBe(1) // a prévia usa o mesmo fluxo, sem segundo pedido da câmera
  })

  test('previa some quando a câmera desliga (episódio encerrado)', async () => {
    const m = montar()
    await conectar(m)
    await tocar(m)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: TEXTO_DA_CAMERA.previa }))
    })
    await esperar()
    expect(m.r.container.querySelector('video')).not.toBeNull()
    await mudarEpisodio(m, null)
    expect(m.r.container.querySelector('video')).toBeNull()
  })

  test('sem-wake-lock-avisa', async () => {
    const m = montar({ antes: (d) => (d.video.tela.proxima = 'sem_trava') })
    await esperar()
    expect(screen.queryByText(TEXTO_DA_CAMERA.semTrava.iphone)).toBeNull()
    await tocar(m)
    expect(screen.getByText(TEXTO_DA_CAMERA.semTrava.titulo)).toBeTruthy()
    expect(screen.getByText(TEXTO_DA_CAMERA.semTrava.iphone)).toBeTruthy()
    expect(screen.getByText(TEXTO_DA_CAMERA.semTrava.android)).toBeTruthy()
    // continua na tela (é preciso configurar o aparelho), também depois do status
    await esperar(STATUS_VISIVEL_MS + 100)
    expect(screen.getByText(TEXTO_DA_CAMERA.semTrava.iphone)).toBeTruthy()
    // durante a prévia (para enquadrar), as instruções saem, para caber numa tela pequena; voltam ao esconder
    await tocar(m)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: TEXTO_DA_CAMERA.previa }))
    })
    await esperar()
    expect(screen.queryByText(TEXTO_DA_CAMERA.semTrava.iphone)).toBeNull()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: TEXTO_DA_CAMERA.esconder }))
    })
    await esperar()
    expect(screen.getByText(TEXTO_DA_CAMERA.semTrava.iphone)).toBeTruthy()
    // a trava conseguida depois (novo toque) tira as instruções
    m.d.video.tela.proxima = 'travada'
    await tocar(m)
    expect(screen.queryByText(TEXTO_DA_CAMERA.semTrava.iphone)).toBeNull()
  })

  test('wake-lock-volta-ao-ver', async () => {
    const m = montar()
    await conectar(m)
    expect(m.d.video.tela.travadas).toBe(1)
    // a faixa termina com a página escondida: o pedido de novo falha (`outro`) e fica para a volta
    m.d.video.camera.proxima = 'outro'
    m.d.video.camera.perder()
    await esperar()
    expect(m.d.video.camera.ligacoes).toBe(2)
    m.d.video.camera.proxima = null
    m.voltarAVer()
    await esperar()
    expect(m.d.video.tela.travadas).toBe(2)
    expect(m.d.video.camera.ligacoes).toBe(3)
    expect(m.d.video.conexoesCriadas[0].trocas).toHaveLength(1)
    expect(m.ofertas()).toHaveLength(1)
  })

  test('wake-lock-volta-ao-ver: sem o toque, nada é pedido', async () => {
    const m = montar()
    await esperar()
    m.voltarAVer()
    await esperar()
    expect(m.d.video.tela.travadas).toBe(0)
    expect(m.d.video.camera.ligacoes).toBe(0)
  })

  test('faixa-terminada-religa', async () => {
    const m = montar()
    await conectar(m)
    m.d.video.camera.perder()
    await esperar()
    expect(m.d.video.camera.ligacoes).toBe(2)
    expect(m.d.video.conexoesCriadas[0].trocas).toHaveLength(1)
    expect(m.ofertas()).toHaveLength(1) // trocou a faixa sem renegociar
  })

  test('sem-permissao', async () => {
    const m = montar({ antes: (d) => (d.video.camera.proxima = 'sem_permissao') })
    await esperar()
    await tocar(m)
    expect(screen.getByText(TEXTO_DA_CAMERA.sem_permissao)).toBeTruthy()
    expect(m.d.video.camera.ligacoes).toBe(1)
    expect(m.ofertas()).toHaveLength(0)
    m.d.video.camera.proxima = null
    await tocar(m)
    expect(m.d.video.camera.ligacoes).toBe(2)
    expect(m.ofertas()).toHaveLength(1)
    expect(screen.queryByText(TEXTO_DA_CAMERA.sem_permissao)).toBeNull()
  })

  test('sem-conexao-direta-avisa', async () => {
    const m = montar({ antes: (d) => (d.video.config.conectarSozinha = false) })
    await esperar()
    await falharDuasVezes(m)
    await esperar(STATUS_VISIVEL_MS + 100)
    await tocar(m)
    expect(screen.getByText(TEXTO_DA_CAMERA.sem_conexao_direta)).toBeTruthy()
    expect(screen.getByRole('img', { name: TEXTO_DA_CAMERA.sem_conexao_direta }).className).toContain('ponto-da-camera--rosa')
    // também na prévia
    await esperar(STATUS_VISIVEL_MS + 100)
    await tocar(m)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: TEXTO_DA_CAMERA.previa }))
    })
    await esperar(STATUS_VISIVEL_MS + 100)
    expect(m.r.container.querySelector('video')).not.toBeNull()
    expect(screen.getByText(TEXTO_DA_CAMERA.sem_conexao_direta)).toBeTruthy()
  })

  test('sem-webrtc-avisa (Riscos do VER-051; rodada 1, I2 e N2)', async () => {
    const m = montar({ antes: (d) => (d.video.config.videoDireto = false) })
    await esperar()
    expect(screen.getByText(TEXTO_DA_CAMERA.sem_video_direto)).toBeTruthy()
    expect(screen.getByRole('img', { name: TEXTO_DA_CAMERA.sem_video_direto }).className).toContain('ponto-da-camera--rosa')
    expect(screen.queryByText(TEXTO_DA_CAMERA.aguardando_toque)).toBeNull()
    // a presença leva a causa (a aba da Tarefa 6 a mostra), não `aguardando_toque`
    expect(m.d.canal.presencas('estudio')).toEqual([
      { tipo: 'camera', dispositivoId: DISPOSITIVO, obs: null, video: { estado: 'sem_video_direto', telaLigada: null, bateria: null } },
    ])
    await tocar(m)
    await esperar(60_000)
    expect(m.d.video.camera.ligacoes).toBe(0)
    expect(m.d.video.tela.travadas).toBe(0)
    expect(screen.getByText(TEXTO_DA_CAMERA.sem_video_direto)).toBeTruthy()
    // com episódio ativo, nenhum canal de vídeo à toa (nunca haverá oferta)
    expect(m.criados(VIDEO)).toBe(0)
    await mudarEpisodio(m, { id: EP2, modo: 'ao_vivo' })
    m.voltarAVer()
    await esperar()
    expect(m.criados(VIDEO)).toBe(0)
    expect(m.d.canal.abertos()).toEqual(['estudio'])
    expect((m.d.canal.presencas('estudio').at(-1) as { video: { estado: string } }).video.estado).toBe('sem_video_direto')
  })

  test('toque-na-coluna (rodada 2, R2-N1): a coluna que rola também mostra o status; os botões dela não contam como toque', async () => {
    const m = montar()
    await conectar(m)
    await esperar(STATUS_VISIVEL_MS + 100)
    expect(m.main()?.textContent).toBe('')
    const coluna = m.r.container.querySelector('.camera-no-ar')
    if (coluna === null) throw new Error('sem coluna')
    act(() => {
      fireEvent.click(coluna)
    })
    await esperar()
    expect(screen.getByText(TEXTO_DA_CAMERA.conectado)).toBeTruthy()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: TEXTO_DA_CAMERA.previa }))
    })
    await esperar()
    expect(m.r.container.querySelector('video')).not.toBeNull()
    // "Esconder" fecha a prévia sem reabrir o status por conta própria
    await esperar(STATUS_VISIVEL_MS + 100)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: TEXTO_DA_CAMERA.esconder }))
    })
    await esperar()
    expect(m.r.container.querySelector('video')).toBeNull()
    expect(m.main()?.textContent).toBe('')
  })

  test('previa-sem-fluxo (rodada 1, N1): o botão da prévia com o fluxo já perdido não mostra vídeo', async () => {
    const controle = { semFluxo: false }
    const m = montar({
      antes: (d) => {
        const criar = d.video.aparelho.camera
        d.video.aparelho.camera = () => {
          const c = criar()
          return { ...c, fluxoDaPrevia: () => (controle.semFluxo ? null : c.fluxoDaPrevia()) }
        }
      },
    })
    await conectar(m)
    await tocar(m)
    const botao = screen.getByRole('button', { name: TEXTO_DA_CAMERA.previa })
    controle.semFluxo = true // o fluxo some entre o desenho do botão e o toque nele
    act(() => {
      fireEvent.click(botao)
    })
    await esperar()
    expect(m.r.container.querySelector('video')).toBeNull()
    await esperar(PREVIA_MS)
    expect(m.r.container.querySelector('video')).toBeNull()
  })

  test('css-da-camera (rodada 1, I1 e N3; rodada 2, R2-N1 e R2-N2): botões sempre alcançáveis, cores só de tokens, texto legível no preto', async () => {
    const css = await lerArquivoDoRepositorio('src/shared/styles/base.css')
    const tokens = await lerArquivoDoRepositorio('src/shared/styles/tokens.css')
    const regra = (seletor: string) => {
      const i = css.indexOf(`\n${seletor} {`)
      expect(i, seletor).toBeGreaterThan(-1)
      return css.slice(i, css.indexOf('}', i))
    }
    // a coluna não encolhe os botões nem o texto; só a prévia encolhe (a tela tem `overflow: hidden`)
    expect(regra('.camera-no-ar > *')).toContain('flex-shrink: 0')
    expect(regra('.camera-no-ar > .previa-da-camera')).toMatch(/flex: 0 1 auto;[^}]*min-height: 0/)
    expect(regra('.botao-da-camera')).toMatch(/min-height: 44px/)
    // bloco da câmera: cores só de variáveis, `transparent` ou o preto declarado
    const bloco = css.slice(css.indexOf('/* /camera pareado'))
    const cores = [...bloco.matchAll(/(?:^|[\s;{])(?:color|background(?:-color)?|border(?:-color)?)\s*:\s*([^;]+);/g)].map((x) => x[1])
    expect(cores.length).toBeGreaterThan(5)
    for (const valor of cores) expect(valor.replace(/var\(--[a-z-]+\)|#000\b/g, ''), valor).not.toMatch(/#|rgb|hsl|\b(white|black|gray|grey)\b/)
    expect(regra('.tela-preta')).toContain('color: var(--texto-na-tela-preta)')
    // contraste do texto sobre o preto, igual nos dois temas (o token não muda no escuro)
    const valor = /--texto-na-tela-preta:\s*(#[0-9a-f]{6})/i.exec(tokens)?.[1] ?? ''
    expect(tokens.match(/--texto-na-tela-preta:/g)).toHaveLength(1)
    const canal = (h: string) => {
      const c = parseInt(h, 16) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    const l = 0.2126 * canal(valor.slice(1, 3)) + 0.7152 * canal(valor.slice(3, 5)) + 0.0722 * canal(valor.slice(5, 7))
    expect((l + 0.05) / 0.05).toBeGreaterThanOrEqual(4.5)
    // nada que carrega texto fica translúcido (só o ponto, que não tem texto)
    const regras = [...bloco.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map((x) => ({ seletor: x[1].trim(), corpo: x[2] }))
    expect(regras.map((x) => x.seletor)).toEqual(expect.arrayContaining(['.tela-preta', '.camera-no-ar', '.status-da-camera', '.botao-da-camera']))
    for (const { seletor, corpo } of regras) if (!seletor.startsWith('.ponto-da-camera')) expect(corpo, seletor).not.toMatch(/opacity/)
    // a coluna rola quando não cabe (tela deitada com as barras do navegador): recebe o toque e rola
    expect(regra('.camera-no-ar')).toMatch(/overflow-y: auto/)
    expect(regra('.camera-no-ar')).not.toMatch(/pointer-events: none/)
  })

  test('revogado-desliga-tudo', async () => {
    // a câmera desliga na própria revogação, antes da tela de revogado (não só na desmontagem que vem depois)
    const comTelaPreta: boolean[] = []
    const m = montar({
      antes: (d) => {
        const criar = d.video.aparelho.camera
        d.video.aparelho.camera = () => {
          const c = criar()
          return {
            ...c,
            desligar: () => {
              comTelaPreta.push(document.querySelector('.tela-preta') !== null)
              c.desligar()
            },
          }
        }
      },
    })
    await conectar(m)
    avisarEstudio(m, 'revogacao', { usuario: EU })
    await esperar()
    expect(screen.getByText(TEXTO_DO_DISPOSITIVO.revogado)).toBeTruthy()
    expect(m.d.video.camera.desligadas).toBe(1)
    expect(comTelaPreta).toEqual([true])
    expect(m.d.video.camera.ligada()).toBe(false)
    expect(m.d.video.conexoesCriadas[0].fechada()).toBe(true)
    expect(m.d.canal.abertos()).toEqual([])
    expect(m.d.chamadas.sair).toBe(1)
    expect(m.d.video.tela.soltas).toBe(1)
    expect(m.r.container.querySelector('video, .tela-preta')).toBeNull()
    // a sessão revogada não chama mais a função (nem o `encerrar`, que o banco recusaria)
    expect(m.tipos()).toEqual(['oferta'])
  })

  test('revogado-por-reavaliacao: canal fechado e dispositivo sumido também desligam', async () => {
    const m = montar()
    await conectar(m)
    m.d.definirDispositivo(null)
    act(() => m.d.canal.definirEstado('estudio', 'negado'))
    await esperar()
    expect(screen.getByText(TEXTO_DO_DISPOSITIVO.revogado)).toBeTruthy()
    expect(m.d.video.camera.desligadas).toBe(1)
    expect(m.d.video.conexoesCriadas[0].fechada()).toBe(true)
    expect(m.d.canal.abertos()).toEqual([])
  })

  test('revogacao-do-par', async () => {
    const m = montar()
    await conectar(m)
    avisarEstudio(m, 'revogacao', { usuario: OBS })
    await esperar()
    expect(m.d.video.conexoesCriadas[0].fechada()).toBe(true)
    expect(m.ofertas()).toHaveLength(2)
    // a resposta do par revogado é descartada (15 min)
    responder(m, OBS)
    await esperar()
    expect(m.d.video.conexoesCriadas[1].respostasAceitas).toHaveLength(0)
    expect(screen.queryByText(TEXTO_DO_DISPOSITIVO.revogado)).toBeNull()
  })

  test('presenca-com-video', async () => {
    const m = montar()
    await esperar()
    const presenca = (estado: EstadoDoVideo, telaLigada: 'travada' | 'sem_trava' | null) => ({
      tipo: 'camera',
      dispositivoId: DISPOSITIVO,
      obs: null,
      video: { estado, telaLigada, bateria: null },
    })
    expect(m.d.canal.presencas('estudio')).toEqual([presenca('aguardando_toque', null)])
    // conectando → conectado (e a tela travada) em menos de 1 s: uma marcação a mais, no fim da janela de 10 s
    await tocar(m)
    responder(m)
    await esperar()
    expect(m.d.canal.presencas('estudio')).toHaveLength(1)
    await esperar(PRESENCA_MINIMA_MS - 500)
    expect(m.d.canal.presencas('estudio')).toHaveLength(1)
    await esperar(600)
    expect(m.d.canal.presencas('estudio')).toEqual([presenca('aguardando_toque', null), presenca('conectado', 'travada')])
    // queda breve dentro da janela nova: conectado → conectando → conectado; o corpo final é o já marcado
    m.d.video.conexoesCriadas[0].cair()
    await esperar()
    m.d.video.conexoesCriadas[0].conectar()
    await esperar()
    await esperar(PRESENCA_MINIMA_MS * 3)
    expect(m.d.canal.presencas('estudio')).toHaveLength(2)
    // fora da janela, uma mudança sai na hora
    await mudarEpisodio(m, null)
    expect(m.d.canal.presencas('estudio').at(-1)).toEqual(presenca('aguardando_episodio', 'travada'))
    expect(m.d.canal.presencas('estudio')).toHaveLength(3)
  })

  test('saida-da-pagina-desliga (desmontar)', async () => {
    const m = montar()
    await conectar(m)
    m.r.unmount()
    await esperar()
    expect(m.tipos()).toEqual(['oferta', 'encerrar'])
    expect(m.d.video.camera.desligadas).toBe(1)
    expect(m.d.video.camera.ligada()).toBe(false)
    expect(m.d.video.conexoesCriadas[0].fechada()).toBe(true)
    expect(m.d.video.tela.soltas).toBe(1)
    expect(m.d.canal.abertos()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  test('saida-da-pagina-desliga (pagehide)', async () => {
    const m = montar()
    await conectar(m)
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    await esperar()
    expect(m.tipos()).toEqual(['oferta', 'encerrar'])
    expect(m.d.video.camera.desligadas).toBe(1)
    expect(m.d.video.conexoesCriadas[0].fechada()).toBe(true)
    expect(m.d.video.tela.soltas).toBe(1)
    expect(m.d.canal.abertos()).toEqual([])
    // um toque depois do pagehide não religa nada
    await tocar(m)
    expect(m.d.video.camera.ligacoes).toBe(1)
  })

  test('pagina-restaurada-pede-toque (pageshow do cache de navegação)', async () => {
    const m = montar()
    await conectar(m)
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    await esperar()
    const volta = new Event('pageshow')
    Object.defineProperty(volta, 'persisted', { value: true })
    act(() => {
      window.dispatchEvent(volta)
    })
    await esperar()
    expect(screen.getByText(TEXTO_DA_CAMERA.aguardando_toque)).toBeTruthy()
    expect(m.d.canal.abertos()).toEqual(['estudio', VIDEO])
    expect(m.d.video.camera.ligacoes).toBe(1) // o consentimento não volta sozinho (D7)
    await tocar(m)
    expect(m.d.video.camera.ligacoes).toBe(2)
    expect(m.ofertas()).toHaveLength(2)
  })

  test('canal-de-video-so-com-episodio', async () => {
    const m = montar({ episodio: null })
    await esperar()
    await tocar(m)
    expect(m.criados(VIDEO)).toBe(0)
    // o episódio começa: abre o tópico da própria sessão e a câmera liga (consentimento da página)
    await mudarEpisodio(m, { id: EP, modo: 'teste' })
    expect(m.criados(VIDEO)).toBe(1)
    expect(m.d.canal.abertos()).toEqual(['estudio', VIDEO])
    expect(m.d.video.camera.ligacoes).toBe(1)
    expect(m.ofertas()).toHaveLength(1)
    // o episódio acaba: o canal de vídeo fecha
    await mudarEpisodio(m, null)
    expect(m.d.canal.abertos()).toEqual(['estudio'])
    // `negado` do canal de vídeo com o episódio já encerrado: nada de `canalPerdido` nem de reavaliação
    await mudarEpisodio(m, { id: EP, modo: 'teste' })
    expect(m.criados(VIDEO)).toBe(2)
    const avaliacoes = m.vezes('dispositivoAtual')
    m.d.definirEpisodioAtivo(null)
    act(() => m.d.canal.definirEstado(VIDEO, 'negado'))
    await esperar()
    await esperar(60_000)
    expect(m.vezes('dispositivoAtual')).toBe(avaliacoes)
    expect(m.criados(VIDEO)).toBe(2)
    expect(m.criados('estudio')).toBe(1)
    expect(m.d.canal.abertos()).toEqual(['estudio'])
    expect(m.d.video.camera.ligada()).toBe(false)
    // com episódio ativo, `negado` → `canalPerdido`: reavalia e reabre em 5 s
    await mudarEpisodio(m, { id: EP, modo: 'teste' })
    expect(m.criados(VIDEO)).toBe(3)
    act(() => m.d.canal.definirEstado(VIDEO, 'negado'))
    await esperar()
    expect(m.vezes('dispositivoAtual')).toBe(avaliacoes + 1)
    expect(m.d.canal.abertos()).toEqual([])
    await esperar(5000)
    expect(m.criados('estudio')).toBe(2)
    expect(m.criados(VIDEO)).toBe(4)
    expect(m.d.canal.abertos()).toEqual(['estudio', VIDEO])
  })

  test('voltar a ver com o estudio caído não abre o canal de vídeo (a reabertura consulta de novo)', async () => {
    const m = montar()
    await conectar(m)
    act(() => m.d.canal.definirEstado('estudio', 'fechado'))
    await esperar()
    expect(m.d.canal.abertos()).toEqual([])
    m.voltarAVer()
    await esperar()
    expect(m.criados(VIDEO)).toBe(1)
    expect(m.d.canal.abertos()).toEqual([])
    await esperar(5000)
    expect(m.d.canal.abertos()).toEqual(['estudio', VIDEO])
    expect(m.criados(VIDEO)).toBe(2)
  })

  test('sdp-nunca-no-console', async () => {
    const consoles = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((n) => vi.spyOn(console, n).mockImplementation(() => {}))
    const m = montar({ antes: (d) => (d.video.config.conectarSozinha = false) })
    await esperar()
    await falharDuasVezes(m)
    responder(m)
    await esperar()
    m.d.video.conexoesCriadas.at(-1)?.conectar()
    await esperar()
    await mudarEpisodio(m, null)
    m.r.unmount()
    await esperar()
    expect(m.ofertas().length).toBeGreaterThan(0)
    const tudo = JSON.stringify(consoles.map((c) => c.mock.calls))
    expect(tudo).not.toContain(m.d.video.sdpDaOferta)
    expect(tudo).not.toContain(m.d.video.sdpDaResposta)
    expect(tudo).not.toContain('v=0')
    expect(localStorage.length + sessionStorage.length).toBe(0)
    expect(JSON.stringify(m.d.canal.presencas('estudio'))).not.toContain('v=0')
  })

  test('voltar-a-ver-religa', async () => {
    const m = montar()
    await conectar(m)
    const consultas = m.episodioAtivo.mock.calls.length
    // com a página escondida, o episódio do teste acabou e outro entrou no ar
    m.d.definirEpisodioAtivo({ id: EP2, modo: 'ao_vivo' })
    m.voltarAVer()
    await esperar()
    expect(m.episodioAtivo.mock.calls.length).toBe(consultas + 1)
    expect(m.criados(VIDEO)).toBe(1) // o tópico é da sessão, não do episódio
    expect(m.d.canal.abertos()).toEqual(['estudio', VIDEO])
    expect(m.d.video.conexoesCriadas[0].fechada()).toBe(false)
    expect(m.ofertas()).toHaveLength(1)
    await tocar(m)
    expect(screen.getByText(TEXTO_DA_CAMERA.conectado)).toBeTruthy()
    // e voltar a ver sem episódio desliga
    m.d.definirEpisodioAtivo(null)
    m.voltarAVer()
    await esperar()
    expect(m.d.video.camera.ligada()).toBe(false)
    expect(m.d.canal.abertos()).toEqual(['estudio'])
  })
})
