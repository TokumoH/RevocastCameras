// @vitest-environment jsdom
import { afterEach, beforeEach, describe, test, expect, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Dispositivo, TipoDeDispositivo } from '../../domains/acesso/dispositivos'
import { ErroDoAoVivo } from '../../domains/aovivo/portas'
import type { CanalDoEstudio, RepositorioDoAoVivo } from '../../domains/aovivo/portas'
import { matrizDoQr } from '../../shared/infra/qr'
import { CodigoQr } from '../../shared/ui/CodigoQr'
import { App } from '../App'
import type { ServicosDeAoVivo } from '../servicos'
import { aoVivoVazio, criarCanalFalso, criarFalsos, usuarioGoogle } from '../servicosFalsos'
import { AbaAoVivo, INTERVALO_DA_CONSULTA_MS, TEXTO_DA_ABA_AO_VIVO } from './AbaAoVivo'

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

function montar(o: { dispositivos?: Dispositivo[]; copiar?: ((t: string) => Promise<void>) | null; semCanal?: boolean } = {}) {
  const r = repoDeTeste(o.dispositivos ?? [])
  const canal = criarCanalFalso()
  const estudio: CanalDoEstudio | null = o.semCanal ? null : canal.canais(EU).estudio()
  const reavaliar = vi.fn()
  const tela = render(<AbaAoVivo repo={r.repo} estudio={estudio} origem={ORIGEM} reavaliar={reavaliar} copiar={o.copiar ?? null} />)
  const enviados = () => canal.enviados('estudio').map((e) => ({ evento: e.event, ...(e.payload as Record<string, unknown>) }))
  return { ...r, canal, estudio, reavaliar, tela, enviados }
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
    // o ouvinte de presença do `estudio` (que é do painel e continua aberto) é solto quando a aba desmonta
    const r = repoDeTeste([CAMERA_PAREADA])
    const canal = criarCanalFalso()
    const estudio = canal.canais(EU).estudio()
    const soltar = vi.fn()
    const original = estudio.aoMudarPresenca.bind(estudio)
    estudio.aoMudarPresenca = (f) => {
      const desfazer = original(f)
      return () => {
        soltar()
        desfazer()
      }
    }
    const tela = render(<AbaAoVivo repo={r.repo} estudio={estudio} origem={ORIGEM} reavaliar={vi.fn()} copiar={null} />)
    await esperar()
    expect(soltar).not.toHaveBeenCalled()
    tela.unmount()
    expect(soltar).toHaveBeenCalledTimes(1)
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
    render(<AbaAoVivo repo={r.repo} estudio={null} origem={ORIGEM} reavaliar={reavaliar} copiar={null} />)
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
