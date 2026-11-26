import { describe, test, expect } from 'vitest'
import { conferirAviso, conferirEpisodio, normalizarLink, podeExcluirEpisodio, trocarOrdem, type Episodio } from './episodios'
import type { Midia } from './midia'

const IMAGEM: Midia = {
  id: 'img-1',
  tipo: 'imagem',
  nome: 'foto.png',
  caminho: 'imagem/img-1.png',
  mime: 'image/png',
  tamanhoBytes: 10,
  enviadoPor: null,
}

const AVISO_OK = { titulo: 'Inscreva-se', link: '', duracaoS: 10, imagemMidiaId: null }

describe('episodios', () => {
  test('link-so-https', () => {
    expect(normalizarLink('https://revocast.test/x')).toEqual({ ok: true, link: 'https://revocast.test/x' })
    expect(normalizarLink('HTTPS://revocast.test')).toEqual({ ok: true, link: 'https://revocast.test/' })
    expect(normalizarLink('  https://revocast.test/a?b=1  ')).toEqual({ ok: true, link: 'https://revocast.test/a?b=1' })
    expect(normalizarLink('')).toEqual({ ok: true, link: null })
    expect(normalizarLink('   ')).toEqual({ ok: true, link: null })
    for (const t of [
      'http://revocast.test',
      'javascript:alert(1)',
      'data:text/html,x',
      '//revocast.test',
      'https://u:s@revocast.test',
      'https://u@revocast.test',
      'revocast.test',
      'ftp://revocast.test',
    ]) {
      expect(normalizarLink(t), t).toEqual({ ok: false })
    }
  })

  test('conferir-aviso', () => {
    expect(conferirAviso(AVISO_OK, [])).toBeNull()
    expect(conferirAviso({ ...AVISO_OK, titulo: '  ' }, [])).toBe('titulo_vazio')
    expect(conferirAviso({ ...AVISO_OK, link: 'javascript:alert(1)' }, [])).toBe('link_invalido')
    for (const duracaoS of [0, 601, 1.5, -1, Number.NaN]) {
      expect(conferirAviso({ ...AVISO_OK, duracaoS }, []), String(duracaoS)).toBe('duracao_invalida')
    }
    expect(conferirAviso({ ...AVISO_OK, duracaoS: 1 }, [])).toBeNull()
    expect(conferirAviso({ ...AVISO_OK, duracaoS: 600 }, [])).toBeNull()
    expect(conferirAviso({ ...AVISO_OK, imagemMidiaId: 'img-1' }, [IMAGEM])).toBeNull()
    expect(conferirAviso({ ...AVISO_OK, imagemMidiaId: 'img-2' }, [IMAGEM])).toBe('imagem_inexistente')
    // uma mídia de som na lista não serve de imagem
    expect(conferirAviso({ ...AVISO_OK, imagemMidiaId: 'som-1' }, [{ ...IMAGEM, id: 'som-1', tipo: 'som' }])).toBe('imagem_inexistente')
  })

  test('conferir-episodio', () => {
    expect(conferirEpisodio({ titulo: 'Episódio 1', data: '2026-02-28' })).toBeNull()
    expect(conferirEpisodio({ titulo: 'Episódio 1', data: '2028-02-29' })).toBeNull()
    expect(conferirEpisodio({ titulo: 'Episódio 1', data: '2026-02-30' })).toBe('data_invalida')
    expect(conferirEpisodio({ titulo: 'Episódio 1', data: '0001-01-01' })).toBeNull()
    for (const data of ['0000-01-01', '2026-02-29', '2026-13-01', '2026-00-10', '2026-1-1', '26-01-01', '', '2026-01-01T00:00']) {
      expect(conferirEpisodio({ titulo: 'Episódio 1', data }), data).toBe('data_invalida')
    }
    expect(conferirEpisodio({ titulo: '   ', data: '2026-01-01' })).toBe('titulo_vazio')
    expect(conferirEpisodio({ titulo: 'a'.repeat(121), data: '2026-01-01' })).toBe('titulo_longo')
    expect(conferirEpisodio({ titulo: 'a'.repeat(120), data: '2026-01-01' })).toBeNull()
  })

  test('excluir-so-rascunho', () => {
    const base: Episodio = { id: 'e1', titulo: 'Episódio 1', data: '2026-01-01', estado: 'rascunho' }
    expect(podeExcluirEpisodio(base)).toBe(true)
    expect(podeExcluirEpisodio({ ...base, estado: 'ao_vivo' })).toBe(false)
    expect(podeExcluirEpisodio({ ...base, estado: 'encerrado' })).toBe(false)
  })

  test('trocar-ordem', () => {
    const lista = [
      { id: 'a', ordem: 0 },
      { id: 'b', ordem: 1 },
      { id: 'c', ordem: 2 },
    ]
    expect(trocarOrdem(lista, 'b', 'subir')).toEqual([
      { id: 'a', ordem: 1 },
      { id: 'b', ordem: 0 },
    ])
    expect(trocarOrdem(lista, 'b', 'descer')).toEqual([
      { id: 'b', ordem: 2 },
      { id: 'c', ordem: 1 },
    ])
    expect(trocarOrdem(lista, 'a', 'subir')).toEqual([])
    expect(trocarOrdem(lista, 'c', 'descer')).toEqual([])
    expect(trocarOrdem(lista, 'x', 'subir')).toEqual([])
    // a ordem vem do campo `ordem`, não da posição na lista recebida
    expect(trocarOrdem([lista[2], lista[0], lista[1]], 'b', 'subir')).toEqual([
      { id: 'a', ordem: 1 },
      { id: 'b', ordem: 0 },
    ])
    // ordens repetidas: renumera 0..n-1 (na ordem da lista) e troca; devolve tudo o que mudou
    const repetidas = [
      { id: 'a', ordem: 0 },
      { id: 'b', ordem: 0 },
      { id: 'c', ordem: 0 },
    ]
    expect(trocarOrdem(repetidas, 'b', 'subir')).toEqual([
      { id: 'b', ordem: 0 },
      { id: 'a', ordem: 1 },
      { id: 'c', ordem: 2 },
    ])
  })
})
