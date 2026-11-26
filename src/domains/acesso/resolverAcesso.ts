import { ErroDeAcesso } from './portas'
import type { ServicoDeAutenticacao, ServicosDeMembro } from './portas'
import type { RetornoDoLogin } from './retornoDoLogin'
import type { AvisoDeEntrada, EstadoDeAcesso } from './sessao'

/** A porta promete que `sair` não lança, mas o domínio não depende disso. */
async function sairSemFalhar(auth: ServicoDeAutenticacao): Promise<void> {
  try {
    await auth.sair()
  } catch {
    /* a sessão local já saiu ou sai na próxima leitura; o estado decidido vale */
  }
}

function avisoDoRetorno(retorno: RetornoDoLogin): AvisoDeEntrada | null {
  if (retorno.erro === 'cancelado') return 'login_cancelado'
  if (retorno.erro === 'falha') return 'login_falhou'
  return retorno.temCodigo ? 'login_incompleto' : null
}

/**
 * Serviço de domínio: sessão + papel → estado de acesso. Ordem fixa: ler a sessão (qualquer erro
 * → falha, sem sair nem perguntar o papel); sem sessão → aviso pelo retorno do login; sessão
 * anônima ou de outro provedor nunca vira membro (sai antes de perguntar o papel); papel lido do
 * banco (`papel_atual()`): sessão expirada → sai com aviso; outro erro → falha (sem sair: a sessão
 * pode estar boa e o servidor fora); sem papel → sai e mostra o e-mail (D3); com papel → membro.
 */
export async function resolverAcesso(servicos: ServicosDeMembro, retorno: RetornoDoLogin): Promise<EstadoDeAcesso> {
  const { auth, repo } = servicos

  let usuario
  try {
    usuario = await auth.usuarioAtual()
  } catch {
    return { tipo: 'falha' }
  }

  if (usuario === null) return { tipo: 'sem_sessao', aviso: avisoDoRetorno(retorno) }

  if (usuario.anonimo) {
    await sairSemFalhar(auth)
    return { tipo: 'sem_sessao', aviso: 'sessao_anonima' }
  }

  if (usuario.provedor !== 'google') {
    await sairSemFalhar(auth)
    return { tipo: 'sem_sessao', aviso: 'provedor_invalido' }
  }

  let papel
  try {
    papel = await repo.papelAtual()
  } catch (erro) {
    if (erro instanceof ErroDeAcesso && erro.motivo === 'sessao_expirada') {
      await sairSemFalhar(auth)
      return { tipo: 'sem_sessao', aviso: 'sessao_expirada' }
    }
    return { tipo: 'falha' }
  }

  if (papel === null) {
    await sairSemFalhar(auth)
    return { tipo: 'sem_papel', email: usuario.email }
  }

  return { tipo: 'membro', usuario, papel }
}
