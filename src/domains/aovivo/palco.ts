import { linhaDoRegistro, resolverComando, type AcaoNoObs } from './comandos'
import { UUID, lerComando, lerEstadoNoAr, type Comando, type EstadoNoAr, type MotivoDoResultado, type ResultadoDoComando, type Revogados } from './mensagens'
import type { CanalDoControle, ExecutorDeAcoes, RepositorioDoPalco } from './portas'

/** O palco republica o estado no ar a cada 30 s, além de depois de cada mudança e quando alguém entra (DES-001 §8, D9). */
export const ESTADO_A_CADA_MS = 30_000

/** Quantos `id` de comando o palco lembra para descartar repetidos (D9). */
export const COMANDOS_LEMBRADOS = 200

export interface DependenciasDoPalco {
  canal: CanalDoControle
  repo: RepositorioDoPalco
  executor: ExecutorDeAcoes
  /** Remetentes revogados avisados em `estudio` (quem os alimenta é a rota do palco, Tarefa 6). */
  revogados: Revogados
  /** O episódio que o próprio palco consultou (`episodio_ativo()`); só os comandos deste tópico chegam aqui. */
  episodio: { id: string; modo: 'ao_vivo' | 'teste' }
  dados: Awaited<ReturnType<RepositorioDoPalco['carregar']>>
  /** `auth.uid()` da sessão do palco: o eco do próprio envio é ignorado. */
  meuUsuario: string
  /** Repete `f` a cada `ms` até a função devolvida ser chamada (estado periódico e, uma vez só, o prazo do aviso). */
  agendarRepeticao(f: () => void, ms: number): () => void
  /** Relógio de `avisoAte` (ms desde 1970); padrão `Date.now`. */
  agora?: () => number
}

/** Ações que demoram de propósito (o clipe espera 5 s): o estado mostra `pendente` antes de esperar. */
const ACOES_DEMORADAS: readonly AcaoNoObs['tipo'][] = Object.freeze(['salvar_clipe'] as const)

function copiar(e: EstadoNoAr): EstadoNoAr {
  return { ...e, ultimo: e.ultimo === null ? null : { ...e.ultimo }, obs: { ...e.obs } }
}

/**
 * Serviço do palco (D9; DES-001 §10.1: o palco é o único executor). Para cada comando recebido:
 * 1. confere de novo a forma (`lerComando`) e o remetente (uuid); inválido → descartado sem efeito;
 * 2. ignora o próprio eco, o remetente revogado (`Revogados`, 15 min) e o `id` repetido (últimos 200);
 * 3. resolve contra as listas carregadas (`resolverComando`); recusa → estado publicado, nada executado
 *    e nada registrado;
 * 4. executa (`ExecutorDeAcoes`); o clipe publica `pendente` antes de esperar;
 * 5. atualiza o estado (cena do OBS, aviso no ar e o prazo dele, último resultado) e o publica;
 * 6. com `ok`, grava `registro_acoes` (`linhaDoRegistro`); a falha ao gravar não desfaz nem bloqueia nada.
 * Comandos diferentes não esperam um pelo outro (um clipe pendente não segura uma troca de cena).
 * O estado também é publicado ao começar, a cada 30 s e quando alguém entra no `:controle`.
 */
export function criarPalco(d: DependenciasDoPalco): { estado(): EstadoNoAr; aoMudar(f: (e: EstadoNoAr) => void): () => void; parar(): void } {
  const agora = d.agora ?? (() => Date.now())
  const ouvintes = new Set<(e: EstadoNoAr) => void>()
  const vistos = new Set<string>()
  const ordemDosVistos: string[] = []
  let parado = false
  let cancelarPrazoDoAviso: (() => void) | null = null
  const estado: EstadoNoAr = {
    episodioId: d.episodio.id,
    modo: d.episodio.modo,
    cenaObs: null,
    avisoId: null,
    avisoAte: null,
    ultimo: null,
    obs: d.executor.situacao(),
  }

  /**
   * O estado que vai ao canal passa pelo mesmo leitor do `/controle` (`lerEstadoNoAr`): o palco nunca
   * publica o que os outros descartariam. Uma cena do OBS com nome além do limite do leitor (o banco
   * não limita `nome_obs`) vai como `null`, sem perder o resto do estado; se ainda assim o leitor
   * recusar (situação do OBS fora da forma), nada é publicado.
   */
  function paraOCanal(e: EstadoNoAr): EstadoNoAr | null {
    const lido = lerEstadoNoAr(e)
    if (lido !== null || e.cenaObs === null) return lido
    return lerEstadoNoAr({ ...e, cenaObs: null })
  }

  function publicar(avisar = true): void {
    if (parado) return
    estado.obs = d.executor.situacao()
    const saida = paraOCanal(copiar(estado))
    if (saida !== null) d.canal.publicarEstado(saida).catch(() => {})
    if (avisar) for (const f of ouvintes) f(copiar(estado))
  }

  function lembrar(id: string): boolean {
    if (vistos.has(id)) return false
    vistos.add(id)
    ordemDosVistos.push(id)
    if (ordemDosVistos.length > COMANDOS_LEMBRADOS) vistos.delete(ordemDosVistos.shift() as string)
    return true
  }

  function soltarPrazoDoAviso(): void {
    cancelarPrazoDoAviso?.()
    cancelarPrazoDoAviso = null
  }

  function marcarAvisoNoAr(avisoId: string, duracaoS: number): void {
    soltarPrazoDoAviso()
    estado.avisoId = avisoId
    estado.avisoAte = agora() + duracaoS * 1000
    // uma vez só: a repetição é cancelada no primeiro disparo; um aviso novo ou o ocultar cancelam antes
    const cancelar = d.agendarRepeticao(() => {
      cancelar()
      if (parado) return
      cancelarPrazoDoAviso = null
      estado.avisoId = null
      estado.avisoAte = null
      void d.executor.executar({ tipo: 'ocultar_aviso' }).catch(() => {})
      publicar()
    }, duracaoS * 1000)
    cancelarPrazoDoAviso = cancelar
  }

  function aplicar(a: AcaoNoObs): void {
    if (a.tipo === 'trocar_cena') estado.cenaObs = a.nomeObs
    else if (a.tipo === 'mostrar_aviso') marcarAvisoNoAr(a.avisoId, a.duracaoS)
    else if (a.tipo === 'ocultar_aviso') {
      soltarPrazoDoAviso()
      estado.avisoId = null
      estado.avisoAte = null
    }
  }

  function anotar(c: Comando, resultado: ResultadoDoComando, motivo: MotivoDoResultado | null): void {
    estado.ultimo = { comandoId: c.id, acao: c.acao, resultado, motivo }
    publicar()
  }

  async function tratar(recebido: unknown, remetente: string): Promise<void> {
    if (parado) return
    const c = lerComando(recebido)
    if (c === null || typeof remetente !== 'string' || !UUID.test(remetente)) return
    if (remetente === d.meuUsuario || d.revogados.contem(remetente)) return
    if (!lembrar(c.id)) return

    const resolvido = resolverComando(c, {
      cenas: d.dados.cenas,
      sons: d.dados.sons,
      avisos: d.dados.avisos,
      estado: { cenaObs: estado.cenaObs, avisoId: estado.avisoId },
      episodioTitulo: d.dados.episodio.titulo,
    })
    if (!resolvido.ok) {
      anotar(c, 'recusado', resolvido.motivo)
      return
    }
    const acao = resolvido.acao
    if (ACOES_DEMORADAS.includes(acao.tipo)) anotar(c, 'pendente', null)

    let r: { resultado: ResultadoDoComando; motivo: MotivoDoResultado | null }
    try {
      r = await d.executor.executar(acao)
    } catch {
      r = { resultado: 'falhou', motivo: null }
    }
    if (parado) return
    if (r.resultado === 'ok') aplicar(acao)
    anotar(c, r.resultado, r.motivo)
    if (r.resultado === 'ok') {
      const linha = linhaDoRegistro(c, acao, { episodioId: d.episodio.id, modo: d.episodio.modo, remetente })
      d.repo.registrar(linha).catch(() => {})
    }
  }

  const soltar = [
    d.canal.aoComando((c, remetente) => {
      void tratar(c, remetente)
    }),
    d.canal.aoEntrarAlguem(() => publicar(false)),
    d.agendarRepeticao(() => publicar(false), ESTADO_A_CADA_MS),
  ]
  publicar(false)

  return {
    estado: () => copiar(estado),
    aoMudar(f) {
      ouvintes.add(f)
      return () => {
        ouvintes.delete(f)
      }
    },
    parar() {
      if (parado) return
      parado = true
      soltarPrazoDoAviso()
      for (const s of soltar) s()
      ouvintes.clear()
    },
  }
}
