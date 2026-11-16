// check-docs: coerência da documentação (regras do CLAUDE.md, "Organização da documentação").
// 1. Todo link Markdown relativo aponta para arquivo existente; âncoras #Lx-Ly não passam do fim
//    do arquivo; âncoras de título existem.
// 2. Todo diretório rastreado tem README.md (exceto os anteriores à regra, em LEGADO).
// 3. A tabela "## Onde" e o campo "Arquivos" de cada README batem com o conteúdo real do diretório.
// 4. Registros em docs/verificacoes/ seguem AAAA-MM-DD-NNN-slug.md, com NNN único.
import fs from "node:fs";
import path from "node:path";
import { trackedFiles, trackedDirs, reporter } from "./_lib.mjs";

// Diretórios criados antes da regra "todo diretório tem README" (commits ef0207a/d099629).
// Remover daqui quando ganharem README.
const LEGADO = new Set(["public", "src", "src/assets"]);

const r = reporter("check-docs");
const files = trackedFiles();
const mds = files.filter((f) => f.endsWith(".md"));

const slug = (s) =>
  s.trim().toLowerCase().replace(/[`*_]/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
const semCodigo = (t) => t.replace(/```[\s\S]*?```/g, "").replace(/<!--[\s\S]*?-->/g, "");
const linhas = (c) => c.split("\n").length - (c.endsWith("\n") ? 1 : 0);

// 1. links e âncoras
for (const f of mds) {
  for (const m of semCodigo(fs.readFileSync(f, "utf8")).matchAll(/\]\(([^)\s]+)\)/g)) {
    const link = m[1];
    if (/^[a-z]+:/i.test(link)) continue; // http(s), mailto…
    const [p, ancora] = link.split("#");
    const alvo = p ? path.posix.normalize(path.posix.join(path.posix.dirname(f), p)) : f;
    if (!fs.existsSync(alvo)) { r.erro(`${f}: link ${link} → inexistente`); continue; }
    if (!ancora) continue;
    if (fs.statSync(alvo).isDirectory()) { r.erro(`${f}: âncora em diretório ${link}`); continue; }
    const c = fs.readFileSync(alvo, "utf8");
    const lm = ancora.match(/^L(\d+)(?:-L(\d+))?$/);
    if (lm) {
      const fimAncora = Number(lm[2] ?? lm[1]);
      if (fimAncora > linhas(c)) r.erro(`${f}: ${link} passa do fim de ${alvo} (${linhas(c)} linhas)`);
    } else if (![...c.matchAll(/^#+\s+(.*)$/gm)].some((h) => slug(h[1]) === ancora)) {
      r.erro(`${f}: âncora #${ancora} não existe em ${alvo}`);
    }
  }
}

// 2 e 3. README por diretório e coerência com o conteúdo
for (const d of trackedDirs(files)) {
  if (LEGADO.has(d) || [...LEGADO].some((l) => d.startsWith(l + "/"))) continue;
  const readme = `${d}/README.md`;
  if (!fs.existsSync(readme)) { r.erro(`${d}/ sem README.md`); continue; }
  const real = new Set(
    files.filter((f) => path.posix.dirname(f) === d).map((f) => path.posix.basename(f))
      .concat(trackedDirs(files).filter((s) => path.posix.dirname(s) === d).map((s) => path.posix.basename(s))),
  );
  const txt = fs.readFileSync(readme, "utf8");
  const onde = (txt.split(/^## Onde\s*$/m)[1] ?? "").split(/^## /m)[0];
  const listados = new Set(
    [...onde.matchAll(/^\| \[[^\]]*\]\(([^)#]+)[^)]*\)/gm)].map((m) => m[1].replace(/\/README\.md$|\/$/, "")),
  );
  const campoArquivos = (txt.match(/^\| Arquivos \|(.*)$/m)?.[1] ?? "").replace(/[`/]/g, "");
  for (const item of real) {
    if (!listados.has(item)) r.erro(`${d}/${item} não listado em "## Onde" de ${readme}`);
    if (!campoArquivos.includes(item)) r.erro(`${d}/${item} ausente do campo "Arquivos" de ${readme}`);
  }
  for (const item of listados) if (!real.has(item)) r.erro(`${readme} lista ${item}, que não existe em ${d}/`);
}

// 4. nomes e sequência dos registros
const nums = new Map();
for (const f of files.filter((f) => path.posix.dirname(f) === "docs/verificacoes")) {
  const b = path.posix.basename(f);
  if (b === "README.md" || b === "_modelo-registro-de-correcao.md") continue;
  const m = b.match(/^\d{4}-\d{2}-\d{2}-(\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/);
  if (!m) { r.erro(`docs/verificacoes/${b}: nome fora do padrão AAAA-MM-DD-NNN-slug.md`); continue; }
  if (nums.has(m[1])) r.erro(`VER-${m[1]} duplicado: ${nums.get(m[1])} e ${b}`);
  nums.set(m[1], b);
}

r.fim(`${mds.length} arquivos .md, ${nums.size} registro(s)`);
