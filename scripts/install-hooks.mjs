// install-hooks: aponta o Git para os hooks versionados em .githooks/ (executado pelo "prepare" do npm).
// Não falha fora de um repositório Git (ex.: código baixado como .zip).
import { git } from "./_lib.mjs";

try {
  git("rev-parse", "--is-inside-work-tree");
} catch {
  console.log("install-hooks: fora de um repositório Git; nada a fazer");
  process.exit(0);
}
git("config", "core.hooksPath", ".githooks");
console.log("install-hooks: core.hooksPath = .githooks");
