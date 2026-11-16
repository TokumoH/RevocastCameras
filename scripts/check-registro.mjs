// check-registro: todo commit leva registro em docs/verificacoes/ (CLAUDE.md, "Commit").
// Cada commit (sem contar merges) precisa adicionar ou alterar um arquivo
// docs/verificacoes/AAAA-MM-DD-NNN-slug.md.
//
// Uso:
//   node scripts/check-registro.mjs --pre-push      (lê do stdin as linhas que o git passa ao hook)
//   node scripts/check-registro.mjs --range A..B    (ex.: na CI, origin/master..HEAD)
import fs from "node:fs";
import { git, reporter } from "./_lib.mjs";

const REGISTRO = /^docs\/verificacoes\/\d{4}-\d{2}-\d{2}-\d{3}-[a-z0-9-]+\.md$/;
const ZERO = /^0+$/;
const r = reporter("check-registro");

function commitsDe(...revArgs) {
  return git("rev-list", "--no-merges", ...revArgs).split("\n").filter(Boolean);
}

let commits = [];
const [modo, valor] = process.argv.slice(2);
if (modo === "--pre-push") {
  const entrada = fs.readFileSync(0, "utf8");
  for (const linha of entrada.split("\n").filter(Boolean)) {
    const [, localSha] = linha.split(" ");
    if (!localSha || ZERO.test(localSha)) continue; // exclusão de branch: nada a checar
    // só o que ainda não está em nenhuma branch remota conhecida
    commits.push(...commitsDe(localSha, "--not", "--remotes"));
  }
} else if (modo === "--range" && /^[\w./~^-]+\.\.[\w./~^-]+$/.test(valor ?? "")) {
  commits = commitsDe(valor);
} else {
  console.error("uso: check-registro.mjs --pre-push | --range A..B");
  process.exit(2);
}

commits = [...new Set(commits)];
for (const sha of commits) {
  const alterados = git("diff-tree", "--no-commit-id", "--name-only", "-r", "--diff-filter=AM", sha)
    .split("\n").filter(Boolean);
  if (!alterados.some((f) => REGISTRO.test(f))) {
    const titulo = git("log", "-1", "--format=%h %s", sha).trim();
    r.erro(`commit sem registro em docs/verificacoes/: ${titulo}`);
  }
}
r.fim(`${commits.length} commit(s) verificados`);
