import { describe, test, expect } from 'vitest'

/** Todos os arquivos de código de `src/domains`, como texto (Vite: `?raw`). */
const arquivos = import.meta.glob<string>('./**/*.{ts,tsx,mts,cts,js,jsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const TESTE = /\.test\.[^./]+$/

/** O que um domínio não pode importar: React, Supabase, `shared/` e `app/` (DDD; portas no domínio). */
const PROIBIDOS: { nome: string; teste: (origem: string) => boolean }[] = [
  { nome: 'react', teste: (o) => o === 'react' || o.startsWith('react/') || o.startsWith('react-dom') },
  { nome: '@supabase/', teste: (o) => o.startsWith('@supabase/') },
  { nome: '/shared/', teste: (o) => /(^|\/)shared(\/|$)/.test(o) },
  { nome: '/app/', teste: (o) => /(^|\/)app(\/|$)/.test(o) },
]

/** Origem de cada `import ... from '...'`, `export ... from '...'`, `import '...'` e `import('...')`. */
function origens(codigo: string): string[] {
  const achadas: string[] = []
  const padroes = [
    /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const padrao of padroes) for (const m of codigo.matchAll(padrao)) achadas.push(m[1])
  return achadas
}

/**
 * APIs do navegador que o domínio não pode citar (D1 do PLA-005): o domínio só conhece portas e tipos opacos
 * (`FaixaDeVideo`, `FluxoDeVideo`); quem fala com o navegador são os adaptadores de `src/shared/infra/`.
 * `MediaStream` pega também `MediaStreamTrack`; `RTC\w+` pega `RTCPeerConnection`, `RTCRtpSender` e os outros. Desde a
 * rodada 1 da revisão do VER-049, também `globalThis` e os relógios do ambiente (`setTimeout`, `setInterval` e os
 * `clear*`): o domínio só usa o `agendar` injetado.
 */
const NAVEGADOR = /\b(?:RTC\w+|navigator|window|document|globalThis|MediaStream\w*|getUserMedia|wakeLock|setTimeout|setInterval|clearTimeout|clearInterval)\b/g

/** O código sem comentários de bloco e de linha (o `//` de uma URL dentro de texto também corta; aqui só sobra menos). */
function semComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/.*$/gm, '$1')
}

/** Cada citação de API do navegador fora de comentário. */
function citacoesDoNavegador(codigo: string): string[] {
  return [...semComentarios(codigo).matchAll(NAVEGADOR)].map((m) => m[0])
}

describe('arquitetura dos domínios', () => {
  test('o glob encontra os arquivos de domínio', () => {
    expect(Object.keys(arquivos)).toContain('./acesso/portas.ts')
    expect(Object.keys(arquivos)).toContain('./acesso/resolverAcesso.ts')
  })

  test('nenhum arquivo de domínio importa React, Supabase, shared/ ou app/', () => {
    const violacoes: string[] = []
    for (const [arquivo, codigo] of Object.entries(arquivos)) {
      if (TESTE.test(arquivo)) continue
      for (const origem of origens(codigo)) {
        for (const p of PROIBIDOS) if (p.teste(origem)) violacoes.push(`${arquivo}: importa '${origem}' (${p.nome})`)
      }
    }
    expect(violacoes).toEqual([])
  })

  test('o detector reconhece as formas de import proibidas', () => {
    const exemplos = [
      "import type { SupabaseClient } from '@supabase/supabase-js'",
      "import { useState } from 'react'",
      "import { lerConfiguracao } from '../../shared/infra/configuracao'",
      "export { App } from '../../app/App'",
      "import '../../shared/styles/base.css'",
      "const m = await import('@supabase/supabase-js')",
    ]
    for (const e of exemplos) {
      expect(origens(e).some((o) => PROIBIDOS.some((p) => p.teste(o))), e).toBe(true)
    }
    expect(origens("import { mesmoEmail } from './email'").some((o) => PROIBIDOS.some((p) => p.teste(o)))).toBe(false)
  })

  test('dominio-sem-navegador: nenhum arquivo de domínio cita RTC*, navigator, window, document, globalThis, MediaStream, getUserMedia, wakeLock, setTimeout ou setInterval fora de comentário', () => {
    expect(Object.keys(arquivos)).toContain('./captura/emissor.ts')
    const violacoes: string[] = []
    for (const [arquivo, codigo] of Object.entries(arquivos)) {
      if (TESTE.test(arquivo)) continue
      for (const c of citacoesDoNavegador(codigo)) violacoes.push(`${arquivo}: cita '${c}'`)
    }
    expect(violacoes).toEqual([])
  })

  test('o detector de APIs do navegador reconhece as formas proibidas e ignora comentários', () => {
    const exemplos = [
      'const pc = new RTCPeerConnection()',
      'navigator.mediaDevices.getUserMedia({ video: true })',
      'window.setTimeout(f, 0)',
      'document.hidden',
      'let t: MediaStreamTrack',
      'const s = new MediaStream()',
      'await navigator.wakeLock.request("screen")',
      'globalThis.setTimeout(f, 0)',
      'const t = setTimeout(f, 10)',
      'setInterval(f, 1000)',
      'clearTimeout(t)',
      'const s: RTCRtpSender = x',
      'new RTCSessionDescription(d)',
    ]
    for (const e of exemplos) expect(citacoesDoNavegador(e), e).not.toEqual([])
    expect(citacoesDoNavegador('// window.setTimeout(f, 0)\n/* new RTCPeerConnection() */\nconst x = 1 // document')).toEqual([])
    expect(citacoesDoNavegador("const u = 'https://exemplo.test/x'; window.alert(u)")).toEqual(['window'])
    // nomes do domínio que só contêm as palavras não contam
    expect(citacoesDoNavegador('const agendarRepeticao = 1; const meuSetTimeoutFalso = 2; const aRTCPeer = 3')).toEqual([])
  })
})
