import { describe, test, expect, vi, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { avaliarAuditoria, avisosRaiz, argumentosAuditoria, auditar, hojeUtc, principal, EXCECOES, RAIZ } from "../check-deps-audit.mjs";

const VAZIO = { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { high: 0, critical: 0 } } };

/** Relatório no formato do `npm audit --json`: um aviso-raiz em `pacote` e um pacote afetado por ele. */
function relatorio({ id = "GHSA-aaaa-bbbb-cccc", pacote = "pkg", severidade = "high", fixAvailable = false, fixAfetado = false } = {}) {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      [pacote]: {
        name: pacote,
        severity: severidade,
        via: [{ source: 1, name: pacote, title: "falha de teste", url: `https://github.com/advisories/${id}`, severity: severidade, range: "<=1.0.0" }],
        fixAvailable,
      },
      afetado: { name: "afetado", severity: severidade, via: [pacote], fixAvailable: fixAfetado },
    },
    metadata: { vulnerabilities: { high: severidade === "high" ? 2 : 0, critical: severidade === "critical" ? 2 : 0 } },
  };
}

/** Recalcula a metadata (contagem por gravidade) depois de mexer nos pacotes do relatório. */
function recontar(r) {
  const c = { high: 0, critical: 0 }
  for (const v of Object.values(r.vulnerabilities)) if (v.severity in c) c[v.severity]++
  r.metadata = { vulnerabilities: c }
  return r
}

const EX = [{ id: "GHSA-aaaa-bbbb-cccc", pacote: "pkg", severidade: "high", motivo: "teste", revisarAte: "2026-12-17" }];
const HOJE = "2026-11-18";
const avaliar = (todos, extra = {}) => avaliarAuditoria({ todos, producao: VAZIO, excecoes: EX, hoje: HOJE, ...extra });

describe("avaliarAuditoria: avisos fora da lista", () => {
  test("sem vulnerabilidades e sem exceções: nenhum erro nem aviso", () => {
    expect(avaliarAuditoria({ todos: VAZIO, producao: VAZIO, excecoes: [], hoje: HOJE })).toEqual({ erros: [], avisos: [] })
  })
  test("aviso alto fora da lista reprova, com id, pacote e título", () => {
    expect(avaliar(relatorio(), { excecoes: [] }).erros).toEqual(["GHSA-aaaa-bbbb-cccc (pkg, high): falha de teste"])
  })
  test("aviso crítico fora da lista reprova", () => {
    expect(avaliar(relatorio({ severidade: "critical" }), { excecoes: [] }).erros).toEqual(["GHSA-aaaa-bbbb-cccc (pkg, critical): falha de teste"])
  })
  test("aviso moderado é ignorado (mesmo nível do antigo --audit-level=high)", () => {
    expect(avaliar(relatorio({ severidade: "moderate" }), { excecoes: [] }).erros).toEqual([])
  })
  test("id por source numérico (sem url GHSA) reprova como npm-<source>", () => {
    const r = relatorio(); delete r.vulnerabilities.pkg.via[0].url
    expect(avaliar(r, { excecoes: [] }).erros).toEqual(["npm-1 (pkg, high): falha de teste"])
  })
})

describe("avaliarAuditoria: exceções", () => {
  test("exceção válida (só desenvolvimento, sem correção, no prazo) vira aviso", () => {
    expect(avaliar(relatorio())).toEqual({ erros: [], avisos: ["GHSA-aaaa-bbbb-cccc (pkg, high) em exceção até 2026-12-17: teste"] })
  })
  test("id comparado sem diferenciar maiúsculas e normalizado na mensagem (url em maiúsculas)", () => {
    expect(avaliar(relatorio({ id: "GHSA-AAAA-BBBB-CCCC" }))).toEqual({ erros: [], avisos: ["GHSA-aaaa-bbbb-cccc (pkg, high) em exceção até 2026-12-17: teste"] })
  })
  test("no último dia do prazo a exceção ainda vale; no dia seguinte reprova", () => {
    expect(avaliar(relatorio(), { hoje: "2026-12-17" }).erros).toEqual([])
    expect(avaliar(relatorio(), { hoje: "2026-12-18" }).erros).toEqual(["GHSA-aaaa-bbbb-cccc (pkg, high): exceção vencida em 2026-12-17; revisar"])
  })
  test("aviso que chega à produção reprova mesmo com exceção", () => {
    expect(avaliar(relatorio(), { producao: relatorio() }).erros)
      .toEqual(["GHSA-aaaa-bbbb-cccc (pkg, high): chega às dependências de produção; a exceção não vale"])
  })
  test("correção sem --force (fixAvailable true) reprova mesmo com exceção", () => {
    expect(avaliar(relatorio({ fixAvailable: true })).erros)
      .toEqual(["GHSA-aaaa-bbbb-cccc (pkg, high): há correção que não sobe versão principal (npm audit fix, com ou sem --force); a exceção não vale"])
  })
  test("correção com --force sem subir versão principal (objeto sem isSemVerMajor) reprova", () => {
    expect(avaliar(relatorio({ fixAvailable: { name: "pkg", version: "1.0.1" } })).erros).toHaveLength(1)
  })
  test("correção só subindo versão principal (isSemVerMajor) não derruba a exceção", () => {
    expect(avaliar(relatorio({ fixAvailable: { name: "outro", version: "1.0.0", isSemVerMajor: true } })).erros).toEqual([])
  })
  test("pacote afetado indiretamente com fixAvailable true não derruba a exceção (só o pacote do aviso conta)", () => {
    expect(avaliar(relatorio({ fixAfetado: true })).erros).toEqual([])
  })
  test("o id da exceção no pacote certo e também em outro pacote não é coberto", () => {
    const r = relatorio()
    r.vulnerabilities.outro = { name: "outro", severity: "high", fixAvailable: false,
      via: [{ source: 1, name: "outro", title: "falha de teste", url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", severity: "high" }] }
    expect(avaliar(recontar(r)).erros).toEqual(["GHSA-aaaa-bbbb-cccc (pkg, outro, high): a exceção só cobre o pacote pkg"])
  })
  test("url de aviso com algo depois do id não é aceita como GHSA (âncora no fim; cai no source)", () => {
    const r = relatorio(); r.vulnerabilities.pkg.via[0].url = "https://github.com/advisories/GHSA-aaaa-bbbb-cccc/outra"
    expect(avaliar(r).erros).toEqual(["npm-1 (pkg, high): falha de teste"])
  })
  test("url sem /advisories/ antes do id não é aceita como GHSA (cai no source)", () => {
    const r = relatorio(); r.vulnerabilities.pkg.via[0].url = "https://exemplo.com/GHSA-aaaa-bbbb-cccc"
    expect(avaliar(r).erros).toEqual(["npm-1 (pkg, high): falha de teste"])
  })
  test("o mesmo id em outro pacote não é coberto", () => {
    expect(avaliar(relatorio({ pacote: "lodash" })).erros).toEqual(["GHSA-aaaa-bbbb-cccc (lodash, high): a exceção só cobre o pacote pkg"])
  })
  test("gravidade acima da aprovada (crítico) não é coberta", () => {
    expect(avaliar(relatorio({ severidade: "critical" })).erros).toEqual(["GHSA-aaaa-bbbb-cccc (pkg, critical): gravidade acima da aprovada na exceção (high)"])
  })
  test("exceção para outro id não cobre o aviso; a exceção sem uso vira aviso", () => {
    const r = avaliar(relatorio(), { excecoes: [{ ...EX[0], id: "GHSA-zzzz-zzzz-zzzz" }] })
    expect(r.erros).toEqual(["GHSA-aaaa-bbbb-cccc (pkg, high): falha de teste"])
    expect(r.avisos).toEqual(["exceção GHSA-zzzz-zzzz-zzzz sem uso (o aviso não aparece mais): remova-a de EXCECOES"])
  })
  test("exceção sem uso vira aviso, não erro", () => {
    expect(avaliar(VAZIO)).toEqual({ erros: [], avisos: ["exceção GHSA-aaaa-bbbb-cccc sem uso (o aviso não aparece mais): remova-a de EXCECOES"] })
  })
})

describe("avaliarAuditoria: falha fechada", () => {
  test("relatório inválido ou com erro (ex.: sem rede) reprova, com o motivo do npm", () => {
    expect(avaliar({ error: { summary: "" }, message: "request to registry failed" }).erros)
      .toEqual(["npm audit (todas as dependências) não devolveu um relatório válido: request to registry failed"])
    expect(avaliar(VAZIO, { producao: undefined }).erros).toEqual(["npm audit (produção) não devolveu um relatório válido"])
    expect(avaliar({ vulnerabilities: [] }).erros).toEqual(["npm audit (todas as dependências) não devolveu um relatório válido"])
  })
  test("aviso-raiz sem severity herda a gravidade do pacote", () => {
    const r = relatorio(); delete r.vulnerabilities.pkg.via[0].severity
    expect(avaliar(r, { excecoes: [] }).erros).toEqual(["GHSA-aaaa-bbbb-cccc (pkg, high): falha de teste"])
  })
  test("pacote grave que cita pacote ausente reprova", () => {
    const r = { auditReportVersion: 2, vulnerabilities: { x: { name: "x", severity: "high", via: ["y"], fixAvailable: false } }, metadata: {} }
    expect(avaliar(r).erros).toEqual([
      "npm audit (todas as dependências): relatório inconsistente (x cita y, que não está no relatório)",
      "npm audit (todas as dependências): relatório inconsistente (x é high, mas seus avisos não explicam essa gravidade)",
    ])
  })
  test("metadata que não bate com os pacotes de cada gravidade reprova", () => {
    expect(avaliar({ ...VAZIO, metadata: { vulnerabilities: { high: 3, critical: 0 } } }).erros)
      .toEqual(["npm audit (todas as dependências): relatório inconsistente (metadata diz 3 high, há 0 pacote(s))"])
    expect(avaliar({ ...relatorio(), metadata: { vulnerabilities: { high: 2, critical: 1 } } }).erros)
      .toEqual(["npm audit (todas as dependências): relatório inconsistente (metadata diz 1 critical, há 0 pacote(s))"])
    expect(avaliar({ ...relatorio(), metadata: { vulnerabilities: { high: 1, critical: 0 } } }).erros)
      .toEqual(["npm audit (todas as dependências): relatório inconsistente (metadata diz 1 high, há 2 pacote(s))"])
  })
  test("citação de nome herdado de Object.prototype conta como pacote ausente", () => {
    const r = relatorio(); r.vulnerabilities.afetado.via = ["pkg", "constructor"]
    expect(avaliar(r).erros).toEqual(["npm audit (todas as dependências): relatório inconsistente (afetado cita constructor, que não está no relatório)"])
  })
  test("a gravidade do aviso-raiz vem do próprio aviso antes da do pacote", () => {
    const r = relatorio(); r.vulnerabilities.pkg.via[0].severity = "critical"
    expect(avaliar(r).erros).toEqual(["GHSA-aaaa-bbbb-cccc (pkg, critical): gravidade acima da aprovada na exceção (high)"])
  })
  test("com a exceção ativa, outro pacote crítico citando pacote ausente reprova (consistência por pacote)", () => {
    const r = relatorio()
    r.vulnerabilities.lodash = { name: "lodash", severity: "critical", via: ["nao-existe"], fixAvailable: false }
    expect(avaliar(r).erros).toContain("npm audit (todas as dependências): relatório inconsistente (lodash cita nao-existe, que não está no relatório)")
  })
  test("com a exceção ativa, pacote crítico cujo único aviso é moderado reprova", () => {
    const r = relatorio()
    r.vulnerabilities.lodash = { name: "lodash", severity: "critical", fixAvailable: false,
      via: [{ source: 9, name: "lodash", title: "outra", url: "https://github.com/advisories/GHSA-dddd-eeee-ffff", severity: "moderate" }] }
    expect(avaliar(recontar(r)).erros).toEqual(["npm audit (todas as dependências): relatório inconsistente (lodash é critical, mas seus avisos não explicam essa gravidade)"])
  })
  test("pacote crítico cujos avisos alcançáveis são só altos reprova", () => {
    const r = relatorio(); r.vulnerabilities.afetado.severity = "critical"
    expect(avaliar(recontar(r)).erros).toEqual(["npm audit (todas as dependências): relatório inconsistente (afetado é critical, mas seus avisos não explicam essa gravidade)"])
  })
  test("pacote afetado explicado por outro pacote (via em texto) não é inconsistência", () => {
    expect(avaliar(relatorio()).erros).toEqual([])
  })
  test.each([
    ["a antes de b", ["a", "b"]],
    ["b antes de a", ["b", "a"]],
  ])("ciclo entre pacotes afetados com a raiz alcançável aprova, qualquer que seja a ordem (%s)", (_, ordem) => {
    const r = relatorio()
    const ciclo = { a: { name: "a", severity: "high", via: ["pkg", "b"], fixAvailable: false }, b: { name: "b", severity: "high", via: ["a"], fixAvailable: false } }
    for (const k of ordem) r.vulnerabilities[k] = ciclo[k]
    expect(avaliar(recontar(r)).erros).toEqual([])
  })
  test("pacote que cita a si mesmo e a raiz aprova", () => {
    const r = relatorio(); r.vulnerabilities.a = { name: "a", severity: "high", via: ["a", "pkg"], fixAvailable: false }
    expect(avaliar(recontar(r)).erros).toEqual([])
  })
  test("ciclo sem nenhum aviso-raiz reprova", () => {
    const r = { ...VAZIO, vulnerabilities: { a: { name: "a", severity: "high", via: ["b"], fixAvailable: false }, b: { name: "b", severity: "high", via: ["a"], fixAvailable: false } } }
    expect(avaliar(recontar(r)).erros).toEqual([
      "npm audit (todas as dependências): relatório inconsistente (a é high, mas seus avisos não explicam essa gravidade)",
      "npm audit (todas as dependências): relatório inconsistente (b é high, mas seus avisos não explicam essa gravidade)",
    ])
  })
  test("aviso nomeado com outro pacote dentro de um pacote reprova (não aplica a exceção)", () => {
    const r = relatorio({ pacote: "vite" }); r.vulnerabilities.vite.via[0].name = "pkg"
    expect(avaliar(r).erros).toContain("relatório inconsistente: aviso GHSA-aaaa-bbbb-cccc nomeado pkg dentro de vite")
  })
  test("relatório com error junto de vulnerabilities, ou com outra versão de formato, reprova", () => {
    expect(avaliar({ ...relatorio(), error: { summary: "falhou" } }).erros)
      .toEqual(["npm audit (todas as dependências) não devolveu um relatório válido: falhou"])
    expect(avaliar({ ...relatorio(), auditReportVersion: 3 }).erros)
      .toEqual(["npm audit (todas as dependências) não devolveu um relatório válido"])
  })
  test("aviso grave que aparece só no relatório de produção reprova", () => {
    expect(avaliar(VAZIO, { producao: relatorio({ id: "GHSA-pppp-qqqq-rrrr" }), excecoes: [] }).erros)
      .toEqual(["GHSA-pppp-qqqq-rrrr: no relatório de produção com gravidade high, ausente ou menor no completo (relatório inconsistente)"])
  })
  test("aviso com gravidade maior na produção que no completo reprova", () => {
    expect(avaliar(relatorio({ severidade: "moderate" }), { producao: relatorio(), excecoes: [] }).erros)
      .toEqual(["GHSA-aaaa-bbbb-cccc: no relatório de produção com gravidade high, ausente ou menor no completo (relatório inconsistente)"])
  })
  test("via que não é lista reprova", () => {
    const r = relatorio(); r.vulnerabilities.pkg.via = "pkg"
    expect(avaliar(r).erros).toContain("relatório inconsistente: pkg sem lista \"via\"")
  })
  test("aviso sem url nem source reprova", () => {
    const r = relatorio(); delete r.vulnerabilities.pkg.via[0].url; delete r.vulnerabilities.pkg.via[0].source
    expect(avaliar(r).erros).toContain("relatório inconsistente: aviso sem identificação em pkg")
  })
  test("hoje ausente ou fora do formato lança erro (não deixa a exceção sem prazo)", () => {
    expect(() => avaliarAuditoria({ todos: VAZIO, producao: VAZIO })).toThrow(/AAAA-MM-DD/)
    expect(() => avaliarAuditoria({ todos: VAZIO, producao: VAZIO, hoje: "18/11/2026" })).toThrow(/AAAA-MM-DD/)
  })
})

describe("avisosRaiz", () => {
  test("pacotes afetados indiretamente (via em texto) não viram avisos próprios", () => {
    expect([...avisosRaiz(relatorio()).keys()]).toEqual(["GHSA-aaaa-bbbb-cccc"])
  })
  test("o mesmo aviso em dois pacotes é agregado (maior gravidade, os dois pacotes, correção de qualquer um)", () => {
    const r = relatorio()
    r.vulnerabilities.outro = { name: "outro", severity: "critical", fixAvailable: true,
      via: [{ source: 1, name: "outro", title: "falha de teste", url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", severity: "critical" }] }
    const a = avisosRaiz(r).get("GHSA-aaaa-bbbb-cccc")
    expect([a.severidade, [...a.pacotes].sort(), a.correcao]).toEqual(["critical", ["outro", "pkg"], true])
  })
})

describe("linha de comando", () => {
  test("relatório completo inclui dev e desliga offline; produção omite dev", () => {
    expect(argumentosAuditoria("todos")).toEqual(["audit", "--json", "--include=dev", "--offline=false"])
    expect(argumentosAuditoria("producao")).toEqual(["audit", "--json", "--omit=dev", "--offline=false"])
  })
  test("hojeUtc devolve a data em UTC, qualquer que seja o fuso da máquina", () => {
    const tz = process.env.TZ
    process.env.TZ = "America/Sao_Paulo"
    try { expect(hojeUtc(new Date("2026-12-17T23:30:00-03:00"))).toBe("2026-12-18") }
    finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz }
  })
  test("auditar chama o npm do npm_execpath com os argumentos de cada tipo, na raiz do repositório", () => {
    const chamadas = []
    const spawn = (cmd, args, op) => { chamadas.push({ cmd, args, cwd: op.cwd, shell: op.shell, timeout: op.timeout, maxBuffer: op.maxBuffer }); return { stdout: JSON.stringify(VAZIO) } }
    for (const tipo of ["todos", "producao"]) expect(auditar(tipo, { spawn, env: { npm_execpath: "/x/npm-cli.js" } })).toEqual(VAZIO)
    expect(chamadas).toEqual([
      { cmd: process.execPath, args: ["/x/npm-cli.js", ...argumentosAuditoria("todos")], cwd: RAIZ, shell: undefined, timeout: 120000, maxBuffer: 64 * 1024 * 1024 },
      { cmd: process.execPath, args: ["/x/npm-cli.js", ...argumentosAuditoria("producao")], cwd: RAIZ, shell: undefined, timeout: 120000, maxBuffer: 64 * 1024 * 1024 },
    ])
  })
  test("auditar sem npm_execpath chama npm direto com os mesmos argumentos", () => {
    let chamada
    auditar("producao", { spawn: (cmd, args, op) => { chamada = { cmd, args, cwd: op.cwd, shell: op.shell, timeout: op.timeout }; return { stdout: "{}" } }, env: {} })
    expect(chamada).toEqual({ cmd: "npm", args: argumentosAuditoria("producao"), cwd: RAIZ, shell: process.platform === "win32", timeout: 120000 })
  })
  test("auditar com saída não-JSON ou vazia devolve o motivo, e a avaliação reprova", () => {
    const lixo = auditar("todos", { spawn: () => ({ stdout: "lixo", stderr: "npm ERR! sem rede" }), env: {} })
    expect(lixo).toEqual({ message: "npm ERR! sem rede" })
    expect(auditar("todos", { spawn: () => ({ stdout: "" }), env: {} })).toEqual({ message: "saída não é JSON" })
    expect(avaliar(lixo).erros).toEqual(["npm audit (todas as dependências) não devolveu um relatório válido: npm ERR! sem rede"])
  })
  test("principal audita os dois relatórios, imprime avisos e reporta erros", () => {
    const chamados = []; const erros = []; const logs = []; let resumo
    const relatar = { erro: (m) => erros.push(m), fim: (r) => { resumo = r } }
    principal({ auditarFn: (t) => { chamados.push(t); return t === "todos" ? relatorio() : VAZIO },
      hoje: "2026-12-18", excecoes: EX, relatar, log: (m) => logs.push(m) })
    expect(chamados).toEqual(["todos", "producao"])
    expect(erros).toEqual(["GHSA-aaaa-bbbb-cccc (pkg, high): exceção vencida em 2026-12-17; revisar"])
    expect(resumo).toBe("0 aviso(s)")
  })
  test("principal imprime o aviso da exceção válida sem reprovar", () => {
    const logs = []; const relatar = { erro: () => { throw new Error("não devia reprovar") }, fim: () => {} }
    principal({ auditarFn: (t) => (t === "todos" ? relatorio() : VAZIO),
      hoje: "2026-11-18", excecoes: EX, relatar, log: (m) => logs.push(m) })
    expect(logs).toEqual([expect.stringMatching(/^AVISO \[check-deps-audit\] GHSA-aaaa-bbbb-cccc \(pkg, high\) em exceção até 2026-12-17/)])
  })
})

describe("linha de comando de ponta a ponta", () => {
  afterEach(() => { vi.useRealTimers() })

  test("principal sem hoje usa a data atual (UTC): depois do prazo, a exceção vence", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-12-18T00:30:00Z"))
    const erros = []
    principal({ auditarFn: (t) => (t === "todos" ? relatorio() : VAZIO), excecoes: EX,
      relatar: { erro: (m) => erros.push(m), fim: () => {} }, log: () => {} })
    expect(erros).toEqual(["GHSA-aaaa-bbbb-cccc (pkg, high): exceção vencida em 2026-12-17; revisar"])
  })

  test("executado direto (e por link simbólico) com um npm falso que acusa um crítico novo: imprime ERRO e sai com código 1", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npm-falso-"))
    try {
      const falso = path.join(dir, "npm-falso.mjs")
      const critico = { auditReportVersion: 2, metadata: { vulnerabilities: { high: 0, critical: 1 } }, vulnerabilities: { lodash: { name: "lodash", severity: "critical", fixAvailable: false,
        via: [{ source: 7, name: "lodash", title: "crítico novo", url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz", severity: "critical" }] } } }
      const vazio = { auditReportVersion: 2, metadata: { vulnerabilities: { high: 0, critical: 0 } }, vulnerabilities: {} }
      fs.writeFileSync(falso, `const prod = process.argv.includes("--omit=dev"); process.stdout.write(JSON.stringify(prod ? ${JSON.stringify(vazio)} : ${JSON.stringify(critico)})); process.exit(1)`)
      const script = path.join(RAIZ, "scripts", "check-deps-audit.mjs")
      const caminhos = [script]
      // Chamado por um link simbólico, a guarda (realpathSync) ainda reconhece o script (fora do Windows).
      if (process.platform !== "win32") { const link = path.join(dir, "link.mjs"); fs.symlinkSync(script, link); caminhos.push(link) }
      for (const c of caminhos) {
        const r = spawnSync(process.execPath, [c], { encoding: "utf8", env: { ...process.env, npm_execpath: falso } })
        expect(r.status, c).toBe(1)
        expect(r.stderr).toContain("ERRO [check-deps-audit] GHSA-xxxx-yyyy-zzzz (lodash, critical): crítico novo")
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})

describe("EXCECOES", () => {
  test("lista vazia (nenhuma exceção ativa): relatório vazio passa sem erro nem aviso, e aviso alto reprova", () => {
    expect(Array.isArray(EXCECOES)).toBe(true)
    const vazia = (todos) => { const erros = []; const logs = []; principal({ auditarFn: (t) => (t === "todos" ? todos : VAZIO), hoje: "2026-11-26", excecoes: [],
      relatar: { erro: (m) => erros.push(m), fim: () => {} }, log: (m) => logs.push(m) }); return { erros, logs } }
    expect(vazia(VAZIO)).toEqual({ erros: [], logs: [] })
    expect(avaliarAuditoria({ todos: VAZIO, producao: VAZIO, hoje: HOJE, excecoes: undefined }).avisos.length).toBe(EXCECOES.length)
    expect(vazia(relatorio()).erros).toEqual(["GHSA-aaaa-bbbb-cccc (pkg, high): falha de teste"])
  })
  test("toda exceção tem id GHSA, pacote, gravidade, motivo e data válida a no máximo 90 dias de hoje", () => {
    for (const e of EXCECOES) {
      expect(e.id).toMatch(/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/)
      expect(e.pacote).toBeTruthy()
      expect(["high", "critical"]).toContain(e.severidade)
      expect(e.motivo.length).toBeGreaterThan(10)
      expect(e.revisarAte).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const d = new Date(`${e.revisarAte}T00:00:00Z`)
      expect(d.toISOString().slice(0, 10)).toBe(e.revisarAte)
      expect(d.getTime() - new Date(`${hojeUtc()}T00:00:00Z`).getTime()).toBeLessThanOrEqual(90 * 864e5)
    }
  })
})
