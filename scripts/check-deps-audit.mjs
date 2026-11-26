// check-deps-audit: dependências sem vulnerabilidade alta ou crítica (npm audit), com exceções explícitas.
// Uma exceção só vale para um aviso (GHSA) do pacote listado, sem gravidade maior que a aprovada, que:
// (1) não chega às dependências de produção, (2) não tem correção que não suba versão principal
// e (3) está dentro da data de revisão (UTC, inclusive). Tudo o mais que for alto ou crítico reprova,
// inclusive relatório inconsistente, pacote a pacote (falha fechada). Registro: VER-012.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reporter } from "./_lib.mjs";

/** Exceções aceitas: id GHSA, pacote, gravidade máxima aprovada, motivo e data de revisão (AAAA-MM-DD, UTC, inclusive). */
export const EXCECOES = [
  // Nenhuma exceção ativa: a do picomatch (GHSA-fc5q-39xc-vjpf, VER-012) foi removida no VER-022.
  // Formato de cada entrada (a ordem dos campos não importa):
  // {
  //   id: "GHSA-xxxx-xxxx-xxxx", pacote: "nome-do-pacote", severidade: "high",
  //   motivo: "por que o aviso não se aplica e o que o limita",
  //   revisarAte: "AAAA-MM-DD",
  // },
];

const PESO = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const grave = (s) => (PESO[s] ?? 0) >= PESO.high;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Argumentos do `npm audit` para cada relatório. `--include=dev` só no completo (vence `omit` vindo do ambiente);
 *  `--offline=false` nos dois (um `offline` no ambiente esvaziaria o relatório). */
export function argumentosAuditoria(tipo) {
  if (tipo === "todos") return ["audit", "--json", "--include=dev", "--offline=false"];
  if (tipo === "producao") return ["audit", "--json", "--omit=dev", "--offline=false"];
  throw new Error(`tipo de auditoria desconhecido: ${tipo}`);
}

/** Data de hoje em UTC, AAAA-MM-DD. */
export function hojeUtc(agora = new Date()) {
  return agora.toISOString().slice(0, 10);
}

/** `fixAvailable` do npm: true (corrige sem --force) ou objeto sem `isSemVerMajor` (exige --force, mas não sobe versão principal). */
const temCorrecaoSemVersaoPrincipal = (f) => f === true || (f !== null && typeof f === "object" && !f.isSemVerMajor);

/** Normaliza o id do aviso: GHSA da url (em minúsculas, prefixo GHSA) ou `npm-<source>`; null se não houver. */
function idDoAviso(via) {
  const m = String(via.url ?? "").match(/\/advisories\/(ghsa-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})\/?$/i);
  if (m) return "GHSA-" + m[1].slice(5).toLowerCase();
  return via.source != null && via.source !== "" ? `npm-${via.source}` : null;
}

/**
 * Avisos-raiz (objetos em `via`) de um relatório `npm audit --json`, agregados por id:
 * maior gravidade, pacotes em que aparece e se algum deles tem correção sem versão principal.
 * Erros de forma (aviso sem id, `via` que não é lista) vão para `erros`.
 */
export function avisosRaiz(relatorio, erros = []) {
  const avisos = new Map();
  for (const [pacote, v] of Object.entries(relatorio?.vulnerabilities ?? {})) {
    if (!Array.isArray(v?.via)) { erros.push(`relatório inconsistente: ${pacote} sem lista "via"`); continue; }
    for (const via of v.via) {
      if (typeof via !== "object" || !via) continue; // texto = pacote afetado por outro; o aviso-raiz está nele
      const id = idDoAviso(via);
      const severidade = via.severity ?? v.severity;
      if (!id) { erros.push(`relatório inconsistente: aviso sem identificação em ${pacote}`); continue; }
      const a = avisos.get(id) ?? { id, severidade: "info", pacotes: new Set(), titulo: via.title ?? "", correcao: false };
      if ((PESO[severidade] ?? 0) > (PESO[a.severidade] ?? 0)) a.severidade = severidade;
      if (via.name != null && via.name !== pacote) erros.push(`relatório inconsistente: aviso ${id} nomeado ${via.name} dentro de ${pacote}`);
      a.pacotes.add(pacote);
      // Só o pacote do aviso-raiz conta: pacotes afetados indiretamente (ex.: fdir com fixAvailable true)
      // podem ser atualizados sem que o pacote vulnerável mude.
      if (temCorrecaoSemVersaoPrincipal(v.fixAvailable)) a.correcao = true;
      avisos.set(id, a);
    }
  }
  return avisos;
}

/** Erros de consistência: relatório sem forma válida; citação de pacote ausente; pacote grave cuja
 *  gravidade não é alcançada pelos avisos-raiz dele ou dos pacotes que ele cita; metadata que não bate. */
function consistencia(nome, rel) {
  if (!rel || typeof rel !== "object" || Array.isArray(rel)) return [`npm audit (${nome}) não devolveu um relatório válido`];
  const motivo = rel.message || rel.error?.summary || rel.error?.detail;
  const vulns = rel.vulnerabilities;
  if (rel.error || rel.auditReportVersion !== 2 || !vulns || typeof vulns !== "object" || Array.isArray(vulns)) {
    return [`npm audit (${nome}) não devolveu um relatório válido${motivo ? `: ${String(motivo).trim().slice(0, 200)}` : ""}`];
  }
  const erros = [];
  const vias = (v) => (Array.isArray(v?.via) ? v.via : []);
  // Citações de pacote ausente: conferidas uma vez (só chaves próprias, não herdadas de Object.prototype).
  for (const [p, v] of Object.entries(vulns)) {
    for (const via of vias(v)) {
      if (typeof via === "string" && !Object.hasOwn(vulns, via)) erros.push(`npm audit (${nome}): relatório inconsistente (${p} cita ${via}, que não está no relatório)`);
    }
  }
  // O pacote precisa alcançar um aviso-raiz com a gravidade dele (nos próprios ou nos dos pacotes
  // citados, recursivamente). Para cada gravidade grave, parte dos pacotes com aviso-raiz dessa
  // gravidade (ou maior) e sobe pelas citações ao contrário: quem cita um pacote que alcança, alcança.
  // Tempo proporcional ao tamanho do relatório; ciclos e ordem dos pacotes não mudam o resultado.
  const citadoPor = new Map();
  for (const [p, v] of Object.entries(vulns)) {
    for (const via of vias(v)) {
      if (typeof via === "string" && Object.hasOwn(vulns, via)) (citadoPor.get(via) ?? citadoPor.set(via, []).get(via)).push(p);
    }
  }
  const alcancam = (limiar) => {
    const conj = new Set(Object.entries(vulns)
      .filter(([, v]) => vias(v).some((via) => typeof via === "object" && via && (PESO[via.severity ?? v.severity] ?? 0) >= limiar))
      .map(([p]) => p));
    const fila = [...conj];
    while (fila.length) for (const q of citadoPor.get(fila.pop()) ?? []) if (!conj.has(q)) { conj.add(q); fila.push(q); }
    return conj;
  };
  const porGravidade = { high: alcancam(PESO.high), critical: alcancam(PESO.critical) };
  for (const [p, v] of Object.entries(vulns)) {
    if (grave(v?.severity) && !porGravidade[v.severity].has(p)) {
      erros.push(`npm audit (${nome}): relatório inconsistente (${p} é ${v.severity}, mas seus avisos não explicam essa gravidade)`);
    }
  }
  // A contagem da metadata, quando existir, precisa bater com o número de pacotes de cada gravidade grave.
  const meta = rel.metadata?.vulnerabilities;
  if (meta && typeof meta === "object") {
    for (const g of ["high", "critical"]) {
      const n = Object.values(vulns).filter((v) => v?.severity === g).length;
      if (meta[g] != null && meta[g] !== n) erros.push(`npm audit (${nome}): relatório inconsistente (metadata diz ${meta[g]} ${g}, há ${n} pacote(s))`);
    }
  }
  return erros;
}

/**
 * Avalia os relatórios do `npm audit --json` (todas as dependências e só produção).
 * Devolve { erros, avisos } (listas de texto). `hoje` é obrigatório (AAAA-MM-DD, UTC).
 */
export function avaliarAuditoria({ todos, producao, excecoes = EXCECOES, hoje }) {
  if (!DATA.test(String(hoje))) throw new Error(`avaliarAuditoria: "hoje" precisa ser AAAA-MM-DD (recebido: ${hoje})`);
  const erros = [];
  const avisos = [];
  const raizTodos = avisosRaiz(todos, erros);
  const raizProd = avisosRaiz(producao, erros);
  erros.push(...consistencia("todas as dependências", todos), ...consistencia("produção", producao));
  for (const a of raizProd.values()) {
    const t = raizTodos.get(a.id);
    if (grave(a.severidade) && (!t || (PESO[t.severidade] ?? 0) < (PESO[a.severidade] ?? 0))) {
      erros.push(`${a.id}: no relatório de produção com gravidade ${a.severidade}, ausente ou menor no completo (relatório inconsistente)`);
    }
  }
  if (erros.length) return { erros, avisos };

  const usadas = new Set();
  for (const a of raizTodos.values()) {
    if (!grave(a.severidade)) continue;
    const pacotes = [...a.pacotes].join(", ");
    const desc = `${a.id} (${pacotes}, ${a.severidade})`;
    const ex = excecoes.find((e) => e.id.toLowerCase() === a.id.toLowerCase());
    if (!ex) { erros.push(`${desc}: ${a.titulo}`); continue; }
    usadas.add(ex.id);
    if (hoje > ex.revisarAte) erros.push(`${desc}: exceção vencida em ${ex.revisarAte}; revisar`);
    else if (!(a.pacotes.size === 1 && a.pacotes.has(ex.pacote))) erros.push(`${desc}: a exceção só cobre o pacote ${ex.pacote}`);
    else if ((PESO[a.severidade] ?? 0) > (PESO[ex.severidade] ?? PESO.high)) erros.push(`${desc}: gravidade acima da aprovada na exceção (${ex.severidade})`);
    else if (raizProd.has(a.id)) erros.push(`${desc}: chega às dependências de produção; a exceção não vale`);
    else if (a.correcao) erros.push(`${desc}: há correção que não sobe versão principal (npm audit fix, com ou sem --force); a exceção não vale`);
    else avisos.push(`${desc} em exceção até ${ex.revisarAte}: ${ex.motivo}`);
  }
  for (const e of excecoes) {
    if (!usadas.has(e.id)) avisos.push(`exceção ${e.id} sem uso (o aviso não aparece mais): remova-a de EXCECOES`);
  }
  return { erros, avisos };
}

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Roda o `npm audit` de um tipo e devolve o relatório (ou `{ message }` se a saída não for JSON).
 *  `spawn` e `env` são injetáveis para teste. Pelo `npm run`, `npm_execpath` aponta o npm em uso
 *  (funciona também no Windows, sem shell). */
export function auditar(tipo, { spawn = spawnSync, env = process.env } = {}) {
  const args = argumentosAuditoria(tipo);
  const opcoes = { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: RAIZ, timeout: 120_000 };
  const r = env.npm_execpath
    ? spawn(process.execPath, [env.npm_execpath, ...args], opcoes)
    : spawn("npm", args, { ...opcoes, shell: process.platform === "win32" });
  try { return JSON.parse(r.stdout); } catch { return { message: (r.stderr || r.error?.message || "saída não é JSON").trim().slice(0, 200) }; }
}

function executadoDiretamente() {
  try { return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}

/** Linha de comando: audita, imprime avisos e reporta os erros (exportada para teste com `auditar` e `relatar` simulados). */
export function principal({ auditarFn = auditar, hoje = hojeUtc(), excecoes = EXCECOES, relatar = reporter("check-deps-audit"), log = console.log } = {}) {
  const { erros, avisos } = avaliarAuditoria({ todos: auditarFn("todos"), producao: auditarFn("producao"), excecoes, hoje });
  for (const a of avisos) log(`AVISO [check-deps-audit] ${a}`);
  for (const e of erros) relatar.erro(e);
  relatar.fim(`${avisos.length} aviso(s)`);
}

if (process.argv[1] && executadoDiretamente()) principal();
