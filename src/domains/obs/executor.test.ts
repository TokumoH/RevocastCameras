import { describe, test, expect } from 'vitest'
import type { AcaoNoObs } from '../aovivo/comandos'
import { ESPERA_DO_CLIPE_MS, criarExecutorObs } from './executor'
import type { ObsNoNavegador, ObsWebsocket } from './portas'

type Status = { gravando: boolean; replayBuffer: boolean; transmitindo: boolean; cameraVirtual: boolean }

/** OBS falso: nível de controle, cenas e saídas programáveis; anota cada chamada. */
function obsFalso(o: { disponivel?: boolean; nivel?: number | null; cenas?: string[] | null; status?: Partial<Status> | null; cenaAtual?: string | null } = {}) {
  const chamadas: string[] = []
  const estado = {
    cenaAtual: o.cenaAtual === undefined ? 'Abertura' : o.cenaAtual,
    leiturasDaCena: 0,
    disponivel: o.disponivel ?? true,
    nivel: o.nivel === undefined ? 4 : o.nivel,
    cenas: o.cenas === undefined ? ['Abertura', 'Conversa'] : o.cenas,
    status: o.status === null ? null : { gravando: true, replayBuffer: true, transmitindo: false, cameraVirtual: false, ...o.status },
  }
  const obs: ObsNoNavegador = {
    disponivel: () => estado.disponivel,
    versaoDoPlugin: () => (estado.disponivel ? '2.24.0' : null),
    nivel: async () => (estado.disponivel ? estado.nivel : null),
    cenas: async () => (estado.disponivel ? estado.cenas : null),
    cenaAtual: async () => {
      estado.leiturasDaCena++
      return estado.disponivel ? estado.cenaAtual : null
    },
    status: async () => (estado.disponivel ? estado.status : null),
    aoMudarSaida: () => () => {},
    aoMudarCena: () => () => {},
    trocarCena: (nome) => {
      chamadas.push(`trocarCena:${nome}`)
    },
    salvarClipe: () => {
      chamadas.push('salvarClipe')
    },
  }
  return { obs, chamadas, estado }
}

function wsFalso(resposta = true) {
  const marcados: string[] = []
  const estado = { conectado: true, cairNoPedido: false }
  const ws: ObsWebsocket = {
    conectar: async () => 'conectado',
    versao: async () => (estado.conectado ? '31.0.1' : null),
    marcar: async (nome) => {
      marcados.push(nome)
      if (estado.cairNoPedido) estado.conectado = false
      return estado.conectado && resposta
    },
    conectado: () => estado.conectado,
    aoFechar: () => () => {},
    fechar: () => {},
  }
  return { ws, marcados, estado }
}

/** Relógio falso: `agendar` guarda as tarefas e `avancar` roda as vencidas. */
function relogioFalso() {
  let agora = 0
  let tarefas: { quando: number; f: () => void }[] = []
  return {
    agendar: (f: () => void, ms: number) => {
      tarefas.push({ quando: agora + ms, f })
    },
    avancar(ms: number) {
      agora += ms
      const vencidas = tarefas.filter((t) => t.quando <= agora)
      tarefas = tarefas.filter((t) => t.quando > agora)
      for (const t of vencidas) t.f()
    },
  }
}

const esvaziar = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function montar(o: { obs?: ReturnType<typeof obsFalso>; ws?: ObsWebsocket | null; som?: boolean } = {}) {
  const falso = o.obs ?? obsFalso()
  const relogio = relogioFalso()
  const pagina: string[] = []
  const executor = criarExecutorObs({
    obs: falso.obs,
    ws: o.ws === undefined ? wsFalso().ws : o.ws,
    tocarSom: async (somId, volume) => {
      pagina.push(`som:${somId}:${volume}`)
      return o.som ?? true
    },
    mostrarAviso: (id, duracaoS) => {
      pagina.push(`aviso:${id}:${duracaoS}`)
    },
    ocultarAviso: () => {
      pagina.push('ocultar')
    },
    agendar: relogio.agendar,
  })
  return { executor, falso, relogio, pagina }
}

const CENA_ID = '0b6e2b8a-3c1d-4f2a-9e5b-1a2b3c4d5e6f'
const trocar = (nomeObs: string): AcaoNoObs => ({ tipo: 'trocar_cena', nomeObs, cenaId: CENA_ID })
const OK = { resultado: 'ok', motivo: null }

describe('executor do OBS (Integração OBS, D1, D9, D10)', () => {
  test('constante da espera do clipe', () => {
    expect(ESPERA_DO_CLIPE_MS).toBe(5000)
  })

  test('trocar-cena-existente', async () => {
    const { executor, falso } = montar()
    expect(await executor.executar(trocar('Conversa'))).toEqual(OK)
    expect(falso.chamadas).toEqual(['trocarCena:Conversa'])
  })

  test('cena-inexistente-no-obs', async () => {
    const { executor, falso } = montar()
    expect(await executor.executar(trocar('Conversa '))).toEqual({ resultado: 'recusado', motivo: 'cena_inexistente_no_obs' })
    expect(await executor.executar(trocar('conversa'))).toEqual({ resultado: 'recusado', motivo: 'cena_inexistente_no_obs' })
    expect(falso.chamadas).toEqual([])
    // lista de cenas desconhecida (o OBS não respondeu) também recusa
    const semLista = montar({ obs: obsFalso({ cenas: null }) })
    expect(await semLista.executor.executar(trocar('Conversa'))).toEqual({ resultado: 'recusado', motivo: 'cena_inexistente_no_obs' })
    expect(semLista.falso.chamadas).toEqual([])
  })

  test('sem-permissao', async () => {
    const nivel3 = montar({ obs: obsFalso({ nivel: 3 }) })
    expect(await nivel3.executor.executar(trocar('Conversa'))).toEqual({ resultado: 'recusado', motivo: 'sem_permissao' })
    expect(nivel3.falso.chamadas).toEqual([])

    const nivel2 = montar({ obs: obsFalso({ nivel: 2 }) })
    expect(await nivel2.executor.executar(trocar('Conversa'))).toEqual({ resultado: 'recusado', motivo: 'sem_permissao' })
    expect(await nivel2.executor.executar({ tipo: 'salvar_clipe' })).toEqual({ resultado: 'recusado', motivo: 'sem_permissao' })
    expect(nivel2.falso.chamadas).toEqual([])
    nivel2.relogio.avancar(10_000)
    expect(nivel2.falso.chamadas).toEqual([])

    const desconhecido = montar({ obs: obsFalso({ nivel: null }) })
    expect(await desconhecido.executor.executar(trocar('Conversa'))).toEqual({ resultado: 'recusado', motivo: 'sem_permissao' })
    expect(await desconhecido.executor.executar({ tipo: 'salvar_clipe' })).toEqual({ resultado: 'recusado', motivo: 'sem_permissao' })

    // nível 3 basta para o clipe (BASIC)
    const clipe3 = montar({ obs: obsFalso({ nivel: 3 }) })
    const p = clipe3.executor.executar({ tipo: 'salvar_clipe' })
    await esvaziar()
    clipe3.relogio.avancar(5000)
    expect(await p).toEqual(OK)
  })

  test('clipe-espera-5s', async () => {
    const { executor, falso, relogio } = montar()
    let resultado: unknown = 'ainda esperando'
    const p = executor.executar({ tipo: 'salvar_clipe' }).then((r) => (resultado = r))
    await esvaziar()
    // enquanto espera, o clipe está pendente: outro pedido responde `pendente`
    expect(await executor.executar({ tipo: 'salvar_clipe' })).toEqual({ resultado: 'pendente', motivo: null })
    relogio.avancar(4999)
    await esvaziar()
    expect(falso.chamadas).toEqual([])
    expect(resultado).toBe('ainda esperando')
    relogio.avancar(1)
    await p
    expect(falso.chamadas).toEqual(['salvarClipe'])
    expect(resultado).toEqual(OK)
  })

  test('clipe-repetido-ignorado', async () => {
    const { executor, falso, relogio } = montar()
    const primeiro = executor.executar({ tipo: 'salvar_clipe' })
    await esvaziar()
    relogio.avancar(2000)
    expect(await executor.executar({ tipo: 'salvar_clipe' })).toEqual({ resultado: 'pendente', motivo: null })
    expect(await executor.executar({ tipo: 'salvar_clipe' })).toEqual({ resultado: 'pendente', motivo: null })
    relogio.avancar(3000)
    expect(await primeiro).toEqual(OK)
    relogio.avancar(10_000)
    await esvaziar()
    expect(falso.chamadas).toEqual(['salvarClipe'])
    // terminado o primeiro, um clipe novo volta a valer
    const segundo = executor.executar({ tipo: 'salvar_clipe' })
    await esvaziar()
    relogio.avancar(5000)
    expect(await segundo).toEqual(OK)
    expect(falso.chamadas).toEqual(['salvarClipe', 'salvarClipe'])
  })

  test('clipe-sem-replay-buffer', async () => {
    const { executor, falso, relogio } = montar({ obs: obsFalso({ status: { replayBuffer: false } }) })
    expect(await executor.executar({ tipo: 'salvar_clipe' })).toEqual({ resultado: 'falhou', motivo: 'replay_desligado' })
    relogio.avancar(10_000)
    expect(falso.chamadas).toEqual([])
    // status desconhecido também falha fechado
    const semStatus = montar({ obs: obsFalso({ status: null }) })
    expect(await semStatus.executor.executar({ tipo: 'salvar_clipe' })).toEqual({ resultado: 'falhou', motivo: 'replay_desligado' })
    // depois de uma falha, não fica clipe pendente
    const outro = montar({ obs: obsFalso({ status: { replayBuffer: false } }) })
    await outro.executor.executar({ tipo: 'salvar_clipe' })
    outro.falso.estado.status = { gravando: true, replayBuffer: true, transmitindo: false, cameraVirtual: false }
    const p = outro.executor.executar({ tipo: 'salvar_clipe' })
    await esvaziar()
    outro.relogio.avancar(5000)
    expect(await p).toEqual(OK)
  })

  test('marcador-sem-websocket', async () => {
    const { executor } = montar({ ws: null })
    expect(await executor.executar({ tipo: 'marcar', nome: 'Episódio 12:00:00' })).toEqual({ resultado: 'falhou', motivo: 'sem_websocket' })
    expect(executor.situacao().websocket).toBe('desligado')
  })

  test('marcador-sem-gravacao', async () => {
    const ws = wsFalso()
    const { executor } = montar({ obs: obsFalso({ status: { gravando: false } }), ws: ws.ws })
    expect(await executor.executar({ tipo: 'marcar', nome: 'Episódio 12:00:00' })).toEqual({ resultado: 'falhou', motivo: 'sem_gravacao' })
    expect(ws.marcados).toEqual([])
    // o OBS recusou o capítulo (sem gravação em Hybrid MP4, por exemplo)
    const recusa = wsFalso(false)
    const outro = montar({ ws: recusa.ws })
    expect(await outro.executor.executar({ tipo: 'marcar', nome: 'Episódio 12:00:00' })).toEqual({ resultado: 'falhou', motivo: 'sem_gravacao' })
    expect(recusa.marcados).toEqual(['Episódio 12:00:00'])
  })

  test('marcador-ok', async () => {
    const ws = wsFalso()
    const { executor } = montar({ ws: ws.ws })
    expect(await executor.executar({ tipo: 'marcar', nome: 'Episódio 12:00:00' })).toEqual(OK)
    expect(ws.marcados).toEqual(['Episódio 12:00:00'])
    // sem permissão de ler o status (nível 0), o OBS decide pela resposta do capítulo
    const ws0 = wsFalso()
    const nivel0 = montar({ obs: obsFalso({ nivel: 0, status: null }), ws: ws0.ws })
    expect(await nivel0.executor.executar({ tipo: 'marcar', nome: 'X 12:00:00' })).toEqual(OK)
    expect(ws0.marcados).toEqual(['X 12:00:00'])
  })

  test('obs-ausente', async () => {
    const ws = wsFalso()
    const { executor, falso, relogio, pagina } = montar({ obs: obsFalso({ disponivel: false }), ws: ws.ws })
    const ausente = { resultado: 'falhou', motivo: 'obs_ausente' }
    expect(await executor.executar(trocar('Conversa'))).toEqual(ausente)
    expect(await executor.executar({ tipo: 'salvar_clipe' })).toEqual(ausente)
    expect(await executor.executar({ tipo: 'marcar', nome: 'Episódio 12:00:00' })).toEqual(ausente)
    relogio.avancar(10_000)
    expect(falso.chamadas).toEqual([])
    expect(ws.marcados).toEqual([])
    // som e aviso são da própria página
    const SOM = '1b6e2b8a-3c1d-4f2a-9e5b-1a2b3c4d5e6f'
    const AVISO = '2b6e2b8a-3c1d-4f2a-9e5b-1a2b3c4d5e6f'
    expect(await executor.executar({ tipo: 'tocar_som', somId: SOM, volume: 0.5 })).toEqual(OK)
    expect(await executor.executar({ tipo: 'mostrar_aviso', avisoId: AVISO, duracaoS: 8 })).toEqual(OK)
    expect(await executor.executar({ tipo: 'ocultar_aviso' })).toEqual(OK)
    expect(pagina).toEqual([`som:${SOM}:0.5`, `aviso:${AVISO}:8`, 'ocultar'])
    expect(executor.situacao().navegador).toBe(false)
  })

  test('websocket-cai-depois', async () => {
    const ws = wsFalso()
    const { executor, relogio, falso } = montar({ ws: ws.ws })
    expect((await executor.atualizarSituacao()).websocket).toBe('conectado')
    // um clipe pendente atravessa a queda sem perder a guarda
    const clipe = executor.executar({ tipo: 'salvar_clipe' })
    await esvaziar()
    ws.estado.conectado = false
    expect(await executor.executar({ tipo: 'marcar', nome: 'Episódio 12:00:00' })).toEqual({ resultado: 'falhou', motivo: 'sem_websocket' })
    expect(ws.marcados).toEqual([])
    expect(executor.situacao()).toMatchObject({ websocket: 'sem_conexao', versaoObs: null })
    expect((await executor.atualizarSituacao()).websocket).toBe('sem_conexao')
    expect(await executor.executar({ tipo: 'salvar_clipe' })).toEqual({ resultado: 'pendente', motivo: null })
    relogio.avancar(5000)
    expect(await clipe).toEqual(OK)
    expect(falso.chamadas).toEqual(['salvarClipe'])
    // a conexão volta (a rota reconectou o mesmo objeto)
    ws.estado.conectado = true
    expect(await executor.executar({ tipo: 'marcar', nome: 'Episódio 12:00:10' })).toEqual(OK)
  })

  test('websocket-cai-durante-o-pedido', async () => {
    const ws = wsFalso()
    ws.estado.cairNoPedido = true
    const { executor } = montar({ ws: ws.ws })
    expect(await executor.executar({ tipo: 'marcar', nome: 'Episódio 12:00:00' })).toEqual({ resultado: 'falhou', motivo: 'sem_websocket' })
    expect(executor.situacao().websocket).toBe('sem_conexao')
  })

  test('parar-cancela-o-clipe-pendente', async () => {
    const { executor, falso, relogio, pagina } = montar()
    const clipe = executor.executar({ tipo: 'salvar_clipe' })
    await esvaziar()
    relogio.avancar(2000)
    executor.parar()
    relogio.avancar(3000)
    expect(await clipe).toEqual({ resultado: 'falhou', motivo: null })
    expect(falso.chamadas).toEqual([])
    // depois de parar, nada é executado
    expect(await executor.executar(trocar('Conversa'))).toEqual({ resultado: 'falhou', motivo: null })
    expect(await executor.executar({ tipo: 'mostrar_aviso', avisoId: CENA_ID, duracaoS: 5 })).toEqual({ resultado: 'falhou', motivo: null })
    expect(falso.chamadas).toEqual([])
    expect(pagina).toEqual([])
  })

  test('som-que-nao-toca-falha-sem-motivo', async () => {
    const { executor } = montar({ som: false })
    expect(await executor.executar({ tipo: 'tocar_som', somId: CENA_ID, volume: 1 })).toEqual({ resultado: 'falhou', motivo: null })
  })

  test('situacao', async () => {
    const { executor } = montar({ obs: obsFalso({ nivel: 4, status: { gravando: true, replayBuffer: false } }) })
    expect(executor.situacao()).toEqual({ navegador: true, versaoDoPlugin: '2.24.0', nivel: null, websocket: 'conectado', versaoObs: null, replayBuffer: null, gravando: null })
    const s = await executor.atualizarSituacao()
    expect(s).toEqual({ navegador: true, versaoDoPlugin: '2.24.0', nivel: 4, websocket: 'conectado', versaoObs: '31.0.1', replayBuffer: false, gravando: true })
    expect(executor.situacao()).toEqual(s)
    // cópia: mexer no objeto devolvido não muda o executor
    s.nivel = 5
    expect(executor.situacao().nivel).toBe(4)
    // sem websocket, o motivo informado vai para a situação (nunca a senha)
    const semWs = criarExecutorObs({ obs: obsFalso().obs, ws: null, estadoDoWebsocket: 'senha_errada', tocarSom: async () => true, mostrarAviso: () => {}, ocultarAviso: () => {}, agendar: () => {} })
    expect(semWs.situacao().websocket).toBe('senha_errada')
    expect((await semWs.atualizarSituacao()).versaoObs).toBeNull()
  })

  test('estado-do-websocket-por-funcao', async () => {
    // a rota troca o estado do websocket sem recriar o executor (Tarefa 6, rodada 1): a função é lida a cada situação
    const ws = wsFalso()
    ws.estado.conectado = false
    let fora: 'desligado' | 'senha_errada' | 'sem_conexao' = 'desligado'
    const executor = criarExecutorObs({ obs: obsFalso().obs, ws: ws.ws, estadoDoWebsocket: () => fora, tocarSom: async () => true, mostrarAviso: () => {}, ocultarAviso: () => {}, agendar: () => {} })
    expect(executor.situacao().websocket).toBe('desligado')
    fora = 'senha_errada'
    expect(executor.situacao().websocket).toBe('senha_errada')
    expect(await executor.executar({ tipo: 'marcar', nome: 'x' })).toEqual({ resultado: 'falhou', motivo: 'sem_websocket' })
    // conectado vence a função; a versão volta
    ws.estado.conectado = true
    expect((await executor.atualizarSituacao()).websocket).toBe('conectado')
    expect(executor.situacao().versaoObs).toBe('31.0.1')
    expect(await executor.executar({ tipo: 'marcar', nome: 'x' })).toEqual({ resultado: 'ok', motivo: null })
    // caiu de novo: a função decide (aqui, sem conexão)
    ws.estado.conectado = false
    fora = 'sem_conexao'
    expect(executor.situacao()).toMatchObject({ websocket: 'sem_conexao', versaoObs: null })
  })

  test('cena-atual-lida-do-obs (VER-044 A1, D9)', async () => {
    const { executor, falso } = montar()
    expect(executor.cenaAtual()).toBeNull() // ainda não lida
    await executor.atualizarSituacao()
    expect(executor.cenaAtual()).toBe('Abertura')
    // mudança feita à mão no OBS aparece na próxima leitura
    falso.estado.cenaAtual = 'Conversa'
    await executor.atualizarSituacao()
    expect(executor.cenaAtual()).toBe('Conversa')
    // a troca feita pelo próprio executor vale na hora
    await executor.executar(trocar('Abertura'))
    expect(executor.cenaAtual()).toBe('Abertura')
  })

  test.each([
    ['READ_OBS (abaixo de READ_USER)', 1],
    ['desconhecido', null],
  ])('cena-atual-respeita-o-nivel: %s não chama getCurrentScene', async (_nome, nivel) => {
    const { executor, falso } = montar({ obs: obsFalso({ nivel }) })
    await executor.atualizarSituacao()
    expect(executor.cenaAtual()).toBeNull()
    expect(falso.estado.leiturasDaCena).toBe(0)
    // READ_USER basta
    const r = montar({ obs: obsFalso({ nivel: 2 }) })
    await r.executor.atualizarSituacao()
    expect(r.executor.cenaAtual()).toBe('Abertura')
  })

  test('cena-atual-sem-obs', async () => {
    const falso = obsFalso()
    const { executor } = montar({ obs: falso })
    await executor.atualizarSituacao()
    falso.estado.disponivel = false
    expect(executor.cenaAtual()).toBeNull()
    await executor.atualizarSituacao()
    falso.estado.disponivel = true
    expect(executor.cenaAtual()).toBeNull()
  })
})
