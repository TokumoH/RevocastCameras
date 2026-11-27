// @vitest-environment jsdom
import { afterEach, describe, test, expect, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Aviso, Episodio } from '../../domains/preparacao/episodios'
import type { Midia } from '../../domains/preparacao/midia'
import { ErroDePreparacao } from '../../domains/preparacao/portas'
import { criarFalsosDePreparacao, usuarioGoogle } from '../servicosFalsos'
import { AbaEpisodios } from './AbaEpisodios'

afterEach(cleanup)

// Textos fixos da aba (PLA-003, Tarefa 7), repetidos aqui de propósito: mudar um texto na tela derruba o teste.
const TITULO_VAZIO = 'Dê um título.'
const TITULO_LONGO = 'Título com até 120 caracteres.'
const DATA_INVALIDA = 'Data inválida.'
const LINK_INVALIDO = 'O link precisa começar com https://.'
const DURACAO_INVALIDA = 'Duração entre 1 e 600 segundos.'
const IMAGEM_INEXISTENTE = 'Essa imagem não está mais na Biblioteca.'
const AO_VIVO_DUPLICADO = 'Já existe um episódio ao vivo.'
const MUDOU = 'Os episódios ou o seu papel mudaram; conferindo de novo.'
const NAO_CONCLUIU = 'Não foi possível concluir. Tente de novo.'
const NOTA_E3 = 'Iniciar e encerrar o ao vivo chegam na etapa E3.'
const SO_RASCUNHO = 'Só rascunhos podem ser excluídos.'
const CRIADO = 'Episódio criado.'
const SALVO = 'Episódio salvo.'
const EXCLUIDO = 'Episódio excluído.'
const AVISO_INCLUIDO = 'Aviso incluído.'
const AVISO_SALVO = 'Aviso salvo.'
const AVISO_EXCLUIDO = 'Aviso excluído.'
const ORDEM = 'Ordem atualizada.'
const SEM_IMAGEM = 'Sem imagem'

const ID_USUARIO = 'id-equipe'
const ID_IMAGEM = '22222222-2222-4222-8222-222222222222'
const ID_SOM = '11111111-1111-4111-8111-111111111111'

const RASCUNHO: Episodio = { id: 'ep-1', titulo: 'Episódio 1', data: '2026-11-20', estado: 'rascunho' }
const AO_VIVO: Episodio = { id: 'ep-2', titulo: 'Episódio 2', data: '2026-11-25', estado: 'ao_vivo' }
const ENCERRADO: Episodio = { id: 'ep-3', titulo: 'Episódio 0', data: '2026-11-10', estado: 'encerrado' }

function midia(id: string, tipo: 'som' | 'imagem', nome: string): Midia {
  return { id, tipo, nome, caminho: `${tipo}/${id}.${tipo === 'som' ? 'mp3' : 'png'}`, mime: tipo === 'som' ? 'audio/mpeg' : 'image/png', tamanhoBytes: 1_000, enviadoPor: null }
}

const IMAGEM = midia(ID_IMAGEM, 'imagem', 'capa.png')
const SOM = midia(ID_SOM, 'som', 'aplauso.mp3')

function aviso(id: string, titulo: string, ordem: number, extra: Partial<Aviso> = {}): Aviso {
  return { id, episodioId: RASCUNHO.id, titulo, texto: '', link: null, imagemMidiaId: null, duracaoS: 10, ordem, ...extra }
}

function abrir(inicial: Parameters<typeof criarFalsosDePreparacao>[0] = {}) {
  const f = criarFalsosDePreparacao(inicial)
  const reavaliar = vi.fn()
  // conta as leituras sem mudar o falso (os métodos não usam `this`)
  const listarEpisodios = vi.fn(f.servicos.episodios.listar)
  f.servicos.episodios.listar = listarEpisodios
  const listarAvisos = vi.fn(f.servicos.episodios.listarAvisos)
  f.servicos.episodios.listarAvisos = listarAvisos
  const usuario = usuarioGoogle('equipe@revocast.test', ID_USUARIO)
  const tela = render(<AbaEpisodios servicos={f.servicos} usuario={usuario} reavaliar={reavaliar} />)
  return { f, reavaliar, listarEpisodios, listarAvisos, ...tela }
}

/** Espera a primeira carga (o botão "Criar episódio" só fica habilitado com a lista carregada). */
async function carregada() {
  await waitFor(() => expect((screen.getByRole('button', { name: 'Criar episódio' }) as HTMLButtonElement).disabled).toBe(false))
}

async function linhaDe(titulo: string): Promise<HTMLElement> {
  const tabela = await screen.findByRole('table')
  const celula = await within(tabela).findByText(titulo)
  const linha = celula.closest('tr')
  if (!linha) throw new Error(`sem linha para ${titulo}`)
  return linha
}

/** Abre o episódio pela lista e espera os avisos carregarem (o formulário de aviso só fica habilitado depois). */
async function abrirEpisodio(titulo: string) {
  fireEvent.click(within(await linhaDe(titulo)).getByRole('button', { name: 'Abrir' }))
  await waitFor(() => expect((screen.getByRole('button', { name: 'Incluir aviso' }) as HTMLButtonElement).disabled).toBe(false))
}

function listaDeAvisos(): HTMLElement {
  return screen.getByRole('list', { name: 'Avisos do episódio' })
}

async function cartaoDe(titulo: string): Promise<HTMLElement> {
  const lista = await screen.findByRole('list', { name: 'Avisos do episódio' })
  const texto = await within(lista).findByText(titulo)
  const cartao = texto.closest('li')
  if (!cartao) throw new Error(`sem cartão para ${titulo}`)
  return cartao
}

function titulosDosAvisos(): string[] {
  return within(listaDeAvisos())
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.aviso-cartao__titulo')?.textContent ?? '')
}

function preencherAviso(campos: { titulo?: string; texto?: string; link?: string; imagem?: string; duracao?: string }) {
  if (campos.titulo !== undefined) fireEvent.change(screen.getByLabelText('Título do aviso'), { target: { value: campos.titulo } })
  if (campos.texto !== undefined) fireEvent.change(screen.getByLabelText('Texto'), { target: { value: campos.texto } })
  if (campos.link !== undefined) fireEvent.change(screen.getByLabelText('Link'), { target: { value: campos.link } })
  if (campos.imagem !== undefined) fireEvent.change(screen.getByLabelText('Imagem'), { target: { value: campos.imagem } })
  if (campos.duracao !== undefined) fireEvent.change(screen.getByLabelText('Duração (segundos)'), { target: { value: campos.duracao } })
}

function alerta(): HTMLElement {
  const regiao = screen.getAllByRole('alert').find((r) => r.getAttribute('tabindex') === '-1')
  if (!regiao) throw new Error('sem região de alerta')
  return regiao
}

function status(): HTMLElement {
  const regiao = screen.getAllByRole('status').find((r) => r.getAttribute('tabindex') === '-1')
  if (!regiao) throw new Error('sem região de status')
  return regiao
}

async function andar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

function hojeLocal(): string {
  const d = new Date()
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('aba Episódios', () => {
  test('lista-com-estados', async () => {
    // mais recente primeiro (pela data), com o rótulo do estado
    abrir({ episodios: [ENCERRADO, RASCUNHO, AO_VIVO] })
    await linhaDe('Episódio 1')
    const linhas = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(linhas.map((tr) => [...tr.querySelectorAll('td')].slice(0, 3).map((td) => td.textContent))).toEqual([
      ['Episódio 2', '25/11/2026', 'Ao vivo'],
      ['Episódio 1', '20/11/2026', 'Rascunho'],
      ['Episódio 0', '10/11/2026', 'Encerrado'],
    ])
  })

  test('cria-episodio', async () => {
    const { f } = abrir()
    await carregada()
    // a data começa em hoje (data local)
    expect((screen.getByLabelText('Data') as HTMLInputElement).value).toBe(hojeLocal())
    expect(screen.getByLabelText('Data').getAttribute('type')).toBe('date')
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: '  Revoada de dezembro  ' } })
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-12-04' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar episódio' }))
    expect(await screen.findByText(CRIADO)).toBeTruthy()
    expect(f.chamadas.episodios).toEqual([['incluir', { titulo: 'Revoada de dezembro', data: '2026-12-04', criadoPor: ID_USUARIO }]])
    expect(await linhaDe('Revoada de dezembro')).toBeTruthy()
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(screen.getByLabelText('Título'))
  })

  test('recusas-do-episodio', async () => {
    const { f } = abrir()
    await carregada()
    // sem `maxLength`: o título longo chega ao domínio e é recusado com mensagem (nunca cortado em silêncio)
    expect(screen.getByLabelText('Título').getAttribute('maxlength')).toBeNull()
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar episódio' }))
    expect(await screen.findByText(TITULO_VAZIO)).toBeTruthy()
    expect(document.activeElement).toBe(alerta())
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'x'.repeat(121) } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar episódio' }))
    expect(await screen.findByText(TITULO_LONGO)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Ok' } })
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar episódio' }))
    expect(await screen.findByText(DATA_INVALIDA)).toBeTruthy()
    await andar()
    expect(f.chamadas.episodios).toEqual([])
  })

  test('edita-so-titulo-e-data', async () => {
    const { f } = abrir({ episodios: [AO_VIVO] })
    await abrirEpisodio('Episódio 2')
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: ' Episódio 2 (ao vivo) ' } })
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-11-26' } })
    // Enter num campo salva (o formulário tem um botão de envio)
    fireEvent.submit(screen.getByLabelText('Título').closest('form')!)
    expect(await screen.findByText(SALVO)).toBeTruthy()
    // só título e data, mesmo num episódio ao vivo: nunca `estado` nem `gestos_ligados` (D2)
    expect(f.chamadas.episodios).toEqual([['alterar', 'ep-2', { titulo: 'Episódio 2 (ao vivo)', data: '2026-11-26' }]])
    const [, , enviado] = f.chamadas.episodios[0] as [string, string, Record<string, unknown>]
    expect(Object.keys(enviado).sort()).toEqual(['data', 'titulo'])
    expect(document.activeElement).toBe(status())
  })

  test('excluir-so-rascunho', async () => {
    const { f } = abrir({ episodios: [RASCUNHO, AO_VIVO, ENCERRADO], avisos: [aviso('a1', 'Inscrições', 0), aviso('a2', 'Festa', 1)] })
    for (const titulo of ['Episódio 2', 'Episódio 0']) {
      await abrirEpisodio(titulo)
      expect(screen.queryByRole('button', { name: 'Excluir episódio' })).toBeNull()
      expect(screen.getByText(SO_RASCUNHO)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
      // o foco volta para o "Abrir" do episódio fechado
      expect(document.activeElement).toBe(within(await linhaDe(titulo)).getByRole('button', { name: 'Abrir' }))
    }
    await abrirEpisodio('Episódio 1')
    expect(screen.queryByText(SO_RASCUNHO)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Excluir episódio' }))
    expect(screen.getByText('Excluir o episódio e os seus 2 avisos?')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Manter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Manter' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Excluir episódio' }))
    expect(f.chamadas.episodios).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Excluir episódio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    expect(await screen.findByText(EXCLUIDO)).toBeTruthy()
    expect(f.chamadas.episodios).toEqual([['remover', 'ep-1']])
    // volta para a lista, sem o episódio excluído; foco na região de status
    await waitFor(() => expect(screen.queryByText('Episódio 1')).toBeNull())
    expect(await linhaDe('Episódio 2')).toBeTruthy()
    expect(document.activeElement).toBe(status())
  })

  test('ao-vivo-fica-para-e3', async () => {
    const { f } = abrir({ episodios: [RASCUNHO, AO_VIVO] })
    await linhaDe('Episódio 1')
    expect(screen.getByText(NOTA_E3)).toBeTruthy()
    const semAoVivo = () => {
      expect(screen.queryByRole('button', { name: /iniciar/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /encerrar/i })).toBeNull()
      // nenhum controle escolhe o estado (nem seletor, nem caixa)
      expect(screen.queryByRole('combobox', { name: /estado/i })).toBeNull()
      expect(screen.queryByRole('checkbox')).toBeNull()
    }
    semAoVivo()
    await abrirEpisodio('Episódio 1')
    semAoVivo()
    expect(screen.getByText(NOTA_E3)).toBeTruthy()
    expect(screen.getByText('Rascunho')).toBeTruthy()
    // salvar o rascunho não leva estado (dois `ao_vivo` ao mesmo tempo seriam recusados pelo banco; a aba nem tenta)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(SALVO)).toBeTruthy()
    expect(JSON.stringify(f.chamadas.episodios)).not.toContain('estado')
  })

  test('duplicado-ao-vivo-do-banco', async () => {
    // só se o estado mudou por fora (a aba não muda estado): a mensagem fixa, sem a do servidor
    const { f } = abrir({ episodios: [AO_VIVO] })
    f.falharProxima('episodios.alterar', new ErroDePreparacao('duplicado'))
    await abrirEpisodio('Episódio 2')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(AO_VIVO_DUPLICADO)).toBeTruthy()
    expect(document.activeElement).toBe(alerta())
  })

  test('aviso-com-html-literal', async () => {
    const { container } = abrir({ episodios: [RASCUNHO], avisos: [aviso('a1', '<b>x</b>', 0, { texto: '<script>alert(1)</script>\nsegunda linha' })] })
    await abrirEpisodio('Episódio 1')
    const cartao = await cartaoDe('<b>x</b>')
    const texto = cartao.querySelector('.aviso-cartao__texto')!
    // o texto vai como texto, com a quebra de linha preservada (CSS `white-space: pre-line`), nunca como HTML
    expect(texto.textContent).toBe('<script>alert(1)</script>\nsegunda linha')
    expect(container.querySelector('script, b')).toBeNull()
    fireEvent.click(within(cartao).getByRole('button', { name: 'Editar' }))
    expect((screen.getByLabelText('Título do aviso') as HTMLInputElement).value).toBe('<b>x</b>')
    expect(screen.getByLabelText('Texto').tagName).toBe('TEXTAREA')
    expect(container.querySelector('script, b')).toBeNull()
  })

  test('link-recusado', async () => {
    const { f } = abrir({ episodios: [RASCUNHO] })
    await abrirEpisodio('Episódio 1')
    for (const link of ['javascript:alert(1)', 'http://revocast.test/inscricao']) {
      preencherAviso({ titulo: 'Inscrições', link })
      fireEvent.click(screen.getByRole('button', { name: 'Incluir aviso' }))
      expect(await screen.findByText(LINK_INVALIDO)).toBeTruthy()
      expect(document.activeElement).toBe(alerta())
      await andar()
    }
    expect(f.chamadas.avisos).toEqual([])
  })

  test('link-aceito-vira-ancora', async () => {
    const { f, container } = abrir({ episodios: [RASCUNHO], avisos: [aviso('a0', 'Antigo', 0, { link: 'http://x' })] })
    await abrirEpisodio('Episódio 1')
    // link salvo por fora fora do formato: mostrado como texto, sem `<a>`
    const antigo = await cartaoDe('Antigo')
    expect(within(antigo).getByText('http://x')).toBeTruthy()
    expect(antigo.querySelector('a')).toBeNull()
    preencherAviso({ titulo: 'Inscrições', link: ' https://revocast.test/inscricao ' })
    fireEvent.click(screen.getByRole('button', { name: 'Incluir aviso' }))
    expect(await screen.findByText(AVISO_INCLUIDO)).toBeTruthy()
    expect(f.chamadas.avisos).toEqual([
      ['incluir', { episodioId: 'ep-1', titulo: 'Inscrições', texto: '', link: 'https://revocast.test/inscricao', imagemMidiaId: null, duracaoS: 10, ordem: 1 }],
    ])
    const cartao = await cartaoDe('Inscrições')
    const ancora = within(cartao).getByRole('link', { name: 'https://revocast.test/inscricao' })
    expect(ancora.getAttribute('href')).toBe('https://revocast.test/inscricao')
    expect(ancora.getAttribute('target')).toBe('_blank')
    expect(ancora.getAttribute('rel')).toBe('noopener noreferrer')
    expect(container.querySelectorAll('a')).toHaveLength(1)
    // foco no título do formulário, para o próximo aviso
    expect(document.activeElement).toBe(screen.getByLabelText('Título do aviso'))
  })

  test('links-salvos-por-fora', async () => {
    // salvos antes por fora: só o que `normalizarLink` aceita vira `<a>`, com o valor normalizado no `href`
    const { container } = abrir({
      episodios: [RASCUNHO],
      avisos: [
        aviso('a1', 'Data', 0, { link: 'data:text/html,<b>x</b>' }),
        aviso('a2', 'Maiúsculas', 1, { link: 'HTTPS://Revocast.test/Inscricao' }),
        aviso('a3', 'Script', 2, { link: 'JAVASCRIPT:alert(1)' }),
      ],
    })
    await abrirEpisodio('Episódio 1')
    const data = await cartaoDe('Data')
    expect(data.querySelector('a')).toBeNull()
    expect(within(data).getByText('data:text/html,<b>x</b>')).toBeTruthy()
    const script = await cartaoDe('Script')
    expect(script.querySelector('a')).toBeNull()
    expect(within(script).getByText('JAVASCRIPT:alert(1)')).toBeTruthy()
    const maiusculas = await cartaoDe('Maiúsculas')
    const ancora = within(maiusculas).getByRole('link', { name: 'https://revocast.test/Inscricao' })
    expect(ancora.getAttribute('href')).toBe('https://revocast.test/Inscricao')
    expect(ancora.getAttribute('target')).toBe('_blank')
    expect(ancora.getAttribute('rel')).toBe('noopener noreferrer')
    expect(container.querySelectorAll('a')).toHaveLength(1)
    expect(container.querySelector('b, [href^="data:"], [href^="javascript:" i]')).toBeNull()
  })

  test('aviso-com-imagem', async () => {
    const { f } = abrir({ episodios: [RASCUNHO], midias: [SOM, IMAGEM] })
    await abrirEpisodio('Episódio 1')
    const seletor = screen.getByLabelText('Imagem') as HTMLSelectElement
    // só imagens no seletor, nenhum som
    expect([...seletor.options].map((o) => [o.value, o.textContent])).toEqual([
      ['', 'Sem imagem'],
      [ID_IMAGEM, 'capa.png'],
    ])
    preencherAviso({ titulo: 'Com capa', imagem: ID_IMAGEM })
    fireEvent.click(screen.getByRole('button', { name: 'Incluir aviso' }))
    expect(await screen.findByText(AVISO_INCLUIDO)).toBeTruthy()
    expect(f.chamadas.avisos).toEqual([['incluir', expect.objectContaining({ titulo: 'Com capa', imagemMidiaId: ID_IMAGEM })]])
    // a miniatura só é pedida no clique
    const cartao = await cartaoDe('Com capa')
    expect(within(cartao).getByText('capa.png')).toBeTruthy()
    expect(f.chamadas.previa).toEqual([])
    expect(cartao.querySelector('img')).toBeNull()
    const ver = within(cartao).getByRole('button', { name: 'Ver imagem' })
    fireEvent.click(ver)
    const img = await within(cartao).findByRole('img', { name: 'capa.png' })
    expect(img.getAttribute('src')).toBe(`https://armazenamento.revocast.test/assinada/imagem/${ID_IMAGEM}.png?token=teste`)
    expect(f.chamadas.previa).toEqual([`imagem/${ID_IMAGEM}.png`])
    expect(within(cartao).getByRole('button', { name: 'Ocultar imagem' })).toBe(ver)
  })

  test('previa-com-url-recusada', async () => {
    const { f, container } = abrir({ episodios: [RASCUNHO], midias: [IMAGEM], avisos: [aviso('a1', 'Com capa', 0, { imagemMidiaId: ID_IMAGEM })] })
    f.servicos.armazenamento.urlDePrevia = async () => 'javascript:alert(1)'
    await abrirEpisodio('Episódio 1')
    const cartao = await cartaoDe('Com capa')
    fireEvent.click(within(cartao).getByRole('button', { name: 'Ver imagem' }))
    expect(await screen.findByText(NAO_CONCLUIU)).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[src^="javascript"]')).toBeNull()
  })

  test('imagem-apagada-mostra-sem-imagem', async () => {
    // a imagem saiu da Biblioteca (o banco põe nulo; aqui, um id que a lista de mídias não tem mais): o cartão não quebra
    const { f } = abrir({
      episodios: [RASCUNHO],
      midias: [IMAGEM],
      avisos: [aviso('a1', 'Sem capa', 0), aviso('a2', 'Capa apagada', 1, { imagemMidiaId: '33333333-3333-4333-8333-333333333333' })],
    })
    await abrirEpisodio('Episódio 1')
    expect(within(await cartaoDe('Sem capa')).getByText(SEM_IMAGEM)).toBeTruthy()
    const apagada = await cartaoDe('Capa apagada')
    expect(within(apagada).getByText(SEM_IMAGEM)).toBeTruthy()
    expect(within(apagada).queryByRole('button', { name: 'Ver imagem' })).toBeNull()
    // ao editar, o seletor volta para "Sem imagem" (a imagem não existe mais)
    fireEvent.click(within(apagada).getByRole('button', { name: 'Editar' }))
    expect((screen.getByLabelText('Imagem') as HTMLSelectElement).value).toBe('')
    expect(f.chamadas.previa).toEqual([])
  })

  test('imagem-inexistente-do-banco', async () => {
    // a imagem foi apagada entre a carga e o "Incluir": a chave estrangeira (`23503` → `em_uso`) vira a mensagem da imagem e a aba recarrega
    const { f, listarAvisos } = abrir({ episodios: [RASCUNHO], midias: [IMAGEM] })
    f.falharProxima('episodios.incluirAviso', new ErroDePreparacao('em_uso'))
    await abrirEpisodio('Episódio 1')
    expect(listarAvisos).toHaveBeenCalledTimes(1)
    preencherAviso({ titulo: 'Com capa', imagem: ID_IMAGEM })
    fireEvent.click(screen.getByRole('button', { name: 'Incluir aviso' }))
    expect(await screen.findByText(IMAGEM_INEXISTENTE)).toBeTruthy()
    await waitFor(() => expect(listarAvisos).toHaveBeenCalledTimes(2))
    expect(document.activeElement).toBe(alerta())
  })

  test('ordem-dos-avisos', async () => {
    const { f } = abrir({ episodios: [RASCUNHO], avisos: [aviso('a1', 'Primeiro', 0), aviso('a2', 'Segundo', 1), aviso('a3', 'Terceiro', 2)] })
    await abrirEpisodio('Episódio 1')
    expect(titulosDosAvisos()).toEqual(['Primeiro', 'Segundo', 'Terceiro'])
    fireEvent.click(within(await cartaoDe('Segundo')).getByRole('button', { name: 'Subir' }))
    expect(await screen.findByText(ORDEM)).toBeTruthy()
    expect(f.chamadas.avisos).toEqual([
      ['ordem', 'a1', 1],
      ['ordem', 'a2', 0],
    ])
    await waitFor(() => expect(titulosDosAvisos()).toEqual(['Segundo', 'Primeiro', 'Terceiro']))
    // o aviso subiu para o topo: "Subir" desabilitado e o foco no "Descer" do mesmo aviso
    const segundo = await cartaoDe('Segundo')
    expect((within(segundo).getByRole('button', { name: 'Subir' }) as HTMLButtonElement).disabled).toBe(true)
    expect(document.activeElement).toBe(within(segundo).getByRole('button', { name: 'Descer' }))
  })

  test('ordem-dos-avisos-com-empate', async () => {
    // `ordem` padrão 0: `trocarOrdem` renumera tudo; a aba grava só os avisos cuja ordem mudou
    const { f } = abrir({ episodios: [RASCUNHO], avisos: [aviso('a', 'A', 0), aviso('b', 'B', 0), aviso('c', 'C', 0)] })
    await abrirEpisodio('Episódio 1')
    fireEvent.click(within(await cartaoDe('C')).getByRole('button', { name: 'Subir' }))
    expect(await screen.findByText(ORDEM)).toBeTruthy()
    expect(f.chamadas.avisos).toEqual([
      ['ordem', 'c', 1],
      ['ordem', 'b', 2],
    ])
    await waitFor(() => expect(titulosDosAvisos()).toEqual(['A', 'C', 'B']))
  })

  test('ordem-falha-no-meio-recarrega', async () => {
    const { f, listarAvisos } = abrir({ episodios: [RASCUNHO], avisos: [aviso('a1', 'Primeiro', 0), aviso('a2', 'Segundo', 1)] })
    f.falharProxima('episodios.alterarOrdemDoAviso', new ErroDePreparacao('rede'))
    await abrirEpisodio('Episódio 1')
    fireEvent.click(within(await cartaoDe('Segundo')).getByRole('button', { name: 'Subir' }))
    expect(await screen.findByText(NAO_CONCLUIU)).toBeTruthy()
    await waitFor(() => expect(listarAvisos).toHaveBeenCalledTimes(2))
    expect(document.activeElement).toBe(alerta())
  })

  test('duracao-padrao-10', async () => {
    const { f } = abrir({ episodios: [RASCUNHO] })
    await abrirEpisodio('Episódio 1')
    const duracao = screen.getByLabelText('Duração (segundos)') as HTMLInputElement
    expect(duracao.value).toBe('10')
    for (const valor of ['0', '601', '2.5', '']) {
      preencherAviso({ titulo: 'Aviso', duracao: valor })
      fireEvent.click(screen.getByRole('button', { name: 'Incluir aviso' }))
      expect(await screen.findByText(DURACAO_INVALIDA)).toBeTruthy()
      await andar()
    }
    expect(f.chamadas.avisos).toEqual([])
    preencherAviso({ titulo: 'Aviso', duracao: '600' })
    fireEvent.click(screen.getByRole('button', { name: 'Incluir aviso' }))
    expect(await screen.findByText(AVISO_INCLUIDO)).toBeTruthy()
    expect(f.chamadas.avisos).toEqual([['incluir', expect.objectContaining({ duracaoS: 600 })]])
    // depois de incluir, o formulário volta ao padrão
    await waitFor(() => expect((screen.getByLabelText('Duração (segundos)') as HTMLInputElement).value).toBe('10'))
    expect(within(await cartaoDe('Aviso')).getByText('600 s')).toBeTruthy()
  })

  test('aviso-sem-titulo', async () => {
    const { f } = abrir({ episodios: [RASCUNHO] })
    await abrirEpisodio('Episódio 1')
    preencherAviso({ titulo: '  ', texto: 'Algo' })
    fireEvent.click(screen.getByRole('button', { name: 'Incluir aviso' }))
    expect(await screen.findByText(TITULO_VAZIO)).toBeTruthy()
    await andar()
    expect(f.chamadas.avisos).toEqual([])
  })

  test('editar-aviso', async () => {
    const { f } = abrir({
      episodios: [RASCUNHO],
      midias: [IMAGEM],
      avisos: [aviso('a1', 'Inscrições', 0), aviso('a2', 'Festa', 1, { texto: 'Sábado', link: 'https://revocast.test/festa', imagemMidiaId: ID_IMAGEM, duracaoS: 15 })],
    })
    await abrirEpisodio('Episódio 1')
    const festa = await cartaoDe('Festa')
    fireEvent.click(within(festa).getByRole('button', { name: 'Editar' }))
    expect(document.activeElement).toBe(screen.getByLabelText('Título do aviso'))
    expect((screen.getByLabelText('Texto') as HTMLTextAreaElement).value).toBe('Sábado')
    expect((screen.getByLabelText('Link') as HTMLInputElement).value).toBe('https://revocast.test/festa')
    expect((screen.getByLabelText('Imagem') as HTMLSelectElement).value).toBe(ID_IMAGEM)
    expect((screen.getByLabelText('Duração (segundos)') as HTMLInputElement).value).toBe('15')
    // uma edição por vez: "Editar" dos outros cartões fica desabilitado
    expect((within(await cartaoDe('Inscrições')).getByRole('button', { name: 'Editar' }) as HTMLButtonElement).disabled).toBe(true)
    preencherAviso({ titulo: 'Festa Revoada', texto: 'Sábado\n20h', link: '', imagem: '' })
    // Enter no título salva (envio do formulário)
    fireEvent.submit(screen.getByLabelText('Título do aviso').closest('form')!)
    expect(await screen.findByText(AVISO_SALVO)).toBeTruthy()
    expect(f.chamadas.avisos).toEqual([['alterar', 'a2', { titulo: 'Festa Revoada', texto: 'Sábado\n20h', link: null, imagemMidiaId: null, duracaoS: 15, ordem: 1 }]])
    const nova = await cartaoDe('Festa Revoada')
    await waitFor(() => expect(document.activeElement).toBe(within(nova).getByRole('button', { name: 'Editar' })))
    expect(screen.getByRole('button', { name: 'Incluir aviso' })).toBeTruthy()
  })

  test('editar-aviso-e-cancelar', async () => {
    const { f } = abrir({ episodios: [RASCUNHO], avisos: [aviso('a1', 'Inscrições', 0)] })
    await abrirEpisodio('Episódio 1')
    const cartao = await cartaoDe('Inscrições')
    fireEvent.click(within(cartao).getByRole('button', { name: 'Editar' }))
    preencherAviso({ titulo: 'Outro' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar edição' }))
    expect((screen.getByLabelText('Título do aviso') as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(within(cartao).getByRole('button', { name: 'Editar' }))
    expect(f.chamadas.avisos).toEqual([])
  })

  test('excluir-aviso', async () => {
    const { f } = abrir({ episodios: [RASCUNHO], avisos: [aviso('a1', 'Inscrições', 0), aviso('a2', 'Festa', 1)] })
    await abrirEpisodio('Episódio 1')
    const cartao = await cartaoDe('Festa')
    fireEvent.click(within(cartao).getByRole('button', { name: 'Excluir' }))
    expect(document.activeElement).toBe(within(cartao).getByRole('button', { name: 'Manter' }))
    fireEvent.click(within(cartao).getByRole('button', { name: 'Manter' }))
    expect(document.activeElement).toBe(within(cartao).getByRole('button', { name: 'Excluir' }))
    fireEvent.click(within(cartao).getByRole('button', { name: 'Excluir' }))
    fireEvent.click(within(cartao).getByRole('button', { name: 'Confirmar exclusão' }))
    expect(await screen.findByText(AVISO_EXCLUIDO)).toBeTruthy()
    expect(f.chamadas.avisos).toEqual([['remover', 'a2']])
    await waitFor(() => expect(titulosDosAvisos()).toEqual(['Inscrições']))
    expect(document.activeElement).toBe(status())
  })

  test('escrita-negada-reavalia', async () => {
    const { f, reavaliar, listarEpisodios } = abrir({ episodios: [RASCUNHO] })
    f.falharProxima('episodios.alterar', new ErroDePreparacao('nada_alterado'))
    await abrirEpisodio('Episódio 1')
    await andar()
    const leituras = listarEpisodios.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(MUDOU)).toBeTruthy()
    expect(reavaliar).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(listarEpisodios.mock.calls.length).toBe(leituras + 1))
    expect(document.activeElement).toBe(alerta())
    // o ramo `negado` (a RLS recusou a escrita do aviso): a mesma mensagem, `reavaliar()` e recarga
    await andar()
    f.falharProxima('episodios.incluirAviso', new ErroDePreparacao('negado'))
    preencherAviso({ titulo: 'Negado' })
    fireEvent.click(screen.getByRole('button', { name: 'Incluir aviso' }))
    await waitFor(() => expect(reavaliar).toHaveBeenCalledTimes(2))
    expect(screen.getByText(MUDOU)).toBeTruthy()
    await waitFor(() => expect(listarEpisodios.mock.calls.length).toBe(leituras + 2))
    expect(f.chamadas.avisos).toEqual([['incluir', expect.objectContaining({ titulo: 'Negado' })]])
    expect(document.activeElement).toBe(alerta())
  })

  test('aviso-em-edicao-que-sumiu', async () => {
    // o aviso em edição foi excluído por fora: "Salvar aviso" dá `nada_alterado`; na recarga a edição é desfeita
    const { f, reavaliar } = abrir({ episodios: [RASCUNHO], avisos: [aviso('a1', 'Some', 0), aviso('a2', 'Fica', 1)] })
    await abrirEpisodio('Episódio 1')
    fireEvent.click(within(await cartaoDe('Some')).getByRole('button', { name: 'Editar' }))
    await f.servicos.episodios.removerAviso('a1')
    fireEvent.submit(screen.getByLabelText('Título do aviso').closest('form')!)
    expect(await screen.findByText(MUDOU)).toBeTruthy()
    await waitFor(() => expect(titulosDosAvisos()).toEqual(['Fica']))
    expect(reavaliar).toHaveBeenCalledTimes(1)
    // o formulário volta a "Novo aviso", vazio, e "Editar" volta a ficar habilitado nos cartões
    expect(screen.getByRole('button', { name: 'Incluir aviso' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancelar edição' })).toBeNull()
    expect((screen.getByLabelText('Título do aviso') as HTMLInputElement).value).toBe('')
    expect((within(await cartaoDe('Fica')).getByRole('button', { name: 'Editar' }) as HTMLButtonElement).disabled).toBe(false)
  })

  test('episodio-que-sumiu-fecha', async () => {
    // excluído por fora: na recarga depois do `nada_alterado`, o episódio aberto some e a aba volta à lista
    const { f, listarAvisos } = abrir({ episodios: [RASCUNHO, AO_VIVO] })
    await abrirEpisodio('Episódio 1')
    await f.servicos.episodios.remover('ep-1')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(MUDOU)).toBeTruthy()
    expect(await linhaDe('Episódio 2')).toBeTruthy()
    expect(screen.queryByText('Episódio 1')).toBeNull()
    // o episódio que sumiu deixa de estar aberto: as próximas cargas não leem mais os avisos dele
    const leituras = listarAvisos.mock.calls.length
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Outro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar episódio' }))
    expect(await screen.findByText(CRIADO)).toBeTruthy()
    expect(listarAvisos).toHaveBeenCalledTimes(leituras)
  })

  test('sessao-expirada-na-escrita', async () => {
    const { f, reavaliar, listarEpisodios } = abrir()
    f.falharProxima('episodios.incluir', new ErroDePreparacao('sessao_expirada'))
    await carregada()
    await andar()
    expect(listarEpisodios).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Novo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar episódio' }))
    await waitFor(() => expect(reavaliar).toHaveBeenCalledTimes(1))
    await andar()
    // só `reavaliar()`: nenhuma mensagem (nem a genérica) e nenhuma recarga (a leitura também falharia)
    expect(reavaliar).toHaveBeenCalledTimes(1)
    expect(alerta().textContent).toBe('')
    expect(status().textContent).toBe('')
    expect(listarEpisodios).toHaveBeenCalledTimes(1)
  })

  test('falha-ao-carregar', async () => {
    const f = criarFalsosDePreparacao({ episodios: [RASCUNHO] })
    f.falharProxima('episodios.listar', new ErroDePreparacao('sessao_expirada'))
    const reavaliar = vi.fn()
    render(<AbaEpisodios servicos={f.servicos} usuario={usuarioGoogle('equipe@revocast.test', ID_USUARIO)} reavaliar={reavaliar} />)
    expect(await screen.findByText('Não foi possível carregar os episódios.')).toBeTruthy()
    expect(reavaliar).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: 'Criar episódio' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await linhaDe('Episódio 1')).toBeTruthy()
  })

  test('clique-duplo-nao-duplica', async () => {
    const { f } = abrir({ episodios: [RASCUNHO] })
    await carregada()
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Novo' } })
    const formulario = screen.getByRole('button', { name: 'Criar episódio' }).closest('form')!
    // os dois envios no mesmo `act`: o React não renderiza entre eles, então o botão ainda não está desabilitado
    act(() => {
      fireEvent.submit(formulario)
      fireEvent.submit(formulario)
    })
    expect(await screen.findByText(CRIADO)).toBeTruthy()
    expect(f.chamadas.episodios).toHaveLength(1)
    // o mesmo para o aviso
    await abrirEpisodio('Episódio 1')
    preencherAviso({ titulo: 'Único' })
    const formularioDoAviso = screen.getByRole('button', { name: 'Incluir aviso' }).closest('form')!
    act(() => {
      fireEvent.submit(formularioDoAviso)
      fireEvent.submit(formularioDoAviso)
    })
    expect(await screen.findByText(AVISO_INCLUIDO)).toBeTruthy()
    expect(f.chamadas.avisos).toHaveLength(1)
  })

  test('avisos-sempre-montados', async () => {
    abrir({ episodios: [RASCUNHO] })
    await carregada()
    expect(status()).toBeTruthy()
    expect(alerta()).toBeTruthy()
    await abrirEpisodio('Episódio 1')
    expect(status()).toBeTruthy()
    expect(alerta()).toBeTruthy()
  })

  test('abrir-leva-o-foco-ao-episodio', async () => {
    abrir({ episodios: [RASCUNHO] })
    await abrirEpisodio('Episódio 1')
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Episódio 1' }))
  })

  test('foco-no-mesmo-commit-do-aviso', async () => {
    // lê o foco no instante em que o texto entra na região de alerta: prova o `useLayoutEffect`
    const { f } = abrir({ episodios: [RASCUNHO] })
    f.falharProxima('episodios.alterar', new ErroDePreparacao('rede'))
    await abrirEpisodio('Episódio 1')
    const regiao = alerta()
    let focoNaHora: Element | null | 'nunca' = 'nunca'
    const observador = new MutationObserver(() => {
      if (regiao.textContent && focoNaHora === 'nunca') focoNaHora = document.activeElement
    })
    observador.observe(regiao, { childList: true, subtree: true, characterData: true })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await screen.findByText(NAO_CONCLUIU)
    observador.disconnect()
    expect(focoNaHora).toBe(regiao)
  })
})
