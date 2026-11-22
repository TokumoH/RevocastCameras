// check-doc-secrets: procura segredos e dados pessoais em todos os arquivos de texto rastreados
// (documentação, código e configuração). Falha se encontrar qualquer ocorrência.
import fs from "node:fs";
import { trackedFiles, reporter } from "./_lib.mjs";

const EXT_TEXTO = /\.(md|ts|tsx|js|mjs|cjs|json|html|css|ya?ml|sh|txt|svg|sql|toml)$|(^|\/)(pre-push|\.gitignore|\.env(\.[\w-]+)?\.example)$/;

// Cada padrão é montado em partes para que este arquivo não acuse a si mesmo. Todos são globais (g):
// cada ocorrência da linha é conferida, para que um e-mail permitido não esconda outro na mesma linha.
const PADROES = [
  ["e-mail", new RegExp("[A-Za-z0-9._%+-]+" + "@" + "[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}", "g")],
  ["token do GitHub", new RegExp("\\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})", "g")],
  ["chave AWS", new RegExp("\\b" + "AKIA" + "[0-9A-Z]{16}\\b", "g")],
  ["chave privada", new RegExp("-----BEGIN [A-Z ]*" + "PRIVATE KEY-----", "g")],
  [
    "atribuição de credencial",
    new RegExp("(api[_-]?key|secret|password|passwd|token)" + "\\s*[:=]\\s*['\"]?[A-Za-z0-9_\\-\\/+]{8,}", "gi"),
  ],
];

// Exceções conhecidas e justificadas (documentar o motivo ao acrescentar). Cada item é comparado com o FIM
// da ocorrência, sem diferenciar maiúsculas (endsWith sobre o texto em minúsculas).
// '@revocast.test': domínio sob o TLD .test, reservado pela RFC 2606 para testes (não existe na internet);
// usado nos testes do banco (VER-010). O endsWith não libera domínios como revocast.test.com.br.
const PERMITIDOS = ["@revocast.test"];
const permitido = (ocorrencia) => PERMITIDOS.some((p) => ocorrencia.toLowerCase().endsWith(p));

const r = reporter("check-doc-secrets");
const alvos = trackedFiles().filter((f) => EXT_TEXTO.test(f));
for (const f of alvos) {
  fs.readFileSync(f, "utf8").split("\n").forEach((linha, i) => {
    for (const [nome, re] of PADROES) {
      if ([...linha.matchAll(re)].some((m) => !permitido(m[0]))) r.erro(`${f}:${i + 1}: possível ${nome}`);
    }
  });
}
r.fim(`${alvos.length} arquivos verificados`);
