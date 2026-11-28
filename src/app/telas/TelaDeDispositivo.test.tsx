// @vitest-environment jsdom
import { afterEach, describe, test, expect, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ErroDeDispositivo } from '../../domains/acesso/portasDeDispositivo'
import type { TipoDeDispositivo } from '../../domains/acesso/dispositivos'
import { ErroDeConfiguracao } from '../../shared/infra/configuracao'
import { App } from '../App'
import { dependenciasDoNavegador } from '../dependencias'
import type { Dependencias } from '../dependencias'
import { criarFalsos, criarFalsosDeDispositivo } from '../servicosFalsos'
import { TEXTO_DO_DISPOSITIVO } from './TelaDeDispositivo'
import { TEXTO_DA_CAMERA } from './CameraNoAr'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Código de pareamento na forma (43 caracteres base64url), só de teste. */
const CODIGO = 'Ab3_-'.repeat(9).slice(0, 43)
const MEMBRO = 'a0000000-0000-4000-8000-000000000001'
const OUTRO = 'a0000000-0000-4000-8000-000000000002'
const DISPOSITIVO = '0b6f3c1e-2a4d-4f8b-9c7e-1d2e3f4a5b6c'

type FalsosDeDispositivo = ReturnType<typeof criarFalsosDeDispositivo>

/** Dependências de uma rota de dispositivo: os falsos do tipo, o fragmento dado e a limpeza anotada na mesma ordem das chamadas. */
function montar(d: FalsosDeDispositivo, fragmento: string, extra: Partial<Dependencias> = {}): Dependencias {
  return criarFalsos().dependencias({
    fragmento,
    limparFragmento: () => {
      d.chamadas.ordem.push('limparFragmento')
    },
    obterDispositivo: () => {
      d.chamadas.ordem.push('obterDispositivo')
      return d.servicos
    },
    ...extra,
  })
}

const ROTAS: [string, TipoDeDispositivo][] = [
  ['/camera', 'camera'],
  ['/obs/camera', 'obs_camera'],
  ['/obs/palco', 'obs_palco'],
]

describe('rotas de dispositivo: pareamento (D3, D4)', () => {
  test.each(ROTAS)('fragmento-limpo-antes-da-rede (%s)', async (caminho, tipo) => {
    const d = criarFalsosDeDispositivo()
    render(<App caminho={caminho} dependencias={montar(d, `#${CODIGO}`)} />)
    await waitFor(() => expect(d.chamadas.parear).toEqual([{ codigo: CODIGO, tipo }]))
    const ordem = d.chamadas.ordem
    expect(ordem[0]).toBe('limparFragmento')
    expect(ordem.indexOf('limparFragmento')).toBeLessThan(ordem.indexOf('obterDispositivo'))
    expect(ordem.indexOf('limparFragmento')).toBeLessThan(ordem.indexOf('sessaoAtual'))
    expect(ordem.indexOf('limparFragmento')).toBeLessThan(ordem.indexOf('entrarAnonimo'))
    expect(ordem.filter((m) => m === 'limparFragmento')).toHaveLength(1)
  })

  // desde a E4 (VER-052), o `/camera` pareado é a tela preta (`CameraNoAr`), com a situação do vídeo na presença
  test.each([
    ['/camera', 'camera', TEXTO_DA_CAMERA.aguardando_toque, { video: { estado: 'aguardando_toque', telaLigada: null, bateria: null } }],
    ['/obs/camera', 'obs_camera', 'Pareado como Celular de gravação. O vídeo chega na etapa E4.', {}],
  ] as const)('pareia-e-mostra (%s)', async (caminho, tipo, frase, extra) => {
    const d = criarFalsosDeDispositivo({ pareamento: { resultado: 'pareado', dispositivo: { id: DISPOSITIVO, rotulo: 'Celular de gravação' } } })
    render(<App caminho={caminho} dependencias={montar(d, `#${CODIGO}`)} />)
    expect(await screen.findByText(frase)).toBeTruthy()
    // presença em `estudio` com o próprio dispositivo, sem OBS
    await waitFor(() => expect(d.canal.presencas('estudio')).toEqual([{ tipo, dispositivoId: DISPOSITIVO, obs: null, ...extra }]))
    expect(d.canal.abertos()).toEqual(['estudio'])
  })

  test.each([
    ['link-invalido', { resultado: 'invalido', dispositivo: null }, TEXTO_DO_DISPOSITIVO.link_invalido],
    ['tipo-errado', { resultado: 'tipo_errado', dispositivo: null }, 'Este link é de outro tipo de dispositivo.'],
    ['limite', { resultado: 'limite', dispositivo: null }, 'Muitas tentativas. Espere 10 minutos ou gere outro link.'],
  ] as const)('%s', async (_nome, pareamento, frase) => {
    const d = criarFalsosDeDispositivo({ pareamento })
    render(<App caminho="/camera" dependencias={montar(d, `#${CODIGO}`)} />)
    expect(await screen.findByText(frase)).toBeTruthy()
    expect(d.chamadas.sair).toBe(1) // nenhuma sessão anônima sem dispositivo fica guardada (N1)
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull()
    expect(d.canal.abertos()).toEqual([])
  })

  test('link-invalido sem rede (fragmento fora da forma)', async () => {
    const d = criarFalsosDeDispositivo()
    render(<App caminho="/camera" dependencias={montar(d, '#curto')} />)
    expect(await screen.findByText('Link inválido ou expirado. Gere outro no painel.')).toBeTruthy()
    expect(d.chamadas.ordem).not.toContain('entrarAnonimo')
    expect(d.chamadas.parear).toEqual([])
  })

  test.each(ROTAS)('sem-link (%s)', async (caminho) => {
    const d = criarFalsosDeDispositivo()
    render(<App caminho={caminho} dependencias={montar(d, '')} />)
    expect(await screen.findByText('Este aparelho não está pareado (ou foi revogado). Abra o link ou o QR gerado na aba Ao vivo do painel.')).toBeTruthy()
    expect(screen.queryByText(TEXTO_DO_DISPOSITIVO.revogado)).toBeNull()
    expect(d.chamadas.ordem).not.toContain('entrarAnonimo')
  })

  test('falha-e-tentar-de-novo', async () => {
    const d = criarFalsosDeDispositivo({ pareamento: { resultado: 'pareado', dispositivo: { id: DISPOSITIVO, rotulo: 'Celular de gravação' } } })
    d.falharProxima('entrarAnonimo', new ErroDeDispositivo('rede'))
    render(<App caminho="/camera" dependencias={montar(d, `#${CODIGO}`)} />)
    expect(await screen.findByText('Não foi possível falar com o servidor.')).toBeTruthy()
    expect(d.chamadas.parear).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    // refaz a avaliação; o código (só em memória) ainda vale, porque nada o consumiu
    expect(await screen.findByText(TEXTO_DA_CAMERA.aguardando_toque)).toBeTruthy()
    expect(d.chamadas.parear).toEqual([{ codigo: CODIGO, tipo: 'camera' }])
    expect(d.chamadas.ordem.filter((m) => m === 'limparFragmento')).toHaveLength(1)
  })

  test('codigo-nunca-em-armazenamento', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m))
    const real = dependenciasDoNavegador() // o `limparFragmento` real (`history.replaceState` sem o fragmento)
    let historico: ReturnType<typeof vi.spyOn> | null = null
    for (const pareamento of [
      { resultado: 'pareado', dispositivo: { id: DISPOSITIVO, rotulo: 'Celular de gravação' } },
      { resultado: 'invalido', dispositivo: null },
      { resultado: 'tipo_errado', dispositivo: null },
    ] as const) {
      const d = criarFalsosDeDispositivo({ pareamento })
      d.falharProxima('sessaoAtual', new ErroDeDispositivo('rede'))
      historico?.mockRestore()
      window.history.replaceState(null, '', `/camera?x=1#${CODIGO}`) // a URL do link, antes de espionar
      historico = vi.spyOn(window.history, 'replaceState')
      const dep = montar(d, window.location.hash, {
        limparFragmento: () => {
          d.chamadas.ordem.push('limparFragmento')
          real.limparFragmento()
        },
      })
      render(<App caminho="/camera" dependencias={dep} />)
      // a URL perdeu só o fragmento, antes de qualquer rede, e nenhuma escrita no histórico levou o código
      expect(window.location.hash).toBe('')
      expect(window.location.search).toBe('?x=1')
      expect(historico.mock.calls).toHaveLength(1)
      expect(JSON.stringify(historico.mock.calls)).not.toContain(CODIGO)
      expect(d.chamadas.ordem[0]).toBe('limparFragmento')
      fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }))
      await waitFor(() => expect(d.chamadas.parear).toHaveLength(1))
      await act(async () => {
        for (let i = 0; i < 20; i++) await Promise.resolve()
      })
      cleanup()
    }
    const tudo = JSON.stringify([setItem.mock.calls, historico?.mock.calls, ...consoles.map((c) => c.mock.calls)])
    expect(tudo).not.toContain(CODIGO)
    expect(localStorage.length + sessionStorage.length).toBe(0)
    expect(document.body.innerHTML).not.toContain(CODIGO)
    expect(window.location.href).not.toContain(CODIGO)
    window.history.replaceState(null, '', '/')
  })

  test('configuracao', async () => {
    const d = criarFalsosDeDispositivo()
    const dep = montar(d, `#${CODIGO}`, {
      obterDispositivo: () => {
        d.chamadas.ordem.push('obterDispositivo')
        throw new ErroDeConfiguracao('Variável de ambiente ausente ou vazia: VITE_SUPABASE_PUBLISHABLE_KEY')
      },
    })
    render(<App caminho="/obs/palco" dependencias={dep} />)
    expect(await screen.findByRole('heading', { name: 'Configuração incompleta' })).toBeTruthy()
    expect(screen.getByText(/VITE_SUPABASE_PUBLISHABLE_KEY/)).toBeTruthy()
    expect(d.chamadas.ordem).toEqual(['limparFragmento', 'obterDispositivo'])
  })

  test('revogado-na-hora', async () => {
    const d = criarFalsosDeDispositivo({ pareamento: { resultado: 'pareado', dispositivo: { id: DISPOSITIVO, rotulo: 'Celular de gravação' } } })
    render(<App caminho="/camera" dependencias={montar(d, `#${CODIGO}`)} />)
    expect(await screen.findByText(TEXTO_DA_CAMERA.aguardando_toque)).toBeTruthy()
    await waitFor(() => expect(d.canal.presencas('estudio')).toHaveLength(1))
    const eu = '5a1c9e2b-7d3f-4b6a-8c1d-000000000001' // o usuário do login anônimo do falso
    expect(d.chamadas.sair).toBe(0)

    // revogação de outro usuário: nada muda
    act(() => d.canal.entregar('estudio', 'revogacao', { usuario: OUTRO, remetente: MEMBRO }))
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(screen.getByText(TEXTO_DA_CAMERA.aguardando_toque)).toBeTruthy()
    expect(d.chamadas.sair).toBe(0)
    expect(d.canal.abertos()).toEqual(['estudio'])

    // a do próprio usuário: canais fechados, `sair` uma vez e a tela de revogado
    act(() => d.canal.entregar('estudio', 'revogacao', { usuario: eu, remetente: MEMBRO }))
    expect(await screen.findByText('Este dispositivo foi revogado. Gere um novo link no painel.')).toBeTruthy()
    expect(d.chamadas.sair).toBe(1)
    expect(d.canal.abertos()).toEqual([])
    expect(screen.queryByText(TEXTO_DA_CAMERA.aguardando_toque)).toBeNull()
  })

  test('canal fechado na câmera: com dispositivo reabre, sem dispositivo vira revogado', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const d = criarFalsosDeDispositivo({ pareamento: { resultado: 'pareado', dispositivo: { id: DISPOSITIVO, rotulo: 'Celular de gravação' } } })
      render(<App caminho="/camera" dependencias={montar(d, `#${CODIGO}`)} />)
      const esvaziar = () => act(async () => {
        for (let i = 0; i < 30; i++) await Promise.resolve()
      })
      await esvaziar()
      expect(screen.getByText(TEXTO_DA_CAMERA.aguardando_toque)).toBeTruthy()
      act(() => d.canal.definirEstado('estudio', 'fechado'))
      await esvaziar()
      expect(d.canal.abertos()).toEqual([])
      await act(() => vi.advanceTimersByTimeAsync(5000))
      await esvaziar()
      expect(d.canal.abertos()).toEqual(['estudio'])
      d.definirDispositivo(null)
      act(() => d.canal.definirEstado('estudio', 'negado'))
      await esvaziar()
      expect(screen.getByText(TEXTO_DO_DISPOSITIVO.revogado)).toBeTruthy()
      expect(d.chamadas.sair).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  test('tipo-errado-nao-guarda-sessao', async () => {
    const d = criarFalsosDeDispositivo({ pareamento: { resultado: 'tipo_errado', dispositivo: null } })
    render(<App caminho="/obs/camera" dependencias={montar(d, `#${CODIGO}`)} />)
    expect(await screen.findByText('Este link é de outro tipo de dispositivo.')).toBeTruthy()
    expect(d.chamadas.sair).toBe(1)
    cleanup()
    // recarregar: a mesma sessão falsa (já sem usuário) e a URL sem o fragmento
    render(<App caminho="/obs/camera" dependencias={montar(d, '')} />)
    expect(await screen.findByText(TEXTO_DO_DISPOSITIVO.sem_link)).toBeTruthy()
    expect(screen.queryByText(TEXTO_DO_DISPOSITIVO.revogado)).toBeNull()
    expect(d.chamadas.parear).toHaveLength(1)
  })

  test('carregando: a câmera diz que confere; o palco (na Fonte do OBS) não mostra nada', async () => {
    for (const [caminho, tipo] of ROTAS) {
      const d = criarFalsosDeDispositivo()
      const servico = { ...d.servicos.servico, sessaoAtual: () => new Promise<never>(() => {}) }
      const { container } = render(<App caminho={caminho} dependencias={montar(d, '', { obterDispositivo: () => ({ ...d.servicos, servico }) })} />)
      await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve()
      })
      if (tipo === 'obs_palco') expect(container.textContent, caminho).toBe('')
      else expect(screen.getByText(TEXTO_DO_DISPOSITIVO.carregando)).toBeTruthy()
      cleanup()
    }
  })

  test('strict-mode-pareia-uma-vez', async () => {
    const { StrictMode } = await import('react')
    const d = criarFalsosDeDispositivo({ pareamento: { resultado: 'pareado', dispositivo: { id: DISPOSITIVO, rotulo: 'Celular de gravação' } } })
    render(
      <StrictMode>
        <App caminho="/camera" dependencias={montar(d, `#${CODIGO}`)} />
      </StrictMode>,
    )
    expect(await screen.findByText(TEXTO_DA_CAMERA.aguardando_toque)).toBeTruthy()
    expect(d.chamadas.parear).toHaveLength(1)
    expect(d.chamadas.sair).toBe(0)
  })
})
