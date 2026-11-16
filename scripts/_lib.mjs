// Utilitários compartilhados pelas checagens (GRASP Pure Fabrication):
// acesso ao Git e ao sistema de arquivos fica aqui, as regras ficam em cada check-*.mjs.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

/** Executa o git sem shell (sem risco de injeção) e devolve a saída como texto. */
export function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Arquivos versionados + novos não ignorados (estado da árvore de trabalho). */
export function trackedFiles() {
  return git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
    .split("\0")
    .filter((f) => f && fs.existsSync(f));
}

/** Diretórios que contêm algum arquivo rastreado (inclui ancestrais), sem a raiz. */
export function trackedDirs(files = trackedFiles()) {
  const dirs = new Set();
  for (const f of files) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return [...dirs].sort();
}

/** Acumula erros e encerra com código 1 se houver algum. */
export function reporter(nome) {
  const erros = [];
  return {
    erro: (msg) => erros.push(msg),
    fim(resumo = "") {
      for (const e of erros) console.error(`ERRO [${nome}] ${e}`);
      console.log(`${nome}: ${erros.length} erro(s)${resumo ? ` — ${resumo}` : ""}`);
      process.exit(erros.length ? 1 : 0);
    },
  };
}
