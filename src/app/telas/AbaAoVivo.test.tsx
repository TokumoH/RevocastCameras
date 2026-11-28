// @vitest-environment jsdom
import { afterEach, beforeEach, describe, test, expect, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { Dispositivo, TipoDeDispositivo } from '../../domains/acesso/dispositivos'
import type { Papel } from '../../domains/acesso/papeis'
import type { SituacaoDoObs } from '../../domains/aovivo/mensagens'
import { ErroDoAoVivo } from '../../domains/aovivo/portas'
import type { FabricaDeCanais, RepositorioDoAoVivo } from '../../domains/aovivo/portas'
import type { Cena } from '../../domains/preparacao/cenas'
import type { Episodio } from '../../domains/preparacao/episodios'
import type { Som } from '../../domains/preparacao/midia'
import type { ServicosDePreparacao } from '../../domains/preparacao/portas'
import { matrizDoQr } from '../../shared/infra/qr'
import { CodigoQr } from '../../shared/ui/CodigoQr'
import { App } from '../App'
import type { ServicosDeAoVivo } from '../servicos'
import { aoVivoVazio, criarCanalFalso, criarFalsos, criarFalsosDePreparacao, preparacaoVazia, usuarioGoogle } from '../servicosFalsos'
import { REABRIR_CANAIS_MS } from '../canais'
import { useEstudio } from '../useEstudio'
import { AbaAoVivo, INTERVALO_DA_CONSULTA_MS, TEXTO_DA_ABA_AO_VIVO, TEXTO_DO_CHECKLIST, TEXTO_DO_EPISODIO } from './AbaAoVivo'

/*
 * Aba Ao vivo, parte 1 (PLA-004, Tarefa 8; D3, D5, D11): dispositivos, pareamento com QR e revogação.
 * O `estudio` é o adaptador **real** sobre o Realtime falso (`criarCanalFalso`), como o painel o abre.
 * Relógio falso para `setTimeout`, `setInterval` e `Date` (a contagem e a consulta de 3 s).
 */

const EU = 'a1b2c3d4-0000-4000-8000-000000000001'
const SESSAO_ANTIGA = 'b0000000-0000-4000-8000-000000000001'
const SESSAO_NOVA = 'b0000000-0000-4000-8000-000000000002'
const SESSAO_PALCO = 'b0000000-0000-4000-8000-000000000003'
const CAMERA = 'd0000000-0000-4000-8000-000000000001'
const PALCO = 'd0000000-0000-4000-8000-000000000002'
const NOVO = 'd0000000-0000-4000-8000-0000000000ff'
const CODIGO = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ' // 43 caracteres base64url, como o do banco
const ORIGEM = 'https://app.revocast.test'
const PAREADO_EM = '2026-11-27T10:00:00.000Z'

const dispositivo = (o: Partial<Dispositivo> & { id: string; tipo: TipoDeDispositivo; rotulo: string }): Dispositivo => ({
  cameraId: null,
  usuarioAnonimoId: null,
  pareadoEm: null,
  revogadoEm: null,
  ...o,
})

const CAMERA_PAREADA = dispositivo({ id: CAMERA, tipo: 'camera', rotulo: 'Celular de gravação', usuarioAnonimoId: SESSAO_ANTIGA, pareadoEm: PAREADO_EM })
const PALCO_PAREADO = dispositivo({ id: PALCO, tipo: 'obs_palco', rotulo: 'PC do estúdio', usuarioAnonimoId: SESSAO_PALCO, pareadoEm: PAREADO_EM })

/** Esvazia as promessas pendentes e anda `ms` no relógio falso (dentro do `act`). */
async function esperar(ms = 0) {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
    if (ms > 0) await vi.advanceTimersByTimeAsync(ms)
    for (let i = 0; i < 40; i++) await Promise.resolve()
  })
}

/** Repositório do ao vivo com a lista de dispositivos em memória e o que muda a tela (código, pareamento, revogação). */
function repoDeTeste(inicial: Dispositivo[]) {
  let lista = inicial.map((d) => ({ ...d }))
  const listarDispositivos = vi.fn(async () => lista.map((d) => ({ ...d })))
  const criarCodigo = vi.fn(async (p: Parameters<RepositorioDoAoVivo['criarCodigo']>[0]) => {
    const id = p.dispositivoId ?? NOVO
    if (p.dispositivoId === null) lista.push(dispositivo({ id, tipo: p.tipo, rotulo: p.rotulo, cameraId: p.cameraId }))
    return { dispositivoId: id, codigo: CODIGO, expiraEm: new Date(Date.now() + 120_000).toISOString() }
  })
  const revogar = vi.fn(async (id: string) => {
    const d = lista.find((x) => x.id === id)
    if (d === undefined) return { usuario: null }
    d.revogadoEm = new Date().toISOString()
    return { usuario: d.usuarioAnonimoId }
  })
  const repo: RepositorioDoAoVivo = { ...aoVivoVazio().repo, listarDispositivos, criarCodigo, revogar }
  return {
    repo,
    listarDispositivos,
    criarCodigo,
    revogar,
    /** O aparelho leu o QR e pareou: a linha passa a ter a sessão nova (o `parear_dispositivo` do banco). */
    parear(id: string, usuario: string) {
      lista = lista.map((d) => (d.id === id ? { ...d, usuarioAnonimoId: usuario, pareadoEm: new Date().toISOString(), revogadoEm: null } : d))
    },
    /** Muda a linha no banco por fora da aba (outro painel, por exemplo). */
    alterar(id: string, mudanca: Partial<Dispositivo>) {
      lista = lista.map((d) => (d.id === id ? { ...d, ...mudanca } : d))
    },
  }
}

const USUARIO = usuarioGoogle('equipe@revocast.test', EU)
const SEM_VOLTA = () => () => {}

type PropsDaAba = ComponentProps<typeof AbaAoVivo>

/**
 * A aba como o painel a desenha (Tarefa 9): o `estudio` aberto **fora** dela pelo `useEstudio` (presença de
 * membro, reabertura) e passado com o estado; `semCanal` → nenhum `estudio`.
 */
function AbaComEstudio(p: Omit<PropsDaAba, 'estudio' | 'estadoDoEstudio'> & { semCanal?: boolean }) {
  const { semCanal, ...resto } = p
  const { estudio, estado } = useEstudio({ canais: semCanal ? null : p.canais, papel: p.papel, reavaliar: p.reavaliar })
  return <AbaAoVivo {...resto} estudio={estudio} estadoDoEstudio={estado} />
}

/** Props da aba que a parte 1 (dispositivos) não usa: ao vivo sem episódio, Preparação vazia. */
function propsDoAoVivo(canais: FabricaDeCanais, o: { preparacao?: ServicosDePreparacao; papel?: Papel } = {}) {
  return { canais, preparacao: o.preparacao ?? preparacaoVazia(), usuario: USUARIO, papel: o.papel ?? ('equipe' as Papel), aoVoltarAVer: SEM_VOLTA }
}

function montar(o: { dispositivos?: Dispositivo[]; copiar?: ((t: string) => Promise<void>) | null; semCanal?: boolean } = {}) {
  const r = repoDeTeste(o.dispositivos ?? [])
  const canal = criarCanalFalso()
  const reavaliar = vi.fn()
  const tela = render(
    <AbaComEstudio repo={r.repo} {...propsDoAoVivo(canal.canais(EU))} semCanal={o.semCanal} origem={ORIGEM} reavaliar={reavaliar} copiar={o.copiar ?? null} />,
  )
  const enviados = () => canal.enviados('estudio').map((e) => ({ evento: e.event, ...(e.payload as Record<string, unknown>) }))
  return { ...r, canal, reavaliar, tela, enviados }
}

const botao = (nome: string) => screen.getByRole('button', { name: nome }) as HTMLButtonElement
const qr = () => screen.queryByRole('img', { name: 'QR para parear a câmera' })

/** O código aparece em algum lugar da página (texto, marcação ou valor de campo)? */
function codigoNaTela(): boolean {
  const valores = Array.from(document.querySelectorAll('input, textarea'), (c) => (c as HTMLInputElement).value)
  return [document.body.textContent ?? '', document.body.innerHTML, ...valores].some((t) => t.includes(CODIGO))
}

/** O `d` do caminho que o `CodigoQr` desenha para `texto` (para provar o que o QR da tela codifica). */
function caminhoDoQr(texto: string): string | null {
  const { container, unmount } = render(<CodigoQr matriz={matrizDoQr(texto)} rotulo="referência" />)
  const d = container.querySelector('path')?.getAttribute('d') ?? null
  unmount()
  return d
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(new Date('2026-11-27T12:00:00.000Z'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('QR no SVG (D11)', () => {
  test('codigo-qr-svg', () => {
    const matriz = [
      [true, false, true],
      [false, true, false],
      [true, true, true],
    ]
    const rotulo = '<img src=x onerror=alert(1)>'
    const { container } = render(<CodigoQr matriz={matriz} rotulo={rotulo} />)
    const svg = screen.getByRole('img', { name: rotulo })
    expect(svg.tagName.toLowerCase()).toBe('svg')
    expect(container.querySelector('img[src="x"]')).toBeNull()
    // margem (zona quieta) de 4 módulos de cada lado
    expect(svg.getAttribute('viewBox')).toBe('0 0 11 11')
    const caminhos = svg.querySelectorAll('path')
    expect(caminhos).toHaveLength(1)
    // só comandos de desenho e números: nada vindo de texto vira marcação
    expect(caminhos[0].getAttribute('d')).toMatch(/^[Mhvz0-9 -]+$/)
    expect(caminhos[0].getAttribute('d')).toBe('M4 4h1v1h-1zM6 4h1v1h-1zM5 5h1v1h-1zM4 6h3v1h-3z')
    expect(svg.children).toHaveLength(1)
    cleanup()
    render(<CodigoQr matriz={matriz} rotulo="QR para parear a câmera" />)
    expect(screen.getByRole('img', { name: 'QR para parear a câmera' })).toBeTruthy()
    // @ts-expect-error o componente não aceita texto (nem SVG pronto): só a matriz de módulos
    void (() => <CodigoQr matriz="<svg onload=alert(1)>" rotulo="x" />)
  })
})

describe('aba Ao vivo — dispositivos (Tarefa 8)', () => {
  test('lista-dispositivos', async () => {
    const html = '<b>PC</b><img src=x onerror=alert(1)>'
    const m = montar({
      dispositivos: [
        CAMERA_PAREADA,
        dispositivo({ id: PALCO, tipo: 'obs_palco', rotulo: html, usuarioAnonimoId: SESSAO_PALCO, pareadoEm: PAREADO_EM, revogadoEm: PAREADO_EM }),
        dispositivo({ id: NOVO, tipo: 'obs_camera', rotulo: 'Câmera do OBS', cameraId: CAMERA }),
      ],
    })
    await esperar()
    // a câmera está na presença de `estudio` com a sessão atual dela
    act(() => m.canal.sincronizarPresenca('estudio', { [SESSAO_ANTIGA]: [{ tipo: 'camera', dispositivoId: CAMERA, obs: null }] }))
    await esperar()
    const tabela = screen.getByRole('table', { name: 'Dispositivos' })
    const linhas = within(tabela).getAllByRole('row').slice(1)
    expect(linhas).toHaveLength(3)
    const celulas = linhas.map((l) => within(l).getAllByRole('cell').slice(0, 3).map((c) => c.textContent))
    expect(celulas).toEqual([
      ['Câmera', 'Celular de gravação', 'Conectado'],
      ['Palco (OBS)', html, 'Revogado'],
      ['Câmera (OBS)', 'Câmera do OBS', 'Nunca pareado'],
    ])
    expect(m.tela.container.querySelector('img[src="x"]')).toBeNull()
    expect(m.tela.container.querySelector('b')).toBeNull()
    // revogar só para quem já pareou e não está revogado
    expect(within(linhas[0]).getByRole('button', { name: 'Revogar' })).toBeTruthy()
    expect(within(linhas[1]).queryByRole('button', { name: 'Revogar' })).toBeNull()
    expect(within(linhas[2]).queryByRole('button', { name: 'Revogar' })).toBeNull()
    // presença de outra sessão com o mesmo dispositivo (a antiga, antes do corte) não conta como conectado
    act(() => m.canal.sincronizarPresenca('estudio', { [SESSAO_NOVA]: [{ tipo: 'camera', dispositivoId: CAMERA, obs: null }] }))
    await esperar()
    expect(within(screen.getAllByRole('row')[1]).getAllByRole('cell')[2].textContent).toBe('Desconectado')
  })

  test('parear-camera-reusa', async () => {
    const m = montar({ dispositivos: [CAMERA_PAREADA] })
    await esperar()
    fireEvent.click(botao('Parear câmera'))
    await esperar()
    expect(m.criarCodigo).toHaveBeenCalledTimes(1)
    expect(m.criarCodigo.mock.calls[0][0]).toEqual({ tipo: 'camera', rotulo: 'Celular de gravação', dispositivoId: CAMERA, cameraId: null })
    const svg = qr()
    expect(svg).toBeTruthy()
    // o QR da tela codifica exatamente o link da câmera
    const link = `${ORIGEM}/camera#${CODIGO}`
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe(caminhoDoQr(link))
    expect((screen.getByLabelText('Link da câmera') as HTMLInputElement).value).toBe(link)
    // o código não vai para o armazenamento do navegador nem para a URL da página
    expect(JSON.stringify({ ...localStorage })).not.toContain(CODIGO)
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(CODIGO)
    expect(window.location.href).not.toContain(CODIGO)
  })

  test('parear-camera-nova', async () => {
    const m = montar({ dispositivos: [PALCO_PAREADO] })
    await esperar()
    fireEvent.click(botao('Parear câmera'))
    await esperar()
    expect(m.criarCodigo.mock.calls[0][0]).toEqual({ tipo: 'camera', rotulo: 'Celular de gravação', dispositivoId: null, cameraId: null })
    expect(qr()).toBeTruthy()
    // a câmera nova aparece na lista como nunca pareada
    const linha = screen.getByRole('cell', { name: 'Nunca pareado' }).closest('tr') as HTMLElement
    expect(within(linha).getAllByRole('cell')[0].textContent).toBe('Câmera')
  })

  test('link-do-palco', async () => {
    const copiar = vi.fn(async () => {})
    const m = montar({ dispositivos: [PALCO_PAREADO], copiar })
    await esperar()
    fireEvent.click(botao('Link do palco (OBS)'))
    await esperar()
    expect(m.criarCodigo.mock.calls[0][0]).toEqual({ tipo: 'obs_palco', rotulo: 'PC do estúdio', dispositivoId: PALCO, cameraId: null })
    const campo = screen.getByLabelText('Link do palco (OBS)') as HTMLInputElement
    expect(campo.value).toBe(`${ORIGEM}/obs/palco#${CODIGO}`)
    expect(campo.readOnly).toBe(true)
    expect(campo.disabled).toBe(false)
    expect(qr()).toBeNull() // o link do OBS é colado na Fonte, não lido por câmera
    fireEvent.click(botao('Copiar link'))
    await esperar()
    expect(copiar).toHaveBeenCalledWith(`${ORIGEM}/obs/palco#${CODIGO}`)
    expect(screen.getByText(TEXTO_DA_ABA_AO_VIVO.copiado)).toBeTruthy()
    // a cópia falhou (permissão negada): a tela diz para copiar à mão
    copiar.mockRejectedValueOnce(new Error('negado'))
    fireEvent.click(botao('Copiar link'))
    await esperar()
    expect(screen.getByText(TEXTO_DA_ABA_AO_VIVO.naoCopiou)).toBeTruthy()

    // sem palco cadastrado: dispositivo novo com o rótulo padrão
    cleanup()
    const n = montar({ dispositivos: [], copiar: null })
    await esperar()
    fireEvent.click(botao('Link do palco (OBS)'))
    await esperar()
    expect(n.criarCodigo.mock.calls[0][0]).toEqual({ tipo: 'obs_palco', rotulo: 'Palco do OBS', dispositivoId: null, cameraId: null })
    // sem área de transferência: nenhum botão de copiar; o campo continua selecionável (só leitura, não desabilitado)
    expect(screen.queryByRole('button', { name: 'Copiar link' })).toBeNull()
    const semCopia = screen.getByLabelText('Link do palco (OBS)') as HTMLInputElement
    expect(semCopia.readOnly).toBe(true)
    expect(semCopia.disabled).toBe(false)
    expect(semCopia.value).toBe(`${ORIGEM}/obs/palco#${CODIGO}`)
  })

  test('obs-camera-exige-camera', async () => {
    const m = montar({ dispositivos: [PALCO_PAREADO] })
    await esperar()
    const b = botao('Link da câmera do OBS')
    expect(b.disabled).toBe(true)
    expect(screen.getByText('Pareie a câmera antes.')).toBeTruthy()
    expect(b.getAttribute('aria-describedby')).toBe(screen.getByText('Pareie a câmera antes.').id)
    fireEvent.click(b)
    await esperar()
    expect(m.criarCodigo).not.toHaveBeenCalled()

    // com câmera: o link da câmera do OBS cria o `obs_camera` ligado a ela
    cleanup()
    const n = montar({ dispositivos: [CAMERA_PAREADA] })
    await esperar()
    expect(botao('Link da câmera do OBS').disabled).toBe(false)
    expect(screen.queryByText('Pareie a câmera antes.')).toBeNull()
    fireEvent.click(botao('Link da câmera do OBS'))
    await esperar()
    expect(n.criarCodigo.mock.calls[0][0]).toEqual({ tipo: 'obs_camera', rotulo: 'Câmera do OBS', dispositivoId: null, cameraId: CAMERA })
    expect((screen.getByLabelText('Link da câmera do OBS') as HTMLInputElement).value).toBe(`${ORIGEM}/obs/camera#${CODIGO}`)
  })

  test('contagem-regressiva', async () => {
    const m = montar({ dispositivos: [CAMERA_PAREADA] })
    await esperar()
    // a aba ficou aberta um minuto antes do clique: a contagem começa em 2:00 mesmo assim, já na primeira
    // pintura (o observador anota cada texto de validade que entra na página, inclusive os de um quadro só)
    await esperar(60_000)
    // (o React troca só o nó de texto do tempo: o valor antigo de cada troca fica no registro da mutação)
    const vistos = new Set<string>()
    const observador = new MutationObserver((registros) => {
      for (const r of registros) if (r.type === 'characterData' && r.oldValue !== null && /^\d+:\d\d$/.test(r.oldValue)) vistos.add(`Vale por ${r.oldValue}`)
    })
    observador.observe(document.body, { childList: true, subtree: true, characterData: true, characterDataOldValue: true })
    fireEvent.click(botao('Parear câmera'))
    await esperar()
    observador.disconnect()
    for (const t of document.body.textContent?.match(/Vale por \d+:\d\d/g) ?? []) vistos.add(t)
    expect([...vistos]).toEqual(['Vale por 2:00'])
    expect(screen.getByText('Vale por 2:00')).toBeTruthy()
    await esperar(1000)
    expect(screen.getByText('Vale por 1:59')).toBeTruthy()
    await esperar(58_000)
    expect(screen.getByText('Vale por 1:01')).toBeTruthy()
    await esperar(60_000)
    expect(screen.getByText('Vale por 0:01')).toBeTruthy()
    await esperar(999)
    expect(screen.getByText('Vale por 0:01')).toBeTruthy()
    expect(qr()).toBeTruthy()
    await esperar(1)
    expect(screen.getByText('O código expirou.')).toBeTruthy()
    expect(qr()).toBeNull()
    expect(codigoNaTela()).toBe(false)
    // a consulta para quando o código expira
    const consultas = m.listarDispositivos.mock.calls.length
    await esperar(INTERVALO_DA_CONSULTA_MS * 3)
    expect(m.listarDispositivos.mock.calls.length).toBe(consultas)
    // "Gerar outro" pede um código novo do mesmo tipo e do mesmo dispositivo
    fireEvent.click(botao('Gerar outro'))
    await esperar()
    expect(m.criarCodigo).toHaveBeenCalledTimes(2)
    expect(m.criarCodigo.mock.calls[1][0]).toEqual(m.criarCodigo.mock.calls[0][0])
    expect(screen.getByText('Vale por 2:00')).toBeTruthy()
    expect(qr()).toBeTruthy()
  })

  test('detecta-pareamento-e-avisa-sessao-antiga', async () => {
    const m = montar({ dispositivos: [CAMERA_PAREADA] })
    await esperar()
    fireEvent.click(botao('Parear câmera'))
    await esperar()
    const antes = m.listarDispositivos.mock.calls.length
    // consulta a lista a cada 3 s enquanto o código vale; sem troca de sessão, nada muda
    await esperar(INTERVALO_DA_CONSULTA_MS)
    expect(m.listarDispositivos.mock.calls.length).toBe(antes + 1)
    await esperar(INTERVALO_DA_CONSULTA_MS)
    expect(m.listarDispositivos.mock.calls.length).toBe(antes + 2)
    expect(qr()).toBeTruthy()
    expect(m.enviados()).toEqual([])
    // o celular novo pareou: a sessão da câmera mudou da antiga para a nova
    m.parear(CAMERA, SESSAO_NOVA)
    await esperar(INTERVALO_DA_CONSULTA_MS)
    expect(m.enviados()).toEqual([{ evento: 'revogacao', usuario: SESSAO_ANTIGA, remetente: EU }])
    expect(screen.getByText('📷 Câmera conectada')).toBeTruthy()
    expect(qr()).toBeNull()
    expect(codigoNaTela()).toBe(false)
    expect(screen.queryByText(/Vale por/)).toBeNull()
    // uma vez só: a consulta para e nada mais é enviado
    const depois = m.listarDispositivos.mock.calls.length
    await esperar(INTERVALO_DA_CONSULTA_MS * 3)
    expect(m.enviados()).toHaveLength(1)
    expect(m.listarDispositivos.mock.calls.length).toBe(depois)
  })

  test('primeiro-pareamento-nao-avisa', async () => {
    // câmera nova (sem sessão antiga): pareou → "conectada", sem aviso de revogação
    const m = montar({ dispositivos: [] })
    await esperar()
    fireEvent.click(botao('Parear câmera'))
    await esperar()
    m.parear(NOVO, SESSAO_NOVA)
    await esperar(INTERVALO_DA_CONSULTA_MS)
    expect(screen.getByText('📷 Câmera conectada')).toBeTruthy()
    expect(m.enviados()).toEqual([])
  })

  test('pareado-e-revogado-nao-conta-como-pareamento', async () => {
    // a sessão mudou, mas a linha já está revogada (outro painel revogou depois do pareamento): não é pareamento,
    // e nenhum aviso sai; o código continua na tela até expirar
    const m = montar({ dispositivos: [CAMERA_PAREADA] })
    await esperar()
    fireEvent.click(botao('Parear câmera'))
    await esperar()
    m.parear(CAMERA, SESSAO_NOVA)
    m.alterar(CAMERA, { revogadoEm: new Date().toISOString() })
    await esperar(INTERVALO_DA_CONSULTA_MS)
    expect(screen.queryByText('📷 Câmera conectada')).toBeNull()
    expect(m.enviados()).toEqual([])
    expect(qr()).toBeTruthy()
  })

  test('solta-a-presenca-ao-desmontar', async () => {
    // os ouvintes de presença e de mensagens do `estudio` (que é do painel e continua aberto) são soltos quando a
    // aba desmonta: a aba e o `useAoVivo` dela (Tarefa 9) ouvem a mesma alça, e cada inscrição é solta uma vez
    const r = repoDeTeste([CAMERA_PAREADA])
    const canal = criarCanalFalso()
    const estudio = canal.canais(EU).estudio()
    const inscritos = { presenca: 0, mensagens: 0 }
    const soltos = { presenca: 0, mensagens: 0 }
    const presenca = estudio.aoMudarPresenca.bind(estudio)
    estudio.aoMudarPresenca = (f) => {
      inscritos.presenca++
      const desfazer = presenca(f)
      return () => {
        soltos.presenca++
        desfazer()
      }
    }
    const mensagens = estudio.aoReceber.bind(estudio)
    estudio.aoReceber = (f) => {
      inscritos.mensagens++
      const desfazer = mensagens(f)
      return () => {
        soltos.mensagens++
        desfazer()
      }
    }
    const tela = render(
      <AbaAoVivo repo={r.repo} estudio={estudio} estadoDoEstudio="conectado" {...propsDoAoVivo(canal.canais(EU))} origem={ORIGEM} reavaliar={vi.fn()} copiar={null} />,
    )
    await esperar()
    expect(inscritos.presenca).toBeGreaterThan(0)
    expect(inscritos.mensagens).toBeGreaterThan(0)
    expect(soltos).toEqual({ presenca: 0, mensagens: 0 })
    tela.unmount()
    expect(soltos).toEqual(inscritos)
  })

  test('aviso-da-sessao-antiga-sem-canal', async () => {
    const m = montar({ dispositivos: [CAMERA_PAREADA] })
    await esperar()
    fireEvent.click(botao('Parear câmera'))
    await esperar()
    m.canal.definirEstado('estudio', 'reconectando')
    m.parear(CAMERA, SESSAO_NOVA)
    await esperar(INTERVALO_DA_CONSULTA_MS)
    expect(screen.getByText('📷 Câmera conectada')).toBeTruthy()
    expect(screen.getByText(TEXTO_DA_ABA_AO_VIVO.pareadoSemAviso)).toBeTruthy()
    expect(TEXTO_DA_ABA_AO_VIVO.pareadoSemAviso).toContain('em até 10 minutos')
  })

  test('revogar-avisa', async () => {
    const m = montar({ dispositivos: [CAMERA_PAREADA] })
    await esperar()
    const linha = screen.getAllByRole('row')[1]
    fireEvent.click(within(linha).getByRole('button', { name: 'Revogar' }))
    // pede confirmação antes; cancelar não revoga
    fireEvent.click(within(linha).getByRole('button', { name: 'Cancelar' }))
    expect(m.revogar).not.toHaveBeenCalled()
    fireEvent.click(within(linha).getByRole('button', { name: 'Revogar' }))
    fireEvent.click(within(linha).getByRole('button', { name: 'Confirmar revogação' }))
    await esperar()
    expect(m.revogar).toHaveBeenCalledWith(CAMERA)
    expect(m.enviados()).toEqual([
      { evento: 'revogacao', usuario: SESSAO_ANTIGA, remetente: EU },
      { evento: 'dispositivo_mudou', dispositivoId: CAMERA, remetente: EU },
    ])
    expect(screen.getByText(TEXTO_DA_ABA_AO_VIVO.revogado)).toBeTruthy()
    expect(within(screen.getAllByRole('row')[1]).getAllByRole('cell')[2].textContent).toBe('Revogado')
  })

  test('revogar-sem-canal-avisa', async () => {
    const m = montar({ dispositivos: [CAMERA_PAREADA] })
    await esperar()
    m.canal.definirEstado('estudio', 'reconectando')
    await esperar()
    const linha = screen.getAllByRole('row')[1]
    fireEvent.click(within(linha).getByRole('button', { name: 'Revogar' }))
    fireEvent.click(within(linha).getByRole('button', { name: 'Confirmar revogação' }))
    await esperar()
    expect(m.revogar).toHaveBeenCalledWith(CAMERA)
    expect(screen.getByText('Revogado no banco. O aviso pelo canal não saiu; o corte do canal vem em até 10 minutos.')).toBeTruthy()
    // sem `estudio` nenhum (painel sem canal): a mesma frase
    cleanup()
    const n = montar({ dispositivos: [CAMERA_PAREADA], semCanal: true })
    await esperar()
    fireEvent.click(within(screen.getAllByRole('row')[1]).getByRole('button', { name: 'Revogar' }))
    fireEvent.click(within(screen.getAllByRole('row')[1]).getByRole('button', { name: 'Confirmar revogação' }))
    await esperar()
    expect(n.revogar).toHaveBeenCalledWith(CAMERA)
    expect(screen.getByText(TEXTO_DA_ABA_AO_VIVO.revogadoSemCanal)).toBeTruthy()
  })

  test('revogar-apaga-o-codigo-na-tela', async () => {
    // o banco apaga os códigos pendentes do dispositivo revogado: o QR dele sai da tela
    const m = montar({ dispositivos: [CAMERA_PAREADA] })
    await esperar()
    fireEvent.click(botao('Parear câmera'))
    await esperar()
    expect(qr()).toBeTruthy()
    const linha = screen.getAllByRole('row')[1]
    fireEvent.click(within(linha).getByRole('button', { name: 'Revogar' }))
    fireEvent.click(within(linha).getByRole('button', { name: 'Confirmar revogação' }))
    await esperar()
    expect(m.revogar).toHaveBeenCalledWith(CAMERA)
    expect(qr()).toBeNull()
  })

  test('falha-ao-carregar-e-acesso-negado', async () => {
    const r = repoDeTeste([CAMERA_PAREADA])
    r.listarDispositivos.mockRejectedValueOnce(new ErroDoAoVivo('negado'))
    const reavaliar = vi.fn()
    render(
      <AbaAoVivo repo={r.repo} estudio={null} estadoDoEstudio="conectando" {...propsDoAoVivo(criarCanalFalso().canais(EU))} origem={ORIGEM} reavaliar={reavaliar} copiar={null} />,
    )
    await esperar()
    expect(screen.getByText(TEXTO_DA_ABA_AO_VIVO.naoCarregou)).toBeTruthy()
    expect(reavaliar).toHaveBeenCalledTimes(1)
    fireEvent.click(botao('Tentar de novo'))
    await esperar()
    expect(screen.getByRole('table', { name: 'Dispositivos' })).toBeTruthy()
    // falha ao gerar o código: frase fixa, sem QR
    r.criarCodigo.mockRejectedValueOnce(new ErroDoAoVivo('rede'))
    fireEvent.click(botao('Parear câmera'))
    await esperar()
    expect(screen.getByText(TEXTO_DA_ABA_AO_VIVO.naoGerou)).toBeTruthy()
    expect(qr()).toBeNull()
  })

  test('codigo-some-ao-sair-da-aba', async () => {
    const r = repoDeTeste([CAMERA_PAREADA])
    const canal = criarCanalFalso()
    const aoVivo: ServicosDeAoVivo = { repo: r.repo, canais: canal.canais }
    const f = criarFalsos({
      usuario: usuarioGoogle('adm@revocast.test', EU),
      papel: 'equipe',
      permitidos: [{ email: 'adm@revocast.test', papel: 'equipe', criadoPor: null }],
    })
    render(<App caminho="/painel" dependencias={f.dependencias({ obterAoVivo: () => aoVivo, origem: ORIGEM })} />)
    await esperar()
    fireEvent.click(screen.getByRole('tab', { name: 'Ao vivo' }))
    await esperar()
    fireEvent.click(botao('Parear câmera'))
    await esperar()
    expect(qr()).toBeTruthy()
    expect(codigoNaTela()).toBe(true)
    // trocar de aba e voltar: nenhum código nem QR na tela
    fireEvent.click(screen.getByRole('tab', { name: 'Episódios' }))
    await esperar()
    fireEvent.click(screen.getByRole('tab', { name: 'Ao vivo' }))
    await esperar()
    expect(screen.getByRole('table', { name: 'Dispositivos' })).toBeTruthy()
    expect(qr()).toBeNull()
    expect(codigoNaTela()).toBe(false)
    // e a consulta de 3 s do código esquecido não continua
    const consultas = r.listarDispositivos.mock.calls.length
    await esperar(INTERVALO_DA_CONSULTA_MS * 2)
    expect(r.listarDispositivos.mock.calls.length).toBe(consultas)
  })
})

/* ---------------------------------------------------------------------------------------------- */
/* Parte 2 (PLA-004, Tarefa 9; D7, D12, D13): episódio (modo teste, iniciar, encerrar), checklist e comandos. */

const EP_A = 'e0000000-0000-4000-8000-00000000000a'
const EP_B = 'e0000000-0000-4000-8000-00000000000b'
const EP_C = 'e0000000-0000-4000-8000-00000000000c'
const EP_D = 'e0000000-0000-4000-8000-00000000000d'
const CENA = 'c0000000-0000-4000-8000-00000000000a'
const SOM = '50000000-0000-4000-8000-000000000001'

const EPISODIOS: Episodio[] = [
  { id: EP_A, titulo: 'Ensaio geral', data: '2026-11-27', estado: 'rascunho' },
  { id: EP_B, titulo: '<b>Programa</b> de sexta', data: '2026-11-28', estado: 'rascunho' },
  { id: EP_C, titulo: 'Programa antigo', data: '2026-11-20', estado: 'encerrado' },
]
const CENAS: Cena[] = [{ id: CENA, nomeExibicao: 'Geral', nomeObs: 'Cena Geral', ordem: 0 }]
const SONS: Som[] = [{ id: SOM, midiaId: '60000000-0000-4000-8000-000000000001', rotulo: 'aplauso', emoji: '👏', volume: 1, ordem: 0 }]

/**
 * O banco do ao vivo em memória, com as regras das funções da D7: `iniciar_ao_vivo` (rascunho → ao vivo;
 * outro ao vivo → `duplicado`; fora de rascunho → `estado_invalido`; limpa o teste), `encerrar_ao_vivo`
 * (ao vivo → encerrado; limpa o teste) e `definir_modo_teste` (só rascunho; com ao vivo → `estado_invalido`).
 * A Preparação lê os mesmos episódios.
 */
function bancoDeTeste(o: { episodios?: Episodio[]; teste?: string | null; dispositivos?: Dispositivo[] } = {}) {
  let episodios = (o.episodios ?? EPISODIOS).map((e) => ({ ...e }))
  let teste: string | null = o.teste ?? null
  const ativo = (): { id: string; modo: 'ao_vivo' | 'teste' } | null => {
    const noAr = episodios.find((e) => e.estado === 'ao_vivo')
    if (noAr) return { id: noAr.id, modo: 'ao_vivo' }
    return teste === null ? null : { id: teste, modo: 'teste' }
  }
  const estadoDe = (id: string) => episodios.find((e) => e.id === id)?.estado
  const mudar = (id: string, estado: Episodio['estado']) => {
    episodios = episodios.map((e) => (e.id === id ? { ...e, estado } : e))
  }
  const episodioAtivo = vi.fn(async () => ativo())
  const definirModoTeste = vi.fn(async (id: string | null) => {
    if (episodios.some((e) => e.estado === 'ao_vivo')) throw new ErroDoAoVivo('estado_invalido')
    if (id !== null && estadoDe(id) !== 'rascunho') throw new ErroDoAoVivo('estado_invalido')
    teste = id
  })
  const iniciar = vi.fn(async (id: string) => {
    if (episodios.some((e) => e.estado === 'ao_vivo')) throw new ErroDoAoVivo('duplicado')
    if (estadoDe(id) !== 'rascunho') throw new ErroDoAoVivo('estado_invalido')
    mudar(id, 'ao_vivo')
    teste = null
  })
  const encerrar = vi.fn(async (id: string) => {
    if (estadoDe(id) !== 'ao_vivo') throw new ErroDoAoVivo('estado_invalido')
    mudar(id, 'encerrado')
    teste = null
  })
  const dispositivos = repoDeTeste(o.dispositivos ?? [])
  const repo: RepositorioDoAoVivo = { ...dispositivos.repo, episodioAtivo, definirModoTeste, iniciar, encerrar }
  const prep = criarFalsosDePreparacao({ episodios, cenas: CENAS, sons: SONS })
  const listarEpisodios = vi.fn(async () => episodios.map((e) => ({ ...e })))
  const preparacao: ServicosDePreparacao = { ...prep.servicos, episodios: { ...prep.servicos.episodios, listar: listarEpisodios } }
  return {
    repo,
    preparacao,
    episodioAtivo,
    definirModoTeste,
    iniciar,
    encerrar,
    listarEpisodios,
    dispositivos,
    /** Muda o banco por fora da aba (outro painel). */
    alterar(id: string, estado: Episodio['estado']) {
      mudar(id, estado)
    },
    definirTeste(id: string | null) {
      teste = id
    },
  }
}

function montarEpisodio(o: { episodios?: Episodio[]; teste?: string | null; dispositivos?: Dispositivo[]; semCanal?: boolean } = {}) {
  const b = bancoDeTeste(o)
  const canal = criarCanalFalso()
  const reavaliar = vi.fn()
  const tela = render(
    <AbaComEstudio
      repo={b.repo}
      {...propsDoAoVivo(canal.canais(EU), { preparacao: b.preparacao })}
      semCanal={o.semCanal}
      origem={ORIGEM}
      reavaliar={reavaliar}
      copiar={null}
    />,
  )
  const avisos = () => canal.enviados('estudio').filter((e) => e.event === 'episodio_ativo_mudou').length
  return { ...b, canal, reavaliar, tela, avisos }
}

const secao = (nome: string) => screen.getByRole('region', { name: nome })
const seletor = () => within(secao('Episódio')).getByLabelText(TEXTO_DO_EPISODIO.escolha) as HTMLSelectElement
const opcoes = () => Array.from(seletor().options, (op) => op.textContent)

describe('aba Ao vivo — episódio (Tarefa 9; D7, D12)', () => {
  test('modo-teste-so-rascunho', async () => {
    const m = montarEpisodio({ episodios: [...EPISODIOS, { id: EP_D, titulo: 'No ar agora', data: '2026-11-26', estado: 'encerrado' }] })
    await esperar()
    // só rascunhos (o encerrado e qualquer outro estado ficam fora), mais recente primeiro, título como texto
    expect(opcoes()).toEqual(['<b>Programa</b> de sexta · 28/11/2026', 'Ensaio geral · 27/11/2026'])
    expect(secao('Episódio').querySelector('b')).toBeNull()
    expect(screen.getByText(TEXTO_DO_EPISODIO.nenhum)).toBeTruthy()
    expect(m.definirModoTeste).not.toHaveBeenCalled()
    // sem rascunho nenhum: nada para escolher
    cleanup()
    montarEpisodio({ episodios: [EPISODIOS[2]] })
    await esperar()
    expect(within(secao('Episódio')).queryByLabelText(TEXTO_DO_EPISODIO.escolha)).toBeNull()
    expect(screen.getByText(TEXTO_DO_EPISODIO.semRascunho)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Usar no modo teste' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Iniciar o ao vivo' })).toBeNull()
  })

  test('define-modo-teste-e-avisa', async () => {
    const m = montarEpisodio()
    await esperar()
    // a função do banco demora: enquanto ela não responde, nenhum aviso sai e os botões ficam ocupados
    let responder: () => void = () => {}
    const original = m.definirModoTeste.getMockImplementation() as (id: string | null) => Promise<void>
    m.definirModoTeste.mockImplementationOnce((id) => new Promise<void>((ok) => (responder = () => void original(id).then(ok))))
    fireEvent.change(seletor(), { target: { value: EP_A } })
    fireEvent.click(botao('Usar no modo teste'))
    await esperar()
    expect(m.definirModoTeste).toHaveBeenCalledWith(EP_A)
    expect(m.avisos()).toBe(0)
    expect(botao('Usar no modo teste').disabled).toBe(true)
    responder()
    await esperar()
    // o aviso sai depois da função do banco, com o remetente
    expect(m.canal.enviados('estudio').filter((e) => e.event === 'episodio_ativo_mudou')).toEqual([{ event: 'episodio_ativo_mudou', payload: { remetente: EU } }])
    expect(screen.getByText(TEXTO_DO_EPISODIO.testeLigado)).toBeTruthy()
    // o estado atual vem do `episodio_ativo()` consultado de novo
    expect(within(secao('Episódio')).getByText('Ensaio geral')).toBeTruthy()
    expect(within(secao('Episódio')).getByText(TEXTO_DO_EPISODIO.modoTeste)).toBeTruthy()
    // com o canal fora: feito no banco, e a tela diz que o aviso não saiu
    m.canal.definirEstado('estudio', 'reconectando')
    await esperar()
    fireEvent.change(seletor(), { target: { value: EP_B } })
    fireEvent.click(botao('Usar no modo teste'))
    await esperar()
    expect(m.definirModoTeste).toHaveBeenLastCalledWith(EP_B)
    expect(screen.getByText(TEXTO_DO_EPISODIO.semAviso)).toBeTruthy()
    expect(m.avisos()).toBe(1)
  })

  test('sair-do-modo-teste', async () => {
    const m = montarEpisodio({ teste: EP_A })
    await esperar()
    expect(within(secao('Episódio')).getByText('Ensaio geral')).toBeTruthy()
    // o seletor começa no episódio em teste
    expect(seletor().value).toBe(EP_A)
    fireEvent.click(botao('Sair do modo teste'))
    await esperar()
    expect(m.definirModoTeste).toHaveBeenCalledWith(null)
    expect(m.avisos()).toBe(1)
    expect(screen.getByText(TEXTO_DO_EPISODIO.testeDesligado)).toBeTruthy()
    expect(screen.getByText(TEXTO_DO_EPISODIO.nenhum)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sair do modo teste' })).toBeNull()
  })

  test('iniciar-confirma', async () => {
    const m = montarEpisodio({ teste: EP_A })
    await esperar()
    fireEvent.change(seletor(), { target: { value: EP_B } })
    fireEvent.click(botao('Iniciar o ao vivo'))
    // sem confirmar, nada: a confirmação cita o título (como texto)
    expect(m.iniciar).not.toHaveBeenCalled()
    expect(screen.getByText('Iniciar o ao vivo de “<b>Programa</b> de sexta”?')).toBeTruthy()
    fireEvent.click(botao('Cancelar'))
    await esperar()
    expect(m.iniciar).not.toHaveBeenCalled()
    expect(m.avisos()).toBe(0)
    expect(screen.queryByRole('button', { name: 'Confirmar início' })).toBeNull()
    // confirmado → iniciar(id) e depois o aviso
    fireEvent.click(botao('Iniciar o ao vivo'))
    fireEvent.click(botao('Confirmar início'))
    await esperar()
    expect(m.iniciar).toHaveBeenCalledTimes(1)
    expect(m.iniciar).toHaveBeenCalledWith(EP_B)
    expect(m.avisos()).toBe(1)
    expect(screen.getByText(TEXTO_DO_EPISODIO.iniciado)).toBeTruthy()
    const estado = within(secao('Episódio')).getByText(TEXTO_DO_EPISODIO.aoVivo)
    expect(estado.closest('.episodio-no-ar')).toBeTruthy()
    expect(within(secao('Episódio')).getByText('<b>Programa</b> de sexta')).toBeTruthy()
    expect(secao('Episódio').querySelector('b')).toBeNull()
    // com o ao vivo no ar: só "Encerrar"; nem modo teste nem outro início
    expect(screen.queryByRole('button', { name: 'Iniciar o ao vivo' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Usar no modo teste' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sair do modo teste' })).toBeNull()
    expect(botao('Encerrar o ao vivo')).toBeTruthy()
  })

  test('iniciar-com-outro-ao-vivo', async () => {
    // outro painel iniciou um ao vivo e o aviso ainda não chegou aqui: o banco recusa (`duplicado`)
    const m = montarEpisodio()
    await esperar()
    m.alterar(EP_A, 'ao_vivo')
    fireEvent.change(seletor(), { target: { value: EP_B } })
    fireEvent.click(botao('Iniciar o ao vivo'))
    fireEvent.click(botao('Confirmar início'))
    await esperar()
    expect(m.iniciar).toHaveBeenCalledWith(EP_B)
    expect(screen.getByText('Já existe um episódio ao vivo.')).toBeTruthy()
    expect(m.avisos()).toBe(0)
    // a tela se acerta: consulta de novo e mostra o que está no ar
    expect(within(secao('Episódio')).getByText('Ensaio geral')).toBeTruthy()
    expect(within(secao('Episódio')).getByText(TEXTO_DO_EPISODIO.aoVivo)).toBeTruthy()
    expect(m.reavaliar).not.toHaveBeenCalled()
    // os comandos (do ao vivo de A, que a consulta trouxe) voltam habilitados depois da falha
    expect((within(secao('Comandos')).getByRole('button', { name: '✂️ CLIPE' }) as HTMLButtonElement).disabled).toBe(false)
  })

  test('encerrar-confirma', async () => {
    const m = montarEpisodio({ episodios: [{ ...EPISODIOS[0], estado: 'ao_vivo' }, EPISODIOS[1]] })
    await esperar()
    fireEvent.click(botao('Encerrar o ao vivo'))
    expect(m.encerrar).not.toHaveBeenCalled()
    expect(screen.getByText('Encerrar o ao vivo de “Ensaio geral”?')).toBeTruthy()
    fireEvent.click(botao('Cancelar'))
    await esperar()
    expect(m.encerrar).not.toHaveBeenCalled()
    fireEvent.click(botao('Encerrar o ao vivo'))
    fireEvent.click(botao('Confirmar encerramento'))
    await esperar()
    expect(m.encerrar).toHaveBeenCalledWith(EP_A)
    expect(m.avisos()).toBe(1)
    expect(screen.getByText(TEXTO_DO_EPISODIO.encerrado)).toBeTruthy()
    expect(screen.getByText(TEXTO_DO_EPISODIO.nenhum)).toBeTruthy()
    // o encerrado sai do seletor (só rascunhos)
    expect(opcoes()).toEqual(['<b>Programa</b> de sexta · 28/11/2026'])
  })

  test('estado-invalido-recarrega', async () => {
    // outro painel encerrou o episódio em teste... e o iniciou: a aba ainda mostra o rascunho
    const m = montarEpisodio({ teste: EP_A })
    await esperar()
    const leituras = m.listarEpisodios.mock.calls.length
    const consultas = m.episodioAtivo.mock.calls.length
    m.alterar(EP_A, 'encerrado')
    m.definirTeste(null)
    fireEvent.change(seletor(), { target: { value: EP_A } })
    fireEvent.click(botao('Iniciar o ao vivo'))
    fireEvent.click(botao('Confirmar início'))
    await esperar()
    expect(screen.getByText('O episódio mudou de estado; a lista foi recarregada.')).toBeTruthy()
    expect(m.listarEpisodios.mock.calls.length).toBeGreaterThan(leituras)
    expect(m.episodioAtivo.mock.calls.length).toBeGreaterThan(consultas)
    expect(opcoes()).toEqual(['<b>Programa</b> de sexta · 28/11/2026'])
    expect(screen.getByText(TEXTO_DO_EPISODIO.nenhum)).toBeTruthy()
    expect(m.avisos()).toBe(0)
  })

  test('acao-negada-reavalia', async () => {
    const m = montarEpisodio()
    await esperar()
    m.definirModoTeste.mockRejectedValueOnce(new ErroDoAoVivo('negado'))
    fireEvent.change(seletor(), { target: { value: EP_A } })
    fireEvent.click(botao('Usar no modo teste'))
    await esperar()
    expect(m.reavaliar).toHaveBeenCalledTimes(1)
    expect(screen.getByText(TEXTO_DO_EPISODIO.mudou)).toBeTruthy()
    expect(m.avisos()).toBe(0)
    // sessão vencida: só reavaliar, sem frase; erro de rede: frase fixa, sem reavaliar
    m.iniciar.mockRejectedValueOnce(new ErroDoAoVivo('sessao_expirada'))
    fireEvent.click(botao('Iniciar o ao vivo'))
    fireEvent.click(botao('Confirmar início'))
    await esperar()
    expect(m.reavaliar).toHaveBeenCalledTimes(2)
    m.iniciar.mockRejectedValueOnce(new ErroDoAoVivo('rede'))
    fireEvent.click(botao('Iniciar o ao vivo'))
    fireEvent.click(botao('Confirmar início'))
    await esperar()
    expect(m.reavaliar).toHaveBeenCalledTimes(2)
    expect(screen.getByText(TEXTO_DO_EPISODIO.naoConcluiu)).toBeTruthy()
    expect(m.avisos()).toBe(0)
  })

  test('aviso-de-outro-painel-recarrega', async () => {
    // `episodio_ativo_mudou` de outro painel: o `useAoVivo` consulta de novo e a lista de episódios acompanha
    const m = montarEpisodio()
    await esperar()
    m.alterar(EP_B, 'ao_vivo')
    act(() => m.canal.entregar('estudio', 'episodio_ativo_mudou', { remetente: 'a1b2c3d4-0000-4000-8000-000000000002' }))
    await esperar()
    expect(within(secao('Episódio')).getByText(TEXTO_DO_EPISODIO.aoVivo)).toBeTruthy()
    expect(within(secao('Episódio')).getByText('<b>Programa</b> de sexta')).toBeTruthy()
    expect(botao('Encerrar o ao vivo')).toBeTruthy()
  })

  test('confirmacao-some-se-o-ativo-muda', async () => {
    // a confirmação de "Encerrar" de A fica aberta; outro painel encerra A e inicia B: a confirmação some
    // (confirmar encerraria A, que já não está no ar)
    const m = montarEpisodio({ episodios: [{ ...EPISODIOS[0], estado: 'ao_vivo' }, EPISODIOS[1]] })
    await esperar()
    fireEvent.click(botao('Encerrar o ao vivo'))
    expect(screen.getByText('Encerrar o ao vivo de “Ensaio geral”?')).toBeTruthy()
    m.alterar(EP_A, 'encerrado')
    m.alterar(EP_B, 'ao_vivo')
    act(() => m.canal.entregar('estudio', 'episodio_ativo_mudou', { remetente: 'a1b2c3d4-0000-4000-8000-000000000002' }))
    await esperar()
    expect(within(secao('Episódio')).getByText('<b>Programa</b> de sexta')).toBeTruthy()
    expect(screen.queryByText('Encerrar o ao vivo de “Ensaio geral”?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirmar encerramento' })).toBeNull()
    expect(m.encerrar).not.toHaveBeenCalled()
  })

  test('dispositivo-mudou-recarrega', async () => {
    // VER-042 (Riscos): `dispositivo_mudou` de outro painel recarrega a lista de dispositivos
    const m = montarEpisodio({ dispositivos: [CAMERA_PAREADA] })
    await esperar()
    expect(within(screen.getAllByRole('row')[1]).getByRole('button', { name: 'Revogar' })).toBeTruthy()
    const antes = m.dispositivos.listarDispositivos.mock.calls.length
    m.dispositivos.alterar(CAMERA, { revogadoEm: new Date().toISOString() })
    act(() => m.canal.entregar('estudio', 'dispositivo_mudou', { dispositivoId: CAMERA, remetente: 'a1b2c3d4-0000-4000-8000-000000000002' }))
    await esperar()
    expect(m.dispositivos.listarDispositivos.mock.calls.length).toBe(antes + 1)
    expect(within(screen.getAllByRole('row')[1]).getAllByRole('cell')[2].textContent).toBe('Revogado')
    // a revogação feita nesta aba não volta a ela pelo canal (o eco local não chega a quem enviou): uma leitura só, a do fim da revogação
    cleanup()
    const n = montarEpisodio({ dispositivos: [CAMERA_PAREADA] })
    await esperar()
    const antesDeRevogar = n.dispositivos.listarDispositivos.mock.calls.length
    fireEvent.click(within(screen.getAllByRole('row')[1]).getByRole('button', { name: 'Revogar' }))
    fireEvent.click(within(screen.getAllByRole('row')[1]).getByRole('button', { name: 'Confirmar revogação' }))
    await esperar()
    expect(n.dispositivos.listarDispositivos.mock.calls.length).toBe(antesDeRevogar + 1)
  })
})

/** Situação do OBS na presença do palco (D13, D14), tudo certo; cada caso muda um campo. */
const OBS_OK: SituacaoDoObs = { navegador: true, versaoDoPlugin: '2.24.0', nivel: 4, websocket: 'conectado', versaoObs: '31.0.1', replayBuffer: true, gravando: true }

describe('aba Ao vivo — checklist (Tarefa 9; D13)', () => {
  const automaticos = () => within(screen.getByRole('list', { name: TEXTO_DO_CHECKLIST.automatico })).getAllByRole('listitem')
  const textoDe = (li: HTMLElement) => li.querySelector('.checklist__texto')?.textContent
  const textos = () => automaticos().map(textoDe)
  const situacoes = () => automaticos().map((li) => li.getAttribute('data-situacao'))
  const item = (texto: string) => automaticos().find((li) => textoDe(li) === texto)
  const comPalco = async (m: ReturnType<typeof montarEpisodio>, obs: SituacaoDoObs | null, camera = true) => {
    const presenca: Record<string, unknown[]> = { [SESSAO_PALCO]: [{ tipo: 'obs_palco', dispositivoId: PALCO, obs }] }
    // desde a E4 (Tarefa 6), a câmera e o `obs_camera` levam a situação do vídeo; tudo certo = vídeo chegando e tela travada
    if (camera) {
      presenca[SESSAO_ANTIGA] = [{ tipo: 'camera', dispositivoId: CAMERA, obs: null, video: { estado: 'conectado', telaLigada: 'travada', bateria: null } }]
      presenca[SESSAO_OBS] = [{ tipo: 'obs_camera', dispositivoId: OBS_CAM, obs: null, video: { estado: 'conectado', telaLigada: null, bateria: null } }]
    }
    act(() => m.canal.sincronizarPresenca('estudio', presenca))
    await esperar()
  }

  test('checklist-itens', async () => {
    const m = montarEpisodio({ dispositivos: [CAMERA_PAREADA, PALCO_PAREADO, OBS_CAM_PAREADA] })
    await esperar()
    // a lista fixa do DES-001 §10.4
    const fixa = within(screen.getByRole('list', { name: TEXTO_DO_CHECKLIST.fixo })).getAllByRole('listitem')
    expect(fixa.map((li) => li.textContent)).toEqual([...TEXTO_DO_CHECKLIST.itensFixos])
    // palco ausente
    expect(textos()).toContain('Palco não conectado')
    expect(item('Palco não conectado')?.getAttribute('data-situacao')).toBe('pendente')
    expect(textos()).toContain(TEXTO_DO_CHECKLIST.obsDesconhecido)
    // OBS sem navegador (palco aberto fora do OBS)
    await comPalco(m, { ...OBS_OK, navegador: false, versaoDoPlugin: null, nivel: null })
    expect(textos()).toContain('Palco conectado')
    expect(textos()).toContain('OBS não detectado')
    // nível 3 (BASIC) não basta: Avançado é 4
    await comPalco(m, { ...OBS_OK, nivel: 3 })
    expect(textos()).toContain('Dê acesso Avançado à Fonte do palco')
    expect(item('Dê acesso Avançado à Fonte do palco')?.getAttribute('data-situacao')).toBe('pendente')
    // websocket com senha errada: a versão fica desconhecida, com a do plugin como indicação
    await comPalco(m, { ...OBS_OK, websocket: 'senha_errada', versaoObs: null })
    expect(textos()).toContain(TEXTO_DO_CHECKLIST.websocket.senha_errada)
    expect(textos()).toContain('Versão do OBS desconhecida (plugin do navegador 2.24.0)')
    // versão 30.1
    await comPalco(m, { ...OBS_OK, versaoObs: '30.1.2' })
    expect(textos()).toContain('OBS abaixo de 30.2')
    // Replay Buffer parado
    await comPalco(m, { ...OBS_OK, replayBuffer: false })
    expect(textos()).toContain('Replay Buffer parado')
    expect(item('Replay Buffer parado')?.getAttribute('data-situacao')).toBe('pendente')
    // tudo certo → todos marcados
    await comPalco(m, OBS_OK)
    expect(textos()).toEqual([
      'Palco conectado',
      'OBS detectado',
      'Nível de controle Avançado ou mais',
      'obs-websocket conectado',
      'OBS 31.0.1',
      'Replay Buffer ativo',
      'Gravação em andamento',
      'Vídeo da câmera no OBS',
      'Tela do celular ligada',
    ])
    expect(situacoes().every((s) => s === 'pronto')).toBe(true)
    // o leitor de tela ouve a situação (o sinal é só visual)
    expect(automaticos()[0].textContent).toBe('✓Palco conectado (pronto)')
    expect(automaticos()[0].querySelector('.checklist__sinal')?.getAttribute('aria-hidden')).toBe('true')
    // câmera e `obs_camera` fora: desde a E4 (Tarefa 6) os dois itens do vídeo ficam pendentes (deixaram de ser informativos)
    await comPalco(m, OBS_OK, false)
    expect(item('Vídeo da câmera no OBS: a Fonte /obs/camera não está conectada')?.getAttribute('data-situacao')).toBe('pendente')
    expect(item('Tela do celular: a câmera não está conectada')?.getAttribute('data-situacao')).toBe('pendente')
    expect(situacoes()).not.toContain('info')
    // palco de outra sessão (a antiga, antes do corte) não conta
    act(() => m.canal.sincronizarPresenca('estudio', { [SESSAO_NOVA]: [{ tipo: 'obs_palco', dispositivoId: PALCO, obs: OBS_OK }] }))
    await esperar()
    expect(textos()).toContain('Palco não conectado')
  })
})

describe('aba Ao vivo — comandos (Tarefa 9)', () => {
  test('comandos-no-painel', async () => {
    const m = montarEpisodio()
    await esperar()
    expect(screen.queryByRole('button', { name: '✂️ CLIPE' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Comandos' })).toBeNull()
    fireEvent.change(seletor(), { target: { value: EP_A } })
    fireEvent.click(botao('Usar no modo teste'))
    await esperar()
    const comandos = secao('Comandos')
    expect(within(comandos).getByRole('button', { name: '✂️ CLIPE' })).toBeTruthy()
    expect(within(comandos).getByRole('button', { name: '👏 aplauso' })).toBeTruthy()
    fireEvent.click(within(comandos).getByRole('button', { name: '👏 aplauso' }))
    await esperar()
    expect(m.canal.enviados(`episodio:${EP_A}:controle`).map((e) => (e.payload as { acao: string }).acao)).toEqual(['som'])
    // sem episódio, os comandos somem
    fireEvent.click(botao('Sair do modo teste'))
    await esperar()
    expect(screen.queryByRole('region', { name: 'Comandos' })).toBeNull()
  })

  test('comandos-bloqueados-durante-a-acao', async () => {
    // rodada 1, I1: do clique em "Confirmar início" até a nova consulta terminar, os comandos ficam desabilitados
    // (um toque nessa janela iria ao `:controle` de A); na falha, voltam
    const m = montarEpisodio({ teste: EP_A })
    await esperar()
    const clipe = () => within(secao('Comandos')).getByRole('button', { name: '✂️ CLIPE' }) as HTMLButtonElement
    const clipes = (ep: string) => m.canal.enviados(`episodio:${ep}:controle`).filter((e) => (e.payload as { acao?: string }).acao === 'clipe').length
    expect(clipe().disabled).toBe(false)
    // a função do banco e a consulta seguinte demoram
    let responderInicio: () => void = () => {}
    const iniciarDeVerdade = m.iniciar.getMockImplementation() as (id: string) => Promise<void>
    m.iniciar.mockImplementationOnce((id) => new Promise<void>((ok) => (responderInicio = () => void iniciarDeVerdade(id).then(ok))))
    let responderConsulta: () => void = () => {}
    const consultarDeVerdade = m.episodioAtivo.getMockImplementation() as () => Promise<{ id: string; modo: 'ao_vivo' | 'teste' } | null>
    m.episodioAtivo.mockImplementationOnce(() => new Promise((ok) => (responderConsulta = () => void consultarDeVerdade().then(ok))))
    fireEvent.change(seletor(), { target: { value: EP_B } })
    fireEvent.click(botao('Iniciar o ao vivo'))
    fireEvent.click(botao('Confirmar início'))
    await esperar()
    expect(clipe().disabled).toBe(true)
    fireEvent.click(clipe())
    responderInicio()
    await esperar()
    // o banco já aceitou, o aviso saiu, a consulta ainda não voltou: o painel ainda mostra A, desabilitado
    expect(m.iniciar).toHaveBeenCalledWith(EP_B)
    expect(m.avisos()).toBe(1)
    expect(within(secao('Comandos')).getByText('Ensaio geral')).toBeTruthy()
    expect(clipe().disabled).toBe(true)
    fireEvent.click(clipe())
    await esperar()
    expect(clipes(EP_A)).toBe(0)
    responderConsulta()
    await esperar()
    // depois da consulta: o `:controle` de B conectado, o CLIPE vai para B
    expect(clipe().disabled).toBe(false)
    fireEvent.click(clipe())
    await esperar()
    expect(clipes(EP_B)).toBe(1)
    expect(clipes(EP_A)).toBe(0)
    // na falha, os comandos voltam
    m.encerrar.mockRejectedValueOnce(new ErroDoAoVivo('rede'))
    fireEvent.click(botao('Encerrar o ao vivo'))
    fireEvent.click(botao('Confirmar encerramento'))
    await esperar()
    expect(screen.getByText(TEXTO_DO_EPISODIO.naoConcluiu)).toBeTruthy()
    expect(clipe().disabled).toBe(false)
  })

  test('comandos-desabilitados-com-consulta-falha', async () => {
    // rodada 2: a ação vale no banco, mas a consulta seguinte falha; a tela ainda mostra A, então os comandos
    // ficam desabilitados com a frase de falha até a próxima consulta dar certo (5 s depois)
    const m = montarEpisodio({ teste: EP_A })
    await esperar()
    const clipe = () => within(secao('Comandos')).getByRole('button', { name: '✂️ CLIPE' }) as HTMLButtonElement
    const clipes = (ep: string) => m.canal.enviados(`episodio:${ep}:controle`).filter((e) => (e.payload as { acao?: string }).acao === 'clipe').length
    m.episodioAtivo.mockRejectedValueOnce(new ErroDoAoVivo('rede'))
    fireEvent.change(seletor(), { target: { value: EP_B } })
    fireEvent.click(botao('Iniciar o ao vivo'))
    fireEvent.click(botao('Confirmar início'))
    await esperar()
    expect(m.iniciar).toHaveBeenCalledWith(EP_B)
    expect(screen.getByText(TEXTO_DO_EPISODIO.falhaAoCarregar)).toBeTruthy()
    expect(within(secao('Comandos')).getByText('Ensaio geral')).toBeTruthy()
    expect(clipe().disabled).toBe(true)
    fireEvent.click(clipe())
    await esperar()
    expect(clipes(EP_A)).toBe(0)
    // a próxima consulta dá certo: B na tela, o CLIPE vai para B
    await esperar(REABRIR_CANAIS_MS)
    await esperar()
    expect(screen.queryByText(TEXTO_DO_EPISODIO.falhaAoCarregar)).toBeNull()
    expect(clipe().disabled).toBe(false)
    fireEvent.click(clipe())
    await esperar()
    expect(clipes(EP_B)).toBe(1)
    expect(clipes(EP_A)).toBe(0)
  })

  test('comandos-com-titulos-h3-na-aba', async () => {
    // rodada 1, N1: dentro do `h2` "Comandos", os grupos (Avisos, Sons, Cenas) são `h3`
    const m = montarEpisodio({ teste: EP_A })
    await esperar()
    const comandos = secao('Comandos')
    expect(within(comandos).getByRole('heading', { level: 2 }).textContent).toBe('Comandos')
    expect(within(comandos).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Avisos', 'Sons', 'Cenas'])
    void m
  })

  test('comando-vai-ao-episodio-novo', async () => {
    // o painel inteiro com o adaptador real sobre o Realtime falso: modo teste em A, aba Ao vivo aberta;
    // "Iniciar o ao vivo" de B → o `useAoVivo` da mesma aba consulta de novo e o CLIPE vai para B, nunca para A
    const b = bancoDeTeste({ teste: EP_A })
    const canal = criarCanalFalso()
    const aoVivo: ServicosDeAoVivo = { repo: b.repo, canais: canal.canais }
    const f = criarFalsos({
      usuario: usuarioGoogle('equipe@revocast.test', EU),
      papel: 'equipe',
      permitidos: [{ email: 'equipe@revocast.test', papel: 'equipe', criadoPor: null }],
    })
    render(<App caminho="/painel" dependencias={f.dependencias({ obterAoVivo: () => aoVivo, obterPreparacao: () => b.preparacao, origem: ORIGEM })} />)
    await esperar()
    fireEvent.click(screen.getByRole('tab', { name: 'Ao vivo' }))
    await esperar()
    expect(within(secao('Episódio')).getByText('Ensaio geral')).toBeTruthy()
    expect(canal.abertos()).toEqual(['estudio', `episodio:${EP_A}:controle`, `episodio:${EP_A}:estado`])
    fireEvent.change(seletor(), { target: { value: EP_B } })
    fireEvent.click(botao('Iniciar o ao vivo'))
    fireEvent.click(botao('Confirmar início'))
    await esperar()
    expect(b.iniciar).toHaveBeenCalledWith(EP_B)
    expect(canal.abertos()).toEqual(['estudio', `episodio:${EP_B}:controle`, `episodio:${EP_B}:estado`]) // VER-047: os dois tópicos do episódio novo
    fireEvent.click(within(secao('Comandos')).getByRole('button', { name: '✂️ CLIPE' }))
    await esperar()
    const clipes = (topico: string) => canal.enviados(topico).filter((e) => (e.payload as { acao?: string }).acao === 'clipe').length
    expect(clipes(`episodio:${EP_B}:controle`)).toBe(1)
    expect(clipes(`episodio:${EP_A}:controle`)).toBe(0)
    // um canal `estudio` só no cliente (o do painel)
    expect(canal.realtime.contar('channel', 'estudio')).toBe(1)
  })

  test('estado-do-palco-pelo-topico-proprio (VER-047)', async () => {
    // a aba lê o estado no ar só do `:estado` do episódio; o mesmo estado forjado no `:controle` não entra
    const b = bancoDeTeste({ teste: EP_A })
    const canal = criarCanalFalso()
    const aoVivo: ServicosDeAoVivo = { repo: b.repo, canais: canal.canais }
    const f = criarFalsos({
      usuario: usuarioGoogle('equipe@revocast.test', EU),
      papel: 'equipe',
      permitidos: [{ email: 'equipe@revocast.test', papel: 'equipe', criadoPor: null }],
    })
    render(<App caminho="/painel" dependencias={f.dependencias({ obterAoVivo: () => aoVivo, obterPreparacao: () => b.preparacao, origem: ORIGEM })} />)
    await esperar()
    fireEvent.click(screen.getByRole('tab', { name: 'Ao vivo' }))
    await esperar()
    const estadoNoAr = { episodioId: EP_A, modo: 'teste', cenaObs: 'Cena Geral', avisoId: null, avisoAte: null, ultimo: null, obs: OBS_OK, remetente: SESSAO_PALCO }
    const regiao = () => within(secao('Comandos')).getByRole('region', { name: 'Estado' })
    act(() => canal.entregar(`episodio:${EP_A}:controle`, 'estado', estadoNoAr))
    await esperar()
    expect(within(regiao()).queryByText('Geral')).toBeNull()
    act(() => canal.entregar(`episodio:${EP_A}:estado`, 'estado', estadoNoAr))
    await esperar()
    expect(within(regiao()).getByText('Geral')).toBeTruthy()
    // a presença de membro vai ao `:controle` (o palco republica na entrada); nada é enviado nem marcado no `:estado`
    expect(canal.presencas(`episodio:${EP_A}:controle`)).toEqual([{}])
    expect(canal.presencas(`episodio:${EP_A}:estado`)).toEqual([])
    expect(canal.enviados(`episodio:${EP_A}:estado`)).toEqual([])
  })

  test('comando-vai-ao-episodio-novo-sem-canal', async () => {
    // o mesmo com o `estudio` fora (o aviso não sai): a aba consulta de novo por conta própria
    const b = bancoDeTeste({ teste: EP_A })
    const canal = criarCanalFalso()
    const aoVivo: ServicosDeAoVivo = { repo: b.repo, canais: canal.canais }
    const f = criarFalsos({
      usuario: usuarioGoogle('equipe@revocast.test', EU),
      papel: 'equipe',
      permitidos: [{ email: 'equipe@revocast.test', papel: 'equipe', criadoPor: null }],
    })
    render(<App caminho="/painel" dependencias={f.dependencias({ obterAoVivo: () => aoVivo, obterPreparacao: () => b.preparacao, origem: ORIGEM })} />)
    await esperar()
    fireEvent.click(screen.getByRole('tab', { name: 'Ao vivo' }))
    await esperar()
    canal.definirEstado('estudio', 'reconectando')
    await esperar()
    fireEvent.change(seletor(), { target: { value: EP_B } })
    fireEvent.click(botao('Iniciar o ao vivo'))
    fireEvent.click(botao('Confirmar início'))
    await esperar()
    expect(screen.getByText(TEXTO_DO_EPISODIO.semAviso)).toBeTruthy()
    expect(canal.abertos()).toContain(`episodio:${EP_B}:controle`)
    expect(canal.abertos()).not.toContain(`episodio:${EP_A}:controle`)
    expect(canal.abertos()).not.toContain(`episodio:${EP_A}:estado`)
    expect(within(secao('Episódio')).getByText('<b>Programa</b> de sexta')).toBeTruthy()
  })
})

/*
 * E4, Tarefa 6 (PLA-005 D13 e D2; revisão 4, N16): a situação do vídeo da presença na lista e no checklist, a troca do
 * `obs_camera` (aviso à sessão antiga) e o `obs_camera` ativo ligado a outra câmera.
 */
const OBS_CAM = 'd0000000-0000-4000-8000-000000000003'
const OUTRA_CAMERA = 'd0000000-0000-4000-8000-000000000004'
const SESSAO_OBS = 'b0000000-0000-4000-8000-000000000004'
const SESSAO_OBS_NOVA = 'b0000000-0000-4000-8000-000000000005'
const SESSAO_OUTRA = 'b0000000-0000-4000-8000-000000000006'
const OBS_CAM_PAREADA = dispositivo({ id: OBS_CAM, tipo: 'obs_camera', rotulo: 'Câmera do OBS', cameraId: CAMERA, usuarioAnonimoId: SESSAO_OBS, pareadoEm: PAREADO_EM })
const OUTRA_PAREADA = dispositivo({ id: OUTRA_CAMERA, tipo: 'camera', rotulo: 'Celular reserva', usuarioAnonimoId: SESSAO_OUTRA, pareadoEm: PAREADO_EM })
const OBS_DA_OUTRA = { ...OBS_CAM_PAREADA, cameraId: OUTRA_CAMERA }
const FRASE_OUTRA_CAMERA = 'A câmera do OBS está ligada a outra câmera. Revogue a câmera do OBS e gere um link novo.'
const FRASE_DUPLICADA = 'Já existe uma câmera do OBS ativa. Revogue-a antes.'
const SEM_CONEXAO_DIRETA_NO_CHECKLIST =
  'Vídeo da câmera no OBS: Sem conexão direta com o computador. Ponha o celular e o computador na mesma rede Wi-Fi (sem isolamento de clientes) ou use o roteador ou o hotspot do computador.'

type Video = { estado: string; telaLigada: 'travada' | 'sem_trava' | null; bateria: number | null }
const presencaDaCamera = (video?: Video, id = CAMERA) => ({ tipo: 'camera', dispositivoId: id, obs: null, ...(video === undefined ? {} : { video }) })
const presencaDaObs = (video?: Video) => ({ tipo: 'obs_camera', dispositivoId: OBS_CAM, obs: null, ...(video === undefined ? {} : { video }) })

describe('aba Ao vivo — vídeo da câmera (E4, Tarefa 6; D13, D2)', () => {
  const presenca = async (m: ReturnType<typeof montar>, estado: Record<string, unknown[]>) => {
    act(() => m.canal.sincronizarPresenca('estudio', estado))
    await esperar()
  }
  const linhaDe = (rotulo: string) => screen.getByRole('cell', { name: rotulo }).closest('tr') as HTMLElement
  const situacaoDe = (rotulo: string) => within(linhaDe(rotulo)).getAllByRole('cell')[2]
  const fraseDe = (rotulo: string) => situacaoDe(rotulo).querySelector('.situacao-do-video')?.textContent ?? null
  const automaticos = () => within(screen.getByRole('list', { name: TEXTO_DO_CHECKLIST.automatico })).getAllByRole('listitem')
  const itens = () => automaticos().map((li) => [li.querySelector('.checklist__texto')?.textContent, li.getAttribute('data-situacao')])
  /** O item do checklist que começa com `inicio` (cada um dos dois itens do vídeo aparece uma vez). */
  const item = (...inicios: string[]) => {
    const achados = itens().filter(([t]) => inicios.some((i) => t?.startsWith(i)))
    expect(achados).toHaveLength(1)
    return achados[0]
  }
  const itemDoVideo = () => item('Vídeo da câmera no OBS', 'Gere o link', 'A câmera do OBS')
  const itemDaTela = () => item('Tela do celular')

  test('situacao-do-video-na-lista', async () => {
    const m = montar({ dispositivos: [CAMERA_PAREADA, PALCO_PAREADO, OBS_CAM_PAREADA] })
    await esperar()
    await presenca(m, {
      [SESSAO_ANTIGA]: [presencaDaCamera({ estado: 'conectado', telaLigada: 'travada', bateria: 0.5 })],
      [SESSAO_OBS]: [presencaDaObs({ estado: 'sem_conexao_direta', telaLigada: null, bateria: null })],
      [SESSAO_PALCO]: [{ tipo: 'obs_palco', dispositivoId: PALCO, obs: null }],
    })
    expect(situacaoDe('Celular de gravação').querySelector('.dispositivos__situacao')?.textContent).toBe('Conectado')
    expect(fraseDe('Celular de gravação')).toBe('vídeo chegando · bateria 50%')
    // a bateria é arredondada (revisão, N3): 0,333 → 33%, nunca "33.300000000000004%"
    await presenca(m, { [SESSAO_ANTIGA]: [presencaDaCamera({ estado: 'conectado', telaLigada: 'travada', bateria: 0.333 })] })
    expect(fraseDe('Celular de gravação')).toBe('vídeo chegando · bateria 33%')
    await presenca(m, {
      [SESSAO_ANTIGA]: [presencaDaCamera({ estado: 'conectado', telaLigada: 'travada', bateria: 0.5 })],
      [SESSAO_OBS]: [presencaDaObs({ estado: 'sem_conexao_direta', telaLigada: null, bateria: null })],
    })
    expect(fraseDe('Câmera do OBS')).toBe('sem conexão direta')
    // o palco não tem vídeo: nenhuma frase
    expect(fraseDe('PC do estúdio')).toBeNull()
    // câmera esperando o toque e sem trava de tela
    await presenca(m, { [SESSAO_ANTIGA]: [presencaDaCamera({ estado: 'aguardando_toque', telaLigada: 'sem_trava', bateria: null })] })
    expect(fraseDe('Celular de gravação')).toBe('aguardando toque · tela pode apagar')
    // o `obs_camera` fora da presença: desconectado e sem frase (a situação velha não fica na tela)
    expect(situacaoDe('Câmera do OBS').textContent).toBe('Desconectado')
    expect(fraseDe('Câmera do OBS')).toBeNull()
    // presença inválida (estado fora da lista, bateria fora de [0, 1]) é descartada: desconectado, sem frase
    await presenca(m, {
      [SESSAO_ANTIGA]: [presencaDaCamera({ estado: '<b>x</b>', telaLigada: null, bateria: null })],
      [SESSAO_OBS]: [presencaDaObs({ estado: 'conectado', telaLigada: null, bateria: 2 })],
    })
    expect(situacaoDe('Celular de gravação').textContent).toBe('Desconectado')
    expect(situacaoDe('Câmera do OBS').textContent).toBe('Desconectado')
    expect(document.body.innerHTML).not.toContain('<b>x</b>')
    // a presença com o tipo de outro dispositivo (um `obs_camera` declarando o id da câmera) não dá frase à câmera
    await presenca(m, { [SESSAO_ANTIGA]: [{ tipo: 'obs_camera', dispositivoId: CAMERA, obs: null, video: { estado: 'conectado', telaLigada: null, bateria: null } }] })
    expect(situacaoDe('Celular de gravação').textContent).toBe('Conectado')
    expect(fraseDe('Celular de gravação')).toBeNull()
    // a presença da sessão antiga do `obs_camera` (antes do corte) não conta
    await presenca(m, { [SESSAO_OBS_NOVA]: [presencaDaObs({ estado: 'conectado', telaLigada: null, bateria: null })] })
    expect(fraseDe('Câmera do OBS')).toBeNull()
    // as frases são fixas: cada situação do vídeo tem a sua, e nenhuma vem da presença
    for (const [estado, frase] of [
      ['aguardando_episodio', 'aguardando episódio'],
      ['aguardando_par', 'aguardando a câmera do OBS'],
      ['conectando', 'conectando'],
      ['sem_permissao', 'sem permissão da câmera'],
      ['sem_camera', 'sem câmera traseira'],
      ['inseguro', 'endereço sem https'],
      ['sinal_grande', 'sinal grande demais'],
      ['sem_video_direto', 'navegador sem vídeo direto (WebRTC)'],
    ] as const) {
      await presenca(m, { [SESSAO_ANTIGA]: [presencaDaCamera({ estado, telaLigada: 'travada', bateria: null })] })
      expect(fraseDe('Celular de gravação')).toBe(frase)
    }
    await presenca(m, { [SESSAO_OBS]: [presencaDaObs({ estado: 'aguardando_par', telaLigada: null, bateria: null })] })
    expect(fraseDe('Câmera do OBS')).toBe('aguardando o celular')
    await presenca(m, { [SESSAO_OBS]: [presencaDaObs({ estado: 'sem_video_direto', telaLigada: null, bateria: null })] })
    expect(fraseDe('Câmera do OBS')).toBe('Fonte do OBS sem vídeo direto (WebRTC)')
  })

  test('checklist-video', async () => {
    // sem `obs_camera`: pendente, com o que fazer
    montar({ dispositivos: [CAMERA_PAREADA] })
    await esperar()
    expect(itemDoVideo()).toEqual(['Gere o link da câmera do OBS', 'pendente'])
    cleanup()
    // sem câmera nenhuma: pareie a câmera antes
    montar({ dispositivos: [PALCO_PAREADO] })
    await esperar()
    expect(itemDoVideo()).toEqual(['Vídeo da câmera no OBS: pareie a câmera antes', 'pendente'])
    cleanup()
    // `obs_camera` revogado ou nunca pareado: ainda não há câmera do OBS
    montar({ dispositivos: [CAMERA_PAREADA, { ...OBS_CAM_PAREADA, revogadoEm: PAREADO_EM }] })
    await esperar()
    expect(itemDoVideo()).toEqual(['Gere o link da câmera do OBS', 'pendente'])
    cleanup()
    montar({ dispositivos: [CAMERA_PAREADA, { ...OBS_CAM_PAREADA, usuarioAnonimoId: null, pareadoEm: null }] })
    await esperar()
    expect(itemDoVideo()).toEqual(['Gere o link da câmera do OBS', 'pendente'])
    cleanup()

    const n = montar({ dispositivos: [CAMERA_PAREADA, OBS_CAM_PAREADA] })
    await esperar()
    // pareado, mas a Fonte não está na presença
    expect(itemDoVideo()).toEqual(['Vídeo da câmera no OBS: a Fonte /obs/camera não está conectada', 'pendente'])
    // o `obs_camera` em `conectado`: pronto
    await presenca(n, {
      [SESSAO_ANTIGA]: [presencaDaCamera({ estado: 'conectado', telaLigada: 'travada', bateria: null })],
      [SESSAO_OBS]: [presencaDaObs({ estado: 'conectado', telaLigada: null, bateria: null })],
    })
    expect(itemDoVideo()).toEqual(['Vídeo da câmera no OBS', 'pronto'])
    // a câmera diz `conectado`, mas o `obs_camera` não: pendente (quem decide é o lado do OBS)
    await presenca(n, {
      [SESSAO_ANTIGA]: [presencaDaCamera({ estado: 'conectado', telaLigada: 'travada', bateria: null })],
      [SESSAO_OBS]: [presencaDaObs({ estado: 'sem_conexao_direta', telaLigada: null, bateria: null })],
    })
    expect(itemDoVideo()).toEqual([SEM_CONEXAO_DIRETA_NO_CHECKLIST, 'pendente'])
    // o `obs_camera` aguardando e a câmera esperando o toque: a causa é a do celular
    await presenca(n, {
      [SESSAO_ANTIGA]: [presencaDaCamera({ estado: 'aguardando_toque', telaLigada: null, bateria: null })],
      [SESSAO_OBS]: [presencaDaObs({ estado: 'aguardando_par', telaLigada: null, bateria: null })],
    })
    expect(itemDoVideo()).toEqual(['Vídeo da câmera no OBS: aguardando toque', 'pendente'])
    // o celular sem WebRTC (VER-052): a causa aparece
    await presenca(n, {
      [SESSAO_ANTIGA]: [presencaDaCamera({ estado: 'sem_video_direto', telaLigada: null, bateria: null })],
      [SESSAO_OBS]: [presencaDaObs({ estado: 'aguardando_par', telaLigada: null, bateria: null })],
    })
    expect(itemDoVideo()).toEqual(['Vídeo da câmera no OBS: navegador sem vídeo direto (WebRTC)', 'pendente'])
    // a causa do `obs_camera` vence a da câmera em `sinal_grande` e `sem_video_direto` (revisão, N2)
    await presenca(n, {
      [SESSAO_ANTIGA]: [presencaDaCamera({ estado: 'aguardando_toque', telaLigada: null, bateria: null })],
      [SESSAO_OBS]: [presencaDaObs({ estado: 'sinal_grande', telaLigada: null, bateria: null })],
    })
    expect(itemDoVideo()).toEqual(['Vídeo da câmera no OBS: sinal grande demais', 'pendente'])
    await presenca(n, {
      [SESSAO_ANTIGA]: [presencaDaCamera({ estado: 'aguardando_toque', telaLigada: null, bateria: null })],
      [SESSAO_OBS]: [presencaDaObs({ estado: 'sem_video_direto', telaLigada: null, bateria: null })],
    })
    expect(itemDoVideo()).toEqual(['Vídeo da câmera no OBS: Fonte do OBS sem vídeo direto (WebRTC)', 'pendente'])
    // a câmera conectando: a situação do `obs_camera`
    await presenca(n, {
      [SESSAO_ANTIGA]: [presencaDaCamera({ estado: 'conectando', telaLigada: 'travada', bateria: null })],
      [SESSAO_OBS]: [presencaDaObs({ estado: 'aguardando_par', telaLigada: null, bateria: null })],
    })
    expect(itemDoVideo()).toEqual(['Vídeo da câmera no OBS: aguardando o celular', 'pendente'])
    // o celular fora da presença
    await presenca(n, { [SESSAO_OBS]: [presencaDaObs({ estado: 'aguardando_par', telaLigada: null, bateria: null })] })
    expect(itemDoVideo()).toEqual(['Vídeo da câmera no OBS: o celular de gravação não está conectado', 'pendente'])
    // o `obs_camera` sem a situação do vídeo (versão antiga da página)
    await presenca(n, { [SESSAO_ANTIGA]: [presencaDaCamera()], [SESSAO_OBS]: [presencaDaObs()] })
    expect(itemDoVideo()).toEqual(['Vídeo da câmera no OBS: situação desconhecida', 'pendente'])
  })

  test('checklist-tela-ligada', async () => {
    const m = montar({ dispositivos: [CAMERA_PAREADA, OBS_CAM_PAREADA] })
    await esperar()
    // câmera ausente: pendente
    expect(itemDaTela()).toEqual(['Tela do celular: a câmera não está conectada', 'pendente'])
    await presenca(m, { [SESSAO_ANTIGA]: [presencaDaCamera({ estado: 'conectado', telaLigada: 'travada', bateria: null })] })
    expect(itemDaTela()).toEqual(['Tela do celular ligada', 'pronto'])
    // sem a trava de tela: pendente com as instruções do DES-001 §10.4, item 3
    await presenca(m, { [SESSAO_ANTIGA]: [presencaDaCamera({ estado: 'conectado', telaLigada: 'sem_trava', bateria: null })] })
    expect(itemDaTela()).toEqual([
      'Tela do celular pode apagar. iPhone: desligue o Modo de Pouca Energia (ele força o bloqueio em 30 s) e ponha o bloqueio automático em "Nunca". Android: desligue a economia de bateria e ative "Permanecer ativo" em Opções do desenvolvedor, com o celular no carregador.',
      'pendente',
    ])
    // antes do toque (a trava ainda não foi pedida) ou sem situação do vídeo: desconhecida
    await presenca(m, { [SESSAO_ANTIGA]: [presencaDaCamera({ estado: 'aguardando_toque', telaLigada: null, bateria: null })] })
    expect(itemDaTela()).toEqual(['Tela do celular: situação desconhecida', 'pendente'])
    await presenca(m, { [SESSAO_ANTIGA]: [presencaDaCamera()] })
    expect(itemDaTela()).toEqual(['Tela do celular: situação desconhecida', 'pendente'])
    // a trava do `obs_camera` não conta como a do celular
    await presenca(m, { [SESSAO_OBS]: [presencaDaObs({ estado: 'conectado', telaLigada: 'travada', bateria: null })] })
    expect(itemDaTela()).toEqual(['Tela do celular: a câmera não está conectada', 'pendente'])
  })

  test('revogado-na-presenca-nao-conta', async () => {
    // revisão, N1: a câmera revogada cuja sessão ainda está na presença (até o corte) não mostra vídeo nem conta no checklist
    const m = montar({ dispositivos: [{ ...CAMERA_PAREADA, revogadoEm: PAREADO_EM }, OBS_CAM_PAREADA] })
    await esperar()
    await presenca(m, {
      [SESSAO_ANTIGA]: [presencaDaCamera({ estado: 'conectado', telaLigada: 'travada', bateria: 0.333 })],
      [SESSAO_OBS]: [presencaDaObs({ estado: 'aguardando_par', telaLigada: null, bateria: null })],
    })
    expect(situacaoDe('Celular de gravação').textContent).toBe('Revogado')
    expect(fraseDe('Celular de gravação')).toBeNull()
    expect(itemDaTela()).toEqual(['Tela do celular: a câmera não está conectada', 'pendente'])
    expect(itemDoVideo()).toEqual(['Vídeo da câmera no OBS: o celular de gravação não está conectado', 'pendente'])
    expect(itens().some(([, s]) => s === 'pronto')).toBe(false)
    // o `obs_camera` revogado na presença também não fala (o link pede um novo)
    cleanup()
    const n = montar({ dispositivos: [CAMERA_PAREADA, { ...OBS_CAM_PAREADA, revogadoEm: PAREADO_EM }] })
    await esperar()
    await presenca(n, { [SESSAO_OBS]: [presencaDaObs({ estado: 'conectado', telaLigada: null, bateria: null })] })
    expect(situacaoDe('Câmera do OBS').textContent).toBe('Revogado')
    expect(itemDoVideo()).toEqual(['Gere o link da câmera do OBS', 'pendente'])
  })

  test('obs-camera-de-outra-camera-avisa', async () => {
    // duas câmeras (só pela API), e o `obs_camera` ativo ligado à outra: a aba não gera link
    const m = montar({ dispositivos: [CAMERA_PAREADA, OUTRA_PAREADA, OBS_DA_OUTRA] })
    await esperar()
    const b = botao('Link da câmera do OBS')
    expect(b.disabled).toBe(true)
    const dica = screen.getByText(FRASE_OUTRA_CAMERA, { selector: '.dispositivos__dica' })
    expect(b.getAttribute('aria-describedby')).toBe(dica.id)
    fireEvent.click(b)
    await esperar()
    expect(m.criarCodigo).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Link da câmera do OBS')).toBeNull()
    expect(itemDoVideo()).toEqual([FRASE_OUTRA_CAMERA, 'pendente'])
    // mesmo com o `obs_camera` conectado (ele mostra a outra câmera)
    await presenca(m, { [SESSAO_OBS]: [presencaDaObs({ estado: 'conectado', telaLigada: null, bateria: null })] })
    expect(itemDoVideo()).toEqual([FRASE_OUTRA_CAMERA, 'pendente'])
    cleanup()

    // a lista muda por fora entre a pintura e o clique: a releitura do clique decide, e nada é gerado
    const n = montar({ dispositivos: [CAMERA_PAREADA, OUTRA_PAREADA, OBS_CAM_PAREADA] })
    await esperar()
    expect(botao('Link da câmera do OBS').disabled).toBe(false)
    n.alterar(OBS_CAM, { cameraId: OUTRA_CAMERA })
    fireEvent.click(botao('Link da câmera do OBS'))
    await esperar()
    expect(n.criarCodigo).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Link da câmera do OBS')).toBeNull()
    expect(screen.getByText(FRASE_OUTRA_CAMERA, { selector: '.mensagem' })).toBeTruthy()
    cleanup()

    // o `obs_camera` da própria câmera: reaproveitado como antes
    const o = montar({ dispositivos: [CAMERA_PAREADA, OUTRA_PAREADA, OBS_CAM_PAREADA] })
    await esperar()
    fireEvent.click(botao('Link da câmera do OBS'))
    await esperar()
    expect(o.criarCodigo.mock.calls[0][0]).toEqual({ tipo: 'obs_camera', rotulo: 'Câmera do OBS', dispositivoId: OBS_CAM, cameraId: null })
    expect((screen.getByLabelText('Link da câmera do OBS') as HTMLInputElement).value).toBe(`${ORIGEM}/obs/camera#${CODIGO}`)
    cleanup()

    // só um `obs_camera` revogado, da outra câmera: não é reaproveitado (reativaria a ligação errada); nasce um novo
    const p = montar({ dispositivos: [CAMERA_PAREADA, OUTRA_PAREADA, { ...OBS_DA_OUTRA, revogadoEm: PAREADO_EM }] })
    await esperar()
    expect(botao('Link da câmera do OBS').disabled).toBe(false)
    fireEvent.click(botao('Link da câmera do OBS'))
    await esperar()
    expect(p.criarCodigo.mock.calls[0][0]).toEqual({ tipo: 'obs_camera', rotulo: 'Câmera do OBS', dispositivoId: null, cameraId: CAMERA })
    cleanup()

    // corrida: outro painel criou um `obs_camera` entre a leitura e o pedido → `23505` → a frase defensiva da D2
    const q = montar({ dispositivos: [CAMERA_PAREADA] })
    await esperar()
    q.criarCodigo.mockRejectedValueOnce(new ErroDoAoVivo('duplicado'))
    const leituras = q.listarDispositivos.mock.calls.length
    fireEvent.click(botao('Link da câmera do OBS'))
    await esperar()
    expect(screen.getByText(FRASE_DUPLICADA)).toBeTruthy()
    expect(screen.queryByText(TEXTO_DA_ABA_AO_VIVO.naoGerou)).toBeNull()
    expect(screen.queryByLabelText('Link da câmera do OBS')).toBeNull()
    // a lista é relida (a do clique e a recarga depois da recusa)
    expect(q.listarDispositivos.mock.calls.length).toBe(leituras + 2)
    expect(q.reavaliar).not.toHaveBeenCalled()
    // o `duplicado` de outro tipo continua com a frase comum
    q.criarCodigo.mockRejectedValueOnce(new ErroDoAoVivo('duplicado'))
    fireEvent.click(botao('Link do palco (OBS)'))
    await esperar()
    expect(screen.getByText(TEXTO_DA_ABA_AO_VIVO.naoGerou)).toBeTruthy()
    expect(screen.queryByText(FRASE_DUPLICADA)).toBeNull()
  })

  test('repareamento-da-obs-camera-avisa-sessao-antiga', async () => {
    const m = montar({ dispositivos: [CAMERA_PAREADA, OBS_CAM_PAREADA] })
    await esperar()
    fireEvent.click(botao('Link da câmera do OBS'))
    await esperar()
    expect(m.criarCodigo.mock.calls[0][0]).toEqual({ tipo: 'obs_camera', rotulo: 'Câmera do OBS', dispositivoId: OBS_CAM, cameraId: null })
    // sem troca de sessão, nada é enviado
    await esperar(INTERVALO_DA_CONSULTA_MS * 2)
    expect(m.enviados()).toEqual([])
    // a Fonte do OBS nova pareou: a sessão antiga é avisada uma vez
    m.parear(OBS_CAM, SESSAO_OBS_NOVA)
    await esperar(INTERVALO_DA_CONSULTA_MS)
    expect(m.enviados()).toEqual([{ evento: 'revogacao', usuario: SESSAO_OBS, remetente: EU }])
    expect(screen.getByText('🎥 Câmera do OBS conectada')).toBeTruthy()
    expect(screen.queryByLabelText('Link da câmera do OBS')).toBeNull()
    await esperar(INTERVALO_DA_CONSULTA_MS * 3)
    expect(m.enviados()).toHaveLength(1)
  })

  test('revogar-camera-avisa', async () => {
    // revogar o `obs_camera` ligado à outra câmera (o que a frase pede): `revogacao` e `dispositivo_mudou`, e o link volta
    const m = montar({ dispositivos: [CAMERA_PAREADA, OUTRA_PAREADA, OBS_DA_OUTRA] })
    await esperar()
    const linha = linhaDe('Câmera do OBS')
    fireEvent.click(within(linha).getByRole('button', { name: 'Revogar' }))
    fireEvent.click(within(linha).getByRole('button', { name: 'Confirmar revogação' }))
    await esperar()
    expect(m.revogar).toHaveBeenCalledWith(OBS_CAM)
    expect(m.enviados()).toEqual([
      { evento: 'revogacao', usuario: SESSAO_OBS, remetente: EU },
      { evento: 'dispositivo_mudou', dispositivoId: OBS_CAM, remetente: EU },
    ])
    expect(screen.getByText(TEXTO_DA_ABA_AO_VIVO.revogado)).toBeTruthy()
    expect(botao('Link da câmera do OBS').disabled).toBe(false)
    expect(screen.queryByText(FRASE_OUTRA_CAMERA)).toBeNull()
    expect(itemDoVideo()).toEqual(['Gere o link da câmera do OBS', 'pendente'])
    cleanup()

    // o `obs_camera` da outra câmera nunca pareado também pode ser revogado (senão a frase pediria o impossível)
    const n = montar({ dispositivos: [CAMERA_PAREADA, OUTRA_PAREADA, { ...OBS_DA_OUTRA, usuarioAnonimoId: null, pareadoEm: null }] })
    await esperar()
    const nunca = linhaDe('Câmera do OBS')
    expect(within(nunca).getAllByRole('cell')[2].textContent).toBe('Nunca pareado')
    fireEvent.click(within(nunca).getByRole('button', { name: 'Revogar' }))
    fireEvent.click(within(nunca).getByRole('button', { name: 'Confirmar revogação' }))
    await esperar()
    expect(n.revogar).toHaveBeenCalledWith(OBS_CAM)
    expect(n.enviados()).toEqual([{ evento: 'dispositivo_mudou', dispositivoId: OBS_CAM, remetente: EU }])
    cleanup()

    // um nunca pareado da própria câmera continua sem "Revogar" (como na E3)
    montar({ dispositivos: [CAMERA_PAREADA, { ...OBS_CAM_PAREADA, usuarioAnonimoId: null, pareadoEm: null }] })
    await esperar()
    expect(within(linhaDe('Câmera do OBS')).queryByRole('button', { name: 'Revogar' })).toBeNull()
  })
})
