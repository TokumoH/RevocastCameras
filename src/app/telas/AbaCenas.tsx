import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import { conferirCena } from '../../domains/preparacao/cenas'
import type { Cena, RecusaDaCena } from '../../domains/preparacao/cenas'
import { trocarOrdem } from '../../domains/preparacao/episodios'
import { GESTOS } from '../../domains/preparacao/gestos'
import type { Gesto, LinhaDoMapa } from '../../domains/preparacao/gestos'
import { ErroDePreparacao } from '../../domains/preparacao/portas'
import type { MotivoDaPreparacao, ServicosDePreparacao } from '../../domains/preparacao/portas'
import { usosDaCena } from '../../domains/preparacao/usos'
import { Mensagem } from '../../shared/ui/Mensagem'

/** Textos fixos da aba (PLA-003, Tarefa 6). Nenhum vem do servidor nem de um erro. */
export const TEXTO_DAS_CENAS = {
  nomeVazio: 'Dê um nome à cena.',
  nomeObsVazio: 'Informe o nome da cena no OBS.',
  nomeObsDuplicado: 'Já existe uma cena com esse nome no OBS.',
  emUso: 'Esta cena está ligada a um gesto. Troque o gesto antes de excluir.',
  mudou: 'As cenas ou o seu papel mudaram; conferindo de novo.',
  naoConcluiu: 'Não foi possível concluir. Tente de novo.',
  naoCarregou: 'Não foi possível carregar as cenas.',
  dica: 'Escreva o nome exatamente como está no OBS (maiúsculas e espaços contam)',
  incluida: 'Cena incluída.',
  salva: 'Cena salva.',
  excluida: 'Cena excluída.',
  ordem: 'Ordem atualizada.',
} as const

const TEXTO_DA_RECUSA: Record<RecusaDaCena, string> = {
  nome_vazio: TEXTO_DAS_CENAS.nomeVazio,
  nome_obs_vazio: TEXTO_DAS_CENAS.nomeObsVazio,
  nome_obs_duplicado: TEXTO_DAS_CENAS.nomeObsDuplicado,
}

const EMOJI_DO_GESTO = new Map(GESTOS.map((g) => [g.gesto, g.emoji]))

type Dados = { cenas: Cena[]; mapa: LinhaDoMapa[] }
type Carga = { tipo: 'carregando' } | { tipo: 'pronta'; dados: Dados } | { tipo: 'falha' }
type Aviso = { tom: 'info' | 'erro'; texto: string }
type Edicao = { id: string; nomeExibicao: string; nomeObs: string }
type Direcao = 'subir' | 'descer'
/** Para onde o foco vai depois de uma ação (WCAG 2.4.3): os botões que somem ou ficam desabilitados perdem o foco. */
type Foco =
  | { tipo: 'status' }
  | { tipo: 'erro' }
  | { tipo: 'campo' }
  | { tipo: 'edicao' }
  | { tipo: 'botao'; chave: string }
  /** Depois de subir ou descer: o mesmo botão da cena movida ou, se ele ficou desabilitado na ponta, o outro. */
  | { tipo: 'ordem'; id: string; direcao: Direcao }

function motivoDe(erro: unknown): MotivoDaPreparacao {
  return erro instanceof ErroDePreparacao ? erro.motivo : 'outro'
}

/** As cenas pela ordem do campo `ordem`; empates na ordem da lista (a mesma regra de `trocarOrdem`). */
function ordenadas(cenas: readonly Cena[]): Cena[] {
  return [...cenas].sort((a, b) => a.ordem - b.ordem)
}

/** Ordem da próxima cena: depois da última. */
function proximaOrdem(cenas: readonly Cena[]): number {
  return cenas.reduce((maior, c) => Math.max(maior, c.ordem + 1), 0)
}

function textoDosGestos(gestos: readonly Gesto[]): string {
  const emojis = gestos.map((g) => EMOJI_DO_GESTO.get(g) ?? g).join(', ')
  return gestos.length === 1 ? `Usada no gesto ${emojis}` : `Usada nos gestos ${emojis}`
}

/**
 * Aba Cenas (E2, Tarefa 6): tabela das cenas do OBS (ordem, nome na tela, nome exato no OBS), com
 * "Subir"/"Descer" (`trocarOrdem`; grava cada cena cuja ordem mudou, inclusive a renumeração quando
 * há empate), edição na linha, exclusão com confirmação que diz os gestos que usam a cena (bloqueada,
 * D11) e o formulário "Incluir cena". O nome no OBS é gravado como digitado (o OBS diferencia caixa e
 * espaços); o nome na tela é aparado. Quem nega é a RLS: uma escrita negada mostra a mensagem fixa,
 * pede `reavaliar()` e recarrega.
 */
export function AbaCenas({ servicos, reavaliar }: { servicos: ServicosDePreparacao; reavaliar: () => void }): ReactNode {
  const [carga, setCarga] = useState<Carga>({ tipo: 'carregando' })
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [novoObs, setNovoObs] = useState('')
  const [edicao, setEdicao] = useState<Edicao | null>(null)
  const [confirmacao, setConfirmacao] = useState<string | null>(null)
  const prefixo = useId()

  const montada = useRef(true)
  const ultimaLeitura = useRef(0)
  /** Guarda síncrona contra clique duplo: o `ocupado` só desabilita os botões no próximo render. */
  const escrevendo = useRef(false)
  const focoPendente = useRef<Foco | null>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  const erroRef = useRef<HTMLDivElement>(null)
  const campoRef = useRef<HTMLInputElement>(null)
  const edicaoRef = useRef<HTMLInputElement>(null)
  const botoes = useRef(new Map<string, HTMLButtonElement>())
  const reavaliarAtual = useRef(reavaliar)
  useEffect(() => {
    reavaliarAtual.current = reavaliar
  }, [reavaliar])

  /** Lê as cenas e o mapa de gestos juntos (o mapa diz quais cenas estão em uso); só a leitura mais recente aplica. */
  const carregar = useCallback(async (): Promise<void> => {
    const numero = ++ultimaLeitura.current
    try {
      const [cenas, mapa] = await Promise.all([servicos.cenas.listar(), servicos.gestos.listar()])
      if (!montada.current || numero !== ultimaLeitura.current) return
      setCarga({ tipo: 'pronta', dados: { cenas, mapa } })
    } catch (erro) {
      if (!montada.current || numero !== ultimaLeitura.current) return
      setCarga({ tipo: 'falha' })
      if (motivoDe(erro) === 'sessao_expirada') reavaliarAtual.current()
    }
  }, [servicos])

  useEffect(() => {
    montada.current = true
    void carregar()
    return () => {
      montada.current = false
    }
  }, [carregar])

  // Foco no mesmo commit que mostra o aviso (`useLayoutEffect`, como na Biblioteca), quando nenhuma escrita está em curso.
  useLayoutEffect(() => {
    const alvo = focoPendente.current
    if (alvo === null || ocupado) return
    focoPendente.current = null
    let elemento: HTMLElement | null | undefined
    if (alvo.tipo === 'erro') elemento = erroRef.current
    else if (alvo.tipo === 'status') elemento = statusRef.current
    else if (alvo.tipo === 'campo') elemento = campoRef.current
    else if (alvo.tipo === 'edicao') elemento = edicaoRef.current
    else if (alvo.tipo === 'botao') elemento = botoes.current.get(alvo.chave)
    else {
      const outra: Direcao = alvo.direcao === 'subir' ? 'descer' : 'subir'
      const mesmo = botoes.current.get(`${alvo.direcao}:${alvo.id}`)
      elemento = mesmo && !mesmo.disabled ? mesmo : botoes.current.get(`${outra}:${alvo.id}`)
    }
    const destino = elemento ?? statusRef.current
    destino?.focus()
  })

  function refDoBotao(chave: string) {
    return (botao: HTMLButtonElement | null) => {
      if (botao) botoes.current.set(chave, botao)
      else botoes.current.delete(chave)
    }
  }

  function mostrar(novo: Aviso, foco: Foco | null) {
    setAviso(novo)
    if (foco !== null) focoPendente.current = foco
  }

  /**
   * Mensagem fixa por motivo; o foco vai para o aviso de erro. `recarregarSempre`: a ação pode ter
   * gravado em parte (a troca de ordem grava uma cena por vez), então a lista recarrega em qualquer falha
   * (menos na sessão expirada: a leitura também falharia e pediria `reavaliar()` de novo).
   */
  function tratarErro(erro: unknown, recarregarSempre: boolean) {
    const motivo = motivoDe(erro)
    const foco: Foco = { tipo: 'erro' }
    if (motivo === 'sessao_expirada') {
      reavaliarAtual.current()
      return
    }
    let recarregar = recarregarSempre
    if (motivo === 'duplicado') mostrar({ tom: 'erro', texto: TEXTO_DAS_CENAS.nomeObsDuplicado }, foco)
    else if (motivo === 'em_uso') {
      mostrar({ tom: 'erro', texto: TEXTO_DAS_CENAS.emUso }, foco)
      recarregar = true
    } else if (motivo === 'negado' || motivo === 'nada_alterado') {
      mostrar({ tom: 'erro', texto: TEXTO_DAS_CENAS.mudou }, foco)
      reavaliarAtual.current()
      recarregar = true
    } else mostrar({ tom: 'erro', texto: TEXTO_DAS_CENAS.naoConcluiu }, foco)
    if (recarregar) void carregar()
  }

  /** Escrita da pessoa: uma de cada vez (clique duplo não duplica), recarga, mensagem fixa e foco previsível. */
  async function escrever(
    acao: () => Promise<void>,
    textoDoSucesso: string,
    focoNoSucesso: Foco,
    opcoes: { aoDarCerto?: () => void; aoFalhar?: () => void; recarregarSempre?: boolean } = {},
  ) {
    if (escrevendo.current) return
    escrevendo.current = true
    setOcupado(true)
    setAviso(null)
    try {
      await acao()
      if (!montada.current) return
      opcoes.aoDarCerto?.()
      await carregar()
      if (montada.current) mostrar({ tom: 'info', texto: textoDoSucesso }, focoNoSucesso)
    } catch (erro) {
      if (!montada.current) return
      opcoes.aoFalhar?.()
      tratarErro(erro, opcoes.recarregarSempre ?? false)
    } finally {
      escrevendo.current = false
      if (montada.current) setOcupado(false)
    }
  }

  const dados = carga.tipo === 'pronta' ? carga.dados : null
  const cenas = ordenadas(dados?.cenas ?? [])

  function aoIncluir(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (dados === null || escrevendo.current) return
    const nova = { nomeExibicao: novoNome.trim(), nomeObs: novoObs }
    const recusa = conferirCena(nova, dados.cenas, null)
    if (recusa !== null) {
      mostrar({ tom: 'erro', texto: TEXTO_DA_RECUSA[recusa] }, { tipo: 'erro' })
      return
    }
    void escrever(() => servicos.cenas.incluir({ ...nova, ordem: proximaOrdem(dados.cenas) }), TEXTO_DAS_CENAS.incluida, { tipo: 'campo' }, {
      aoDarCerto: () => {
        setNovoNome('')
        setNovoObs('')
      },
    })
  }

  /**
   * Sobe ou desce uma cena. `trocarOrdem` devolve o par trocado ou, com ordens repetidas, a lista inteira
   * renumerada; grava só as cenas cuja ordem mudou, uma por vez. Se uma escrita falha no meio, a lista
   * recarrega (o banco pode ter ficado com parte das ordens novas) e a mensagem aparece.
   */
  function aoMover(c: Cena, direcao: Direcao) {
    if (dados === null || escrevendo.current) return
    const atuais = new Map(dados.cenas.map((x) => [x.id, x]))
    const mudancas = trocarOrdem(dados.cenas, c.id, direcao).filter((m) => atuais.get(m.id)?.ordem !== m.ordem)
    if (mudancas.length === 0) return
    void escrever(
      async () => {
        for (const m of mudancas) {
          const atual = atuais.get(m.id)
          if (!atual) continue
          await servicos.cenas.alterar(m.id, { nomeExibicao: atual.nomeExibicao, nomeObs: atual.nomeObs, ordem: m.ordem })
        }
      },
      TEXTO_DAS_CENAS.ordem,
      { tipo: 'ordem', id: c.id, direcao },
      { recarregarSempre: true },
    )
  }

  function aoEditar(c: Cena) {
    setConfirmacao(null)
    setEdicao({ id: c.id, nomeExibicao: c.nomeExibicao, nomeObs: c.nomeObs })
    focoPendente.current = { tipo: 'edicao' }
  }

  function aoCancelarEdicao(c: Cena) {
    setEdicao(null)
    focoPendente.current = { tipo: 'botao', chave: `editar:${c.id}` }
  }

  function aoSalvarEdicao(c: Cena) {
    if (dados === null || edicao === null || escrevendo.current) return
    const mudada = { nomeExibicao: edicao.nomeExibicao.trim(), nomeObs: edicao.nomeObs }
    const recusa = conferirCena(mudada, dados.cenas, c.id)
    if (recusa !== null) {
      mostrar({ tom: 'erro', texto: TEXTO_DA_RECUSA[recusa] }, { tipo: 'erro' })
      return
    }
    void escrever(() => servicos.cenas.alterar(c.id, { ...mudada, ordem: c.ordem }), TEXTO_DAS_CENAS.salva, { tipo: 'botao', chave: `editar:${c.id}` }, {
      aoDarCerto: () => setEdicao(null),
    })
  }

  /** Enter num campo da edição salva (a linha da tabela não pode ter um `<form>` próprio); Esc cancela. */
  function aoTeclarNaEdicao(evento: KeyboardEvent<HTMLInputElement>, c: Cena) {
    if (evento.key === 'Enter') {
      evento.preventDefault()
      aoSalvarEdicao(c)
    } else if (evento.key === 'Escape') {
      evento.preventDefault()
      aoCancelarEdicao(c)
    }
  }

  function aoPedirExclusao(c: Cena) {
    setConfirmacao(c.id)
    focoPendente.current = { tipo: 'botao', chave: `manter:${c.id}` }
  }

  function aoManter(c: Cena) {
    setConfirmacao(null)
    focoPendente.current = { tipo: 'botao', chave: `excluir:${c.id}` }
  }

  function aoConfirmarExclusao(c: Cena, bloqueia: boolean) {
    if (bloqueia) {
      // defesa em profundidade: o botão já está desabilitado e o banco também recusa (`23503` → `em_uso`)
      mostrar({ tom: 'erro', texto: TEXTO_DAS_CENAS.emUso }, { tipo: 'erro' })
      return
    }
    void escrever(() => servicos.cenas.remover(c.id), TEXTO_DAS_CENAS.excluida, { tipo: 'status' }, {
      aoDarCerto: () => setConfirmacao(null),
      aoFalhar: () => setConfirmacao(null),
    })
  }

  function acoesDe(c: Cena, i: number): ReactNode {
    if (edicao?.id === c.id) {
      return (
        <div className="tabela__acoes">
          <button type="button" className="botao botao--pequeno botao--ciano" disabled={ocupado} onClick={() => aoSalvarEdicao(c)}>
            Salvar
          </button>
          <button type="button" className="botao botao--pequeno botao--contorno" disabled={ocupado} onClick={() => aoCancelarEdicao(c)}>
            Cancelar
          </button>
        </div>
      )
    }
    if (confirmacao === c.id && dados !== null) {
      const gestos = usosDaCena(c.id, dados.mapa)
      const bloqueia = gestos.length > 0
      return (
        <div className="confirmacao-na-linha">
          <span>{bloqueia ? textoDosGestos(gestos) : 'Não está em uso.'}</span>
          {bloqueia && <span>Troque o gesto antes de excluir.</span>}
          <div className="tabela__acoes">
            <button type="button" className="botao botao--pequeno" disabled={ocupado || bloqueia} onClick={() => aoConfirmarExclusao(c, bloqueia)}>
              Confirmar exclusão
            </button>
            <button ref={refDoBotao(`manter:${c.id}`)} type="button" className="botao botao--pequeno botao--contorno" disabled={ocupado} onClick={() => aoManter(c)}>
              Manter
            </button>
          </div>
        </div>
      )
    }
    return (
      <div className="tabela__acoes">
        <button
          ref={refDoBotao(`subir:${c.id}`)}
          type="button"
          className="botao botao--pequeno botao--contorno"
          disabled={ocupado || i === 0}
          onClick={() => aoMover(c, 'subir')}
        >
          Subir
        </button>
        <button
          ref={refDoBotao(`descer:${c.id}`)}
          type="button"
          className="botao botao--pequeno botao--contorno"
          disabled={ocupado || i === cenas.length - 1}
          onClick={() => aoMover(c, 'descer')}
        >
          Descer
        </button>
        {/* com outra linha em edição, "Editar" fica desabilitado: trocar de linha não descarta a edição aberta sem aviso */}
        <button
          ref={refDoBotao(`editar:${c.id}`)}
          type="button"
          className="botao botao--pequeno botao--ciano"
          disabled={ocupado || edicao !== null}
          onClick={() => aoEditar(c)}
        >
          Editar
        </button>
        <button ref={refDoBotao(`excluir:${c.id}`)} type="button" className="botao botao--pequeno botao--contorno" disabled={ocupado} onClick={() => aoPedirExclusao(c)}>
          Excluir
        </button>
      </div>
    )
  }

  const idDica = `${prefixo}-dica`

  return (
    <div className="cenas">
      <h2>Cenas</h2>
      {/* Regiões de aviso sempre montadas (o texto entra depois, para o leitor de tela anunciar); vazias, ficam
          fora do fluxo (.so-leitor). `tabIndex={-1}` deixa o foco ir para elas depois de uma ação. */}
      <div ref={statusRef} role="status" tabIndex={-1} className={aviso?.tom === 'info' ? 'mensagem' : 'so-leitor'}>
        {aviso?.tom === 'info' ? aviso.texto : null}
      </div>
      <div ref={erroRef} role="alert" tabIndex={-1} className={aviso?.tom === 'erro' ? 'mensagem mensagem--erro' : 'so-leitor'}>
        {aviso?.tom === 'erro' ? aviso.texto : null}
      </div>

      <h3 id={`${prefixo}-incluir`}>Incluir cena</h3>
      <form className="formulario-em-linha" aria-labelledby={`${prefixo}-incluir`} onSubmit={aoIncluir} noValidate>
        <div className="campo">
          <label htmlFor={`${prefixo}-nome`}>Nome na tela</label>
          <input ref={campoRef} id={`${prefixo}-nome`} type="text" autoComplete="off" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor={`${prefixo}-obs`}>Nome no OBS</label>
          <input
            id={`${prefixo}-obs`}
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-describedby={idDica}
            value={novoObs}
            onChange={(e) => setNovoObs(e.target.value)}
          />
        </div>
        <button type="submit" className="botao" disabled={ocupado || dados === null}>
          Incluir
        </button>
        <p id={idDica} className="formulario-em-linha__dica">{TEXTO_DAS_CENAS.dica}</p>
      </form>

      {carga.tipo === 'carregando' && <p role="status">Carregando as cenas…</p>}
      {carga.tipo === 'falha' && (
        <>
          <Mensagem tom="erro">{TEXTO_DAS_CENAS.naoCarregou}</Mensagem>
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

      {dados !== null &&
        (cenas.length === 0 ? (
          <p className="tabela__fraco">Nenhuma cena ainda.</p>
        ) : (
          <div className="tabela-rolavel">
            <table className="tabela">
              <caption>Cenas do OBS ({cenas.length} {cenas.length === 1 ? 'cena' : 'cenas'})</caption>
              <thead>
                <tr>
                  <th scope="col">Ordem</th>
                  <th scope="col">Nome na tela</th>
                  <th scope="col">Nome no OBS</th>
                  <th scope="col">Ações</th>
                </tr>
              </thead>
              <tbody>
                {cenas.map((c, i) => {
                  const editando = edicao?.id === c.id ? edicao : null
                  const id = `${prefixo}-${c.id}`
                  return (
                    <tr key={c.id}>
                      <td>{i + 1}</td>
                      <td className="tabela__nome">
                        {editando ? (
                          <>
                            <label className="so-leitor" htmlFor={`${id}-nome`}>Nome na tela de {c.nomeExibicao}</label>
                            <input
                              ref={edicaoRef}
                              id={`${id}-nome`}
                              type="text"
                              autoComplete="off"
                              value={editando.nomeExibicao}
                              onChange={(e) => setEdicao({ ...editando, nomeExibicao: e.target.value })}
                              onKeyDown={(e) => aoTeclarNaEdicao(e, c)}
                            />
                          </>
                        ) : (
                          c.nomeExibicao
                        )}
                      </td>
                      <td className="tabela__nome tabela__obs">
                        {editando ? (
                          <>
                            <label className="so-leitor" htmlFor={`${id}-obs`}>Nome no OBS de {c.nomeExibicao}</label>
                            <input
                              id={`${id}-obs`}
                              type="text"
                                                autoComplete="off"
                              autoCapitalize="off"
                              spellCheck={false}
                              aria-describedby={idDica}
                              value={editando.nomeObs}
                              onChange={(e) => setEdicao({ ...editando, nomeObs: e.target.value })}
                              onKeyDown={(e) => aoTeclarNaEdicao(e, c)}
                            />
                          </>
                        ) : (
                          c.nomeObs
                        )}
                      </td>
                      <td>{acoesDe(c, i)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  )
}
