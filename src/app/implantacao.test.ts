import { describe, test, expect } from 'vitest'
import configuracaoDoVite, { LICENCAS_NO_DEPLOY } from '../../vite.config'
import { lerArquivoDoRepositorio } from './lerArquivoDoRepositorio'

/**
 * Configuração de build e de deploy dos gestos (PLA-006, Tarefa 5; VER-062).
 *
 * `fonteDaVercelParaRegExp` reproduz, para o subconjunto usado aqui, o que a Vercel faz com o `source` de `rewrites` e
 * `headers`: `@vercel/routing-utils` 6.6.1 (`sourceToRegex`) chama o `pathToRegexp` do `path-to-regexp` 6.1.0 (e
 * compara com o 6.3.0) com `{ strict: true, sensitive: true, delimiter: '/' }`. Lido na fonte do `path-to-regexp` 6.3.0
 * (`lexer`, `parse`, `tokensToRegexp`): texto fixo escapado; um grupo `(…)` vira parâmetro com o padrão dado e, se
 * precedido de `/` ou `.`, esse caractere vira o prefixo, `(?:\/(padrão))`; `:nome` sem padrão usa `[^\/]+?`;
 * `strict` não põe a barra final opcional; termina em `$`; `sensitive` → sem a flag `i`. O resto da sintaxe
 * (`*`, `+`, `?`, `{}`, `\`) não é usado nos arquivos daqui e lança, para o teste nunca aceitar o que não sabe converter.
 */
function fonteDaVercelParaRegExp(fonte: string): RegExp {
  const escapar = (s: string) => s.replace(/([.+*?=^!:${}()[\]|/\\])/g, '\\$1')
  let rota = '^'
  let texto = ''
  let i = 0
  while (i < fonte.length) {
    const c = fonte[i]
    if ('*+?{}\\'.includes(c)) throw new Error(`sintaxe não reproduzida no teste: ${c} em ${fonte}`)
    let nome = ''
    let padrao = ''
    if (c === ':') {
      let j = i + 1
      while (j < fonte.length && /[A-Za-z0-9_]/.test(fonte[j])) nome += fonte[j++]
      if (!nome) throw new Error(`parâmetro sem nome em ${fonte}`)
      i = j
    }
    if (fonte[i] === '(') {
      let conta = 1
      let j = i + 1
      if (fonte[j] === '?') throw new Error(`padrão começa com ? em ${fonte}`)
      while (j < fonte.length) {
        if (fonte[j] === ')' && --conta === 0) break
        if (fonte[j] === '(') {
          conta++
          if (fonte[j + 1] !== '?') throw new Error(`grupo de captura dentro do padrão em ${fonte}`)
        }
        padrao += fonte[j++]
      }
      if (conta) throw new Error(`padrão sem fechar em ${fonte}`)
      i = j + 1
    }
    if (nome || padrao) {
      const anterior = texto.slice(-1)
      const prefixo = anterior === '/' || anterior === '.' ? anterior : ''
      rota += escapar(prefixo ? texto.slice(0, -1) : texto)
      texto = ''
      const p = padrao || '[^\\/]+?'
      rota += prefixo ? `(?:${escapar(prefixo)}(${p}))` : `(${p})`
      continue
    }
    texto += c
    i++
  }
  return new RegExp(`${rota}${escapar(texto)}$`)
}

type Cabecalho = { key: string; value: string }
type Vercel = {
  rewrites?: { source: string; destination: string }[]
  headers?: { source: string; headers: Cabecalho[] }[]
}
const lerVercel = async () => JSON.parse(await lerArquivoDoRepositorio('vercel.json')) as Vercel

/** Um plugin do Vite visto pelo teste: só o que o `licencas-no-build` usa. */
type PluginVisto = {
  name?: string
  apply?: unknown
  generateBundle?: (this: { emitFile(a: { type: string; fileName?: string; source?: unknown }): string }) => unknown
}
const pluginsDoVite = () => ((configuracaoDoVite.plugins ?? []) as unknown[]).flat(Infinity as 1) as PluginVisto[]

describe('build e deploy (VER-062)', () => {
  test('vite-worker-em-es: o vite.config.ts monta os workers em formato ES (N6; o padrão do Vite é iife)', () => {
    expect(configuracaoDoVite.worker?.format).toBe('es')
  })

  test('assets-fora-da-rewrite: a rewrite de SPA, convertida como a Vercel converte, não pega /assets/ nem /licencas/ (N7; rodada 1, I1)', async () => {
    // o conversor reproduz o path-to-regexp nas fontes conhecidas (texto conferido na leitura da fonte 6.3.0); o
    // `RegExp.source` escapa a barra de dentro do padrão, e é esse `source` que o `sourceToRegex` da Vercel devolve como `src`
    expect(fonteDaVercelParaRegExp('/((?!assets/).*)').source).toBe('^(?:\\/((?!assets\\/).*))$')
    expect(fonteDaVercelParaRegExp('/((?!assets/|licencas/).*)').source).toBe('^(?:\\/((?!assets\\/|licencas\\/).*))$')
    expect(fonteDaVercelParaRegExp('/(.*)').source).toBe('^(?:\\/(.*))$')
    expect(fonteDaVercelParaRegExp('/assets/(.*)').source).toBe('^\\/assets(?:\\/(.*))$')
    expect(fonteDaVercelParaRegExp('/assets/(.*)').flags).toBe('')

    const { rewrites = [] } = await lerVercel()
    expect(rewrites).toHaveLength(1)
    expect(rewrites[0].destination).toBe('/index.html')
    const rewrite = fonteDaVercelParaRegExp(rewrites[0].source)
    for (const caminho of [
      '/assets/x-abc.wasm', '/assets/gesture_recognizer-abc.task', '/assets/index-abc.js', '/assets/',
      '/licencas/LICENSE-APACHE-2.0.txt', '/licencas/NOTICE.txt', '/licencas/',
    ])
      expect(rewrite.test(caminho), caminho).toBe(false)
    for (const caminho of ['/', '/camera', '/obs/palco', '/obs/camera', '/painel', '/assetsx', '/x/assets/y', '/licencasx'])
      expect(rewrite.test(caminho), caminho).toBe(true)
  })

  test('cache-so-em-assets: o Cache-Control (e o immutable de um ano) só é definido na fonte /assets/(.*)', async () => {
    const { headers = [] } = await lerVercel()
    // nenhuma outra regra mexe no Cache-Control (rodada 1, N5: uma regra em /(.*) também valeria para /assets/)
    const comCache = headers.filter((h) => h.headers.some((c) => c.key.toLowerCase() === 'cache-control'))
    expect(comCache.map((h) => h.source)).toEqual(['/assets/(.*)'])
    const comImutavel = headers.filter((h) => h.headers.some((c) => /immutable/i.test(c.value)))
    expect(comImutavel.map((h) => h.source)).toEqual(['/assets/(.*)'])
    expect(comImutavel[0].headers).toEqual([{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }])
    const fonte = fonteDaVercelParaRegExp(comImutavel[0].source)
    expect(fonte.test('/assets/x-abc.wasm')).toBe(true)
    for (const caminho of ['/', '/index.html', '/camera', '/obs/palco', '/assets', '/licencas/NOTICE.txt'])
      expect(fonte.test(caminho), caminho).toBe(false)
  })

  test('licencas-no-build: o build emite a licença e o aviso do MediaPipe em dist/licencas/, com os bytes de modelos/ (rodada 1, I1)', async () => {
    expect(LICENCAS_NO_DEPLOY.map((l) => l.destino)).toEqual(['licencas/LICENSE-APACHE-2.0.txt', 'licencas/NOTICE.txt'])
    const plugin = pluginsDoVite().find((p) => p.name === 'revocast:licencas-no-deploy')
    expect(plugin?.apply).toBe('build')
    const emitidos: { type: string; fileName?: string; source?: unknown }[] = []
    await plugin?.generateBundle?.call({ emitFile: (a) => (emitidos.push(a), a.fileName ?? '') })
    expect(emitidos.map((e) => [e.type, e.fileName])).toEqual([
      ['asset', 'licencas/LICENSE-APACHE-2.0.txt'],
      ['asset', 'licencas/NOTICE.txt'],
    ])
    for (const [i, { origem }] of LICENCAS_NO_DEPLOY.entries()) {
      const fonte = await lerArquivoDoRepositorio(origem)
      expect(fonte.length).toBeGreaterThan(0)
      expect(new TextDecoder().decode(emitidos[i].source as Uint8Array)).toBe(fonte)
    }
  })
})
