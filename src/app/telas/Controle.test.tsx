// @vitest-environment jsdom
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, test, expect, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Papel } from '../../domains/acesso/papeis'
import { UUID } from '../../domains/aovivo/mensagens'
import { ErroDoAoVivo } from '../../domains/aovivo/portas'
import type { Cena } from '../../domains/preparacao/cenas'
import type { Aviso, Episodio } from '../../domains/preparacao/episodios'
import type { Som } from '../../domains/preparacao/midia'
import { ErroDePreparacao } from '../../domains/preparacao/portas'
import type { CanalDoEstudio, FabricaDeCanais } from '../../domains/aovivo/portas'
import type { ServicosDeAoVivo } from '../servicos'
import { aoVivoVazio, criarCanalFalso, criarFalsos, criarFalsosDePreparacao, usuarioGoogle } from '../servicosFalsos'
import { ESPERA_MAXIMA_DA_CONSULTA_MS, REAVALIACOES_DA_LEITURA, useAoVivo } from '../useAoVivo'
import type { AoVivo } from '../useAoVivo'
import { REABRIR_CANAIS_MS } from '../canais'
import { useEstudio } from '../useEstudio'
import { Controle, ConteudoDoControle, TEXTO_DO_CONTROLE } from './Controle'

/*
 * `/controle` por toque (PLA-004, Tarefa 7; D5, D9, D15, N3). A tela é desenhada direto
 * (`ConteudoDoControle`, com `reavaliar` espião) ou pela guarda (`Controle`, papel `apresentadora`).
 * Os canais são o adaptador **real** sobre o Realtime falso (`criarCanalFalso`): o que chega passa
 * pelos leitores do domínio, como no app. Relógio falso só para `setTimeout` (a reabertura de 5 s).
 */

const EU = 'a1b2c3d4-0000-4000-8000-000000000001'
const OUTRO = 'a1b2c3d4-0000-4000-8000-000000000002'
const PALCO = 'a1b2c3d4-0000-4000-8000-000000000003'
const DISPOSITIVO = 'a1b2c3d4-0000-4000-8000-000000000004'
const EP = 'e0000000-0000-4000-8000-000000000001'
const EP2 = 'e0000000-0000-4000-8000-000000000002'
const CENA_A = 'c0000000-0000-4000-8000-00000000000a'
const CENA_B = 'c0000000-0000-4000-8000-00000000000b'
const SOM = '50000000-0000-4000-8000-000000000001'
const AVISO = 'a0000000-0000-4000-8000-000000000001'
const AVISO2 = 'a0000000-0000-4000-8000-000000000002'
const AVISO_EP2 = 'a0000000-0000-4000-8000-000000000003'

const EPISODIOS: Episodio[] = [
  { id: EP, titulo: 'Ensaio geral', data: '2026-11-27', estado: 'rascunho' },
  { id: EP2, titulo: 'Programa de sexta', data: '2026-11-28', estado: 'ao_vivo' },
]
const CENAS: Cena[] = [
  { id: CENA_A, nomeExibicao: 'Geral', nomeObs: 'Cena Geral', ordem: 0 },
  { id: CENA_B, nomeExibicao: 'Close', nomeObs: 'Cena Close', ordem: 1 },
]
const SONS: Som[] = [{ id: SOM, midiaId: '60000000-0000-4000-8000-000000000001', rotulo: 'aplauso', emoji: '👏', volume: 1, ordem: 0 }]
const aviso = (id: string, episodioId: string, titulo: string, ordem: number): Aviso => ({ id, episodioId, titulo, texto: 'Texto', link: null, imagemMidiaId: null, duracaoS: 10, ordem })
const AVISOS: Aviso[] = [aviso(AVISO, EP, 'Inscrições JIF', 0), aviso(AVISO2, EP, 'Festa Revoada', 1), aviso(AVISO_EP2, EP2, 'Aviso da sexta', 0)]

const OBS = { navegador: true, versaoDoPlugin: '2.24.0', nivel: 4, websocket: 'conectado', versaoObs: '31.0.1', replayBuffer: true, gravando: true }
const controle = (id = EP) => `episodio:${id}:controle`
/** O tópico do estado no ar (VER-047): só o palco publica aqui; o `/controle` só lê. */
const estadoT = (id = EP) => `episodio:${id}:estado`
const estadoNoAr = (o: Record<string, unknown> = {}) => ({ episodioId: EP, modo: 'teste', cenaObs: null, avisoId: null, avisoAte: null, ultimo: null, obs: OBS, gestosLigados: false, remetente: PALCO, ...o })

/** Esvazia as promessas pendentes e anda `ms` no relógio falso (dentro do `act`). */
async function esperar(ms = 0) {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
    if (ms > 0) await vi.advanceTimersByTimeAsync(ms)
    for (let i = 0; i < 40; i++) await Promise.resolve()
  })
}

function servicosDeTeste(o: { ativo?: { id: string; modo: 'ao_vivo' | 'teste' } | null; avisos?: Aviso[]; sons?: Som[]; conectarSozinho?: boolean }) {
  const canal = criarCanalFalso({ conectarSozinho: o.conectarSozinho })
  let ativo = o.ativo === undefined ? { id: EP, modo: 'teste' as const } : o.ativo
  const episodioAtivo = vi.fn(async () => (ativo === null ? null : { ...ativo }))
  const aoVivo: ServicosDeAoVivo = { repo: { ...aoVivoVazio().repo, episodioAtivo }, canais: canal.canais }
  const prep = criarFalsosDePreparacao({ episodios: EPISODIOS, cenas: CENAS, sons: o.sons ?? SONS, avisos: o.avisos ?? AVISOS })
  return {
    canal,
    aoVivo,
    prep,
    episodioAtivo,
    definirAtivo(a: { id: string; modo: 'ao_vivo' | 'teste' } | null) {
      ativo = a
    },
  }
}

function montar(o: { ativo?: { id: string; modo: 'ao_vivo' | 'teste' } | null; papel?: Papel; avisos?: Aviso[]; sons?: Som[]; strict?: boolean; conectarSozinho?: boolean; antes?: (s: ReturnType<typeof servicosDeTeste>) => void } = {}) {
  const s = servicosDeTeste(o)
  o.antes?.(s)
  const reavaliar = vi.fn()
  const voltas = new Set<() => void>()
  const aoVoltarAVer = (f: () => void) => {
    voltas.add(f)
    return () => {
      voltas.delete(f)
    }
  }
  const tela = (
    <ConteudoDoControle
      titulo="Controle"
      usuario={usuarioGoogle('ana@revocast.test', EU)}
      papel={o.papel ?? 'equipe'}
      reavaliar={reavaliar}
      aoVivo={s.aoVivo}
      preparacao={s.prep.servicos}
      aoVoltarAVer={aoVoltarAVer}
    />
  )
  const r = render(o.strict ? <StrictMode>{tela}</StrictMode> : tela)
  return {
    ...s,
    r,
    reavaliar,
    voltar() {
      for (const f of [...voltas]) f()
    },
    /** Quantos canais já foram criados para o tópico (reabrir cria outro). */
    criados: (topico: string) => s.canal.realtime.criados.filter((c) => c.topico === topico).length,
  }
}

type Montado = ReturnType<typeof montar>

/** Troca `estudio()` da fábrica do usuário por uma versão que guarda cada alça com o `fechar` espiado (antes de desenhar). */
function espiarAlcasDoEstudio(s: ReturnType<typeof servicosDeTeste>) {
  const fabrica: FabricaDeCanais = s.canal.canais(EU)
  const original = fabrica.estudio.bind(fabrica)
  const alcas: { alca: CanalDoEstudio; fechar: ReturnType<typeof vi.fn> }[] = []
  fabrica.estudio = () => {
    const alca = original()
    const fecharDeVerdade = alca.fechar.bind(alca)
    const fechar = vi.fn(() => fecharDeVerdade())
    alca.fechar = fechar
    alcas.push({ alca, fechar })
    return alca
  }
  return alcas
}

const USUARIO = usuarioGoogle('ana@revocast.test', EU)
const SEM_VOLTA = () => () => {}

/** Usa os hooks direto (sem os botões): `estudioDeFora` abre o `estudio` como o painel fará (Tarefas 8 e 9) e o passa ao `useAoVivo`. */
function SondaDoHook(p: { s: ReturnType<typeof servicosDeTeste>; reavaliar: () => void; reavaliarDoPainel?: () => void; estudioDeFora?: boolean; aoDesenhar: (av: AoVivo) => void }) {
  const canais = p.s.aoVivo.canais(EU)
  const doPainel = useEstudio({ canais: p.estudioDeFora ? canais : null, papel: 'equipe', reavaliar: p.reavaliarDoPainel ?? (() => {}) })
  const av = useAoVivo({ repo: p.s.aoVivo.repo, preparacao: p.s.prep.servicos, canais, usuario: USUARIO, papel: 'equipe', reavaliar: p.reavaliar, aoVoltarAVer: SEM_VOLTA, estudio: p.estudioDeFora ? doPainel : undefined })
  p.aoDesenhar(av)
  return <p>{av.canal}</p>
}

function montarSonda(o: { estudioDeFora?: boolean } = {}) {
  const s = servicosDeTeste({})
  const reavaliar = vi.fn()
  const reavaliarDoPainel = vi.fn()
  let ultimo: AoVivo | null = null
  const r = render(<SondaDoHook s={s} reavaliar={reavaliar} reavaliarDoPainel={reavaliarDoPainel} estudioDeFora={o.estudioDeFora} aoDesenhar={(av) => (ultimo = av)} />)
  const criados = (topico: string) => s.canal.realtime.criados.filter((c) => c.topico === topico).length
  return { ...s, r, reavaliar, reavaliarDoPainel, criados, av: () => ultimo as unknown as AoVivo }
}

function palcoPresente(m: Montado) {
  act(() => m.canal.sincronizarPresenca('estudio', { [PALCO]: [{ tipo: 'obs_palco', dispositivoId: DISPOSITIVO, obs: null }] }))
}

/** Monta com episódio, espera os canais conectarem e põe o palco na presença de `estudio`. */
async function pronto(o: Parameters<typeof montar>[0] = {}) {
  const m = montar(o)
  await esperar()
  palcoPresente(m)
  await esperar()
  return m
}

const botao = (nome: string) => screen.getByRole('button', { name: nome }) as HTMLButtonElement
const NOMES_DOS_BOTOES = ['Inscrições JIF ▶', 'Festa Revoada ▶', 'Próximo aviso', 'Ocultar aviso', '👏 aplauso', 'Geral', 'Close', '✂️ CLIPE', '🔖 MARCAR']

function comandosEnviados(m: Montado, ep = EP) {
  return m.canal.enviados(controle(ep)).filter((e) => e.event === 'comando').map((e) => e.payload as Record<string, unknown>)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('/controle por toque (Tarefa 7)', () => {
  test('controle-sem-episodio', async () => {
    const m = montar({ ativo: null })
    await esperar()
    expect(screen.getByText(TEXTO_DO_CONTROLE.semEpisodio)).toBeTruthy()
    expect(TEXTO_DO_CONTROLE.semEpisodio).toBe('Nenhum episódio no ar nem em teste.')
    expect(screen.queryByRole('button', { name: '✂️ CLIPE' })).toBeNull()
    expect(m.canal.abertos()).toEqual(['estudio'])
  })

  test('controle-mostra-estado', async () => {
    const m = await pronto()
    const estado = screen.getByRole('region', { name: 'Estado' })
    expect(within(estado).getByText('TESTE')).toBeTruthy()
    expect(within(estado).getByText('Ensaio geral')).toBeTruthy()
    act(() => m.canal.entregar(estadoT(), 'estado', estadoNoAr({ cenaObs: 'Cena Geral', avisoId: AVISO2 })))
    await esperar()
    // a cena pelo nome de exibição da lista e o aviso pelo título da lista
    expect(within(estado).getByText('Geral')).toBeTruthy()
    expect(within(estado).getByText('Festa Revoada')).toBeTruthy()
    // cena que a lista não conhece: o nome do OBS, como texto
    act(() => m.canal.entregar(estadoT(), 'estado', estadoNoAr({ cenaObs: 'Cena Avulsa', avisoId: null })))
    await esperar()
    expect(within(estado).getByText('Cena Avulsa')).toBeTruthy()
    expect(within(estado).queryByText('Festa Revoada')).toBeNull()
    // estado de outro episódio não entra
    act(() => m.canal.entregar(estadoT(), 'estado', estadoNoAr({ episodioId: EP2, cenaObs: 'Cena Close' })))
    await esperar()
    expect(within(estado).getByText('Cena Avulsa')).toBeTruthy()
  })

  test('controle-mostra-ao-vivo', async () => {
    await pronto({ ativo: { id: EP2, modo: 'ao_vivo' } })
    const estado = screen.getByRole('region', { name: 'Estado' })
    expect(within(estado).getByText('AO VIVO')).toBeTruthy()
    expect(within(estado).getByText('Programa de sexta')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Aviso da sexta ▶' })).toBeTruthy()
  })

  test('controle-titulos-h2', async () => {
    // Tarefa 9, rodada 1 (N1): no `/controle`, os grupos continuam `h2`, logo abaixo do `h1`
    await pronto()
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Avisos', 'Sons', 'Cenas'])
    expect(screen.queryAllByRole('heading', { level: 3 })).toEqual([])
  })

  test('toque-envia-comando', async () => {
    const m = await pronto()
    for (const nome of ['👏 aplauso', 'Close', 'Festa Revoada ▶', 'Próximo aviso', 'Ocultar aviso', '✂️ CLIPE', '🔖 MARCAR']) {
      fireEvent.click(botao(nome))
      await esperar()
    }
    const enviados = comandosEnviados(m)
    expect(enviados.map(({ id: _id, ...resto }) => resto)).toEqual([
      { acao: 'som', somId: SOM, remetente: EU },
      { acao: 'cena', cenaId: CENA_B, remetente: EU },
      { acao: 'aviso', avisoId: AVISO2, remetente: EU },
      { acao: 'proximo_aviso', remetente: EU },
      { acao: 'ocultar_aviso', remetente: EU },
      { acao: 'clipe', remetente: EU },
      { acao: 'marcador', remetente: EU },
    ])
    for (const e of enviados) expect(e.id).toMatch(UUID)
    expect(new Set(enviados.map((e) => e.id)).size).toBe(7)
    expect(m.reavaliar).not.toHaveBeenCalled()
  })

  test('ultimo-resultado', async () => {
    const m = await pronto()
    fireEvent.click(botao('👏 aplauso'))
    await esperar()
    const [som] = comandosEnviados(m)
    act(() => m.canal.entregar(estadoT(), 'estado', estadoNoAr({ ultimo: { comandoId: som.id, acao: 'som', resultado: 'ok', motivo: null, origem: 'toque', gesto: null } })))
    await esperar()
    expect(screen.getByText('🎵 aplauso ✓')).toBeTruthy()
    fireEvent.click(botao('Geral'))
    await esperar()
    const cena = comandosEnviados(m)[1]
    act(() => m.canal.entregar(estadoT(), 'estado', estadoNoAr({ ultimo: { comandoId: cena.id, acao: 'cena', resultado: 'recusado', motivo: 'cena_inexistente_no_obs', origem: 'toque', gesto: null } })))
    await esperar()
    expect(screen.getByText('Cena não existe no OBS')).toBeTruthy()
    // comando de outra pessoa: só a ação
    act(() =>
      m.canal.entregar(estadoT(), 'estado', estadoNoAr({ ultimo: { comandoId: 'f0000000-0000-4000-8000-000000000009', acao: 'clipe', resultado: 'pendente', motivo: null, origem: 'toque', gesto: null } })),
    )
    await esperar()
    expect(screen.getByText('✂️ Clipe …')).toBeTruthy()
  })

  test('botoes-desligados-sem-conexao', async () => {
    const m = await pronto()
    for (const nome of NOMES_DOS_BOTOES) expect(botao(nome).disabled, nome).toBe(false)
    act(() => m.canal.definirEstado(controle(), 'reconectando'))
    await esperar()
    for (const nome of NOMES_DOS_BOTOES) expect(botao(nome).disabled, nome).toBe(true)
    expect(screen.getByText(TEXTO_DO_CONTROLE.reconectando)).toBeTruthy()
    expect(TEXTO_DO_CONTROLE.reconectando).toBe('Reconectando…')
    act(() => m.canal.definirEstado(controle(), 'conectado'))
    await esperar()
    for (const nome of NOMES_DOS_BOTOES) expect(botao(nome).disabled, nome).toBe(false)
    expect(screen.queryByText(TEXTO_DO_CONTROLE.reconectando)).toBeNull()
    // `estudio` caindo também desliga (os dois dividem o socket)
    act(() => m.canal.definirEstado('estudio', 'reconectando'))
    await esperar()
    expect(botao('✂️ CLIPE').disabled).toBe(true)
    expect(m.reavaliar).not.toHaveBeenCalled()
  })

  test('ack-sem-resposta-avisa', async () => {
    const m = await pronto()
    m.canal.responderEnvio('sem_resposta')
    fireEvent.click(botao('✂️ CLIPE'))
    await esperar()
    expect(screen.getByText(TEXTO_DO_CONTROLE.semResposta)).toBeTruthy()
    expect(TEXTO_DO_CONTROLE.semResposta).toBe('O comando não chegou (rede ou acesso). Tente de novo.')
    expect(m.reavaliar).not.toHaveBeenCalled()
    // uma região viva só (o `role="alert"` da mensagem), sem aninhar
    expect(m.r.container.querySelector('[aria-live] [role="alert"], [role="alert"] [aria-live], [role="alert"] [role="alert"]')).toBeNull()
    // nada é reenviado sozinho
    await esperar(10_000)
    expect(comandosEnviados(m)).toHaveLength(1)
    m.canal.responderEnvio('ok')
    fireEvent.click(botao('🔖 MARCAR'))
    await esperar()
    expect(screen.queryByText(TEXTO_DO_CONTROLE.semResposta)).toBeNull()
    m.canal.responderEnvio('falhou')
    fireEvent.click(botao('🔖 MARCAR'))
    await esperar()
    expect(screen.getByText(TEXTO_DO_CONTROLE.falhou)).toBeTruthy()
  })

  test('estado-forjado-invalido-ignorado', async () => {
    const m = await pronto()
    act(() => m.canal.entregar(estadoT(), 'estado', estadoNoAr({ cenaObs: 'Cena Geral', avisoId: AVISO })))
    await esperar()
    const estado = screen.getByRole('region', { name: 'Estado' })
    const antes = estado.innerHTML
    const forjados: unknown[] = [
      estadoNoAr({ cenaObs: 'x'.repeat(201) }),
      estadoNoAr({ avisoId: AVISO2, extra: true }),
      estadoNoAr({ avisoId: AVISO2.toUpperCase() }),
      estadoNoAr({ ultimo: { comandoId: AVISO, acao: 'clipe', resultado: 'recusado', motivo: '<b>texto livre</b>', origem: 'toque', gesto: null } }),
      { ...estadoNoAr({ avisoId: AVISO2 }), remetente: undefined },
      JSON.parse(`{"__proto__":{"x":1},${JSON.stringify(estadoNoAr({ avisoId: AVISO2 })).slice(1)}`),
      estadoNoAr({ obs: { ...OBS, nivel: 9 } }),
      'texto',
    ]
    for (const f of forjados) act(() => m.canal.entregar(estadoT(), 'estado', f))
    await esperar()
    expect(estado.innerHTML).toBe(antes)
    expect(within(estado).getByText('Inscrições JIF')).toBeTruthy()
    expect(document.body.textContent).not.toContain('texto livre')
  })

  test('troca-de-episodio', async () => {
    const m = await pronto()
    expect(m.canal.abertos()).toEqual(['estudio', controle(EP), estadoT(EP)])
    m.definirAtivo({ id: EP2, modo: 'ao_vivo' })
    act(() => m.canal.entregar('estudio', 'episodio_ativo_mudou', { remetente: OUTRO }))
    await esperar()
    expect(m.canal.abertos()).toEqual(['estudio', controle(EP2), estadoT(EP2)])
    expect(screen.getByRole('button', { name: 'Aviso da sexta ▶' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Inscrições JIF ▶' })).toBeNull()
    expect(screen.getByText('AO VIVO')).toBeTruthy()
    // o comando vai ao tópico novo
    fireEvent.click(botao('✂️ CLIPE'))
    await esperar()
    expect(comandosEnviados(m, EP2)).toHaveLength(1)
    expect(comandosEnviados(m, EP)).toHaveLength(0)
    // a presença em `:controle` é marcada no tópico novo (o palco republica o estado)
    expect(m.canal.presencas(controle(EP2))).toEqual([{}])
  })

  test('estado-de-remetente-revogado-ignorado (D5, VER-046 N3)', async () => {
    const m = await pronto()
    const estado = screen.getByRole('region', { name: 'Estado' })
    act(() => m.canal.entregar(estadoT(), 'estado', estadoNoAr({ cenaObs: 'Cena Geral' })))
    await esperar()
    expect(within(estado).getByText('Geral')).toBeTruthy()
    // o palco antigo (trocado ou revogado) é avisado em `estudio`: o estado dele deixa de valer por 15 min
    act(() => m.canal.entregar('estudio', 'revogacao', { usuario: PALCO, remetente: OUTRO }))
    await esperar()
    act(() => m.canal.entregar(estadoT(), 'estado', estadoNoAr({ cenaObs: 'Cena Avulsa' })))
    await esperar()
    expect(within(estado).queryByText('Cena Avulsa')).toBeNull()
    expect(within(estado).getByText('Geral')).toBeTruthy()
    expect(m.reavaliar).not.toHaveBeenCalled()
    // o estado de outro remetente (o palco novo) continua valendo
    const NOVO = 'a1b2c3d4-0000-4000-8000-000000000004'
    act(() => m.canal.entregar(estadoT(), 'estado', estadoNoAr({ cenaObs: 'Cena Avulsa', remetente: NOVO })))
    await esperar()
    expect(within(estado).getByText('Cena Avulsa')).toBeTruthy()
  })

  test('membro-revogado-reavalia', async () => {
    const m = await pronto()
    act(() => m.canal.entregar('estudio', 'revogacao', { usuario: OUTRO, remetente: OUTRO }))
    await esperar()
    expect(m.reavaliar).not.toHaveBeenCalled()
    act(() => m.canal.entregar('estudio', 'revogacao', { usuario: EU, remetente: OUTRO }))
    await esperar()
    expect(m.reavaliar).toHaveBeenCalledTimes(1)
  })

  test('apresentadora-usa', async () => {
    const s = servicosDeTeste({})
    const f = criarFalsos({ usuario: usuarioGoogle('ana@revocast.test', EU), papel: 'apresentadora' })
    const obterAoVivo = vi.fn(() => s.aoVivo)
    render(<Controle titulo="Controle" dependencias={f.dependencias({ obterAoVivo, obterPreparacao: () => s.prep.servicos })} />)
    await esperar()
    expect(screen.getByText('Apresentadora')).toBeTruthy()
    act(() => s.canal.sincronizarPresenca('estudio', { [PALCO]: [{ tipo: 'obs_palco', dispositivoId: DISPOSITIVO, obs: null }] }))
    await esperar()
    fireEvent.click(botao('✂️ CLIPE'))
    await esperar()
    expect(s.canal.enviados(controle()).map((e) => (e.payload as { acao: string }).acao)).toEqual(['clipe'])
    expect(s.canal.presencas('estudio')).toEqual([{ tipo: 'membro', papel: 'apresentadora' }])
    expect(obterAoVivo).toHaveBeenCalledTimes(1)
  })

  test('titulo-com-html-literal', async () => {
    const html = '<b>JIF</b><img src=x onerror=alert(1)>'
    const m = await pronto({
      avisos: [aviso(AVISO, EP, html, 0)],
      sons: [{ ...SONS[0], rotulo: '<i>palmas</i>', emoji: '<u>' }],
    })
    expect(screen.getByRole('button', { name: `${html} ▶` })).toBeTruthy()
    expect(screen.getByRole('button', { name: '<u> <i>palmas</i>' })).toBeTruthy()
    act(() => m.canal.entregar(estadoT(), 'estado', estadoNoAr({ avisoId: AVISO, cenaObs: '<script>x</script>' })))
    await esperar()
    expect(within(screen.getByRole('region', { name: 'Estado' })).getByText(html)).toBeTruthy()
    expect(screen.getByText('<script>x</script>')).toBeTruthy()
    expect(m.r.container.querySelector('b, i, u, script, img[src="x"]')).toBeNull()
  })

  test('voltar-a-ver-reconecta', async () => {
    const m = await pronto()
    expect(m.episodioAtivo).toHaveBeenCalledTimes(1)
    m.definirAtivo({ id: EP2, modo: 'ao_vivo' })
    m.voltar()
    await esperar()
    expect(m.episodioAtivo).toHaveBeenCalledTimes(2)
    expect(m.canal.abertos()).toEqual(['estudio', controle(EP2), estadoT(EP2)])
    // a volta do canal a `conectado` também consulta de novo (D15)
    act(() => m.canal.definirEstado('estudio', 'reconectando'))
    await esperar()
    act(() => m.canal.definirEstado('estudio', 'conectado'))
    await esperar()
    expect(m.episodioAtivo).toHaveBeenCalledTimes(3)
  })

  test('palco-ausente-avisa', async () => {
    const m = montar()
    await esperar()
    expect(screen.getByText(TEXTO_DO_CONTROLE.palcoAusente)).toBeTruthy()
    expect(TEXTO_DO_CONTROLE.palcoAusente).toBe('O palco não está conectado.')
    palcoPresente(m)
    await esperar()
    expect(screen.queryByText(TEXTO_DO_CONTROLE.palcoAusente)).toBeNull()
    // só a presença de um membro não é palco
    act(() => m.canal.sincronizarPresenca('estudio', { [OUTRO]: [{ tipo: 'membro', papel: 'equipe' }] }))
    await esperar()
    expect(screen.getByText(TEXTO_DO_CONTROLE.palcoAusente)).toBeTruthy()
  })

  test.each(['fechado', 'negado'] as const)('canal-fechado-reavalia (%s)', async (estado) => {
    let alcas: ReturnType<typeof espiarAlcasDoEstudio> = []
    const m = await pronto({ antes: (s) => (alcas = espiarAlcasDoEstudio(s)) })
    expect(alcas).toHaveLength(1)
    act(() => m.canal.definirEstado('estudio', estado))
    await esperar()
    expect(screen.getByText(TEXTO_DO_CONTROLE.semAcesso)).toBeTruthy()
    expect(TEXTO_DO_CONTROLE.semAcesso).toBe('Sem acesso ao canal; conferindo o seu acesso.')
    expect(TEXTO_DO_CONTROLE.reconectando).not.toBe(TEXTO_DO_CONTROLE.semAcesso)
    expect(screen.queryByText(TEXTO_DO_CONTROLE.reconectando)).toBeNull()
    expect(m.reavaliar).toHaveBeenCalledTimes(1)
    expect(botao('✂️ CLIPE').disabled).toBe(true)
    await esperar(REABRIR_CANAIS_MS - 1)
    expect(m.criados('estudio')).toBe(1)
    expect(alcas[0].fechar).not.toHaveBeenCalled() // a alça morta fica até a reabertura
    await esperar(1)
    expect(m.criados('estudio')).toBe(2)
    expect(m.canal.abertos()).toContain('estudio')
    // a alça morta foi fechada (os ouvintes dela saem do registro velho) e a nova continua aberta
    expect(alcas).toHaveLength(2)
    expect(alcas[0].fechar).toHaveBeenCalledTimes(1)
    expect(alcas[1].fechar).not.toHaveBeenCalled()
    expect(screen.queryByText(TEXTO_DO_CONTROLE.semAcesso)).toBeNull()
    palcoPresente(m)
    await esperar()
    expect(botao('✂️ CLIPE').disabled).toBe(false)
    expect(m.reavaliar).toHaveBeenCalledTimes(1)
  })

  test('canal-fechado-reavalia (`:controle` e os dois juntos: uma reavaliação)', async () => {
    const m = await pronto()
    act(() => {
      m.canal.definirEstado(controle(), 'fechado')
      m.canal.definirEstado('estudio', 'fechado')
    })
    await esperar()
    expect(m.reavaliar).toHaveBeenCalledTimes(1)
    await esperar(REABRIR_CANAIS_MS)
    expect(m.criados(controle())).toBe(2)
    expect(m.criados('estudio')).toBe(2)
    expect(m.canal.abertos()).toEqual(expect.arrayContaining(['estudio', controle(), estadoT()]))
    // desmontar fecha tudo
    m.r.unmount()
    await esperar()
    expect(m.canal.abertos()).toEqual([])
  })

  test('dois-sem-resposta-reavalia', async () => {
    const m = await pronto()
    m.canal.responderEnvio('sem_resposta')
    fireEvent.click(botao('✂️ CLIPE'))
    await esperar()
    expect(screen.getByText(TEXTO_DO_CONTROLE.semResposta)).toBeTruthy()
    expect(m.reavaliar).not.toHaveBeenCalled()
    // um `ok` no meio zera a contagem
    m.canal.responderEnvio('ok')
    fireEvent.click(botao('🔖 MARCAR'))
    await esperar()
    m.canal.responderEnvio('sem_resposta')
    fireEvent.click(botao('✂️ CLIPE'))
    await esperar()
    expect(m.reavaliar).not.toHaveBeenCalled()
    fireEvent.click(botao('✂️ CLIPE'))
    await esperar()
    expect(m.reavaliar).toHaveBeenCalledTimes(1)
    // a contagem recomeça depois da reavaliação
    fireEvent.click(botao('✂️ CLIPE'))
    await esperar()
    expect(m.reavaliar).toHaveBeenCalledTimes(1)
  })

  test('falha-ao-carregar-tenta-de-novo', async () => {
    const m = montar({ antes: (s) => s.episodioAtivo.mockRejectedValueOnce(new ErroDoAoVivo('rede')) })
    await esperar()
    expect(screen.getByText(TEXTO_DO_CONTROLE.falhaAoCarregar)).toBeTruthy()
    expect(screen.queryByText(TEXTO_DO_CONTROLE.semEpisodio)).toBeNull()
    expect(m.reavaliar).not.toHaveBeenCalled()
    await esperar(REABRIR_CANAIS_MS)
    expect(m.episodioAtivo).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(TEXTO_DO_CONTROLE.falhaAoCarregar)).toBeNull()
    expect(screen.getByRole('button', { name: '✂️ CLIPE' })).toBeTruthy()
  })

  test('controle-desabilitado-com-consulta-falha', async () => {
    // Tarefa 9, rodada 2: outro painel troca o episódio (EP → EP2) e a consulta falha; a tela ainda mostra EP,
    // então os botões ficam desabilitados com a frase de falha e nenhum toque vai ao `:controle` de EP
    const m = await pronto()
    expect(botao('✂️ CLIPE').disabled).toBe(false)
    m.definirAtivo({ id: EP2, modo: 'ao_vivo' })
    m.episodioAtivo.mockRejectedValueOnce(new ErroDoAoVivo('rede'))
    act(() => m.canal.entregar('estudio', 'episodio_ativo_mudou', { remetente: OUTRO }))
    await esperar()
    expect(screen.getByText(TEXTO_DO_CONTROLE.falhaAoCarregar)).toBeTruthy()
    expect(botao('✂️ CLIPE').disabled).toBe(true)
    fireEvent.click(botao('✂️ CLIPE'))
    await esperar()
    expect(comandosEnviados(m)).toHaveLength(0)
    // a nova consulta (5 s depois) dá certo: EP2 na tela, o toque vai para EP2
    await esperar(REABRIR_CANAIS_MS)
    await esperar()
    expect(screen.queryByText(TEXTO_DO_CONTROLE.falhaAoCarregar)).toBeNull()
    expect(botao('✂️ CLIPE').disabled).toBe(false)
    fireEvent.click(botao('✂️ CLIPE'))
    await esperar()
    expect(comandosEnviados(m, EP2)).toHaveLength(1)
    expect(comandosEnviados(m)).toHaveLength(0)
  })

  test('acesso-negado-ao-carregar-reavalia', async () => {
    const m = montar({ antes: (s) => s.prep.falharProxima('cenas.listar', new ErroDePreparacao('negado')) })
    await esperar()
    expect(m.reavaliar).toHaveBeenCalledTimes(1)
    expect(screen.getByText(TEXTO_DO_CONTROLE.falhaAoCarregar)).toBeTruthy()
  })

  test('controle-strict-mode', async () => {
    const m = montar({ strict: true })
    await esperar()
    palcoPresente(m)
    await esperar()
    expect(m.canal.abertos()).toEqual(['estudio', controle(), estadoT()])
    fireEvent.click(botao('✂️ CLIPE'))
    await esperar()
    expect(comandosEnviados(m)).toHaveLength(1)
    m.r.unmount()
    await esperar()
    expect(m.canal.abertos()).toEqual([])
  })

  test.each(['fechado', 'negado'] as const)('desmontar-na-espera-nao-reabre (%s)', async (estado) => {
    const m = await pronto()
    act(() => {
      m.canal.definirEstado('estudio', estado)
      m.canal.definirEstado(controle(), estado)
    })
    await esperar(1000)
    expect(m.reavaliar).toHaveBeenCalledTimes(1)
    // a guarda desmonta a tela (a pessoa foi removida) antes dos 5 s
    m.r.unmount()
    await esperar()
    expect(vi.getTimerCount()).toBe(0)
    await esperar(10_000)
    expect(m.criados('estudio')).toBe(1)
    expect(m.criados(controle())).toBe(1)
    expect(m.canal.abertos()).toEqual([])
    expect(m.reavaliar).toHaveBeenCalledTimes(1)
  })

  test('consulta-antiga-nao-sobrescreve', async () => {
    let soltar: (v: { id: string; modo: 'ao_vivo' | 'teste' }) => void = () => {}
    const m = montar({
      antes: (s) => s.episodioAtivo.mockImplementationOnce(() => new Promise((r) => (soltar = r))),
    })
    await esperar()
    // a primeira consulta está pendurada; a volta à aba consulta de novo e já traz EP2
    m.definirAtivo({ id: EP2, modo: 'ao_vivo' })
    m.voltar()
    await esperar()
    expect(screen.getByText('Programa de sexta')).toBeTruthy()
    // a resposta atrasada (EP) chega depois e é descartada
    soltar({ id: EP, modo: 'teste' })
    await esperar()
    expect(screen.getByText('Programa de sexta')).toBeTruthy()
    expect(screen.queryByText('Ensaio geral')).toBeNull()
    expect(m.canal.abertos()).toEqual(['estudio', controle(EP2), estadoT(EP2)])
    expect(m.criados(controle(EP))).toBe(0)
  })

  test('estado-so-de-topico-proprio (VER-047): o estado forjado no `:controle` é ignorado', async () => {
    const m = await pronto()
    const estado = screen.getByRole('region', { name: 'Estado' })
    // um estado válido, mas vindo de `:controle` (onde só membros enviam e o palco não publica mais), não entra
    act(() => m.canal.entregar(controle(), 'estado', estadoNoAr({ cenaObs: 'Cena Geral', avisoId: AVISO2 })))
    await esperar()
    expect(within(estado).queryByText('Geral')).toBeNull()
    expect(within(estado).queryByText('Festa Revoada')).toBeNull()
    // o mesmo estado vindo de `:estado` entra
    act(() => m.canal.entregar(estadoT(), 'estado', estadoNoAr({ cenaObs: 'Cena Geral', avisoId: AVISO2 })))
    await esperar()
    expect(within(estado).getByText('Geral')).toBeTruthy()
    expect(within(estado).getByText('Festa Revoada')).toBeTruthy()
    // o `/controle` não envia nada no `:estado` (a RLS também não deixa) e a presença fica só no `:controle`
    fireEvent.click(botao('✂️ CLIPE'))
    await esperar()
    expect(m.canal.enviados(estadoT())).toEqual([])
    expect(m.canal.presencas(estadoT())).toEqual([])
    expect(m.canal.presencas(controle())).toEqual([{}])
  })

  test('reconexao-do-estado (VER-047): `:estado` fora desliga os botões; fechado reavalia e reabre os dois tópicos', async () => {
    const m = await pronto()
    act(() => m.canal.definirEstado(estadoT(), 'reconectando'))
    await esperar()
    expect(botao('✂️ CLIPE').disabled).toBe(true)
    expect(screen.getByText(TEXTO_DO_CONTROLE.reconectando)).toBeTruthy()
    act(() => m.canal.definirEstado(estadoT(), 'conectado'))
    await esperar()
    expect(botao('✂️ CLIPE').disabled).toBe(false)
    act(() => m.canal.definirEstado(estadoT(), 'fechado'))
    await esperar()
    expect(m.reavaliar).toHaveBeenCalledTimes(1)
    await esperar(REABRIR_CANAIS_MS)
    expect(m.criados(estadoT())).toBe(2)
    expect(m.criados(controle())).toBe(1) // o `:controle` continuou
    expect(m.canal.abertos()).toEqual(['estudio', controle(), estadoT()])
    act(() => m.canal.entregar(estadoT(), 'estado', estadoNoAr({ cenaObs: 'Cena Geral' })))
    await esperar()
    expect(within(screen.getByRole('region', { name: 'Estado' })).getByText('Geral')).toBeTruthy()
  })

  test('presenca-so-com-o-estado-conectado (VER-047, rodada 1)', async () => {
    // a entrada na presença do `:controle` faz o palco republicar: ela só sai com o `:estado` já conectado
    const m = montar({ conectarSozinho: false })
    await esperar()
    act(() => {
      m.canal.definirEstado('estudio', 'conectado')
      m.canal.definirEstado(controle(), 'conectado')
    })
    await esperar()
    expect(m.canal.abertos()).toEqual(['estudio', controle(), estadoT()])
    expect(m.canal.presencas(controle())).toEqual([])
    act(() => m.canal.definirEstado(estadoT(), 'reconectando'))
    await esperar()
    expect(m.canal.presencas(controle())).toEqual([])
    act(() => m.canal.definirEstado(estadoT(), 'conectado'))
    await esperar()
    expect(m.canal.presencas(controle())).toEqual([{}])
  })

  test('troca-de-episodio-limpa-o-estado', async () => {
    const m = await pronto()
    act(() => m.canal.entregar(estadoT(), 'estado', estadoNoAr({ cenaObs: 'Cena Geral', avisoId: AVISO })))
    await esperar()
    expect(within(screen.getByRole('region', { name: 'Estado' })).getByText('Inscrições JIF')).toBeTruthy()
    for (const ativo of [{ id: EP2, modo: 'ao_vivo' as const }, { id: EP, modo: 'teste' as const }]) {
      m.definirAtivo(ativo)
      act(() => m.canal.entregar('estudio', 'episodio_ativo_mudou', { remetente: OUTRO }))
      await esperar()
    }
    // de volta a EP: o estado velho de EP não reaparece antes de o palco republicar
    const estado = screen.getByRole('region', { name: 'Estado' })
    expect(within(estado).getByText('Ensaio geral')).toBeTruthy()
    expect(within(estado).queryByText('Inscrições JIF')).toBeNull()
    expect(within(estado).queryByText('Geral')).toBeNull()
  })

  test('sem-resposta-zera-na-queda-e-na-troca', async () => {
    const m = await pronto()
    m.canal.responderEnvio('sem_resposta')
    fireEvent.click(botao('✂️ CLIPE'))
    await esperar()
    // queda e volta do canal entre os dois
    act(() => m.canal.definirEstado(controle(), 'reconectando'))
    await esperar()
    act(() => m.canal.definirEstado(controle(), 'conectado'))
    await esperar()
    fireEvent.click(botao('✂️ CLIPE'))
    await esperar()
    expect(m.reavaliar).not.toHaveBeenCalled()
    // troca de episódio entre os dois
    m.definirAtivo({ id: EP2, modo: 'ao_vivo' })
    act(() => m.canal.entregar('estudio', 'episodio_ativo_mudou', { remetente: OUTRO }))
    await esperar()
    fireEvent.click(botao('✂️ CLIPE'))
    await esperar()
    expect(m.reavaliar).not.toHaveBeenCalled()
    // controle positivo: duas seguidas no mesmo canal e episódio reavaliam
    fireEvent.click(botao('✂️ CLIPE'))
    await esperar()
    expect(m.reavaliar).toHaveBeenCalledTimes(1)
  })

  test('enviar-so-com-canal-conectado (sem depender do botão)', async () => {
    const m = montarSonda()
    await esperar()
    expect(m.av().canal).toBe('conectado')
    // `estudio` caiu e o `:controle` continua conectado: o adaptador enviaria, o hook não deixa
    act(() => m.canal.definirEstado('estudio', 'reconectando'))
    await esperar()
    expect(m.av().canal).toBe('reconectando')
    let resposta: string | null = null
    await act(async () => {
      resposta = await m.av().enviar({ acao: 'clipe' })
    })
    expect(resposta).toBe('falhou')
    expect(m.canal.enviados(controle())).toEqual([])
    // de volta a conectado, o mesmo pedido sai
    act(() => m.canal.definirEstado('estudio', 'conectado'))
    await esperar()
    await act(async () => {
      resposta = await m.av().enviar({ acao: 'clipe' })
    })
    expect(resposta).toBe('ok')
    expect(m.canal.enviados(controle())).toHaveLength(1)
  })

  test('enviar-bloqueado-depois-de-consulta-falha (sem depender do botão)', async () => {
    // Tarefa 9, rodada 3 (R3-1): a trava do `enviar` também olha a última consulta. Outro painel troca o episódio
    // (EP → EP2) e a consulta falha: com os dois canais conectados, o `enviar` do hook devolve `falhou` e nada sai
    const m = montarSonda()
    await esperar()
    m.definirAtivo({ id: EP2, modo: 'ao_vivo' })
    m.episodioAtivo.mockRejectedValueOnce(new ErroDoAoVivo('rede'))
    act(() => m.canal.entregar('estudio', 'episodio_ativo_mudou', { remetente: OUTRO }))
    await esperar()
    expect(m.av().canal).toBe('conectado')
    expect(m.av().falhaAoCarregar).toBe(true)
    expect(m.av().podeComandar).toBe(false)
    let resposta: string | null = null
    await act(async () => {
      resposta = await m.av().enviar({ acao: 'clipe' })
    })
    expect(resposta).toBe('falhou')
    expect(m.canal.enviados(controle())).toEqual([])
    expect(m.canal.enviados(controle(EP2))).toEqual([])
  })

  test('estudio-de-fora (painel, Tarefas 8 e 9)', async () => {
    const m = montarSonda({ estudioDeFora: true })
    await esperar()
    expect(m.av().canal).toBe('conectado')
    expect(m.av().estudio).not.toBeNull()
    // uma presença só em `estudio` (a do painel), e o aviso do `estudio` de fora chega ao hook
    expect(m.canal.presencas('estudio')).toEqual([{ tipo: 'membro', papel: 'equipe' }])
    m.definirAtivo({ id: EP2, modo: 'ao_vivo' })
    act(() => m.canal.entregar('estudio', 'episodio_ativo_mudou', { remetente: OUTRO }))
    await esperar()
    expect(m.av().episodio?.id).toBe(EP2)
    // a perda do `estudio` de fora é tratada por quem o abriu: um reavaliar() só, o do painel
    act(() => m.canal.definirEstado('estudio', 'fechado'))
    await esperar()
    expect(m.reavaliarDoPainel).toHaveBeenCalledTimes(1)
    expect(m.reavaliar).not.toHaveBeenCalled()
    expect(m.av().canal).toBe('fechado')
    await esperar(REABRIR_CANAIS_MS)
    expect(m.av().canal).toBe('conectado')
    expect(m.criados('estudio')).toBe(2)
  })

  test('leitura-sempre-negada-reavalia-com-limite', async () => {
    const m = montar({ antes: (s) => s.episodioAtivo.mockRejectedValue(new ErroDoAoVivo('negado')) })
    await esperar()
    expect(m.episodioAtivo).toHaveBeenCalledTimes(1)
    expect(m.reavaliar).toHaveBeenCalledTimes(1)
    // espera crescente: 5 s, 10 s, 20 s, 40 s e o teto de 60 s
    const esperas = [5000, 10_000, 20_000, 40_000, ESPERA_MAXIMA_DA_CONSULTA_MS, ESPERA_MAXIMA_DA_CONSULTA_MS]
    for (const [i, ms] of esperas.entries()) {
      await esperar(ms - 1)
      expect(m.episodioAtivo, `antes da tentativa ${i + 2}`).toHaveBeenCalledTimes(i + 1)
      await esperar(1)
      expect(m.episodioAtivo, `tentativa ${i + 2}`).toHaveBeenCalledTimes(i + 2)
    }
    // no máximo 3 reavaliações seguidas; a frase de falha fica
    expect(m.reavaliar).toHaveBeenCalledTimes(REAVALIACOES_DA_LEITURA)
    expect(REAVALIACOES_DA_LEITURA).toBe(3)
    expect(screen.getByText(TEXTO_DO_CONTROLE.falhaAoCarregar)).toBeTruthy()
    // um sucesso zera: a próxima negada volta a reavaliar
    m.episodioAtivo.mockReset()
    m.episodioAtivo.mockResolvedValueOnce({ id: EP, modo: 'teste' })
    m.episodioAtivo.mockRejectedValue(new ErroDoAoVivo('negado'))
    await esperar(ESPERA_MAXIMA_DA_CONSULTA_MS)
    expect(screen.queryByText(TEXTO_DO_CONTROLE.falhaAoCarregar)).toBeNull()
    m.voltar()
    await esperar()
    expect(m.reavaliar).toHaveBeenCalledTimes(REAVALIACOES_DA_LEITURA + 1)
  })
})
