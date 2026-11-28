/**
 * **Só para testes** (VER-052, rodada 2, R2-N3; antes dentro do `telas/PalcoNoAr.test.tsx`): lê um arquivo do repositório
 * pelo `node:fs` (o Vitest roda na raiz). O projeto não tem `@types/node`, então o módulo é importado com o tipo mínimo
 * usado; o CSS por `?raw` volta vazio (o Vitest não processa CSS). Usado pelo `PalcoNoAr.test.tsx` (o `index.html` e o
 * `base.css`) e pelo `CameraNoAr.test.tsx` (o `base.css` e o `tokens.css`).
 */
export async function lerArquivoDoRepositorio(caminho: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync(c: string, codificacao: 'utf8'): string }
  const { process } = globalThis as unknown as { process: { cwd(): string } }
  return fs.readFileSync(`${process.cwd()}/${caminho}`, 'utf8')
}
