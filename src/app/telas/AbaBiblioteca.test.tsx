// @vitest-environment jsdom
import { afterEach, describe, test, expect, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { GESTOS } from '../../domains/preparacao/gestos'
import type { LinhaDoMapa } from '../../domains/preparacao/gestos'
import type { Midia, Som } from '../../domains/preparacao/midia'
import { ErroDePreparacao } from '../../domains/preparacao/portas'
import { arquivoDeTeste, criarFalsosDePreparacao, usuarioGoogle } from '../servicosFalsos'
import { AbaBiblioteca } from './AbaBiblioteca'

afterEach(cleanup)

// Textos fixos da aba (PLA-003, Tarefa 5), repetidos aqui de propósito: mudar um texto na tela derruba o teste.
const ENVIADO = 'Arquivo enviado.'
const VAZIO = 'Arquivo vazio.'
const GRANDE = 'Arquivo acima de 50 MB.'
const TIPO = 'Tipo não aceito. Use MP3, WAV, OGG, M4A, PNG, JPEG, WebP ou GIF.'
const SEM_ESPACO = 'Sem espaço: o limite grátis é 1 GB.'
const CANCELADO = 'Envio cancelado.'
const EM_USO = 'Este som está ligado a um gesto. Troque o gesto antes de excluir.'
const MUDOU = 'A biblioteca ou o seu papel mudou; conferindo de novo.'
const NAO_CONCLUIU = 'Não foi possível concluir. Tente de novo.'
const ARQUIVO_FICOU = 'Excluído da biblioteca; o arquivo ficou no armazenamento.'
const EXCLUIDO = 'Excluído da biblioteca.'
const ALERTA_DE_USO = 'A biblioteca passou de 80 % do limite grátis.'
const SEM_RESPOSTA = 'O envio parou de avançar e foi interrompido. Tente de novo.'
const SESSAO_EXPIRADA = 'A sessão expirou. Entre de novo e envie outra vez.'
const AVISO_DA_FILA = 'Trocar de aba ou sair da página cancela os envios.'
const REGISTRANDO = 'Registrando…'
const ROTULO_DO_ENVIO = 'Enviar sons e imagens'

const ID_SOM = '11111111-1111-4111-8111-111111111111'
const ID_IMAGEM = '22222222-2222-4222-8222-222222222222'
const UUID_NO_CAMINHO = /^imagem\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/

function midia(id: string, tipo: 'som' | 'imagem', nome: string, tamanhoBytes = 1_000): Midia {
  return {
    id,
    tipo,
    nome,
    caminho: `${tipo}/${id}.${tipo === 'som' ? 'mp3' : 'png'}`,
    mime: tipo === 'som' ? 'audio/mpeg' : 'image/png',
    tamanhoBytes,
    enviadoPor: null,
  }
}

const SOM: Som = { id: 'som-1', midiaId: ID_SOM, rotulo: 'aplauso', emoji: null, volume: 1, ordem: 0 }

function mapaCom(gesto: LinhaDoMapa['gesto'], somId: string): LinhaDoMapa[] {
  return GESTOS.map((g) =>
    g.gesto === gesto ? { gesto: g.gesto, acao: 'som' as const, cenaId: null, somId } : { gesto: g.gesto, acao: 'nenhuma' as const, cenaId: null, somId: null },
  )
}

function abrir(inicial: Parameters<typeof criarFalsosDePreparacao>[0] = {}) {
  const f = criarFalsosDePreparacao(inicial)
  const reavaliar = vi.fn()
  // conta as leituras sem mudar o falso (os métodos não usam `this`)
  const listarMidias = vi.fn(f.servicos.midias.listar)
  f.servicos.midias.listar = listarMidias
  const usuario = usuarioGoogle('equipe@revocast.test', 'id-equipe')
  const tela = render(<AbaBiblioteca servicos={f.servicos} usuario={usuario} reavaliar={reavaliar} />)
  return { f, reavaliar, listarMidias, ...tela }
}

/** Espera a primeira carga (o campo de envio só fica habilitado com a biblioteca carregada). */
async function carregada() {
  await waitFor(() => expect((screen.getByLabelText(ROTULO_DO_ENVIO) as HTMLInputElement).disabled).toBe(false))
}

function escolher(arquivos: File[]) {
  fireEvent.change(screen.getByLabelText(ROTULO_DO_ENVIO), { target: { files: arquivos } })
}

async function itemDe(nome: string): Promise<HTMLElement> {
  const texto = await screen.findByText(nome)
  const item = texto.closest('li')
  if (!item) throw new Error(`sem item para ${nome}`)
  return item
}

/** A linha da fila de envios com este nome de exibição. */
async function linhaDaFila(nome: string): Promise<HTMLElement> {
  const lista = await screen.findByRole('list', { name: 'Envios' })
  const texto = await within(lista).findByText(nome)
  const linha = texto.closest('li')
  if (!linha) throw new Error(`sem linha da fila para ${nome}`)
  return linha
}

/** A região de alerta sempre montada da aba (a de `tabIndex={-1}`). */
function alerta(): HTMLElement {
  const regiao = screen.getAllByRole('alert').find((r) => r.getAttribute('tabindex') === '-1')
  if (!regiao) throw new Error('sem região de alerta')
  return regiao
}

/** Deixa as promessas pendentes andarem (o falso resolve em microtarefas). */
async function andar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('aba Biblioteca', () => {
  test('lista-e-uso', async () => {
    abrir({
      midias: [midia(ID_IMAGEM, 'imagem', 'capa.png', 300_000_000), midia(ID_SOM, 'som', 'aplauso.mp3', 500_000_000)],
      sons: [SOM],
    })
    expect(await screen.findByText('800,0 MB de 1 GB')).toBeTruthy()
    expect(screen.getByText(ALERTA_DE_USO)).toBeTruthy()
    const sons = screen.getByRole('list', { name: 'Sons' })
    const imagens = screen.getByRole('list', { name: 'Imagens' })
    expect(within(sons).getByText('aplauso.mp3')).toBeTruthy()
    expect(within(sons).queryByText('capa.png')).toBeNull()
    expect(within(imagens).getByText('capa.png')).toBeTruthy()
    expect(within(imagens).queryByText('aplauso.mp3')).toBeNull()
  })

  test('uso-no-painel', async () => {
    abrir()
    expect(await screen.findByText('0,0 MB de 1 GB')).toBeTruthy()
    expect(screen.queryByText(ALERTA_DE_USO)).toBeNull()
    const campo = screen.getByLabelText(ROTULO_DO_ENVIO)
    expect(campo.getAttribute('type')).toBe('file')
    expect(campo.getAttribute('accept')).toBe('audio/mpeg,audio/wav,audio/ogg,audio/mp4,image/png,image/jpeg,image/webp,image/gif')
    expect(campo.hasAttribute('multiple')).toBe(true)
  })

  test('envia-imagem', async () => {
    const { f, listarMidias } = abrir()
    await carregada()
    escolher([arquivoDeTeste('png', '../../x/foto.png')])
    expect(await screen.findByText(ENVIADO)).toBeTruthy()
    expect(f.chamadas.enviar).toHaveLength(1)
    const { caminho, mime } = f.chamadas.enviar[0]
    expect(caminho).toMatch(UUID_NO_CAMINHO)
    expect(caminho).not.toContain('foto')
    expect(caminho).not.toContain('..')
    expect(mime).toBe('image/png')
    expect(f.chamadas.registrar).toHaveLength(1)
    expect(f.chamadas.registrar[0]).toMatchObject({ nome: 'foto.png', tipo: 'imagem', caminho, tamanhoBytes: 1024, enviadoPor: 'id-equipe' })
    // lista recarregada
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Imagens' })).getByText('foto.png')).toBeTruthy())
    expect(listarMidias.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  test('envio-recusado-localmente', async () => {
    const { f } = abrir()
    await carregada()
    escolher([arquivoDeTeste('html', 'pagina.png')])
    expect(await within(await linhaDaFila('pagina.png')).findByText(TIPO)).toBeTruthy()
    expect(alerta().textContent).toBe(TIPO)
    escolher([arquivoDeTeste('png', 'grande.png', 52_428_801)])
    expect(await within(await linhaDaFila('grande.png')).findByText(GRANDE)).toBeTruthy()
    escolher([arquivoDeTeste('svg', 'desenho.svg')])
    expect(await within(await linhaDaFila('desenho.svg')).findByText(TIPO)).toBeTruthy()
    escolher([arquivoDeTeste('png', 'vazio.png', 0)])
    expect(await within(await linhaDaFila('vazio.png')).findByText(VAZIO)).toBeTruthy()
    await andar()
    expect(f.chamadas.enviar).toEqual([])
    expect(f.chamadas.registrar).toEqual([])
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  test('sem-espaco', async () => {
    const { f } = abrir({ midias: [midia(ID_IMAGEM, 'imagem', 'cheia.png', 999_999_500)] })
    await carregada()
    escolher([arquivoDeTeste('png', 'mais.png', 1_000)])
    expect(await within(await linhaDaFila('mais.png')).findByText(SEM_ESPACO)).toBeTruthy()
    expect(f.chamadas.enviar).toEqual([])
  })

  test('progresso-do-envio', async () => {
    const { f } = abrir()
    await carregada()
    const envio = f.segurarEnvio()
    escolher([arquivoDeTeste('png', 'foto.png')])
    await waitFor(() => expect(f.chamadas.enviar).toHaveLength(1))
    act(() => envio.progredir(0.4))
    const barra = screen.getByRole('progressbar', { name: /foto\.png/ })
    expect(barra.getAttribute('value')).toBe('0.4')
    expect(barra.getAttribute('max')).toBe('1')
    act(() => envio.concluir())
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
    expect(await screen.findByText(ENVIADO)).toBeTruthy()
  })

  test('cancelar-envio', async () => {
    const { f } = abrir()
    await carregada()
    const envio = f.segurarEnvio()
    escolher([arquivoDeTeste('png', 'foto.png')])
    await waitFor(() => expect(f.chamadas.enviar).toHaveLength(1))
    const fila = screen.getByRole('list', { name: 'Envios' })
    within(fila).getByRole('button', { name: 'Cancelar' }).focus()
    fireEvent.click(within(fila).getByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByText(CANCELADO)).toBeTruthy()
    // o envio cancelado não registra, mesmo que o servidor termine depois
    act(() => envio.concluir())
    await andar()
    expect(f.chamadas.registrar).toEqual([])
    // remoção de boa-fé do objeto que possa ter ficado (D6)
    expect(f.chamadas.removerArquivo).toEqual([f.chamadas.enviar[0].caminho])
    expect(screen.queryByRole('progressbar')).toBeNull()
    // foco previsível: a linha sumiu e o foco vai para o aviso (WCAG 2.4.3)
    expect(document.activeElement?.getAttribute('role')).toBe('status')
  })

  test('fila-um-de-cada-vez', async () => {
    const { f } = abrir()
    await carregada()
    const envio = f.segurarEnvio()
    escolher([arquivoDeTeste('png', 'a.png'), arquivoDeTeste('png', 'b.png')])
    await waitFor(() => expect(f.chamadas.enviar).toHaveLength(1))
    await andar()
    expect(f.chamadas.enviar).toHaveLength(1)
    expect(within(screen.getByRole('list', { name: 'Envios' })).getAllByRole('listitem')).toHaveLength(2)
    act(() => envio.concluir())
    await waitFor(() => expect(f.chamadas.enviar).toHaveLength(2))
    expect(f.chamadas.registrar).toHaveLength(1)
    act(() => envio.concluir())
    await waitFor(() => expect(f.chamadas.registrar).toHaveLength(2))
    expect(f.chamadas.registrar.map((m) => m.nome)).toEqual(['a.png', 'b.png'])
  })

  test('cancelar-na-fila', async () => {
    const { f } = abrir()
    await carregada()
    const envio = f.segurarEnvio()
    escolher([arquivoDeTeste('png', 'a.png'), arquivoDeTeste('png', 'b.png')])
    await waitFor(() => expect(f.chamadas.enviar).toHaveLength(1))
    const segunda = within(screen.getByRole('list', { name: 'Envios' })).getAllByRole('listitem')[1]
    expect(segunda.textContent).toContain('b.png')
    fireEvent.click(within(segunda).getByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByText(CANCELADO)).toBeTruthy()
    act(() => envio.concluir())
    await waitFor(() => expect(f.chamadas.registrar).toHaveLength(1))
    await andar()
    expect(f.chamadas.enviar).toHaveLength(1)
    expect(f.chamadas.registrar[0].nome).toBe('a.png')
  })

  test('uso-reconferido-entre-envios', async () => {
    // 999 998 000 bytes já usados: cabe um arquivo de 1 024 bytes, mas não dois
    const { f } = abrir({ midias: [midia(ID_IMAGEM, 'imagem', 'cheia.png', 999_998_000)] })
    await carregada()
    escolher([arquivoDeTeste('png', 'a.png'), arquivoDeTeste('png', 'b.png')])
    expect(await within(await linhaDaFila('b.png')).findByText(SEM_ESPACO)).toBeTruthy()
    expect(f.chamadas.enviar).toHaveLength(1)
    expect(f.chamadas.registrar.map((m) => m.nome)).toEqual(['a.png'])
  })

  test('soltar-arquivos', async () => {
    const { f, container } = abrir()
    await carregada()
    const area = container.querySelector('.envio')
    if (!area) throw new Error('sem área de envio')
    fireEvent.dragOver(area, { dataTransfer: { files: [], types: ['Files'] } })
    expect(area.classList.contains('envio--arrastando')).toBe(true)
    fireEvent.drop(area, { dataTransfer: { files: [arquivoDeTeste('mp3', 'aplauso.mp3')] } })
    expect(area.classList.contains('envio--arrastando')).toBe(false)
    expect(await screen.findByText(ENVIADO)).toBeTruthy()
    expect(f.chamadas.enviar[0].caminho).toMatch(/^som\/[0-9a-f-]{36}\.mp3$/)
    expect(f.chamadas.incluirSom).toEqual([[f.chamadas.registrar[0].id, { rotulo: 'aplauso', emoji: null, volume: 1, ordem: 0 }]])
  })

  test('desmontar-aborta-envio', async () => {
    const { f, unmount } = abrir()
    await carregada()
    const envio = f.segurarEnvio()
    escolher([arquivoDeTeste('png', 'foto.png')])
    await waitFor(() => expect(f.chamadas.enviar).toHaveLength(1))
    unmount()
    envio.concluir()
    await new Promise((r) => setTimeout(r, 0))
    expect(f.chamadas.registrar).toEqual([])
    expect(f.chamadas.removerArquivo).toEqual([f.chamadas.enviar[0].caminho])
  })

  test('excluir-som-em-gesto', async () => {
    const { f } = abrir({ midias: [midia(ID_SOM, 'som', 'aplauso.mp3')], sons: [SOM], mapa: mapaCom('Thumb_Up', SOM.id) })
    const item = await itemDe('aplauso.mp3')
    fireEvent.click(within(item).getByRole('button', { name: 'Excluir' }))
    expect(within(item).getByText('Usado no gesto 👍')).toBeTruthy()
    const confirmar = within(item).getByRole('button', { name: 'Confirmar exclusão' }) as HTMLButtonElement
    expect(confirmar.disabled).toBe(true)
    // foco previsível: o "Excluir" sumiu; o foco vai para "Manter"
    expect(document.activeElement).toBe(within(item).getByRole('button', { name: 'Manter' }))
    fireEvent.click(confirmar)
    await andar()
    expect(f.chamadas.removerMidia).toEqual([])
    expect(f.chamadas.removerArquivo).toEqual([])
    fireEvent.click(within(item).getByRole('button', { name: 'Manter' }))
    expect(document.activeElement).toBe(within(item).getByRole('button', { name: 'Excluir' }))
  })

  test('excluir-imagem-em-aviso', async () => {
    const { f } = abrir({ midias: [midia(ID_IMAGEM, 'imagem', 'capa.png')], avisosComImagem: { [ID_IMAGEM]: 2 } })
    const ordem: string[] = []
    const removerMidia = f.servicos.midias.remover
    f.servicos.midias.remover = async (id) => {
      ordem.push('midia')
      return removerMidia(id)
    }
    const removerArquivo = f.servicos.armazenamento.remover
    f.servicos.armazenamento.remover = async (caminho) => {
      ordem.push('arquivo')
      return removerArquivo(caminho)
    }
    const item = await itemDe('capa.png')
    fireEvent.click(within(item).getByRole('button', { name: 'Excluir' }))
    expect(await within(item).findByText('2 avisos perdem a imagem')).toBeTruthy()
    fireEvent.click(within(item).getByRole('button', { name: 'Confirmar exclusão' }))
    expect(await screen.findByText(EXCLUIDO)).toBeTruthy()
    expect(ordem).toEqual(['midia', 'arquivo'])
    expect(f.chamadas.removerMidia).toEqual([ID_IMAGEM])
    expect(f.chamadas.removerArquivo).toEqual([`imagem/${ID_IMAGEM}.png`])
    await waitFor(() => expect(screen.queryByText('capa.png')).toBeNull())
    expect(document.activeElement?.getAttribute('role')).toBe('status')
  })

  test('excluir-em-uso-do-banco', async () => {
    const { f } = abrir({ midias: [midia(ID_SOM, 'som', 'aplauso.mp3')], sons: [SOM] })
    f.falharProxima('midias.remover', new ErroDePreparacao('em_uso'))
    const item = await itemDe('aplauso.mp3')
    fireEvent.click(within(item).getByRole('button', { name: 'Excluir' }))
    expect(within(item).getByText('Não está em uso.')).toBeTruthy()
    fireEvent.click(within(item).getByRole('button', { name: 'Confirmar exclusão' }))
    expect(await screen.findByText(EM_USO)).toBeTruthy()
    expect(f.chamadas.removerMidia).toEqual([ID_SOM])
    expect(f.chamadas.removerArquivo).toEqual([])
    expect(screen.getByText('aplauso.mp3')).toBeTruthy()
    expect(document.activeElement?.getAttribute('role')).toBe('alert')
  })

  test('arquivo-ficou', async () => {
    const { f } = abrir({ midias: [midia(ID_IMAGEM, 'imagem', 'capa.png')] })
    f.falharProxima('armazenamento.remover', new ErroDePreparacao('rede'))
    const item = await itemDe('capa.png')
    fireEvent.click(within(item).getByRole('button', { name: 'Excluir' }))
    fireEvent.click(await within(item).findByRole('button', { name: 'Confirmar exclusão' }))
    expect(await screen.findByText(ARQUIVO_FICOU)).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('capa.png')).toBeNull())
    expect(f.chamadas.removerArquivo).toEqual([`imagem/${ID_IMAGEM}.png`])
  })

  test('nome-com-html-literal', async () => {
    const nome = '<img src=x onerror=alert(1)>.png'
    const { container } = abrir({ midias: [midia(ID_IMAGEM, 'imagem', nome)] })
    const item = await itemDe(nome)
    expect(container.querySelector('img[src="x"]')).toBeNull()
    fireEvent.click(within(item).getByRole('button', { name: 'Ver' }))
    const miniatura = await within(item).findByRole('img')
    expect(miniatura.getAttribute('alt')).toBe(nome)
    expect(container.querySelector('img[src="x"]')).toBeNull()
  })

  test('previa-so-ao-pedir', async () => {
    const { f, container } = abrir({ midias: [midia(ID_SOM, 'som', 'aplauso.mp3'), midia(ID_IMAGEM, 'imagem', 'capa.png')], sons: [SOM] })
    const item = await itemDe('aplauso.mp3')
    await andar()
    expect(f.chamadas.previa).toEqual([])
    expect(container.querySelector('audio')).toBeNull()
    const ouvir = within(item).getByRole('button', { name: 'Ouvir' })
    fireEvent.click(ouvir)
    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull())
    const audio = container.querySelector('audio')!
    expect(f.chamadas.previa).toEqual([`som/${ID_SOM}.mp3`])
    expect(audio.getAttribute('src')).toBe(`https://armazenamento.revocast.test/assinada/som/${ID_SOM}.mp3?token=teste`)
    expect(audio.hasAttribute('controls')).toBe(true)
    expect(audio.getAttribute('preload')).toBe('none')
    // o mesmo botão, com o foco, passa a esconder a prévia
    expect(within(item).getByRole('button', { name: 'Ocultar prévia' })).toBe(ouvir)
    fireEvent.click(within(await itemDe('capa.png')).getByRole('button', { name: 'Ver' }))
    await waitFor(() => expect(f.chamadas.previa).toHaveLength(2))
    expect(await screen.findByRole('img', { name: 'capa.png' })).toBeTruthy()
  })

  test('salvar-som', async () => {
    const { f } = abrir({ midias: [midia(ID_SOM, 'som', 'aplauso.mp3')], sons: [SOM] })
    const item = await itemDe('aplauso.mp3')
    fireEvent.change(within(item).getByLabelText('Rótulo'), { target: { value: '   ' } })
    fireEvent.click(within(item).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Dê um rótulo ao som.')).toBeTruthy()
    expect(f.chamadas.alterarSom).toEqual([])
    fireEvent.change(within(item).getByLabelText('Rótulo'), { target: { value: ' Aplausos ' } })
    fireEvent.change(within(item).getByLabelText('Emoji'), { target: { value: '👏' } })
    fireEvent.change(within(item).getByLabelText('Volume'), { target: { value: '40' } })
    expect(within(item).getByText('40 %')).toBeTruthy()
    const salvar = within(item).getByRole('button', { name: 'Salvar' })
    fireEvent.click(salvar)
    expect(await screen.findByText('Som salvo.')).toBeTruthy()
    expect(f.chamadas.alterarSom).toEqual([['som-1', { rotulo: 'Aplausos', emoji: '👏', volume: 0.4, ordem: 0 }]])
    await waitFor(() => expect(document.activeElement).toBe(within(item).getByRole('button', { name: 'Salvar' })))
  })

  test('escrita-negada-reavalia', async () => {
    const { f, reavaliar, listarMidias } = abrir({ midias: [midia(ID_SOM, 'som', 'aplauso.mp3')], sons: [SOM] })
    f.falharProxima('sons.alterar', new ErroDePreparacao('nada_alterado'))
    const item = await itemDe('aplauso.mp3')
    await andar()
    expect(listarMidias).toHaveBeenCalledTimes(1)
    fireEvent.click(within(item).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(MUDOU)).toBeTruthy()
    expect(reavaliar).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(listarMidias).toHaveBeenCalledTimes(2))
    expect(document.activeElement?.getAttribute('role')).toBe('alert')
  })

  test('falha-de-rede-na-escrita', async () => {
    const { f, reavaliar } = abrir({ midias: [midia(ID_SOM, 'som', 'aplauso.mp3')], sons: [SOM] })
    f.falharProxima('sons.alterar', new ErroDePreparacao('rede'))
    const item = await itemDe('aplauso.mp3')
    fireEvent.click(within(item).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(NAO_CONCLUIU)).toBeTruthy()
    expect(reavaliar).not.toHaveBeenCalled()
  })

  test('sessao-expirada-ao-carregar', async () => {
    const f = criarFalsosDePreparacao()
    f.falharProxima('midias.listar', new ErroDePreparacao('sessao_expirada'))
    const reavaliar = vi.fn()
    render(<AbaBiblioteca servicos={f.servicos} usuario={usuarioGoogle('equipe@revocast.test')} reavaliar={reavaliar} />)
    expect(await screen.findByText('Não foi possível carregar a biblioteca.')).toBeTruthy()
    expect(reavaliar).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText(ROTULO_DO_ENVIO) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('0,0 MB de 1 GB')).toBeTruthy()
  })

  test('avisos-sempre-montados', async () => {
    abrir()
    await carregada()
    expect(screen.getAllByRole('status').some((r) => r.getAttribute('tabindex') === '-1')).toBe(true)
    expect(screen.getAllByRole('alert').some((r) => r.getAttribute('tabindex') === '-1')).toBe(true)
  })

  test('recusa-fica-na-fila', async () => {
    const { f } = abrir()
    await carregada()
    escolher([arquivoDeTeste('svg', 'a.png'), arquivoDeTeste('png', 'b.png')])
    await waitFor(() => expect(f.chamadas.registrar).toHaveLength(1))
    expect(await screen.findByText(ENVIADO)).toBeTruthy()
    // a recusa do primeiro não some atrás do sucesso do segundo
    const linha = await linhaDaFila('a.png')
    expect(within(linha).getByText(TIPO)).toBeTruthy()
    expect(within(linha).queryByRole('button', { name: 'Cancelar' })).toBeNull()
    expect(within(screen.getByRole('list', { name: 'Envios' })).getAllByRole('listitem')).toHaveLength(1)
    fireEvent.click(within(linha).getByRole('button', { name: 'Dispensar' }))
    expect(screen.queryByRole('list', { name: 'Envios' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByLabelText(ROTULO_DO_ENVIO))
  })

  test('aviso-da-fila-e-saida-da-pagina', async () => {
    const adicionar = vi.spyOn(window, 'addEventListener')
    const remover = vi.spyOn(window, 'removeEventListener')
    try {
      const { f, unmount } = abrir()
      await carregada()
      expect(screen.queryByText(AVISO_DA_FILA)).toBeNull()
      const envio = f.segurarEnvio()
      escolher([arquivoDeTeste('png', 'foto.png')])
      await waitFor(() => expect(f.chamadas.enviar).toHaveLength(1))
      expect(screen.getByText(AVISO_DA_FILA)).toBeTruthy()
      const registros = adicionar.mock.calls.filter(([tipo]) => tipo === 'beforeunload')
      expect(registros).toHaveLength(1)
      const ouvinte = registros[0][1]
      // o ouvinte pede confirmação ao navegador
      const evento = new Event('beforeunload', { cancelable: true })
      ;(ouvinte as EventListener)(evento)
      expect(evento.defaultPrevented).toBe(true)
      act(() => envio.concluir())
      await waitFor(() => expect(screen.queryByText(AVISO_DA_FILA)).toBeNull())
      expect(remover.mock.calls.filter(([tipo, fn]) => tipo === 'beforeunload' && fn === ouvinte)).toHaveLength(1)
      // só uma falha na fila: nada pendente, sem aviso e sem ouvinte
      escolher([arquivoDeTeste('svg', 'desenho.svg')])
      await within(await linhaDaFila('desenho.svg')).findByText(TIPO)
      expect(screen.queryByText(AVISO_DA_FILA)).toBeNull()
      const ativos = () =>
        adicionar.mock.calls.filter(([tipo]) => tipo === 'beforeunload').length - remover.mock.calls.filter(([tipo]) => tipo === 'beforeunload').length
      expect(ativos()).toBe(0)
      // um envio pendente na desmontagem: o ouvinte sai junto
      escolher([arquivoDeTeste('png', 'outra.png')])
      await waitFor(() => expect(f.chamadas.enviar).toHaveLength(2))
      expect(ativos()).toBe(1)
      const segundo = adicionar.mock.calls.filter(([tipo]) => tipo === 'beforeunload').at(-1)![1]
      unmount()
      expect(ativos()).toBe(0)
      expect(remover.mock.calls.filter(([tipo, fn]) => tipo === 'beforeunload' && fn === segundo)).toHaveLength(1)
    } finally {
      adicionar.mockRestore()
      remover.mockRestore()
    }
  })

  test('foco-no-mesmo-commit-do-aviso', async () => {
    // lê o foco no instante em que o texto entra na região de alerta (não depois): prova que o foco muda no
    // mesmo commit que mostra o aviso (`useLayoutEffect`), sem depender de tempo
    const { f } = abrir({ midias: [midia(ID_SOM, 'som', 'aplauso.mp3')], sons: [SOM] })
    f.falharProxima('sons.alterar', new ErroDePreparacao('rede'))
    const item = await itemDe('aplauso.mp3')
    const regiao = alerta()
    let focoNaHora: Element | null | 'nunca' = 'nunca'
    const observador = new MutationObserver(() => {
      if (regiao.textContent && focoNaHora === 'nunca') focoNaHora = document.activeElement
    })
    observador.observe(regiao, { childList: true, subtree: true, characterData: true })
    fireEvent.click(within(item).getByRole('button', { name: 'Salvar' }))
    await screen.findByText(NAO_CONCLUIU)
    observador.disconnect()
    expect(focoNaHora).toBe(regiao)
  })

  test('sem-resposta-no-envio', async () => {
    const { f } = abrir()
    await carregada()
    f.falharProxima('armazenamento.enviar', new ErroDePreparacao('sem_resposta'))
    escolher([arquivoDeTeste('png', 'foto.png')])
    expect(await within(await linhaDaFila('foto.png')).findByText(SEM_RESPOSTA)).toBeTruthy()
    expect(alerta().textContent).toBe(SEM_RESPOSTA)
    expect(f.chamadas.registrar).toEqual([])
    // remoção de boa-fé do que possa ter ficado (D6)
    expect(f.chamadas.removerArquivo).toEqual([f.chamadas.enviar[0].caminho])
  })

  test('previa-com-url-recusada', async () => {
    const { f, container } = abrir({ midias: [midia(ID_SOM, 'som', 'aplauso.mp3')], sons: [SOM] })
    f.servicos.armazenamento.urlDePrevia = async () => 'javascript:alert(1)'
    const item = await itemDe('aplauso.mp3')
    fireEvent.click(within(item).getByRole('button', { name: 'Ouvir' }))
    expect(await screen.findByText(NAO_CONCLUIU)).toBeTruthy()
    expect(container.querySelector('audio')).toBeNull()
    expect(container.querySelector('[src^="javascript"]')).toBeNull()
    expect(within(item).getByRole('button', { name: 'Ouvir' })).toBeTruthy()
  })

  test('nome-de-exibicao-na-fila', async () => {
    const { f } = abrir()
    await carregada()
    f.segurarEnvio()
    escolher([arquivoDeTeste('png', '../../x/foto.png')])
    await waitFor(() => expect(f.chamadas.enviar).toHaveLength(1))
    const lista = screen.getByRole('list', { name: 'Envios' })
    expect(within(lista).getByText('foto.png')).toBeTruthy()
    expect(lista.textContent).not.toContain('..')
    expect(lista.textContent).not.toContain('x/')
  })

  test('sessao-expirada-para-a-fila', async () => {
    const { f, reavaliar } = abrir()
    await carregada()
    let tentativas = 0
    f.servicos.armazenamento.enviar = () => {
      tentativas++
      return Promise.reject(new ErroDePreparacao('sessao_expirada'))
    }
    escolher([arquivoDeTeste('png', 'a.png'), arquivoDeTeste('png', 'b.png'), arquivoDeTeste('png', 'c.png')])
    for (const nome of ['a.png', 'b.png', 'c.png']) expect(await within(await linhaDaFila(nome)).findByText(SESSAO_EXPIRADA)).toBeTruthy()
    await andar()
    expect(tentativas).toBe(1)
    expect(reavaliar).toHaveBeenCalledTimes(1)
    expect(f.chamadas.registrar).toEqual([])
  })

  test('registrando-sem-cancelar', async () => {
    const { f } = abrir()
    await carregada()
    const envio = f.segurarEnvio()
    let liberarRegistro: () => void = () => {}
    const registrar = f.servicos.midias.registrar
    f.servicos.midias.registrar = async (m) => {
      await new Promise<void>((ok) => {
        liberarRegistro = ok
      })
      return registrar(m)
    }
    escolher([arquivoDeTeste('png', 'foto.png')])
    await waitFor(() => expect(f.chamadas.enviar).toHaveLength(1))
    const linha = await linhaDaFila('foto.png')
    within(linha).getByRole('button', { name: 'Cancelar' }).focus()
    act(() => envio.concluir())
    // bytes no Storage: "Registrando…", sem "Cancelar" (abortar não teria mais efeito)
    expect(await within(linha).findByText(REGISTRANDO)).toBeTruthy()
    expect(within(linha).queryByRole('button', { name: 'Cancelar' })).toBeNull()
    expect(within(linha).queryByRole('progressbar')).toBeNull()
    expect(document.activeElement).toBe(screen.getByLabelText(ROTULO_DO_ENVIO))
    await act(async () => liberarRegistro())
    expect(await screen.findByText(ENVIADO)).toBeTruthy()
    expect(f.chamadas.registrar).toHaveLength(1)
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Envios' })).toBeNull())
  })

  test('sessao-expirada-com-leitura-expirada', async () => {
    // sessão expirada de verdade: o envio e a leitura da lista recusam; `reavaliar()` só uma vez
    const { f, reavaliar } = abrir()
    await carregada()
    f.servicos.armazenamento.enviar = () => Promise.reject(new ErroDePreparacao('sessao_expirada'))
    f.servicos.midias.listar = () => Promise.reject(new ErroDePreparacao('sessao_expirada'))
    escolher([arquivoDeTeste('png', 'a.png'), arquivoDeTeste('png', 'b.png')])
    for (const nome of ['a.png', 'b.png']) expect(await within(await linhaDaFila(nome)).findByText(SESSAO_EXPIRADA)).toBeTruthy()
    await andar()
    expect(reavaliar).toHaveBeenCalledTimes(1)
  })

  test('dispensar-so-uma-linha', async () => {
    const { f } = abrir()
    await carregada()
    escolher([arquivoDeTeste('svg', 'a.png'), arquivoDeTeste('html', 'b.png')])
    const segunda = await linhaDaFila('b.png')
    await within(segunda).findByText(TIPO)
    const primeira = await linhaDaFila('a.png')
    fireEvent.click(within(primeira).getByRole('button', { name: 'Dispensar' }))
    const lista = screen.getByRole('list', { name: 'Envios' })
    expect(within(lista).getAllByRole('listitem')).toHaveLength(1)
    expect(within(lista).getByText('b.png')).toBeTruthy()
    expect(within(lista).queryByText('a.png')).toBeNull()
    expect(within(lista).getByText(TIPO)).toBeTruthy()
    expect(f.chamadas.enviar).toEqual([])
  })
})
