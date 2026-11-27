import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Cena } from '../../domains/preparacao/cenas'
import { ACOES, conferirGesto, GESTOS, normalizarGesto, sugestoesDeSom } from '../../domains/preparacao/gestos'
import type { AcaoDoGesto, Gesto, LinhaDoMapa } from '../../domains/preparacao/gestos'
import type { Som } from '../../domains/preparacao/midia'
import { ErroDePreparacao } from '../../domains/preparacao/portas'
import type { MotivoDaPreparacao, ServicosDePreparacao } from '../../domains/preparacao/portas'
import { Mensagem } from '../../shared/ui/Mensagem'

/** Textos fixos da aba (PLA-003, Tarefa 6, e D12). Nenhum vem do servidor nem de um erro. */
export const TEXTO_DOS_GESTOS = {
  faltaSom: 'Escolha o som.',
  faltaCena: 'Escolha a cena.',
  alvoInexistente: 'Esse alvo não existe mais; a lista foi recarregada.',
  semSons: 'Envie um som na Biblioteca.',
  semCenas: 'Inclua uma cena na aba Cenas.',
  salvo: 'Gesto salvo.',
  mudou: 'O mapa de gestos ou o seu papel mudou; conferindo de novo.',
  naoConcluiu: 'Não foi possível concluir. Tente de novo.',
  naoCarregou: 'Não foi possível carregar o mapa de gestos.',
  semLinha: 'Sem linha no banco.',
} as const

const EMOJI_DO_GESTO = new Map(GESTOS.map((g) => [g.gesto, g.emoji]))
const NOMES_DE_ACAO: readonly string[] = ACOES.map((a) => a.acao)

type Dados = { mapa: LinhaDoMapa[]; cenas: Cena[]; sons: Som[] }
type Carga = { tipo: 'carregando' } | { tipo: 'pronta'; dados: Dados } | { tipo: 'falha' }
type Aviso = { tom: 'info' | 'erro'; texto: string }
/** O que a pessoa escolheu numa linha e ainda não salvou (os alvos ficam até salvar: `normalizarGesto` os zera na hora). */
type Rascunho = { acao: AcaoDoGesto; cenaId: string | null; somId: string | null }
type Foco = { tipo: 'status' } | { tipo: 'erro' } | { tipo: 'salvar'; gesto: Gesto }

function motivoDe(erro: unknown): MotivoDaPreparacao {
  return erro instanceof ErroDePreparacao ? erro.motivo : 'outro'
}

function ehAcao(valor: string): valor is AcaoDoGesto {
  return NOMES_DE_ACAO.includes(valor)
}

function porOrdem<T extends { ordem: number }>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) => a.ordem - b.ordem)
}

function rotuloDaCena(c: Cena): string {
  return c.nomeExibicao === c.nomeObs ? c.nomeExibicao : `${c.nomeExibicao} (${c.nomeObs})`
}

function rotuloDoSom(s: Som): string {
  return s.emoji ? `${s.emoji} ${s.rotulo}` : s.rotulo
}

/**
 * Aba Gestos (E2, Tarefa 6): o mapa global dos 7 gestos (DES-001 §7), uma linha por gesto, na ordem de
 * `GESTOS`, com o seletor de ação e, quando a ação pede, o de cena ou de som. Antes de gravar, a linha é
 * normalizada (`normalizarGesto`: o alvo de outra ação vai nulo) e conferida (`conferirGesto`, D12). As 7
 * linhas existem desde a E0 e a aba só faz `update` (sem inserir nem apagar). Mostra as sugestões do
 * DES-001 §7 (👍 → "aplauso", 👎 → "buuu"). Quem nega é a RLS: escrita negada → mensagem, `reavaliar()`
 * e recarga; alvo que sumiu (o `CHECK` ou a chave estrangeira recusam) → mensagem e recarga.
 */
export function AbaGestos({ servicos, reavaliar }: { servicos: ServicosDePreparacao; reavaliar: () => void }): ReactNode {
  const [carga, setCarga] = useState<Carga>({ tipo: 'carregando' })
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [rascunhos, setRascunhos] = useState<Partial<Record<Gesto, Rascunho>>>({})
  const prefixo = useId()

  const montada = useRef(true)
  const ultimaLeitura = useRef(0)
  const escrevendo = useRef(false)
  const focoPendente = useRef<Foco | null>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  const erroRef = useRef<HTMLDivElement>(null)
  const botoes = useRef(new Map<Gesto, HTMLButtonElement>())
  const reavaliarAtual = useRef(reavaliar)
  useEffect(() => {
    reavaliarAtual.current = reavaliar
  }, [reavaliar])

  /** Lê o mapa, as cenas e os sons juntos; só a leitura mais recente aplica. */
  const carregar = useCallback(async (): Promise<void> => {
    const numero = ++ultimaLeitura.current
    try {
      const [mapa, cenas, sons] = await Promise.all([servicos.gestos.listar(), servicos.cenas.listar(), servicos.sons.listar()])
      if (!montada.current || numero !== ultimaLeitura.current) return
      setCarga({ tipo: 'pronta', dados: { mapa, cenas: porOrdem(cenas), sons: porOrdem(sons) } })
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
    const elemento =
      alvo.tipo === 'erro' ? erroRef.current
      : alvo.tipo === 'status' ? statusRef.current
      : (botoes.current.get(alvo.gesto) ?? statusRef.current)
    elemento?.focus()
  })

  function mostrar(novo: Aviso, foco: Foco | null) {
    setAviso(novo)
    if (foco !== null) focoPendente.current = foco
  }

  function descartarRascunho(gesto: Gesto) {
    setRascunhos((r) => {
      const resto = { ...r }
      delete resto[gesto]
      return resto
    })
  }

  /** O alvo escolhido já não existe: mensagem, o rascunho da linha volta ao que o banco tem e a lista recarrega. */
  function alvoQueSumiu(gesto: Gesto) {
    descartarRascunho(gesto)
    mostrar({ tom: 'erro', texto: TEXTO_DOS_GESTOS.alvoInexistente }, { tipo: 'erro' })
    void carregar()
  }

  /**
   * Mensagem fixa por motivo; o foco vai para o aviso de erro. `invalido` (o `CHECK` de equivalência) e
   * `em_uso` (no `update`, o `23503` é a chave estrangeira para uma cena ou um som apagado) querem dizer
   * que o alvo sumiu entre a carga e o "Salvar".
   */
  function tratarErro(erro: unknown, gesto: Gesto) {
    const motivo = motivoDe(erro)
    if (motivo === 'invalido' || motivo === 'em_uso') alvoQueSumiu(gesto)
    else if (motivo === 'negado' || motivo === 'nada_alterado') {
      mostrar({ tom: 'erro', texto: TEXTO_DOS_GESTOS.mudou }, { tipo: 'erro' })
      reavaliarAtual.current()
      void carregar()
    } else if (motivo === 'sessao_expirada') reavaliarAtual.current()
    else mostrar({ tom: 'erro', texto: TEXTO_DOS_GESTOS.naoConcluiu }, { tipo: 'erro' })
  }

  /** Normaliza, confere e grava uma linha (uma escrita de cada vez: clique duplo não duplica). */
  async function gravar(dados: Dados, rascunho: LinhaDoMapa, focoNoSucesso: Foco) {
    if (escrevendo.current) return
    const linha = normalizarGesto(rascunho)
    const recusa = conferirGesto(linha, dados.cenas, dados.sons)
    if (recusa === 'falta_som' || recusa === 'falta_cena') {
      mostrar({ tom: 'erro', texto: recusa === 'falta_som' ? TEXTO_DOS_GESTOS.faltaSom : TEXTO_DOS_GESTOS.faltaCena }, { tipo: 'erro' })
      return
    }
    if (recusa === 'alvo_inexistente') {
      alvoQueSumiu(linha.gesto)
      return
    }
    escrevendo.current = true
    setOcupado(true)
    setAviso(null)
    try {
      await servicos.gestos.alterar(linha)
      if (!montada.current) return
      descartarRascunho(linha.gesto)
      await carregar()
      if (montada.current) mostrar({ tom: 'info', texto: TEXTO_DOS_GESTOS.salvo }, focoNoSucesso)
    } catch (erro) {
      if (montada.current) tratarErro(erro, linha.gesto)
    } finally {
      escrevendo.current = false
      if (montada.current) setOcupado(false)
    }
  }

  const dados = carga.tipo === 'pronta' ? carga.dados : null
  const sugestoes = dados ? sugestoesDeSom(dados.mapa, dados.sons) : []
  const idSemSons = `${prefixo}-sem-sons`
  const idSemCenas = `${prefixo}-sem-cenas`
  const descricao = dados ? [dados.sons.length === 0 ? idSemSons : '', dados.cenas.length === 0 ? idSemCenas : ''].filter(Boolean).join(' ') : ''

  function rascunhoDe(linha: LinhaDoMapa): Rascunho {
    return rascunhos[linha.gesto] ?? { acao: linha.acao, cenaId: linha.cenaId, somId: linha.somId }
  }

  function editar(linha: LinhaDoMapa, mudanca: Partial<Rascunho>) {
    setRascunhos((r) => ({ ...r, [linha.gesto]: { ...(r[linha.gesto] ?? { acao: linha.acao, cenaId: linha.cenaId, somId: linha.somId }), ...mudanca } }))
  }

  function linhaDoGesto(d: Dados, gesto: Gesto): ReactNode {
    const linha = d.mapa.find((l) => l.gesto === gesto)
    const id = `${prefixo}-${gesto}`
    if (!linha) return <p className="tabela__fraco">{TEXTO_DOS_GESTOS.semLinha}</p>
    const r = rascunhoDe(linha)
    // um alvo que não está na lista (apagado entre as leituras) aparece como "Escolha…"; ao salvar, a conferência o acusa
    const cenaMostrada = r.cenaId !== null && d.cenas.some((c) => c.id === r.cenaId) ? r.cenaId : ''
    const somMostrado = r.somId !== null && d.sons.some((s) => s.id === r.somId) ? r.somId : ''
    return (
      <div className="gestos__campos">
        <div className="campo">
          <label htmlFor={`${id}-acao`}>Ação</label>
          <select
            id={`${id}-acao`}
            value={r.acao}
            disabled={ocupado}
            aria-describedby={descricao || undefined}
            onChange={(e) => {
              const valor = e.target.value
              if (ehAcao(valor)) editar(linha, { acao: valor })
            }}
          >
            {ACOES.map((a) => (
              <option key={a.acao} value={a.acao} disabled={(a.acao === 'som' && d.sons.length === 0) || (a.acao === 'cena' && d.cenas.length === 0)}>
                {a.rotulo}
              </option>
            ))}
          </select>
        </div>
        {r.acao === 'cena' && (
          <div className="campo">
            <label htmlFor={`${id}-cena`}>Cena</label>
            <select id={`${id}-cena`} value={cenaMostrada} disabled={ocupado} onChange={(e) => editar(linha, { cenaId: e.target.value || null })}>
              <option value="">Escolha a cena</option>
              {d.cenas.map((c) => (
                <option key={c.id} value={c.id}>{rotuloDaCena(c)}</option>
              ))}
            </select>
          </div>
        )}
        {r.acao === 'som' && (
          <div className="campo">
            <label htmlFor={`${id}-som`}>Som</label>
            <select id={`${id}-som`} value={somMostrado} disabled={ocupado} onChange={(e) => editar(linha, { somId: e.target.value || null })}>
              <option value="">Escolha o som</option>
              {d.sons.map((s) => (
                <option key={s.id} value={s.id}>{rotuloDoSom(s)}</option>
              ))}
            </select>
          </div>
        )}
        <button
          ref={(botao) => {
            if (botao) botoes.current.set(gesto, botao)
            else botoes.current.delete(gesto)
          }}
          type="button"
          className="botao botao--pequeno botao--ciano"
          disabled={ocupado}
          onClick={() => void gravar(d, { gesto, ...r }, { tipo: 'salvar', gesto })}
        >
          Salvar
        </button>
      </div>
    )
  }

  return (
    <div className="gestos-aba">
      <h2>Gestos</h2>
      {/* Regiões de aviso sempre montadas (o texto entra depois, para o leitor de tela anunciar); vazias, ficam
          fora do fluxo (.so-leitor). `tabIndex={-1}` deixa o foco ir para elas depois de uma ação. */}
      <div ref={statusRef} role="status" tabIndex={-1} className={aviso?.tom === 'info' ? 'mensagem' : 'so-leitor'}>
        {aviso?.tom === 'info' ? aviso.texto : null}
      </div>
      <div ref={erroRef} role="alert" tabIndex={-1} className={aviso?.tom === 'erro' ? 'mensagem mensagem--erro' : 'so-leitor'}>
        {aviso?.tom === 'erro' ? aviso.texto : null}
      </div>
      <p>O mapa vale para todos os episódios.</p>

      {carga.tipo === 'carregando' && <p role="status">Carregando o mapa de gestos…</p>}
      {carga.tipo === 'falha' && (
        <>
          <Mensagem tom="erro">{TEXTO_DOS_GESTOS.naoCarregou}</Mensagem>
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

      {dados !== null && (
        <>
          {sugestoes.length > 0 && (
            <div className="sugestoes">
              <p className="sugestoes__titulo">Sugestão do mapa padrão</p>
              <div className="tabela__acoes">
                {sugestoes.map((s) => (
                  <button
                    key={s.gesto}
                    type="button"
                    className="botao botao--pequeno"
                    disabled={ocupado}
                    onClick={() => void gravar(dados, { gesto: s.gesto, acao: 'som', cenaId: null, somId: s.som.id }, { tipo: 'status' })}
                  >
                    {`Ligar ${EMOJI_DO_GESTO.get(s.gesto) ?? s.gesto} ao som ${s.som.rotulo.trim()}`}
                  </button>
                ))}
              </div>
            </div>
          )}
          {dados.sons.length === 0 && <p id={idSemSons} className="gestos__dica">{TEXTO_DOS_GESTOS.semSons}</p>}
          {dados.cenas.length === 0 && <p id={idSemCenas} className="gestos__dica">{TEXTO_DOS_GESTOS.semCenas}</p>}
          <ul className="gestos" aria-label="Mapa de gestos">
            {GESTOS.map((g) => (
              <li key={g.gesto} aria-labelledby={`${prefixo}-${g.gesto}-nome`}>
                <div className="gestos__cabeca">
                  <span className="gestos__emoji" aria-hidden="true">{g.emoji}</span>
                  <span className="gestos__nome" id={`${prefixo}-${g.gesto}-nome`}>{g.rotulo}</span>
                </div>
                {linhaDoGesto(dados, g.gesto)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
