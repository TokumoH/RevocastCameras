// @vitest-environment jsdom
import { afterEach, describe, test, expect, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Papel } from '../../domains/acesso/papeis'
import type { CanalDoEstudio } from '../../domains/aovivo/portas'
import { App } from '../App'
import type { Dependencias } from '../dependencias'
import type { ServicosDeAoVivo } from '../servicos'
import { aoVivoVazio, criarCanalFalso, criarFalsos, criarFalsosDePreparacao, preparacaoVazia, usuarioGoogle } from '../servicosFalsos'
import { REABRIR_CANAIS_MS } from '../canais'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const ABAS_DA_EQUIPE = ['Episódios', 'Biblioteca', 'Cenas', 'Gestos', 'Ao vivo']
const ABAS_DO_ADMIN = ['Episódios', 'Biblioteca', 'Cenas', 'Gestos', 'Membros', 'Ao vivo']

async function abrirPainel(papel: Papel, extra: Partial<Dependencias> = {}) {
  const f = criarFalsos({
    usuario: usuarioGoogle('adm@revocast.test'),
    papel,
    permitidos: [{ email: 'adm@revocast.test', papel: 'admin', criadoPor: null }],
  })
  const tela = render(<App caminho="/painel" dependencias={f.dependencias(extra)} />)
  await screen.findByRole('tablist')
  return { f, ...tela }
}

/** Esvazia as promessas pendentes e anda `ms` no relógio falso (dentro do `act`). */
async function esperar(ms = 0) {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
    if (ms > 0) await vi.advanceTimersByTimeAsync(ms)
    for (let i = 0; i < 40; i++) await Promise.resolve()
  })
}

const rotulos = () => screen.getAllByRole('tab').map((t) => t.textContent)

describe('painel com abas (D8)', () => {
  test('equipe-ve-abas-sem-membros', async () => {
    await abrirPainel('equipe')
    expect(rotulos()).toEqual(ABAS_DA_EQUIPE)
    expect(screen.queryByRole('tab', { name: 'Membros' })).toBeNull()
  })

  test('admin-ve-membros', async () => {
    await abrirPainel('admin')
    expect(rotulos()).toEqual(ABAS_DO_ADMIN)
  })

  test('ao-vivo-no-painel', async () => {
    // desde a Tarefa 8 da E3, nenhuma aba é provisória: "Ao vivo" mostra os dispositivos
    await abrirPainel('equipe')
    const episodios = screen.getByRole('tab', { name: 'Episódios' })
    expect(episodios.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').textContent).not.toContain('Em construção')

    const aoVivo = screen.getByRole('tab', { name: 'Ao vivo' })
    fireEvent.click(aoVivo)
    expect(aoVivo.getAttribute('aria-selected')).toBe('true')
    expect(episodios.getAttribute('aria-selected')).toBe('false')
    const painel = screen.getByRole('tabpanel')
    expect(within(painel).getByRole('heading', { name: 'Dispositivos' })).toBeTruthy()
    expect(await within(painel).findByRole('button', { name: 'Parear câmera' })).toBeTruthy()
    expect(painel.textContent).not.toContain('Em construção')

    for (const rotulo of ['Episódios', 'Biblioteca', 'Cenas', 'Gestos']) {
      fireEvent.click(screen.getByRole('tab', { name: rotulo }))
      expect(screen.getByRole('tabpanel').textContent, rotulo).not.toContain('Em construção')
    }
  })

  test('painel-reabre-estudio', async () => {
    // o painel abre o `estudio` uma vez (presença de membro), mantém aberto ao trocar de aba e, com `fechado`
    // ou `negado`, chama `reavaliar()` e reabre em 5 s, como o `useAoVivo` (D15, N3, I-A)
    const canal = criarCanalFalso()
    const aoVivo: ServicosDeAoVivo = { repo: aoVivoVazio().repo, canais: canal.canais }
    const obterAoVivo = vi.fn(() => aoVivo)
    const { f } = await abrirPainel('equipe', { obterAoVivo }) // `findByRole` precisa do relógio de verdade
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await esperar()
      const criados = () => canal.realtime.criados.filter((c) => c.topico === 'estudio').length
      expect(obterAoVivo).toHaveBeenCalledTimes(1)
      expect(criados()).toBe(1)
      expect(canal.presencas('estudio')).toEqual([{ tipo: 'membro', papel: 'equipe' }])
      // trocar de aba não abre outro canal nem fecha o atual
      fireEvent.click(screen.getByRole('tab', { name: 'Ao vivo' }))
      await esperar()
      fireEvent.click(screen.getByRole('tab', { name: 'Biblioteca' }))
      await esperar()
      expect(criados()).toBe(1)
      expect(canal.abertos()).toEqual(['estudio'])

      for (const [i, estado] of (['fechado', 'negado'] as const).entries()) {
        const avaliacoes = f.chamadas.usuarioAtual
        act(() => canal.definirEstado('estudio', estado))
        await esperar()
        expect(f.chamadas.usuarioAtual, estado).toBe(avaliacoes + 1) // um reavaliar() só
        await esperar(REABRIR_CANAIS_MS - 1)
        expect(criados(), estado).toBe(i + 1)
        await esperar(1)
        expect(criados(), estado).toBe(i + 2)
        expect(canal.abertos()).toEqual(['estudio'])
        expect(f.chamadas.usuarioAtual, estado).toBe(avaliacoes + 1)
      }
      expect(obterAoVivo).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  test('painel-e-ao-vivo-no-mesmo-cliente', async () => {
    // I3 com o adaptador real sobre o Realtime falso (que imita o realtime-js 2.119.0: `channel()` devolve o canal
    // existente e `on('presence')` depois do `subscribe()` lança): o `estudio` do painel e o do `useAoVivo` da aba
    // são o mesmo; sair da aba não derruba o `estudio`; sair do painel fecha tudo, um `removeChannel` por tópico
    const EU = 'a1b2c3d4-0000-4000-8000-000000000001'
    const OUTRO = 'a1b2c3d4-0000-4000-8000-000000000002'
    const EP = 'e0000000-0000-4000-8000-000000000001'
    const canal = criarCanalFalso()
    const fabrica = canal.canais(EU)
    const alcas: CanalDoEstudio[] = []
    const estudioOriginal = fabrica.estudio.bind(fabrica)
    fabrica.estudio = () => {
      const alca = estudioOriginal()
      alcas.push(alca)
      return alca
    }
    const repo = { ...aoVivoVazio().repo, episodioAtivo: async () => ({ id: EP, modo: 'teste' as const }) }
    const preparacao = criarFalsosDePreparacao({ episodios: [{ id: EP, titulo: 'Ensaio geral', data: '2026-11-27', estado: 'rascunho' }] })
    const f = criarFalsos({
      usuario: usuarioGoogle('adm@revocast.test', EU),
      papel: 'equipe',
      permitidos: [{ email: 'adm@revocast.test', papel: 'equipe', criadoPor: null }],
    })
    const tela = render(<App caminho="/painel" dependencias={f.dependencias({ obterAoVivo: () => ({ repo, canais: canal.canais }), obterPreparacao: () => preparacao.servicos })} />)
    await screen.findByRole('tablist')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await esperar()
    fireEvent.click(screen.getByRole('tab', { name: 'Ao vivo' }))
    await esperar()
    expect(within(screen.getByRole('region', { name: 'Comandos' })).getByRole('button', { name: '✂️ CLIPE' })).toBeTruthy()
    // um canal `estudio`, uma alça (a do painel, passada ao `useAoVivo`), presença marcada uma vez, nenhuma exceção
    expect(canal.realtime.contar('channel', 'estudio')).toBe(1)
    expect(alcas).toHaveLength(1)
    expect(canal.presencas('estudio')).toEqual([{ tipo: 'membro', papel: 'equipe' }])
    expect(canal.abertos()).toEqual(['estudio', `episodio:${EP}:controle`, `episodio:${EP}:estado`]) // VER-047: o `:estado` também
    const estados: string[] = []
    alcas[0].aoMudarEstado((e) => estados.push(e))
    await esperar()
    expect(estados).toEqual(['conectado'])

    // sair da aba: o `:controle` e o `:estado` do `useAoVivo` saem; o `estudio` continua conectado, recebendo e enviando
    fireEvent.click(screen.getByRole('tab', { name: 'Episódios' }))
    await esperar()
    expect(canal.realtime.contar('removeChannel', `episodio:${EP}:controle`)).toBe(1)
    expect(canal.realtime.contar('removeChannel', `episodio:${EP}:estado`)).toBe(1)
    expect(canal.realtime.contar('removeChannel', 'estudio')).toBe(0)
    expect(canal.abertos()).toEqual(['estudio'])
    const recebidas: string[] = []
    alcas[0].aoReceber((m) => recebidas.push(m.evento))
    act(() => canal.entregar('estudio', 'episodio_ativo_mudou', { remetente: OUTRO }))
    await esperar()
    expect(recebidas).toEqual(['episodio_ativo_mudou'])
    expect(await alcas[0].enviar({ evento: 'episodio_ativo_mudou' })).toBe('ok')
    expect(estados).toEqual(['conectado'])

    // sair do painel fecha tudo: um `removeChannel` por tópico
    tela.unmount()
    await esperar()
    expect(canal.realtime.contar('removeChannel', 'estudio')).toBe(1)
    expect(canal.realtime.contar('removeChannel', `episodio:${EP}:controle`)).toBe(1)
    expect(canal.realtime.contar('removeChannel', `episodio:${EP}:estado`)).toBe(1)
    expect(canal.abertos()).toEqual([])
    expect(canal.realtime.contar('channel', 'estudio')).toBe(1)
  })

  test('uma-reavaliacao-na-renovacao', async () => {
    // numa renovação do token, o `estudio` do painel e o `:controle` do `useAoVivo` da aba caem juntos: um
    // `reavaliar()` só (janela de 5 s do painel, compartilhada com o hook; VER-041 e VER-042, Riscos)
    const EU = 'a1b2c3d4-0000-4000-8000-000000000001'
    const EP = 'e0000000-0000-4000-8000-000000000001'
    const canal = criarCanalFalso()
    const repo = { ...aoVivoVazio().repo, episodioAtivo: async () => ({ id: EP, modo: 'teste' as const }) }
    const preparacao = criarFalsosDePreparacao({ episodios: [{ id: EP, titulo: 'Ensaio geral', data: '2026-11-27', estado: 'rascunho' }] })
    const f = criarFalsos({
      usuario: usuarioGoogle('adm@revocast.test', EU),
      papel: 'equipe',
      permitidos: [{ email: 'adm@revocast.test', papel: 'equipe', criadoPor: null }],
    })
    render(<App caminho="/painel" dependencias={f.dependencias({ obterAoVivo: () => ({ repo, canais: canal.canais }), obterPreparacao: () => preparacao.servicos })} />)
    await screen.findByRole('tablist')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await esperar()
    fireEvent.click(screen.getByRole('tab', { name: 'Ao vivo' }))
    await esperar()
    expect(canal.abertos()).toEqual(['estudio', `episodio:${EP}:controle`, `episodio:${EP}:estado`])
    // VER-047: os três tópicos caem juntos na renovação do token; um `reavaliar()` só, em qualquer ordem
    const CONTROLE = `episodio:${EP}:controle`
    const ESTADO = `episodio:${EP}:estado`
    for (const ordem of [['estudio', CONTROLE, ESTADO], [CONTROLE, ESTADO, 'estudio'], [ESTADO, 'estudio', CONTROLE]]) {
      const avaliacoes = f.chamadas.usuarioAtual
      act(() => {
        for (const topico of ordem) canal.definirEstado(topico, 'fechado')
      })
      await esperar()
      expect(f.chamadas.usuarioAtual, ordem.join(' + ')).toBe(avaliacoes + 1)
      // os três reabrem 5 s depois (a pessoa continua membro)
      await esperar(REABRIR_CANAIS_MS)
      await esperar()
      expect([...canal.abertos()].sort(), ordem.join(' + ')).toEqual([CONTROLE, ESTADO, 'estudio'].sort())
      expect(f.chamadas.usuarioAtual, ordem.join(' + ')).toBe(avaliacoes + 1)
    }
  })

  test('painel-reavalia-na-revogacao-propria', async () => {
    // D5 (Tarefa 9, rodada 1): a `revogacao` com o id do próprio membro reavalia o acesso em qualquer aba, uma vez
    // só (com a aba Ao vivo aberta, o `useAoVivo` não ouve: o `estudio` é o do painel); com o id de outra pessoa, nada
    const EU = 'a1b2c3d4-0000-4000-8000-000000000001'
    const OUTRO = 'a1b2c3d4-0000-4000-8000-000000000002'
    const EP = 'e0000000-0000-4000-8000-000000000001'
    const canal = criarCanalFalso()
    const repo = { ...aoVivoVazio().repo, episodioAtivo: async () => ({ id: EP, modo: 'teste' as const }) }
    const preparacao = criarFalsosDePreparacao({ episodios: [{ id: EP, titulo: 'Ensaio geral', data: '2026-11-27', estado: 'rascunho' }] })
    const f = criarFalsos({
      usuario: usuarioGoogle('adm@revocast.test', EU),
      papel: 'admin',
      permitidos: [{ email: 'adm@revocast.test', papel: 'admin', criadoPor: null }],
    })
    render(<App caminho="/painel" dependencias={f.dependencias({ obterAoVivo: () => ({ repo, canais: canal.canais }), obterPreparacao: () => preparacao.servicos })} />)
    await screen.findByRole('tablist')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await esperar()
    const revogar = async (usuario: string) => {
      act(() => canal.entregar('estudio', 'revogacao', { usuario, remetente: OUTRO }))
      await esperar()
    }
    for (const aba of ['Episódios', 'Membros', 'Ao vivo']) {
      fireEvent.click(screen.getByRole('tab', { name: aba }))
      await esperar()
      const antes = f.chamadas.usuarioAtual
      await revogar(OUTRO)
      expect(f.chamadas.usuarioAtual, `${aba}: outra pessoa`).toBe(antes)
      await revogar(EU)
      expect(f.chamadas.usuarioAtual, `${aba}: o próprio`).toBe(antes + 1)
    }
  })

  test('painel-avisa-revogacao-de-membro', async () => {
    // a remoção na aba Membros publica `revogacao` no `estudio` do painel com o id do perfil removido (nunca o do
    // admin) e, depois de uma reabertura do canal, pela alça nova (D5; VER-042, rodada 1)
    const ADM = 'a1b2c3d4-0000-4000-8000-0000000000ad'
    const ANA = 'a1b2c3d4-0000-4000-8000-0000000000a1'
    const BIA = 'a1b2c3d4-0000-4000-8000-0000000000b1'
    const canal = criarCanalFalso()
    const aoVivo: ServicosDeAoVivo = { repo: aoVivoVazio().repo, canais: canal.canais }
    const f = criarFalsos({
      usuario: usuarioGoogle('adm@revocast.test', ADM),
      papel: 'admin',
      permitidos: [
        { email: 'adm@revocast.test', papel: 'admin', criadoPor: null },
        { email: 'ana@revocast.test', papel: 'equipe', criadoPor: ADM },
        { email: 'bia@revocast.test', papel: 'apresentadora', criadoPor: ADM },
      ],
      perfis: [
        { id: ADM, email: 'adm@revocast.test', nome: 'Adm' },
        { id: ANA, email: 'ana@revocast.test', nome: 'Ana' },
        { id: BIA, email: 'bia@revocast.test', nome: 'Bia' },
      ],
    })
    render(<App caminho="/painel" dependencias={f.dependencias({ obterAoVivo: () => aoVivo })} />)
    await screen.findByRole('tablist')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await esperar()
    fireEvent.click(screen.getByRole('tab', { name: 'Membros' }))
    await esperar()
    const revogacoes = () => canal.enviados('estudio').filter((e) => e.event === 'revogacao').map((e) => (e.payload as { usuario: string }).usuario)
    const remover = async (email: string) => {
      const linha = screen.getByText(email).closest('tr') as HTMLElement
      fireEvent.click(within(linha).getByRole('button', { name: 'Remover' }))
      fireEvent.click(within(linha).getByRole('button', { name: 'Confirmar remoção' }))
      await esperar()
    }

    await remover('ana@revocast.test')
    expect(f.chamadas.remover).toEqual(['ana@revocast.test'])
    expect(revogacoes()).toEqual([ANA])
    expect(screen.getByText('Lista atualizada.')).toBeTruthy()

    // o servidor fecha o canal; 5 s depois o painel reabre com outra alça, e o aviso sai por ela
    const criados = () => canal.realtime.criados.filter((c) => c.topico === 'estudio').length
    act(() => canal.definirEstado('estudio', 'fechado'))
    await esperar(REABRIR_CANAIS_MS)
    expect(criados()).toBe(2)
    await remover('bia@revocast.test')
    expect(f.chamadas.remover).toEqual(['ana@revocast.test', 'bia@revocast.test'])
    expect(revogacoes()).toEqual([ANA, BIA])
    expect(revogacoes()).not.toContain(ADM)
    expect(screen.getByText('Lista atualizada.')).toBeTruthy()
    expect(screen.queryByText('Removido da lista. O aviso pelo canal não saiu; o corte do canal vem em até 10 minutos.')).toBeNull()
  })

  test('painel-oferece-copiar-so-com-area-de-transferencia', async () => {
    // o painel passa `navigator.clipboard.writeText` à aba Ao vivo quando o navegador o oferece; sem ele, nenhum botão
    const CODIGO = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'
    const repo = {
      ...aoVivoVazio().repo,
      criarCodigo: async () => ({ dispositivoId: 'd0000000-0000-4000-8000-000000000002', codigo: CODIGO, expiraEm: new Date(Date.now() + 120_000).toISOString() }),
    }
    const aoVivo: ServicosDeAoVivo = { repo, canais: criarCanalFalso().canais }
    const abrirLinkDoPalco = async () => {
      await abrirPainel('equipe', { obterAoVivo: () => aoVivo })
      fireEvent.click(screen.getByRole('tab', { name: 'Ao vivo' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Link do palco (OBS)' }))
      expect(((await screen.findByLabelText('Link do palco (OBS)')) as HTMLInputElement).value).toBe(`https://app.revocast.test/obs/palco#${CODIGO}`)
    }
    expect('clipboard' in navigator).toBe(false) // jsdom não tem área de transferência
    await abrirLinkDoPalco()
    expect(screen.queryByRole('button', { name: 'Copiar link' })).toBeNull()
    cleanup()

    const writeText = vi.fn(async (_t: string) => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    try {
      await abrirLinkDoPalco()
      fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }))
      expect(await screen.findByText('Link copiado.')).toBeTruthy()
      expect(writeText).toHaveBeenCalledWith(`https://app.revocast.test/obs/palco#${CODIGO}`)
    } finally {
      delete (navigator as { clipboard?: unknown }).clipboard
    }
  })

  test('episodios-no-painel', async () => {
    const preparacao = criarFalsosDePreparacao({ episodios: [{ id: 'ep-1', titulo: 'Episódio de teste', data: '2026-11-20', estado: 'rascunho' }] })
    const obterPreparacao = vi.fn(() => preparacao.servicos)
    await abrirPainel('equipe', { obterPreparacao })
    // a aba inicial "Episódios" mostra a lista, sem "Em construção"
    const painel = screen.getByRole('tabpanel')
    expect(await within(painel).findByText('Episódio de teste')).toBeTruthy()
    expect(within(painel).getByRole('button', { name: 'Criar episódio' })).toBeTruthy()
    expect(within(painel).getByText('Iniciar e encerrar o ao vivo ficam na aba Ao vivo.')).toBeTruthy()
    expect(painel.textContent).not.toContain('Em construção')
    expect(obterPreparacao).toHaveBeenCalledTimes(1)
  })

  test('biblioteca-no-painel', async () => {
    const obterPreparacao = vi.fn(preparacaoVazia)
    await abrirPainel('equipe', { obterPreparacao })
    fireEvent.click(screen.getByRole('tab', { name: 'Biblioteca' }))
    const painel = screen.getByRole('tabpanel')
    expect(await within(painel).findByLabelText('Enviar sons e imagens')).toBeTruthy()
    expect(await within(painel).findByText('0,0 MB de 1 GB')).toBeTruthy()
    expect(painel.textContent).not.toContain('Em construção')
    // os serviços da Preparação são obtidos uma vez, mesmo trocando de aba
    fireEvent.click(screen.getByRole('tab', { name: 'Episódios' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Biblioteca' }))
    await within(screen.getByRole('tabpanel')).findByText('0,0 MB de 1 GB')
    expect(obterPreparacao).toHaveBeenCalledTimes(1)
  })

  test('cenas-e-gestos-no-painel', async () => {
    const preparacao = criarFalsosDePreparacao()
    const obterPreparacao = vi.fn(() => preparacao.servicos)
    await abrirPainel('equipe', { obterPreparacao })
    fireEvent.click(screen.getByRole('tab', { name: 'Cenas' }))
    let painel = screen.getByRole('tabpanel')
    expect(await within(painel).findByRole('button', { name: 'Incluir' })).toBeTruthy()
    expect(within(painel).getByLabelText('Nome no OBS')).toBeTruthy()
    expect(painel.textContent).not.toContain('Em construção')
    fireEvent.click(screen.getByRole('tab', { name: 'Gestos' }))
    painel = screen.getByRole('tabpanel')
    const lista = await within(painel).findByRole('list', { name: 'Mapa de gestos' })
    expect(within(lista).getAllByRole('listitem')).toHaveLength(7)
    expect(painel.textContent).not.toContain('Em construção')
    // os serviços da Preparação continuam obtidos uma vez só
    expect(obterPreparacao).toHaveBeenCalledTimes(1)
  })

  test('abas-acessiveis', async () => {
    for (const papel of ['admin', 'equipe'] as const) {
      const { container } = await abrirPainel(papel)
      expect(screen.getAllByRole('tablist')).toHaveLength(1)
      const abas = screen.getAllByRole('tab')
      for (const aba of abas) {
        const id = aba.getAttribute('aria-controls')
        expect(id, aba.textContent ?? '').toBeTruthy()
        const painel = container.querySelector(`[id="${id}"]`)
        expect(painel?.getAttribute('role')).toBe('tabpanel')
        expect(painel?.getAttribute('aria-labelledby')).toBe(aba.id)
      }
      // só o painel da aba ativa fica visível
      expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
      cleanup()
    }
  })

  test('abas-com-teclado', async () => {
    await abrirPainel('admin')
    const abas = screen.getAllByRole('tab')
    expect(abas.map((a) => a.tabIndex)).toEqual([0, -1, -1, -1, -1, -1])
    abas[0].focus()
    fireEvent.keyDown(abas[0], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Ao vivo' }))
    expect(screen.getByRole('tab', { name: 'Ao vivo' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(screen.getByRole('tab', { name: 'Episódios' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Biblioteca' }))
    // as teclas das abas não rolam a página (preventDefault: fireEvent devolve false)
    expect(fireEvent.keyDown(document.activeElement!, { key: 'End' })).toBe(false)
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Home' })).toBe(false)
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Tab' })).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Ao vivo' }).tabIndex).toBe(0)
  })

  test('membros-abre-a-lista', async () => {
    await abrirPainel('admin')
    fireEvent.click(screen.getByRole('tab', { name: 'Membros' }))
    expect(await within(screen.getByRole('tabpanel')).findByRole('table')).toBeTruthy()
    expect(within(screen.getByRole('table')).getByText('adm@revocast.test')).toBeTruthy()
  })

  test('membros-some-quando-rebaixado', async () => {
    const { f } = await abrirPainel('admin')
    fireEvent.click(screen.getByRole('tab', { name: 'Membros' }))
    await within(screen.getByRole('tabpanel')).findByRole('table')
    f.definirPapel('equipe')
    act(() => f.dispararMudancaDeSessao())
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Membros' })).toBeNull())
    expect(rotulos()).toEqual(ABAS_DA_EQUIPE)
    expect(screen.getByRole('tab', { name: 'Episódios' }).getAttribute('aria-selected')).toBe('true')
    expect(within(screen.getByRole('tabpanel')).getByRole('heading', { name: 'Episódios' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  test('rebaixado-e-promovido-nao-reabre-membros', async () => {
    const { f } = await abrirPainel('admin')
    fireEvent.click(screen.getByRole('tab', { name: 'Membros' }))
    await within(screen.getByRole('tabpanel')).findByRole('table')
    f.definirPapel('equipe')
    act(() => f.dispararMudancaDeSessao())
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Membros' })).toBeNull())
    f.definirPapel('admin')
    act(() => f.dispararMudancaDeSessao())
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Membros' })).toBeTruthy())
    expect(screen.getByRole('tab', { name: 'Episódios' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Membros' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.queryByRole('table')).toBeNull()
  })
})
