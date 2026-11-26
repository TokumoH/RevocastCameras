import { describe, test, expect } from 'vitest'
import { enviarMidia, excluirMidia, type ArquivoEscolhido } from './biblioteca'
import type { Midia } from './midia'
import {
  ErroDePreparacao,
  type MotivoDaPreparacao,
  type NovaMidia,
  type OpcoesDoEnvio,
  type ServicosDePreparacao,
} from './portas'

const ID = '0b6e2b8a-3c1d-4f2a-9e5b-1a2b3c4d5e6f'
const MEMBRO = '11111111-2222-4333-8444-555555555555'
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const ascii = (texto: string) => Array.from(texto, (c) => c.charCodeAt(0))

/** `corpo` é um `Blob` real cujo `size` é ajustado (o domínio só lê `size` e repassa o corpo), sem alocar 50 MB. */
function corpoDe(inicio: Uint8Array<ArrayBuffer>, tamanho: number): Blob {
  const corpo = new Blob([inicio])
  Object.defineProperty(corpo, 'size', { value: tamanho })
  return corpo
}

function arquivo(nome: string, assinatura: number[], tamanho: number): ArquivoEscolhido {
  const inicio = Uint8Array.from([...assinatura, ...new Array(Math.max(0, 16 - assinatura.length)).fill(0)].slice(0, 16))
  return { nome, inicio, corpo: corpoDe(inicio, tamanho) }
}

/** Etiqueta ID3 v2.4 (byte 3 = 04): início de um MP3. */
const ID3 = [...ascii('ID3'), 0x04]

/** Falhas programadas por operação; sem valor = resolve. */
interface Falhas {
  enviar?: unknown
  registrar?: unknown
  incluirSom?: unknown
  removerMidia?: unknown
  removerArquivo?: unknown
}

/** Portas falsas: registram cada chamada, na ordem, e falham quando pedido. */
function falsos(falhas: Falhas = {}) {
  const chamadas: string[] = []
  const args: Record<string, unknown[][]> = {}
  function anotar(nome: string, ...a: unknown[]) {
    chamadas.push(nome)
    ;(args[nome] ??= []).push(a)
  }
  async function talvezFalhe(falha: unknown) {
    if (falha !== undefined) throw falha
  }
  const naoUsado = () => Promise.reject(new Error('não usado neste teste'))
  const s: ServicosDePreparacao = {
    midias: {
      listar: naoUsado,
      registrar: async (m: NovaMidia) => {
        anotar('midias.registrar', m)
        await talvezFalhe(falhas.registrar)
      },
      remover: async (id: string) => {
        anotar('midias.remover', id)
        await talvezFalhe(falhas.removerMidia)
      },
      contarAvisosComImagem: naoUsado,
    },
    sons: {
      listar: naoUsado,
      incluir: async (midiaId, som) => {
        anotar('sons.incluir', midiaId, som)
        await talvezFalhe(falhas.incluirSom)
      },
      alterar: naoUsado,
    },
    cenas: { listar: naoUsado, incluir: naoUsado, alterar: naoUsado, remover: naoUsado },
    episodios: {
      listar: naoUsado,
      incluir: naoUsado,
      alterar: naoUsado,
      remover: naoUsado,
      listarAvisos: naoUsado,
      incluirAviso: naoUsado,
      alterarAviso: naoUsado,
      alterarOrdemDoAviso: naoUsado,
      removerAviso: naoUsado,
    },
    gestos: { listar: naoUsado, alterar: naoUsado },
    armazenamento: {
      enviar: async (caminho, corpo, mime, opcoes) => {
        anotar('armazenamento.enviar', caminho, corpo, mime, opcoes)
        await talvezFalhe(falhas.enviar)
      },
      remover: async (caminho) => {
        anotar('armazenamento.remover', caminho)
        await talvezFalhe(falhas.removerArquivo)
      },
      urlDePrevia: naoUsado,
    },
  }
  return { s, chamadas, args }
}

const opcoes: OpcoesDoEnvio = { aoProgredir: () => {}, sinal: new AbortController().signal }
const ctx = { usoAtualBytes: 0, membroId: MEMBRO, gerarId: () => ID, ordemDoSom: 4 }

async function motivoDe(promessa: Promise<unknown>): Promise<MotivoDaPreparacao> {
  try {
    await promessa
  } catch (erro) {
    if (erro instanceof ErroDePreparacao) return erro.motivo
    throw erro
  }
  throw new Error('a promessa não falhou')
}

const MIDIA: Midia = {
  id: ID,
  tipo: 'som',
  nome: 'aplauso.mp3',
  caminho: `som/${ID}.mp3`,
  mime: 'audio/mpeg',
  tamanhoBytes: 10,
  enviadoPor: MEMBRO,
}

describe('biblioteca: enviarMidia', () => {
  test('envio-ok-imagem', async () => {
    const { s, chamadas, args } = falsos()
    const a = arquivo('C:\\fotos\\Capa.png', PNG, 10)
    const resultado = await enviarMidia(s, a, ctx, opcoes)
    const esperada: NovaMidia = {
      id: ID,
      tipo: 'imagem',
      nome: 'Capa.png',
      caminho: `imagem/${ID}.png`,
      mime: 'image/png',
      tamanhoBytes: 10,
      enviadoPor: MEMBRO,
    }
    expect(resultado).toEqual({ ok: true, midia: esperada })
    expect(chamadas).toEqual(['armazenamento.enviar', 'midias.registrar'])
    expect(args['armazenamento.enviar'][0]).toEqual([`imagem/${ID}.png`, a.corpo, 'image/png', opcoes])
    expect(args['armazenamento.enviar'][0][1]).toBe(a.corpo)
    expect(args['armazenamento.enviar'][0][3]).toBe(opcoes)
    expect(args['midias.registrar'][0]).toEqual([esperada])
  })

  test('envio-ok-som', async () => {
    const { s, chamadas, args } = falsos()
    const resultado = await enviarMidia(s, arquivo('aplauso.mp3', ID3, 2_000), ctx, opcoes)
    expect(resultado.ok).toBe(true)
    expect(chamadas).toEqual(['armazenamento.enviar', 'midias.registrar', 'sons.incluir'])
    expect(args['armazenamento.enviar'][0][0]).toBe(`som/${ID}.mp3`)
    expect(args['armazenamento.enviar'][0][2]).toBe('audio/mpeg')
    expect(args['midias.registrar'][0][0]).toMatchObject({ tipo: 'som', mime: 'audio/mpeg', nome: 'aplauso.mp3', tamanhoBytes: 2_000 })
    expect(args['sons.incluir'][0]).toEqual([ID, { rotulo: 'aplauso', emoji: null, volume: 1, ordem: 4 }])
  })

  test('envio-ok-som: rótulo de um nome sem extensão ou só com extensão', async () => {
    for (const [nome, rotulo] of [
      ['sino', 'sino'],
      ['.mp3', '.mp3'],
      ['buuu.final.ogg', 'buuu.final'],
    ]) {
      const { s, args } = falsos()
      await enviarMidia(s, arquivo(nome, ID3, 10), ctx, opcoes)
      expect((args['sons.incluir'][0][1] as { rotulo: string }).rotulo, nome).toBe(rotulo)
    }
  })

  test('mp3-que-e-png', async () => {
    const { s, chamadas, args } = falsos()
    const a = arquivo('foto.mp3', PNG, 10)
    await enviarMidia(s, a, ctx, opcoes)
    expect(args['armazenamento.enviar'][0]).toEqual([`imagem/${ID}.png`, a.corpo, 'image/png', opcoes])
    expect(args['midias.registrar'][0][0]).toMatchObject({ tipo: 'imagem', mime: 'image/png', nome: 'foto.mp3' })
    expect(chamadas).not.toContain('sons.incluir')
  })

  test('envio-recusado', async () => {
    const casos: [ArquivoEscolhido, string][] = [
      [arquivo('pagina.png', ascii('<!DOCTYPE html>'), 100), 'tipo_recusado'],
      [arquivo('grande.png', PNG, 52_428_801), 'grande_demais'],
      [arquivo('vazio.png', PNG, 0), 'vazio'],
    ]
    for (const [a, motivo] of casos) {
      const { s, chamadas } = falsos()
      expect(await enviarMidia(s, a, ctx, opcoes), a.nome).toEqual({ ok: false, motivo })
      expect(chamadas, a.nome).toEqual([])
    }
    const { s, chamadas } = falsos()
    expect(await enviarMidia(s, arquivo('x.png', PNG, 1_001), { ...ctx, usoAtualBytes: 999_999_000 }, opcoes)).toEqual({ ok: false, motivo: 'sem_espaco' })
    expect(chamadas).toEqual([])
  })

  test('envio-compensa: registro negado remove o objeto e relança o erro original', async () => {
    const { s, chamadas, args } = falsos({ registrar: new ErroDePreparacao('negado') })
    expect(await motivoDe(enviarMidia(s, arquivo('capa.png', PNG, 10), ctx, opcoes))).toBe('negado')
    expect(chamadas).toEqual(['armazenamento.enviar', 'midias.registrar', 'armazenamento.remover'])
    expect(args['armazenamento.remover'][0]).toEqual([`imagem/${ID}.png`])
  })

  test('envio-compensa: som que não entra remove a linha da mídia e depois o objeto', async () => {
    const { s, chamadas, args } = falsos({ incluirSom: new ErroDePreparacao('negado') })
    expect(await motivoDe(enviarMidia(s, arquivo('aplauso.mp3', ID3, 10), ctx, opcoes))).toBe('negado')
    expect(chamadas).toEqual(['armazenamento.enviar', 'midias.registrar', 'sons.incluir', 'midias.remover', 'armazenamento.remover'])
    expect(args['midias.remover'][0]).toEqual([ID])
    expect(args['armazenamento.remover'][0]).toEqual([`som/${ID}.mp3`])
  })

  test('envio-compensa: a falha da remoção não esconde o erro original', async () => {
    const f1 = falsos({ registrar: new ErroDePreparacao('negado'), removerArquivo: new ErroDePreparacao('rede') })
    expect(await motivoDe(enviarMidia(f1.s, arquivo('capa.png', PNG, 10), ctx, opcoes))).toBe('negado')
    expect(f1.chamadas).toContain('armazenamento.remover')

    const f2 = falsos({ incluirSom: new ErroDePreparacao('negado'), removerArquivo: new Error('qualquer') })
    expect(await motivoDe(enviarMidia(f2.s, arquivo('aplauso.mp3', ID3, 10), ctx, opcoes))).toBe('negado')
  })

  test('envio-compensa: se a linha da mídia não sai, o objeto fica (nunca linha apontando para arquivo apagado)', async () => {
    const { s, chamadas } = falsos({ incluirSom: new ErroDePreparacao('negado'), removerMidia: new ErroDePreparacao('rede') })
    expect(await motivoDe(enviarMidia(s, arquivo('aplauso.mp3', ID3, 10), ctx, opcoes))).toBe('negado')
    expect(chamadas).toEqual(['armazenamento.enviar', 'midias.registrar', 'sons.incluir', 'midias.remover'])
  })

  test.each([
    ['rede', new ErroDePreparacao('rede')],
    ['sem_resposta', new ErroDePreparacao('sem_resposta')],
    ['outro', new ErroDePreparacao('outro')],
    ['erro fora de ErroDePreparacao', new TypeError('falha inesperada')],
  ])('envio-compensa: registro ambíguo (%s) tira a linha antes do objeto', async (_nome, falha) => {
    // a linha pode ter sido gravada e a resposta perdida: só apaga o objeto se a linha sair
    const saiu = falsos({ registrar: falha })
    await expect(enviarMidia(saiu.s, arquivo('capa.png', PNG, 10), ctx, opcoes)).rejects.toBe(falha)
    expect(saiu.chamadas).toEqual(['armazenamento.enviar', 'midias.registrar', 'midias.remover', 'armazenamento.remover'])
    expect(saiu.args['midias.remover'][0]).toEqual([ID])
    expect(saiu.args['armazenamento.remover'][0]).toEqual([`imagem/${ID}.png`])

    // sequência da sonda da revisão 1: a linha ficou no servidor e não sai → o objeto fica
    const ficou = falsos({ registrar: falha, removerMidia: new ErroDePreparacao('rede') })
    await expect(enviarMidia(ficou.s, arquivo('capa.png', PNG, 10), ctx, opcoes)).rejects.toBe(falha)
    expect(ficou.chamadas).toEqual(['armazenamento.enviar', 'midias.registrar', 'midias.remover'])

    // a linha nunca existiu (0 linhas → nada_alterado) → o objeto sai
    const nunca = falsos({ registrar: falha, removerMidia: new ErroDePreparacao('nada_alterado') })
    await expect(enviarMidia(nunca.s, arquivo('capa.png', PNG, 10), ctx, opcoes)).rejects.toBe(falha)
    expect(nunca.chamadas).toEqual(['armazenamento.enviar', 'midias.registrar', 'midias.remover', 'armazenamento.remover'])
  })

  test('tamanho-do-corpo: o tamanho vem de corpo.size, nunca de um número informado à parte', async () => {
    const inicio = Uint8Array.from([...PNG, ...new Array(8).fill(0)])
    // um campo `tamanho` que divergisse (como o `File.size` lido à parte) é ignorado
    const divergente = { nome: 'capa.png', inicio, corpo: corpoDe(inicio, 20), tamanho: 999 } as ArquivoEscolhido
    const ok = falsos()
    await enviarMidia(ok.s, divergente, ctx, opcoes)
    expect((ok.args['midias.registrar'][0][0] as NovaMidia).tamanhoBytes).toBe(20)

    const grande = { nome: 'capa.png', inicio, corpo: corpoDe(inicio, 52_428_801), tamanho: 10 } as ArquivoEscolhido
    const recusado = falsos()
    expect(await enviarMidia(recusado.s, grande, ctx, opcoes)).toEqual({ ok: false, motivo: 'grande_demais' })
    expect(recusado.chamadas).toEqual([])
  })

  test.each(['cancelado', 'sem_resposta', 'rede'] as const)('envio-interrompido-remove: %s', async (motivo) => {
    const { s, chamadas, args } = falsos({ enviar: new ErroDePreparacao(motivo) })
    expect(await motivoDe(enviarMidia(s, arquivo('capa.png', PNG, 10), ctx, opcoes))).toBe(motivo)
    expect(chamadas).toEqual(['armazenamento.enviar', 'armazenamento.remover'])
    expect(args['armazenamento.remover']).toEqual([[`imagem/${ID}.png`]])

    const comRemocaoFalhando = falsos({ enviar: new ErroDePreparacao(motivo), removerArquivo: new ErroDePreparacao('negado') })
    expect(await motivoDe(enviarMidia(comRemocaoFalhando.s, arquivo('capa.png', PNG, 10), ctx, opcoes))).toBe(motivo)
    expect(comRemocaoFalhando.chamadas).not.toContain('midias.registrar')
  })

  test('envio-negado-nao-remove', async () => {
    const { s, chamadas } = falsos({ enviar: new ErroDePreparacao('negado') })
    expect(await motivoDe(enviarMidia(s, arquivo('capa.png', PNG, 10), ctx, opcoes))).toBe('negado')
    expect(chamadas).toEqual(['armazenamento.enviar'])
  })

  test('gerarId fora do formato uuid: lança antes de qualquer chamada', async () => {
    const { s, chamadas } = falsos()
    await expect(enviarMidia(s, arquivo('capa.png', PNG, 10), { ...ctx, gerarId: () => '../x' }, opcoes)).rejects.toThrow(Error)
    expect(chamadas).toEqual([])
  })
})

describe('biblioteca: excluirMidia', () => {
  test('excluir-ordem', async () => {
    const { s, chamadas, args } = falsos()
    expect(await excluirMidia(s, MIDIA)).toEqual({ arquivoFicou: false })
    expect(chamadas).toEqual(['midias.remover', 'armazenamento.remover'])
    expect(args['midias.remover'][0]).toEqual([ID])
    expect(args['armazenamento.remover'][0]).toEqual([MIDIA.caminho])
  })

  test('excluir-em-uso', async () => {
    const { s, chamadas } = falsos({ removerMidia: new ErroDePreparacao('em_uso') })
    expect(await motivoDe(excluirMidia(s, MIDIA))).toBe('em_uso')
    expect(chamadas).toEqual(['midias.remover'])
  })

  test('excluir-arquivo-ficou', async () => {
    const { s, chamadas } = falsos({ removerArquivo: new ErroDePreparacao('rede') })
    expect(await excluirMidia(s, MIDIA)).toEqual({ arquivoFicou: true })
    expect(chamadas).toEqual(['midias.remover', 'armazenamento.remover'])
  })
})
