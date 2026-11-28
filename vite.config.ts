import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * Licença e aviso do MediaPipe servidos pelo deploy em `/licencas/` (Apache-2.0, §4(a); VER-062, rodada 1, I1): o build
 * emite os dois arquivos de `src/shared/infra/modelos/` em `dist/licencas/`, sem uma segunda cópia na fonte. Só no
 * build (`vite dev` não os serve). Teste: `licencas-no-build` (`src/app/implantacao.test.ts`).
 */
export const LICENCAS_NO_DEPLOY = [
  { origem: 'src/shared/infra/modelos/LICENSE-APACHE-2.0.txt', destino: 'licencas/LICENSE-APACHE-2.0.txt' },
  { origem: 'src/shared/infra/modelos/NOTICE.txt', destino: 'licencas/NOTICE.txt' },
] as const

function licencasNoDeploy(): Plugin {
  return {
    name: 'revocast:licencas-no-deploy',
    apply: 'build',
    async generateBundle() {
      // o tsconfig não carrega os tipos do Node: import dinâmico tipado à mão (como em lerArquivoDoRepositorio.ts)
      const { readFileSync } = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as {
        readFileSync(caminho: URL): Uint8Array
      }
      for (const { origem, destino } of LICENCAS_NO_DEPLOY)
        this.emitFile({ type: 'asset', fileName: destino, source: readFileSync(new URL(`./${origem}`, import.meta.url)) })
    },
  }
}

export default defineConfig({
  plugins: [react(), licencasNoDeploy()],
  // Workers em formato ES (o padrão do Vite 8.3.5 é 'iife'): o worker do reconhecedor de gestos é de módulo e carrega
  // o vision_wasm_module_internal.js por import() (PLA-006, D9 e revisão 1, N6; VER-062).
  worker: { format: 'es' },
  test: {
    include: [
      'src/**/*.test.{ts,tsx}',
      'supabase/tests/**/*.test.ts',
      'scripts/tests/**/*.test.mjs',
    ],
  },
})
