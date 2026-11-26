import type { SupabaseClient } from '@supabase/supabase-js'
import type { Cena } from '../../domains/preparacao/cenas'
import type { Aviso, EstadoDoEpisodio, Episodio } from '../../domains/preparacao/episodios'
import { ACOES, GESTOS, normalizarGesto } from '../../domains/preparacao/gestos'
import type { AcaoDoGesto, Gesto, LinhaDoMapa } from '../../domains/preparacao/gestos'
import type { Midia, Som, TipoDeMidia } from '../../domains/preparacao/midia'
import { ErroDePreparacao } from '../../domains/preparacao/portas'
import type {
  RepositorioDeCenas,
  RepositorioDeEpisodios,
  RepositorioDeGestos,
  RepositorioDeMidias,
  RepositorioDeSons,
  ServicosDePreparacao,
} from '../../domains/preparacao/portas'
import { classificarErro, exigirLinhas } from './errosSupabase'

/** O que o `postgrest-js` devolve quando aguardado (só os campos usados aqui). */
interface Resposta {
  data: unknown
  error: { code?: string; message?: string } | null
  status: number
  count?: number | null
}

/**
 * Aguarda a consulta e traduz **todo** erro para `ErroDePreparacao` (D10): o devolvido pelo PostgREST
 * pela classificação comum, e um lançado (o `postgrest-js` 2.119.0 não lança, mas uma versão futura ou
 * `throwOnError` poderia) como `outro`. Assim a compensação do envio (`biblioteca.ts`) sempre decide
 * sobre um motivo. A mensagem do servidor nunca passa adiante.
 */
async function executar(consulta: PromiseLike<Resposta>): Promise<Resposta> {
  let resposta: Resposta
  try {
    resposta = await consulta
  } catch {
    throw new ErroDePreparacao('outro')
  }
  if (resposta.error) throw new ErroDePreparacao(classificarErro(resposta.error, resposta.status))
  return resposta
}

/** Escrita com retorno: erro traduzido e 0 linhas → `nada_alterado`. */
async function escreverComRetorno(consulta: PromiseLike<Resposta>): Promise<void> {
  const { data } = await executar(consulta)
  exigirLinhas(Array.isArray(data) ? data : null)
}

function linhas<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : []
}

const TIPOS: readonly TipoDeMidia[] = ['som', 'imagem']
const ESTADOS: readonly EstadoDoEpisodio[] = ['rascunho', 'ao_vivo', 'encerrado']
const NOMES_DE_GESTO: readonly string[] = GESTOS.map((g) => g.gesto)
const NOMES_DE_ACAO: readonly string[] = ACOES.map((a) => a.acao)

interface LinhaMidia {
  id: string
  tipo: string
  nome: string
  caminho: string
  mime: string
  tamanho_bytes: number
  enviado_por: string | null
}

interface LinhaSom {
  id: string
  midia_id: string
  rotulo: string
  emoji: string | null
  volume: number
  ordem: number
}

interface LinhaCena {
  id: string
  nome_exibicao: string
  nome_obs: string
  ordem: number
}

interface LinhaEpisodio {
  id: string
  titulo: string
  data: string
  estado: string
}

interface LinhaAviso {
  id: string
  episodio_id: string
  titulo: string
  texto: string
  link: string | null
  imagem_midia_id: string | null
  duracao_s: number
  ordem: number
}

interface LinhaGesto {
  gesto: string
  acao: string
  cena_id: string | null
  som_id: string | null
}

function repositorioDeMidias(cliente: SupabaseClient): RepositorioDeMidias {
  return {
    async listar() {
      const { data } = await executar(cliente.from('midias').select('id, tipo, nome, caminho, mime, tamanho_bytes, enviado_por').order('nome'))
      const midias: Midia[] = []
      for (const l of linhas<LinhaMidia>(data)) {
        // Tipo desconhecido (enum novo no banco antes do app): a linha é descartada, nunca vira mídia.
        if (!TIPOS.includes(l.tipo as TipoDeMidia)) continue
        midias.push({
          id: l.id,
          tipo: l.tipo as TipoDeMidia,
          nome: l.nome,
          caminho: l.caminho,
          mime: l.mime,
          tamanhoBytes: Number(l.tamanho_bytes),
          enviadoPor: l.enviado_por ?? null,
        })
      }
      return midias
    },

    async registrar(m) {
      // Os valores já vêm conferidos do domínio (biblioteca.ts): nada é reconvertido aqui.
      await executar(
        cliente.from('midias').insert({
          id: m.id,
          tipo: m.tipo,
          nome: m.nome,
          caminho: m.caminho,
          mime: m.mime,
          tamanho_bytes: m.tamanhoBytes,
          enviado_por: m.enviadoPor,
        }),
      )
    },

    async remover(id) {
      await escreverComRetorno(cliente.from('midias').delete().eq('id', id).select('id'))
    },

    async contarAvisosComImagem(id) {
      const { count } = await executar(cliente.from('avisos').select('id', { count: 'exact', head: true }).eq('imagem_midia_id', id))
      // Sem contagem, a tela diria "nenhum aviso perde a imagem" sem saber: melhor falhar.
      if (typeof count !== 'number') throw new ErroDePreparacao('outro')
      return count
    },
  }
}

function repositorioDeSons(cliente: SupabaseClient): RepositorioDeSons {
  return {
    async listar() {
      const { data } = await executar(cliente.from('sons').select('id, midia_id, rotulo, emoji, volume, ordem').order('ordem'))
      return linhas<LinhaSom>(data).map(
        (l): Som => ({ id: l.id, midiaId: l.midia_id, rotulo: l.rotulo, emoji: l.emoji ?? null, volume: l.volume, ordem: l.ordem }),
      )
    },

    async incluir(midiaId, s) {
      await executar(cliente.from('sons').insert({ midia_id: midiaId, rotulo: s.rotulo, emoji: s.emoji, volume: s.volume, ordem: s.ordem }))
    },

    async alterar(id, s) {
      await escreverComRetorno(
        cliente.from('sons').update({ rotulo: s.rotulo, emoji: s.emoji, volume: s.volume, ordem: s.ordem }).eq('id', id).select('id'),
      )
    },
  }
}

function repositorioDeCenas(cliente: SupabaseClient): RepositorioDeCenas {
  return {
    async listar() {
      const { data } = await executar(cliente.from('cenas').select('id, nome_exibicao, nome_obs, ordem').order('ordem'))
      return linhas<LinhaCena>(data).map((l): Cena => ({ id: l.id, nomeExibicao: l.nome_exibicao, nomeObs: l.nome_obs, ordem: l.ordem }))
    },

    async incluir(c) {
      await executar(cliente.from('cenas').insert({ nome_exibicao: c.nomeExibicao, nome_obs: c.nomeObs, ordem: c.ordem }))
    },

    async alterar(id, c) {
      await escreverComRetorno(
        cliente.from('cenas').update({ nome_exibicao: c.nomeExibicao, nome_obs: c.nomeObs, ordem: c.ordem }).eq('id', id).select('id'),
      )
    },

    async remover(id) {
      await escreverComRetorno(cliente.from('cenas').delete().eq('id', id).select('id'))
    },
  }
}

function repositorioDeEpisodios(cliente: SupabaseClient): RepositorioDeEpisodios {
  return {
    async listar() {
      const { data } = await executar(cliente.from('episodios').select('id, titulo, data, estado').order('data', { ascending: false }))
      const episodios: Episodio[] = []
      for (const l of linhas<LinhaEpisodio>(data)) {
        // Estado desconhecido (enum novo no banco antes do app): descartado, como o tipo de mídia.
        if (!ESTADOS.includes(l.estado as EstadoDoEpisodio)) continue
        episodios.push({ id: l.id, titulo: l.titulo, data: l.data, estado: l.estado as EstadoDoEpisodio })
      }
      return episodios
    },

    async incluir(e) {
      await executar(cliente.from('episodios').insert({ titulo: e.titulo, data: e.data, criado_por: e.criadoPor }))
    },

    async alterar(id, e) {
      // Só titulo e data, montados um a um: nunca estado, gestos_ligados ou criado_por (D2), mesmo
      // que quem chama passe o episódio inteiro.
      await escreverComRetorno(cliente.from('episodios').update({ titulo: e.titulo, data: e.data }).eq('id', id).select('id'))
    },

    async remover(id) {
      await escreverComRetorno(cliente.from('episodios').delete().eq('id', id).select('id'))
    },

    async listarAvisos(episodioId) {
      const { data } = await executar(
        cliente
          .from('avisos')
          .select('id, episodio_id, titulo, texto, link, imagem_midia_id, duracao_s, ordem')
          .eq('episodio_id', episodioId)
          .order('ordem'),
      )
      return linhas<LinhaAviso>(data).map(
        (l): Aviso => ({
          id: l.id,
          episodioId: l.episodio_id,
          titulo: l.titulo,
          texto: l.texto,
          link: l.link ?? null,
          imagemMidiaId: l.imagem_midia_id ?? null,
          duracaoS: l.duracao_s,
          ordem: l.ordem,
        }),
      )
    },

    async incluirAviso(a) {
      await executar(
        cliente.from('avisos').insert({
          episodio_id: a.episodioId,
          titulo: a.titulo,
          texto: a.texto,
          link: a.link,
          imagem_midia_id: a.imagemMidiaId,
          duracao_s: a.duracaoS,
          ordem: a.ordem,
        }),
      )
    },

    async alterarAviso(id, a) {
      await escreverComRetorno(
        cliente
          .from('avisos')
          .update({ titulo: a.titulo, texto: a.texto, link: a.link, imagem_midia_id: a.imagemMidiaId, duracao_s: a.duracaoS, ordem: a.ordem })
          .eq('id', id)
          .select('id'),
      )
    },

    async alterarOrdemDoAviso(id, ordem) {
      await escreverComRetorno(cliente.from('avisos').update({ ordem }).eq('id', id).select('id'))
    },

    async removerAviso(id) {
      await escreverComRetorno(cliente.from('avisos').delete().eq('id', id).select('id'))
    },
  }
}

function repositorioDeGestos(cliente: SupabaseClient): RepositorioDeGestos {
  return {
    async listar() {
      const { data } = await executar(cliente.from('mapa_gestos').select('gesto, acao, cena_id, som_id').order('gesto'))
      const mapa: LinhaDoMapa[] = []
      for (const l of linhas<LinhaGesto>(data)) {
        // Gesto ou ação desconhecidos (enum novo no banco antes do app): descartados.
        if (!NOMES_DE_GESTO.includes(l.gesto) || !NOMES_DE_ACAO.includes(l.acao)) continue
        mapa.push({ gesto: l.gesto as Gesto, acao: l.acao as AcaoDoGesto, cenaId: l.cena_id ?? null, somId: l.som_id ?? null })
      }
      return mapa
    },

    async alterar(l) {
      // O alvo que não corresponde à ação vai nulo (o CHECK mapa_gestos_equivalencia recusaria).
      const n = normalizarGesto(l)
      await escreverComRetorno(
        cliente.from('mapa_gestos').update({ acao: n.acao, cena_id: n.cenaId, som_id: n.somId }).eq('gesto', n.gesto).select('gesto'),
      )
    },
  }
}

/**
 * Adaptadores das portas de repositório da Preparação sobre o PostgREST (D10 do PLA-003: um por
 * agregado, sem classe genérica; erros traduzidos num lugar só). Não decide acesso: quem nega é a
 * RLS, e uma escrita filtrada por ela volta com 0 linhas → `nada_alterado`. O armazenamento de
 * arquivos fica em `armazenamentoSupabase.ts`.
 */
export function criarRepositoriosDePreparacao(cliente: SupabaseClient): Omit<ServicosDePreparacao, 'armazenamento'> {
  return {
    midias: repositorioDeMidias(cliente),
    sons: repositorioDeSons(cliente),
    cenas: repositorioDeCenas(cliente),
    episodios: repositorioDeEpisodios(cliente),
    gestos: repositorioDeGestos(cliente),
  }
}
