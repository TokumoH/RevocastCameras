// check-rpc-grants: aplica as migrações num PGlite com a simulação do Supabase (scripts/_catalogo.mjs) e
// confere, no catálogo real, as regras de função do DES-001 (seções 8 e 13): SECURITY DEFINER, search_path
// vazio, nenhum EXECUTE de PUBLIC, anon e service_role, EXECUTE de authenticated e chamada de public.papel_atual() ou
// public.dispositivo_atual() no corpo. Exceção (correção 17b, revisão 15, I1): a função de gatilho ligada a uma
// relação criada pelas migrações não pode ser SECURITY DEFINER (gravaria como o dono, por fora da RLS da outra
// tabela, e a política da relação não contém o gatilho); a ligada só a relação pré-existente (auth.users, onde só o
// Auth insere) continua SECURITY DEFINER. Vale o estado final, depois de todas as migrações.
import { analisarMigracoes, executadoDiretamente, executar } from "./_catalogo.mjs";

/** Funções (de public, sem sobrecarga) que não conferem papel (DES-001, seção 8). */
export const SEM_CHAMADA_DE_PAPEL = ["papel_atual", "dispositivo_atual", "criar_perfil_membro", "parear_dispositivo"];

/** Funções que contam como "conferir o papel" quando chamadas no corpo. */
export const CHAMADAS_DE_PAPEL = ["public.papel_atual", "public.dispositivo_atual"];

/** Lista de erros (vazia = ok) das regras de função; recebe o texto SQL ou a lista [{ arquivo, sql }] das migrações. */
export async function verificarGrants(migracoes) {
  const { erro, catalogo } = await analisarMigracoes(migracoes);
  return erro ? [erro] : regrasDeFuncao(catalogo);
}

/** Regras de função sobre o catálogo devolvido por analisarMigracoes(). */
export function regrasDeFuncao(c) {
  const erros = [];
  const funcoes = c.funcoes.filter((f) => f.tipo === "f" || f.tipo === "p");
  if (funcoes.length === 0) erros.push("nenhuma função criada pelas migrações: a checagem não conferiu nada");

  for (const f of c.funcoes.filter((f) => f.tipo !== "f" && f.tipo !== "p")) {
    erros.push(`${id(f)}: ${f.tipo === "a" ? "agregado" : "função de janela"} criado pelas migrações: forma não suportada`);
  }
  const novas = new Set(c.relacoes.map((r) => String(r.oid)));
  for (const f of funcoes) {
    const fn = id(f);
    if (f.schema !== "public") erros.push(`${fn}: fora do schema public (o DES-001 põe tudo em public)`);
    if (f.dono !== c.donoDasMigracoes) erros.push(`${fn}: dono é ${f.dono} (só ${c.donoDasMigracoes}, o papel que aplica as migrações)`);

    // SECURITY DEFINER com search_path vazio, e nenhum outro SET (mudaria como o corpo é lido ou executado).
    // Gatilhos da função em relações criadas pelas migrações (as da Data API); os de relação pré-existente ficam de fora.
    const emNovas = [...new Set(f.gatilhos.filter((g) => novas.has(String(g.relacao))).map((g) => g.rotulo))];
    if (emNovas.length && f.definer) {
      erros.push(`${fn}: função de gatilho SECURITY DEFINER em ${emNovas.join(", ")}: forma não suportada (grava como o dono, por fora da RLS; use SECURITY INVOKER)`);
    }
    if (!f.definer && !emNovas.length) erros.push(`${fn}: sem SECURITY DEFINER`);
    const caminhos = f.config.filter((s) => s.startsWith("search_path="));
    if (caminhos.length === 0) erros.push(f.definer ? `${fn}: SECURITY DEFINER sem set search_path` : `${fn}: sem set search_path`);
    else if (caminhos.some((s) => s !== 'search_path=""')) erros.push(`${fn}: set search_path deve ser vazio ('')`);
    for (const s of f.config.filter((s) => !s.startsWith("search_path="))) {
      erros.push(`${fn}: set ${s.split("=")[0]} além do search_path: forma não suportada`);
    }

    // Privilégios reais (has_function_privilege considera PUBLIC, a ACL nula padrão e os papéis herdados).
    if (f.acl.some((a) => a.papel === "PUBLIC" && a.privilegio === "EXECUTE")) erros.push(`${fn}: PUBLIC com EXECUTE (falta revoke execute ... from public)`);
    if (f.anon_executa) erros.push(`${fn}: anon com EXECUTE (falta revoke execute ... from anon)`);
    // service_role (BYPASSRLS na simulação e no Supabase): como anon, sem EXECUTE (DES-001: EXECUTE só para authenticated).
    if (f.service_role_executa) erros.push(`${fn}: service_role com EXECUTE (falta revoke execute ... from service_role)`);
    if (!f.authenticated_executa) erros.push(`${fn}: authenticated sem EXECUTE (falta grant execute ... to authenticated)`);
    for (const a of f.acl) {
      if (a.papel === f.dono || a.papel === "PUBLIC") continue;
      if (a.papel !== "authenticated") erros.push(`${fn}: EXECUTE concedido a ${a.papel} (só authenticated é permitido)`);
      if (a.repassa) erros.push(`${fn}: ${a.papel} com grant option (pode repassar o EXECUTE)`);
    }

    // Conferência do papel do app no corpo real (prosrc, ou o corpo begin atomic desparseado pelo Postgres).
    const isenta = f.schema === "public" && SEM_CHAMADA_DE_PAPEL.includes(f.nome);
    if (isenta && f.homonimas > 1) erros.push(`${fn}: sobrecarga de função isenta da chamada de papel: forma não suportada`);
    if (!isenta && !chamaPapel(f)) erros.push(`${fn}: corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()`);
  }

  // Um tipo ou relação chamado public.papel_atual (ou dispositivo_atual) faria `insert into public.papel_atual (...)`
  // ou o cast `public.papel_atual('x')` parecer a chamada da função no texto do corpo.
  for (const t of c.tiposNovos.filter((t) => CHAMADAS_DE_PAPEL.includes(`${t.schema}.${t.nome}`))) {
    erros.push(`${t.rotulo}: tipo ou relação com o nome de uma função de papel (no corpo, pareceria a chamada): forma não suportada`);
  }
  for (const o of c.funcoesPreexistentes) erros.push(`${o.rotulo}: função pré-existente (Postgres ou simulação do Supabase): ${o.mudanca} pelas migrações: forma não suportada`);
  // Privilégios padrão de função: nenhum papel além de authenticated ganha EXECUTE nas funções criadas depois.
  for (const a of c.aclPadrao.filter((a) => a.tipo === "f")) {
    for (const [papel, privs] of a.ganhos) {
      if (papel !== c.papeisDoSupabase.authenticated && privs.includes("EXECUTE")) erros.push(`${a.rotulo}: EXECUTE para ${c.nomeDoPapel(papel)} nas funções criadas depois (só authenticated é permitido)`);
    }
  }
  return erros;
}

/** Rótulo da função na mensagem: `schema.nome`, com os argumentos quando há outra de mesmo nome. */
const id = (f) => (f.homonimas > 1 ? `${f.rotulo}(${f.args})` : f.rotulo);

/**
 * O corpo chama public.papel_atual() ou public.dispositivo_atual()? Em begin atomic, o corpo vem desparseado pelo
 * Postgres (pg_get_function_sqlbody), com as funções de public qualificadas; as dependências (pg_depend) não servem,
 * porque incluem os valores padrão dos parâmetros e as constantes regproc, que não são chamadas no corpo.
 */
function chamaPapel(f) {
  if (f.linguagem !== "sql" && f.linguagem !== "plpgsql") return false;
  return /(?<![\w$.\u0080-\uffff"])public\s*\.\s*(?:papel_atual|dispositivo_atual)\s*\(/.test(codigoDoCorpo(f.corpo));
}

/**
 * Código de um corpo SQL ou PL/pgSQL sem comentários e sem o conteúdo de textos: comentários (`--` até a
 * quebra de linha `\n` ou `\r`; `/* *\/`, aninhados) e textos (`'...'`, `E'...'` com escapes, `$tag$...$tag$`,
 * inclusive com letras não-ASCII na tag) viram espaço; identificador entre aspas vira o próprio nome se for
 * simples em minúsculas, ou `"?"`; o resto vai para minúsculas. Na dúvida (texto sem fim), o resto é descartado,
 * o que só pode fazer a regra acusar a mais. É a única leitura estática que sobrou: o Postgres não registra
 * as chamadas de um corpo em texto; o de `begin atomic` passa por aqui já desparseado pelo próprio Postgres.
 */
export function codigoDoCorpo(src) {
  const letra = (ch) => ch !== undefined && /[A-Za-z_\u0080-￿]/.test(ch);
  const deIdent = (ch) => ch !== undefined && /[A-Za-z0-9_$\u0080-￿]/.test(ch);
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (letra(c)) {
      let j = i + 1;
      while (j < n && deIdent(src[j])) j++;
      const palavra = src.slice(i, j);
      if (src[j] === "'" && /^[eE]$/.test(palavra)) { i = fimDoTexto(src, j, true); out += " "; continue; } // E'...' (B'', X'', N'' são textos comuns: seguem abaixo)
      if (src[j] === "&" && /^[uU]$/.test(palavra) && (src[j + 1] === "'" || src[j + 1] === '"')) { // U&'...' e U&"..."
        i = src[j + 1] === "'" ? fimDoTexto(src, j + 1, false) : fimDoIdent(src, j + 1).fim;
        out += src[j + 1] === "'" ? " " : ' "?" ';
        continue;
      }
      out += palavra.toLowerCase();
      i = j;
      continue;
    }
    if (c === "-" && d === "-") {
      let j = i + 2;
      while (j < n && src[j] !== "\n" && src[j] !== "\r") j++;
      i = j;
      out += " ";
      continue;
    }
    if (c === "/" && d === "*") {
      let prof = 1;
      let j = i + 2;
      while (j < n && prof > 0) {
        if (src[j] === "/" && src[j + 1] === "*") { prof++; j += 2; }
        else if (src[j] === "*" && src[j + 1] === "/") { prof--; j += 2; }
        else j++;
      }
      i = j;
      out += " ";
      continue;
    }
    if (c === "'") { i = fimDoTexto(src, i, false); out += " "; continue; }
    if (c === '"') {
      const { fim, nome } = fimDoIdent(src, i);
      i = fim;
      out += /^[a-z_][a-z0-9_$]*$/.test(nome) ? nome : ' "?" ';
      continue;
    }
    if (c === "$") {
      const m = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(src.slice(i, i + 200));
      if (m) {
        const fim = src.indexOf(m[0], i + m[0].length);
        i = fim < 0 ? n : fim + m[0].length;
        out += " ";
        continue;
      }
    }
    out += c.toLowerCase();
    i++;
  }
  return out;
}

/** Índice logo depois do `'` que fecha o texto aberto em src[ini] (`''` é aspa dentro; com escape, `\x` também). */
function fimDoTexto(src, ini, comEscape) {
  let j = ini + 1;
  while (j < src.length) {
    if (comEscape && src[j] === "\\") { j += 2; continue; }
    if (src[j] === "'") {
      if (src[j + 1] === "'") { j += 2; continue; }
      return j + 1;
    }
    j++;
  }
  return src.length;
}

/** Fim e conteúdo do identificador entre aspas aberto em src[ini] (`""` é aspa dentro). */
function fimDoIdent(src, ini) {
  let j = ini + 1;
  let nome = "";
  while (j < src.length) {
    if (src[j] === '"') {
      if (src[j + 1] === '"') { nome += '"'; j += 2; continue; }
      return { fim: j + 1, nome };
    }
    nome += src[j++];
  }
  return { fim: src.length, nome: "" };
}

if (executadoDiretamente(import.meta.url)) {
  await executar("check-rpc-grants", verificarGrants);
}
