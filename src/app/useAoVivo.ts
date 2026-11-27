import { useCallback, useEffect, useRef, useState } from 'react'
import type { Papel } from '../domains/acesso/papeis'
import type { UsuarioDaSessao } from '../domains/acesso/sessao'
import type { ListasDoAoVivo } from '../domains/aovivo/comandos'
import type { Comando, EstadoNoAr, PedidoDeComando } from '../domains/aovivo/mensagens'
import { ErroDoAoVivo } from '../domains/aovivo/portas'
import type { CanalDoControle, CanalDoEstudio, EstadoDoCanal, FabricaDeCanais, RepositorioDoAoVivo, RespostaDoEnvio } from '../domains/aovivo/portas'
import { ErroDePreparacao } from '../domains/preparacao/portas'
import type { ServicosDePreparacao } from '../domains/preparacao/portas'
import type { Dependencias } from './dependencias'
import { REABRIR_CANAIS_MS } from './useDispositivo'
import { useCanalReaberto, useEstudio } from './useEstudio'

/** Numa sequência de leituras negadas (ou com sessão vencida) seguidas, no máximo 3 `reavaliar()`; depois só a frase de falha e as novas tentativas. */
export const REAVALIACOES_DA_LEITURA = 3
/** A nova consulta depois de uma falha espera 5 s, 10 s, 20 s… até este teto (1 min). */
export const ESPERA_MAXIMA_DA_CONSULTA_MS = 60_000

/** Quantos pedidos desta tela ficam lembrados para dizer o alvo do "Último" ("🎵 aplauso ✓"). */
const PEDIDOS_LEMBRADOS = 50

/** O episódio ativo como a tela o mostra: o de `episodio_ativo()` e o título da lista de episódios. */
export interface EpisodioDoAoVivo {
  id: string
  modo: 'ao_vivo' | 'teste'
  titulo: string
}

export interface AoVivo {
  /** `false` até a primeira consulta do episódio ativo responder (a tela não diz "nenhum episódio" antes). */
  carregado: boolean
  /** A última consulta falhou (rede); a tela avisa e uma nova consulta sai em 5 s. */
  falhaAoCarregar: boolean
  episodio: EpisodioDoAoVivo | null
  /** O último estado publicado pelo palco **deste** episódio (validado no adaptador; outro episódio é ignorado). */
  estadoNoAr: EstadoNoAr | null
  /** Pior estado entre `estudio` e o `:controle` do episódio (sem episódio, só o de `estudio`). */
  canal: EstadoDoCanal
  /** Um `obs_palco` na presença de `estudio` (D14). */
  palcoPresente: boolean
  listas: ListasDoAoVivo
  estudio: CanalDoEstudio | null
  /** O pedido desta tela que gerou o `ultimo` do estado no ar, se foi daqui. */
  pedidoDoUltimo: PedidoDeComando | null
  /** Envia com `id` de `crypto.randomUUID()`; nada é reenviado sozinho (D15). */
  enviar(c: PedidoDeComando): Promise<RespostaDoEnvio>
}

/** Sem episódio: listas vazias (nunca alteradas; cada carga troca o objeto inteiro). */
const LISTAS_VAZIAS: ListasDoAoVivo = { cenas: [], sons: [], avisos: [] }

/** Ordem de gravidade: perda do canal (`fechado`/`negado`) > `reconectando` > `conectando` > `conectado`. */
const GRAVIDADE: Readonly<Record<EstadoDoCanal, number>> = { conectado: 0, conectando: 1, reconectando: 2, fechado: 3, negado: 3 }

function pior(a: EstadoDoCanal, b: EstadoDoCanal): EstadoDoCanal {
  return GRAVIDADE[b] > GRAVIDADE[a] ? b : a
}

/** Acesso negado ou sessão vencida numa leitura → reavaliar o acesso (como as abas do painel). */
function pedeReavaliacao(erro: unknown): boolean {
  return (erro instanceof ErroDoAoVivo || erro instanceof ErroDePreparacao) && (erro.motivo === 'negado' || erro.motivo === 'sessao_expirada')
}

interface Carga {
  carregado: boolean
  falhou: boolean
  episodio: EpisodioDoAoVivo | null
  listas: ListasDoAoVivo
}

/**
 * O ao vivo de uma tela de membro (`/controle`; na Tarefa 9, a aba Ao vivo), sobre o cliente de membro
 * (D5, D9, D14, D15, N3):
 * - consulta `episodio_ativo()` ao montar, no aviso `episodio_ativo_mudou` de `estudio`, a cada volta do
 *   `estudio` a `conectado` e a cada volta à aba (`aoVoltarAVer`, Safari do iPhone); com episódio, lê o
 *   título, as cenas, os sons e os avisos dele; falha → avisa e tenta de novo (5 s, dobrando até 1 min);
 *   acesso negado ou sessão vencida → `reavaliar()`, no máximo 3 vezes seguidas (a guarda decide; se ela
 *   mantém a pessoa e a leitura continua negada, a tela não reavalia sem fim); um sucesso zera as contagens;
 * - `estudio` de fora (opcional): quem já tem o `estudio` (o painel, Tarefas 8 e 9) o passa, e o hook não
 *   abre outra alça nem cuida da perda dele (a presença e o `reavaliar()` do `estudio` são de quem o abriu);
 * - `estudio` por `useEstudio` (presença `{ tipo: 'membro', papel }`) e o `:controle` do episódio por
 *   `useCanalReaberto` (presença marcada: o palco republica o estado); trocar de episódio fecha o tópico
 *   antigo e abre o novo; `fechado`/`negado` em qualquer um → um `reavaliar()` só (os dois juntos, numa
 *   renovação de token, contam uma vez) e reabertura em 5 s se a tela continuar montada;
 * - `revogacao` do próprio `usuario.id` → `reavaliar()` (D5); de outro, nada;
 * - `enviar`: duas respostas `sem_resposta` seguidas com o canal `conectado` → `reavaliar()` (um envio sem
 *   permissão volta como `timed out`, igual a rede ruim, N3); um `ok`, a troca de episódio e a volta do
 *   canal a `conectado` depois de uma queda zeram a contagem (a contagem é de respostas seguidas no mesmo
 *   canal e no mesmo episódio);
 * - trocar de episódio limpa o estado no ar (o do episódio anterior não volta a aparecer).
 */
export function useAoVivo(d: {
  repo: RepositorioDoAoVivo
  preparacao: ServicosDePreparacao
  canais: FabricaDeCanais
  usuario: UsuarioDaSessao
  papel: Papel
  reavaliar: () => void
  aoVoltarAVer: Dependencias['aoVoltarAVer']
  /** O `estudio` de quem já o abriu (o `useEstudio` do painel); sem ele, o hook abre o próprio. */
  estudio?: { estudio: CanalDoEstudio | null; estado: EstadoDoCanal }
}): AoVivo {
  const { repo, preparacao, canais, papel, aoVoltarAVer } = d
  const usuarioId = d.usuario.id
  const reavaliar = useRef(d.reavaliar)
  useEffect(() => {
    reavaliar.current = d.reavaliar
  })

  const [carga, setCarga] = useState<Carga>({ carregado: false, falhou: false, episodio: null, listas: LISTAS_VAZIAS })
  const [estadoNoAr, setEstadoNoAr] = useState<EstadoNoAr | null>(null)
  const [presenca, setPresenca] = useState<{ alca: CanalDoEstudio | null; palco: boolean }>({ alca: null, palco: false })
  const [pedidos, setPedidos] = useState<ReadonlyMap<string, PedidoDeComando>>(() => new Map())

  const semRespostaSeguidas = useRef(0)

  // --- perda de canal: um reavaliar() por janela de 5 s, para `estudio` e `:controle` caírem juntos ---
  const bloqueioDaPerda = useRef<ReturnType<typeof setTimeout> | null>(null)
  const perdeuCanal = useCallback(() => {
    if (bloqueioDaPerda.current !== null) return
    reavaliar.current()
    bloqueioDaPerda.current = setTimeout(() => {
      bloqueioDaPerda.current = null
    }, REABRIR_CANAIS_MS)
  }, [])
  useEffect(
    () => () => {
      if (bloqueioDaPerda.current !== null) clearTimeout(bloqueioDaPerda.current)
      bloqueioDaPerda.current = null
    },
    [],
  )

  // --- consulta do episódio ativo ---
  const vivo = useRef(false)
  const consulta = useRef(0)
  const novaTentativa = useRef<ReturnType<typeof setTimeout> | null>(null)
  const falhasSeguidas = useRef(0)
  const reavaliacoesDaLeitura = useRef(0)
  const consultar = useCallback(async (): Promise<void> => {
    const minha = ++consulta.current
    if (novaTentativa.current !== null) clearTimeout(novaTentativa.current)
    novaTentativa.current = null
    const atual = () => vivo.current && minha === consulta.current
    try {
      const ativo = await repo.episodioAtivo()
      if (!atual()) return
      if (ativo === null) {
        falhasSeguidas.current = 0
        reavaliacoesDaLeitura.current = 0
        setCarga({ carregado: true, falhou: false, episodio: null, listas: LISTAS_VAZIAS })
        return
      }
      const [episodios, cenas, sons, avisos] = await Promise.all([
        preparacao.episodios.listar(),
        preparacao.cenas.listar(),
        preparacao.sons.listar(),
        preparacao.episodios.listarAvisos(ativo.id),
      ])
      if (!atual()) return
      const titulo = episodios.find((e) => e.id === ativo.id)?.titulo ?? ''
      falhasSeguidas.current = 0
      reavaliacoesDaLeitura.current = 0
      setCarga({ carregado: true, falhou: false, episodio: { id: ativo.id, modo: ativo.modo, titulo }, listas: { cenas, sons, avisos } })
    } catch (erro) {
      if (!atual()) return
      if (pedeReavaliacao(erro) && reavaliacoesDaLeitura.current < REAVALIACOES_DA_LEITURA) {
        reavaliacoesDaLeitura.current += 1
        reavaliar.current()
      }
      setCarga((c) => ({ ...c, carregado: true, falhou: true }))
      const espera = Math.min(REABRIR_CANAIS_MS * 2 ** falhasSeguidas.current, ESPERA_MAXIMA_DA_CONSULTA_MS)
      falhasSeguidas.current += 1
      novaTentativa.current = setTimeout(() => {
        novaTentativa.current = null
        if (vivo.current) void consultar()
      }, espera)
    }
  }, [repo, preparacao])

  useEffect(() => {
    vivo.current = true
    void consultar()
    const cancelarVolta = aoVoltarAVer(() => void consultar())
    return () => {
      vivo.current = false
      consulta.current++
      if (novaTentativa.current !== null) clearTimeout(novaTentativa.current)
      novaTentativa.current = null
      cancelarVolta()
    }
  }, [consultar, aoVoltarAVer])

  // --- estudio ---
  const deFora = d.estudio
  const proprio = useEstudio({ canais: deFora === undefined ? canais : null, papel, reavaliar: perdeuCanal })
  const { estudio, estado: estadoDoEstudio } = deFora ?? proprio

  useEffect(() => {
    if (estudio === null) return
    const soltarMensagens = estudio.aoReceber((m) => {
      if (m.evento === 'episodio_ativo_mudou') void consultar()
      else if (m.evento === 'revogacao' && m.usuario === usuarioId) reavaliar.current()
    })
    const soltarPresenca = estudio.aoMudarPresenca((presentes) => {
      setPresenca({ alca: estudio, palco: presentes.some((p) => p.presenca.tipo === 'obs_palco') })
    })
    return () => {
      soltarMensagens()
      soltarPresenca()
    }
  }, [estudio, usuarioId, consultar])

  // Cada volta do `estudio` a `conectado` (depois da primeira) consulta de novo (D15).
  const jaConectou = useRef(false)
  useEffect(() => {
    if (estadoDoEstudio !== 'conectado') return
    if (jaConectou.current) void consultar()
    jaConectou.current = true
  }, [estadoDoEstudio, consultar])

  // --- :controle do episódio ---
  const episodioId = carga.episodio?.id ?? null
  const abrirControle = useCallback((): CanalDoControle => canais.controle(episodioId as string), [canais, episodioId])
  const { canal: controle, estado: estadoDoControle } = useCanalReaberto(episodioId === null ? null : abrirControle, perdeuCanal)

  // Trocar de episódio limpa o estado no ar (a contagem de `sem_resposta` zera pela volta a `conectado`, abaixo).
  useEffect(() => {
    setEstadoNoAr(null)
  }, [episodioId])

  useEffect(() => {
    if (controle === null || episodioId === null) return
    void controle.marcarPresenca().catch(() => {})
    return controle.aoEstado((e) => {
      if (e.episodioId === episodioId) setEstadoNoAr(e)
    })
  }, [controle, episodioId])

  // --- envio ---
  const canal = episodioId === null ? estadoDoEstudio : pior(estadoDoEstudio, estadoDoControle)
  const vistaDoEnvio = useRef<{ controle: CanalDoControle | null; canal: EstadoDoCanal }>({ controle: null, canal: 'conectando' })
  useEffect(() => {
    vistaDoEnvio.current = { controle, canal }
  })

  // A volta do canal a `conectado` depois de uma queda zera a contagem (`canal` só é `conectado` com tudo conectado).
  // Cobre também a troca de episódio: o `:controle` novo nasce em `conectando`, então `canal` sai de `conectado` e volta.
  useEffect(() => {
    if (canal === 'conectado') semRespostaSeguidas.current = 0
  }, [canal])

  const enviar = useCallback(async (pedido: PedidoDeComando): Promise<RespostaDoEnvio> => {
    const { controle: alca, canal: estadoAoEnviar } = vistaDoEnvio.current
    if (alca === null || estadoAoEnviar !== 'conectado') return 'falhou'
    const comando: Comando = { ...pedido, id: crypto.randomUUID() }
    setPedidos((antes) => {
      const depois = new Map(antes)
      depois.set(comando.id, pedido)
      while (depois.size > PEDIDOS_LEMBRADOS) depois.delete(depois.keys().next().value as string)
      return depois
    })
    const resposta = await alca.enviarComando(comando)
    if (resposta === 'ok') semRespostaSeguidas.current = 0
    else if (resposta === 'sem_resposta') {
      semRespostaSeguidas.current += 1
      if (semRespostaSeguidas.current >= 2) {
        semRespostaSeguidas.current = 0
        reavaliar.current()
      }
    }
    return resposta
  }, [])

  const estadoDoEpisodio = estadoNoAr !== null && estadoNoAr.episodioId === episodioId ? estadoNoAr : null
  const ultimoId = estadoDoEpisodio?.ultimo?.comandoId
  return {
    carregado: carga.carregado,
    falhaAoCarregar: carga.falhou,
    episodio: carga.episodio,
    estadoNoAr: estadoDoEpisodio,
    canal,
    palcoPresente: presenca.alca !== null && presenca.alca === estudio && presenca.palco,
    listas: carga.listas,
    estudio,
    pedidoDoUltimo: ultimoId === undefined ? null : (pedidos.get(ultimoId) ?? null),
    enviar,
  }
}
