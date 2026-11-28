import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { TipoDeDispositivo } from '../../domains/acesso/dispositivos'
import type { ObsNoNavegador } from '../../domains/obs/portas'
import { SITUACAO_A_CADA_MS, criarGuardaDaSaida } from '../../domains/obs/saida'
import { Cartao } from '../../shared/ui/Cartao'
import { Logo } from '../../shared/ui/Logo'
import type { Dependencias } from '../dependencias'
import type { ServicosDoDispositivo } from '../servicos'
import { useDispositivo } from '../useDispositivo'
import type { DispositivoPareado, EstadoDaRotaDeDispositivo } from '../useDispositivo'
import { TelaConfiguracaoIncompleta } from './EstadosDeAcesso'

/**
 * Mensagens fixas das rotas de dispositivo (D3, D4, D5, N1). Nenhuma vem do servidor nem leva o código
 * de pareamento. `revogado` só aparece pelo aviso do canal, ao vivo.
 */
export const TEXTO_DO_DISPOSITIVO = Object.freeze({
  carregando: 'Conferindo o pareamento…',
  sem_link: 'Este aparelho não está pareado (ou foi revogado). Abra o link ou o QR gerado na aba Ao vivo do painel.',
  link_invalido: 'Link inválido ou expirado. Gere outro no painel.',
  tipo_errado: 'Este link é de outro tipo de dispositivo.',
  limite: 'Muitas tentativas. Espere 10 minutos ou gere outro link.',
  revogado: 'Este dispositivo foi revogado. Gere um novo link no painel.',
  falha: 'Não foi possível falar com o servidor.',
  tentar: 'Tentar de novo',
} as const)

/** O que a rota recebe depois de pareada. */
export interface Pareado {
  dispositivo: DispositivoPareado
  servicos: ServicosDoDispositivo
  marcarRevogado(): void
}

function Tela({ titulo, tom, children }: { titulo: string; tom?: 'rosa'; children: ReactNode }) {
  return (
    <main className="tela tela-de-dispositivo">
      <Cartao tom={tom}>
        <Logo />
        <h1>{titulo}</h1>
        {children}
      </Cartao>
    </main>
  )
}

type EstadoSemPareado = Exclude<EstadoDaRotaDeDispositivo, { tipo: 'pareado' }>

function TelaDoEstado({ tipo, titulo, estado, tentarDeNovo }: { tipo: TipoDeDispositivo; titulo: string; estado: EstadoSemPareado; tentarDeNovo: () => void }) {
  switch (estado.tipo) {
    case 'carregando':
      // O palco e a câmera do OBS recarregam dentro da Fonte do OBS, inclusive no ar: nada aparece enquanto confere (D16;
      // o `/obs/camera` desde o VER-053, revisão 1, N3 do PLA-005).
      if (tipo === 'obs_palco' || tipo === 'obs_camera') return null
      return (
        <Tela titulo={titulo}>
          <p role="status">{TEXTO_DO_DISPOSITIVO.carregando}</p>
        </Tela>
      )
    case 'configuracao':
      return <TelaConfiguracaoIncompleta mensagem={`Variável de ambiente ausente ou inválida: ${estado.variavel}`} />
    case 'falha':
      return (
        <Tela titulo={titulo} tom="rosa">
          <p role="alert">{TEXTO_DO_DISPOSITIVO.falha}</p>
          <button type="button" className="botao" onClick={tentarDeNovo}>{TEXTO_DO_DISPOSITIVO.tentar}</button>
        </Tela>
      )
    default:
      return (
        <Tela titulo={titulo} tom="rosa">
          <p role="alert">{TEXTO_DO_DISPOSITIVO[estado.tipo]}</p>
        </Tela>
      )
  }
}

/**
 * Casca das três rotas de dispositivo: pareia pelo `useDispositivo`, mostra a tela de cada estado e só
 * entrega o conteúdo (`children`) ao dispositivo pareado. Escolhe o que mostrar; quem nega o dado e o
 * canal é a RLS.
 */
export function TelaDeDispositivo({
  tipo,
  titulo,
  dependencias,
  cobrirTela,
  children,
}: {
  tipo: TipoDeDispositivo
  titulo: string
  dependencias: Dependencias
  /**
   * Quem decide se a tela de um estado sem pareamento aparece (as rotas da Fonte do OBS: só com nada no ar, pela
   * `SoComSaidaParada`; D16, VER-046 I1; o `/obs/camera` desde o VER-053). Sem ela, a tela aparece sempre.
   */
  cobrirTela?: (tela: ReactNode) => ReactNode
  children: (pareado: Pareado) => ReactNode
}): ReactNode {
  const { estado, servicos, tentarDeNovo, marcarRevogado } = useDispositivo(tipo, dependencias)
  if (estado.tipo !== 'pareado') {
    const tela = <TelaDoEstado tipo={tipo} titulo={titulo} estado={estado} tentarDeNovo={tentarDeNovo} />
    return cobrirTela === undefined ? tela : cobrirTela(tela)
  }
  if (servicos === null) return null // não acontece: o pareado só nasce com os serviços obtidos
  return children({ dispositivo: estado.dispositivo, servicos, marcarRevogado })
}

/**
 * As telas de pareamento e de erro das rotas da Fonte do OBS (`/obs/palco` e, desde o VER-053, `/obs/camera`: revogado,
 * sem link, link inválido, falha...) só aparecem quando nada vai ao ar (D16; VER-046, I1; D8 do PLA-005): fora do OBS (sem
 * `window.obsstudio`, não há transmissão) ou com a saída parada e o status conhecido (`saidaParada`). Com a saída no ar ou
 * o status desconhecido, a Fonte fica vazia (transparente). Um evento de início do obs-browser esconde na hora, já no
 * `Starting`, e a tela só volta pela guarda (`criarGuardaDaSaida`: o `*Stopped` da saída ou duas releituras periódicas
 * com a saída parada); a conferência é refeita a cada `SITUACAO_A_CADA_MS` (se um evento faltar). Movida do
 * `PalcoNoAr.tsx` no VER-053, sem mudar uma regra: a casca não depende da tela do palco. Desde o VER-056 (N2), a guarda é
 * a da rota (`GuardaDaRota`), a mesma da tela pareada: os eventos e as releituras vêm dela.
 */
export function SoComSaidaParada({ obs, guarda, children }: { obs: ObsNoNavegador; guarda: GuardaDaRota; children: ReactNode }): ReactNode {
  const [livre, setLivre] = useState(false)
  useEffect(() => {
    let vivo = true
    let geracao = 0
    async function conferir(): Promise<void> {
      const minha = ++geracao
      const ok = !obs.disponivel() || (await guarda.livre())
      if (vivo && minha === geracao) setLivre(ok)
    }
    void conferir()
    const soltarSaida = guarda.aoMudarSaida((tipo) => {
      if (tipo === 'inicio') setLivre(false)
      void conferir()
    })
    const soltarReleitura = guarda.aoReler(() => void conferir())
    return () => {
      vivo = false
      soltarSaida()
      soltarReleitura()
    }
  }, [obs, guarda])
  return livre ? children : null
}

/** A guarda da saída de uma rota da Fonte do OBS, dividida pela casca e pela tela pareada (VER-056, N2). */
export interface GuardaDaRota {
  /** A regra de `criarGuardaDaSaida` (saída parada e status conhecido; recusa depois de um início sem o fim). */
  livre(): Promise<boolean>
  /** Avisado de cada evento de saída do obs-browser, **depois** de a guarda registrá-lo. */
  aoMudarSaida(f: (tipo: 'inicio' | 'fim', saida: string) => void): () => void
  /** Avisado a cada releitura periódica (`SITUACAO_A_CADA_MS`), **depois** de a guarda contá-la. */
  aoReler(f: () => void): () => void
}

/**
 * Uma guarda por rota (VER-056, N2): criada uma vez no `ObsPalco`/`ObsCamera` (como a porta `obs`) e passada à
 * `SoComSaidaParada` e à tela pareada. Só ela ouve os eventos de saída e conta as releituras, então o início visto com a
 * rota pareada vale também para a tela de erro que aparece depois (a revogação entre o `*Starting` e o `*Started` não
 * mostra mais o cartão por cerca de 1 s). `ligar()` põe os ouvintes e o relógio e devolve o desligamento (o efeito da rota).
 */
export function criarGuardaDaRota(obs: ObsNoNavegador): GuardaDaRota & { ligar(): () => void } {
  const guarda = criarGuardaDaSaida(obs)
  const saidas = new Set<(tipo: 'inicio' | 'fim', saida: string) => void>()
  const releituras = new Set<() => void>()
  function ouvir<F>(lista: Set<F>, f: F): () => void {
    lista.add(f)
    return () => {
      lista.delete(f)
    }
  }
  return {
    livre: () => guarda.livre(),
    aoMudarSaida: (f) => ouvir(saidas, f),
    aoReler: (f) => ouvir(releituras, f),
    ligar() {
      const soltar = obs.aoMudarSaida((tipo, saida) => {
        guarda.evento(tipo, saida)
        for (const f of [...saidas]) f(tipo, saida)
      })
      const t = setInterval(() => {
        guarda.contarReleitura()
        for (const f of [...releituras]) f()
      }, SITUACAO_A_CADA_MS)
      return () => {
        soltar()
        clearInterval(t)
      }
    },
  }
}

/** A guarda da rota (`criarGuardaDaRota`), uma por montagem da rota, ligada enquanto ela estiver montada. */
export function useGuardaDaRota(obs: ObsNoNavegador): GuardaDaRota {
  const [guarda] = useState(() => criarGuardaDaRota(obs))
  useEffect(() => guarda.ligar(), [guarda])
  return guarda
}
