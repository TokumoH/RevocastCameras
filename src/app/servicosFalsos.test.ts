import { describe, expect, test, vi } from 'vitest'
import { ErroDeDispositivo } from '../domains/acesso/portasDeDispositivo'
import type { FluxoDeVideo } from '../domains/captura/portas'
import { aoVivoVazio, criarCanalFalso, criarFalsos, criarFalsosDeDispositivo, criarVideoFalso } from './servicosFalsos'

const EU = '5a1c9e2b-7d3f-4b6a-8c1d-2e3f4a5b6c7d'
const OUTRO = '7b2d0f3c-8e4a-4c7b-9d2e-3f4a5b6c7d8e'
const DISP = '0b6f3c1e-2a4d-4f8b-9c7e-1d2e3f4a5b6c'
const CODIGO = 'Codigo_de_teste-0123456789abcdefghijKLMNOPQ'

/** Deixa os microtasks (conexão sozinha, ouvintes agendados) andarem. */
const tique = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('falsos do ao vivo (E3)', () => {
  test('canal-falso-segue-o-adaptador', async () => {
    const f = criarCanalFalso()
    expect(f.canais(EU)).toBe(f.canais(EU))
    const a = f.canais(EU).estudio()
    const b = f.canais(EU).estudio()
    const estados = vi.fn()
    const mb = vi.fn()
    a.aoMudarEstado(estados)
    b.aoReceber(mb)
    await tique()
    await tique()
    // conectando → conectado sozinho; um canal só para as duas alças
    expect(estados.mock.calls.map((c) => c[0])).toEqual(['conectando', 'conectado'])
    expect(f.realtime.contar('channel', 'estudio')).toBe(1)
    expect(f.abertos()).toEqual(['estudio'])

    // eco local e envio com remetente
    expect(await a.enviar({ evento: 'episodio_ativo_mudou' })).toBe('ok')
    await tique()
    expect(mb.mock.calls).toEqual([[{ evento: 'episodio_ativo_mudou' }, EU]])
    expect(f.enviados('estudio')).toEqual([{ event: 'episodio_ativo_mudou', payload: { remetente: EU } }])

    // entrega de fora: inválida descartada, válida chega
    f.entregar('estudio', 'revogacao', { usuario: 'X', remetente: OUTRO })
    f.entregar('estudio', 'revogacao', { usuario: DISP, remetente: OUTRO })
    await tique()
    expect(mb.mock.calls.at(-1)).toEqual([{ evento: 'revogacao', usuario: DISP }, OUTRO])
    expect(mb).toHaveBeenCalledTimes(2)

    // ack sem resposta e estados
    f.responderEnvio('sem_resposta')
    expect(await a.enviar({ evento: 'episodio_ativo_mudou' })).toBe('sem_resposta')
    f.definirEstado('estudio', 'reconectando')
    f.definirEstado('estudio', 'conectado')
    f.definirEstado('estudio', 'negado')
    await tique()
    expect(estados.mock.calls.map((c) => c[0])).toEqual(['conectando', 'conectado', 'reconectando', 'conectado', 'negado'])

    // presença marcada e sincronizada
    const c = f.canais(EU).estudio()
    await c.marcarPresenca({ tipo: 'membro', papel: 'equipe' })
    await tique()
    await tique()
    expect(f.presencas('estudio')).toEqual([{ tipo: 'membro', papel: 'equipe' }])
  })

  test('ao-vivo-vazio-e-dependencias', async () => {
    const vazio = aoVivoVazio()
    expect(await vazio.repo.episodioAtivo()).toBeNull()
    expect(await vazio.repo.listarDispositivos()).toEqual([])
    await expect(vazio.repo.criarCodigo({ tipo: 'camera', rotulo: 'x', dispositivoId: null, cameraId: null })).rejects.toMatchObject({ motivo: 'outro' })

    const f = criarFalsos()
    const dep = f.dependencias()
    expect(dep.obterAoVivo()).toBe(dep.obterAoVivo())
    expect(dep.obterDispositivo('obs_palco')).toBe(dep.obterDispositivo('obs_palco'))
    expect(dep.obterDispositivo('camera')).not.toBe(dep.obterDispositivo('obs_palco'))
    dep.limparFragmento()
    expect(f.chamadas.obterAoVivo).toBe(2)
    expect(f.chamadas.obterDispositivo).toEqual(['obs_palco', 'obs_palco', 'camera', 'obs_palco'])
    expect(f.chamadas.limparFragmento).toBe(1)
  })

  test('dispositivo-falso', async () => {
    const f = criarFalsosDeDispositivo()
    const s = f.servicos.servico
    expect(await s.sessaoAtual()).toBeNull()
    const { usuarioId } = await s.entrarAnonimo()
    expect(await s.dispositivoAtual()).toBeNull()
    expect(await s.parear(CODIGO, 'obs_palco')).toEqual({ resultado: 'pareado', dispositivo: { id: DISP, rotulo: 'Dispositivo de teste' } })
    expect(await s.sessaoAtual()).toEqual({ usuarioId, anonima: true })
    expect(await s.dispositivoAtual()).toEqual({ id: DISP, tipo: 'obs_palco', rotulo: 'Dispositivo de teste', cameraId: null })
    await s.sair()
    expect(await s.sessaoAtual()).toBeNull()
    const outro = await s.entrarAnonimo()
    expect(outro.usuarioId).not.toBe(usuarioId)
    expect(f.chamadas.ordem).toEqual(['sessaoAtual', 'entrarAnonimo', 'dispositivoAtual', 'parear', 'sessaoAtual', 'dispositivoAtual', 'sair', 'sessaoAtual', 'entrarAnonimo'])

    f.responderPareamento({ resultado: 'tipo_errado', dispositivo: null })
    expect(await s.parear(CODIGO, 'camera')).toEqual({ resultado: 'tipo_errado', dispositivo: null })
    f.falharProxima('sessaoAtual', new ErroDeDispositivo('rede'))
    await expect(s.sessaoAtual()).rejects.toMatchObject({ motivo: 'rede' })
    expect(await s.sessaoAtual()).not.toBeNull()

    // palco: URL assinada falsa, registro anotado, episódio sem carga → invalido
    expect(await f.servicos.palco.urlDoArquivo('som/x.mp3')).toBe('https://armazenamento.revocast.test/assinada/som/x.mp3?token=teste')
    await expect(f.servicos.palco.carregar(DISP)).rejects.toMatchObject({ motivo: 'invalido' })
    expect(f.servicos.canais(EU)).toBe(f.servicos.canais(EU))
  })
})

const SESSAO = '3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b'
const SDP = 'v=0\r\no=- 1 2 IN IP4 192.0.2.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n'

describe('falsos do vídeo (E4)', () => {
  test('canal-de-video-falso: recebe no tópico da sessão e envia pela rpc', async () => {
    const f = criarCanalFalso()
    const camera = f.canais(EU).videoDaCamera()
    const estados = vi.fn()
    const sinais = vi.fn()
    camera.aoMudarEstado(estados)
    camera.aoSinal(sinais)
    await tique()
    await tique()
    expect(f.abertos()).toEqual([`video:${EU}`])
    expect(estados.mock.calls.map((c) => c[0])).toEqual(['conectando', 'conectado'])
    expect(await camera.enviar({ tipo: 'oferta', sessao: SESSAO, sdp: SDP })).toBe('ok')
    expect(f.sinaisDeVideo()).toEqual([{ p_tipo: 'oferta', p_sessao: SESSAO, p_sdp: SDP }])
    expect(f.enviados(`video:${EU}`)).toEqual([]) // nada pelo Broadcast
    f.responderSinal('sem_par')
    expect(await camera.enviar({ tipo: 'encerrar', sessao: SESSAO })).toBe('sem_par')
    f.responderSinal('limite')
    expect(await camera.enviar({ tipo: 'encerrar', sessao: SESSAO })).toBe('limite')
    f.responderSinal('falhou')
    expect(await camera.enviar({ tipo: 'encerrar', sessao: SESSAO })).toBe('falhou')
    f.entregar(`video:${EU}`, 'sinal', { tipo: 'resposta', sessao: SESSAO, sdp: SDP, remetente: OUTRO, id: DISP })
    await tique()
    expect(sinais.mock.calls).toEqual([[{ tipo: 'resposta', sessao: SESSAO, sdp: SDP }, OUTRO]])
  })

  test('criarVideoFalso: conexão', async () => {
    const v = criarVideoFalso()
    // lado da câmera: oferece, aceita a resposta e passa sozinha por conectando → conectado
    const c = v.conexoes.criar()
    const estados: string[] = []
    c.aoMudar((e) => estados.push(e))
    expect(await c.oferecer({} as never)).toBe(v.sdpDaOferta)
    await c.aceitarResposta(SDP)
    await tique()
    expect(estados).toEqual(['conectando', 'conectado'])
    const falsa = v.conexoesCriadas[0]
    expect(falsa.respostasAceitas).toEqual([SDP])
    // cair e falhar
    falsa.cair()
    falsa.falhar()
    await tique()
    expect(estados).toEqual(['conectando', 'conectado', 'caiu', 'falhou'])
    expect(await c.trocarFaixa({} as never)).toBe(true)
    v.config.trocaDaFaixa = false
    expect(await c.trocarFaixa({} as never)).toBe(false)
    c.fechar()
    expect(falsa.fechada()).toBe(true)
    falsa.conectar()
    await tique()
    expect(estados).toHaveLength(4) // fechada: nada mais

    // lado do obs_camera: responde, recebe o vídeo e conecta; sem conexão sozinha, só quando o teste mandar
    v.config.conectarSozinha = false
    const r = v.conexoes.criar()
    const er: string[] = []
    const fluxos: FluxoDeVideo[] = []
    r.aoMudar((e) => er.push(e))
    r.aoVideo((f) => fluxos.push(f))
    expect(await r.responder(SDP)).toBe(v.sdpDaResposta)
    await tique()
    expect(er).toEqual([])
    v.conexoesCriadas[1].conectar()
    await tique()
    expect(er).toEqual(['conectando', 'conectado'])
    expect(fluxos).toEqual([v.fluxoRecebido])
    expect(v.conexoesCriadas[1].ofertasRespondidas).toEqual([SDP])
  })

  test('criarVideoFalso: câmera, tela e bateria', async () => {
    const v = criarVideoFalso()
    const camera = v.aparelho.camera()
    expect(v.camera.criadas).toBe(1) // uma câmera nova a cada chamada, como a composição real
    const perdida = vi.fn()
    camera.aoPerderFaixa(perdida)
    expect(camera.fluxoDaPrevia()).toBeNull()
    const r = await camera.ligar()
    expect(r.ok).toBe(true)
    expect(v.camera.ligada()).toBe(true)
    expect(camera.fluxoDaPrevia()).toBe(v.fluxoDaCamera)
    v.camera.perder()
    await tique()
    expect(perdida).toHaveBeenCalledTimes(1)
    camera.desligar()
    expect(v.camera.ligada()).toBe(false)
    expect(camera.fluxoDaPrevia()).toBeNull()
    v.camera.proxima = 'sem_permissao'
    expect(await camera.ligar()).toEqual({ ok: false, motivo: 'sem_permissao' })
    expect(v.camera.ligacoes).toBe(2)
    expect(v.camera.desligadas).toBe(1)
    // outra câmera: estado próprio; perder() vale para a última criada
    const outra = v.aparelho.camera()
    expect(v.camera.criadas).toBe(2)
    v.camera.proxima = null
    await outra.ligar()
    expect(outra.fluxoDaPrevia()).toBe(v.fluxoDaCamera)
    expect(camera.fluxoDaPrevia()).toBeNull()
    v.camera.perder()
    await tique()
    expect(perdida).toHaveBeenCalledTimes(1)

    const tela = v.aparelho.tela()
    expect(v.tela.criadas).toBe(1)
    expect(await tela.travar()).toBe('travada')
    v.tela.proxima = 'sem_trava'
    expect(await tela.travar()).toBe('sem_trava')
    tela.soltar()
    expect(v.tela.travadas).toBe(2)
    expect(v.tela.soltas).toBe(1)

    expect(await v.aparelho.bateria()).toBeNull()
    v.definirBateria(0.5)
    expect(await v.aparelho.bateria()).toBe(0.5)

    // VER-052: o navegador tem WebRTC por padrão; `config.videoDireto = false` imita um sem `RTCPeerConnection`
    expect(v.aparelho.videoDireto()).toBe(true)
    v.config.videoDireto = false
    expect(v.aparelho.videoDireto()).toBe(false)
  })

  test('dispositivo-falso-com-video', () => {
    const d = criarFalsosDeDispositivo()
    expect(d.servicos.conexoes).toBe(d.video.conexoes)
    expect(d.servicos.aparelho).toBe(d.video.aparelho)
    expect(typeof d.servicos.canais(EU).videoDaObs).toBe('function')
  })
})

const EP = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
const GESTO_ID = '6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e'

describe('falsos dos gestos (E5)', () => {
  test('gestos-falsos: canal de gestos, repositório e reconhecedor com o que as telas precisam', async () => {
    // canal de gestos pelo adaptador real: só recebe em gestos:<uid>, nada pelo Broadcast
    const f = criarCanalFalso()
    const palco = f.canais(EU).gestosDoPalco()
    const disp = f.canais(EU).gestos()
    const gestos = vi.fn()
    const avisos = vi.fn()
    const estados = vi.fn()
    palco.aoGesto(gestos)
    disp.aoAviso(avisos)
    disp.aoMudarEstado(estados)
    await tique()
    await tique()
    expect(f.abertos()).toEqual([`gestos:${EU}`])
    expect(estados.mock.calls.map((c) => c[0])).toEqual(['conectando', 'conectado'])
    f.entregar(`gestos:${EU}`, 'gesto', { tipo: 'gesto', gesto_id: GESTO_ID, gesto: 'ILoveYou', dispositivo: DISP, remetente: OUTRO, id: SESSAO })
    f.entregar(`gestos:${EU}`, 'gestos_mudaram', { tipo: 'gestos_mudaram', remetente: OUTRO, id: SESSAO })
    await tique()
    expect(gestos.mock.calls).toEqual([[{ id: GESTO_ID, gesto: 'ILoveYou', dispositivoId: DISP }, OUTRO]])
    expect(avisos).toHaveBeenCalledTimes(1)
    expect(f.enviados(`gestos:${EU}`)).toEqual([])
    expect(f.presencas(`gestos:${EU}`)).toEqual([])

    // repositório dos gestos do dispositivo: situação programável, envios anotados, resposta programável
    const d = criarFalsosDeDispositivo()
    expect(d.servicos.gestos).toBe(d.gestos.repo)
    expect(await d.servicos.gestos.situacao()).toEqual({ ligados: true, reconhecerAqui: true })
    d.gestos.situacao.ligados = false
    expect(await d.servicos.gestos.situacao()).toEqual({ ligados: false, reconhecerAqui: true })
    expect(await d.servicos.gestos.enviar({ id: GESTO_ID, gesto: 'Victory' })).toBe('enviado')
    d.gestos.responderCom(async () => 'intervalo')
    expect(await d.servicos.gestos.enviar({ id: GESTO_ID, gesto: 'Victory' })).toBe('intervalo')
    expect(d.gestos.enviados).toEqual([
      { id: GESTO_ID, gesto: 'Victory' },
      { id: GESTO_ID, gesto: 'Victory' },
    ])
    expect(typeof d.servicos.canais(EU).gestos).toBe('function')
    expect(typeof d.servicos.canais(EU).gestosDoPalco).toBe('function')

    // reconhecedor falso (o worker do MediaPipe não roda no jsdom): nasce só no `criar`, inicia e reconhece pelo relógio do teste
    const r = d.reconhecedores
    expect(r.criados).toEqual([])
    const reconhecedor = r.fabrica.criar()
    expect(await reconhecedor.iniciar()).toEqual({ ok: true })
    r.config.gesto = 'ILoveYou'
    const leitura = reconhecedor.reconhecer({} as Parameters<typeof reconhecedor.reconhecer>[0], 0)
    await vi.waitFor(async () => expect(await leitura).toEqual({ gesto: 'ILoveYou', confianca: 0.9, ms: 20 }))
    reconhecedor.fechar()
    expect(r.registro).toEqual(['criar#0', 'iniciar#0', 'fechar#0'])
    r.config.iniciar = 'sem_suporte'
    expect(await r.fabrica.criar().iniciar()).toEqual({ ok: false, motivo: 'sem_suporte' })

    // ao vivo vazio: o interruptor devolve o valor pedido; onde reconhecer resolve sem efeito
    const vazio = aoVivoVazio()
    expect(await vazio.repo.definirGestosLigados(EP, true)).toBe(true)
    expect(await vazio.repo.definirGestosLigados(EP, false)).toBe(false)
    await expect(vazio.repo.definirReconhecimento(DISP, 'computador')).resolves.toBeUndefined()
  })
})
