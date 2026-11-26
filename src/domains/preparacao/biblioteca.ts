import { caminhoDaMidia, conferirArquivo, nomeDeExibicao, type Midia, type RecusaDoArquivo } from './midia'
import { ErroDePreparacao, type MotivoDaPreparacao, type NovaMidia, type OpcoesDoEnvio, type ServicosDePreparacao } from './portas'

/**
 * O arquivo escolhido na tela: nome (só para exibição), os primeiros bytes e o corpo. O tamanho
 * vem sempre de `corpo.size` (o mesmo `Blob` que é enviado), nunca de um número informado à
 * parte: assim o limite de 50 MB, o uso da D7 e `midias.tamanho_bytes` contam os bytes reais.
 */
export interface ArquivoEscolhido {
  nome: string
  /** Os primeiros `BYTES_PARA_DETECTAR` bytes (`Blob.slice(0, 16).arrayBuffer()`). */
  inicio: Uint8Array
  corpo: Blob
}

export type ResultadoDoEnvio = { ok: true; midia: NovaMidia } | { ok: false; motivo: RecusaDoArquivo }

/** Fins de envio em que o objeto pode ter sido gravado antes do corte (D6): remoção de boa-fé. */
const ENVIO_INTERROMPIDO: ReadonlySet<MotivoDaPreparacao> = new Set(['cancelado', 'sem_resposta', 'rede'])

/**
 * Falhas do registro em que a linha pode ter sido gravada (resposta perdida): `rede`,
 * `sem_resposta`, `outro` ou um erro que não é `ErroDePreparacao`. Nelas, a compensação tenta
 * tirar a linha antes de apagar o objeto (D6: nunca linha apontando para arquivo apagado).
 */
const REGISTRO_AMBIGUO: ReadonlySet<MotivoDaPreparacao> = new Set(['rede', 'sem_resposta', 'outro'])

function registroAmbiguo(erro: unknown): boolean {
  return !(erro instanceof ErroDePreparacao) || REGISTRO_AMBIGUO.has(erro.motivo)
}

/** Rótulo inicial do som: o nome de exibição sem a última extensão (`aplauso.mp3` → `aplauso`). */
function rotuloInicial(nome: string): string {
  const semExtensao = nome.replace(/\.[^.]*$/, '').trim()
  return semExtensao === '' ? nome : semExtensao
}

/** Tenta remover o objeto; nunca lança (o erro original é o que importa). */
async function removerObjetoSemFalhar(s: ServicosDePreparacao, caminho: string): Promise<void> {
  try {
    await s.armazenamento.remover(caminho)
  } catch {
    /* o erro original é o que importa; o objeto que ficar é órfão (Riscos do VER-024) */
  }
}

/**
 * Compensação quando a linha de `midias` pode existir: tenta removê-la e só apaga o objeto se ela
 * saiu ou se nunca existiu (`nada_alterado`); senão linha e objeto ficam juntos. Nunca lança.
 */
async function removerLinhaEObjetoSemFalhar(s: ServicosDePreparacao, id: string, caminho: string): Promise<void> {
  let linhaSaiu = false
  try {
    await s.midias.remover(id)
    linhaSaiu = true
  } catch (erro) {
    linhaSaiu = erro instanceof ErroDePreparacao && erro.motivo === 'nada_alterado'
  }
  if (linhaSaiu) await removerObjetoSemFalhar(s, caminho)
}

/**
 * Envio de uma mídia (D6): conferir no domínio → enviar o objeto → registrar a linha em
 * `midias` (e, para som, em `sons`). Sem transação entre Storage e banco, então:
 *
 * - recusa do domínio → `{ ok: false, motivo }`, sem nenhuma chamada;
 * - envio que termina em `cancelado`, `sem_resposta` ou `rede` → remoção de boa-fé do objeto
 *   (pode ter sido gravado antes do corte) e o mesmo erro relançado; outro erro do envio
 *   (por exemplo `negado`) → nada foi gravado, só relança;
 * - registro que falha com recusa clara (`negado`, `duplicado`, `invalido`, …) → a linha não
 *   existe: remove o objeto; falha ambígua (`rede`, `sem_resposta`, `outro` ou erro fora de
 *   `ErroDePreparacao`), em que a linha pode ter sido gravada, ou som que não entra → tenta tirar
 *   a linha de `midias` e só remove o objeto se ela sair (ou vier `nada_alterado`);
 * - em todos os casos, o erro original é relançado, mesmo que a compensação falhe.
 */
export async function enviarMidia(
  s: ServicosDePreparacao,
  a: ArquivoEscolhido,
  ctx: { usoAtualBytes: number; membroId: string; gerarId: () => string; ordemDoSom: number },
  opcoes: OpcoesDoEnvio,
): Promise<ResultadoDoEnvio> {
  const tamanho = a.corpo.size
  const conferencia = conferirArquivo({ tamanho, inicio: a.inicio }, ctx.usoAtualBytes)
  if (!conferencia.ok) return { ok: false, motivo: conferencia.motivo }
  const { tipo } = conferencia
  const id = ctx.gerarId()
  const caminho = caminhoDaMidia(tipo, id)

  try {
    await s.armazenamento.enviar(caminho, a.corpo, tipo.mime, opcoes)
  } catch (erro) {
    if (erro instanceof ErroDePreparacao && ENVIO_INTERROMPIDO.has(erro.motivo)) await removerObjetoSemFalhar(s, caminho)
    throw erro
  }

  const midia: NovaMidia = {
    id,
    tipo: tipo.tipo,
    nome: nomeDeExibicao(a.nome),
    caminho,
    mime: tipo.mime,
    tamanhoBytes: tamanho,
    enviadoPor: ctx.membroId,
  }

  try {
    await s.midias.registrar(midia)
  } catch (erro) {
    if (registroAmbiguo(erro)) await removerLinhaEObjetoSemFalhar(s, id, caminho)
    else await removerObjetoSemFalhar(s, caminho)
    throw erro
  }

  if (tipo.tipo === 'som') {
    try {
      await s.sons.incluir(id, { rotulo: rotuloInicial(midia.nome), emoji: null, volume: 1, ordem: ctx.ordemDoSom })
    } catch (erro) {
      await removerLinhaEObjetoSemFalhar(s, id, caminho)
      throw erro
    }
  }

  return { ok: true, midia }
}

/**
 * Exclusão de uma mídia (D6): a linha de `midias` sai **primeiro** (o banco recusa som num
 * gesto: `em_uso`, relançado, e o objeto fica intacto); só depois o objeto. Se a remoção do
 * objeto falhar, a linha já saiu: resolve com `arquivoFicou: true` para a tela avisar.
 */
export async function excluirMidia(s: ServicosDePreparacao, m: Midia): Promise<{ arquivoFicou: boolean }> {
  await s.midias.remover(m.id)
  try {
    await s.armazenamento.remover(m.caminho)
    return { arquivoFicou: false }
  } catch {
    return { arquivoFicou: true }
  }
}
