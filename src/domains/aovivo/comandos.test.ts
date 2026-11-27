import { describe, test, expect } from 'vitest'
import type { Cena } from '../preparacao/cenas'
import type { Aviso } from '../preparacao/episodios'
import type { Som } from '../preparacao/midia'
import { TAMANHO_DO_MARCADOR, linhaDoRegistro, resolverComando } from './comandos'
import type { AcaoNoObs, MotivoDaRecusa } from './comandos'
import { MOTIVOS_DO_RESULTADO } from './mensagens'
import type { Comando, MotivoDoResultado } from './mensagens'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const CMD = uuid(99)
const EPISODIO = uuid(50)
const REMETENTE = uuid(77)
const FORA = uuid(404)

// fora da ordem na lista, para provar que a `ordem` decide
const CENAS: Cena[] = [
  { id: uuid(3), nomeExibicao: 'Plano C', nomeObs: 'C', ordem: 2 },
  { id: uuid(1), nomeExibicao: 'Plano A', nomeObs: 'A', ordem: 0 },
  { id: uuid(2), nomeExibicao: 'Plano B', nomeObs: 'B', ordem: 1 },
]
const SONS: Som[] = [{ id: uuid(10), midiaId: uuid(11), rotulo: 'aplauso', emoji: '👏', volume: 0.7, ordem: 0 }]
const aviso = (n: number, ordem: number): Aviso => ({
  id: uuid(n),
  episodioId: EPISODIO,
  titulo: `Aviso ${n}`,
  texto: '',
  link: null,
  imagemMidiaId: null,
  duracaoS: 10 + n,
  ordem,
})
const AVISOS: Aviso[] = [aviso(22, 1), aviso(21, 0), aviso(23, 2)]

const ctx = (estado: { cenaObs?: string | null; avisoId?: string | null } = {}, listas: { cenas?: Cena[]; sons?: Som[]; avisos?: Aviso[] } = {}) => ({
  cenas: listas.cenas ?? CENAS,
  sons: listas.sons ?? SONS,
  avisos: listas.avisos ?? AVISOS,
  estado: { cenaObs: estado.cenaObs ?? null, avisoId: estado.avisoId ?? null },
  episodioTitulo: 'Episódio 12',
  agora: new Date(2026, 10, 27, 20, 5, 9),
})

describe('resolverComando', () => {
  test('cena, som e aviso existentes viram a ação do OBS', () => {
    expect(resolverComando({ id: CMD, acao: 'cena', cenaId: uuid(2) }, ctx())).toEqual({ ok: true, acao: { tipo: 'trocar_cena', nomeObs: 'B', cenaId: uuid(2) } })
    expect(resolverComando({ id: CMD, acao: 'som', somId: uuid(10) }, ctx())).toEqual({ ok: true, acao: { tipo: 'tocar_som', somId: uuid(10), volume: 0.7 } })
    expect(resolverComando({ id: CMD, acao: 'aviso', avisoId: uuid(23) }, ctx())).toEqual({ ok: true, acao: { tipo: 'mostrar_aviso', avisoId: uuid(23), duracaoS: 33 } })
    expect(resolverComando({ id: CMD, acao: 'clipe' }, ctx())).toEqual({ ok: true, acao: { tipo: 'salvar_clipe' } })
  })

  test('toda recusa cabe no estado no ar (MotivoDaRecusa ⊂ MOTIVOS_DO_RESULTADO)', () => {
    // conferência de tipo: uma recusa que não estivesse na lista fixa não compilaria aqui
    const recusas: readonly MotivoDoResultado[] = ['cena_inexistente', 'som_inexistente', 'aviso_inexistente', 'sem_cenas', 'fim_dos_avisos', 'sem_aviso_no_ar'] satisfies readonly MotivoDaRecusa[]
    for (const r of recusas) expect(MOTIVOS_DO_RESULTADO).toContain(r)
  })

  test('comando-alvo-inexistente: cena, som e aviso fora das listas → motivo', () => {
    expect(resolverComando({ id: CMD, acao: 'cena', cenaId: FORA }, ctx())).toEqual({ ok: false, motivo: 'cena_inexistente' })
    expect(resolverComando({ id: CMD, acao: 'som', somId: FORA }, ctx())).toEqual({ ok: false, motivo: 'som_inexistente' })
    expect(resolverComando({ id: CMD, acao: 'aviso', avisoId: FORA }, ctx())).toEqual({ ok: false, motivo: 'aviso_inexistente' })
    // id de outra lista não serve
    expect(resolverComando({ id: CMD, acao: 'som', somId: uuid(1) }, ctx())).toEqual({ ok: false, motivo: 'som_inexistente' })
    expect(resolverComando({ id: CMD, acao: 'cena', cenaId: uuid(2) }, ctx({}, { cenas: [] }))).toEqual({ ok: false, motivo: 'cena_inexistente' })
  })

  test('proxima-cena segue a ordem a partir da cena do OBS e volta ao início', () => {
    const proxima = (cenaObs: string | null, cenas?: Cena[]) => resolverComando({ id: CMD, acao: 'proxima_cena' }, ctx({ cenaObs }, { cenas }))
    expect(proxima('B')).toEqual({ ok: true, acao: { tipo: 'trocar_cena', nomeObs: 'C', cenaId: uuid(3) } })
    expect(proxima('C')).toEqual({ ok: true, acao: { tipo: 'trocar_cena', nomeObs: 'A', cenaId: uuid(1) } })
    expect(proxima('A')).toEqual({ ok: true, acao: { tipo: 'trocar_cena', nomeObs: 'B', cenaId: uuid(2) } })
    expect(proxima('Cena que não está na lista')).toEqual({ ok: true, acao: { tipo: 'trocar_cena', nomeObs: 'A', cenaId: uuid(1) } })
    expect(proxima(null)).toEqual({ ok: true, acao: { tipo: 'trocar_cena', nomeObs: 'A', cenaId: uuid(1) } })
    expect(proxima('b')).toEqual({ ok: true, acao: { tipo: 'trocar_cena', nomeObs: 'A', cenaId: uuid(1) } }) // nome do OBS comparado exato
    expect(proxima('B', [])).toEqual({ ok: false, motivo: 'sem_cenas' })
  })

  test('proxima-cena com ordens empatadas segue a ordem da lista', () => {
    const empatadas: Cena[] = [
      { id: uuid(5), nomeExibicao: 'X', nomeObs: 'X', ordem: 0 },
      { id: uuid(6), nomeExibicao: 'Y', nomeObs: 'Y', ordem: 0 },
    ]
    expect(resolverComando({ id: CMD, acao: 'proxima_cena' }, ctx({ cenaObs: 'X' }, { cenas: empatadas }))).toEqual({ ok: true, acao: { tipo: 'trocar_cena', nomeObs: 'Y', cenaId: uuid(6) } })
  })

  test('proximo-aviso: sem aviso no ar → primeiro; segue a ordem; no último → fim_dos_avisos', () => {
    const proximo = (avisoId: string | null, avisos?: Aviso[]) => resolverComando({ id: CMD, acao: 'proximo_aviso' }, ctx({ avisoId }, { avisos }))
    expect(proximo(null)).toEqual({ ok: true, acao: { tipo: 'mostrar_aviso', avisoId: uuid(21), duracaoS: 31 } })
    expect(proximo(uuid(21))).toEqual({ ok: true, acao: { tipo: 'mostrar_aviso', avisoId: uuid(22), duracaoS: 32 } })
    expect(proximo(uuid(22))).toEqual({ ok: true, acao: { tipo: 'mostrar_aviso', avisoId: uuid(23), duracaoS: 33 } })
    expect(proximo(uuid(23))).toEqual({ ok: false, motivo: 'fim_dos_avisos' })
    expect(proximo(FORA)).toEqual({ ok: true, acao: { tipo: 'mostrar_aviso', avisoId: uuid(21), duracaoS: 31 } })
    expect(proximo(null, [])).toEqual({ ok: false, motivo: 'fim_dos_avisos' })
  })

  test('ocultar-sem-aviso → sem_aviso_no_ar; com aviso no ar → ocultar', () => {
    expect(resolverComando({ id: CMD, acao: 'ocultar_aviso' }, ctx())).toEqual({ ok: false, motivo: 'sem_aviso_no_ar' })
    expect(resolverComando({ id: CMD, acao: 'ocultar_aviso' }, ctx({ avisoId: uuid(22) }))).toEqual({ ok: true, acao: { tipo: 'ocultar_aviso' } })
  })

  test('marcador-com-nome: título do episódio + hora HH:MM:SS, até 100 caracteres', () => {
    expect(resolverComando({ id: CMD, acao: 'marcador' }, ctx())).toEqual({ ok: true, acao: { tipo: 'marcar', nome: 'Episódio 12 20:05:09' } })
    expect(resolverComando({ id: CMD, acao: 'marcador' }, { ...ctx(), agora: new Date(2026, 0, 2, 3, 4, 5) })).toEqual({ ok: true, acao: { tipo: 'marcar', nome: 'Episódio 12 03:04:05' } })
    const longo = resolverComando({ id: CMD, acao: 'marcador' }, { ...ctx(), episodioTitulo: '🎙'.repeat(120) })
    expect(TAMANHO_DO_MARCADOR).toBe(100)
    if (!longo.ok || longo.acao.tipo !== 'marcar') throw new Error('esperado marcar')
    expect(Array.from(longo.acao.nome)).toHaveLength(100)
    expect(longo.acao.nome.endsWith(' 20:05:09')).toBe(true)
    expect(longo.acao.nome.startsWith('🎙'.repeat(91))).toBe(true)
    const vazio = resolverComando({ id: CMD, acao: 'marcador' }, { ...ctx(), episodioTitulo: '   ' })
    expect(vazio).toEqual({ ok: true, acao: { tipo: 'marcar', nome: '20:05:09' } })
  })
})

describe('registro', () => {
  const linha = (c: Comando, a: AcaoNoObs, modo: 'ao_vivo' | 'teste' = 'ao_vivo') => linhaDoRegistro(c, a, { episodioId: EPISODIO, modo, remetente: REMETENTE })
  const base = { episodioId: EPISODIO, origem: 'toque', cenaId: null, somId: null, avisoId: null, membroId: REMETENTE, teste: false }

  test('aviso → proximo_aviso com o avisoId mostrado (D9)', () => {
    expect(linha({ id: CMD, acao: 'aviso', avisoId: uuid(22) }, { tipo: 'mostrar_aviso', avisoId: uuid(22), duracaoS: 32 })).toEqual({ ...base, acao: 'proximo_aviso', avisoId: uuid(22) })
    expect(linha({ id: CMD, acao: 'proximo_aviso' }, { tipo: 'mostrar_aviso', avisoId: uuid(21), duracaoS: 31 })).toEqual({ ...base, acao: 'proximo_aviso', avisoId: uuid(21) })
  })

  test('cena e próxima cena → cenaId resolvido; som → somId', () => {
    expect(linha({ id: CMD, acao: 'cena', cenaId: uuid(2) }, { tipo: 'trocar_cena', nomeObs: 'B', cenaId: uuid(2) })).toEqual({ ...base, acao: 'cena', cenaId: uuid(2) })
    expect(linha({ id: CMD, acao: 'proxima_cena' }, { tipo: 'trocar_cena', nomeObs: 'C', cenaId: uuid(3) })).toEqual({ ...base, acao: 'proxima_cena', cenaId: uuid(3) })
    expect(linha({ id: CMD, acao: 'som', somId: uuid(10) }, { tipo: 'tocar_som', somId: uuid(10), volume: 0.7 })).toEqual({ ...base, acao: 'som', somId: uuid(10) })
  })

  test('ocultar, clipe e marcador sem alvo; modo teste → teste: true; membroId = remetente', () => {
    expect(linha({ id: CMD, acao: 'ocultar_aviso' }, { tipo: 'ocultar_aviso' })).toEqual({ ...base, acao: 'ocultar_aviso' })
    expect(linha({ id: CMD, acao: 'clipe' }, { tipo: 'salvar_clipe' }, 'teste')).toEqual({ ...base, acao: 'clipe', teste: true })
    expect(linha({ id: CMD, acao: 'marcador' }, { tipo: 'marcar', nome: 'x' })).toEqual({ ...base, acao: 'marcador' })
  })

  test('comando e ação que não combinam → lança', () => {
    expect(() => linha({ id: CMD, acao: 'som', somId: uuid(10) }, { tipo: 'trocar_cena', nomeObs: 'B', cenaId: uuid(2) })).toThrow()
    expect(() => linha({ id: CMD, acao: 'clipe' }, { tipo: 'marcar', nome: 'x' })).toThrow()
  })

  test('a linha nunca leva "nenhuma" e é sempre de toque', () => {
    const pares: [Comando, AcaoNoObs][] = [
      [{ id: CMD, acao: 'cena', cenaId: uuid(2) }, { tipo: 'trocar_cena', nomeObs: 'B', cenaId: uuid(2) }],
      [{ id: CMD, acao: 'aviso', avisoId: uuid(21) }, { tipo: 'mostrar_aviso', avisoId: uuid(21), duracaoS: 31 }],
      [{ id: CMD, acao: 'clipe' }, { tipo: 'salvar_clipe' }],
    ]
    for (const [c, a] of pares) {
      const l = linha(c, a)
      expect(l.acao).not.toBe('nenhuma')
      expect(l.origem).toBe('toque')
    }
  })
})
