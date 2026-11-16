// check-doc-secrets: procura segredos e dados pessoais em todos os arquivos de texto rastreados
// (documentação, código e configuração). Falha se encontrar qualquer ocorrência.
import fs from "node:fs";
import { trackedFiles, reporter } from "./_lib.mjs";

const EXT_TEXTO = /\.(md|ts|tsx|js|mjs|cjs|json|html|css|ya?ml|sh|txt|svg)$|(^|\/)(pre-push|\.gitignore)$/;

// Cada padrão é montado em partes para que este arquivo não acuse a si mesmo.
const PADROES = [
  ["e-mail", new RegExp("[A-Za-z0-9._%+-]+" + "@" + "[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}")],
  ["token do GitHub", new RegExp("\\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})")],
  ["chave AWS", new RegExp("\\b" + "AKIA" + "[0-9A-Z]{16}\\b")],
  ["chave privada", new RegExp("-----BEGIN [A-Z ]*" + "PRIVATE KEY-----")],
  [
    "atribuição de credencial",
    new RegExp("(api[_-]?key|secret|password|passwd|token)" + "\\s*[:=]\\s*['\"]?[A-Za-z0-9_\\-\\/+]{8,}", "i"),
  ],
];

// Exceções conhecidas e justificadas (documentar o motivo ao acrescentar).
const PERMITIDOS = [];

const r = reporter("check-doc-secrets");
const alvos = trackedFiles().filter((f) => EXT_TEXTO.test(f));
for (const f of alvos) {
  fs.readFileSync(f, "utf8").split("\n").forEach((linha, i) => {
    for (const [nome, re] of PADROES) {
      const m = linha.match(re);
      if (m && !PERMITIDOS.some((p) => m[0].includes(p))) r.erro(`${f}:${i + 1}: possível ${nome}`);
    }
  });
}
r.fim(`${alvos.length} arquivos verificados`);
