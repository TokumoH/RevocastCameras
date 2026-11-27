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
// Storage (PLA-003, D13): nenhuma mudança em storage.* além de create/alter/drop policy em storage.objects; as políticas
// de storage.objects só no formato da D13; os buckets do estado final só os do app, privados e com limites.
// Realtime (PLA-004, D6): a mesma regra dos SCHEMAS_PROTEGIDOS (nenhuma mudança em realtime.* além de create/alter/drop policy
// em realtime.messages), e a política criada ou alterada em realtime.messages só igual a uma de POLITICAS_DO_CANAL, chamando
// exatamente as FUNCOES_DO_CANAL (conferidas pelo oid).
import { analisarMigracoes, campoProtegido, executadoDiretamente, executar, PRIVS_SEQUENCIA, PRIVS_TABELA, SCHEMAS_PROTEGIDOS } from "./_catalogo.mjs";
// A mesma leitura do corpo do rpc:grants-check, sem cópia (D13): apaga textos e comentários antes de procurar a chamada.
import { CHAMA_FUNCAO_DE_PAPEL, codigoDoCorpo } from "./check-rpc-grants.mjs";

/** Tabelas (de public) que só se acessam por função: sem política e sem privilégio de anon e authenticated (tentativas_pareamento desde a E3, PLA-004 D2). */
export const SOMENTE_FUNCOES = ["codigos_pareamento", "tentativas_pareamento"];

/** Buckets do app (PLA-003, D13): os únicos aceitos em storage.buckets e no início das políticas de storage.objects. */
export const BUCKETS_DO_APP = ["midias"];

/** Tipos aceitos no bucket (PLA-003, D4): allowed_mime_types tem de estar contido nesta lista (sem image/svg+xml). */
export const TIPOS_DO_BUCKET = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "image/png", "image/jpeg", "image/webp", "image/gif"];

/** Limite por arquivo do bucket, em bytes (50 MB do plano Free, DES-001 §3; PLA-003, D4). */
export const LIMITE_DO_BUCKET = 52428800;

/**
 * As duas políticas do canal (PLA-004, D6), as únicas aceitas em realtime.messages, com o texto exato que o PGlite imprime
 * (pg_get_expr, sonda do Passo 3 da Tarefa 2 da E3, 2026-11-27): receber (select) e enviar (insert) decididos só por
 * public.pode_usar_canal(tópico, extensão, enviar). Comando como em pg_policy.polcmd (r select, a insert).
 */
export const POLITICAS_DO_CANAL = [
  { nome: "canal_recebe", comando: "r", papeis: ["authenticated"], permissiva: true, usando: "public.pode_usar_canal(realtime.topic(), extension, false)", comCheck: null },
  { nome: "canal_envia", comando: "a", papeis: ["authenticated"], permissiva: true, usando: null, comCheck: "public.pode_usar_canal(realtime.topic(), extension, true)" },
];

/**
 * As funções que as políticas do canal chamam, exatamente estas (revisão do plano, N5): o catálogo as lê pelo oid
 * (pg_depend da política) e as escreve com o schema e os tipos dos parâmetros, então uma homônima em outro schema, com outros
 * tipos ou com um parâmetro a mais com valor padrão (que o texto da política não mostra) não passa.
 */
export const FUNCOES_DO_CANAL = ["public.pode_usar_canal(text, text, boolean)", "realtime.topic()"];

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
  // PLA-003, D13: em storage.objects, a política criada ou alterada segue a regra própria; a removida é aceita (remover
  // política só nega mais). PLA-004, D6: em realtime.messages, a mesma coisa, com a regra das políticas do canal. Em
  // qualquer outra relação pré-existente (inclusive storage.buckets, a partição de realtime.messages e auth.users), erro.
  const REGRA_DA_RELACAO = { "storage.objects": (p) => politicaDeStorage(p), "realtime.messages": (p) => politicaDoCanal(p, c.detalheDasPoliticas[p.rotulo]) };
  for (const p of c.politicasEmPreexistentes) {
    if (!Object.hasOwn(REGRA_DA_RELACAO, p.relacao)) erros.push(`política ${p.rotulo}: política em relação pré-existente: forma não suportada`);
    else if (p.mudanca !== "remoção") erros.push(...REGRA_DA_RELACAO[p.relacao](p));
  }
  // PLA-003, D13 e PLA-004, D6: as relações dos schemas protegidos não aceitam mudança nenhuma (no Supabase o dono das
  // migrações recebe 42501), nem os privilégios padrão do dono delas ou do schema, nem os outros objetos do schema (revisão 1
  // da Tarefa 2 da E2, I1: tipo, domínio, operador, collation, text search, função, estatística...). Falha fechada (revisão 1
  // da Tarefa 2 da E3, I1): cada campo de cada schema protegido tem de ser uma lista; se faltar, a checagem lança erro em vez
  // de tratar a falta como "nada mudou".
  for (const s of SCHEMAS_PROTEGIDOS) {
    const msg = MSG_DO_SCHEMA[s];
    const lista = (prefixo) => {
      const campo = campoProtegido(prefixo, s);
      if (!Array.isArray(c[campo])) throw new Error(`catálogo sem ${campo}: a checagem não conferiu o schema ${s}`);
      return c[campo];
    };
    for (const m of lista("mudancas")) {
      erros.push(`${m.rotulo}: relação do schema ${s}: ${m.mudanca === "remoção" ? "removida" : `${m.itens.join(", ")} alterado`} pelas migrações ${msg}`);
    }
    for (const a of lista("aclPadrao")) erros.push(`${a.rotulo}: privilégios padrão de ${s}: ${a.mudanca} pelas migrações ${msg}`);
    for (const o of lista("objetos")) erros.push(`${o.rotulo}: objeto no schema ${s}: ${o.mudanca} pelas migrações ${msg}`);
  }
  if (c.bucketsFinais === null) erros.push(`storage.buckets: tabela movida, renomeada ou ausente no fim das migrações: a regra do bucket não conferiu nada ${MSG_STORAGE}`);
  else erros.push(...regraDosBuckets(c.bucketsFinais));

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

const MSG_STORAGE = "(no Supabase o dono das migrações não é dono das relações de storage e receberia 42501; em storage só create/alter/drop policy em storage.objects é aceito, PLA-003 D13)";
const MSG_REALTIME = "(no Supabase o dono das migrações não é dono das relações de realtime e receberia 42501; em realtime só create/alter/drop policy em realtime.messages, com as políticas de POLITICAS_DO_CANAL, é aceito, PLA-004 D6)";
/** Complemento das mensagens de cada schema protegido (a de storage é a da E2, sem mudança). */
const MSG_DO_SCHEMA = { storage: MSG_STORAGE, realtime: MSG_REALTIME };

/**
 * Regra das políticas de realtime.messages (PLA-004, D6): a política criada ou alterada tem de ser igual a uma de
 * POLITICAS_DO_CANAL no nome, no comando, nos papéis, em permissive e no texto das duas expressões (um erro, se não for); e,
 * sendo igual, as funções que ela chama, lidas pelo oid (detalhe.funcoes), têm de ser exatamente FUNCOES_DO_CANAL (outro
 * erro, se não forem). Limite que sobra (revisão do plano, N5; Riscos): um create or replace de public.pode_usar_canal que
 * devolva true mantém o oid e passa aqui; só os testes de banco da E3 o pegam.
 */
function politicaDoCanal(p, detalhe) {
  const igual = POLITICAS_DO_CANAL.some((q) => q.nome === detalhe.nome && q.comando === p.comando && q.permissiva === detalhe.permissiva
    && q.papeis.length === p.papeis.length && q.papeis.every((x, i) => x === p.papeis[i]) && q.usando === p.usando && q.comCheck === p.comCheck);
  if (!igual) {
    return [`política ${p.rotulo}: diferente das políticas do canal (só as de POLITICAS_DO_CANAL, iguais no nome, no comando, nos papéis, em permissive e no texto das expressões, PLA-004 D6)`];
  }
  if (detalhe.funcoes.length !== FUNCOES_DO_CANAL.length || !FUNCOES_DO_CANAL.every((f) => detalhe.funcoes.includes(f))) {
    return [`política ${p.rotulo}: as funções chamadas não são exatamente ${FUNCOES_DO_CANAL.join(" e ")} (conferidas pelo oid no catálogo: ${detalhe.funcoes.join(", ")}; PLA-004 D6)`];
  }
  return [];
}

/** Comandos de política aceitos em storage.objects (select, insert, delete; sem update, PLA-003 D5) e o nome de cada polcmd. */
const COMANDOS_DE_STORAGE = ["r", "a", "d"];
const NOME_DO_COMANDO = { r: "select", a: "insert", w: "update", d: "delete", "*": "all" };

/**
 * Regra das políticas de storage.objects (PLA-003, D13): só "to authenticated"; comando select, insert ou delete; cada
 * expressão (using e with check), e sempre a do comando (using em select e delete, with check em insert; ausente vale
 * true), começando pelo bucket como conjunção de topo, `((bucket_id = '<bucket>'::text) AND `, com o bucket em
 * BUCKETS_DO_APP (um `bucket_id = 'midias' or ...` abriria todos os buckets: as políticas permissivas se somam por OR); e
 * chamada de public.papel_atual() ou public.dispositivo_atual() em cada expressão, fora de textos e comentários
 * (codigoDoCorpo). Limite: confere a presença da chamada, não o uso (`B and (papel is null or true)` passa).
 */
function politicaDeStorage(p) {
  const erros = [];
  const outros = p.papeis.filter((x) => x !== "authenticated");
  if (outros.length) erros.push(`política ${p.rotulo}: vale para ${outros.join(", ")} (só "to authenticated" é permitido)`);
  if (!COMANDOS_DE_STORAGE.includes(p.comando)) {
    erros.push(`política ${p.rotulo}: comando ${NOME_DO_COMANDO[p.comando] ?? p.comando} não permitido em storage.objects (só select, insert e delete; sem update, PLA-003 D5)`);
  }
  const expressoes = [["using", p.usando, p.comando !== "a"], ["with check", p.comCheck, p.comando === "a"]];
  for (const [nome, expr, doComando] of expressoes) {
    if (expr === null && !doComando) continue;
    if (expr === null || !BUCKETS_DO_APP.some((b) => expr.startsWith(`((bucket_id = '${b}'::text) AND `))) {
      erros.push(`política ${p.rotulo}: o ${nome} não começa pelo bucket como conjunção de topo (((bucket_id = '<bucket>'::text) AND ..., com o bucket em BUCKETS_DO_APP: ${BUCKETS_DO_APP.join(", ")})`);
    }
  }
  const existentes = expressoes.map(([, expr]) => expr).filter((expr) => expr !== null);
  if (existentes.length === 0 || !existentes.every((expr) => CHAMA_FUNCAO_DE_PAPEL.test(codigoDoCorpo(expr)))) {
    erros.push(`política ${p.rotulo}: não chama public.papel_atual() nem public.dispositivo_atual() (fora de textos e comentários)`);
  }
  return erros;
}

/**
 * Regra do bucket (PLA-003, D13; dados, não catálogo): cada linha de storage.buckets no fim das migrações tem de estar em
 * BUCKETS_DO_APP, com public = false, file_size_limit não nulo e até LIMITE_DO_BUCKET e allowed_mime_types não vazio e
 * contido em TIPOS_DO_BUCKET (nulo ou vazio, o Storage aceita qualquer tipo). Um erro por bucket, com os problemas.
 */
function regraDosBuckets(buckets) {
  const erros = [];
  for (const b of buckets) {
    const problemas = [];
    if (!BUCKETS_DO_APP.includes(b.id)) problemas.push("fora de BUCKETS_DO_APP");
    if (b.public !== false) problemas.push("público (public não é false)");
    if (b.file_size_limit === null) problemas.push("sem file_size_limit");
    else if (Number(b.file_size_limit) > LIMITE_DO_BUCKET) problemas.push(`file_size_limit acima de ${LIMITE_DO_BUCKET}`);
    if (!b.allowed_mime_types?.length) problemas.push("sem allowed_mime_types (nulo ou vazio aceita qualquer tipo)");
    else {
      const fora = b.allowed_mime_types.filter((t) => !TIPOS_DO_BUCKET.includes(t));
      if (fora.length) problemas.push(`allowed_mime_types fora de TIPOS_DO_BUCKET: ${fora.map((t) => t ?? "NULL").join(", ")}`);
    }
    if (problemas.length) {
      erros.push(`bucket ${b.id} (storage.buckets): ${problemas.join("; ")} (PLA-003 D13: só os buckets de BUCKETS_DO_APP, privados, com file_size_limit até ${LIMITE_DO_BUCKET} e allowed_mime_types não vazio e dentro de TIPOS_DO_BUCKET)`);
    }
  }
  return erros;
}

if (executadoDiretamente(import.meta.url)) {
  await executar("check-data-api", verificarDataApi);
}
