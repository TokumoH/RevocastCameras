// @vitest-environment jsdom
import { afterEach, describe, test, expect, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { MembroPermitido, PerfilDeMembro } from '../../domains/acesso/listaDeAcesso'
import { ErroDeAcesso } from '../../domains/acesso/portas'
import type { RepositorioDeAcesso } from '../../domains/acesso/portas'
import { criarFalsos, usuarioGoogle } from '../servicosFalsos'
import { AbaMembros } from './AbaMembros'

afterEach(cleanup)

const MUDOU = 'A lista ou o seu papel mudou; conferindo de novo.'
const PROPRIA = 'Você não pode alterar o próprio acesso; peça a outro admin.'

/** Lista do plano: `adm` admin (a sessão), `ana` equipe com perfil "Ana", `bia` apresentadora sem perfil. */
function abrir(opcoes: { emailDaSessao?: string; perfis?: PerfilDeMembro[] } = {}) {
  const f = criarFalsos({
    permitidos: [
      { email: 'bia@revocast.test', papel: 'apresentadora', criadoPor: 'id-adm' },
      { email: 'ana@revocast.test', papel: 'equipe', criadoPor: 'id-adm' },
      { email: 'adm@revocast.test', papel: 'admin', criadoPor: null },
    ],
    perfis: opcoes.perfis ?? [
      { id: 'id-ana', email: 'ana@revocast.test', nome: 'Ana' },
      { id: 'id-adm', email: 'adm@revocast.test', nome: 'Adm' },
    ],
  })
  const usuario = usuarioGoogle(opcoes.emailDaSessao ?? 'adm@revocast.test', 'id-adm')
  const reavaliar = vi.fn()
  // conta as leituras da lista sem mudar o falso (os métodos não usam `this`)
  const listarPermitidos = vi.fn(f.servicos.repo.listarPermitidos)
  const repo: RepositorioDeAcesso = { ...f.servicos.repo, listarPermitidos }
  const tela = render(<AbaMembros repo={repo} usuario={usuario} reavaliar={reavaliar} />)
  return { f, repo, reavaliar, listarPermitidos, ...tela }
}

async function linhaDe(email: string): Promise<HTMLElement> {
  const celula = await screen.findByText(email)
  const linha = celula.closest('tr')
  if (!linha) throw new Error(`sem linha para ${email}`)
  return linha
}

function incluir(email: string, papel: string) {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Papel'), { target: { value: papel } })
  fireEvent.click(screen.getByRole('button', { name: 'Incluir' }))
}

describe('aba Membros', () => {
  test('lista-com-perfis', async () => {
    abrir()
    const tabela = await screen.findByRole('table', { name: /lista de acesso/i })
    const linhas = within(tabela).getAllByRole('row').slice(1) // a primeira é o cabeçalho
    expect(linhas).toHaveLength(3)
    expect(linhas.map((l) => within(l).getAllByRole('cell')[0].textContent)).toEqual([
      'adm@revocast.test',
      'ana@revocast.test',
      'bia@revocast.test',
    ])
    expect(within(await linhaDe('ana@revocast.test')).getByText('Ana')).toBeTruthy()
    expect(within(await linhaDe('bia@revocast.test')).getByText('ainda não entrou')).toBeTruthy()
    const cabecalhos = within(tabela).getAllByRole('columnheader').map((c) => c.textContent)
    expect(cabecalhos).toEqual(['E-mail', 'Nome', 'Papel', 'Ações'])
  })

  test('inclui-normalizado', async () => {
    const { f } = abrir()
    await screen.findByRole('table')
    incluir('  Nova@Revocast.TEST ', 'equipe')
    expect(await screen.findByText('Lista atualizada.')).toBeTruthy()
    expect(f.chamadas.incluir).toEqual([['nova@revocast.test', 'equipe', 'id-adm']])
    const nova = await linhaDe('nova@revocast.test')
    expect(within(nova).getByText('ainda não entrou')).toBeTruthy()
    expect(screen.getByText('Lista atualizada.').getAttribute('role')).toBe('status')
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('')
  })

  test('inclusao-recusada-localmente', async () => {
    const { f } = abrir()
    await screen.findByRole('table')
    incluir('nao-e-email', 'equipe')
    expect(await screen.findByText('Digite um e-mail válido.')).toBeTruthy()
    incluir('   ', 'equipe')
    expect(await screen.findByText('Digite um e-mail válido.')).toBeTruthy()
    incluir('Ana@Revocast.TEST', 'admin')
    expect(await screen.findByText('Esse e-mail já está na lista.')).toBeTruthy()
    expect(f.chamadas.incluir).toEqual([])
  })

  test('duplicado-do-banco', async () => {
    const { f } = abrir()
    await screen.findByRole('table')
    f.falharProxima('incluir', new ErroDeAcesso('duplicado'))
    incluir('outra@revocast.test', 'apresentadora')
    expect(await screen.findByText('Esse e-mail já está na lista.')).toBeTruthy()
    expect(f.chamadas.incluir).toEqual([['outra@revocast.test', 'apresentadora', 'id-adm']])
    expect(screen.queryByText('Lista atualizada.')).toBeNull()
  })

  test('invalido-do-banco', async () => {
    const { f } = abrir()
    await screen.findByRole('table')
    f.falharProxima('incluir', new ErroDeAcesso('invalido'))
    incluir('outra@revocast.test', 'equipe')
    expect(await screen.findByText('Digite um e-mail válido.')).toBeTruthy()
    expect(f.chamadas.incluir).toHaveLength(1)
  })

  test('troca-papel', async () => {
    const { f } = abrir()
    const ana = await linhaDe('ana@revocast.test')
    fireEvent.change(within(ana).getByRole('combobox'), { target: { value: 'apresentadora' } })
    fireEvent.click(within(ana).getByRole('button', { name: 'Salvar papel' }))
    expect(await screen.findByText('Lista atualizada.')).toBeTruthy()
    expect(f.chamadas.alterar).toEqual([['ana@revocast.test', 'apresentadora']])
    // A ordem não muda neste caso (ana < bia entre as apresentadoras); quem prova a recarga é
    // "Lista atualizada." com o seletor mostrando o papel relido. A reordenação está em `troca-papel-reordena`.
    expect((within(await linhaDe('ana@revocast.test')).getByRole('combobox') as HTMLSelectElement).value).toBe(
      'apresentadora',
    )
  })

  test('troca-papel-reordena', async () => {
    abrir()
    const bia = await linhaDe('bia@revocast.test')
    fireEvent.change(within(bia).getByRole('combobox'), { target: { value: 'admin' } })
    fireEvent.click(within(bia).getByRole('button', { name: 'Salvar papel' }))
    expect(await screen.findByText('Lista atualizada.')).toBeTruthy()
    // relida, a lista põe a bia entre os admins (ordem por papel e depois por e-mail)
    const linhas = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(linhas.map((l) => within(l).getAllByRole('cell')[0].textContent)).toEqual([
      'adm@revocast.test',
      'bia@revocast.test',
      'ana@revocast.test',
    ])
  })

  test('rascunho-some-na-recarga', async () => {
    const { f } = abrir()
    const ana = await linhaDe('ana@revocast.test')
    f.falharProxima('alterarPapel', new ErroDeAcesso('nada_alterado'))
    fireEvent.change(within(ana).getByRole('combobox'), { target: { value: 'apresentadora' } })
    fireEvent.click(within(ana).getByRole('button', { name: 'Salvar papel' }))
    expect(await screen.findByText(MUDOU)).toBeTruthy()
    // a lista relida diz "equipe": o seletor mostra o papel do banco, não o rascunho recusado
    await waitFor(async () =>
      expect((within(await linhaDe('ana@revocast.test')).getByRole('combobox') as HTMLSelectElement).value).toBe(
        'equipe',
      ),
    )
  })

  test('papel-igual-recusado-localmente', async () => {
    const { f } = abrir()
    const ana = await linhaDe('ana@revocast.test')
    fireEvent.click(within(ana).getByRole('button', { name: 'Salvar papel' }))
    expect(await screen.findByText('O papel já é esse.')).toBeTruthy()
    expect(f.chamadas.alterar).toEqual([])
  })

  test('remove-com-confirmacao', async () => {
    const { f } = abrir()
    let bia = await linhaDe('bia@revocast.test')
    fireEvent.click(within(bia).getByRole('button', { name: 'Remover' }))
    expect(within(bia).queryByRole('button', { name: 'Remover' })).toBeNull()
    fireEvent.click(within(bia).getByRole('button', { name: 'Cancelar' }))
    expect(f.chamadas.remover).toEqual([])
    expect(within(bia).queryByRole('button', { name: 'Confirmar remoção' })).toBeNull()

    fireEvent.click(within(bia).getByRole('button', { name: 'Remover' }))
    bia = await linhaDe('bia@revocast.test')
    fireEvent.click(within(bia).getByRole('button', { name: 'Confirmar remoção' }))
    expect(await screen.findByText('Lista atualizada.')).toBeTruthy()
    expect(f.chamadas.remover).toEqual(['bia@revocast.test'])
    expect(screen.queryByText('bia@revocast.test')).toBeNull()
  })

  test('propria-linha-sem-acoes', async () => {
    abrir({ emailDaSessao: 'Adm@Revocast.TEST' })
    const adm = await linhaDe('adm@revocast.test')
    expect(within(adm).getByText('Você')).toBeTruthy()
    expect(within(adm).getByText(PROPRIA)).toBeTruthy()
    expect(within(adm).queryByRole('button')).toBeNull()
    expect(within(adm).queryByRole('combobox')).toBeNull()
    expect(within(adm).getByText('Admin')).toBeTruthy()
    // as outras linhas continuam com os controles
    const ana = await linhaDe('ana@revocast.test')
    expect(within(ana).getByRole('button', { name: 'Remover' })).toBeTruthy()
    expect(within(ana).getByRole('combobox')).toBeTruthy()
  })

  test('ultimo-admin-recusado-localmente', async () => {
    // a sessão é de outra pessoa (lista antiga na tela): rebaixar o único admin é recusado sem chamar o repositório
    const { f } = abrir({ emailDaSessao: 'ana@revocast.test' })
    const adm = await linhaDe('adm@revocast.test')
    fireEvent.change(within(adm).getByRole('combobox'), { target: { value: 'equipe' } })
    fireEvent.click(within(adm).getByRole('button', { name: 'Salvar papel' }))
    expect(await screen.findByText('A lista precisa de ao menos um admin.')).toBeTruthy()
    fireEvent.click(within(adm).getByRole('button', { name: 'Remover' }))
    fireEvent.click(within(adm).getByRole('button', { name: 'Confirmar remoção' }))
    expect(await screen.findByText('A lista precisa de ao menos um admin.')).toBeTruthy()
    expect(f.chamadas.alterar).toEqual([])
    expect(f.chamadas.remover).toEqual([])
  })

  test('escrita-negada-reavalia', async () => {
    const { f, reavaliar, listarPermitidos } = abrir()
    let ana = await linhaDe('ana@revocast.test')
    await waitFor(() => expect(listarPermitidos).toHaveBeenCalledTimes(1))

    f.falharProxima('alterarPapel', new ErroDeAcesso('nada_alterado'))
    fireEvent.change(within(ana).getByRole('combobox'), { target: { value: 'apresentadora' } })
    fireEvent.click(within(ana).getByRole('button', { name: 'Salvar papel' }))
    expect(await screen.findByText(MUDOU)).toBeTruthy()
    expect(reavaliar).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(listarPermitidos).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Lista atualizada.')).toBeNull()

    ana = await linhaDe('ana@revocast.test')
    f.falharProxima('alterarPapel', new ErroDeAcesso('negado'))
    fireEvent.change(within(ana).getByRole('combobox'), { target: { value: 'apresentadora' } })
    fireEvent.click(within(ana).getByRole('button', { name: 'Salvar papel' }))
    await waitFor(() => expect(reavaliar).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(listarPermitidos).toHaveBeenCalledTimes(3))
    expect(screen.getByText(MUDOU)).toBeTruthy()
    expect(f.chamadas.alterar).toHaveLength(2)
  })

  test('sessao-expirada-ao-salvar-reavalia', async () => {
    const { f, reavaliar } = abrir()
    const bia = await linhaDe('bia@revocast.test')
    f.falharProxima('remover', new ErroDeAcesso('sessao_expirada'))
    fireEvent.click(within(bia).getByRole('button', { name: 'Remover' }))
    fireEvent.click(within(bia).getByRole('button', { name: 'Confirmar remoção' }))
    await waitFor(() => expect(reavaliar).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Lista atualizada.')).toBeNull()
  })

  test('falha-de-rede-ao-salvar', async () => {
    const { f, reavaliar } = abrir()
    const bia = await linhaDe('bia@revocast.test')
    f.falharProxima('remover', new ErroDeAcesso('rede'))
    fireEvent.click(within(bia).getByRole('button', { name: 'Remover' }))
    fireEvent.click(within(bia).getByRole('button', { name: 'Confirmar remoção' }))
    const aviso = await screen.findByText('Não foi possível salvar. Tente de novo.')
    expect(aviso.getAttribute('role')).toBe('alert')
    expect(reavaliar).not.toHaveBeenCalled()
    expect(f.chamadas.remover).toEqual(['bia@revocast.test'])
    expect(screen.getByText('bia@revocast.test')).toBeTruthy()
  })

  test('falha-ao-carregar-e-tentar-de-novo', async () => {
    const f = criarFalsos({ permitidos: [{ email: 'adm@revocast.test', papel: 'admin', criadoPor: null }] })
    f.falharProxima('listarPermitidos', new ErroDeAcesso('rede'))
    render(<AbaMembros repo={f.servicos.repo} usuario={usuarioGoogle('adm@revocast.test')} reavaliar={() => {}} />)
    expect(await screen.findByText('Não foi possível carregar a lista.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('table')).toBeTruthy()
  })

  test('le-a-lista-uma-vez', async () => {
    // um `reavaliar` novo a cada render do pai não relê a lista
    const { listarPermitidos, rerender, repo } = abrir()
    await screen.findByRole('table')
    const usuario = usuarioGoogle('adm@revocast.test', 'id-adm')
    rerender(<AbaMembros repo={repo} usuario={usuario} reavaliar={() => {}} />)
    rerender(<AbaMembros repo={repo} usuario={usuario} reavaliar={() => {}} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(listarPermitidos).toHaveBeenCalledTimes(1)
  })

  test('clique-duplo-escreve-uma-vez', async () => {
    const { f } = abrir()
    const ana = await linhaDe('ana@revocast.test')
    fireEvent.change(within(ana).getByRole('combobox'), { target: { value: 'admin' } })
    const salvar = within(ana).getByRole('button', { name: 'Salvar papel' })
    fireEvent.click(salvar)
    fireEvent.click(salvar)
    expect(await screen.findByText('Lista atualizada.')).toBeTruthy()
    expect(f.chamadas.alterar).toEqual([['ana@revocast.test', 'admin']])
  })

  test('clique-duplo-em-incluir-inclui-uma-vez', async () => {
    const { f } = abrir()
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'nova@revocast.test' } })
    const botao = screen.getByRole('button', { name: 'Incluir' })
    fireEvent.click(botao)
    fireEvent.click(botao)
    expect(await screen.findByText('Lista atualizada.')).toBeTruthy()
    expect(f.chamadas.incluir).toHaveLength(1)
    expect(screen.queryByText('Esse e-mail já está na lista.')).toBeNull()
  })

  test('sessao-expirada-ao-carregar-reavalia', async () => {
    const f = criarFalsos({ permitidos: [{ email: 'adm@revocast.test', papel: 'admin', criadoPor: null }] })
    f.falharProxima('listarPermitidos', new ErroDeAcesso('sessao_expirada'))
    const reavaliar = vi.fn()
    render(<AbaMembros repo={f.servicos.repo} usuario={usuarioGoogle('adm@revocast.test')} reavaliar={reavaliar} />)
    expect(await screen.findByText('Não foi possível carregar a lista.')).toBeTruthy()
    expect(reavaliar).toHaveBeenCalledTimes(1)
  })

  test('leitura-velha-descartada', async () => {
    // a leitura do repo antigo responde depois da leitura do repo novo: vale a mais nova
    const usuario = usuarioGoogle('adm@revocast.test', 'id-adm')
    let soltarVelha: (lista: MembroPermitido[]) => void = () => {}
    const velho: RepositorioDeAcesso = {
      ...criarFalsos().servicos.repo,
      listarPermitidos: () => new Promise<MembroPermitido[]>((resolve) => (soltarVelha = resolve)),
    }
    const novo = criarFalsos({
      permitidos: [{ email: 'nova@revocast.test', papel: 'admin', criadoPor: null }],
    }).servicos.repo
    const { rerender } = render(<AbaMembros repo={velho} usuario={usuario} reavaliar={() => {}} />)
    rerender(<AbaMembros repo={novo} usuario={usuario} reavaliar={() => {}} />)
    expect(await screen.findByText('nova@revocast.test')).toBeTruthy()
    await act(async () => soltarVelha([{ email: 'velha@revocast.test', papel: 'admin', criadoPor: null }]))
    expect(screen.queryByText('velha@revocast.test')).toBeNull()
    expect(screen.getByText('nova@revocast.test')).toBeTruthy()
  })

  test('avisos-sempre-montados', async () => {
    abrir()
    await screen.findByRole('table')
    const status = screen.getByRole('status')
    const alerta = screen.getByRole('alert')
    expect(status.textContent).toBe('')
    expect(alerta.textContent).toBe('')
    incluir('nao-e-email', 'equipe')
    expect(await screen.findByText('Digite um e-mail válido.')).toBe(alerta)
    incluir('nova@revocast.test', 'equipe')
    expect(await screen.findByText('Lista atualizada.')).toBe(status)
    expect(alerta.textContent).toBe('')
  })

  test('foco-depois-de-salvar', async () => {
    abrir()
    const ana = await linhaDe('ana@revocast.test')
    const seletor = within(ana).getByRole('combobox')
    fireEvent.change(seletor, { target: { value: 'apresentadora' } })
    seletor.focus() // o clique do jsdom não move o foco; o Chromium o perde quando o botão fica desabilitado
    fireEvent.click(within(ana).getByRole('button', { name: 'Salvar papel' }))
    expect(await screen.findByText('Lista atualizada.')).toBeTruthy()
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(screen.getByText('ana@revocast.test').closest('tr')!).getByRole('button', { name: 'Salvar papel' }),
      ),
    )
  })

  test('foco-depois-de-remover', async () => {
    abrir()
    const bia = await linhaDe('bia@revocast.test')
    fireEvent.click(within(bia).getByRole('button', { name: 'Remover' }))
    const confirmar = within(bia).getByRole('button', { name: 'Confirmar remoção' })
    confirmar.focus()
    fireEvent.click(confirmar)
    const status = await screen.findByText('Lista atualizada.')
    await waitFor(() => expect(document.activeElement).toBe(status))
  })

  test('foco-depois-de-incluir', async () => {
    abrir()
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'nova@revocast.test' } })
    const botao = screen.getByRole('button', { name: 'Incluir' })
    botao.focus()
    fireEvent.click(botao)
    expect(await screen.findByText('Lista atualizada.')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('E-mail')))
  })

  test('foco-no-erro', async () => {
    const { f } = abrir()
    const bia = await linhaDe('bia@revocast.test')
    f.falharProxima('remover', new ErroDeAcesso('rede'))
    fireEvent.click(within(bia).getByRole('button', { name: 'Remover' }))
    const confirmar = within(bia).getByRole('button', { name: 'Confirmar remoção' })
    confirmar.focus()
    fireEvent.click(confirmar)
    const aviso = await screen.findByText('Não foi possível salvar. Tente de novo.')
    await waitFor(() => expect(document.activeElement).toBe(aviso))
    // recusa local também leva o foco à mensagem
    const botao = screen.getByRole('button', { name: 'Incluir' })
    botao.focus()
    incluir('nao-e-email', 'equipe')
    const invalido = await screen.findByText('Digite um e-mail válido.')
    await waitFor(() => expect(document.activeElement).toBe(invalido))
  })

  test('nome-com-html-literal', async () => {
    const nome = '<img src=x onerror=alert(1)>'
    const { container } = abrir({
      perfis: [{ id: 'id-ana', email: 'ana@revocast.test', nome }],
    })
    await screen.findByRole('table')
    expect(screen.getByText(nome)).toBeTruthy()
    expect(container.querySelector('img[src="x"]')).toBeNull()
  })
})
