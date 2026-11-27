import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { TipoDeDispositivo } from '../../domains/acesso/dispositivos'
import { Cartao } from '../../shared/ui/Cartao'
import { Logo } from '../../shared/ui/Logo'
import type { Dependencias } from '../dependencias'
import type { ServicosDoDispositivo } from '../servicos'
import { acompanharEstudio, useDispositivo } from '../useDispositivo'
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
      // O palco recarrega dentro da Fonte do OBS, inclusive no ar: nada aparece enquanto confere (D16).
      if (tipo === 'obs_palco') return null
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
  children,
}: {
  tipo: TipoDeDispositivo
  titulo: string
  dependencias: Dependencias
  children: (pareado: Pareado) => ReactNode
}): ReactNode {
  const { estado, servicos, tentarDeNovo, marcarRevogado } = useDispositivo(tipo, dependencias)
  if (estado.tipo !== 'pareado') return <TelaDoEstado tipo={tipo} titulo={titulo} estado={estado} tentarDeNovo={tentarDeNovo} />
  if (servicos === null) return null // não acontece: o pareado só nasce com os serviços obtidos
  return children({ dispositivo: estado.dispositivo, servicos, marcarRevogado })
}

/**
 * `/camera` e `/obs/camera` pareados (o vídeo chega na E4): o rótulo, a presença em `estudio` e a
 * revogação ao vivo (`acompanharEstudio`).
 */
export function CameraPareada({ tipo, titulo, pareado }: { tipo: 'camera' | 'obs_camera'; titulo: string; pareado: Pareado }) {
  const { dispositivo, servicos, marcarRevogado } = pareado
  useEffect(() => {
    const estudio = acompanharEstudio({
      tipo,
      dispositivo,
      servicos,
      presenca: () => ({ tipo, dispositivoId: dispositivo.id, obs: null }),
      marcarRevogado,
      agendar: (f, ms) => {
        const t = setTimeout(f, ms)
        return () => clearTimeout(t)
      },
    })
    return () => estudio.parar()
  }, [tipo, dispositivo, servicos, marcarRevogado])

  return (
    <Tela titulo={titulo}>
      <p role="status">{`Pareado como ${dispositivo.rotulo}. O vídeo chega na etapa E4.`}</p>
    </Tela>
  )
}
