// @vitest-environment jsdom
import { afterEach, describe, test, expect, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Cena } from '../../domains/preparacao/cenas'
import { GESTOS } from '../../domains/preparacao/gestos'
import type { LinhaDoMapa } from '../../domains/preparacao/gestos'
import { ErroDePreparacao } from '../../domains/preparacao/portas'
import { criarFalsosDePreparacao } from '../servicosFalsos'
import { AbaCenas } from './AbaCenas'

afterEach(cleanup)

// Textos fixos da aba (PLA-003, Tarefa 6), repetidos aqui de propósito: mudar um texto na tela derruba o teste.
const NOME_VAZIO = 'Dê um nome à cena.'
const NOME_OBS_VAZIO = 'Informe o nome da cena no OBS.'
const DUPLICADO = 'Já existe uma cena com esse nome no OBS.'
const EM_USO = 'Esta cena está ligada a um gesto. Troque o gesto antes de excluir.'
const MUDOU = 'As cenas ou o seu papel mudaram; conferindo de novo.'
const NAO_CONCLUIU = 'Não foi possível concluir. Tente de novo.'
const DICA = 'Escreva o nome exatamente como está no OBS (maiúsculas e espaços contam)'
const INCLUIDA = 'Cena incluída.'
const SALVA = 'Cena salva.'
const EXCLUIDA = 'Cena excluída.'
const ORDEM = 'Ordem atualizada.'

function cena(id: string, nomeExibicao: string, nomeObs: string, ordem: number): Cena {
  return { id, nomeExibicao, nomeObs, ordem }
}

const GERAL = cena('cena-geral', 'Geral', 'Cena Geral', 0)
const CLOSE = cena('cena-close', 'Close', 'Cena Close', 1)
const CONVIDADO = cena('cena-conv', 'Convidado', 'Cena Convidado', 2)

function mapaCom(gesto: LinhaDoMapa['gesto'], cenaId: string): LinhaDoMapa[] {
  return GESTOS.map((g) =>
    g.gesto === gesto ? { gesto: g.gesto, acao: 'cena' as const, cenaId, somId: null } : { gesto: g.gesto, acao: 'nenhuma' as const, cenaId: null, somId: null },
  )
}

function abrir(inicial: Parameters<typeof criarFalsosDePreparacao>[0] = {}) {
  const f = criarFalsosDePreparacao(inicial)
  const reavaliar = vi.fn()
  // conta as leituras sem mudar o falso (os métodos não usam `this`)
  const listarCenas = vi.fn(f.servicos.cenas.listar)
  f.servicos.cenas.listar = listarCenas
  const tela = render(<AbaCenas servicos={f.servicos} reavaliar={reavaliar} />)
  return { f, reavaliar, listarCenas, ...tela }
}

/** Espera a primeira carga (o botão "Incluir" só fica habilitado com a lista carregada). */
async function carregada() {
  await waitFor(() => expect((screen.getByRole('button', { name: 'Incluir' }) as HTMLButtonElement).disabled).toBe(false))
}

/** A linha da tabela com este nome no OBS. */
async function linhaDe(nomeObs: string): Promise<HTMLElement> {
  const tabela = await screen.findByRole('table')
  const celula = await within(tabela).findByText(nomeObs)
  const linha = celula.closest('tr')
  if (!linha) throw new Error(`sem linha para ${nomeObs}`)
  return linha
}

/** Nomes no OBS na ordem em que a tabela mostra. */
function ordemNaTela(): string[] {
  return within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((tr) => tr.querySelectorAll('td')[2]?.textContent ?? '')
}

function incluir(nomeExibicao: string, nomeObs: string) {
  fireEvent.change(screen.getByLabelText('Nome na tela'), { target: { value: nomeExibicao } })
  fireEvent.change(screen.getByLabelText('Nome no OBS'), { target: { value: nomeObs } })
  fireEvent.click(screen.getByRole('button', { name: 'Incluir' }))
}

/** A região de alerta sempre montada da aba (a de `tabIndex={-1}`). */
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

describe('aba Cenas', () => {
  test('lista-na-ordem', async () => {
    // a tabela segue o campo `ordem` (o falso devolve fora de ordem)
    abrir({ cenas: [CONVIDADO, GERAL, CLOSE] })
    await linhaDe('Cena Geral')
    expect(ordemNaTela()).toEqual(['Cena Geral', 'Cena Close', 'Cena Convidado'])
    const cabecalhos = within(screen.getByRole('table')).getAllByRole('columnheader').map((th) => th.textContent)
    expect(cabecalhos).toEqual(['Ordem', 'Nome na tela', 'Nome no OBS', 'Ações'])
    expect(screen.getByText(DICA)).toBeTruthy()
  })

  test('inclui-cena', async () => {
    const { f } = abrir({ cenas: [GERAL, CLOSE] })
    await carregada()
    // nome no OBS com espaço no fim é gravado como digitado; nome na tela, aparado
    incluir('  Plateia  ', 'Cena Plateia ')
    expect(await screen.findByText(INCLUIDA)).toBeTruthy()
    expect(f.chamadas.cenas).toEqual([['incluir', { nomeExibicao: 'Plateia', nomeObs: 'Cena Plateia ', ordem: 2 }]])
    await linhaDe('Cena Plateia')
    expect((screen.getByLabelText('Nome na tela') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Nome no OBS') as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(screen.getByLabelText('Nome na tela'))
  })

  test('recusas-locais', async () => {
    const { f } = abrir({ cenas: [GERAL] })
    await carregada()
    incluir('   ', 'Cena X')
    expect(await screen.findByText(NOME_VAZIO)).toBeTruthy()
    expect(document.activeElement).toBe(alerta())
    incluir('X', '   ')
    expect(await screen.findByText(NOME_OBS_VAZIO)).toBeTruthy()
    expect(f.chamadas.cenas).toEqual([])
  })

  test('nome-obs-duplicado-local', async () => {
    const { f } = abrir({ cenas: [GERAL] })
    await carregada()
    incluir('Outra', 'Cena Geral')
    expect(await screen.findByText(DUPLICADO)).toBeTruthy()
    await andar()
    expect(f.chamadas.cenas).toEqual([])
  })

  test('duplicado-do-banco', async () => {
    const { f } = abrir({ cenas: [GERAL] })
    f.falharProxima('cenas.incluir', new ErroDePreparacao('duplicado'))
    await carregada()
    incluir('Nova', 'Cena Nova')
    expect(await screen.findByText(DUPLICADO)).toBeTruthy()
    expect(f.chamadas.cenas).toHaveLength(1)
    expect(document.activeElement).toBe(alerta())
    // o que foi digitado fica, para a pessoa corrigir
    expect((screen.getByLabelText('Nome no OBS') as HTMLInputElement).value).toBe('Cena Nova')
  })

  test('subir-cena', async () => {
    const { f } = abrir({ cenas: [GERAL, CLOSE, CONVIDADO] })
    const linha = await linhaDe('Cena Close')
    const subir = within(linha).getByRole('button', { name: 'Subir' })
    fireEvent.click(subir)
    expect(await screen.findByText(ORDEM)).toBeTruthy()
    // duas chamadas com as ordens trocadas, o resto da linha igual
    expect(f.chamadas.cenas).toEqual([
      ['alterar', 'cena-geral', { nomeExibicao: 'Geral', nomeObs: 'Cena Geral', ordem: 1 }],
      ['alterar', 'cena-close', { nomeExibicao: 'Close', nomeObs: 'Cena Close', ordem: 0 }],
    ])
    await waitFor(() => expect(ordemNaTela()).toEqual(['Cena Close', 'Cena Geral', 'Cena Convidado']))
    // a cena subiu para o topo: "Subir" fica desabilitado e o foco vai para o "Descer" da mesma cena
    const nova = await linhaDe('Cena Close')
    expect((within(nova).getByRole('button', { name: 'Subir' }) as HTMLButtonElement).disabled).toBe(true)
    expect(document.activeElement).toBe(within(nova).getByRole('button', { name: 'Descer' }))
  })

  test('subir-cena-com-empate', async () => {
    // as colunas `ordem` começam com 0: `trocarOrdem` renumera tudo e a tela grava todos os que mudaram
    const { f } = abrir({ cenas: [cena('a', 'A', 'Cena A', 0), cena('b', 'B', 'Cena B', 0), cena('c', 'C', 'Cena C', 0)] })
    const linha = await linhaDe('Cena C')
    fireEvent.click(within(linha).getByRole('button', { name: 'Subir' }))
    expect(await screen.findByText(ORDEM)).toBeTruthy()
    expect(f.chamadas.cenas).toEqual([
      ['alterar', 'c', { nomeExibicao: 'C', nomeObs: 'Cena C', ordem: 1 }],
      ['alterar', 'b', { nomeExibicao: 'B', nomeObs: 'Cena B', ordem: 2 }],
    ])
    await waitFor(() => expect(ordemNaTela()).toEqual(['Cena A', 'Cena C', 'Cena B']))
    // de novo, já sem empate: só o par
    fireEvent.click(within(await linhaDe('Cena A')).getByRole('button', { name: 'Descer' }))
    await waitFor(() => expect(f.chamadas.cenas).toHaveLength(4))
    expect(f.chamadas.cenas.slice(2)).toEqual([
      ['alterar', 'a', { nomeExibicao: 'A', nomeObs: 'Cena A', ordem: 1 }],
      ['alterar', 'c', { nomeExibicao: 'C', nomeObs: 'Cena C', ordem: 0 }],
    ])
    await waitFor(() => expect(ordemNaTela()).toEqual(['Cena C', 'Cena A', 'Cena B']))
  })

  test('descer-na-ponta-desabilitado', async () => {
    abrir({ cenas: [GERAL, CLOSE] })
    const ultima = await linhaDe('Cena Close')
    expect((within(ultima).getByRole('button', { name: 'Descer' }) as HTMLButtonElement).disabled).toBe(true)
    const primeira = await linhaDe('Cena Geral')
    expect((within(primeira).getByRole('button', { name: 'Subir' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('ordem-falha-no-meio-recarrega', async () => {
    const { f, listarCenas, reavaliar } = abrir({ cenas: [GERAL, CLOSE] })
    const alterar = f.servicos.cenas.alterar
    let n = 0
    f.servicos.cenas.alterar = async (id, c) => {
      n++
      if (n === 2) throw new ErroDePreparacao('rede')
      return alterar(id, c)
    }
    const linha = await linhaDe('Cena Close')
    await andar()
    expect(listarCenas).toHaveBeenCalledTimes(1)
    fireEvent.click(within(linha).getByRole('button', { name: 'Subir' }))
    expect(await screen.findByText(NAO_CONCLUIU)).toBeTruthy()
    // a primeira escrita entrou e a segunda não: a lista é recarregada para mostrar o que o banco tem
    await waitFor(() => expect(listarCenas).toHaveBeenCalledTimes(2))
    expect(reavaliar).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(alerta())
  })

  test('editar-cena', async () => {
    const { f } = abrir({ cenas: [GERAL, CLOSE] })
    const linha = await linhaDe('Cena Close')
    fireEvent.click(within(linha).getByRole('button', { name: 'Editar' }))
    const campoTela = within(linha).getByLabelText('Nome na tela de Close') as HTMLInputElement
    expect(document.activeElement).toBe(campoTela)
    fireEvent.change(campoTela, { target: { value: ' Close-up ' } })
    fireEvent.change(within(linha).getByLabelText('Nome no OBS de Close'), { target: { value: 'Cena Geral' } })
    fireEvent.click(within(linha).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(DUPLICADO)).toBeTruthy()
    expect(f.chamadas.cenas).toEqual([])
    fireEvent.change(within(linha).getByLabelText('Nome no OBS de Close'), { target: { value: 'Cena Close ' } })
    fireEvent.click(within(linha).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(SALVA)).toBeTruthy()
    expect(f.chamadas.cenas).toEqual([['alterar', 'cena-close', { nomeExibicao: 'Close-up', nomeObs: 'Cena Close ', ordem: 1 }]])
    const nova = await linhaDe('Cena Close') // o texto da célula é comparado aparado
    await waitFor(() => expect(document.activeElement).toBe(within(nova).getByRole('button', { name: 'Editar' })))
  })

  test('editar-e-cancelar', async () => {
    const { f } = abrir({ cenas: [GERAL] })
    const linha = await linhaDe('Cena Geral')
    fireEvent.click(within(linha).getByRole('button', { name: 'Editar' }))
    fireEvent.change(within(linha).getByLabelText('Nome na tela de Geral'), { target: { value: 'Outro' } })
    fireEvent.click(within(linha).getByRole('button', { name: 'Cancelar' }))
    expect(within(linha).getByText('Geral')).toBeTruthy()
    expect(document.activeElement).toBe(within(linha).getByRole('button', { name: 'Editar' }))
    expect(f.chamadas.cenas).toEqual([])
  })

  test('excluir-cena', async () => {
    const { f } = abrir({ cenas: [GERAL, CLOSE] })
    const linha = await linhaDe('Cena Close')
    fireEvent.click(within(linha).getByRole('button', { name: 'Excluir' }))
    expect(within(linha).getByText('Não está em uso.')).toBeTruthy()
    expect(document.activeElement).toBe(within(linha).getByRole('button', { name: 'Manter' }))
    fireEvent.click(within(linha).getByRole('button', { name: 'Confirmar exclusão' }))
    expect(await screen.findByText(EXCLUIDA)).toBeTruthy()
    expect(f.chamadas.cenas).toEqual([['remover', 'cena-close']])
    await waitFor(() => expect(screen.queryByText('Cena Close')).toBeNull())
    expect(document.activeElement?.getAttribute('role')).toBe('status')
  })

  test('excluir-cena-em-gesto', async () => {
    const { f } = abrir({ cenas: [GERAL, CLOSE], mapa: mapaCom('Victory', 'cena-close') })
    const linha = await linhaDe('Cena Close')
    fireEvent.click(within(linha).getByRole('button', { name: 'Excluir' }))
    expect(within(linha).getByText('Usada no gesto ✌️')).toBeTruthy()
    expect(within(linha).getByText('Troque o gesto antes de excluir.')).toBeTruthy()
    const confirmar = within(linha).getByRole('button', { name: 'Confirmar exclusão' }) as HTMLButtonElement
    expect(confirmar.disabled).toBe(true)
    fireEvent.click(confirmar)
    await andar()
    expect(f.chamadas.cenas).toEqual([])
    fireEvent.click(within(linha).getByRole('button', { name: 'Manter' }))
    expect(document.activeElement).toBe(within(linha).getByRole('button', { name: 'Excluir' }))
  })

  test('em-uso-do-banco', async () => {
    const { f, listarCenas } = abrir({ cenas: [GERAL] })
    f.falharProxima('cenas.remover', new ErroDePreparacao('em_uso'))
    const linha = await linhaDe('Cena Geral')
    await andar()
    fireEvent.click(within(linha).getByRole('button', { name: 'Excluir' }))
    fireEvent.click(within(linha).getByRole('button', { name: 'Confirmar exclusão' }))
    expect(await screen.findByText(EM_USO)).toBeTruthy()
    expect(f.chamadas.cenas).toEqual([['remover', 'cena-geral']])
    // o gesto pode ter sido ligado em outra aba ou por outra pessoa: a lista (e o mapa) é recarregada
    await waitFor(() => expect(listarCenas).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Cena Geral')).toBeTruthy()
    expect(document.activeElement).toBe(alerta())
    // a confirmação fecha quando a exclusão falha: "Excluir" volta
    expect(within(linha).queryByRole('button', { name: 'Confirmar exclusão' })).toBeNull()
    expect(within(linha).getByRole('button', { name: 'Excluir' })).toBeTruthy()
  })

  test('cena-com-html-literal', async () => {
    const nome = '<img src=x onerror=alert(1)>'
    const { container } = abrir({ cenas: [cena('h', nome, `${nome} OBS`, 0)] })
    const linha = await linhaDe(`${nome} OBS`)
    expect(within(linha).getByText(nome)).toBeTruthy()
    expect(container.querySelector('img[src="x"]')).toBeNull()
    fireEvent.click(within(linha).getByRole('button', { name: 'Editar' }))
    expect((within(linha).getByLabelText(`Nome na tela de ${nome}`) as HTMLInputElement).value).toBe(nome)
    expect(container.querySelector('img[src="x"]')).toBeNull()
  })

  test('escrita-negada-reavalia', async () => {
    const { f, reavaliar, listarCenas } = abrir({ cenas: [GERAL] })
    f.falharProxima('cenas.alterar', new ErroDePreparacao('nada_alterado'))
    const linha = await linhaDe('Cena Geral')
    await andar()
    fireEvent.click(within(linha).getByRole('button', { name: 'Editar' }))
    fireEvent.click(within(linha).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(MUDOU)).toBeTruthy()
    expect(reavaliar).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(listarCenas).toHaveBeenCalledTimes(2))
    expect(document.activeElement).toBe(alerta())
  })

  test('sessao-expirada-na-escrita', async () => {
    const { f, reavaliar, listarCenas } = abrir({ cenas: [GERAL] })
    f.falharProxima('cenas.incluir', new ErroDePreparacao('sessao_expirada'))
    await carregada()
    await andar()
    expect(listarCenas).toHaveBeenCalledTimes(1)
    incluir('Nova', 'Cena Nova')
    await waitFor(() => expect(reavaliar).toHaveBeenCalledTimes(1))
    await andar()
    expect(reavaliar).toHaveBeenCalledTimes(1)
    // só `reavaliar()`: nenhuma mensagem (nem a genérica) e nenhuma recarga (a leitura também falharia)
    expect(alerta().textContent).toBe('')
    expect(screen.getAllByRole('status').find((r) => r.getAttribute('tabindex') === '-1')!.textContent).toBe('')
    expect(listarCenas).toHaveBeenCalledTimes(1)
  })

  test('nome-obs-longo-gravado-inteiro', async () => {
    // o nome no OBS nunca é cortado: os campos não têm `maxLength` e o texto colado vai inteiro
    const { f } = abrir({ cenas: [GERAL] })
    await carregada()
    const nomeObs = `Cena ${'muito comprida '.repeat(10)}fim `
    const nomeTela = 'Nome '.repeat(20).trim()
    expect(nomeObs.length).toBeGreaterThan(120)
    expect(screen.getByLabelText('Nome no OBS').getAttribute('maxlength')).toBeNull()
    expect(screen.getByLabelText('Nome na tela').getAttribute('maxlength')).toBeNull()
    incluir(nomeTela, nomeObs)
    expect(await screen.findByText(INCLUIDA)).toBeTruthy()
    expect(f.chamadas.cenas).toEqual([['incluir', { nomeExibicao: nomeTela, nomeObs, ordem: 1 }]])
    const linha = await linhaDe('Cena Geral')
    fireEvent.click(within(linha).getByRole('button', { name: 'Editar' }))
    expect(within(linha).getByLabelText('Nome no OBS de Geral').getAttribute('maxlength')).toBeNull()
    expect(within(linha).getByLabelText('Nome na tela de Geral').getAttribute('maxlength')).toBeNull()
  })

  test('enter-salva-a-edicao', async () => {
    const { f } = abrir({ cenas: [GERAL] })
    const linha = await linhaDe('Cena Geral')
    fireEvent.click(within(linha).getByRole('button', { name: 'Editar' }))
    const campo = within(linha).getByLabelText('Nome no OBS de Geral')
    fireEvent.change(campo, { target: { value: 'Cena Geral 2' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    expect(await screen.findByText(SALVA)).toBeTruthy()
    expect(f.chamadas.cenas).toEqual([['alterar', 'cena-geral', { nomeExibicao: 'Geral', nomeObs: 'Cena Geral 2', ordem: 0 }]])
    // Esc cancela sem gravar
    const nova = await linhaDe('Cena Geral 2')
    await waitFor(() => expect((within(nova).getByRole('button', { name: 'Editar' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(within(nova).getByRole('button', { name: 'Editar' }))
    fireEvent.keyDown(within(nova).getByLabelText('Nome na tela de Geral'), { key: 'Escape' })
    expect(document.activeElement).toBe(within(nova).getByRole('button', { name: 'Editar' }))
    expect(f.chamadas.cenas).toHaveLength(1)
  })

  test('editar-outra-linha-nao-descarta', async () => {
    // com uma edição aberta, "Editar" das outras linhas fica desabilitado (a edição não some sem aviso)
    abrir({ cenas: [GERAL, CLOSE] })
    const geral = await linhaDe('Cena Geral')
    fireEvent.click(within(geral).getByRole('button', { name: 'Editar' }))
    fireEvent.change(within(geral).getByLabelText('Nome na tela de Geral'), { target: { value: 'Geral alterado' } })
    const close = await linhaDe('Cena Close')
    const editarClose = within(close).getByRole('button', { name: 'Editar' }) as HTMLButtonElement
    expect(editarClose.disabled).toBe(true)
    fireEvent.click(editarClose)
    expect((within(geral).getByLabelText('Nome na tela de Geral') as HTMLInputElement).value).toBe('Geral alterado')
    expect(within(close).queryByLabelText('Nome na tela de Close')).toBeNull()
    fireEvent.click(within(geral).getByRole('button', { name: 'Cancelar' }))
    expect(editarClose.disabled).toBe(false)
  })

  test('falha-ao-carregar', async () => {
    const f = criarFalsosDePreparacao({ cenas: [GERAL] })
    f.falharProxima('cenas.listar', new ErroDePreparacao('sessao_expirada'))
    const reavaliar = vi.fn()
    render(<AbaCenas servicos={f.servicos} reavaliar={reavaliar} />)
    expect(await screen.findByText('Não foi possível carregar as cenas.')).toBeTruthy()
    expect(reavaliar).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: 'Incluir' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await linhaDe('Cena Geral')).toBeTruthy()
  })

  test('clique-duplo-nao-duplica', async () => {
    const { f } = abrir()
    await carregada()
    fireEvent.change(screen.getByLabelText('Nome na tela'), { target: { value: 'Geral' } })
    fireEvent.change(screen.getByLabelText('Nome no OBS'), { target: { value: 'Cena Geral' } })
    const formulario = screen.getByRole('button', { name: 'Incluir' }).closest('form')!
    // os dois envios no mesmo `act`: o React não renderiza entre eles, então o botão ainda não está desabilitado
    act(() => {
      fireEvent.submit(formulario)
      fireEvent.submit(formulario)
    })
    expect(await screen.findByText(INCLUIDA)).toBeTruthy()
    expect(f.chamadas.cenas).toHaveLength(1)
  })

  test('avisos-sempre-montados', async () => {
    abrir()
    await carregada()
    expect(screen.getAllByRole('status').some((r) => r.getAttribute('tabindex') === '-1')).toBe(true)
    expect(screen.getAllByRole('alert').some((r) => r.getAttribute('tabindex') === '-1')).toBe(true)
  })

  test('foco-no-mesmo-commit-do-aviso', async () => {
    // lê o foco no instante em que o texto entra na região de alerta: prova o `useLayoutEffect`
    const { f } = abrir({ cenas: [GERAL] })
    f.falharProxima('cenas.alterar', new ErroDePreparacao('rede'))
    const linha = await linhaDe('Cena Geral')
    fireEvent.click(within(linha).getByRole('button', { name: 'Editar' }))
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
