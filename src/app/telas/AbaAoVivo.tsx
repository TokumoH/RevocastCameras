import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { linkDePareamento, ROTULO_DO_TIPO, situacaoDoDispositivo } from '../../domains/acesso/dispositivos'
import type { Dispositivo, TipoDeDispositivo } from '../../domains/acesso/dispositivos'
import type { Papel } from '../../domains/acesso/papeis'
import type { UsuarioDaSessao } from '../../domains/acesso/sessao'
import type { MensagemDoEstudio, PresencaNoEstudio, SituacaoDoObs } from '../../domains/aovivo/mensagens'
import type { EstadoDoVideo, SituacaoDoVideo } from '../../domains/captura/sinais'
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
import { TEXTO_DA_CAMERA } from './CameraNoAr'

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
  /** O `obs_camera` ativo mostra outra câmera (só pela API; PLA-005, revisão 4, N16): a aba não gera link. */
  outraCamera: 'A câmera do OBS está ligada a outra câmera. Revogue a câmera do OBS e gere um link novo.',
  /** `23505` de `dispositivos_um_obs_camera_ativo` numa corrida (PLA-005, D2): frase defensiva. */
  obsCameraDuplicada: 'Já existe uma câmera do OBS ativa. Revogue-a antes.',
} as const)

/**
 * Frases curtas da situação do vídeo na lista de dispositivos (PLA-005 D13): fixas, nenhuma vem da presença; a bateria
 * é o único número, arredondado aqui. `aguardando_par` e `sem_video_direto` dependem do lado (`camera` ou `obs_camera`).
 */
export const TEXTO_DO_VIDEO = Object.freeze({
  aguardando_toque: 'aguardando toque',
  aguardando_episodio: 'aguardando episódio',
  conectando: 'conectando',
  conectado: 'vídeo chegando',
  sem_conexao_direta: 'sem conexão direta',
  sem_permissao: 'sem permissão da câmera',
  sem_camera: 'sem câmera traseira',
  inseguro: 'endereço sem https',
  sinal_grande: 'sinal grande demais',
  aguardandoPar: Object.freeze({ camera: 'aguardando a câmera do OBS', obs_camera: 'aguardando o celular' }),
  semVideoDireto: Object.freeze({ camera: 'navegador sem vídeo direto (WebRTC)', obs_camera: 'Fonte do OBS sem vídeo direto (WebRTC)' }),
  semTrava: 'tela pode apagar',
  bateria: (porcento: number): string => `bateria ${porcento}%`,
} satisfies Record<Exclude<EstadoDoVideo, 'aguardando_par' | 'sem_video_direto'>, string> & Record<string, unknown>)

/** Os dois lados do vídeo (os tipos cuja presença leva `video`). */
type LadoDoVideo = 'camera' | 'obs_camera'

/** A frase curta de uma situação do vídeo, do lado que a publicou. */
export function fraseDoVideo(lado: LadoDoVideo, estado: EstadoDoVideo): string {
  if (estado === 'aguardando_par') return TEXTO_DO_VIDEO.aguardandoPar[lado]
  if (estado === 'sem_video_direto') return TEXTO_DO_VIDEO.semVideoDireto[lado]
  return TEXTO_DO_VIDEO[estado]
}

/** A situação inteira na lista: a frase, "tela pode apagar" (só sem trava) e a bateria, quando o aparelho informa. */
function frasesDoVideo(lado: LadoDoVideo, v: SituacaoDoVideo): string {
  const partes = [fraseDoVideo(lado, v.estado)]
  if (v.telaLigada === 'sem_trava') partes.push(TEXTO_DO_VIDEO.semTrava)
  if (v.bateria !== null) partes.push(TEXTO_DO_VIDEO.bateria(Math.round(v.bateria * 100)))
  return partes.join(' · ')
}

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
  // Vídeo (PLA-005 D13, desde a E4): os dois itens que substituem "Câmera conectada" (informativo até a E4)
  video: 'Vídeo da câmera no OBS',
  videoSemObsCamera: 'Gere o link da câmera do OBS',
  videoSemCamera: 'Vídeo da câmera no OBS: pareie a câmera antes',
  videoObsAusente: 'Vídeo da câmera no OBS: a Fonte /obs/camera não está conectada',
  videoCelularAusente: 'Vídeo da câmera no OBS: o celular de gravação não está conectado',
  videoDesconhecido: 'Vídeo da câmera no OBS: situação desconhecida',
  videoPendente: (frase: string): string => `Vídeo da câmera no OBS: ${frase}`,
  tela: 'Tela do celular ligada',
  telaAusente: 'Tela do celular: a câmera não está conectada',
  telaDesconhecida: 'Tela do celular: situação desconhecida',
  /** Sem a trava de tela: as instruções do DES-001 §10.4, item 3 (as mesmas do `/camera`, TEXTO_DA_CAMERA.semTrava). */
  telaSemTrava: `Tela do celular pode apagar. ${TEXTO_DA_CAMERA.semTrava.iphone} ${TEXTO_DA_CAMERA.semTrava.android}`,
  pronto: 'pronto',
  pendente: 'pendente',
})

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
/** A presença de um dispositivo em `estudio` (a de membro fica de fora). */
type PresencaDeDispositivo = Exclude<PresencaNoEstudio, { tipo: 'membro' }>
type Aviso = { tom: 'info' | 'erro'; texto: string }

/** Um item da conferência automática: pronto ou pendente (desde a E4 nenhum é só informativo). */
export interface ItemDoChecklist {
  texto: string
  situacao: 'pronto' | 'pendente'
}

/**
 * Os itens automáticos do checklist (D13) a partir do palco na presença de `estudio` (`undefined` = palco
 * fora; `null` = palco sem situação do OBS), seguidos dos itens do vídeo (`itensDoVideo`). Avançado = nível 4
 * (`NIVEL_DE_CONTROLE.ADVANCED`); a versão só vale com o obs-websocket conectado (sem ele, "desconhecida" e a do
 * plugin como indicação).
 */
export function itensDoChecklist(palco: SituacaoDoObs | null | undefined, video: readonly ItemDoChecklist[]): ItemDoChecklist[] {
  const T = TEXTO_DO_CHECKLIST
  if (palco === undefined) return [{ texto: T.palcoAusente, situacao: 'pendente' }, { texto: T.obsDesconhecido, situacao: 'pendente' }, ...video]
  const conectado: ItemDoChecklist = { texto: T.palco, situacao: 'pronto' }
  if (palco === null) return [conectado, { texto: T.obsDesconhecido, situacao: 'pendente' }, ...video]
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
    ...video,
  ]
}

/**
 * O `obs_camera` que o "Link da câmera do OBS" usa (PLA-005 D2; revisão 4, N16). A câmera da aba é `existente(lista,
 * 'camera')`; o banco tem no máximo um `obs_camera` não revogado (`dispositivos_um_obs_camera_ativo`, VER-050):
 * - ativo e ligado a esta câmera → reaproveitado (parear de novo avisa a sessão antiga);
 * - ativo e ligado a **outra** câmera (só pela API) → `outra_camera`: nada é gerado, e a aba pede para revogá-lo;
 * - nenhum ativo → o revogado **desta** câmera, se houver (parear de novo limpa a revogação), senão um novo. Um
 *   revogado de outra câmera nunca é reaproveitado: voltaria ligado à câmera errada.
 */
export type ObsCameraDaAba =
  | { tipo: 'sem_camera' }
  | { tipo: 'outra_camera'; obs: Dispositivo }
  | { tipo: 'reaproveitar'; camera: Dispositivo; obs: Dispositivo }
  | { tipo: 'novo'; camera: Dispositivo }

export function obsCameraDaAba(lista: readonly Dispositivo[]): ObsCameraDaAba {
  const camera = existente(lista, 'camera')
  if (camera === null) return { tipo: 'sem_camera' }
  const ativo = lista.find((d) => d.tipo === 'obs_camera' && d.revogadoEm === null)
  if (ativo !== undefined) return ativo.cameraId === camera.id ? { tipo: 'reaproveitar', camera, obs: ativo } : { tipo: 'outra_camera', obs: ativo }
  const revogado = lista.find((d) => d.tipo === 'obs_camera' && d.cameraId === camera.id)
  return revogado === undefined ? { tipo: 'novo', camera } : { tipo: 'reaproveitar', camera, obs: revogado }
}

/** Um lado do vídeo na presença: `undefined` = fora (sem a sessão atual); `null` = presente sem a situação do vídeo. */
export type LadoNaPresenca = SituacaoDoVideo | null | undefined

/** Situações do `obs_camera` que já são a causa (o par existe, e o problema é a conexão ou a Fonte). */
const CAUSAS_DO_OBS: ReadonlySet<EstadoDoVideo> = new Set(['sem_conexao_direta', 'sinal_grande', 'sem_video_direto'])
/** Situações da câmera que não explicam nada sozinhas (o celular está tentando ou esperando o outro lado). */
const ESPERAS_DA_CAMERA: ReadonlySet<EstadoDoVideo> = new Set(['conectado', 'conectando', 'aguardando_par'])

/**
 * Os dois itens do vídeo no checklist (PLA-005 D13; DES-001 §10.4, item 3), a partir do `obs_camera` da aba e da
 * presença da câmera e do `obs_camera` atuais:
 * - **"Vídeo da câmera no OBS"**: pronto só com o `obs_camera` (ligado a esta câmera e pareado) em `conectado`;
 *   pendente com o que fazer (parear a câmera, gerar o link, revogar o da outra câmera) ou com a causa: a do
 *   `obs_camera` quando ela já é a causa; senão a da câmera, quando a câmera não está só esperando; senão o lado
 *   ausente; senão a situação do `obs_camera`. `sem_conexao_direta` leva a instrução de rede do `/camera` (D6).
 * - **"Tela do celular ligada"**: pronto com a trava (`travada`); `sem_trava` → pendente com as instruções; câmera
 *   fora ou sem situação → pendente.
 */
export function itensDoVideo(vinculo: ObsCameraDaAba, camera: LadoNaPresenca, obs: LadoNaPresenca): ItemDoChecklist[] {
  const T = TEXTO_DO_CHECKLIST
  const pendente = (texto: string): ItemDoChecklist => ({ texto, situacao: 'pendente' })
  const causa = (lado: LadoDoVideo, estado: EstadoDoVideo): ItemDoChecklist =>
    pendente(estado === 'sem_conexao_direta' ? T.videoPendente(TEXTO_DA_CAMERA.sem_conexao_direta) : T.videoPendente(fraseDoVideo(lado, estado)))
  const video = ((): ItemDoChecklist => {
    if (vinculo.tipo === 'sem_camera') return pendente(T.videoSemCamera)
    if (vinculo.tipo === 'outra_camera') return pendente(TEXTO_DA_ABA_AO_VIVO.outraCamera)
    if (vinculo.tipo === 'novo' || vinculo.obs.revogadoEm !== null || vinculo.obs.pareadoEm === null) return pendente(T.videoSemObsCamera)
    if (obs === undefined) return pendente(T.videoObsAusente)
    if (obs !== null && obs.estado === 'conectado') return { texto: T.video, situacao: 'pronto' }
    if (obs !== null && CAUSAS_DO_OBS.has(obs.estado)) return causa('obs_camera', obs.estado)
    if (camera !== undefined && camera !== null && !ESPERAS_DA_CAMERA.has(camera.estado)) return causa('camera', camera.estado)
    if (camera === undefined) return pendente(T.videoCelularAusente)
    return obs === null ? pendente(T.videoDesconhecido) : causa('obs_camera', obs.estado)
  })()
  const tela: ItemDoChecklist =
    camera === undefined
      ? pendente(T.telaAusente)
      : camera === null || camera.telaLigada === null
        ? pendente(T.telaDesconhecida)
        : camera.telaLigada === 'sem_trava'
          ? pendente(T.telaSemTrava)
          : { texto: T.tela, situacao: 'pronto' }
  return [video, tela]
}

function pedeReavaliacao(erro: unknown): boolean {
  return erro instanceof ErroDoAoVivo && (erro.motivo === 'negado' || erro.motivo === 'sessao_expirada')
}

/**
 * O dispositivo de um tipo que o painel reaproveita: o primeiro não revogado; senão, o primeiro (parear de novo limpa a
 * revogação). Usado para a câmera e o palco; o `obs_camera` tem regra própria (`obsCameraDaAba`).
 */
function existente(lista: readonly Dispositivo[], tipo: TipoDeDispositivo): Dispositivo | null {
  const doTipo = lista.filter((d) => d.tipo === tipo)
  return doTipo.find((d) => d.revogadoEm === null) ?? doTipo[0] ?? null
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
 *
 * Parte 3 (PLA-005, Tarefa 6; D13, D2; revisão 4, N16): a câmera e o `obs_camera` conectados mostram na lista a
 * situação do vídeo da presença (frases fixas, `TEXTO_DO_VIDEO`); no checklist, "Câmera conectada" (informativo) dá
 * lugar a "Vídeo da câmera no OBS" e "Tela do celular ligada" (`itensDoVideo`). O "Link da câmera do OBS" reaproveita
 * só o `obs_camera` desta câmera (`obsCameraDaAba`): com o ativo ligado a outra câmera, nada é gerado e a aba pede para
 * revogá-lo (a linha dele ganha "Revogar" mesmo nunca pareada); o `23505` de uma corrida vira a frase defensiva da D2.
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
  /**
   * Presença de `estudio` dos dispositivos: chave `<sessão> <dispositivo>` → a presença declarada (o tipo, a situação do
   * OBS, só do palco, e a do vídeo, só da câmera e do `obs_camera`; já validadas pelo adaptador, `lerPresenca`).
   */
  const [presentes, setPresentes] = useState<{ alca: CanalDoEstudio | null; chaves: ReadonlyMap<string, PresencaDeDispositivo> }>({ alca: null, chaves: new Map() })
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
      const chaves = new Map<string, PresencaDeDispositivo>()
      for (const p of lista) if (p.presenca.tipo !== 'membro') chaves.set(`${p.usuario} ${p.presenca.dispositivoId}`, p.presenca)
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
      const vinculo = obsCameraDaAba(lista)
      if (tipo === 'obs_camera' && (vinculo.tipo === 'sem_camera' || vinculo.tipo === 'outra_camera')) {
        setPareamento({ estado: 'nenhum' })
        setAviso({ tom: 'erro', texto: vinculo.tipo === 'sem_camera' ? TEXTO_DA_ABA_AO_VIVO.pareieACamera : TEXTO_DA_ABA_AO_VIVO.outraCamera })
        return
      }
      // a câmera do OBS reaproveitada é só a que exibe esta câmera (`obsCameraDaAba`; revisão 4, N16)
      const reaproveitado =
        tipo === 'camera' ? existente(lista, 'camera') : tipo === 'obs_palco' ? existente(lista, 'obs_palco') : vinculo.tipo === 'reaproveitar' ? vinculo.obs : null
      const r = await repo.criarCodigo({
        tipo,
        rotulo: reaproveitado?.rotulo ?? ROTULO_NOVO[tipo],
        dispositivoId: reaproveitado?.id ?? null,
        cameraId: tipo === 'obs_camera' && reaproveitado === null && vinculo.tipo === 'novo' ? vinculo.camera.id : null,
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
      // corrida (D2): outro painel criou um `obs_camera` entre a leitura e o pedido; a lista é relida para mostrá-lo
      const duplicada = tipo === 'obs_camera' && erro instanceof ErroDoAoVivo && erro.motivo === 'duplicado'
      setAviso({ tom: 'erro', texto: duplicada ? TEXTO_DA_ABA_AO_VIVO.obsCameraDuplicada : TEXTO_DA_ABA_AO_VIVO.naoGerou })
      if (duplicada) void carregar()
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
  const vinculo = obsCameraDaAba(lista)
  /** Por que o link da câmera do OBS não pode ser gerado agora (sem câmera; `obs_camera` ativo de outra câmera). */
  const bloqueioDoLink = vinculo.tipo === 'sem_camera' ? TEXTO_DA_ABA_AO_VIVO.pareieACamera : vinculo.tipo === 'outra_camera' ? TEXTO_DA_ABA_AO_VIVO.outraCamera : null
  const idDaDica = `${prefixo}-dica`
  const idDoLink = `${prefixo}-link`
  const gerando = pareamento.estado === 'gerando'
  // O palco e a câmera do checklist são os da lista com a sessão atual na presença (a mesma regra de "Conectado").
  const palcoConectado = lista.find((d) => d.tipo === 'obs_palco' && conectados.has(d.id))
  const situacaoDoPalco = palcoConectado === undefined || chaves === null ? undefined : (chaves.get(`${palcoConectado.usuarioAnonimoId} ${palcoConectado.id}`)?.obs ?? null)
  /**
   * A situação do vídeo de um dispositivo com a sessão atual na presença: `undefined` fora ou revogado (a sessão revogada
   * pode seguir na presença até o corte, e não fala mais pelo aparelho; revisão da Tarefa 6, N1); `null` sem situação (ou
   * com a presença de outro tipo, que não fala por ele). Só a câmera e o `obs_camera` levam `video` (`lerPresenca`).
   */
  const videoDe = (d: Dispositivo | null): LadoNaPresenca => {
    if (d === null || d.revogadoEm !== null || chaves === null || !conectados.has(d.id)) return undefined
    const p = chaves.get(`${d.usuarioAnonimoId} ${d.id}`)
    return p !== undefined && p.tipo === d.tipo && p.video !== undefined ? p.video : null
  }
  const itensDoVideoNaAba = itensDoVideo(vinculo, videoDe(vinculo.tipo === 'sem_camera' ? null : existente(lista, 'camera')), videoDe(vinculo.tipo === 'reaproveitar' ? vinculo.obs : null))

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
                      const video = videoDe(d)
                      // o `obs_camera` de outra câmera pode ser revogado mesmo nunca pareado: é o que a frase da aba pede
                      const podeRevogar = situacao !== 'revogado' && (situacao !== 'nunca_pareado' || (vinculo.tipo === 'outra_camera' && vinculo.obs.id === d.id))
                      return (
                        <tr key={d.id}>
                          <td>{ROTULO_DO_TIPO[d.tipo]}</td>
                          <td className="dispositivos__rotulo">{d.rotulo}</td>
                          <td>
                            <span className={`dispositivos__situacao dispositivos__situacao--${situacao}`}>{ROTULO_DA_SITUACAO[situacao]}</span>
                            {video != null && d.tipo !== 'obs_palco' && <span className="situacao-do-video">{frasesDoVideo(d.tipo, video)}</span>}
                          </td>
                          <td>
                            {!podeRevogar ? null : confirmando === d.id ? (
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
                disabled={gerando || ocupado || bloqueioDoLink !== null}
                aria-describedby={bloqueioDoLink === null ? undefined : idDaDica}
                onClick={() => void gerar('obs_camera')}
              >
                {ACAO_DO_TIPO.obs_camera}
              </button>
              {bloqueioDoLink !== null && (
                <span id={idDaDica} className="dispositivos__dica">
                  {bloqueioDoLink}
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
      <ChecklistDoAoVivo itens={itensDoChecklist(situacaoDoPalco, itensDoVideoNaAba)} />
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
  const sinal = { pronto: '✓', pendente: '!' } as const
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
