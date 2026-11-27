import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { linkDePareamento, ROTULO_DO_TIPO, situacaoDoDispositivo } from '../../domains/acesso/dispositivos'
import type { Dispositivo, TipoDeDispositivo } from '../../domains/acesso/dispositivos'
import type { MensagemDoEstudio } from '../../domains/aovivo/mensagens'
import { ErroDoAoVivo } from '../../domains/aovivo/portas'
import type { CanalDoEstudio, RepositorioDoAoVivo, RespostaDoEnvio } from '../../domains/aovivo/portas'
import { matrizDoQr } from '../../shared/infra/qr'
import { CodigoQr } from '../../shared/ui/CodigoQr'
import { Mensagem } from '../../shared/ui/Mensagem'

/** Enquanto um código vale, a lista de dispositivos é consultada de 3 em 3 s para ver o pareamento (D5). */
export const INTERVALO_DA_CONSULTA_MS = 3000

/** Validade do código no banco (D2: 2 min); vale quando o `expiraEm` do servidor não é crível (relógio do computador errado). */
const VALIDADE_DO_CODIGO_MS = 120_000

/** Frases fixas da aba (nenhuma vem do servidor nem de um erro). */
export const TEXTO_DA_ABA_AO_VIVO = Object.freeze({
  titulo: 'Dispositivos',
  carregando: 'Carregando os dispositivos…',
  naoCarregou: 'Não foi possível carregar os dispositivos.',
  nenhum: 'Nenhum dispositivo cadastrado. Gere um link ou um QR abaixo.',
  pareieACamera: 'Pareie a câmera antes.',
  gerando: 'Gerando o código…',
  naoGerou: 'Não foi possível gerar o código. Tente de novo.',
  expirou: 'O código expirou.',
  copiado: 'Link copiado.',
  naoCopiou: 'Não foi possível copiar; selecione o link e copie.',
  pareadoSemAviso: 'Pareado. O aviso à sessão antiga não saiu pelo canal; o corte dela vem em até 10 minutos.',
  revogado: 'Dispositivo revogado.',
  revogadoSemCanal: 'Revogado no banco. O aviso pelo canal não saiu; o corte do canal vem em até 10 minutos.',
  naoRevogou: 'Não foi possível revogar. Tente de novo.',
} as const)

const ROTULO_DA_SITUACAO: Readonly<Record<ReturnType<typeof situacaoDoDispositivo>, string>> = {
  conectado: 'Conectado',
  desconectado: 'Desconectado',
  revogado: 'Revogado',
  nunca_pareado: 'Nunca pareado',
}

/** Rótulo de um dispositivo novo de cada tipo (o painel cria um só de cada, DES-001 §10.2). */
const ROTULO_NOVO: Readonly<Record<TipoDeDispositivo, string>> = {
  camera: 'Celular de gravação',
  obs_palco: 'Palco do OBS',
  obs_camera: 'Câmera do OBS',
}

/** Botão que gera o código de cada tipo e rótulo do campo do link. */
const ACAO_DO_TIPO: Readonly<Record<TipoDeDispositivo, string>> = {
  camera: 'Parear câmera',
  obs_palco: 'Link do palco (OBS)',
  obs_camera: 'Link da câmera do OBS',
}
const ROTULO_DO_LINK: Readonly<Record<TipoDeDispositivo, string>> = {
  camera: 'Link da câmera',
  obs_palco: 'Link do palco (OBS)',
  obs_camera: 'Link da câmera do OBS',
}

/** Frase quando o pareamento aparece na lista. */
const CONECTADO: Readonly<Record<TipoDeDispositivo, string>> = {
  camera: '📷 Câmera conectada',
  obs_palco: '🖥️ Palco conectado',
  obs_camera: '🎥 Câmera do OBS conectada',
}

const ORDEM_DOS_TIPOS: readonly TipoDeDispositivo[] = ['camera', 'obs_palco', 'obs_camera']

/** O código só existe aqui, no estado do componente (D3): some ao expirar, ao parear, ao revogar e ao sair da aba. */
interface CodigoNaTela {
  tipo: TipoDeDispositivo
  dispositivoId: string
  link: string
  /** QR só para a câmera (o celular lê); os do OBS são colados na Fonte. */
  matriz: boolean[][] | null
  /** Instante local em que deixa de valer. */
  fim: number
  /** Sessão anônima do dispositivo quando o código foi gerado: se mudar, houve pareamento, e ela é avisada (D5). */
  antigo: string | null
}

type Pareamento =
  | { estado: 'nenhum' }
  | { estado: 'gerando'; tipo: TipoDeDispositivo }
  | { estado: 'valendo'; codigo: CodigoNaTela }
  | { estado: 'expirou'; tipo: TipoDeDispositivo }
  | { estado: 'pareado'; tipo: TipoDeDispositivo }

type Carga = { tipo: 'carregando' } | { tipo: 'pronta'; lista: Dispositivo[] } | { tipo: 'falha' }
type Aviso = { tom: 'info' | 'erro'; texto: string }

function pedeReavaliacao(erro: unknown): boolean {
  return erro instanceof ErroDoAoVivo && (erro.motivo === 'negado' || erro.motivo === 'sessao_expirada')
}

/** O dispositivo de um tipo que o painel reaproveita: o primeiro não revogado; senão, o primeiro (parear de novo limpa a revogação). */
function existente(lista: readonly Dispositivo[], tipo: TipoDeDispositivo, preferir?: (d: Dispositivo) => boolean): Dispositivo | null {
  const doTipo = lista.filter((d) => d.tipo === tipo)
  return (preferir && doTipo.find(preferir)) ?? doTipo.find((d) => d.revogadoEm === null) ?? doTipo[0] ?? null
}

/** `m:ss` arredondando para cima (2:00 no começo, 0:01 no último segundo). */
function minutosESegundos(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Aba Ao vivo, parte 1 (PLA-004, Tarefa 8; D3, D5, D11; DES-001 §9, §10.2): os dispositivos com tipo,
 * rótulo (texto React) e situação (presença de `estudio` com a sessão atual do dispositivo), o
 * pareamento e a revogação.
 * - "Parear câmera" reaproveita a câmera cadastrada (`dispositivoId`); sem câmera, cria uma. Os links
 *   do OBS fazem o mesmo com o palco e a câmera do OBS; a câmera do OBS exige uma câmera (`cameraId`).
 * - O código vive só no estado deste componente (nunca em armazenamento, `console` ou URL de servidor):
 *   aparece no fragmento do link e no QR, conta 2 min e some ao expirar, ao parear, ao revogar o
 *   dispositivo e ao desmontar (sair da aba).
 * - Enquanto vale, a lista é consultada a cada 3 s; quando a sessão do dispositivo muda da guardada
 *   ao gerar o código, é pareamento: a sessão antiga, se havia, é avisada **uma vez** em `estudio`
 *   (`revogacao`, D5) e a tela diz que conectou.
 * - Revogar pede confirmação, chama `revogar_dispositivo` e avisa em `estudio` (`revogacao` da sessão
 *   devolvida e `dispositivo_mudou`); sem canal, diz que valeu no banco e que o corte vem em até 10 min.
 * O `estudio` é o do painel (aberto uma vez lá); esta aba não abre canal.
 */
export function AbaAoVivo({
  repo,
  estudio,
  origem,
  reavaliar,
  copiar,
}: {
  repo: RepositorioDoAoVivo
  estudio: CanalDoEstudio | null
  origem: string
  reavaliar: () => void
  /** Escreve na área de transferência; `null` quando o navegador não oferece (o campo fica selecionável). */
  copiar: ((texto: string) => Promise<void>) | null
}): ReactNode {
  const [carga, setCarga] = useState<Carga>({ tipo: 'carregando' })
  const [pareamento, setPareamento] = useState<Pareamento>({ estado: 'nenhum' })
  const [agora, setAgora] = useState(() => Date.now())
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [presentes, setPresentes] = useState<{ alca: CanalDoEstudio | null; chaves: ReadonlySet<string> }>({ alca: null, chaves: new Set() })
  const prefixo = useId()

  const montada = useRef(true)
  const ultimaLeitura = useRef(0)
  const ultimaGeracao = useRef(0)
  const reavaliarAtual = useRef(reavaliar)
  const estudioAtual = useRef(estudio)
  useEffect(() => {
    reavaliarAtual.current = reavaliar
    estudioAtual.current = estudio
  })
  useEffect(() => {
    montada.current = true
    return () => {
      montada.current = false
    }
  }, [])

  const enviarNoEstudio = useCallback(async (m: MensagemDoEstudio): Promise<RespostaDoEnvio> => {
    const alca = estudioAtual.current
    if (alca === null) return 'falhou'
    try {
      return await alca.enviar(m)
    } catch {
      return 'falhou'
    }
  }, [])

  /** Lê a lista; só a leitura mais recente aplica. Acesso negado ou sessão vencida → `reavaliar()`. */
  const carregar = useCallback(async (): Promise<Dispositivo[] | null> => {
    const numero = ++ultimaLeitura.current
    try {
      const lista = await repo.listarDispositivos()
      if (!montada.current || numero !== ultimaLeitura.current) return null
      setCarga({ tipo: 'pronta', lista })
      return lista
    } catch (erro) {
      if (!montada.current || numero !== ultimaLeitura.current) return null
      setCarga((c) => (c.tipo === 'pronta' ? c : { tipo: 'falha' }))
      if (pedeReavaliacao(erro)) reavaliarAtual.current()
      return null
    }
  }, [repo])

  useEffect(() => {
    void carregar()
  }, [carregar])

  // Presença de `estudio`: chave = sessão (`auth.uid()`) + dispositivo declarado.
  useEffect(() => {
    if (estudio === null) return
    return estudio.aoMudarPresenca((lista) => {
      const chaves = new Set<string>()
      for (const p of lista) if (p.presenca.tipo !== 'membro') chaves.add(`${p.usuario} ${p.presenca.dispositivoId}`)
      setPresentes({ alca: estudio, chaves })
    })
  }, [estudio])

  // --- código valendo: contagem de 1 em 1 s, expiração na hora certa e consulta de 3 em 3 s ---
  const codigo = pareamento.estado === 'valendo' ? pareamento.codigo : null
  useEffect(() => {
    if (codigo === null) return
    let ativo = true
    let consultando = false
    setAgora(Date.now())
    const relogio = setInterval(() => setAgora(Date.now()), 1000)
    const expira = setTimeout(() => {
      if (ativo) setPareamento((p) => (p.estado === 'valendo' && p.codigo === codigo ? { estado: 'expirou', tipo: codigo.tipo } : p))
    }, Math.max(0, codigo.fim - Date.now()))
    const consulta = setInterval(() => {
      if (consultando) return
      consultando = true
      void (async () => {
        try {
          const lista = await repo.listarDispositivos()
          if (!ativo || !montada.current) return
          setCarga({ tipo: 'pronta', lista })
          const d = lista.find((x) => x.id === codigo.dispositivoId)
          const pareou = d !== undefined && d.revogadoEm === null && d.pareadoEm !== null && d.usuarioAnonimoId !== null && d.usuarioAnonimoId !== codigo.antigo
          if (!pareou) return
          ativo = false // daqui em diante este código não trata mais nada (o aviso sai uma vez)
          setPareamento({ estado: 'pareado', tipo: codigo.tipo })
          setAviso(null)
          if (codigo.antigo !== null) {
            const r = await enviarNoEstudio({ evento: 'revogacao', usuario: codigo.antigo })
            if (r !== 'ok' && montada.current) setAviso({ tom: 'erro', texto: TEXTO_DA_ABA_AO_VIVO.pareadoSemAviso })
          }
        } catch {
          // falha de uma consulta: a próxima tenta de novo enquanto o código vale
        } finally {
          consultando = false
        }
      })()
    }, INTERVALO_DA_CONSULTA_MS)
    return () => {
      ativo = false
      clearInterval(relogio)
      clearTimeout(expira)
      clearInterval(consulta)
    }
  }, [codigo, repo, enviarNoEstudio])

  async function gerar(tipo: TipoDeDispositivo): Promise<void> {
    const minha = ++ultimaGeracao.current
    const atual = () => montada.current && minha === ultimaGeracao.current
    setPareamento({ estado: 'gerando', tipo })
    setAviso(null)
    try {
      // a lista é relida antes: a sessão antiga guardada tem de ser a de agora
      const lista = await repo.listarDispositivos()
      if (!atual()) return
      setCarga({ tipo: 'pronta', lista })
      const camera = existente(lista, 'camera')
      if (tipo === 'obs_camera' && camera === null) {
        setPareamento({ estado: 'nenhum' })
        setAviso({ tom: 'erro', texto: TEXTO_DA_ABA_AO_VIVO.pareieACamera })
        return
      }
      // a câmera do OBS reaproveitada é, de preferência, a que já exibe esta câmera
      const reaproveitado =
        tipo === 'camera' ? camera : tipo === 'obs_palco' ? existente(lista, 'obs_palco') : existente(lista, 'obs_camera', (d) => d.cameraId === camera?.id && d.revogadoEm === null)
      const r = await repo.criarCodigo({
        tipo,
        rotulo: reaproveitado?.rotulo ?? ROTULO_NOVO[tipo],
        dispositivoId: reaproveitado?.id ?? null,
        cameraId: tipo === 'obs_camera' && reaproveitado === null ? (camera?.id ?? null) : null,
      })
      if (!atual()) return
      const link = linkDePareamento(origem, tipo, r.codigo)
      const matriz = tipo === 'camera' ? matrizDoQr(link) : null
      // Validade pelo relógio deste computador, limitada aos 2 min do banco (um relógio errado não estica nem zera a contagem).
      const restante = Date.parse(r.expiraEm) - Date.now()
      const fim = Date.now() + (restante > 0 && restante <= VALIDADE_DO_CODIGO_MS ? restante : VALIDADE_DO_CODIGO_MS)
      setAgora(Date.now()) // a primeira pintura do código já conta a partir de agora (o relógio só anda com código na tela)
      setPareamento({ estado: 'valendo', codigo: { tipo, dispositivoId: r.dispositivoId, link, matriz, fim, antigo: reaproveitado?.usuarioAnonimoId ?? null } })
      if (reaproveitado === null) void carregar() // o dispositivo novo aparece na lista
    } catch (erro) {
      if (!atual()) return
      setPareamento({ estado: 'nenhum' })
      setAviso({ tom: 'erro', texto: TEXTO_DA_ABA_AO_VIVO.naoGerou })
      if (pedeReavaliacao(erro)) reavaliarAtual.current()
    }
  }

  async function revogar(d: Dispositivo): Promise<void> {
    setConfirmando(null)
    setOcupado(true)
    setAviso(null)
    try {
      const { usuario } = await repo.revogar(d.id)
      // o banco apagou os códigos pendentes do dispositivo: o da tela não vale mais
      setPareamento((p) => (p.estado === 'valendo' && p.codigo.dispositivoId === d.id ? { estado: 'nenhum' } : p))
      let avisou = true
      if (usuario !== null) avisou = (await enviarNoEstudio({ evento: 'revogacao', usuario })) === 'ok'
      avisou = (await enviarNoEstudio({ evento: 'dispositivo_mudou', dispositivoId: d.id })) === 'ok' && avisou
      if (!montada.current) return
      setAviso(avisou ? { tom: 'info', texto: TEXTO_DA_ABA_AO_VIVO.revogado } : { tom: 'erro', texto: TEXTO_DA_ABA_AO_VIVO.revogadoSemCanal })
      await carregar()
    } catch (erro) {
      if (!montada.current) return
      setAviso({ tom: 'erro', texto: TEXTO_DA_ABA_AO_VIVO.naoRevogou })
      if (pedeReavaliacao(erro)) reavaliarAtual.current()
    } finally {
      if (montada.current) setOcupado(false)
    }
  }

  async function aoCopiar(link: string): Promise<void> {
    if (copiar === null) return
    try {
      await copiar(link)
      if (montada.current) setAviso({ tom: 'info', texto: TEXTO_DA_ABA_AO_VIVO.copiado })
    } catch {
      if (montada.current) setAviso({ tom: 'erro', texto: TEXTO_DA_ABA_AO_VIVO.naoCopiou })
    }
  }

  const lista = useMemo(
    () => (carga.tipo === 'pronta' ? [...carga.lista].sort((a, b) => ORDEM_DOS_TIPOS.indexOf(a.tipo) - ORDEM_DOS_TIPOS.indexOf(b.tipo)) : []),
    [carga],
  )
  const chaves = presentes.alca !== null && presentes.alca === estudio ? presentes.chaves : null
  const conectados = useMemo(
    () => new Set(chaves === null ? [] : lista.filter((d) => chaves.has(`${d.usuarioAnonimoId} ${d.id}`)).map((d) => d.id)),
    [lista, chaves],
  )
  const temCamera = lista.some((d) => d.tipo === 'camera')
  const idDaDica = `${prefixo}-dica`
  const idDoLink = `${prefixo}-link`
  const gerando = pareamento.estado === 'gerando'

  return (
    <div className="dispositivos">
      <h2>{TEXTO_DA_ABA_AO_VIVO.titulo}</h2>
      {aviso !== null && <Mensagem tom={aviso.tom}>{aviso.texto}</Mensagem>}

      {carga.tipo === 'carregando' && <p role="status">{TEXTO_DA_ABA_AO_VIVO.carregando}</p>}
      {carga.tipo === 'falha' && (
        <>
          <Mensagem tom="erro">{TEXTO_DA_ABA_AO_VIVO.naoCarregou}</Mensagem>
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
        <>
          {lista.length === 0 ? (
            <p>{TEXTO_DA_ABA_AO_VIVO.nenhum}</p>
          ) : (
            <div className="tabela-rolavel">
              <table className="tabela">
                <caption className="so-leitor">{TEXTO_DA_ABA_AO_VIVO.titulo}</caption>
                <thead>
                  <tr>
                    <th scope="col">Tipo</th>
                    <th scope="col">Rótulo</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((d) => {
                    const situacao = situacaoDoDispositivo(d, conectados)
                    return (
                      <tr key={d.id}>
                        <td>{ROTULO_DO_TIPO[d.tipo]}</td>
                        <td className="dispositivos__rotulo">{d.rotulo}</td>
                        <td>
                          <span className={`dispositivos__situacao dispositivos__situacao--${situacao}`}>{ROTULO_DA_SITUACAO[situacao]}</span>
                        </td>
                        <td>
                          {situacao === 'revogado' || situacao === 'nunca_pareado' ? null : confirmando === d.id ? (
                            <div className="tabela__acoes">
                              <button type="button" className="botao botao--pequeno" disabled={ocupado || gerando} onClick={() => void revogar(d)}>
                                Confirmar revogação
                              </button>
                              <button type="button" className="botao botao--pequeno botao--contorno" disabled={ocupado} onClick={() => setConfirmando(null)}>
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <div className="tabela__acoes">
                              <button type="button" className="botao botao--pequeno botao--contorno" disabled={ocupado || gerando} onClick={() => setConfirmando(d.id)}>
                                Revogar
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

          <div className="dispositivos__acoes">
            <button type="button" className="botao" disabled={gerando || ocupado} onClick={() => void gerar('camera')}>
              {ACAO_DO_TIPO.camera}
            </button>
            <button type="button" className="botao botao--ciano" disabled={gerando || ocupado} onClick={() => void gerar('obs_palco')}>
              {ACAO_DO_TIPO.obs_palco}
            </button>
            <button
              type="button"
              className="botao botao--ciano"
              disabled={gerando || ocupado || !temCamera}
              aria-describedby={temCamera ? undefined : idDaDica}
              onClick={() => void gerar('obs_camera')}
            >
              {ACAO_DO_TIPO.obs_camera}
            </button>
            {!temCamera && (
              <span id={idDaDica} className="dispositivos__dica">
                {TEXTO_DA_ABA_AO_VIVO.pareieACamera}
              </span>
            )}
          </div>
        </>
      )}

      {pareamento.estado === 'gerando' && <p role="status">{TEXTO_DA_ABA_AO_VIVO.gerando}</p>}
      {pareamento.estado === 'valendo' && (
        <section className="link-de-pareamento" aria-label="Código de pareamento">
          {pareamento.codigo.matriz !== null && <CodigoQr matriz={pareamento.codigo.matriz} rotulo="QR para parear a câmera" />}
          <div className="campo">
            <label htmlFor={idDoLink}>{ROTULO_DO_LINK[pareamento.codigo.tipo]}</label>
            <input id={idDoLink} type="text" readOnly value={pareamento.codigo.link} spellCheck={false} autoComplete="off" onFocus={(e) => e.currentTarget.select()} />
          </div>
          <div className="link-de-pareamento__rodape">
            <span className="link-de-pareamento__validade">Vale por {minutosESegundos(pareamento.codigo.fim - agora)}</span>
            {copiar !== null && (
              <button type="button" className="botao botao--pequeno botao--contorno" onClick={() => void aoCopiar(pareamento.codigo.link)}>
                Copiar link
              </button>
            )}
          </div>
        </section>
      )}
      {pareamento.estado === 'expirou' && (
        <div className="link-de-pareamento">
          <p>{TEXTO_DA_ABA_AO_VIVO.expirou}</p>
          <button type="button" className="botao botao--pequeno" disabled={ocupado} onClick={() => void gerar(pareamento.tipo)}>
            Gerar outro
          </button>
        </div>
      )}
      {pareamento.estado === 'pareado' && <Mensagem tom="info">{CONECTADO[pareamento.tipo]}</Mensagem>}
    </div>
  )
}
