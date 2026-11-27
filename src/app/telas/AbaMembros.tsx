import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { mesmoEmail, normalizarEmail } from '../../domains/acesso/email'
import { conferirInclusao, conferirMudanca, montarLista } from '../../domains/acesso/listaDeAcesso'
import type { LinhaDaLista, Mudanca, Recusa } from '../../domains/acesso/listaDeAcesso'
import { ehPapel, PAPEIS, ROTULO_DO_PAPEL } from '../../domains/acesso/papeis'
import type { Papel } from '../../domains/acesso/papeis'
import { ErroDeAcesso } from '../../domains/acesso/portas'
import type { MotivoDoErro, RepositorioDeAcesso } from '../../domains/acesso/portas'
import type { UsuarioDaSessao } from '../../domains/acesso/sessao'
import { Mensagem } from '../../shared/ui/Mensagem'

/** Textos fixos da aba (PLA-002, Tarefa 5). Nenhum vem do servidor nem de um erro. */
export const TEXTO_DA_ABA = {
  emailInvalido: 'Digite um e-mail válido.',
  duplicado: 'Esse e-mail já está na lista.',
  propriaLinha: 'Você não pode alterar o próprio acesso; peça a outro admin.',
  ultimoAdmin: 'A lista precisa de ao menos um admin.',
  semMudanca: 'O papel já é esse.',
  mudou: 'A lista ou o seu papel mudou; conferindo de novo.',
  naoSalvou: 'Não foi possível salvar. Tente de novo.',
  naoCarregou: 'Não foi possível carregar a lista.',
  atualizada: 'Lista atualizada.',
} as const

const TEXTO_DA_RECUSA: Record<Recusa, string> = {
  duplicado: TEXTO_DA_ABA.duplicado,
  inexistente: TEXTO_DA_ABA.mudou,
  propria_linha: TEXTO_DA_ABA.propriaLinha,
  sem_mudanca: TEXTO_DA_ABA.semMudanca,
  ultimo_admin: TEXTO_DA_ABA.ultimoAdmin,
}

type Aviso = { tom: 'info' | 'erro'; texto: string }
/** Para onde o foco vai depois de uma ação (WCAG 2.4.3): os botões desabilitados durante a escrita perdem o foco. */
type Foco = { tipo: 'campo' } | { tipo: 'linha'; email: string } | { tipo: 'status' } | { tipo: 'erro' }
type Carga = { tipo: 'carregando' } | { tipo: 'pronta'; lista: LinhaDaLista[] } | { tipo: 'falha' }

function motivoDe(erro: unknown): MotivoDoErro {
  return erro instanceof ErroDeAcesso ? erro.motivo : 'outro'
}

/**
 * Aba Membros (só `admin`; decisão D6): lista de acesso com o nome do perfil, incluir, trocar o papel e
 * remover. Antes de cada escrita, as regras do domínio (`normalizarEmail`, `conferirInclusao`,
 * `conferirMudanca`); recusa local → mensagem e nenhuma chamada ao repositório. A própria linha não tem
 * controles: o banco também recusa (D1); a interface é defesa em profundidade e mensagem clara.
 */
export function AbaMembros({
  repo,
  usuario,
  reavaliar,
}: {
  repo: RepositorioDeAcesso
  usuario: UsuarioDaSessao
  reavaliar: () => void
}): ReactNode {
  const [carga, setCarga] = useState<Carga>({ tipo: 'carregando' })
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [email, setEmail] = useState('')
  const [papelNovo, setPapelNovo] = useState<Papel>('equipe')
  const [rascunhos, setRascunhos] = useState<Record<string, Papel>>({})
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const prefixo = useId()
  const focoPendente = useRef<Foco | null>(null)
  const campoRef = useRef<HTMLInputElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  const erroRef = useRef<HTMLDivElement>(null)
  const botoesSalvar = useRef(new Map<string, HTMLButtonElement>())
  const montada = useRef(true)
  const ultimaLeitura = useRef(0)
  // `reavaliar` fica numa ref: um callback novo a cada render do pai não pode recriar `carregar` e reler a lista
  const reavaliarAtual = useRef(reavaliar)
  useEffect(() => {
    reavaliarAtual.current = reavaliar
  }, [reavaliar])

  /** Lê a lista; só a leitura mais recente aplica (uma resposta velha não troca uma nova). */
  const carregar = useCallback(async (): Promise<void> => {
    const numero = ++ultimaLeitura.current
    try {
      const [permitidos, perfis] = await Promise.all([repo.listarPermitidos(), repo.listarPerfis()])
      if (!montada.current || numero !== ultimaLeitura.current) return
      setCarga({ tipo: 'pronta', lista: montarLista(permitidos, perfis) })
      setRascunhos({})
      setConfirmando(null)
    } catch (erro) {
      if (!montada.current || numero !== ultimaLeitura.current) return
      setCarga({ tipo: 'falha' })
      if (motivoDe(erro) === 'sessao_expirada') reavaliarAtual.current()
    }
  }, [repo])

  useEffect(() => {
    montada.current = true
    void carregar()
    return () => {
      montada.current = false
    }
  }, [carregar])

  // Depois de cada render: se uma ação pediu foco e a escrita acabou (os controles já voltaram a ficar
  // habilitados), põe o foco no alvo. Sem isso, o navegador manda o foco para o <body>. `useLayoutEffect`: o foco
  // muda no mesmo commit que mostra o aviso; num `useEffect`, fora de evento, ele rodaria depois da pintura e o
  // aviso apareceria com o foco ainda no <body> (VER-028, VER-033).
  useLayoutEffect(() => {
    const alvo = focoPendente.current
    if (alvo === null || ocupado) return
    focoPendente.current = null
    const elemento =
      alvo.tipo === 'campo' ? campoRef.current
      : alvo.tipo === 'erro' ? erroRef.current
      : alvo.tipo === 'linha' ? (botoesSalvar.current.get(alvo.email) ?? statusRef.current)
      : statusRef.current
    elemento?.focus()
  })

  const lista = carga.tipo === 'pronta' ? carga.lista : []

  function mostrar(novo: Aviso, foco: Foco | null) {
    setAviso(novo)
    focoPendente.current = novo.tom === 'erro' ? { tipo: 'erro' } : foco
  }

  /** Faz uma escrita já conferida e trata o resultado com as mensagens fixas. Devolve se deu certo. */
  async function escrever(acao: () => Promise<void>, focoNoSucesso: Foco): Promise<boolean> {
    setOcupado(true)
    setAviso(null)
    try {
      await acao()
      await carregar()
      if (montada.current) mostrar({ tom: 'info', texto: TEXTO_DA_ABA.atualizada }, focoNoSucesso)
      return true
    } catch (erro) {
      if (!montada.current) return false
      const motivo = motivoDe(erro)
      if (motivo === 'duplicado') mostrar({ tom: 'erro', texto: TEXTO_DA_ABA.duplicado }, null)
      else if (motivo === 'invalido') mostrar({ tom: 'erro', texto: TEXTO_DA_ABA.emailInvalido }, null)
      else if (motivo === 'negado' || motivo === 'nada_alterado') {
        mostrar({ tom: 'erro', texto: TEXTO_DA_ABA.mudou }, null)
        reavaliar()
        void carregar()
      } else if (motivo === 'sessao_expirada') reavaliar()
      else mostrar({ tom: 'erro', texto: TEXTO_DA_ABA.naoSalvou }, null)
      return false
    } finally {
      if (montada.current) setOcupado(false)
    }
  }

  async function aoIncluir(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (carga.tipo !== 'pronta') return
    const normalizado = normalizarEmail(email)
    if (!normalizado.ok) {
      mostrar({ tom: 'erro', texto: TEXTO_DA_ABA.emailInvalido }, null)
      return
    }
    const recusa = conferirInclusao(lista, normalizado.email)
    if (recusa !== null) {
      mostrar({ tom: 'erro', texto: TEXTO_DA_RECUSA[recusa] }, null)
      return
    }
    if (await escrever(() => repo.incluir(normalizado.email, papelNovo, usuario.id), { tipo: 'campo' })) setEmail('')
  }

  function aoMudar(linha: LinhaDaLista, mudanca: Mudanca) {
    const recusa = conferirMudanca(lista, linha.email, mudanca, usuario.email)
    if (recusa !== null) {
      setConfirmando(null)
      mostrar({ tom: 'erro', texto: TEXTO_DA_RECUSA[recusa] }, null)
      return
    }
    // Depois de salvar, o foco volta ao "Salvar papel" da linha; depois de remover (a linha some), ao aviso.
    void escrever(
      () => (mudanca.tipo === 'remover' ? repo.remover(linha.email) : repo.alterarPapel(linha.email, mudanca.papel)),
      mudanca.tipo === 'remover' ? { tipo: 'status' } : { tipo: 'linha', email: linha.email },
    )
  }

  return (
    <div className="membros">
      <h2>Membros</h2>
      {/* Regiões de aviso sempre montadas (o texto entra depois, para o leitor de tela anunciar); vazias, ficam
          fora do fluxo (.so-leitor). `tabIndex={-1}` deixa o foco ir para elas depois de uma ação. */}
      <div ref={statusRef} role="status" tabIndex={-1} className={aviso?.tom === 'info' ? 'mensagem' : 'so-leitor'}>
        {aviso?.tom === 'info' ? aviso.texto : null}
      </div>
      <div ref={erroRef} role="alert" tabIndex={-1} className={aviso?.tom === 'erro' ? 'mensagem mensagem--erro' : 'so-leitor'}>
        {aviso?.tom === 'erro' ? aviso.texto : null}
      </div>

      <form className="membros__incluir" onSubmit={aoIncluir} noValidate>
        <div className="campo">
          <label htmlFor={`${prefixo}-email`}>E-mail</label>
          <input
            id={`${prefixo}-email`}
            ref={campoRef}
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="campo">
          <label htmlFor={`${prefixo}-papel`}>Papel</label>
          <select
            id={`${prefixo}-papel`}
            value={papelNovo}
            onChange={(e) => {
              if (ehPapel(e.target.value)) setPapelNovo(e.target.value)
            }}
          >
            {PAPEIS.map((p) => (
              <option key={p} value={p}>{ROTULO_DO_PAPEL[p]}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="botao" disabled={ocupado || carga.tipo !== 'pronta'}>Incluir</button>
      </form>

      {carga.tipo === 'carregando' && <p role="status">Carregando a lista…</p>}
      {carga.tipo === 'falha' && (
        <>
          <Mensagem tom="erro">{TEXTO_DA_ABA.naoCarregou}</Mensagem>
          <button
            type="button"
            className="botao botao--contorno"
            onClick={() => {
              setCarga({ tipo: 'carregando' })
              void carregar()
            }}
          >
            Tentar de novo
          </button>
        </>
      )}
      {carga.tipo === 'pronta' && (
        <div className="tabela-rolavel">
          <table className="tabela">
            <caption>Lista de acesso ({lista.length} {lista.length === 1 ? 'e-mail' : 'e-mails'})</caption>
            <thead>
              <tr>
                <th scope="col">E-mail</th>
                <th scope="col">Nome</th>
                <th scope="col">Papel</th>
                <th scope="col">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((linha) => {
                const propria = mesmoEmail(linha.email, usuario.email)
                const rascunho = rascunhos[linha.email] ?? linha.papel
                const idDoPapel = `${prefixo}-papel-${linha.email}`
                return (
                  <tr key={linha.email}>
                    <td className="tabela__email">{linha.email}</td>
                    <td>{linha.jaEntrou ? linha.nome || '—' : <span className="tabela__fraco">ainda não entrou</span>}</td>
                    <td>
                      {propria ? (
                        ROTULO_DO_PAPEL[linha.papel]
                      ) : (
                        <>
                          <label className="so-leitor" htmlFor={idDoPapel}>Papel de {linha.email}</label>
                          <select
                            id={idDoPapel}
                            value={rascunho}
                            disabled={ocupado}
                            onChange={(e) => {
                              const valor = e.target.value
                              if (ehPapel(valor)) setRascunhos((r) => ({ ...r, [linha.email]: valor }))
                            }}
                          >
                            {PAPEIS.map((p) => (
                              <option key={p} value={p}>{ROTULO_DO_PAPEL[p]}</option>
                            ))}
                          </select>
                        </>
                      )}
                    </td>
                    <td>
                      {propria ? (
                        <div className="tabela__acoes">
                          <span className="etiqueta">Você</span>
                          <span className="tabela__aviso">{TEXTO_DA_ABA.propriaLinha}</span>
                        </div>
                      ) : confirmando === linha.email ? (
                        <div className="tabela__acoes">
                          <button
                            type="button"
                            className="botao botao--pequeno"
                            disabled={ocupado}
                            onClick={() => aoMudar(linha, { tipo: 'remover' })}
                          >
                            Confirmar remoção
                          </button>
                          <button
                            type="button"
                            className="botao botao--pequeno botao--contorno"
                            disabled={ocupado}
                            onClick={() => setConfirmando(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="tabela__acoes">
                          <button
                            ref={(botao) => {
                              if (botao) botoesSalvar.current.set(linha.email, botao)
                              else botoesSalvar.current.delete(linha.email)
                            }}
                            type="button"
                            className="botao botao--pequeno botao--ciano"
                            disabled={ocupado}
                            onClick={() => aoMudar(linha, { tipo: 'papel', papel: rascunho })}
                          >
                            Salvar papel
                          </button>
                          <button
                            type="button"
                            className="botao botao--pequeno botao--contorno"
                            disabled={ocupado}
                            onClick={() => setConfirmando(linha.email)}
                          >
                            Remover
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
