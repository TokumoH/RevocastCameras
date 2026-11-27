import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { linkDePareamento, ROTULO_DO_TIPO, situacaoDoDispositivo } from '../../domains/acesso/dispositivos'
import type { Dispositivo, TipoDeDispositivo } from '../../domains/acesso/dispositivos'
import type { Papel } from '../../domains/acesso/papeis'
import type { UsuarioDaSessao } from '../../domains/acesso/sessao'
import type { MensagemDoEstudio, SituacaoDoObs } from '../../domains/aovivo/mensagens'
import { ErroDoAoVivo } from '../../domains/aovivo/portas'
import type { CanalDoEstudio, EstadoDoCanal, FabricaDeCanais, RepositorioDoAoVivo, RespostaDoEnvio } from '../../domains/aovivo/portas'
import { NIVEL_DE_CONTROLE } from '../../domains/obs/portas'
import { VERSAO_MINIMA_DO_OBS, versaoAtende } from '../../domains/obs/versao'
import type { Episodio } from '../../domains/preparacao/episodios'
import { ErroDePreparacao } from '../../domains/preparacao/portas'
import type { ServicosDePreparacao } from '../../domains/preparacao/portas'
import { matrizDoQr } from '../../shared/infra/qr'
import { CodigoQr } from '../../shared/ui/CodigoQr'
import { Mensagem } from '../../shared/ui/Mensagem'
import { avisoDoCanal, PainelDeComandos } from '../../shared/ui/PainelDeComandos'
import type { Dependencias } from '../dependencias'
import { useAoVivo } from '../useAoVivo'
import type { AoVivo } from '../useAoVivo'

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

/** Frases fixas da seção Episódio (Tarefa 9; D7, D12). Nenhuma vem do servidor; o título entra como texto React. */
export const TEXTO_DO_EPISODIO = Object.freeze({
  titulo: 'Episódio',
  carregando: 'Carregando o episódio…',
  falhaAoCarregar: 'Não foi possível carregar o episódio; tentando de novo.',
  nenhum: 'Nenhum episódio no ar nem em teste.',
  aoVivo: 'Ao vivo',
  modoTeste: 'Modo teste',
  escolha: 'Rascunho para testar ou iniciar',
  semRascunho: 'Nenhum rascunho. Crie um episódio na aba Episódios.',
  naoCarregou: 'Não foi possível carregar os episódios.',
  usarNoTeste: 'Usar no modo teste',
  sairDoTeste: 'Sair do modo teste',
  iniciar: 'Iniciar o ao vivo',
  encerrar: 'Encerrar o ao vivo',
  confirmarInicio: 'Confirmar início',
  confirmarEncerramento: 'Confirmar encerramento',
  testeLigado: 'Modo teste ligado.',
  testeDesligado: 'Modo teste desligado.',
  iniciado: 'Ao vivo iniciado.',
  encerrado: 'Ao vivo encerrado.',
  semAviso: 'Feito no banco, mas o aviso pelo canal não saiu. Se o palco ou o /controle não mudarem, recarregue-os.',
  duplicado: 'Já existe um episódio ao vivo.',
  estadoInvalido: 'O episódio mudou de estado; a lista foi recarregada.',
  mudou: 'Os episódios ou o seu papel mudaram; conferindo de novo.',
  naoConcluiu: 'Não foi possível concluir. Tente de novo.',
} as const)

/** A versão mínima como a tela a escreve (`30.2.0` → `30.2`). */
const MINIMA_NA_TELA = VERSAO_MINIMA_DO_OBS.replace(/\.0$/, '')

/** Frases fixas do checklist (D13; DES-001 §10.4). Versões vindas do palco entram como texto React. */
export const TEXTO_DO_CHECKLIST = Object.freeze({
  titulo: 'Checklist',
  fixo: 'Antes de começar',
  automatico: 'Conferência automática',
  itensFixos: Object.freeze([
    'Acordar o projeto no Supabase, se estiver pausado.',
    'No OBS: Replay Buffer e gravação (Hybrid MP4) iniciados; Fontes /obs/palco (ADVANCED) e /obs/camera em todas as cenas, por referência; servidor WebSocket ligado, com a senha informada no palco.',
    'No celular de gravação: tela sempre ligada, sem economia de bateria, no carregador.',
    'Conferir a câmera e as Fontes conectadas; testar no modo teste; iniciar o ao vivo.',
  ] as const),
  palco: 'Palco conectado',
  palcoAusente: 'Palco não conectado',
  obsDesconhecido: 'Situação do OBS desconhecida.',
  obs: 'OBS detectado',
  obsAusente: 'OBS não detectado',
  nivel: 'Nível de controle Avançado ou mais',
  nivelBaixo: 'Dê acesso Avançado à Fonte do palco',
  websocket: Object.freeze({
    conectado: 'obs-websocket conectado',
    senha_errada: 'Senha do obs-websocket errada: confira no palco (tecla c no Interagir).',
    sem_conexao: 'obs-websocket sem conexão: ligue o servidor WebSocket do OBS.',
    desligado: 'obs-websocket não configurado no palco.',
  } satisfies Record<SituacaoDoObs['websocket'], string>),
  abaixoDaMinima: `OBS abaixo de ${MINIMA_NA_TELA}`,
  versaoDesconhecida: 'Versão do OBS desconhecida',
  replay: 'Replay Buffer ativo',
  replayParado: 'Replay Buffer parado',
  replayDesconhecido: 'Replay Buffer: situação desconhecida',
  gravacao: 'Gravação em andamento',
  gravacaoParada: 'Gravação parada',
  gravacaoDesconhecida: 'Gravação: situação desconhecida',
  camera: 'Câmera conectada',
  cameraAusente: 'Câmera não conectada (informativo)',
  pronto: 'pronto',
  pendente: 'pendente',
  info: 'informativo',
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

/** Um item da conferência automática: pronto, pendente ou só informativo (a câmera, até a E4). */
export interface ItemDoChecklist {
  texto: string
  situacao: 'pronto' | 'pendente' | 'info'
}

/**
 * Os itens automáticos do checklist (D13) a partir do palco na presença de `estudio` (`undefined` = palco
 * fora; `null` = palco sem situação do OBS) e da câmera. Avançado = nível 4 (`NIVEL_DE_CONTROLE.ADVANCED`);
 * a versão só vale com o obs-websocket conectado (sem ele, "desconhecida" e a do plugin como indicação).
 */
export function itensDoChecklist(palco: SituacaoDoObs | null | undefined, cameraConectada: boolean): ItemDoChecklist[] {
  const T = TEXTO_DO_CHECKLIST
  const camera: ItemDoChecklist = cameraConectada ? { texto: T.camera, situacao: 'pronto' } : { texto: T.cameraAusente, situacao: 'info' }
  if (palco === undefined) return [{ texto: T.palcoAusente, situacao: 'pendente' }, { texto: T.obsDesconhecido, situacao: 'pendente' }, camera]
  const conectado: ItemDoChecklist = { texto: T.palco, situacao: 'pronto' }
  if (palco === null) return [conectado, { texto: T.obsDesconhecido, situacao: 'pendente' }, camera]
  const sim = (ok: boolean, pronto: string, pendente: string): ItemDoChecklist => (ok ? { texto: pronto, situacao: 'pronto' } : { texto: pendente, situacao: 'pendente' })
  const triplo = (v: boolean | null, pronto: string, parado: string, desconhecido: string): ItemDoChecklist =>
    v === true ? { texto: pronto, situacao: 'pronto' } : { texto: v === false ? parado : desconhecido, situacao: 'pendente' }
  const atende = palco.websocket === 'conectado' ? versaoAtende(palco.versaoObs) : null
  const versao: ItemDoChecklist =
    atende === true
      ? { texto: `OBS ${palco.versaoObs ?? ''}`, situacao: 'pronto' }
      : atende === false
        ? { texto: T.abaixoDaMinima, situacao: 'pendente' }
        : { texto: palco.versaoDoPlugin === null ? T.versaoDesconhecida : `${T.versaoDesconhecida} (plugin do navegador ${palco.versaoDoPlugin})`, situacao: 'pendente' }
  return [
    conectado,
    sim(palco.navegador, T.obs, T.obsAusente),
    sim(palco.nivel !== null && palco.nivel >= NIVEL_DE_CONTROLE.ADVANCED, T.nivel, T.nivelBaixo),
    { texto: T.websocket[palco.websocket], situacao: palco.websocket === 'conectado' ? 'pronto' : 'pendente' },
    versao,
    triplo(palco.replayBuffer, T.replay, T.replayParado, T.replayDesconhecido),
    triplo(palco.gravando, T.gravacao, T.gravacaoParada, T.gravacaoDesconhecida),
    camera,
  ]
}

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
 *
 * Parte 2 (Tarefa 9; D7, D12, D13): o `useAoVivo` da aba recebe o `estudio` do painel (uma alça só, I3) e
 * a janela de perda dele (um `reavaliar()` por renovação de token); abaixo dos dispositivos vêm as seções
 * Episódio (`SecaoDoEpisodio`), Checklist (`ChecklistDoAoVivo`) e Comandos (`PainelDeComandos`, só com
 * episódio ativo). Um `dispositivo_mudou` de outro painel recarrega a lista (VER-042, Riscos).
 */
export function AbaAoVivo({
  repo,
  estudio,
  estadoDoEstudio,
  canais,
  preparacao,
  usuario,
  papel,
  aoVoltarAVer,
  aoPerderCanal,
  origem,
  reavaliar,
  copiar,
}: {
  repo: RepositorioDoAoVivo
  estudio: CanalDoEstudio | null
  /** O estado do `estudio` do painel (`useEstudio`), passado ao `useAoVivo` junto com a alça. */
  estadoDoEstudio: EstadoDoCanal
  /** A fábrica de canais do cliente de membro (o `:controle` e o `:estado` do episódio ativo, VER-047). */
  canais: FabricaDeCanais
  preparacao: ServicosDePreparacao
  usuario: UsuarioDaSessao
  papel: Papel
  aoVoltarAVer: Dependencias['aoVoltarAVer']
  /** A janela de perda do painel (`useUmaReavaliacaoPorPerda`); sem ela, o `useAoVivo` usa a dele. */
  aoPerderCanal?: () => void
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
  /** Presença de `estudio` dos dispositivos: chave `<sessão> <dispositivo>` → situação do OBS declarada (só o palco tem). */
  const [presentes, setPresentes] = useState<{ alca: CanalDoEstudio | null; chaves: ReadonlyMap<string, SituacaoDoObs | null> }>({ alca: null, chaves: new Map() })
  const av = useAoVivo({ repo, preparacao, canais, usuario, papel, reavaliar, aoVoltarAVer, estudio: { estudio, estado: estadoDoEstudio }, aoPerderCanal })
  /** Uma ação no episódio em curso (do clique até a nova consulta terminar): os comandos ficam desabilitados (rodada 1, I1). */
  const [episodioOcupado, setEpisodioOcupado] = useState(false)
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

  // Presença de `estudio`: chave = sessão (`auth.uid()`) + dispositivo declarado; o valor é a situação do OBS (D13).
  useEffect(() => {
    if (estudio === null) return
    return estudio.aoMudarPresenca((lista) => {
      const chaves = new Map<string, SituacaoDoObs | null>()
      for (const p of lista) if (p.presenca.tipo !== 'membro') chaves.set(`${p.usuario} ${p.presenca.dispositivoId}`, p.presenca.obs)
      setPresentes({ alca: estudio, chaves })
    })
  }, [estudio])

  // `dispositivo_mudou` de outro painel (revogação, troca de aparelho): a lista é lida de novo. O que esta aba
  // envia não volta a ela (o eco local não chega à alça que enviou).
  useEffect(() => {
    if (estudio === null) return
    return estudio.aoReceber((m) => {
      if (m.evento === 'dispositivo_mudou') void carregar()
    })
  }, [estudio, carregar])

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
  // O palco e a câmera do checklist são os da lista com a sessão atual na presença (a mesma regra de "Conectado").
  const palcoConectado = lista.find((d) => d.tipo === 'obs_palco' && conectados.has(d.id))
  const situacaoDoPalco = palcoConectado === undefined || chaves === null ? undefined : (chaves.get(`${palcoConectado.usuarioAnonimoId} ${palcoConectado.id}`) ?? null)
  const cameraConectada = lista.some((d) => d.tipo === 'camera' && conectados.has(d.id))

  return (
    <div className="ao-vivo">
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
      <SecaoDoEpisodio
        preparacao={preparacao}
        repo={repo}
        av={av}
        enviarNoEstudio={enviarNoEstudio}
        reavaliar={reavaliar}
        ocupado={episodioOcupado}
        definirOcupado={setEpisodioOcupado}
      />
      <ChecklistDoAoVivo itens={itensDoChecklist(situacaoDoPalco, cameraConectada)} />
      {av.episodio !== null && <SecaoDosComandos av={av} bloqueado={episodioOcupado} />}
    </div>
  )
}

/** Mais recente primeiro (o texto `AAAA-MM-DD` ordena como a data), como na aba Episódios. */
function porData(episodios: readonly Episodio[]): Episodio[] {
  return [...episodios].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))
}

/** `AAAA-MM-DD` → `DD/MM/AAAA` (um texto fora do formato aparece como veio). */
function dataNaTela(data: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : data
}

/** O que a seção pede ao banco; `sair` não leva episódio, as outras levam (o tipo garante o `id`). */
type PedidoNoEpisodio = { acao: 'teste' | 'iniciar' | 'encerrar'; id: string } | { acao: 'sair' }
type AcaoNoEpisodio = PedidoNoEpisodio['acao']
type CargaDosEpisodios = { tipo: 'carregando' } | { tipo: 'pronta'; lista: Episodio[] } | { tipo: 'falha' }

const SUCESSO: Readonly<Record<AcaoNoEpisodio, string>> = {
  teste: TEXTO_DO_EPISODIO.testeLigado,
  sair: TEXTO_DO_EPISODIO.testeDesligado,
  iniciar: TEXTO_DO_EPISODIO.iniciado,
  encerrar: TEXTO_DO_EPISODIO.encerrado,
}

function motivoDoErro(erro: unknown): string {
  return erro instanceof ErroDoAoVivo || erro instanceof ErroDePreparacao ? erro.motivo : 'outro'
}

/**
 * Seção Episódio (Tarefa 9; D7, D12): o estado atual (o `episodio_ativo()` do `useAoVivo`), o seletor só com
 * os rascunhos (a escolha do modo teste e do início), "Usar no modo teste", "Sair do modo teste", "Iniciar o
 * ao vivo" (confirmação que cita o título) e, com o ao vivo no ar, só "Encerrar o ao vivo" (confirmação).
 * Depois de cada ação aceita pelo banco: `episodio_ativo_mudou` em `estudio` e a consulta de novo aqui mesmo
 * (`av.recarregar()`), porque o aviso não volta à alça que o enviou. Erros: `duplicado` e `estado_invalido`
 * com frase fixa e recarga; `negado` com `reavaliar()`; sessão vencida só `reavaliar()`; o resto, a frase
 * comum. A interface só escolhe o que mostrar: quem recusa é o banco (D7).
 */
function SecaoDoEpisodio({
  preparacao,
  repo,
  av,
  enviarNoEstudio,
  reavaliar,
  ocupado,
  definirOcupado: setOcupado,
}: {
  preparacao: ServicosDePreparacao
  repo: RepositorioDoAoVivo
  av: AoVivo
  enviarNoEstudio: (m: MensagemDoEstudio) => Promise<RespostaDoEnvio>
  reavaliar: () => void
  /** Ação em curso; o estado é da aba, que desabilita os comandos enquanto ele vale (rodada 1, I1). */
  ocupado: boolean
  definirOcupado: (ocupado: boolean) => void
}): ReactNode {
  const [carga, setCarga] = useState<CargaDosEpisodios>({ tipo: 'carregando' })
  const [escolhido, setEscolhido] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<{ acao: 'iniciar' | 'encerrar'; id: string; titulo: string } | null>(null)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const prefixo = useId()

  const montada = useRef(true)
  const ultimaLeitura = useRef(0)
  const reavaliarAtual = useRef(reavaliar)
  const recarregarAoVivo = useRef(av.recarregar)
  useEffect(() => {
    reavaliarAtual.current = reavaliar
    recarregarAoVivo.current = av.recarregar
  })
  useEffect(() => {
    montada.current = true
    return () => {
      montada.current = false
    }
  }, [])

  /** Lê os episódios; só a leitura mais recente aplica. */
  const carregar = useCallback(async (): Promise<void> => {
    const numero = ++ultimaLeitura.current
    try {
      const lista = await preparacao.episodios.listar()
      if (montada.current && numero === ultimaLeitura.current) setCarga({ tipo: 'pronta', lista })
    } catch (erro) {
      if (!montada.current || numero !== ultimaLeitura.current) return
      setCarga((c) => (c.tipo === 'pronta' ? c : { tipo: 'falha' }))
      const motivo = motivoDoErro(erro)
      if (motivo === 'negado' || motivo === 'sessao_expirada') reavaliarAtual.current()
    }
  }, [preparacao])

  // Lê ao abrir e a cada mudança do episódio ativo (aviso de outro painel, reconexão, ação daqui).
  const ativo = av.episodio === null ? null : `${av.episodio.id} ${av.episodio.modo}`
  useEffect(() => {
    void carregar()
  }, [carregar, ativo])
  // Uma confirmação aberta vale para o episódio ativo de quando foi pedida: se ele mudou (outro painel), ela some.
  useEffect(() => {
    setConfirmando(null)
  }, [ativo])

  async function recarregarTudo(): Promise<void> {
    await Promise.all([recarregarAoVivo.current(), carregar()])
  }

  async function executar(pedido: PedidoNoEpisodio): Promise<void> {
    const { acao } = pedido
    setConfirmando(null)
    setOcupado(true)
    setAviso(null)
    try {
      if (pedido.acao === 'iniciar') await repo.iniciar(pedido.id)
      else if (pedido.acao === 'encerrar') await repo.encerrar(pedido.id)
      else await repo.definirModoTeste(pedido.acao === 'teste' ? pedido.id : null)
    } catch (erro) {
      const motivo = motivoDoErro(erro)
      if (motivo === 'sessao_expirada') reavaliarAtual.current()
      else if (motivo === 'negado') {
        reavaliarAtual.current()
        if (montada.current) setAviso({ tom: 'erro', texto: TEXTO_DO_EPISODIO.mudou })
      } else if (montada.current) {
        setAviso({
          tom: 'erro',
          texto: motivo === 'duplicado' ? TEXTO_DO_EPISODIO.duplicado : motivo === 'estado_invalido' ? TEXTO_DO_EPISODIO.estadoInvalido : TEXTO_DO_EPISODIO.naoConcluiu,
        })
      }
      if (motivo !== 'sessao_expirada') await recarregarTudo()
      if (montada.current) setOcupado(false)
      return
    }
    const resposta = await enviarNoEstudio({ evento: 'episodio_ativo_mudou' })
    await recarregarTudo()
    if (!montada.current) return
    setAviso(resposta === 'ok' ? { tom: 'info', texto: SUCESSO[acao] } : { tom: 'erro', texto: TEXTO_DO_EPISODIO.semAviso })
    setOcupado(false)
  }

  const rascunhos = carga.tipo === 'pronta' ? porData(carga.lista.filter((e) => e.estado === 'rascunho')) : []
  const episodio = av.episodio
  const emTeste = episodio !== null && episodio.modo === 'teste' ? episodio.id : null
  // A escolha da pessoa vale enquanto for um rascunho; antes dela (ou se ela sumir), o episódio em teste ou o mais recente.
  const selecionado = rascunhos.find((e) => e.id === escolhido) ?? rascunhos.find((e) => e.id === emTeste) ?? rascunhos[0] ?? null
  const idDoTitulo = `${prefixo}-titulo`
  const idDoSeletor = `${prefixo}-seletor`

  function confirmacao(texto: string, rotulo: string): ReactNode {
    return (
      <div className="episodio-ao-vivo__confirmacao">
        <p>{texto}</p>
        <div className="episodio-ao-vivo__acoes">
          <button type="button" className="botao botao--pequeno" disabled={ocupado} onClick={() => confirmando !== null && void executar({ acao: confirmando.acao, id: confirmando.id })}>
            {rotulo}
          </button>
          <button type="button" className="botao botao--pequeno botao--contorno" disabled={ocupado} onClick={() => setConfirmando(null)}>
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  return (
    <section className="episodio-ao-vivo" aria-labelledby={idDoTitulo}>
      <h2 id={idDoTitulo}>{TEXTO_DO_EPISODIO.titulo}</h2>
      {aviso !== null && <Mensagem tom={aviso.tom}>{aviso.texto}</Mensagem>}
      {av.falhaAoCarregar && <Mensagem tom="erro">{TEXTO_DO_EPISODIO.falhaAoCarregar}</Mensagem>}
      {!av.carregado ? (
        <p role="status">{TEXTO_DO_EPISODIO.carregando}</p>
      ) : episodio === null ? (
        !av.falhaAoCarregar && <p>{TEXTO_DO_EPISODIO.nenhum}</p>
      ) : (
        <p className="episodio-no-ar">
          <span className={episodio.modo === 'ao_vivo' ? 'selo-no-ar selo-no-ar--ao-vivo' : 'selo-no-ar'}>{episodio.modo === 'ao_vivo' ? TEXTO_DO_EPISODIO.aoVivo : TEXTO_DO_EPISODIO.modoTeste}</span>{' '}
          <span className="episodio-no-ar__titulo">{episodio.titulo}</span>
        </p>
      )}

      {episodio !== null && episodio.modo === 'ao_vivo' ? (
        confirmando?.acao === 'encerrar' ? (
          confirmacao(`Encerrar o ao vivo de “${confirmando.titulo}”?`, TEXTO_DO_EPISODIO.confirmarEncerramento)
        ) : (
          <div className="episodio-ao-vivo__acoes">
            <button type="button" className="botao" disabled={ocupado} onClick={() => setConfirmando({ acao: 'encerrar', id: episodio.id, titulo: episodio.titulo })}>
              {TEXTO_DO_EPISODIO.encerrar}
            </button>
          </div>
        )
      ) : (
        <>
          {emTeste !== null && (
            <div className="episodio-ao-vivo__acoes">
              <button type="button" className="botao botao--contorno" disabled={ocupado} onClick={() => void executar({ acao: 'sair' })}>
                {TEXTO_DO_EPISODIO.sairDoTeste}
              </button>
            </div>
          )}
          {carga.tipo === 'carregando' && <p role="status">{TEXTO_DO_EPISODIO.carregando}</p>}
          {carga.tipo === 'falha' && (
            <>
              <Mensagem tom="erro">{TEXTO_DO_EPISODIO.naoCarregou}</Mensagem>
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
          {carga.tipo === 'pronta' &&
            (selecionado === null ? (
              <p>{TEXTO_DO_EPISODIO.semRascunho}</p>
            ) : (
              <>
                <div className="campo">
                  <label htmlFor={idDoSeletor}>{TEXTO_DO_EPISODIO.escolha}</label>
                  <select
                    id={idDoSeletor}
                    value={selecionado.id}
                    disabled={ocupado}
                    onChange={(e) => {
                      setEscolhido(e.currentTarget.value)
                      setConfirmando(null)
                    }}
                  >
                    {rascunhos.map((e) => (
                      <option key={e.id} value={e.id}>
                        {`${e.titulo} · ${dataNaTela(e.data)}`}
                      </option>
                    ))}
                  </select>
                </div>
                {confirmando?.acao === 'iniciar' ? (
                  confirmacao(`Iniciar o ao vivo de “${confirmando.titulo}”?`, TEXTO_DO_EPISODIO.confirmarInicio)
                ) : (
                  <div className="episodio-ao-vivo__acoes">
                    <button
                      type="button"
                      className="botao botao--ciano"
                      disabled={ocupado || selecionado.id === emTeste}
                      onClick={() => void executar({ acao: 'teste', id: selecionado.id })}
                    >
                      {TEXTO_DO_EPISODIO.usarNoTeste}
                    </button>
                    <button type="button" className="botao" disabled={ocupado} onClick={() => setConfirmando({ acao: 'iniciar', id: selecionado.id, titulo: selecionado.titulo })}>
                      {TEXTO_DO_EPISODIO.iniciar}
                    </button>
                  </div>
                )}
              </>
            ))}
        </>
      )}
    </section>
  )
}

/** Checklist (D13; DES-001 §10.4): a lista fixa e a conferência automática, com o sinal e o nome da situação para o leitor de tela. */
function ChecklistDoAoVivo({ itens }: { itens: readonly ItemDoChecklist[] }): ReactNode {
  const prefixo = useId()
  const sinal = { pronto: '✓', pendente: '!', info: 'i' } as const
  return (
    <section className="checklist" aria-labelledby={`${prefixo}-titulo`}>
      <h2 id={`${prefixo}-titulo`}>{TEXTO_DO_CHECKLIST.titulo}</h2>
      <h3 id={`${prefixo}-fixo`}>{TEXTO_DO_CHECKLIST.fixo}</h3>
      <ol className="checklist__fixo" aria-labelledby={`${prefixo}-fixo`}>
        {TEXTO_DO_CHECKLIST.itensFixos.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
      <h3 id={`${prefixo}-auto`}>{TEXTO_DO_CHECKLIST.automatico}</h3>
      <ul className="checklist__automatico" aria-labelledby={`${prefixo}-auto`}>
        {itens.map((i) => (
          <li key={i.texto} className={`checklist__item checklist__item--${i.situacao}`} data-situacao={i.situacao}>
            <span className="checklist__sinal" aria-hidden="true">
              {sinal[i.situacao]}
            </span>
            <span className="checklist__texto">{i.texto}</span>
            <span className="so-leitor"> ({TEXTO_DO_CHECKLIST[i.situacao]})</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Comandos (Tarefa 9): o `PainelDeComandos` do `/controle` com o `useAoVivo` da aba, títulos em `h3` (abaixo do
 * `h2` "Comandos"); habilitado só com `av.podeComandar` (canal `conectado` e a última consulta sem falha, rodada
 * 2) e sem ação no episódio em curso (`bloqueado`, do clique
 * até a nova consulta: um toque nessa janela iria ao `:controle` do episódio anterior; rodada 1, I1).
 */
function SecaoDosComandos({ av, bloqueado }: { av: AoVivo; bloqueado: boolean }): ReactNode {
  const prefixo = useId()
  const episodio = av.episodio
  if (episodio === null) return null
  const aviso = avisoDoCanal(av.canal)
  return (
    <section className="comandos-do-painel" aria-labelledby={`${prefixo}-titulo`}>
      <h2 id={`${prefixo}-titulo`}>Comandos</h2>
      {aviso !== null && <Mensagem tom={aviso.tom}>{aviso.texto}</Mensagem>}
      <PainelDeComandos
        episodio={episodio}
        listas={av.listas}
        estadoNoAr={av.estadoNoAr}
        pedidoDoUltimo={av.pedidoDoUltimo}
        habilitado={av.podeComandar && !bloqueado}
        enviar={av.enviar}
        nivelDoTitulo={3}
      />
    </section>
  )
}
