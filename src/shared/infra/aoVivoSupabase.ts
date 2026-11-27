import type { SupabaseClient } from '@supabase/supabase-js'
import { conferirRotulo } from '../../domains/acesso/dispositivos'
import type { Dispositivo, TipoDeDispositivo } from '../../domains/acesso/dispositivos'
import { UUID } from '../../domains/aovivo/mensagens'
import { ErroDoAoVivo } from '../../domains/aovivo/portas'
import type { MotivoDoAoVivo, RepositorioDoAoVivo, RepositorioDoPalco } from '../../domains/aovivo/portas'
import type { Cena } from '../../domains/preparacao/cenas'
import type { Aviso, EstadoDoEpisodio, Episodio } from '../../domains/preparacao/episodios'
import type { Som } from '../../domains/preparacao/midia'
import { BUCKET_DE_MIDIAS } from './armazenamentoSupabase'
import { classificarErro } from './errosSupabase'

/** Validade das URLs assinadas do palco (sons e imagens dos avisos): 1 h, renovadas a cada 45 min pela tela (D16). */
export const VALIDADE_NO_PALCO_S = 3600

/**
 * Erro das funções e tabelas do ao vivo → motivo (D7). A ordem vale: (1) sessão expirada (401 ou JWT
 * recusado) antes de tudo, como na classificação comum; (2) `55000` (o estado não permite) →
 * `estado_invalido`; (3) `22023` (parâmetro inválido) → `invalido`; (4) o resto pela classificação comum
 * (`classificarErro`, sem mudar `errosSupabase.ts`), com `em_uso` (que o ao vivo não tem) → `outro`.
 * A mensagem do servidor nunca decide nem sai daqui.
 */
export function traduzirErroDoAoVivo(erro: { code?: string; message?: string; name?: string } | null, status?: number): MotivoDoAoVivo {
  const comum = classificarErro(erro, status)
  if (comum === 'sessao_expirada') return comum
  const codigo = erro?.code ?? ''
  if (codigo === '55000') return 'estado_invalido'
  if (codigo === '22023') return 'invalido'
  return comum === 'em_uso' ? 'outro' : comum
}

interface Resposta {
  data: unknown
  error: { code?: string; message?: string } | null
  status: number
}

/** Aguarda a consulta e traduz todo erro (devolvido, por `traduzirErroDoAoVivo`; lançado, como `outro`). */
async function executar(consulta: () => PromiseLike<Resposta>): Promise<unknown> {
  let resposta: Resposta
  try {
    resposta = await consulta()
  } catch {
    throw new ErroDoAoVivo('outro')
  }
  if (resposta.error) throw new ErroDoAoVivo(traduzirErroDoAoVivo(resposta.error, resposta.status))
  return resposta.data
}

type Linha = Record<string, unknown>

function linhas(data: unknown): Linha[] {
  return Array.isArray(data) ? data.filter((l): l is Linha => typeof l === 'object' && l !== null && !Array.isArray(l)) : []
}

const TIPOS: readonly TipoDeDispositivo[] = ['camera', 'obs_palco', 'obs_camera']
const ESTADOS: readonly EstadoDoEpisodio[] = ['rascunho', 'ao_vivo', 'encerrado']

/** `episodio_ativo()`: no máximo uma linha; id fora da forma ou modo fora da lista → `null`. */
async function episodioAtivo(cliente: SupabaseClient): Promise<{ id: string; modo: 'ao_vivo' | 'teste' } | null> {
  const [l] = linhas(await executar(() => cliente.rpc('episodio_ativo')))
  if (l === undefined) return null
  const { id, modo } = l
  if (typeof id !== 'string' || !UUID.test(id) || (modo !== 'ao_vivo' && modo !== 'teste')) return null
  return { id, modo }
}

/** `caminho` da mídia embutida (`midias(caminho)`): o PostgREST devolve objeto (muitos-para-um) ou nulo. */
function caminhoEmbutido(valor: unknown): string | null {
  const m: unknown = Array.isArray(valor) ? valor[0] : valor
  if (typeof m !== 'object' || m === null) return null
  const caminho = (m as Linha).caminho
  return typeof caminho === 'string' && caminho !== '' ? caminho : null
}

/**
 * Adaptador da porta `RepositorioDoAoVivo` (painel e `/controle`, cliente de membro) sobre o PostgREST:
 * as funções do banco (D2, D5, D7) e a lista de dispositivos. Não decide acesso (quem nega é o banco:
 * `42501`); o código de pareamento volta só para quem chamou e nunca vai para `console` nem para erro.
 */
export function criarRepositorioDoAoVivo(cliente: SupabaseClient): RepositorioDoAoVivo {
  return {
    episodioAtivo: () => episodioAtivo(cliente),

    async iniciar(id) {
      await executar(() => cliente.rpc('iniciar_ao_vivo', { p_episodio: id }))
    },

    async encerrar(id) {
      await executar(() => cliente.rpc('encerrar_ao_vivo', { p_episodio: id }))
    },

    async definirModoTeste(id) {
      await executar(() => cliente.rpc('definir_modo_teste', { p_episodio: id }))
    },

    async listarDispositivos() {
      const data = await executar(() =>
        cliente.from('dispositivos').select('id, tipo, rotulo, camera_id, usuario_anonimo_id, pareado_em, revogado_em').order('tipo'),
      )
      const dispositivos: Dispositivo[] = []
      for (const l of linhas(data)) {
        // Tipo desconhecido (enum novo no banco antes do app): a linha é descartada.
        if (!TIPOS.includes(l.tipo as TipoDeDispositivo)) continue
        dispositivos.push({
          id: l.id as string,
          tipo: l.tipo as TipoDeDispositivo,
          rotulo: l.rotulo as string,
          cameraId: (l.camera_id as string | null) ?? null,
          usuarioAnonimoId: (l.usuario_anonimo_id as string | null) ?? null,
          pareadoEm: (l.pareado_em as string | null) ?? null,
          revogadoEm: (l.revogado_em as string | null) ?? null,
        })
      }
      return dispositivos
    },

    async criarCodigo(p) {
      // Rótulo conferido pelo domínio antes da rede (o mesmo limite da função: 1 a 60 caracteres aparados); fora
      // dele → invalido, sem chamar o banco (VER-046, I5).
      if (conferirRotulo(p.rotulo) !== null) throw new ErroDoAoVivo('invalido')
      const data = await executar(() =>
        cliente.rpc('criar_codigo_pareamento', { p_tipo: p.tipo, p_rotulo: p.rotulo, p_dispositivo: p.dispositivoId, p_camera: p.cameraId }),
      )
      // A função devolve (dispositivo, codigo, expira); sem linha completa, nunca um código vazio.
      const [l] = linhas(data)
      if (l === undefined || typeof l.dispositivo !== 'string' || typeof l.codigo !== 'string' || typeof l.expira !== 'string') {
        throw new ErroDoAoVivo('outro')
      }
      return { dispositivoId: l.dispositivo, codigo: l.codigo, expiraEm: l.expira }
    },

    async revogar(id) {
      // returns uuid: a sessão anônima revogada, ou nulo se nunca foi pareado; outra forma → invalido.
      const data = await executar(() => cliente.rpc('revogar_dispositivo', { p_dispositivo: id }))
      if (data === null) return { usuario: null }
      if (typeof data !== 'string' || !UUID.test(data)) throw new ErroDoAoVivo('invalido')
      return { usuario: data }
    },
  }
}

/**
 * Adaptador da porta `RepositorioDoPalco` (cliente `obs_palco`): episódio ativo, as listas do episódio
 * (D9), URLs assinadas do bucket `midias` (D16) e o insert em `registro_acoes`, só com as colunas da D9
 * e **sem** `select` depois (o `obs_palco` só insere; a leitura é dos membros).
 */
export function criarRepositorioDoPalco(cliente: SupabaseClient): RepositorioDoPalco {
  return {
    episodioAtivo: () => episodioAtivo(cliente),

    async carregar(episodioId) {
      const [dadosDoEpisodio, dadosDasCenas, dadosDosSons, dadosDosAvisos] = await Promise.all([
        executar(() => cliente.from('episodios').select('id, titulo, data, estado').eq('id', episodioId)),
        executar(() => cliente.from('cenas').select('id, nome_exibicao, nome_obs, ordem').order('ordem')),
        executar(() => cliente.from('sons').select('id, midia_id, rotulo, emoji, volume, ordem, midias(caminho)').order('ordem')),
        executar(() =>
          cliente
            .from('avisos')
            .select('id, episodio_id, titulo, texto, link, imagem_midia_id, duracao_s, ordem, midias(caminho)')
            .eq('episodio_id', episodioId)
            .order('ordem'),
        ),
      ])
      // Episódio que não aparece (apagado, ou a RLS não deixa) ou com estado desconhecido → invalido.
      const [e] = linhas(dadosDoEpisodio)
      if (e === undefined || !ESTADOS.includes(e.estado as EstadoDoEpisodio)) throw new ErroDoAoVivo('invalido')
      const episodio: Episodio = { id: e.id as string, titulo: e.titulo as string, data: e.data as string, estado: e.estado as EstadoDoEpisodio }

      const cenas = linhas(dadosDasCenas).map(
        (l): Cena => ({ id: l.id as string, nomeExibicao: l.nome_exibicao as string, nomeObs: l.nome_obs as string, ordem: l.ordem as number }),
      )

      const sons: (Som & { caminho: string })[] = []
      for (const l of linhas(dadosDosSons)) {
        // Som sem caminho legível não toca: fica de fora (o comando vira "som inexistente").
        const caminho = caminhoEmbutido(l.midias)
        if (caminho === null) continue
        sons.push({
          id: l.id as string,
          midiaId: l.midia_id as string,
          rotulo: l.rotulo as string,
          emoji: (l.emoji as string | null) ?? null,
          volume: l.volume as number,
          ordem: l.ordem as number,
          caminho,
        })
      }

      const avisos = linhas(dadosDosAvisos).map((l): Aviso & { caminhoDaImagem: string | null } => {
        const imagemMidiaId = (l.imagem_midia_id as string | null) ?? null
        return {
          id: l.id as string,
          episodioId: l.episodio_id as string,
          titulo: l.titulo as string,
          texto: l.texto as string,
          link: (l.link as string | null) ?? null,
          imagemMidiaId,
          duracaoS: l.duracao_s as number,
          ordem: l.ordem as number,
          caminhoDaImagem: imagemMidiaId === null ? null : caminhoEmbutido(l.midias),
        }
      })

      return { episodio, cenas, sons, avisos }
    },

    async urlDoArquivo(caminho) {
      let resposta: { data: { signedUrl: string } | null; error: unknown }
      try {
        resposta = await cliente.storage.from(BUCKET_DE_MIDIAS).createSignedUrl(caminho, VALIDADE_NO_PALCO_S)
      } catch {
        throw new ErroDoAoVivo('outro')
      }
      if (resposta.error) {
        // StorageUnknownError = falha do fetch; o resto não tem tela própria no palco. A URL nunca vai para console.
        const nome = (resposta.error as { name?: unknown }).name
        throw new ErroDoAoVivo(nome === 'StorageUnknownError' ? 'rede' : 'outro')
      }
      const url = resposta.data?.signedUrl
      if (typeof url !== 'string' || url === '') throw new ErroDoAoVivo('outro')
      return url
    },

    async registrar(l) {
      await executar(() =>
        cliente.from('registro_acoes').insert({
          episodio_id: l.episodioId,
          origem: l.origem,
          acao: l.acao,
          cena_id: l.cenaId,
          som_id: l.somId,
          aviso_id: l.avisoId,
          membro_id: l.membroId,
          teste: l.teste,
        }),
      )
    },
  }
}
