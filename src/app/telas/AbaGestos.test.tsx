// @vitest-environment jsdom
import { afterEach, describe, test, expect, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Cena } from '../../domains/preparacao/cenas'
import { GESTOS } from '../../domains/preparacao/gestos'
import type { AcaoDoGesto, Gesto, LinhaDoMapa } from '../../domains/preparacao/gestos'
import type { Som } from '../../domains/preparacao/midia'
import { ErroDePreparacao } from '../../domains/preparacao/portas'
import { criarFalsosDePreparacao } from '../servicosFalsos'
import { AbaGestos } from './AbaGestos'

afterEach(cleanup)

// Textos fixos da aba (PLA-003, Tarefa 6, e D12), repetidos aqui de propósito.
const FALTA_SOM = 'Escolha o som.'
const FALTA_CENA = 'Escolha a cena.'
const ALVO_INEXISTENTE = 'Esse alvo não existe mais; a lista foi recarregada.'
const SEM_SONS = 'Envie um som na Biblioteca.'
const SEM_CENAS = 'Inclua uma cena na aba Cenas.'
const SALVO = 'Gesto salvo.'
const MUDOU = 'O mapa de gestos ou o seu papel mudou; conferindo de novo.'
const NAO_CONCLUIU = 'Não foi possível concluir. Tente de novo.'

const APLAUSO: Som = { id: 'som-aplauso', midiaId: 'midia-aplauso', rotulo: 'Aplauso', emoji: '👏', volume: 1, ordem: 0 }
const BUZINA: Som = { id: 'som-buzina', midiaId: 'midia-buzina', rotulo: 'Buzina', emoji: null, volume: 1, ordem: 1 }
const GERAL: Cena = { id: 'cena-geral', nomeExibicao: 'Geral', nomeObs: 'Cena Geral', ordem: 0 }

/** Mapa com todos em `nenhuma`, menos as linhas dadas. */
function mapa(linhas: Partial<Record<Gesto, { acao: AcaoDoGesto; cenaId?: string | null; somId?: string | null }>> = {}): LinhaDoMapa[] {
  return GESTOS.map((g) => {
    const l = linhas[g.gesto]
    return { gesto: g.gesto, acao: l?.acao ?? 'nenhuma', cenaId: l?.cenaId ?? null, somId: l?.somId ?? null }
  })
}

function abrir(inicial: Parameters<typeof criarFalsosDePreparacao>[0] = {}) {
  const f = criarFalsosDePreparacao(inicial)
  const reavaliar = vi.fn()
  const listarGestos = vi.fn(f.servicos.gestos.listar)
  f.servicos.gestos.listar = listarGestos
  const tela = render(<AbaGestos servicos={f.servicos} reavaliar={reavaliar} />)
  return { f, reavaliar, listarGestos, ...tela }
}

/** A linha (item da lista) do gesto com este rótulo. */
async function linhaDe(rotulo: string): Promise<HTMLElement> {
  const lista = await screen.findByRole('list', { name: 'Mapa de gestos' })
  const texto = await within(lista).findByText(rotulo)
  const linha = texto.closest('li')
  if (!linha) throw new Error(`sem linha para ${rotulo}`)
  return linha
}

function escolher(linha: HTMLElement, rotulo: string, valor: string) {
  fireEvent.change(within(linha).getByLabelText(rotulo), { target: { value: valor } })
}

function alerta(): HTMLElement {
  const regiao = screen.getAllByRole('alert').find((r) => r.getAttribute('tabindex') === '-1')
  if (!regiao) throw new Error('sem região de alerta')
  return regiao
}

async function andar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('aba Gestos', () => {
  test('sete-linhas', async () => {
    abrir({ mapa: mapa({ ILoveYou: { acao: 'clipe' }, Closed_Fist: { acao: 'marcador' } }) })
    const lista = await screen.findByRole('list', { name: 'Mapa de gestos' })
    const linhas = within(lista).getAllByRole('listitem')
    expect(linhas).toHaveLength(7)
    // na ordem de GESTOS, com emoji e nome
    expect(linhas.map((li) => li.querySelector('.gestos__nome')?.textContent)).toEqual(GESTOS.map((g) => g.rotulo))
    expect(linhas.map((li) => li.querySelector('.gestos__emoji')?.textContent)).toEqual(GESTOS.map((g) => g.emoji))
    await waitFor(() => expect((within(linhas[0]).getByLabelText('Ação') as HTMLSelectElement).value).toBe('clipe'))
    expect((within(linhas[1]).getByLabelText('Ação') as HTMLSelectElement).value).toBe('marcador')
    // o seletor tem os 8 rótulos de ACOES
    const opcoes = Array.from((within(linhas[0]).getByLabelText('Ação') as HTMLSelectElement).options).map((o) => o.textContent)
    expect(opcoes).toEqual(['Clipe', 'Marcador', 'Cena', 'Som', 'Próximo aviso', 'Ocultar aviso', 'Próxima cena', 'Nenhuma'])
  })

  test('gesto-som-sem-som-na-tela', async () => {
    const { f } = abrir({ sons: [APLAUSO] })
    const linha = await linhaDe('Polegar para cima')
    escolher(linha, 'Ação', 'som')
    expect((within(linha).getByLabelText('Som') as HTMLSelectElement).value).toBe('')
    fireEvent.click(within(linha).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(FALTA_SOM)).toBeTruthy()
    await andar()
    expect(f.chamadas.gestos).toEqual([])
    expect(document.activeElement).toBe(alerta())
  })

  test('gesto-cena-sem-cena-na-tela', async () => {
    const { f } = abrir({ cenas: [GERAL] })
    const linha = await linhaDe('Vitória')
    escolher(linha, 'Ação', 'cena')
    fireEvent.click(within(linha).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(FALTA_CENA)).toBeTruthy()
    await andar()
    expect(f.chamadas.gestos).toEqual([])
  })

  test('som-desabilitado-sem-sons', async () => {
    abrir({ cenas: [] })
    const linha = await linhaDe('Polegar para cima')
    const acao = within(linha).getByLabelText('Ação') as HTMLSelectElement
    const opcao = (valor: string) => Array.from(acao.options).find((o) => o.value === valor)!
    expect(opcao('som').disabled).toBe(true)
    expect(opcao('cena').disabled).toBe(true)
    expect(opcao('clipe').disabled).toBe(false)
    expect(screen.getByText(SEM_SONS)).toBeTruthy()
    expect(screen.getByText(SEM_CENAS)).toBeTruthy()
    // com um som e uma cena, as opções e os textos mudam
    cleanup()
    abrir({ sons: [APLAUSO], cenas: [GERAL] })
    const outra = await linhaDe('Polegar para cima')
    const acao2 = within(outra).getByLabelText('Ação') as HTMLSelectElement
    await waitFor(() => expect(Array.from(acao2.options).find((o) => o.value === 'som')!.disabled).toBe(false))
    expect(Array.from(acao2.options).find((o) => o.value === 'cena')!.disabled).toBe(false)
    expect(screen.queryByText(SEM_SONS)).toBeNull()
    expect(screen.queryByText(SEM_CENAS)).toBeNull()
  })

  test('troca-para-cena', async () => {
    const { f } = abrir({ cenas: [GERAL], sons: [APLAUSO], mapa: mapa({ Victory: { acao: 'proxima_cena' } }) })
    const linha = await linhaDe('Vitória')
    expect(within(linha).queryByLabelText('Cena')).toBeNull()
    escolher(linha, 'Ação', 'cena')
    escolher(linha, 'Cena', 'cena-geral')
    const salvar = within(linha).getByRole('button', { name: 'Salvar' })
    fireEvent.click(salvar)
    expect(await screen.findByText(SALVO)).toBeTruthy()
    expect(f.chamadas.gestos).toEqual([{ gesto: 'Victory', acao: 'cena', cenaId: 'cena-geral', somId: null }])
    await waitFor(() => expect(document.activeElement).toBe(within(linha).getByRole('button', { name: 'Salvar' })))
  })

  test('troca-para-clipe-zera-alvos', async () => {
    const { f } = abrir({ sons: [APLAUSO], mapa: mapa({ Thumb_Up: { acao: 'som', somId: 'som-aplauso' } }) })
    const linha = await linhaDe('Polegar para cima')
    await waitFor(() => expect((within(linha).getByLabelText('Som') as HTMLSelectElement).value).toBe('som-aplauso'))
    escolher(linha, 'Ação', 'clipe')
    expect(within(linha).queryByLabelText('Som')).toBeNull()
    fireEvent.click(within(linha).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(SALVO)).toBeTruthy()
    // a linha gravada nunca leva o alvo de outra ação
    expect(f.chamadas.gestos).toEqual([{ gesto: 'Thumb_Up', acao: 'clipe', cenaId: null, somId: null }])
  })

  test('troca-de-som-para-cena-zera-som', async () => {
    const { f } = abrir({ sons: [APLAUSO], cenas: [GERAL], mapa: mapa({ Thumb_Up: { acao: 'som', somId: 'som-aplauso' } }) })
    const linha = await linhaDe('Polegar para cima')
    await waitFor(() => expect((within(linha).getByLabelText('Som') as HTMLSelectElement).value).toBe('som-aplauso'))
    escolher(linha, 'Ação', 'cena')
    escolher(linha, 'Cena', 'cena-geral')
    fireEvent.click(within(linha).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(SALVO)).toBeTruthy()
    expect(f.chamadas.gestos).toEqual([{ gesto: 'Thumb_Up', acao: 'cena', cenaId: 'cena-geral', somId: null }])
  })

  test('liga-som', async () => {
    const { f } = abrir({ sons: [APLAUSO, BUZINA] })
    const linha = await linhaDe('Polegar para baixo')
    escolher(linha, 'Ação', 'som')
    const opcoes = Array.from((within(linha).getByLabelText('Som') as HTMLSelectElement).options).map((o) => o.textContent)
    expect(opcoes).toEqual(['Escolha o som', '👏 Aplauso', 'Buzina'])
    escolher(linha, 'Som', 'som-buzina')
    fireEvent.click(within(linha).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(SALVO)).toBeTruthy()
    expect(f.chamadas.gestos).toEqual([{ gesto: 'Thumb_Down', acao: 'som', cenaId: null, somId: 'som-buzina' }])
  })

  test('sugestao-liga-aplauso', async () => {
    const { f } = abrir({ sons: [BUZINA, APLAUSO] })
    const botao = await screen.findByRole('button', { name: 'Ligar 👍 ao som Aplauso' })
    // só 👍: não há som "buuu"
    expect(screen.queryByRole('button', { name: /Ligar 👎/ })).toBeNull()
    fireEvent.click(botao)
    expect(await screen.findByText(SALVO)).toBeTruthy()
    expect(f.chamadas.gestos).toEqual([{ gesto: 'Thumb_Up', acao: 'som', cenaId: null, somId: 'som-aplauso' }])
    // depois da recarga, a linha já está em `som` e o botão some
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ligar 👍 ao som Aplauso' })).toBeNull())
    const linha = await linhaDe('Polegar para cima')
    expect((within(linha).getByLabelText('Ação') as HTMLSelectElement).value).toBe('som')
    expect((within(linha).getByLabelText('Som') as HTMLSelectElement).value).toBe('som-aplauso')
    expect(document.activeElement?.getAttribute('role')).toBe('status')
  })

  test('sem-sugestao-com-gesto-ocupado', async () => {
    abrir({ sons: [APLAUSO], mapa: mapa({ Thumb_Up: { acao: 'clipe' } }) })
    await linhaDe('Polegar para cima')
    await andar()
    expect(screen.queryByRole('button', { name: /Ligar/ })).toBeNull()
  })

  test('alvo-que-sumiu', async () => {
    const { f, listarGestos } = abrir({ cenas: [GERAL] })
    f.falharProxima('gestos.alterar', new ErroDePreparacao('invalido'))
    const linha = await linhaDe('Vitória')
    await andar()
    expect(listarGestos).toHaveBeenCalledTimes(1)
    escolher(linha, 'Ação', 'cena')
    escolher(linha, 'Cena', 'cena-geral')
    fireEvent.click(within(linha).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(ALVO_INEXISTENTE)).toBeTruthy()
    await waitFor(() => expect(listarGestos).toHaveBeenCalledTimes(2))
    expect(document.activeElement).toBe(alerta())
    // a escolha não salva da linha é descartada: volta ao que o banco tem
    expect((within(linha).getByLabelText('Ação') as HTMLSelectElement).value).toBe('nenhuma')
    expect(within(linha).queryByLabelText('Cena')).toBeNull()
  })

  test('sessao-expirada-na-escrita', async () => {
    const { f, reavaliar, listarGestos } = abrir()
    f.falharProxima('gestos.alterar', new ErroDePreparacao('sessao_expirada'))
    const linha = await linhaDe('Mão aberta')
    await andar()
    expect(listarGestos).toHaveBeenCalledTimes(1)
    escolher(linha, 'Ação', 'ocultar_aviso')
    fireEvent.click(within(linha).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(reavaliar).toHaveBeenCalledTimes(1))
    await andar()
    expect(reavaliar).toHaveBeenCalledTimes(1)
    // só `reavaliar()`: nenhuma mensagem (nem a genérica) e nenhuma recarga (a leitura também falharia)
    expect(alerta().textContent).toBe('')
    expect(screen.queryByText(NAO_CONCLUIU)).toBeNull()
    expect(screen.getAllByRole('status').find((r) => r.getAttribute('tabindex') === '-1')!.textContent).toBe('')
    expect(listarGestos).toHaveBeenCalledTimes(1)
  })

  test('alvo-que-sumiu-pela-chave-estrangeira', async () => {
    // a cena apagada entre a carga e o "Salvar": o `update` viola a chave estrangeira (23503 → `em_uso`)
    const { f, listarGestos } = abrir({ cenas: [GERAL] })
    f.falharProxima('gestos.alterar', new ErroDePreparacao('em_uso'))
    const linha = await linhaDe('Vitória')
    await andar()
    escolher(linha, 'Ação', 'cena')
    escolher(linha, 'Cena', 'cena-geral')
    fireEvent.click(within(linha).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(ALVO_INEXISTENTE)).toBeTruthy()
    await waitFor(() => expect(listarGestos).toHaveBeenCalledTimes(2))
  })

  test('alvo-fora-da-lista-recarrega-sem-gravar', async () => {
    // linha carregada apontando para um som que não veio na lista (apagado entre as leituras)
    const { f, listarGestos } = abrir({ sons: [APLAUSO], mapa: mapa({ Thumb_Up: { acao: 'som', somId: 'som-sumido' } }) })
    const linha = await linhaDe('Polegar para cima')
    await andar()
    fireEvent.click(within(linha).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(ALVO_INEXISTENTE)).toBeTruthy()
    await waitFor(() => expect(listarGestos).toHaveBeenCalledTimes(2))
    expect(f.chamadas.gestos).toEqual([])
  })

  test('escrita-negada-reavalia', async () => {
    const { f, reavaliar, listarGestos } = abrir()
    f.falharProxima('gestos.alterar', new ErroDePreparacao('nada_alterado'))
    const linha = await linhaDe('Mão aberta')
    await andar()
    escolher(linha, 'Ação', 'ocultar_aviso')
    fireEvent.click(within(linha).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(MUDOU)).toBeTruthy()
    expect(reavaliar).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(listarGestos).toHaveBeenCalledTimes(2))
  })

  test('falha-de-rede-na-escrita', async () => {
    const { f, reavaliar } = abrir()
    f.falharProxima('gestos.alterar', new ErroDePreparacao('rede'))
    const linha = await linhaDe('Mão aberta')
    escolher(linha, 'Ação', 'ocultar_aviso')
    fireEvent.click(within(linha).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(NAO_CONCLUIU)).toBeTruthy()
    expect(reavaliar).not.toHaveBeenCalled()
  })

  test('nomes-com-html-literal', async () => {
    const html = '<img src=x onerror=alert(1)>'
    const { container } = abrir({
      cenas: [{ ...GERAL, nomeExibicao: html }],
      sons: [{ ...APLAUSO, rotulo: html }],
      mapa: mapa({ Victory: { acao: 'cena', cenaId: 'cena-geral' }, Thumb_Down: { acao: 'som', somId: 'som-aplauso' } }),
    })
    const linha = await linhaDe('Vitória')
    await waitFor(() => expect((within(linha).getByLabelText('Cena') as HTMLSelectElement).value).toBe('cena-geral'))
    const opcoes = Array.from((within(linha).getByLabelText('Cena') as HTMLSelectElement).options).map((o) => o.textContent)
    expect(opcoes).toContain(`${html} (Cena Geral)`)
    expect(container.querySelector('img[src="x"]')).toBeNull()
  })

  test('sessao-expirada-ao-carregar', async () => {
    const f = criarFalsosDePreparacao()
    f.falharProxima('gestos.listar', new ErroDePreparacao('sessao_expirada'))
    const reavaliar = vi.fn()
    render(<AbaGestos servicos={f.servicos} reavaliar={reavaliar} />)
    expect(await screen.findByText('Não foi possível carregar o mapa de gestos.')).toBeTruthy()
    expect(reavaliar).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await linhaDe('Vitória')).toBeTruthy()
  })

  test('gesto-sem-linha-no-banco', async () => {
    // a E2 só altera as 7 linhas da E0; se faltar uma, a tela não tenta inserir
    const { f } = abrir({ mapa: mapa().filter((l) => l.gesto !== 'Open_Palm') })
    const linha = await linhaDe('Mão aberta')
    expect(within(linha).getByText('Sem linha no banco.')).toBeTruthy()
    expect(within(linha).queryByRole('button', { name: 'Salvar' })).toBeNull()
    expect(f.chamadas.gestos).toEqual([])
  })

  test('clique-duplo-nao-duplica', async () => {
    const { f } = abrir()
    const linha = await linhaDe('Mão aberta')
    escolher(linha, 'Ação', 'ocultar_aviso')
    const salvar = within(linha).getByRole('button', { name: 'Salvar' })
    // os dois cliques no mesmo `act`: o React não renderiza entre eles, então o botão ainda não está desabilitado
    act(() => {
      fireEvent.click(salvar)
      fireEvent.click(salvar)
    })
    expect(await screen.findByText(SALVO)).toBeTruthy()
    expect(f.chamadas.gestos).toHaveLength(1)
  })

  test('avisos-sempre-montados', async () => {
    abrir()
    await linhaDe('Vitória')
    expect(screen.getAllByRole('status').some((r) => r.getAttribute('tabindex') === '-1')).toBe(true)
    expect(screen.getAllByRole('alert').some((r) => r.getAttribute('tabindex') === '-1')).toBe(true)
  })

  test('foco-no-mesmo-commit-do-aviso', async () => {
    const { f } = abrir()
    f.falharProxima('gestos.alterar', new ErroDePreparacao('rede'))
    const linha = await linhaDe('Mão aberta')
    const regiao = alerta()
    let focoNaHora: Element | null | 'nunca' = 'nunca'
    const observador = new MutationObserver(() => {
      if (regiao.textContent && focoNaHora === 'nunca') focoNaHora = document.activeElement
    })
    observador.observe(regiao, { childList: true, subtree: true, characterData: true })
    fireEvent.click(within(linha).getByRole('button', { name: 'Salvar' }))
    await screen.findByText(NAO_CONCLUIU)
    observador.disconnect()
    expect(focoNaHora).toBe(regiao)
  })
})
