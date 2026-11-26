import type { SupabaseClient } from '@supabase/supabase-js'
import type { MembroPermitido, PerfilDeMembro } from '../../domains/acesso/listaDeAcesso'
import { ehPapel } from '../../domains/acesso/papeis'
import type { Papel } from '../../domains/acesso/papeis'
import { ErroDeAcesso } from '../../domains/acesso/portas'
import type { MotivoDoErro, RepositorioDeAcesso, ServicoDeAutenticacao } from '../../domains/acesso/portas'
import { classificarErro } from './errosSupabase'

/** Texto fixo do aviso de `sair()`: nunca leva e-mail, token nem o objeto de erro. */
const AVISO_SAIR = 'sair: o servidor não confirmou a saída; a sessão local foi apagada'

/**
 * Traduz um erro do PostgREST (`{ code, message }` + status HTTP) para um `ErroDeAcesso`. Desde a E2, a
 * classificação é a comum (`classificarErro`, em `errosSupabase.ts`, D10 do PLA-003), sem mudar a E1.
 * A ordem vale:
 * (1) 401 ou JWT recusado (`PGRST301`/`PGRST303`) → `sessao_expirada`, antes do `42501`, porque o
 * PostgREST devolve `42501` com 401 quando a requisição sai como `anon` (sessão apagada em outra aba);
 * (2) `23505` → `duplicado`; (3) `23514` → `invalido`; (4) `42501` → `negado`;
 * (5) sem código e status 0 (o `postgrest-js` 2.119.0 devolve assim a falha do `fetch`) → `rede`;
 * (6) o resto → `outro`, inclusive `23503` e `22P02`, que a classificação comum chama de `em_uso` e
 * `invalido` (motivos da Preparação que a E1 não usa; teste `e1-traduzir-erro-sem-mudanca`).
 * A mensagem do servidor (que pode citar o e-mail) é descartada.
 */
export function traduzirErro(erro: { code?: string; message?: string } | null, status?: number): ErroDeAcesso {
  return new ErroDeAcesso(motivoDoErro(erro, status))
}

function motivoDoErro(erro: { code?: string } | null, status: number | undefined): MotivoDoErro {
  const motivo = classificarErro(erro, status)
  // em_uso não existe na E1; e o invalido da E1 sempre foi só o 23514 (CHECK).
  if (motivo === 'em_uso') return 'outro'
  if (motivo === 'invalido' && erro?.code === '22P02') return 'outro'
  return motivo
}

/** Adaptador da porta `ServicoDeAutenticacao` sobre o `auth` do supabase-js (cliente de membro). */
export function criarAutenticacaoSupabase(cliente: SupabaseClient): ServicoDeAutenticacao {
  return {
    async usuarioAtual() {
      let resultado: Awaited<ReturnType<typeof cliente.auth.getSession>>
      try {
        resultado = await cliente.auth.getSession()
      } catch {
        // A porta promete ErroDeAcesso('rede') para qualquer falha ao ler a sessão; o erro original não sai daqui.
        throw new ErroDeAcesso('rede')
      }
      const { data, error } = resultado
      // Com a sessão expirada e a rede caída o auth-js devolve session: null E error, mas a sessão continua
      // guardada: tratar como "sem sessão" mandaria um membro para a entrada (PLA-002, Foco da revisão, item 10).
      if (error) throw new ErroDeAcesso('rede')
      const u = data.session?.user
      if (!u) return null
      return {
        id: u.id,
        email: u.email ?? null,
        anonimo: u.is_anonymous === true,
        provedor: u.app_metadata?.provider ?? null,
      }
    },

    aoMudarSessao(ouvinte) {
      // Depois de cancelar, nem um setTimeout já agendado chama o ouvinte.
      let ativo = true
      const { data } = cliente.auth.onAuthStateChange((evento) => {
        // A primeira avaliação é do useAcesso (Tarefa 4); INITIAL_SESSION não reavalia.
        if (evento === 'INITIAL_SESSION') return
        // Nunca chamar o Supabase dentro deste callback (o auth-js pode travar): só agenda.
        setTimeout(() => {
          if (ativo) ouvinte()
        }, 0)
      })
      return () => {
        ativo = false
        data.subscription.unsubscribe()
      }
    },

    async entrarComGoogle(urlDeRetorno) {
      const { error } = await cliente.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: urlDeRetorno, queryParams: { prompt: 'select_account' } },
      })
      if (error) throw new ErroDeAcesso('rede')
    },

    async sair() {
      // scope 'local': o auth-js 2.119.0 apaga a sessão deste navegador antes de pedir a revogação ao servidor
      // (e também quando o refresh falha por rede); um erro aqui é só da revogação. Não lança: quem chama já
      // decidiu o estado da tela.
      try {
        const { error } = await cliente.auth.signOut({ scope: 'local' })
        if (error) console.warn(AVISO_SAIR)
      } catch {
        console.warn(AVISO_SAIR)
      }
    },
  }
}

interface LinhaPermitido {
  email: string
  papel: unknown
  criado_por: string | null
}

interface LinhaPerfil {
  id: string
  email: string
  nome: string
}

/**
 * Adaptador da porta `RepositorioDeAcesso` (agregado de acesso, D6 do PLA-002) sobre o PostgREST.
 * Não normaliza e-mail (é o domínio quem normaliza; o banco recusa maiúsculas por `CHECK`) nem decide
 * acesso: quem nega é a RLS, e uma escrita filtrada por ela volta com 0 linhas → `nada_alterado`.
 */
export function criarRepositorioDeAcessoSupabase(cliente: SupabaseClient): RepositorioDeAcesso {
  return {
    async papelAtual() {
      const { data, error, status } = await cliente.rpc('papel_atual')
      if (error) throw traduzirErro(error, status)
      return ehPapel(data) ? data : null
    },

    async listarPermitidos() {
      const { data, error, status } = await cliente
        .from('membros_permitidos')
        .select('email, papel, criado_por')
        .order('email')
      if (error) throw traduzirErro(error, status)
      const linhas = (data ?? []) as LinhaPermitido[]
      const permitidos: MembroPermitido[] = []
      for (const l of linhas) {
        // Papel desconhecido (enum novo no banco antes do app): a linha é descartada, nunca vira papel.
        if (ehPapel(l.papel)) permitidos.push({ email: l.email, papel: l.papel, criadoPor: l.criado_por ?? null })
      }
      return permitidos
    },

    async listarPerfis() {
      const { data, error, status } = await cliente.from('membros').select('id, email, nome').order('email')
      if (error) throw traduzirErro(error, status)
      return ((data ?? []) as LinhaPerfil[]).map((l): PerfilDeMembro => ({ id: l.id, email: l.email, nome: l.nome }))
    },

    async incluir(email: string, papel: Papel, criadoPor: string) {
      const { error, status } = await cliente
        .from('membros_permitidos')
        .insert({ email, papel, criado_por: criadoPor })
      if (error) throw traduzirErro(error, status)
    },

    async alterarPapel(email: string, papel: Papel) {
      // O select depois do update vira RETURNING; ele exige a política de leitura, que o admin tem
      // (membros_permitidos_admin_le). 0 linhas = a RLS filtrou (papel mudou, linha sumiu ou é a própria, D1).
      const { data, error, status } = await cliente
        .from('membros_permitidos')
        .update({ papel })
        .eq('email', email)
        .select('email')
      if (error) throw traduzirErro(error, status)
      if (!data || data.length === 0) throw new ErroDeAcesso('nada_alterado')
    },

    async remover(email: string) {
      const { data, error, status } = await cliente
        .from('membros_permitidos')
        .delete()
        .eq('email', email)
        .select('email')
      if (error) throw traduzirErro(error, status)
      if (!data || data.length === 0) throw new ErroDeAcesso('nada_alterado')
    },
  }
}
