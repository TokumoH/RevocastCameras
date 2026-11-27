import { describe, test, expect } from 'vitest'
import type { AcaoNoObs, LinhaDoRegistro } from './comandos'
import type { Comando, EstadoNoAr, MotivoDoResultado, ResultadoDoComando, SituacaoDoObs } from './mensagens'
import { Revogados, lerEstadoNoAr } from './mensagens'
import { ESTADO_A_CADA_MS, RELEITURA_MINIMA_MS, criarPalco } from './palco'
import type { CanalDoControle, ExecutorDeAcoes, RepositorioDoPalco } from './portas'

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

let sequencia = 0
const novoId = () => `d0000000-0000-4000-8000-${String(++sequencia).padStart(12, '0')}`

type Dados = Awaited<ReturnType<RepositorioDoPalco['carregar']>>
const DADOS: Dados = {
  episodio: { id: EPISODIO, titulo: 'Episódio de teste', data: '2026-11-27', estado: 'rascunho' },
  cenas: [
    { id: CENA_A, nomeExibicao: 'Abertura', nomeObs: 'Abertura', ordem: 0 },
    { id: CENA_B, nomeExibicao: 'Conversa', nomeObs: 'Conversa', ordem: 1 },
  ],
  sons: [{ id: SOM, midiaId: '60000000-0000-4000-8000-000000000001', rotulo: 'Aplauso', emoji: null, volume: 0.8, ordem: 0, caminho: 'som/x.mp3' }],
  avisos: [
    { id: AVISO_1, episodioId: EPISODIO, titulo: 'A1', texto: 't', link: null, imagemMidiaId: null, duracaoS: 10, ordem: 0, caminhoDaImagem: null },
    { id: AVISO_2, episodioId: EPISODIO, titulo: 'A2', texto: 't', link: null, imagemMidiaId: null, duracaoS: 20, ordem: 1, caminhoDaImagem: null },
  ],
}

const SITUACAO: SituacaoDoObs = { navegador: true, versaoDoPlugin: '2.24.0', nivel: 4, websocket: 'conectado', versaoObs: '31.0.1', replayBuffer: true, gravando: true }

function canalFalso(o: { rejeitar?: boolean } = {}) {
  const comandos = new Set<(c: Comando, r: string) => void>()
  const entradas = new Set<() => void>()
  const presencas = new Set<(u: string[]) => void>()
  const publicados: EstadoNoAr[] = []
  let tratadas = 0
  const canal: CanalDoControle = {
    aoComando: (f) => {
      comandos.add(f)
      return () => comandos.delete(f)
    },
    aoEstado: () => () => {},
    aoEntrarAlguem: (f) => {
      entradas.add(f)
      return () => entradas.delete(f)
    },
    aoMudarPresentes: (f) => {
      presencas.add(f)
      return () => presencas.delete(f)
    },
    aoMudarEstado: () => () => {},
    enviarComando: async () => 'ok',
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
    marcarPresenca: async () => {},
    fechar: async () => {},
  }
  return {
    canal,
    publicados,
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
  const repo: RepositorioDoPalco = {
    episodioAtivo: async () => ({ id: EPISODIO, modo: 'ao_vivo' }),
    carregar: async () => DADOS,
    urlDoArquivo: async () => 'https://exemplo.invalid/x',
    registrar: async (l) => {
      registros.push(l)
      if (falhar) throw new Error('rede')
    },
  }
  return { repo, registros }
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
  const exec = executorFalso(o.respostas, o.executor)
  const repo = repoFalso(o.falharRegistro)
  const relogio = relogioFalso()
  const revogados = new Revogados(relogio.agora)
  const palco = criarPalco({
    canal: canal.canal,
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
  return { palco, canal, exec, repo, relogio, revogados }
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
    expect(m.palco.estado().ultimo).toEqual({ comandoId: id, acao: 'cena', resultado: 'ok', motivo: null })
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
    expect(m.canal.publicados.at(-1)?.ultimo).toEqual({ comandoId: id, acao: 'som', resultado: 'recusado', motivo: 'som_inexistente' })
  })

  test('estado-apos-comando', async () => {
    const m = montar()
    const inicial = m.canal.publicados.length
    expect(inicial).toBe(1)
    expect(m.canal.publicados[0]).toEqual({ episodioId: EPISODIO, modo: 'ao_vivo', cenaObs: null, avisoId: null, avisoAte: null, ultimo: null, obs: SITUACAO })
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
      ultimo: { comandoId: id, acao: 'aviso', resultado: 'ok', motivo: null },
      obs: SITUACAO,
    })
    // a falha do executor também é publicada, com o motivo da lista
    const f = montar({ respostas: { salvar_clipe: { resultado: 'falhou', motivo: 'replay_desligado' } } })
    const idClipe = novoId()
    f.canal.comando({ id: idClipe, acao: 'clipe' }, ANA)
    await esvaziar()
    expect(f.canal.publicados.at(-1)?.ultimo).toEqual({ comandoId: idClipe, acao: 'clipe', resultado: 'falhou', motivo: 'replay_desligado' })
    expect(f.repo.registros).toEqual([])
  })

  test('clipe-pendente-depois-ok', async () => {
    const m = montar()
    m.exec.segurarClipe()
    const id = novoId()
    m.canal.comando({ id, acao: 'clipe' }, ANA)
    await esvaziar()
    expect(m.canal.publicados.at(-1)?.ultimo).toEqual({ comandoId: id, acao: 'clipe', resultado: 'pendente', motivo: null })
    expect(m.repo.registros).toEqual([])
    // outro comando no meio não espera o clipe
    m.canal.comando({ id: novoId(), acao: 'cena', cenaId: CENA_A }, ANA)
    await esvaziar()
    expect(m.palco.estado().cenaObs).toBe('Abertura')
    m.exec.soltar()
    await esvaziar()
    expect(m.canal.publicados.at(-1)?.ultimo).toEqual({ comandoId: id, acao: 'clipe', resultado: 'ok', motivo: null })
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
    expect(m.palco.estado().ultimo).toEqual({ comandoId: id, acao: 'som', resultado: 'ok', motivo: null })
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
    expect(m.canal.publicados.at(-1)?.ultimo).toEqual({ comandoId: id, acao: 'som', resultado: 'falhou', motivo: null })
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
    expect(publicado?.ultimo).toEqual({ comandoId: id, acao: 'cena', resultado: 'ok', motivo: null })
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
    expect(m.palco.estado().ultimo).toEqual({ comandoId: id, acao: 'aviso', resultado: 'ok', motivo: null })
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
    expect(falha.palco.estado().ultimo).toEqual({ comandoId: idFalha, acao: 'som', resultado: 'recusado', motivo: 'som_inexistente' })
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
    expect(m.palco.estado().ultimo).toEqual({ comandoId: id, acao: 'som', resultado: 'recusado', motivo: 'som_inexistente' })
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
