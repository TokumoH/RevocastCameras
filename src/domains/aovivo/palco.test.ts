import { describe, test, expect } from 'vitest'
import { INTERVALO_DO_SERVIDOR_MS, INTERVALO_MS, lerGestoParaOPalco, type GestoRecebido } from '../captura/gestos'
import type { Gesto, LinhaDoMapa } from '../preparacao/gestos'
import type { AcaoNoObs, LinhaDoRegistro } from './comandos'
import type { Comando, EstadoNoAr, MotivoDoResultado, ResultadoDoComando, SituacaoDoObs } from './mensagens'
import { Revogados, lerEstadoNoAr, lerMensagemDoControle, lerRemetente } from './mensagens'
import { ESTADO_A_CADA_MS, RELEITURA_MINIMA_MS, criarPalco } from './palco'
import type { CanalDeGestosDoPalco, CanalDoControle, CanalDoEstado, EstadoDoCanal, ExecutorDeAcoes, RepositorioDoPalco } from './portas'

const EPISODIO = 'e0000000-0000-4000-8000-000000000001'
const EU = 'a0000000-0000-4000-8000-0000000000aa'
const ANA = 'a0000000-0000-4000-8000-000000000001'
const BIA = 'a0000000-0000-4000-8000-000000000002'
const CENA_A = 'c0000000-0000-4000-8000-00000000000a'
const CENA_B = 'c0000000-0000-4000-8000-00000000000b'
const SOM = '50000000-0000-4000-8000-000000000001'
const AVISO_1 = 'f0000000-0000-4000-8000-000000000001'
const AVISO_2 = 'f0000000-0000-4000-8000-000000000002'
const SOM_INEXISTENTE = '50000000-0000-4000-8000-0000000000ff'
/** A sessão anônima da câmera (o `remetente` que o banco põe no gesto) e o id do dispositivo (o `dispositivo`, D2). */
const CAMERA = 'b0000000-0000-4000-8000-0000000000c1'
const DISPOSITIVO = '0d000000-0000-4000-8000-0000000000d1'

/** O mapa padrão dos testes (uma linha por gesto, como a tabela `mapa_gestos`). */
const MAPA: LinhaDoMapa[] = [
  { gesto: 'ILoveYou', acao: 'clipe', cenaId: null, somId: null },
  { gesto: 'Closed_Fist', acao: 'marcador', cenaId: null, somId: null },
  { gesto: 'Victory', acao: 'proxima_cena', cenaId: null, somId: null },
  { gesto: 'Thumb_Up', acao: 'som', cenaId: null, somId: SOM },
  { gesto: 'Thumb_Down', acao: 'nenhuma', cenaId: null, somId: null },
  { gesto: 'Pointing_Up', acao: 'proximo_aviso', cenaId: null, somId: null },
  { gesto: 'Open_Palm', acao: 'ocultar_aviso', cenaId: null, somId: null },
]

let sequencia = 0
const novoId = () => `d0000000-0000-4000-8000-${String(++sequencia).padStart(12, '0')}`

type Dados = Awaited<ReturnType<RepositorioDoPalco['carregar']>>
const DADOS: Dados = {
  episodio: { id: EPISODIO, titulo: 'Episódio de teste', data: '2026-11-27', estado: 'rascunho', gestosLigados: false },
  cenas: [
    { id: CENA_A, nomeExibicao: 'Abertura', nomeObs: 'Abertura', ordem: 0 },
    { id: CENA_B, nomeExibicao: 'Conversa', nomeObs: 'Conversa', ordem: 1 },
  ],
  sons: [{ id: SOM, midiaId: '60000000-0000-4000-8000-000000000001', rotulo: 'Aplauso', emoji: null, volume: 0.8, ordem: 0, caminho: 'som/x.mp3' }],
  avisos: [
    { id: AVISO_1, episodioId: EPISODIO, titulo: 'A1', texto: 't', link: null, imagemMidiaId: null, duracaoS: 10, ordem: 0, caminhoDaImagem: null },
    { id: AVISO_2, episodioId: EPISODIO, titulo: 'A2', texto: 't', link: null, imagemMidiaId: null, duracaoS: 20, ordem: 1, caminhoDaImagem: null },
  ],
  mapa: MAPA,
}

/** A carga com o interruptor ligado (e, se dado, outro mapa). */
const ligados = (mapa: LinhaDoMapa[] = MAPA): Dados => ({ ...DADOS, episodio: { ...DADOS.episodio, gestosLigados: true }, mapa })

const SITUACAO: SituacaoDoObs = { navegador: true, versaoDoPlugin: '2.24.0', nivel: 4, websocket: 'conectado', versaoObs: '31.0.1', replayBuffer: true, gravando: true }

function canalFalso(o: { rejeitar?: boolean } = {}) {
  const comandos = new Set<(c: Comando, r: string) => void>()
  const entradas = new Set<() => void>()
  const presencas = new Set<(u: string[]) => void>()
  const publicados: EstadoNoAr[] = []
  let tratadas = 0
  let comandosEnviados = 0
  // VER-047: o `:controle` só leva comandos (o palco não envia nada aqui); o estado vai pelo `:estado`
  const canal: CanalDoControle = {
    aoComando: (f) => {
      comandos.add(f)
      return () => comandos.delete(f)
    },
    aoEntrarAlguem: (f) => {
      entradas.add(f)
      return () => entradas.delete(f)
    },
    aoMudarPresentes: (f) => {
      presencas.add(f)
      return () => presencas.delete(f)
    },
    aoMudarEstado: () => () => {},
    enviarComando: async () => {
      comandosEnviados++
      return 'ok'
    },
    marcarPresenca: async () => {},
    fechar: async () => {},
  }
  const estado: CanalDoEstado = {
    aoEstado: () => () => {},
    aoMudarEstado: () => () => {},
    publicarEstado: (e) => {
      publicados.push(structuredClone(e))
      if (!o.rejeitar) return Promise.resolve('ok')
      // rejeição cujo tratamento é contado (o palco tem de pôr um `.catch`)
      const p = Promise.reject(new Error('canal caiu'))
      const catchOriginal = p.catch.bind(p)
      p.catch = ((f) => {
        tratadas++
        return catchOriginal(f)
      }) as typeof p.catch
      return p
    },
    fechar: async () => {},
  }
  return {
    canal,
    estado,
    publicados,
    comandosEnviados: () => comandosEnviados,
    /** Entrega como o adaptador entregaria (o palco confere de novo). */
    comando: (c: unknown, remetente: string) => {
      for (const f of comandos) f(c as Comando, remetente)
    },
    entrar: () => {
      for (const f of entradas) f()
    },
    /** A presença do `:controle` passa a ser `usuarios` (como o `sync` do adaptador). */
    presenca: (usuarios: string[]) => {
      for (const f of presencas) f([...usuarios])
    },
    ouvintes: () => comandos.size + entradas.size + presencas.size,
    tratadas: () => tratadas,
  }
}

/** O payload de um gesto como o `realtime.send` de `enviar_gesto` o entrega (D2): montado no servidor, com o `id` do próprio send. */
function payloadDoGesto(gesto: Gesto, o: { id?: string; dispositivo?: string; remetente?: string } = {}) {
  return { tipo: 'gesto', gesto_id: o.id ?? novoId(), gesto, dispositivo: o.dispositivo ?? DISPOSITIVO, remetente: o.remetente ?? CAMERA, id: novoId() }
}

/**
 * Canal `gestos:<uid do palco>` falso: `entregar` passa pelo leitor real (`lerGestoParaOPalco` e `lerRemetente`), como o
 * adaptador da Tarefa 4; `direto` entrega ao palco sem leitor (um adaptador com defeito), para provar que o palco confere de novo.
 */
function canalDeGestosFalso() {
  const gestos = new Set<(g: GestoRecebido, r: string) => void>()
  const avisos = new Set<() => void>()
  const estados = new Set<(e: EstadoDoCanal) => void>()
  const canal: CanalDeGestosDoPalco = {
    aoGesto: (f) => {
      gestos.add(f)
      return () => gestos.delete(f)
    },
    aoAviso: (f) => {
      avisos.add(f)
      return () => avisos.delete(f)
    },
    aoMudarEstado: (f) => {
      estados.add(f)
      return () => estados.delete(f)
    },
    fechar: async () => {},
  }
  return {
    canal,
    /** O tópico muda de estado (assinatura, queda, volta), como o adaptador avisaria. */
    estado(e: EstadoDoCanal) {
      for (const f of estados) f(e)
    },
    entregar(evento: string, payload: unknown) {
      const g = lerGestoParaOPalco(evento, payload)
      const remetente = lerRemetente(payload)
      if (g === null || remetente === null) return
      for (const f of gestos) f(g, remetente)
    },
    gesto(gesto: Gesto, o: Parameters<typeof payloadDoGesto>[1] = {}) {
      this.entregar('gesto', payloadDoGesto(gesto, o))
    },
    direto(g: unknown, remetente: string) {
      for (const f of gestos) f(g as GestoRecebido, remetente)
    },
    aviso() {
      for (const f of avisos) f()
    },
    ouvintes: () => gestos.size + avisos.size + estados.size,
  }
}

function executorFalso(
  respostas: Partial<Record<AcaoNoObs['tipo'], { resultado: ResultadoDoComando; motivo: MotivoDoResultado | null }>> = {},
  o: { lancar?: AcaoNoObs['tipo'][]; situacao?: SituacaoDoObs } = {},
) {
  const executadas: AcaoNoObs[] = []
  const seguradas: (() => void)[] = []
  let segurarClipe = false
  let segurarTudo = false
  const executor: ExecutorDeAcoes = {
    executar: async (a) => {
      executadas.push(a)
      const r = respostas[a.tipo] ?? { resultado: 'ok', motivo: null }
      if (segurarTudo || (a.tipo === 'salvar_clipe' && segurarClipe)) {
        await new Promise<void>((resolver) => seguradas.push(resolver))
      }
      if (o.lancar?.includes(a.tipo)) throw new Error('o navegador recusou o play()')
      return r
    },
    situacao: () => ({ ...(o.situacao ?? SITUACAO) }),
  }
  return {
    executor,
    executadas,
    segurarClipe: () => {
      segurarClipe = true
    },
    segurarTudo: () => {
      segurarTudo = true
    },
    soltar: () => {
      for (const s of seguradas.splice(0)) s()
    },
  }
}

function repoFalso(falhar = false) {
  const registros: LinhaDoRegistro[] = []
  const leiturasDoInterruptor: string[] = []
  /** O valor de `gestos_ligados` no banco (o que `gestosLigados()` devolve). */
  let interruptor = false
  const repo: RepositorioDoPalco = {
    episodioAtivo: async () => ({ id: EPISODIO, modo: 'ao_vivo' }),
    carregar: async () => DADOS,
    urlDoArquivo: async () => 'https://exemplo.invalid/x',
    registrar: async (l) => {
      registros.push(l)
      if (falhar) throw new Error('rede')
    },
    gestosLigados: async (episodioId) => {
      leiturasDoInterruptor.push(episodioId)
      return interruptor
    },
  }
  return {
    repo,
    registros,
    leiturasDoInterruptor,
    definirInterruptor(v: boolean) {
      interruptor = v
    },
  }
}

/** Relógio falso: `agora` e `agendarRepeticao` (repete até cancelar). */
function relogioFalso() {
  let agora = 1_000_000
  let tarefas: { proxima: number; ms: number; f: () => void; viva: boolean }[] = []
  return {
    agora: () => agora,
    agendarRepeticao: (f: () => void, ms: number) => {
      const t = { proxima: agora + ms, ms, f, viva: true }
      tarefas.push(t)
      return () => {
        t.viva = false
      }
    },
    avancar(ms: number) {
      const fim = agora + ms
      for (;;) {
        const vivas = tarefas.filter((t) => t.viva && t.proxima <= fim).sort((a, b) => a.proxima - b.proxima)
        if (vivas.length === 0) break
        const t = vivas[0]
        agora = t.proxima
        t.proxima += t.ms
        t.f()
      }
      agora = fim
      tarefas = tarefas.filter((t) => t.viva)
    },
    vivas: () => tarefas.filter((t) => t.viva).length,
  }
}

const esvaziar = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

function montar(
  o: {
    modo?: 'ao_vivo' | 'teste'
    respostas?: Parameters<typeof executorFalso>[0]
    executor?: Parameters<typeof executorFalso>[1]
    falharRegistro?: boolean
    rejeitarPublicacao?: boolean
    dados?: Dados
    /** Quem está na presença do `:controle` ao começar (padrão: ANA e BIA, membros). */
    presentes?: string[]
    recarregarDados?: () => Promise<Dados | null>
  } = {},
) {
  const canal = canalFalso({ rejeitar: o.rejeitarPublicacao })
  const gestos = canalDeGestosFalso()
  const exec = executorFalso(o.respostas, o.executor)
  const repo = repoFalso(o.falharRegistro)
  // o banco começa com o mesmo interruptor da carga (o palco relê logo depois de assinar o tópico de gestos)
  repo.definirInterruptor((o.dados ?? DADOS).episodio.gestosLigados === true)
  const relogio = relogioFalso()
  const revogados = new Revogados(relogio.agora)
  const palco = criarPalco({
    canal: canal.canal,
    canalDoEstado: canal.estado,
    canalDeGestos: gestos.canal,
    repo: repo.repo,
    executor: exec.executor,
    revogados,
    episodio: { id: EPISODIO, modo: o.modo ?? 'ao_vivo' },
    dados: o.dados ?? DADOS,
    meuUsuario: EU,
    agendarRepeticao: relogio.agendarRepeticao,
    agora: relogio.agora,
    recarregarDados: o.recarregarDados,
  })
  canal.presenca(o.presentes ?? [ANA, BIA])
  return { palco, canal, gestos, exec, repo, relogio, revogados }
}

describe('serviço do palco (D9)', () => {
  test('constante do estado periódico', () => {
    expect(ESTADO_A_CADA_MS).toBe(30_000)
  })

  test('comando-valido-executa', async () => {
    const m = montar()
    const id = novoId()
    m.canal.comando({ id, acao: 'cena', cenaId: CENA_B }, ANA)
    await esvaziar()
    expect(m.exec.executadas).toEqual([{ tipo: 'trocar_cena', nomeObs: 'Conversa', cenaId: CENA_B }])
    expect(m.palco.estado().cenaObs).toBe('Conversa')
    expect(m.palco.estado().ultimo).toEqual({ comandoId: id, acao: 'cena', resultado: 'ok', motivo: null, origem: 'toque', gesto: null })
  })

  test('comando-invalido-descartado', async () => {
    const m = montar()
    const antes = m.canal.publicados.length
    const mudancas: EstadoNoAr[] = []
    m.palco.aoMudar((e) => mudancas.push(e))
    m.canal.comando({ id: novoId(), acao: 'cena', cenaId: CENA_B, extra: 1 }, ANA)
    m.canal.comando({ id: novoId().toUpperCase(), acao: 'clipe' }, ANA)
    m.canal.comando({ id: novoId(), acao: 'apagar_tudo' }, ANA)
    m.canal.comando(JSON.parse(`{"__proto__":{"x":1},"id":"${novoId()}","acao":"clipe"}`), ANA)
    m.canal.comando({ id: novoId(), acao: 'clipe' }, 'nao-e-uuid')
    await esvaziar()
    expect(m.exec.executadas).toEqual([])
    expect(m.repo.registros).toEqual([])
    expect(m.canal.publicados.length).toBe(antes)
    expect(mudancas).toEqual([])
    expect(m.palco.estado().ultimo).toBeNull()
  })

  test('comando-duplicado', async () => {
    const m = montar()
    const id = novoId()
    m.canal.comando({ id, acao: 'som', somId: SOM }, ANA)
    await esvaziar()
    m.canal.comando({ id, acao: 'som', somId: SOM }, BIA)
    await esvaziar()
    expect(m.exec.executadas).toHaveLength(1)
    expect(m.repo.registros).toHaveLength(1)
    // os últimos 200 ids são lembrados: o 1º sai depois de 200 outros
    for (let i = 0; i < 200; i++) m.canal.comando({ id: novoId(), acao: 'marcador' }, ANA)
    await esvaziar()
    m.canal.comando({ id, acao: 'som', somId: SOM }, ANA)
    await esvaziar()
    expect(m.exec.executadas.filter((a) => a.tipo === 'tocar_som')).toHaveLength(2)
  })

  test('remetente-revogado', async () => {
    const m = montar()
    m.revogados.revogar(ANA)
    const antes = m.canal.publicados.length
    m.canal.comando({ id: novoId(), acao: 'clipe' }, ANA)
    await esvaziar()
    expect(m.exec.executadas).toEqual([])
    expect(m.canal.publicados.length).toBe(antes)
    m.canal.comando({ id: novoId(), acao: 'marcador' }, BIA)
    await esvaziar()
    expect(m.exec.executadas).toHaveLength(1)
  })

  test('som-inexistente', async () => {
    const m = montar()
    const id = novoId()
    const antes = m.canal.publicados.length
    m.canal.comando({ id, acao: 'som', somId: SOM_INEXISTENTE }, ANA)
    await esvaziar()
    expect(m.exec.executadas).toEqual([])
    expect(m.canal.publicados.length).toBe(antes + 1)
    expect(m.canal.publicados.at(-1)?.ultimo).toEqual({ comandoId: id, acao: 'som', resultado: 'recusado', motivo: 'som_inexistente', origem: 'toque', gesto: null })
  })

  test('estado-apos-comando', async () => {
    const m = montar()
    const inicial = m.canal.publicados.length
    expect(inicial).toBe(1)
    expect(m.canal.publicados[0]).toEqual({ episodioId: EPISODIO, modo: 'ao_vivo', cenaObs: null, avisoId: null, avisoAte: null, ultimo: null, obs: SITUACAO, gestosLigados: false })
    const id = novoId()
    m.canal.comando({ id, acao: 'aviso', avisoId: AVISO_2 }, ANA)
    await esvaziar()
    expect(m.canal.publicados.length).toBe(inicial + 1)
    expect(m.canal.publicados.at(-1)).toEqual({
      episodioId: EPISODIO,
      modo: 'ao_vivo',
      cenaObs: null,
      avisoId: AVISO_2,
      avisoAte: 1_000_000 + 20_000,
      ultimo: { comandoId: id, acao: 'aviso', resultado: 'ok', motivo: null, origem: 'toque', gesto: null },
      obs: SITUACAO,
      gestosLigados: false,
    })
    // a falha do executor também é publicada, com o motivo da lista
    const f = montar({ respostas: { salvar_clipe: { resultado: 'falhou', motivo: 'replay_desligado' } } })
    const idClipe = novoId()
    f.canal.comando({ id: idClipe, acao: 'clipe' }, ANA)
    await esvaziar()
    expect(f.canal.publicados.at(-1)?.ultimo).toEqual({ comandoId: idClipe, acao: 'clipe', resultado: 'falhou', motivo: 'replay_desligado', origem: 'toque', gesto: null })
    expect(f.repo.registros).toEqual([])
  })

  test('clipe-pendente-depois-ok', async () => {
    const m = montar()
    m.exec.segurarClipe()
    const id = novoId()
    m.canal.comando({ id, acao: 'clipe' }, ANA)
    await esvaziar()
    expect(m.canal.publicados.at(-1)?.ultimo).toEqual({ comandoId: id, acao: 'clipe', resultado: 'pendente', motivo: null, origem: 'toque', gesto: null })
    expect(m.repo.registros).toEqual([])
    // outro comando no meio não espera o clipe
    m.canal.comando({ id: novoId(), acao: 'cena', cenaId: CENA_A }, ANA)
    await esvaziar()
    expect(m.palco.estado().cenaObs).toBe('Abertura')
    m.exec.soltar()
    await esvaziar()
    expect(m.canal.publicados.at(-1)?.ultimo).toEqual({ comandoId: id, acao: 'clipe', resultado: 'ok', motivo: null, origem: 'toque', gesto: null })
    expect(m.repo.registros.map((r) => r.acao)).toEqual(['cena', 'clipe'])
  })

  test('estado-a-cada-30s', async () => {
    const m = montar()
    const inicial = m.canal.publicados.length
    m.relogio.avancar(29_999)
    expect(m.canal.publicados.length).toBe(inicial)
    m.relogio.avancar(1)
    expect(m.canal.publicados.length).toBe(inicial + 1)
    m.relogio.avancar(30_000)
    expect(m.canal.publicados.length).toBe(inicial + 2)
  })

  test('estado-ao-entrar-alguem', async () => {
    const m = montar()
    const inicial = m.canal.publicados.length
    m.canal.entrar()
    expect(m.canal.publicados.length).toBe(inicial + 1)
    expect(m.canal.publicados.at(-1)).toEqual(m.palco.estado())
  })

  test('estado-so-em-topico-proprio (VER-047)', async () => {
    // o estado sai pelo `:estado` (o único tópico em que o palco tem envio, pela RLS) e nada vai ao `:controle`
    const m = montar()
    m.canal.entrar()
    m.canal.comando({ id: novoId(), acao: 'cena', cenaId: CENA_B }, ANA)
    await esvaziar()
    m.relogio.avancar(ESTADO_A_CADA_MS)
    expect(m.canal.publicados.length).toBeGreaterThanOrEqual(4)
    expect(m.canal.comandosEnviados()).toBe(0)
  })

  test('republicar', async () => {
    // a rota chama ao voltar a `conectado` (Tarefa 6): o estado sai de novo, com a situação do OBS lida agora
    let situacao: SituacaoDoObs = { ...SITUACAO, gravando: false }
    const m = montar({ executor: { situacao } })
    const inicial = m.canal.publicados.length
    const mudancas: EstadoNoAr[] = []
    m.palco.aoMudar((e) => mudancas.push(e))
    situacao = { ...SITUACAO, gravando: true }
    m.exec.executor.situacao = () => ({ ...situacao })
    m.palco.republicar()
    expect(m.canal.publicados.length).toBe(inicial + 1)
    expect(m.canal.publicados.at(-1)?.obs.gravando).toBe(true)
    expect(mudancas).toEqual([]) // só o canal: a tela não muda
    m.palco.parar()
    m.palco.republicar()
    expect(m.canal.publicados.length).toBe(inicial + 1)
  })

  test('registro-com-teste', async () => {
    const m = montar({ modo: 'teste' })
    m.canal.comando({ id: novoId(), acao: 'proxima_cena' }, ANA)
    await esvaziar()
    m.canal.comando({ id: novoId(), acao: 'aviso', avisoId: AVISO_1 }, BIA)
    await esvaziar()
    m.canal.comando({ id: novoId(), acao: 'cena', cenaId: SOM_INEXISTENTE }, ANA)
    m.canal.comando({ id: novoId(), acao: 'som', somId: SOM_INEXISTENTE }, ANA)
    await esvaziar()
    expect(m.repo.registros).toEqual([
      { episodioId: EPISODIO, origem: 'toque', acao: 'proxima_cena', cenaId: CENA_A, somId: null, avisoId: null, membroId: ANA, teste: true },
      { episodioId: EPISODIO, origem: 'toque', acao: 'proximo_aviso', cenaId: null, somId: null, avisoId: AVISO_1, membroId: BIA, teste: true },
    ])
    const aoVivo = montar({ modo: 'ao_vivo' })
    aoVivo.canal.comando({ id: novoId(), acao: 'som', somId: SOM }, ANA)
    await esvaziar()
    expect(aoVivo.repo.registros).toEqual([{ episodioId: EPISODIO, origem: 'toque', acao: 'som', cenaId: null, somId: SOM, avisoId: null, membroId: ANA, teste: false }])
    expect(aoVivo.palco.estado().modo).toBe('ao_vivo')
    expect(m.palco.estado().modo).toBe('teste')
  })

  test('registro-falha-nao-para', async () => {
    const m = montar({ falharRegistro: true })
    const id = novoId()
    m.canal.comando({ id, acao: 'som', somId: SOM }, ANA)
    await esvaziar()
    expect(m.repo.registros).toHaveLength(1)
    expect(m.palco.estado().ultimo).toEqual({ comandoId: id, acao: 'som', resultado: 'ok', motivo: null, origem: 'toque', gesto: null })
    m.canal.comando({ id: novoId(), acao: 'cena', cenaId: CENA_B }, ANA)
    await esvaziar()
    expect(m.exec.executadas).toHaveLength(2)
    expect(m.palco.estado().cenaObs).toBe('Conversa')
  })

  test('aviso-expira', async () => {
    const m = montar()
    m.canal.comando({ id: novoId(), acao: 'aviso', avisoId: AVISO_1 }, ANA)
    await esvaziar()
    expect(m.palco.estado().avisoId).toBe(AVISO_1)
    m.relogio.avancar(9_999)
    await esvaziar()
    expect(m.palco.estado().avisoId).toBe(AVISO_1)
    const antes = m.canal.publicados.length
    m.relogio.avancar(1)
    await esvaziar()
    expect(m.palco.estado().avisoId).toBeNull()
    expect(m.palco.estado().avisoAte).toBeNull()
    expect(m.exec.executadas.at(-1)).toEqual({ tipo: 'ocultar_aviso' })
    expect(m.canal.publicados.length).toBe(antes + 1)
    expect(m.repo.registros).toHaveLength(1)

    // um aviso novo troca o prazo; o antigo não oculta o novo
    m.canal.comando({ id: novoId(), acao: 'aviso', avisoId: AVISO_1 }, ANA)
    await esvaziar()
    m.relogio.avancar(5_000)
    m.canal.comando({ id: novoId(), acao: 'aviso', avisoId: AVISO_2 }, ANA)
    await esvaziar()
    m.relogio.avancar(5_000)
    await esvaziar()
    expect(m.palco.estado().avisoId).toBe(AVISO_2)
    m.relogio.avancar(15_000)
    await esvaziar()
    expect(m.palco.estado().avisoId).toBeNull()
    // ocultar à mão cancela o prazo
    m.canal.comando({ id: novoId(), acao: 'aviso', avisoId: AVISO_1 }, ANA)
    await esvaziar()
    m.canal.comando({ id: novoId(), acao: 'ocultar_aviso' }, ANA)
    await esvaziar()
    expect(m.palco.estado().avisoId).toBeNull()
    const ocultos = m.exec.executadas.filter((a) => a.tipo === 'ocultar_aviso').length
    m.relogio.avancar(20_000)
    await esvaziar()
    expect(m.exec.executadas.filter((a) => a.tipo === 'ocultar_aviso').length).toBe(ocultos)
  })

  test('ignora-o-proprio-comando', async () => {
    const m = montar()
    const antes = m.canal.publicados.length
    m.canal.comando({ id: novoId(), acao: 'clipe' }, EU)
    await esvaziar()
    expect(m.exec.executadas).toEqual([])
    expect(m.canal.publicados.length).toBe(antes)
  })

  test('parar-solta-tudo', async () => {
    const m = montar()
    const mudancas: EstadoNoAr[] = []
    m.palco.aoMudar((e) => mudancas.push(e))
    m.canal.comando({ id: novoId(), acao: 'aviso', avisoId: AVISO_1 }, ANA)
    await esvaziar()
    expect(mudancas).toHaveLength(1)
    m.palco.parar()
    expect(m.canal.ouvintes()).toBe(0)
    expect(m.relogio.vivas()).toBe(0)
    const antes = m.canal.publicados.length
    m.relogio.avancar(60_000)
    m.canal.entrar()
    await esvaziar()
    expect(m.canal.publicados.length).toBe(antes)
    expect(mudancas).toHaveLength(1)
  })

  test('estado-so-muda-com-ok', async () => {
    const m = montar({
      respostas: { trocar_cena: { resultado: 'recusado', motivo: 'sem_permissao' }, mostrar_aviso: { resultado: 'falhou', motivo: null } },
    })
    const prazos = m.relogio.vivas()
    m.canal.comando({ id: novoId(), acao: 'cena', cenaId: CENA_B }, ANA)
    await esvaziar()
    expect(m.palco.estado().cenaObs).toBeNull()
    expect(m.palco.estado().ultimo).toMatchObject({ resultado: 'recusado', motivo: 'sem_permissao' })
    m.canal.comando({ id: novoId(), acao: 'aviso', avisoId: AVISO_1 }, ANA)
    await esvaziar()
    expect(m.palco.estado()).toMatchObject({ avisoId: null, avisoAte: null })
    expect(m.relogio.vivas()).toBe(prazos)
    // a próxima cena parte do estado real (nenhuma), e não da cena recusada
    const f = montar({ respostas: { trocar_cena: { resultado: 'falhou', motivo: 'obs_ausente' } } })
    f.canal.comando({ id: novoId(), acao: 'cena', cenaId: CENA_B }, ANA)
    await esvaziar()
    expect(f.palco.estado().cenaObs).toBeNull()
    expect(m.repo.registros).toEqual([])
    expect(f.repo.registros).toEqual([])
  })

  test('parar-com-acao-pendente', async () => {
    const m = montar()
    const mudancas: EstadoNoAr[] = []
    m.palco.aoMudar((e) => mudancas.push(e))
    m.exec.segurarTudo()
    m.canal.comando({ id: novoId(), acao: 'aviso', avisoId: AVISO_1 }, ANA)
    await esvaziar()
    const publicados = m.canal.publicados.length
    m.palco.parar()
    m.exec.soltar()
    await esvaziar()
    expect(m.relogio.vivas()).toBe(0)
    expect(m.repo.registros).toEqual([])
    expect(m.canal.publicados.length).toBe(publicados)
    expect(mudancas).toEqual([])
    expect(m.palco.estado().avisoId).toBeNull()
  })

  test('executor-que-lanca', async () => {
    const m = montar({ executor: { lancar: ['tocar_som'] } })
    const id = novoId()
    m.canal.comando({ id, acao: 'som', somId: SOM }, ANA)
    await esvaziar()
    expect(m.canal.publicados.at(-1)?.ultimo).toEqual({ comandoId: id, acao: 'som', resultado: 'falhou', motivo: null, origem: 'toque', gesto: null })
    expect(m.repo.registros).toEqual([])
    m.canal.comando({ id: novoId(), acao: 'cena', cenaId: CENA_A }, ANA)
    await esvaziar()
    expect(m.palco.estado().cenaObs).toBe('Abertura')
  })

  test('publicacao-rejeitada-tratada', async () => {
    const m = montar({ rejeitarPublicacao: true })
    expect(m.canal.tratadas()).toBe(1)
    m.canal.comando({ id: novoId(), acao: 'cena', cenaId: CENA_B }, ANA)
    await esvaziar()
    m.canal.entrar()
    expect(m.canal.tratadas()).toBe(3)
    expect(m.palco.estado().cenaObs).toBe('Conversa')
  })

  test('estado-publicado-passa-no-leitor', async () => {
    const LONGA = 'c0000000-0000-4000-8000-0000000000cc'
    const nome = 'C'.repeat(201)
    const m = montar({ dados: { ...DADOS, cenas: [...DADOS.cenas, { id: LONGA, nomeExibicao: 'Longa', nomeObs: nome, ordem: 2 }] } })
    const id = novoId()
    m.canal.comando({ id, acao: 'cena', cenaId: LONGA }, ANA)
    await esvaziar()
    const publicado = m.canal.publicados.at(-1)
    expect(publicado?.cenaObs).toBeNull()
    expect(publicado?.ultimo).toEqual({ comandoId: id, acao: 'cena', resultado: 'ok', motivo: null, origem: 'toque', gesto: null })
    expect(lerEstadoNoAr(publicado)).not.toBeNull()
    // dentro do palco a cena é a real (a próxima parte dela)
    expect(m.palco.estado().cenaObs).toBe(nome)
    m.canal.comando({ id: novoId(), acao: 'proxima_cena' }, ANA)
    await esvaziar()
    expect(m.palco.estado().cenaObs).toBe('Abertura')
    expect(m.canal.publicados.at(-1)?.cenaObs).toBe('Abertura')
    // 200 caracteres ainda vão
    const nome200 = 'D'.repeat(200)
    const m2 = montar({ dados: { ...DADOS, cenas: [{ id: LONGA, nomeExibicao: 'D', nomeObs: nome200, ordem: 0 }] } })
    m2.canal.comando({ id: novoId(), acao: 'cena', cenaId: LONGA }, ANA)
    await esvaziar()
    expect(m2.canal.publicados.at(-1)?.cenaObs).toBe(nome200)
    // situação do OBS fora da forma: nada é publicado, e o palco continua executando
    const torta = montar({ executor: { situacao: { ...SITUACAO, versaoDoPlugin: 'v'.repeat(41) } } })
    torta.canal.comando({ id: novoId(), acao: 'som', somId: SOM }, ANA)
    await esvaziar()
    expect(torta.canal.publicados).toEqual([])
    expect(torta.exec.executadas).toHaveLength(1)
    for (const e of [...m.canal.publicados, ...m2.canal.publicados]) expect(lerEstadoNoAr(e)).not.toBeNull()
  })

  test('remetente-fora-da-presenca (VER-046, I4)', async () => {
    // Só membros marcam presença no `:controle` (RLS); um `obs_palco` ou uma sessão antiga, não.
    const OUTRO_PALCO = 'b0000000-0000-4000-8000-0000000000b2'
    const m = montar()
    const antes = m.canal.publicados.length
    m.canal.comando({ id: novoId(), acao: 'cena', cenaId: CENA_B }, OUTRO_PALCO)
    await esvaziar()
    expect(m.exec.executadas).toEqual([])
    expect(m.repo.registros).toEqual([])
    expect(m.canal.publicados.length).toBe(antes)
    // quem sai da presença deixa de comandar; quem entra passa a comandar
    m.canal.presenca([BIA])
    m.canal.comando({ id: novoId(), acao: 'marcador' }, ANA)
    await esvaziar()
    expect(m.exec.executadas).toEqual([])
    m.canal.comando({ id: novoId(), acao: 'marcador' }, BIA)
    await esvaziar()
    expect(m.exec.executadas).toEqual([{ tipo: 'marcar', nome: expect.any(String) }])
    // sem ninguém na presença (ainda não sincronizou), nada executa
    const vazio = montar({ presentes: [] })
    vazio.canal.comando({ id: novoId(), acao: 'marcador' }, ANA)
    await esvaziar()
    expect(vazio.exec.executadas).toEqual([])
  })

  test('item-criado-depois-e-relido (VER-046, I2)', async () => {
    const AVISO_3 = 'f0000000-0000-4000-8000-000000000003'
    const novo = { id: AVISO_3, episodioId: EPISODIO, titulo: 'A3', texto: 't', link: null, imagemMidiaId: null, duracaoS: 5, ordem: 2, caminhoDaImagem: null }
    let releituras = 0
    const m = montar({
      recarregarDados: async () => {
        releituras++
        return { ...DADOS, avisos: [...DADOS.avisos, novo] }
      },
    })
    const id = novoId()
    m.canal.comando({ id, acao: 'aviso', avisoId: AVISO_3 }, ANA)
    await esvaziar()
    expect(releituras).toBe(1)
    expect(m.exec.executadas).toEqual([{ tipo: 'mostrar_aviso', avisoId: AVISO_3, duracaoS: 5 }])
    expect(m.palco.estado().ultimo).toEqual({ comandoId: id, acao: 'aviso', resultado: 'ok', motivo: null, origem: 'toque', gesto: null })
    // um comando conhecido não relê
    m.canal.comando({ id: novoId(), acao: 'som', somId: SOM }, ANA)
    await esvaziar()
    expect(releituras).toBe(1)
    // ainda desconhecido depois da releitura (ou releitura que falha): uma releitura só, e a recusa sai
    const falha = montar({
      recarregarDados: async () => {
        releituras++
        return null
      },
    })
    const idFalha = novoId()
    falha.canal.comando({ id: idFalha, acao: 'som', somId: SOM_INEXISTENTE }, ANA)
    await esvaziar()
    expect(releituras).toBe(2)
    expect(falha.exec.executadas).toEqual([])
    expect(falha.palco.estado().ultimo).toEqual({ comandoId: idFalha, acao: 'som', resultado: 'recusado', motivo: 'som_inexistente', origem: 'toque', gesto: null })
    // sem releitura fornecida, a recusa é a de antes
    const sem = montar()
    sem.canal.comando({ id: novoId(), acao: 'aviso', avisoId: AVISO_3 }, ANA)
    await esvaziar()
    expect(sem.palco.estado().ultimo?.motivo).toBe('aviso_inexistente')
  })

  test('quem-entra-faz-reler (VER-046, I2: aviso corrigido)', async () => {
    let releituras = 0
    const corrigido = { ...DADOS, avisos: DADOS.avisos.map((a) => (a.id === AVISO_1 ? { ...a, duracaoS: 45 } : a)) }
    const m = montar({
      recarregarDados: async () => {
        releituras++
        return corrigido
      },
    })
    m.canal.entrar()
    m.canal.entrar() // duas entradas juntas: uma releitura em curso, reaproveitada
    await esvaziar()
    expect(releituras).toBe(1)
    m.canal.comando({ id: novoId(), acao: 'aviso', avisoId: AVISO_1 }, ANA)
    await esvaziar()
    expect(m.exec.executadas).toEqual([{ tipo: 'mostrar_aviso', avisoId: AVISO_1, duracaoS: 45 }])
    m.relogio.avancar(RELEITURA_MINIMA_MS)
    await m.palco.recarregarListas()
    expect(releituras).toBe(2)
  })

  test('releitura-com-intervalo-minimo (VER-046, rodada 1)', async () => {
    let releituras = 0
    const m = montar({
      recarregarDados: async () => {
        releituras++
        return DADOS // o item continua desconhecido
      },
    })
    m.canal.comando({ id: novoId(), acao: 'som', somId: SOM_INEXISTENTE }, ANA)
    await esvaziar()
    expect(releituras).toBe(1)
    // dentro da janela: nem comando desconhecido nem entrada releem; o comando é recusado na hora
    const id = novoId()
    m.relogio.avancar(RELEITURA_MINIMA_MS - 1)
    m.canal.comando({ id, acao: 'som', somId: SOM_INEXISTENTE }, ANA)
    m.canal.entrar()
    await esvaziar()
    expect(releituras).toBe(1)
    expect(m.palco.estado().ultimo).toEqual({ comandoId: id, acao: 'som', resultado: 'recusado', motivo: 'som_inexistente', origem: 'toque', gesto: null })
    // passada a janela, relê de novo
    m.relogio.avancar(1)
    m.canal.entrar()
    await esvaziar()
    expect(releituras).toBe(2)
  })

  test('cena-do-obs (VER-044 A1, D9)', async () => {
    const m = montar()
    const antes = m.canal.publicados.length
    m.palco.definirCenaObs('Conversa')
    expect(m.palco.estado().cenaObs).toBe('Conversa')
    expect(m.canal.publicados.length).toBe(antes + 1)
    expect(m.canal.publicados.at(-1)?.cenaObs).toBe('Conversa')
    // a mesma cena e o "não se sabe" (null) não mudam nem publicam
    m.palco.definirCenaObs('Conversa')
    m.palco.definirCenaObs(null)
    expect(m.canal.publicados.length).toBe(antes + 1)
    expect(m.palco.estado().cenaObs).toBe('Conversa')
    // a próxima cena parte da cena atual do OBS (Conversa → volta à Abertura)
    m.canal.comando({ id: novoId(), acao: 'proxima_cena' }, ANA)
    await esvaziar()
    expect(m.exec.executadas).toEqual([{ tipo: 'trocar_cena', nomeObs: 'Abertura', cenaId: CENA_A }])
    // cena longa (além do limite do leitor): dentro do palco é a real; no canal vai null
    m.palco.definirCenaObs('L'.repeat(201))
    expect(m.canal.publicados.at(-1)?.cenaObs).toBeNull()
    expect(m.palco.estado().cenaObs).toBe('L'.repeat(201))
    m.palco.parar()
    m.palco.definirCenaObs('Conversa')
    expect(m.palco.estado().cenaObs).toBe('L'.repeat(201))
  })

  test('estado-e-copia', () => {
    const m = montar()
    const e = m.palco.estado()
    e.cenaObs = 'mexido'
    e.obs.nivel = 0
    expect(m.palco.estado().cenaObs).toBeNull()
    expect(m.palco.estado().obs.nivel).toBe(4)
  })
})

describe('palco com gestos (PLA-006, D2, D3, D4, D6)', () => {
  test('palco-executa-gesto', async () => {
    const m = montar({ dados: ligados() })
    const id = novoId()
    m.gestos.gesto('Victory', { id })
    await esvaziar()
    expect(m.exec.executadas).toEqual([{ tipo: 'trocar_cena', nomeObs: 'Abertura', cenaId: CENA_A }])
    const esperado = { comandoId: id, acao: 'proxima_cena', resultado: 'ok', motivo: null, origem: 'gesto', gesto: 'Victory' }
    expect(m.palco.estado().ultimo).toEqual(esperado)
    expect(m.canal.publicados.at(-1)?.ultimo).toEqual(esperado)
    expect(lerEstadoNoAr(m.canal.publicados.at(-1))).not.toBeNull()
    // o autor do registro é o dispositivo que o servidor pôs no payload (nunca o remetente nem um membro)
    expect(m.repo.registros).toEqual([
      { episodioId: EPISODIO, origem: 'gesto', acao: 'proxima_cena', cenaId: CENA_A, somId: null, avisoId: null, dispositivoId: DISPOSITIVO, teste: false },
    ])
  })

  test('gesto-sem-acao', async () => {
    const m = montar({ dados: ligados() })
    const antes = m.canal.publicados.length
    const id = novoId()
    m.gestos.gesto('Thumb_Down', { id })
    await esvaziar()
    expect(m.exec.executadas).toEqual([])
    expect(m.repo.registros).toEqual([])
    expect(m.canal.publicados.length).toBe(antes + 1)
    expect(m.canal.publicados.at(-1)?.ultimo).toEqual({ comandoId: id, acao: 'nenhuma', resultado: 'recusado', motivo: 'gesto_sem_acao', origem: 'gesto', gesto: 'Thumb_Down' })
    // gesto sem linha no mapa conta como `nenhuma`
    const semLinha = montar({ dados: ligados(MAPA.filter((l) => l.gesto !== 'Victory')) })
    semLinha.gestos.gesto('Victory')
    await esvaziar()
    expect(semLinha.exec.executadas).toEqual([])
    expect(semLinha.palco.estado().ultimo?.motivo).toBe('gesto_sem_acao')
  })

  test('gesto-com-alvo-sumido', async () => {
    let releituras = 0
    const mapa = MAPA.map((l) => (l.gesto === 'Thumb_Up' ? { ...l, somId: SOM_INEXISTENTE } : l))
    const m = montar({
      dados: ligados(mapa),
      recarregarDados: async () => {
        releituras++
        return ligados(mapa)
      },
    })
    const id = novoId()
    m.gestos.gesto('Thumb_Up', { id })
    await esvaziar()
    expect(releituras).toBe(1)
    expect(m.exec.executadas).toEqual([])
    expect(m.repo.registros).toEqual([])
    expect(m.palco.estado().ultimo).toEqual({ comandoId: id, acao: 'som', resultado: 'recusado', motivo: 'som_inexistente', origem: 'gesto', gesto: 'Thumb_Up' })
    // o mapa é relido com as listas: o som que chegou na releitura toca (mapa novo, lista nova)
    const NOVO = '50000000-0000-4000-8000-000000000002'
    const novo = { ...DADOS.sons[0], id: NOVO, caminho: 'som/novo.mp3' }
    const corrigido = { ...ligados(MAPA.map((l) => (l.gesto === 'Thumb_Up' ? { ...l, somId: NOVO } : l))), sons: [...DADOS.sons, novo] }
    const r = montar({ dados: ligados(mapa), recarregarDados: async () => corrigido })
    r.gestos.gesto('Thumb_Up')
    await esvaziar()
    expect(r.exec.executadas).toEqual([{ tipo: 'tocar_som', somId: NOVO, volume: 0.8 }])
  })

  test('palco-ignora-com-desligados', async () => {
    const m = montar() // DADOS: gestosLigados false
    const antes = m.canal.publicados.length
    const mudancas: EstadoNoAr[] = []
    m.palco.aoMudar((e) => mudancas.push(e))
    m.gestos.gesto('Victory')
    m.gestos.gesto('ILoveYou')
    await esvaziar()
    expect(m.exec.executadas).toEqual([])
    expect(m.repo.registros).toEqual([])
    expect(m.canal.publicados.length).toBe(antes)
    expect(mudancas).toEqual([])
    expect(m.palco.estado().ultimo).toBeNull()
    // o toque continua funcionando com os gestos desligados
    m.canal.comando({ id: novoId(), acao: 'marcador' }, ANA)
    await esvaziar()
    expect(m.exec.executadas).toHaveLength(1)
  })

  test('palco-respeita-o-intervalo', async () => {
    expect(INTERVALO_DO_SERVIDOR_MS).toBe(INTERVALO_MS - 500)
    const m = montar({ dados: ligados() })
    m.gestos.gesto('Closed_Fist')
    await esvaziar()
    m.relogio.avancar(INTERVALO_DO_SERVIDOR_MS - 1)
    m.gestos.gesto('Closed_Fist')
    await esvaziar()
    expect(m.exec.executadas).toHaveLength(1)
    // o ignorado não conta: a janela vale a partir do último aceito
    m.relogio.avancar(1)
    m.gestos.gesto('Closed_Fist')
    await esvaziar()
    expect(m.exec.executadas).toHaveLength(2)
    expect(m.repo.registros).toHaveLength(2)

    // revisão 1, I1: gestos confirmados a 3 000 ms no aparelho; o primeiro atrasa 400 ms a mais que o segundo
    // na rede → chegam a 2 600 ms um do outro, e os dois passam (com a margem de 500 ms)
    const atraso = montar({ dados: ligados() })
    const ATRASO_DO_PRIMEIRO = 600
    const ATRASO_DO_SEGUNDO = 200
    atraso.relogio.avancar(ATRASO_DO_PRIMEIRO)
    atraso.gestos.gesto('Closed_Fist')
    await esvaziar()
    atraso.relogio.avancar(INTERVALO_MS + ATRASO_DO_SEGUNDO - ATRASO_DO_PRIMEIRO) // 2 600 ms depois do primeiro
    atraso.gestos.gesto('Closed_Fist')
    await esvaziar()
    expect(atraso.exec.executadas).toHaveLength(2)
  })

  test('palco-descarta-gesto-revogado', async () => {
    const m = montar({ dados: ligados() })
    m.revogados.revogar(CAMERA)
    const antes = m.canal.publicados.length
    m.gestos.gesto('Victory')
    await esvaziar()
    expect(m.exec.executadas).toEqual([])
    expect(m.repo.registros).toEqual([])
    expect(m.canal.publicados.length).toBe(antes)
    // outra sessão de câmera (não revogada) continua
    m.gestos.gesto('Victory', { remetente: 'b0000000-0000-4000-8000-0000000000c2' })
    await esvaziar()
    expect(m.exec.executadas).toHaveLength(1)
  })

  test('gesto-repetido', async () => {
    const m = montar({ dados: ligados() })
    const id = novoId()
    m.gestos.gesto('Closed_Fist', { id })
    await esvaziar()
    m.relogio.avancar(INTERVALO_MS)
    m.gestos.gesto('Closed_Fist', { id })
    await esvaziar()
    expect(m.exec.executadas).toHaveLength(1)
    expect(m.repo.registros).toHaveLength(1)
    // o id de um gesto não esbarra no de um comando (memórias separadas): um toque com o mesmo id executa
    m.canal.comando({ id, acao: 'marcador' }, ANA)
    await esvaziar()
    expect(m.exec.executadas).toHaveLength(2)
  })

  test('gesto-so-pelo-topico-de-gestos', async () => {
    const m = montar({ dados: ligados() })
    const antes = m.canal.publicados.length
    const comando = { id: novoId(), acao: 'cena', cenaId: CENA_B, remetente: ANA }
    // pelo caminho do leitor real: nem com o evento `comando` nem com o `gesto`
    m.gestos.entregar('comando', comando)
    m.gestos.entregar('gesto', comando)
    m.gestos.entregar('gesto', { ...comando, tipo: 'gesto' })
    // e mesmo que um adaptador com defeito entregasse o comando (ou um gesto fora da forma), o palco confere de novo
    m.gestos.direto({ id: novoId(), acao: 'cena', cenaId: CENA_B }, ANA)
    m.gestos.direto({ id: novoId(), gesto: 'Victory', dispositivoId: DISPOSITIVO, acao: 'cena' }, CAMERA)
    m.gestos.direto({ id: novoId(), gesto: 'None', dispositivoId: DISPOSITIVO }, CAMERA)
    m.gestos.direto({ id: novoId().toUpperCase(), gesto: 'Victory', dispositivoId: DISPOSITIVO }, CAMERA)
    m.gestos.direto(JSON.parse(`{"__proto__":{"x":1},"id":"${novoId()}","gesto":"Victory","dispositivoId":"${DISPOSITIVO}"}`), CAMERA)
    m.gestos.direto({ id: novoId(), gesto: 'Victory', dispositivoId: DISPOSITIVO }, 'nao-e-uuid')
    await esvaziar()
    expect(m.exec.executadas).toEqual([])
    expect(m.repo.registros).toEqual([])
    expect(m.canal.publicados.length).toBe(antes)
    // o gesto bem formado, pelo mesmo canal, passa
    m.gestos.direto({ id: novoId(), gesto: 'Victory', dispositivoId: DISPOSITIVO }, CAMERA)
    await esvaziar()
    expect(m.exec.executadas).toHaveLength(1)
  })

  test('comando-nao-vem-do-topico-de-gestos', async () => {
    // um gesto no payload de `:controle` é descartado pelo leitor do controle (nem como `gesto` nem como `comando`)
    const payload = payloadDoGesto('Victory', { remetente: ANA })
    expect(lerMensagemDoControle('gesto', payload)).toBeNull()
    expect(lerMensagemDoControle('comando', payload)).toBeNull()
    const m = montar({ dados: ligados() })
    const antes = m.canal.publicados.length
    m.canal.comando(payload, ANA)
    m.canal.comando({ id: novoId(), gesto: 'Victory', dispositivoId: DISPOSITIVO }, ANA)
    await esvaziar()
    expect(m.exec.executadas).toEqual([])
    expect(m.canal.publicados.length).toBe(antes)
  })

  test('palco-rele-o-interruptor', async () => {
    const m = montar() // começa desligado
    await esvaziar()
    // a leitura logo depois de assinar o tópico de gestos (rodada 1, I2), com o mesmo valor: nada publicado
    expect(m.repo.leiturasDoInterruptor).toEqual([EPISODIO])
    expect(m.canal.publicados).toHaveLength(1)
    m.repo.definirInterruptor(true)
    m.relogio.avancar(RELEITURA_MINIMA_MS)
    m.gestos.aviso()
    await esvaziar()
    expect(m.repo.leiturasDoInterruptor).toEqual([EPISODIO, EPISODIO])
    expect(m.palco.estado().gestosLigados).toBe(true)
    expect(m.canal.publicados.at(-1)?.gestosLigados).toBe(true)
    // ligado, o gesto passa
    m.gestos.gesto('Closed_Fist')
    await esvaziar()
    expect(m.exec.executadas).toHaveLength(1)

    // três avisos em 1 s: uma releitura agora e outra no fim da janela (o valor é sempre o do banco, nunca alternado)
    m.relogio.avancar(RELEITURA_MINIMA_MS)
    m.gestos.aviso()
    await esvaziar()
    expect(m.repo.leiturasDoInterruptor).toHaveLength(3)
    expect(m.palco.estado().gestosLigados).toBe(true)
    const publicados = m.canal.publicados.length
    m.repo.definirInterruptor(false)
    m.relogio.avancar(500)
    m.gestos.aviso()
    m.relogio.avancar(500)
    m.gestos.aviso()
    await esvaziar()
    expect(m.repo.leiturasDoInterruptor).toHaveLength(3)
    expect(m.palco.estado().gestosLigados).toBe(true)
    m.relogio.avancar(RELEITURA_MINIMA_MS - 1000 - 1)
    await esvaziar()
    expect(m.repo.leiturasDoInterruptor).toHaveLength(3)
    m.relogio.avancar(1)
    await esvaziar()
    expect(m.repo.leiturasDoInterruptor).toHaveLength(4)
    expect(m.palco.estado().gestosLigados).toBe(false)
    expect(m.canal.publicados.length).toBe(publicados + 1)
    expect(m.canal.publicados.at(-1)?.gestosLigados).toBe(false)
    // depois da releitura de fim de janela, nada fica agendado além do estado periódico
    m.relogio.avancar(RELEITURA_MINIMA_MS * 3)
    await esvaziar()
    expect(m.repo.leiturasDoInterruptor).toHaveLength(4)
    // desligado de novo, o gesto não passa
    m.gestos.gesto('Closed_Fist')
    await esvaziar()
    expect(m.exec.executadas).toHaveLength(1)
  })

  test('interruptor: leitura que chega fora de ordem ou depois de parar não muda o estado; parar cancela a releitura agendada', async () => {
    // duas leituras em voo: a mais antiga, chegando depois, não sobrescreve a mais nova
    const respostas: ((v: boolean) => void)[] = []
    const o = montar()
    o.repo.repo.gestosLigados = () => new Promise<boolean>((resolver) => respostas.push(resolver))
    o.relogio.avancar(RELEITURA_MINIMA_MS)
    o.gestos.aviso()
    o.relogio.avancar(RELEITURA_MINIMA_MS)
    o.gestos.aviso()
    expect(respostas).toHaveLength(2)
    respostas[1](true)
    await esvaziar()
    respostas[0](false)
    await esvaziar()
    expect(o.palco.estado().gestosLigados).toBe(true)

    // leitura que chega depois de parar: nada muda nem é publicado (N1)
    const pendentes: ((v: boolean) => void)[] = []
    const q = montar()
    q.repo.repo.gestosLigados = () => new Promise<boolean>((resolver) => pendentes.push(resolver))
    q.relogio.avancar(RELEITURA_MINIMA_MS)
    q.gestos.aviso()
    const publicadosAntes = q.canal.publicados.length
    q.palco.parar()
    pendentes.at(-1)?.(true)
    await esvaziar()
    expect(q.palco.estado().gestosLigados).toBe(false)
    expect(q.canal.publicados.length).toBe(publicadosAntes)

    // parar com uma releitura agendada: nada fica vivo e nada é lido depois
    const p = montar()
    await esvaziar()
    p.gestos.aviso() // dentro da janela da leitura depois de assinar: fica agendada
    await esvaziar()
    expect(p.repo.leiturasDoInterruptor).toHaveLength(1)
    p.palco.parar()
    expect(p.relogio.vivas()).toBe(0)
    expect(p.gestos.ouvintes()).toBe(0)
    p.relogio.avancar(RELEITURA_MINIMA_MS)
    p.gestos.aviso()
    await esvaziar()
    expect(p.repo.leiturasDoInterruptor).toHaveLength(1)
  })

  test('interruptor-leitura-que-falha-e-repetida (rodada 1, I2)', async () => {
    const m = montar({ dados: ligados() })
    await esvaziar()
    let falhas = 2
    m.repo.definirInterruptor(false)
    const original = m.repo.repo.gestosLigados
    m.repo.repo.gestosLigados = async (id) => {
      if (falhas > 0) {
        falhas--
        m.repo.leiturasDoInterruptor.push(id)
        throw new Error('rede')
      }
      return original(id)
    }
    const antes = m.canal.publicados.length
    m.relogio.avancar(RELEITURA_MINIMA_MS)
    m.gestos.aviso()
    await esvaziar()
    // a falha mantém o valor e não publica; a nova tentativa fica para o fim da janela
    expect(m.palco.estado().gestosLigados).toBe(true)
    expect(m.canal.publicados.length).toBe(antes)
    expect(m.repo.leiturasDoInterruptor).toHaveLength(2)
    m.relogio.avancar(RELEITURA_MINIMA_MS - 1)
    await esvaziar()
    expect(m.repo.leiturasDoInterruptor).toHaveLength(2)
    m.relogio.avancar(1)
    await esvaziar()
    expect(m.repo.leiturasDoInterruptor).toHaveLength(3) // falhou de novo
    m.relogio.avancar(RELEITURA_MINIMA_MS)
    await esvaziar()
    expect(m.repo.leiturasDoInterruptor).toHaveLength(4)
    expect(m.palco.estado().gestosLigados).toBe(false)
    expect(m.canal.publicados.at(-1)?.gestosLigados).toBe(false)
    // corrigido, nada mais é tentado; a resposta que não é booleana também conta como falha (e não liga nada)
    m.relogio.avancar(RELEITURA_MINIMA_MS * 4)
    await esvaziar()
    expect(m.repo.leiturasDoInterruptor).toHaveLength(4)
    m.repo.repo.gestosLigados = async () => 'true' as unknown as boolean
    const publicados = m.canal.publicados.length
    m.gestos.aviso()
    await esvaziar()
    expect(m.palco.estado().gestosLigados).toBe(false)
    expect(m.canal.publicados.length).toBe(publicados)
    expect(m.relogio.vivas()).toBe(2) // o estado periódico e a nova tentativa
  })

  test('interruptor-uma-leitura-agendada-so (rodada 2, N4): falha com uma releitura já agendada não agenda outra', async () => {
    // a leitura depois de assinar fica pendurada; um aviso dentro da janela agenda o fim dela; depois a leitura pendurada falha
    let falhar: (e: Error) => void = () => {}
    const repo = repoFalso()
    repo.definirInterruptor(true)
    const canal = canalFalso()
    const gestos = canalDeGestosFalso()
    const relogio = relogioFalso()
    let leituras = 0
    repo.repo.gestosLigados = () => {
      leituras++
      return leituras === 1 ? new Promise<boolean>((_r, rejeitar) => (falhar = rejeitar)) : Promise.resolve(true)
    }
    criarPalco({
      canal: canal.canal,
      canalDoEstado: canal.estado,
      canalDeGestos: gestos.canal,
      repo: repo.repo,
      executor: executorFalso().executor,
      revogados: new Revogados(relogio.agora),
      episodio: { id: EPISODIO, modo: 'ao_vivo' },
      dados: ligados(),
      meuUsuario: EU,
      agendarRepeticao: relogio.agendarRepeticao,
      agora: relogio.agora,
    })
    expect(leituras).toBe(1)
    gestos.aviso() // dentro da janela: agenda o fim dela
    expect(relogio.vivas()).toBe(2) // o estado periódico e a releitura agendada
    falhar(new Error('rede'))
    await esvaziar()
    expect(relogio.vivas()).toBe(2) // a falha não agenda uma segunda
    relogio.avancar(RELEITURA_MINIMA_MS)
    await esvaziar()
    expect(leituras).toBe(2)
    relogio.avancar(RELEITURA_MINIMA_MS * 3)
    await esvaziar()
    expect(leituras).toBe(2)
  })

  test('interruptor-sonda-A: aviso com leitura que falha se corrige em 60 s e nenhum gesto passa com o banco desligado (rodada 1, I2)', async () => {
    const m = montar({ dados: ligados() })
    await esvaziar()
    m.repo.definirInterruptor(false)
    let primeira = true
    const original = m.repo.repo.gestosLigados
    m.repo.repo.gestosLigados = async (id) => {
      if (primeira) {
        primeira = false
        throw new Error('rede')
      }
      return original(id)
    }
    m.relogio.avancar(RELEITURA_MINIMA_MS)
    m.gestos.aviso()
    await esvaziar()
    for (let i = 0; i < 12; i++) {
      m.relogio.avancar(5_000)
      await esvaziar()
    }
    expect(m.palco.estado().gestosLigados).toBe(false)
    m.gestos.gesto('Closed_Fist')
    await esvaziar()
    expect(m.exec.executadas).toEqual([])
  })

  test('interruptor-aviso-perdido-corrigido-no-conectado (rodada 1, I2)', async () => {
    // o banco muda durante uma queda do tópico (o aviso se perde); a volta a `conectado` relê
    const m = montar({ dados: ligados() })
    await esvaziar()
    m.repo.definirInterruptor(false)
    m.relogio.avancar(RELEITURA_MINIMA_MS)
    m.gestos.estado('reconectando')
    await esvaziar()
    expect(m.repo.leiturasDoInterruptor).toHaveLength(1)
    expect(m.palco.estado().gestosLigados).toBe(true)
    m.gestos.estado('conectado')
    await esvaziar()
    expect(m.repo.leiturasDoInterruptor).toHaveLength(2)
    expect(m.palco.estado().gestosLigados).toBe(false)
    expect(m.canal.publicados.at(-1)?.gestosLigados).toBe(false)
    m.gestos.gesto('Closed_Fist')
    await esvaziar()
    expect(m.exec.executadas).toEqual([])
  })

  test('interruptor-relido-depois-de-assinar (rodada 1, I2: janela entre carregar e a assinatura)', async () => {
    // a carga leu ligado; antes da assinatura, o banco desligou (o aviso se perdeu)
    const repo = repoFalso()
    const canal = canalFalso()
    const gestos = canalDeGestosFalso()
    const exec = executorFalso()
    const relogio = relogioFalso()
    repo.definirInterruptor(false)
    const palco = criarPalco({
      canal: canal.canal,
      canalDoEstado: canal.estado,
      canalDeGestos: gestos.canal,
      repo: repo.repo,
      executor: exec.executor,
      revogados: new Revogados(relogio.agora),
      episodio: { id: EPISODIO, modo: 'ao_vivo' },
      dados: ligados(),
      meuUsuario: EU,
      agendarRepeticao: relogio.agendarRepeticao,
      agora: relogio.agora,
    })
    expect(canal.publicados[0].gestosLigados).toBe(true) // o primeiro estado leva a carga
    await esvaziar()
    expect(repo.leiturasDoInterruptor).toEqual([EPISODIO])
    expect(palco.estado().gestosLigados).toBe(false)
    expect(canal.publicados.at(-1)?.gestosLigados).toBe(false)
    gestos.gesto('Closed_Fist')
    await esvaziar()
    expect(exec.executadas).toEqual([])
  })

  test('gesto-desligado-durante-a-releitura (rodada 1, I1; sonda B)', async () => {
    // Thumb_Up → som que ainda não está nas listas: o gesto espera a releitura; no meio, o interruptor é relido desligado
    const NOVO = '50000000-0000-4000-8000-000000000002'
    const mapa = MAPA.map((l) => (l.gesto === 'Thumb_Up' ? { ...l, somId: NOVO } : l))
    const corrigido = { ...ligados(mapa), sons: [...DADOS.sons, { ...DADOS.sons[0], id: NOVO, caminho: 'som/novo.mp3' }] }
    let soltarReleitura: (d: Dados) => void = () => {}
    const m = montar({ dados: ligados(mapa), recarregarDados: () => new Promise<Dados>((r) => (soltarReleitura = r)) })
    await esvaziar()
    m.relogio.avancar(RELEITURA_MINIMA_MS)
    m.gestos.gesto('Thumb_Up')
    await esvaziar()
    m.repo.definirInterruptor(false)
    m.gestos.aviso()
    await esvaziar()
    expect(m.palco.estado().gestosLigados).toBe(false)
    const publicados = m.canal.publicados.length
    soltarReleitura(corrigido)
    await esvaziar()
    expect(m.exec.executadas).toEqual([])
    expect(m.repo.registros).toEqual([])
    expect(m.canal.publicados.length).toBe(publicados)
    // com o interruptor ligado durante a releitura, o mesmo caminho executa (a guarda é só do interruptor)
    const l = montar({ dados: ligados(mapa), recarregarDados: () => new Promise<Dados>((r) => (soltarReleitura = r)) })
    l.gestos.gesto('Thumb_Up')
    await esvaziar()
    soltarReleitura(corrigido)
    await esvaziar()
    expect(l.exec.executadas).toEqual([{ tipo: 'tocar_som', somId: NOVO, volume: 0.8 }])
  })

  test('guardas sem efeito colateral (rodada 1, N1): carga não booleana, protótipo do gesto, parar durante a releitura do toque', async () => {
    // carga com um valor que não é `true` (o adaptador não garante o tipo): começa desligado
    const torta = montar({ dados: { ...DADOS, episodio: { ...DADOS.episodio, gestosLigados: 'sim' as unknown as boolean } } })
    expect(torta.canal.publicados[0].gestosLigados).toBe(false)
    expect(torta.palco.estado().gestosLigados).toBe(false)

    // gesto com as 3 chaves certas, mas de outro protótipo: descartado
    const m = montar({ dados: ligados() })
    const proto = Object.assign(Object.create({ acao: 'cena' }) as object, { id: novoId(), gesto: 'Victory', dispositivoId: DISPOSITIVO })
    m.gestos.direto(proto, CAMERA)
    await esvaziar()
    expect(m.exec.executadas).toEqual([])

    // toque que espera a releitura das listas e o palco para no meio: nada executa (R7)
    let soltar: (d: Dados) => void = () => {}
    const NOVO = '50000000-0000-4000-8000-000000000002'
    const t = montar({ recarregarDados: () => new Promise<Dados>((r) => (soltar = r)) })
    t.canal.comando({ id: novoId(), acao: 'som', somId: NOVO }, ANA)
    await esvaziar()
    t.palco.parar()
    soltar({ ...DADOS, sons: [...DADOS.sons, { ...DADOS.sons[0], id: NOVO }] })
    await esvaziar()
    expect(t.exec.executadas).toEqual([])
    expect(t.repo.registros).toEqual([])
    // a releitura depois de parar não troca as listas, então só a guarda impede anotar a recusa no estado
    expect(t.palco.estado().ultimo).toBeNull()
  })

  test('estado-inicial-com-interruptor', () => {
    const desligado = montar()
    expect(desligado.canal.publicados).toHaveLength(1)
    expect(desligado.canal.publicados[0].gestosLigados).toBe(false)
    const ligado = montar({ dados: ligados() })
    expect(ligado.canal.publicados[0].gestosLigados).toBe(true)
    expect(ligado.palco.estado().gestosLigados).toBe(true)
  })

  test('clipe-por-gesto-pendente', async () => {
    const m = montar({ dados: ligados() })
    m.exec.segurarClipe()
    const id = novoId()
    m.gestos.gesto('ILoveYou', { id })
    await esvaziar()
    expect(m.canal.publicados.at(-1)?.ultimo).toEqual({ comandoId: id, acao: 'clipe', resultado: 'pendente', motivo: null, origem: 'gesto', gesto: 'ILoveYou' })
    expect(m.repo.registros).toEqual([])
    m.exec.soltar()
    await esvaziar()
    expect(m.canal.publicados.at(-1)?.ultimo).toEqual({ comandoId: id, acao: 'clipe', resultado: 'ok', motivo: null, origem: 'gesto', gesto: 'ILoveYou' })
    expect(m.repo.registros).toEqual([
      { episodioId: EPISODIO, origem: 'gesto', acao: 'clipe', cenaId: null, somId: null, avisoId: null, dispositivoId: DISPOSITIVO, teste: false },
    ])
  })
})
