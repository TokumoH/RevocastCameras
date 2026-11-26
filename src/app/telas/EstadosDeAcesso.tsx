import type { ReactNode } from 'react'
import { areaInicial, ROTULO_DO_PAPEL } from '../../domains/acesso/papeis'
import type { Papel } from '../../domains/acesso/papeis'
import type { AvisoDeEntrada, UsuarioDaSessao } from '../../domains/acesso/sessao'
import { Cartao } from '../../shared/ui/Cartao'
import { Logo } from '../../shared/ui/Logo'
import { Mensagem } from '../../shared/ui/Mensagem'
import { caminhoDaArea } from '../dependencias'
import type { EstadoDaTela } from '../useAcesso'

/**
 * Textos fixos dos avisos de entrada. Nenhum vem da URL: o `error_description` nunca é mostrado
 * (PLA-002, restrição "Segurança de interface").
 */
export const TEXTO_DO_AVISO: Record<AvisoDeEntrada, { tom: 'info' | 'erro'; texto: string }> = {
  login_cancelado: { tom: 'info', texto: 'O login com o Google foi cancelado.' },
  login_falhou: { tom: 'erro', texto: 'O Google não concluiu o login. Tente de novo.' },
  login_incompleto: { tom: 'erro', texto: 'O login não terminou neste navegador. Tente de novo por aqui.' },
  sessao_anonima: { tom: 'erro', texto: 'Esta sessão não é de membro. Entre com a sua conta Google.' },
  provedor_invalido: { tom: 'erro', texto: 'Entre com a conta Google cadastrada pela equipe.' },
  sessao_expirada: { tom: 'info', texto: 'Sua sessão expirou. Entre de novo.' },
}

function Tela({ tom, children }: { tom?: 'rosa'; children: ReactNode }) {
  return (
    <main className="tela">
      <Cartao tom={tom}>
        <Logo />
        {children}
      </Cartao>
    </main>
  )
}

export function TelaCarregando({ titulo }: { titulo: string }) {
  return (
    <Tela>
      <h1>{titulo}</h1>
      <p role="status">Conferindo seu acesso…</p>
    </Tela>
  )
}

export function TelaConfiguracaoIncompleta({ mensagem }: { mensagem: string }) {
  return (
    <Tela tom="rosa">
      <h1>Configuração incompleta</h1>
      <p>{mensagem}</p>
      <p>
        Quem cuida do deploy precisa preencher as variáveis do Supabase (veja <code>.env.example</code>).
      </p>
    </Tela>
  )
}

export function TelaErroInesperado() {
  return (
    <Tela tom="rosa">
      <h1>Não foi possível abrir esta página</h1>
      <p>Recarregue a página. Se continuar, avise a equipe.</p>
    </Tela>
  )
}

export function TelaEntrada({ titulo, aviso, aoEntrar }: { titulo: string; aviso: AvisoDeEntrada | null; aoEntrar: () => void }) {
  return (
    <Tela>
      <h1>{titulo}</h1>
      {aviso !== null && <Mensagem tom={TEXTO_DO_AVISO[aviso].tom}>{TEXTO_DO_AVISO[aviso].texto}</Mensagem>}
      <button type="button" className="botao" onClick={aoEntrar}>Entrar com Google</button>
    </Tela>
  )
}

export function TelaForaDaLista({ email, aoEntrar }: { email: string | null; aoEntrar: () => void }) {
  return (
    <Tela tom="rosa">
      <h1>Acesso não liberado</h1>
      <p>
        {email === null
          ? 'O e-mail desta conta não está na lista de acesso do RevoCast. Peça a um admin para incluí-lo.'
          : `O e-mail ${email} não está na lista de acesso do RevoCast. Peça a um admin para incluí-lo.`}
      </p>
      <button type="button" className="botao" onClick={aoEntrar}>Entrar com outra conta</button>
    </Tela>
  )
}

export function TelaSemAcesso({ papel }: { papel: Papel }) {
  return (
    <Tela>
      <h1>Sem acesso a esta página</h1>
      <p>Seu papel ({ROTULO_DO_PAPEL[papel]}) não abre esta área.</p>
      <a className="botao" href={caminhoDaArea(areaInicial(papel))}>Ir para a sua área</a>
    </Tela>
  )
}

export function TelaFalha({ aoTentarDeNovo }: { aoTentarDeNovo: () => void }) {
  return (
    <Tela tom="rosa">
      <h1>Não foi possível falar com o servidor</h1>
      <p>O projeto pode estar pausado ou a rede caiu.</p>
      <button type="button" className="botao" onClick={aoTentarDeNovo}>Tentar de novo</button>
    </Tela>
  )
}

/** Telas de todo estado que não é `membro`; `/entrar` e a guarda das áreas usam as mesmas. */
export function TelaDeAcesso({
  estado,
  titulo,
  aoEntrar,
  aoTentarDeNovo,
}: {
  estado: Exclude<EstadoDaTela, { tipo: 'membro' }>
  titulo: string
  aoEntrar: () => void
  aoTentarDeNovo: () => void
}) {
  switch (estado.tipo) {
    case 'carregando': return <TelaCarregando titulo={titulo} />
    case 'erro_de_configuracao': return <TelaConfiguracaoIncompleta mensagem={estado.mensagem} />
    case 'erro_inesperado': return <TelaErroInesperado />
    case 'sem_sessao': return <TelaEntrada titulo={titulo} aviso={estado.aviso} aoEntrar={aoEntrar} />
    case 'sem_papel': return <TelaForaDaLista email={estado.email} aoEntrar={aoEntrar} />
    case 'falha': return <TelaFalha aoTentarDeNovo={aoTentarDeNovo} />
  }
}

export function CabecalhoDoMembro({ usuario, papel, aoSair }: { usuario: UsuarioDaSessao; papel: Papel; aoSair: () => void }) {
  return (
    <header className="cabecalho-membro">
      <span className="cabecalho-membro__email">{usuario.email}</span>
      <span className="cabecalho-membro__papel">{ROTULO_DO_PAPEL[papel]}</span>
      <button type="button" className="botao botao--contorno" onClick={aoSair}>Sair</button>
    </header>
  )
}
