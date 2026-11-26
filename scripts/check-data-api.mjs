// check-data-api: aplica as migrações num PGlite com a simulação do Supabase (scripts/_catalogo.mjs) e
// confere, no catálogo real, as regras de tabela do DES-001 (seções 8 e 13) e o que pode abrir a Data API:
// RLS ativa e ao menos uma política em toda tabela; tabelas só-funções sem política e sem privilégio de
// anon e authenticated; views com security_invoker; nenhum privilégio de anon/PUBLIC/service_role em relação,
// coluna ou sequência (nem os que viriam dos privilégios padrão), nem de qualquer outro papel além de authenticated
// (o dono fica isento; correção 18); políticas só "to authenticated", cada uma com o grant
// da operação, e nenhum grant de tabela a authenticated sem política que o use; e nenhuma das formas de contornar
// a RLS que o catálogo mostra (regras, gatilhos INSTEAD OF, gatilhos de evento, papéis com BYPASSRLS, SUPERUSER ou
// REPLICATION, participação em papel envolvendo anon/authenticated). Não confere o que a função de um gatilho
// BEFORE ou de comando (for each statement) faz: o WITH CHECK da política não a contém (o BEFORE ROW roda antes
// dele); por isso o rpc:grants-check recusa função de gatilho SECURITY DEFINER ligada a relação criada pelas
// migrações (revisão 15, I1; correção 17b), e a SECURITY INVOKER fica sob a RLS. Vale o estado final das migrações.
import { analisarMigracoes, executadoDiretamente, executar, PRIVS_SEQUENCIA, PRIVS_TABELA } from "./_catalogo.mjs";

/** Tabelas (de public) que só se acessam por função: sem política e sem privilégio de anon e authenticated. */
export const SOMENTE_FUNCOES = ["codigos_pareamento"];

/**
 * Privilégios que passam por cima da RLS ou mexem na estrutura: authenticated não pode ter (anon não pode ter nenhum).
 * MAINTAIN entrou na correção 16b (decisão do controlador): a migração já o revoga e nenhuma política o usa.
 */
export const PRIVILEGIOS_PROIBIDOS = ["TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];

/**
 * Papéis cujo privilégio de tabela é conferido pelo efetivo (has_*_privilege), com mensagem própria; qualquer outro papel
 * além de authenticated e do dono (papel novo, supabase_auth_admin...) é conferido pela ACL explícita (correção 18).
 */
const COM_REGRA_PROPRIA = ["PUBLIC", "anon", "service_role", "authenticated"];

/** Operações de cada comando de política (pg_policy.polcmd): r select, a insert, w update, d delete, * todas. */
const OPERACOES_DA_POLITICA = { r: ["SELECT"], a: ["INSERT"], w: ["UPDATE"], d: ["DELETE"], "*": ["SELECT", "INSERT", "UPDATE", "DELETE"] };

/** Lista de erros (vazia = ok) das regras de tabela; recebe o texto SQL ou a lista [{ arquivo, sql }] das migrações. */
export async function verificarDataApi(migracoes) {
  const { erro, catalogo } = await analisarMigracoes(migracoes);
  return erro ? [erro] : regrasDeTabela(catalogo);
}

const NAO_SUPORTADAS = { m: "materialized view", f: "foreign table" };

/** Regras de tabela sobre o catálogo devolvido por analisarMigracoes(). */
export function regrasDeTabela(c) {
  const erros = [];
  const ehTabela = (r) => r.tipo === "r" || r.tipo === "p";
  if (!c.relacoes.some(ehTabela)) erros.push("nenhuma tabela criada pelas migrações: a checagem não conferiu nada");

  for (const r of c.relacoes) {
    const t = r.rotulo;
    const soFuncoes = r.schema === "public" && SOMENTE_FUNCOES.includes(r.nome) && ehTabela(r);
    if (r.schema !== "public") erros.push(`${t}: fora do schema public (o DES-001 põe tudo em public)`);
    if (r.dono !== c.donoDasMigracoes) erros.push(`${t}: dono é ${r.dono} (só ${c.donoDasMigracoes}, o papel que aplica as migrações)`);

    if (ehTabela(r)) {
      if (!r.rls) erros.push(`${t}: sem row level security (falta alter table ... enable row level security)`);
      if (soFuncoes && r.politicas.length > 0) erros.push(`${t}: tabela só-funções não pode ter política`);
      if (!soFuncoes && r.politicas.length === 0) erros.push(`${t}: sem nenhuma política (create policy)`);
    } else if (r.tipo === "v") {
      if (r.invoker !== true) erros.push(`${t}: view sem security_invoker = true (sem isso a view ignora a RLS das tabelas)`);
    } else if (r.tipo === "m" || r.tipo === "f") {
      erros.push(`${t}: ${NAO_SUPORTADAS[r.tipo]} criada pelas migrações: forma não suportada`);
    }
    // Revisão 14, I1: o gatilho INSTEAD OF grava pela view com a função (SECURITY DEFINER, como o DES-001 exige),
    // por fora da RLS da tabela de baixo, como uma regra INSTEAD (create rule), que também é recusada.
    for (const g of r.gatilhos_instead) erros.push(`${t}: gatilho INSTEAD OF ${g}: forma não suportada (a função grava por fora da RLS)`);
    // Correção 16 (revisão 14, N1): política só para authenticated; anon, PUBLIC, service_role ou papel novo → erro.
    for (const p of r.politicas) {
      const outros = p.papeis.filter((x) => x !== "authenticated");
      if (outros.length) erros.push(`${t}: política ${p.nome} vale para ${outros.join(", ")} (só "to authenticated" é permitido)`);
    }

    // Privilégios explícitos. Correção 18 (revisão 16, I1; decisão do controlador): só authenticated pode ter privilégio,
    // e só o dono fica isento. Um papel novo com LOGIN (ou supabase_auth_admin) com TRUNCATE apagava os dados por fora da
    // RLS. De tabela: PUBLIC aqui; anon e service_role pelo efetivo, abaixo; os demais papéis aqui, agrupados por papel.
    // Herança: o privilégio herdado vem de um grant explícito a outro papel, acusado aqui, ou de PUBLIC/authenticated
    // (PUBLIC acusado; participação em authenticated acusada pela regra de participação). De coluna: todo papel além de
    // authenticated (cujo de coluna tem as regras próprias) e do dono. Grant option: ninguém além do dono.
    const publicos = r.acl.filter((a) => a.papel === "PUBLIC").map((a) => a.privilegio);
    if (publicos.length) erros.push(`${t}: PUBLIC com ${publicos.join(", ")}`);
    const outrosPapeis = new Map();
    for (const a of r.acl.filter((a) => a.papel !== r.dono && !COM_REGRA_PROPRIA.includes(a.papel))) {
      outrosPapeis.set(a.papel, [...(outrosPapeis.get(a.papel) ?? []), a.privilegio]);
    }
    const ordem = r.tipo === "S" ? PRIVS_SEQUENCIA : PRIVS_TABELA;
    for (const papel of [...outrosPapeis.keys()].sort()) {
      const privs = ordem.filter((p) => outrosPapeis.get(papel).includes(p));
      erros.push(`${t}: ${papel} com ${privs.join(", ")} (só authenticated pode ter privilégio)`);
    }
    for (const a of r.acl_colunas.filter((a) => a.papel !== r.dono && a.papel !== "authenticated")) {
      erros.push(`${t}: ${a.papel} com ${a.privilegio} na coluna ${a.coluna}`);
    }
    for (const a of [...r.acl, ...r.acl_colunas].filter((a) => a.repassa && a.papel !== r.dono)) {
      erros.push(`${t}: ${a.papel} com grant option em ${a.privilegio}${a.coluna ? ` (coluna ${a.coluna})` : ""} (pode repassar o privilégio)`);
    }

    // Privilégios efetivos (has_*_privilege: inclui PUBLIC, a ACL nula padrão e os papéis herdados).
    // anon: nenhum, em relação nenhuma (correção 16, regra literal do brief). Desde 2026-10-30 o Supabase não dá mais
    // SELECT/INSERT/UPDATE/DELETE automáticos, e a revisão 14 (I1) provou que eles não ficam inertes sob a RLS: por um
    // gatilho (INSTEAD OF em view, ou BEFORE que devolve NULL), anon gravava como o dono da função. O de coluna de anon
    // já sai acima (privilégio explícito); por herança, só por PUBLIC (acusado) ou por participação (acusada abaixo).
    const onde = soFuncoes ? " em tabela só-funções" : r.tipo === "S" ? " em sequência" : "";
    if (r.anon.length) erros.push(`${t}: anon com ${r.anon.join(", ")}${onde}`);
    else if (soFuncoes && r.anon_colunas) erros.push(`${t}: anon com privilégio de coluna em tabela só-funções`);
    // service_role (BYPASSRLS): nenhum privilégio, como anon (correção 17c, decisão do controlador; a migração real
    // revoga tudo dele). O de coluna herdado (por participação de service_role em outro papel, que a regra de
    // participação não acusa) sai como "privilégio de coluna" quando não há o explícito, já acusado acima.
    if (r.service_role.length) erros.push(`${t}: service_role com ${r.service_role.join(", ")}${onde}`);
    else if (r.service_role_colunas && !r.acl_colunas.some((a) => a.papel === "service_role")) erros.push(`${t}: service_role com privilégio de coluna`);
    if (soFuncoes) {
      if (r.authenticated.length) erros.push(`${t}: authenticated com ${r.authenticated.join(", ")}${onde}`);
      else if (r.authenticated_colunas) erros.push(`${t}: authenticated com privilégio de coluna em tabela só-funções`);
    } else if (r.tipo === "S") {
      // Correção 16b (decisão do controlador): authenticated sem privilégio algum em sequência. A coluna identity não
      // precisa de USAGE para o insert (o nextval interno não confere), e o padrão novo do Supabase só dá UPDATE.
      if (r.authenticated.length) erros.push(`${t}: authenticated com ${r.authenticated.join(", ")}${onde}`);
    } else {
      const proibidos = r.authenticated.filter((p) => PRIVILEGIOS_PROIBIDOS.includes(p));
      if (proibidos.length) erros.push(`${t}: authenticated com ${proibidos.join(", ")}`);
      // Também por coluna (grant references (id) on ... to authenticated).
      for (const a of r.acl_colunas.filter((a) => a.papel === "authenticated" && PRIVILEGIOS_PROIBIDOS.includes(a.privilegio))) {
        erros.push(`${t}: authenticated com ${a.privilegio} na coluna ${a.coluna}`);
      }
      if (ehTabela(r)) erros.push(...grantsEPoliticas(r));
    }
  }

  for (const o of c.relacoesPreexistentes) erros.push(`${o.rotulo}: relação pré-existente (Postgres ou simulação do Supabase): ${o.mudanca} pelas migrações: forma não suportada`);
  for (const p of c.politicasEmPreexistentes) erros.push(`política ${p}: política em relação pré-existente: forma não suportada`);

  // Schemas: dono e privilégios ganhos por anon/PUBLIC; schema pré-existente (nome, dono ou privilégios) alterado ou removido.
  const { anon, authenticated, serviceRole } = c.papeisDoSupabase;
  for (const s of c.schemas) {
    if (s.dono === "anon" || s.dono === "authenticated") erros.push(`schema ${s.rotulo}: dono é ${s.dono}`);
    for (const [papel, nome] of [["0", "PUBLIC"], [anon, "anon"]]) {
      if (s.ganhos.has(papel)) erros.push(`schema ${s.rotulo}: ${nome} ganhou ${s.ganhos.get(papel).join(", ")}`);
    }
  }
  for (const s of c.schemasPreexistentes) erros.push(`schema ${s.rotulo}: schema pré-existente: ${s.mudanca} pelas migrações: forma não suportada`);

  // Privilégios padrão (alter default privileges) de tudo que não é função (as funções ficam com o rpc:grants-check):
  // anon/PUBLIC não ganham nada além da base; e, no estado final, as tabelas e sequências criadas depois não nascem
  // com privilégio algum para anon, PUBLIC (correção 16), service_role (correção 17c) ou qualquer outro papel além de
  // authenticated e do dono (correção 18), nem as sequências com privilégio algum para authenticated
  // e as tabelas com PRIVILEGIOS_PROIBIDOS para ele (correção 16b) (o padrão do Supabase de 2026-10-30 dá TRUNCATE,
  // REFERENCES, TRIGGER e MAINTAIN nas tabelas e UPDATE nas sequências; a migração revoga).
  for (const a of c.aclPadrao.filter((a) => a.tipo !== "f" && a.tipo !== "T")) {
    for (const [papel, nome] of [["0", "PUBLIC"], [anon, "anon"]]) {
      if (a.ganhos.has(papel)) erros.push(`${a.rotulo}: ${nome} ganha ${a.ganhos.get(papel).join(", ")} nos objetos criados depois`);
    }
  }
  for (const [tipo, privs, objetos] of [["r", PRIVS_TABELA, "tabelas"], ["S", PRIVS_SEQUENCIA, "sequências"]]) {
    for (const a of c.aclPadraoFinal.filter((a) => a.tipo === tipo)) {
      const fixos = [["0", "PUBLIC"], [anon, "anon"], [serviceRole, "service_role"]];
      const outros = [...new Set(a.itens.map((i) => i.split(":")[0]))]
        .filter((g) => g !== c.donoDasMigracoesOid && g !== authenticated && !fixos.some(([f]) => f === g))
        .map((g) => [g, c.nomeDoPapel(g)]).sort((x, y) => (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
      for (const [papel, nome] of [...fixos, ...outros, [authenticated, "authenticated"]]) {
        const proibidos = privs.filter((p) => a.itens.includes(`${papel}:${p}`) && (nome !== "authenticated" || tipo === "S" || PRIVILEGIOS_PROIBIDOS.includes(p)));
        if (proibidos.length) erros.push(`${a.rotulo}: ${nome} recebe ${proibidos.join(", ")} nas ${objetos} criadas depois (falta alter default privileges ... revoke)`);
      }
    }
  }

  // Papéis: nenhum papel novo com SUPERUSER, BYPASSRLS ou REPLICATION (correção 15b, decisão do controlador: pela
  // replicação, um papel lê todos os dados por fora da RLS; CREATEROLE, CREATEDB e LOGIN são aceitos, como no dono); papéis da base não mudam; anon e authenticated não
  // entram em nenhuma participação (grant <papel> to <papel>), em nenhum dos lados.
  for (const p of c.papeisNovos) {
    if (p.superusuario) erros.push(`papel ${p.rotulo}: criado com SUPERUSER`);
    if (p.bypassrls) erros.push(`papel ${p.rotulo}: criado com BYPASSRLS`);
    if (p.replicacao) erros.push(`papel ${p.rotulo}: criado com REPLICATION`);
  }
  for (const p of c.papeisPreexistentes) erros.push(`papel ${p.rotulo}: papel pré-existente: ${p.mudanca} pelas migrações: forma não suportada`);
  for (const m of c.participacoesNovas) {
    const [papel, membro] = m.chave.split("|");
    if ([anon, authenticated].includes(papel) || [anon, authenticated].includes(membro)) {
      erros.push(`${m.rotulo}: participação em papel envolvendo anon ou authenticated`);
    }
  }

  for (const o of c.outros) erros.push(`${o.tipo} ${o.rotulo}: ${o.mudanca} pelas migrações: forma não suportada`);
  return erros;
}

/**
 * Grants de tabela a authenticated × políticas "to authenticated" (correção 16), por operação (SELECT, INSERT, UPDATE,
 * DELETE; o grant pode ser de tabela ou de coluna). Grant sem política que use a operação: privilégio sem uso, que vira
 * acesso se a RLS for desligada ou trocada. Política sem o grant: no Supabase (desde 2026-10-30, sem privilégio
 * automático) não vale, e o acesso que ela descreve dá "permission denied". Uma política `for all` usa as quatro.
 */
function grantsEPoliticas(r) {
  const erros = [];
  const politicas = r.politicas.filter((p) => p.papeis.includes("authenticated"));
  const usadas = new Set(politicas.flatMap((p) => OPERACOES_DA_POLITICA[p.comando]));
  const concedidas = new Set([...r.authenticated, ...r.acl_colunas.filter((a) => a.papel === "authenticated").map((a) => a.privilegio)]);
  const semPolitica = OPERACOES_DA_POLITICA["*"].filter((op) => concedidas.has(op) && !usadas.has(op));
  if (semPolitica.length) {
    erros.push(`${r.rotulo}: authenticated com ${semPolitica.join(", ")} sem política "to authenticated" para a operação (privilégio sem uso: vira acesso se a RLS for desligada ou trocada)`);
  }
  for (const p of politicas) {
    const semGrant = OPERACOES_DA_POLITICA[p.comando].filter((op) => !concedidas.has(op));
    if (semGrant.length) erros.push(`${r.rotulo}: política ${p.nome} sem o grant de ${semGrant.join(", ")} a authenticated (no Supabase a política não vale: permission denied)`);
  }
  return erros;
}

if (executadoDiretamente(import.meta.url)) {
  await executar("check-data-api", verificarDataApi);
}
