// Catálogo das migrações, compartilhado pelas checagens de banco (GRASP Pure Fabrication).
// Em vez de ler o texto SQL, aplica as migrações num PGlite (Postgres em WASM) que já tem a simulação do
// Supabase (supabase/tests/simulacao-supabase.sql) e o dono das migrações (supabase/tests/dono-migracao.sql)
// e lê o resultado no catálogo do próprio Postgres. Cada migração é aplicada como esse dono (postgres_sim), sem
// superusuário, como o papel postgres do Supabase.
// Devolve só o que as migrações criaram, alteraram ou removeram: a diferença contra um retrato do catálogo
// tirado logo depois da simulação e do dono (a "base"). As regras ficam em check-rpc-grants.mjs e check-data-api.mjs;
// a única importação entre elas é a leitura do corpo do rpc:grants-check (codigoDoCorpo e CHAMA_FUNCAO_DE_PAPEL), que o
// data-api:check reaproveita nas políticas de storage.objects (PLA-003, D13), em vez de copiar.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { reporter } from "./_lib.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Simulação do Supabase (arquivo da Tarefa 3, só lido): papéis anon/authenticated/service_role, privilégios padrão, auth.*. */
const SIMULACAO = path.join(RAIZ, "supabase", "tests", "simulacao-supabase.sql");
/** Dono das migrações (arquivo da Tarefa 3, só lido): cria o papel postgres_sim, sem superusuário, e os privilégios dele. */
const DONO_MIGRACAO = path.join(RAIZ, "supabase", "tests", "dono-migracao.sql");
/** Papel que aplica as migrações, criado por dono-migracao.sql (no Supabase, o papel postgres, que não é superusuário). */
const DONO = "postgres_sim";

// As consultas ao catálogo rodam com este search_path: pg_catalog primeiro e pg_temp por último, para que
// nenhuma tabela temporária ou função criada pela migração tome o lugar de um objeto do catálogo.
const CAMINHO_SEGURO = "set search_path = pg_catalog, pg_temp";

// --- Impressões digitais do catálogo -------------------------------------------------------------------
// Cada grupo devolve uma linha por objeto: k (chave estável), rot (rótulo para a mensagem) e v (impressão
// do estado que importa para a segurança). Objeto novo = chave fora da base; alterado = impressão diferente;
// removido = chave da base que sumiu. O rótulo usa format('%I.%I'), que só põe aspas quando é preciso.

// Schemas temporários (pg_temp_N e pg_toast_temp_N) ficam de fora: nascem com o primeiro objeto temporário e
// continuam depois que ele é apagado. Objeto temporário sobrando no fim de uma migração é recusado (fimDaMigracao).
const SEM_TEMPORARIOS = "n.nspname !~ '^pg_(toast_)?temp_'";

const FUNCOES = `select p.oid::int8 as k, pg_catalog.format('%I.%I', n.nspname, p.proname) || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as rot,
  pg_catalog.md5(pg_catalog.concat_ws('|', p.proname, p.pronamespace, p.prokind, p.prosecdef, p.proconfig::text, p.proacl::text, p.proowner,
    p.prolang, p.prosrc, p.probin, p.prosqlbody::text, p.proargtypes::text, p.prorettype)) as v
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where ${SEM_TEMPORARIOS}`;

// Relações com privilégio próprio (tabela, particionada, view, materialized view, foreign table, sequência).
// A impressão inclui os privilégios de coluna (attacl); não inclui gatilhos nem índices (para as relações do schema
// storage, a impressão ampliada fica em STORAGE, abaixo).
const RELACOES = `select c.oid::int8 as k, pg_catalog.format('%I.%I', n.nspname, c.relname) as rot,
  pg_catalog.md5(pg_catalog.concat_ws('|', c.relname, c.relnamespace, c.relkind, c.relowner, c.relacl::text, c.relrowsecurity,
    c.relforcerowsecurity, c.reloptions::text,
    (select pg_catalog.string_agg(a.attnum || ':' || a.attacl::text, ',' order by a.attnum) from pg_catalog.pg_attribute a
      where a.attrelid = c.oid and a.attacl is not null))) as v
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') and ${SEM_TEMPORARIOS}`;

const SCHEMAS = `select n.oid::int8 as k, pg_catalog.quote_ident(n.nspname) as rot,
  pg_catalog.md5(pg_catalog.concat_ws('|', n.nspname, n.nspowner, n.nspacl::text)) as v from pg_catalog.pg_namespace n where ${SEM_TEMPORARIOS}`;

const PAPEIS = `select r.oid::int8 as k, pg_catalog.quote_ident(r.rolname) as rot,
  pg_catalog.md5(pg_catalog.concat_ws('|', r.rolname, r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb, r.rolcanlogin,
    r.rolreplication, r.rolbypassrls)) as v from pg_catalog.pg_roles r`;

const PARTICIPACOES = `select pg_catalog.concat_ws('|', m.roleid, m.member, m.admin_option, m.inherit_option, m.set_option) as k,
  pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(m.member)) || ' membro de ' || pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(m.roleid)) as rot,
  '' as v from pg_catalog.pg_auth_members m`;

// Além da impressão, cada linha traz a relação, os papéis, o comando e o texto das expressões (pg_get_expr, com o
// search_path seguro da leitura: as funções de public saem qualificadas), que a regra das políticas de storage.objects
// lê (PLA-003, D13). Numa política removida, valem os da base.
const POLITICAS = `select p.oid::int8 as k, p.polrelid::int8 as rel, pg_catalog.quote_ident(p.polname) || ' em ' || pg_catalog.format('%I.%I', n.nspname, c.relname) as rot,
  pg_catalog.md5(pg_catalog.concat_ws('|', p.polrelid, p.polname, p.polcmd, p.polpermissive, p.polroles::text,
    pg_catalog.pg_get_expr(p.polqual, p.polrelid), pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid))) as v,
  pg_catalog.format('%I.%I', n.nspname, c.relname) as relacao, p.polcmd::text as comando,
  array(select case when r = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(r) end from pg_catalog.unnest(p.polroles) r) as papeis,
  pg_catalog.pg_get_expr(p.polqual, p.polrelid) as usando, pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as com_check
  from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace`;

/**
 * Itens da impressão ampliada das relações do schema storage, na ordem em que as mensagens os listam (PLA-003, D13).
 * Políticas ficam de fora (create, alter e drop policy em storage.objects são julgados pela regra das políticas).
 */
export const ITENS_STORAGE = ["nome", "dono", "privilégio", "RLS", "opções", "replica identity", "coluna", "padrão", "índice", "gatilho",
  "restrição", "comentário", "estatística", "herança", "chave estrangeira"];

// Relações do schema storage (PLA-003, D13): no Supabase, o dono das migrações (postgres) não é dono delas e recebe 42501
// em qualquer alter table; aqui, como membro de supabase_storage_admin (supabase/tests/dono-migracao.sql), ele consegue.
// Por isso a impressão delas vai além da de RELACOES: v é um objeto JSON (em texto) com um campo por item de
// ITENS_STORAGE, e lerCatalogo() devolve os itens que mudaram. Os campos longos vão em md5. Comentários: da relação, das
// colunas, dos índices, das restrições e dos gatilhos (os de política ficam de fora, como as políticas). Chave
// estrangeira: as de outras relações (fora de storage) que apontam para esta; as internas de storage ficam em "restrição".
// Herança: a relação como pai ou como filha. Gatilhos: só os não internos (os internos são os das chaves estrangeiras).
const STORAGE = `select c.oid::int8 as k, pg_catalog.format('%I.%I', n.nspname, c.relname) as rot,
  pg_catalog.json_build_object(
    'nome', pg_catalog.concat_ws('|', c.relname, c.relnamespace),
    'dono', c.relowner::text,
    'privilégio', pg_catalog.concat_ws('|', c.relacl::text, (select pg_catalog.string_agg(a.attnum || ':' || a.attacl::text, ',' order by a.attnum)
      from pg_catalog.pg_attribute a where a.attrelid = c.oid and a.attacl is not null)),
    'RLS', pg_catalog.concat_ws('|', c.relrowsecurity, c.relforcerowsecurity),
    'opções', pg_catalog.concat_ws('|', c.relkind, c.relpersistence, c.reloptions::text, c.relam, c.reltablespace, c.relispartition),
    'replica identity', c.relreplident::text,
    'coluna', (select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws(':', a.attnum, a.attname, a.atttypid, a.atttypmod, a.attnotnull,
      a.attisdropped, a.attgenerated, a.attidentity, a.attcollation, a.attndims, a.attislocal, a.attinhcount), ',' order by a.attnum))
      from pg_catalog.pg_attribute a where a.attrelid = c.oid and a.attnum > 0),
    'padrão', (select pg_catalog.md5(pg_catalog.string_agg(d.adnum || ':' || pg_catalog.pg_get_expr(d.adbin, d.adrelid), ',' order by d.adnum))
      from pg_catalog.pg_attrdef d where d.adrelid = c.oid),
    'índice', (select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws(':', pg_catalog.pg_get_indexdef(i.indexrelid), i.indisreplident,
      i.indisclustered, i.indisvalid), ',' order by pg_catalog.pg_get_indexdef(i.indexrelid))) from pg_catalog.pg_index i where i.indrelid = c.oid),
    'gatilho', (select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws(':', t.tgname, t.tgenabled, t.tgfoid, pg_catalog.pg_get_triggerdef(t.oid)),
      ',' order by t.tgname)) from pg_catalog.pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal),
    'restrição', (select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws(':', o.conname, o.contype, o.convalidated, o.condeferrable,
      o.condeferred, pg_catalog.pg_get_constraintdef(o.oid)), ',' order by o.conname, o.contype)) from pg_catalog.pg_constraint o where o.conrelid = c.oid),
    'comentário', (select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws(':', d.classoid, d.objoid, d.objsubid, d.description), ','
      order by d.classoid, d.objoid, d.objsubid)) from pg_catalog.pg_description d
      where (d.classoid = 'pg_catalog.pg_class'::pg_catalog.regclass and (d.objoid = c.oid or d.objoid in (select i.indexrelid from pg_catalog.pg_index i where i.indrelid = c.oid)))
         or (d.classoid = 'pg_catalog.pg_constraint'::pg_catalog.regclass and d.objoid in (select o.oid from pg_catalog.pg_constraint o where o.conrelid = c.oid))
         or (d.classoid = 'pg_catalog.pg_trigger'::pg_catalog.regclass and d.objoid in (select t.oid from pg_catalog.pg_trigger t where t.tgrelid = c.oid))),
    'estatística', (select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws(':', s.oid, s.stxowner, pg_catalog.pg_get_statisticsobjdef(s.oid)), ','
      order by s.oid)) from pg_catalog.pg_statistic_ext s where s.stxrelid = c.oid),
    'herança', (select pg_catalog.string_agg(pg_catalog.concat_ws(':', h.inhrelid, h.inhparent, h.inhseqno), ',' order by h.inhrelid, h.inhparent)
      from pg_catalog.pg_inherits h where h.inhparent = c.oid or h.inhrelid = c.oid),
    'chave estrangeira', (select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws(':', o.conrelid, o.conname, pg_catalog.pg_get_constraintdef(o.oid)),
      ',' order by o.conrelid, o.conname)) from pg_catalog.pg_constraint o where o.confrelid = c.oid and o.contype = 'f'
      and o.conrelid not in (select x.oid from pg_catalog.pg_class x where x.relnamespace = c.relnamespace))
  )::text as v
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') and n.nspname = 'storage'`;

// Privilégios padrão (alter default privileges): a impressão é a própria lista; os ganhos são calculados à parte.
const ACL_PADRAO = `select pg_catalog.concat_ws('|', d.defaclrole, d.defaclnamespace, d.defaclobjtype) as k, d.defaclrole::int8 as papel, d.defaclnamespace::int8 as esquema,
  'alter default privileges (papel ' || pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(d.defaclrole)) || ', '
    || case when d.defaclnamespace = 0 then 'todos os schemas' else 'schema ' || pg_catalog.quote_ident(d.defaclnamespace::regnamespace::text) end
    || ', ' || case d.defaclobjtype when 'r' then 'tabelas' when 'S' then 'sequências' when 'f' then 'funções' when 'T' then 'tipos'
       when 'n' then 'schemas' when 'L' then 'objetos grandes' else d.defaclobjtype::text end || ')' as rot,
  d.defaclobjtype::text as tipo,
  (select pg_catalog.json_agg(x.grantee::int8 || ':' || x.privilege_type) from pg_catalog.aclexplode(d.defaclacl) x) as itens,
  case when d.defaclnamespace = 0 then (select pg_catalog.json_agg(x.grantee::int8 || ':' || x.privilege_type)
    from pg_catalog.aclexplode(pg_catalog.acldefault(case d.defaclobjtype when 'S' then 's' else d.defaclobjtype end, d.defaclrole)) x) end as padrao,
  d.defaclacl::text as v from pg_catalog.pg_default_acl d`;

/**
 * Outros objetos do catálogo que as regras não modelam: qualquer um criado, alterado ou removido pelas
 * migrações é acusado como forma não suportada (falha fechada). [tipo, consulta].
 */
const OUTROS = [
  ["regra (create rule)", `select r.oid::int8 as k, pg_catalog.quote_ident(r.rulename) || ' em ' || r.ev_class::regclass::text as rot,
    pg_catalog.md5(pg_catalog.concat_ws('|', r.ev_class, r.rulename, r.ev_type, r.is_instead, r.ev_enabled)) as v
    from pg_catalog.pg_rewrite r where r.rulename <> '_RETURN'`],
  ["gatilho de evento", `select e.oid::int8 as k, pg_catalog.quote_ident(e.evtname) as rot,
    pg_catalog.md5(pg_catalog.concat_ws('|', e.evtname, e.evtevent, e.evtfoid, e.evtenabled, e.evttags::text)) as v from pg_catalog.pg_event_trigger e`],
  ["extensão", `select x.oid::int8 as k, pg_catalog.quote_ident(x.extname) as rot,
    pg_catalog.md5(pg_catalog.concat_ws('|', x.extname, x.extnamespace, x.extversion, x.extowner)) as v from pg_catalog.pg_extension x`],
  ["configuração de papel ou banco (alter role/database ... set)", `select pg_catalog.concat_ws('|', s.setdatabase, s.setrole) as k,
    'papel ' || coalesce(pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(nullif(s.setrole, 0))), '(todos)') as rot,
    s.setconfig::text as v from pg_catalog.pg_db_role_setting s`],
  ["privilégio em parâmetro (grant ... on parameter)", `select a.oid::int8 as k, a.parname as rot, a.paracl::text as v from pg_catalog.pg_parameter_acl a`],
  ["banco de dados", `select d.oid::int8 as k, pg_catalog.quote_ident(d.datname) as rot,
    pg_catalog.md5(pg_catalog.concat_ws('|', d.datname, d.datdba, d.datacl::text)) as v from pg_catalog.pg_database d`],
  ["linguagem", `select l.oid::int8 as k, pg_catalog.quote_ident(l.lanname) as rot,
    pg_catalog.md5(pg_catalog.concat_ws('|', l.lanname, l.lanowner, l.lanpltrusted, l.lanplcallfoid, l.laninline, l.lanvalidator, l.lanacl::text)) as v
    from pg_catalog.pg_language l`],
  ["wrapper de dados externos", `select w.oid::int8 as k, pg_catalog.quote_ident(w.fdwname) as rot,
    pg_catalog.md5(pg_catalog.concat_ws('|', w.fdwname, w.fdwowner, w.fdwacl::text, w.fdwoptions::text)) as v from pg_catalog.pg_foreign_data_wrapper w`],
  ["servidor externo", `select s.oid::int8 as k, pg_catalog.quote_ident(s.srvname) as rot,
    pg_catalog.md5(pg_catalog.concat_ws('|', s.srvname, s.srvowner, s.srvacl::text, s.srvoptions::text)) as v from pg_catalog.pg_foreign_server s`],
  ["mapeamento de usuário", `select u.oid::int8 as k, u.umuser::text || '@' || u.umserver::text as rot, u.umoptions::text as v from pg_catalog.pg_user_mapping u`],
  ["objeto grande", `select o.oid::int8 as k, o.oid::text as rot, pg_catalog.concat_ws('|', o.lomowner, o.lomacl::text) as v from pg_catalog.pg_largeobject_metadata o`],
  ["publicação", `select p.oid::int8 as k, pg_catalog.quote_ident(p.pubname) as rot, pg_catalog.md5(p::text) as v from pg_catalog.pg_publication p`],
  ["tabela em publicação", `select p.oid::int8 as k, p.prrelid::regclass::text as rot, pg_catalog.md5(p::text) as v from pg_catalog.pg_publication_rel p`],
  ["schema em publicação", `select p.oid::int8 as k, p.pnnspid::regnamespace::text as rot, pg_catalog.md5(p::text) as v from pg_catalog.pg_publication_namespace p`],
  ["assinatura (subscription)", `select s.oid::int8 as k, pg_catalog.quote_ident(s.subname) as rot, pg_catalog.md5(s::text) as v from pg_catalog.pg_subscription s`],
];

// Objetos do schema storage que não são relação (revisão 1 da Tarefa 2 da E2, I1): todo catálogo com coluna *namespace
// (pg_catalog, Postgres 18), menos pg_class (relações: STORAGE e RELACOES; índices: item "índice"), pg_default_acl
// (aclPadraoEmStorage) e as restrições de tabela (item "restrição"; ficam as de domínio, conrelid = 0). Em pg_type, ficam de
// fora os tipos de linha de tabela, view e sequência (seguem a relação) e os arrays implícitos (seguem o tipo); o tipo
// composto (relkind 'c') fica. A impressão é a linha inteira do catálogo (md5 do texto da linha). [catálogo, alias, coluna do
// schema, filtro extra].
const CATALOGOS_COM_SCHEMA = [
  ["pg_type", "t", "typnamespace", `(t.typrelid = 0 or (select r.relkind from pg_catalog.pg_class r where r.oid = t.typrelid) = 'c')
    and not exists (select 1 from pg_catalog.pg_type e where e.oid = t.typelem and e.typarray = t.oid)`],
  ["pg_proc", "t", "pronamespace", "true"],
  ["pg_constraint", "t", "connamespace", "t.conrelid = 0"],
  ["pg_operator", "t", "oprnamespace", "true"],
  ["pg_opclass", "t", "opcnamespace", "true"],
  ["pg_opfamily", "t", "opfnamespace", "true"],
  ["pg_collation", "t", "collnamespace", "true"],
  ["pg_conversion", "t", "connamespace", "true"],
  ["pg_statistic_ext", "t", "stxnamespace", "true"],
  ["pg_ts_config", "t", "cfgnamespace", "true"],
  ["pg_ts_dict", "t", "dictnamespace", "true"],
  ["pg_ts_parser", "t", "prsnamespace", "true"],
  ["pg_ts_template", "t", "tmplnamespace", "true"],
  ["pg_extension", "t", "extnamespace", "true"],
];
const OBJETOS_STORAGE = CATALOGOS_COM_SCHEMA.map(([cat, a, col, filtro]) => `select '${cat}:' || ${a}.oid::int8 as k,
  pg_catalog.pg_describe_object('pg_catalog.${cat}'::pg_catalog.regclass, ${a}.oid, 0) as rot, pg_catalog.md5(${a}::text) as v
  from pg_catalog.${cat} ${a} join pg_catalog.pg_namespace n on n.oid = ${a}.${col} where n.nspname = 'storage' and ${filtro}`).join("\nunion all\n");

const GRUPOS = { funcoes: FUNCOES, relacoes: RELACOES, schemas: SCHEMAS, papeis: PAPEIS, participacoes: PARTICIPACOES, politicas: POLITICAS, aclPadrao: ACL_PADRAO, storage: STORAGE,
  objetosStorage: OBJETOS_STORAGE };

// Grupos grandes (milhares de linhas, quase todas do próprio Postgres): em vez de trazer todas as linhas a cada
// análise, compara um resumo (md5) das linhas com chave até a maior chave da base; se o resumo bate, só as
// linhas de chave maior (os objetos novos) são lidas. Se não bate, lê tudo. A correção não depende de o
// Postgres dar chaves crescentes: um objeto novo com chave menor muda o resumo e cai na leitura completa.
const GRANDES = new Set(["funcoes", "relacoes"]);
const resumo = (sql) => `select pg_catalog.md5(coalesce(pg_catalog.string_agg(z.k || ':' || z.v, ',' order by z.k), '')) as h
  from (${sql}) z where z.k <= $1`;

/** Retrato do catálogo: para cada grupo, Map(chave -> linha). Com a base, os grupos grandes usam o resumo. */
async function retratar(db, base = null) {
  const r = {};
  for (const [nome, sql] of [...Object.entries(GRUPOS), ...OUTROS.map(([tipo, sql]) => [`outro:${tipo}`, sql])]) {
    const b = base?.retrato[nome];
    if (b && GRANDES.has(nome) && (await db.query(resumo(sql), [b.maior])).rows[0].h === b.resumo) {
      r[nome] = new Map(b);
      for (const l of (await db.query(`select * from (${sql}) z where z.k > $1`, [b.maior])).rows) r[nome].set(String(l.k), l);
      continue;
    }
    r[nome] = new Map((await db.query(sql)).rows.map((l) => [String(l.k), l]));
    if (!base && GRANDES.has(nome)) {
      r[nome].maior = Math.max(0, ...[...r[nome].keys()].map(Number));
      r[nome].resumo = (await db.query(resumo(sql), [r[nome].maior])).rows[0].h;
    }
  }
  return r;
}

/** Novos, alterados e removidos de um grupo, comparando o retrato atual com a base. */
function comparar(base, atual) {
  const novos = [];
  const alterados = [];
  const removidos = [];
  for (const [k, l] of atual) {
    const b = base.get(k);
    if (!b) novos.push(l);
    else if (b.v !== l.v) alterados.push(l);
  }
  for (const [k, l] of base) if (!atual.has(k)) removidos.push(l);
  return { novos, alterados, removidos };
}

// --- Detalhes dos objetos novos ---------------------------------------------------------------------------

/** Privilégios de tabela (e view) e de sequência, na ordem em que as mensagens os listam. */
export const PRIVS_TABELA = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];
export const PRIVS_SEQUENCIA = ["USAGE", "SELECT", "UPDATE"];

// Entradas de ACL explícitas (com a ACL nula trocada pelo padrão do Postgres): papel 'PUBLIC' para o grantee 0.
const acl = (expr, tipo, dono) => `(select coalesce(pg_catalog.json_agg(pg_catalog.json_build_object(
    'papel', case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end, 'privilegio', a.privilege_type, 'repassa', a.is_grantable)), '[]')
  from pg_catalog.aclexplode(coalesce(${expr}, pg_catalog.acldefault(${tipo}, ${dono}))) a)`;

const DETALHE_FUNCOES = `select p.oid::int8 as oid, n.nspname as schema, p.proname as nome,
  pg_catalog.format('%I.%I', n.nspname, p.proname) as rotulo, pg_catalog.pg_get_function_identity_arguments(p.oid) as args,
  (select count(*) from pg_catalog.pg_proc q where q.pronamespace = p.pronamespace and q.proname = p.proname)::int as homonimas,
  p.prokind::text as tipo, p.prosecdef as definer, coalesce(p.proconfig, '{}') as config, l.lanname as linguagem,
  -- Corpo: prosrc (texto) ou, em begin atomic, o corpo desparseado pelo próprio Postgres. Com o search_path da leitura
  -- (pg_catalog, pg_temp), as funções de public saem qualificadas e constantes (inclusive regproc) saem como texto;
  -- valores padrão de parâmetro (proargdefaults) não fazem parte do corpo.
  case when p.prosqlbody is null then p.prosrc else pg_catalog.pg_get_function_sqlbody(p.oid) end as corpo,
  pg_catalog.pg_get_userbyid(p.proowner) as dono,
  ${acl("p.proacl", "'f'", "p.proowner")} as acl,
  pg_catalog.has_function_privilege($1::oid, p.oid, 'EXECUTE') as anon_executa,
  pg_catalog.has_function_privilege($4::oid, p.oid, 'EXECUTE') as service_role_executa,
  -- Gatilhos que chamam a função: a relação de cada um (oid e rótulo). Os internos (de chave estrangeira e de unique adiável)
  -- chamam só funções embutidas do Postgres, que nunca são funções criadas pelas migrações: não precisam de filtro.
  (select coalesce(pg_catalog.json_agg(pg_catalog.json_build_object('relacao', t.tgrelid::int8, 'rotulo',
     pg_catalog.format('%I.%I', rn.nspname, rc.relname)) order by rn.nspname, rc.relname, t.tgname), '[]')
     from pg_catalog.pg_trigger t join pg_catalog.pg_class rc on rc.oid = t.tgrelid join pg_catalog.pg_namespace rn on rn.oid = rc.relnamespace
     where t.tgfoid = p.oid) as gatilhos,
  pg_catalog.has_function_privilege($2::oid, p.oid, 'EXECUTE') as authenticated_executa
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid = any($3::int8[]::oid[]) order by n.nspname, p.proname, 5`;

const privilegios = (papel, lista, fn) => `array(select x from pg_catalog.unnest(array[${lista.map((p) => `'${p}'`).join(", ")}]) x
  where pg_catalog.${fn}(${papel}::oid, c.oid, x))`;

const DETALHE_RELACOES = `select c.oid::int8 as oid, n.nspname as schema, c.relname as nome, pg_catalog.format('%I.%I', n.nspname, c.relname) as rotulo,
  c.relkind::text as tipo, c.relrowsecurity as rls, pg_catalog.pg_get_userbyid(c.relowner) as dono,
  (select o.option_value::boolean from pg_catalog.pg_options_to_table(c.reloptions) o where o.option_name = 'security_invoker') as invoker,
  ${acl("c.relacl", "case when c.relkind = 'S' then 's' else 'r' end::\"char\"", "c.relowner")} as acl,
  -- Privilégios de coluna. O filtro "not a.attisdropped" é só defesa: o Postgres zera o attacl quando a coluna é apagada
  -- (conferido nas revisões r14 e r18), então nenhum teste consegue derrubá-lo.
  (select coalesce(pg_catalog.json_agg(pg_catalog.json_build_object('coluna', a.attname,
     'papel', case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end, 'privilegio', x.privilege_type, 'repassa', x.is_grantable)), '[]')
     from pg_catalog.pg_attribute a, pg_catalog.aclexplode(a.attacl) x where a.attrelid = c.oid and a.attacl is not null and not a.attisdropped) as acl_colunas,
  (select coalesce(pg_catalog.json_agg(pg_catalog.json_build_object('nome', p.polname, 'comando', p.polcmd,
     'papeis', array(select case when r = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(r) end from pg_catalog.unnest(p.polroles) r)) order by p.polname), '[]')
     from pg_catalog.pg_policy p where p.polrelid = c.oid) as politicas,
  -- Gatilhos INSTEAD OF (bit 6 de tgtype; só existem em view): a função grava por fora da RLS da tabela de baixo.
  (select coalesce(pg_catalog.json_agg(t.tgname::text order by t.tgname), '[]') from pg_catalog.pg_trigger t
     where t.tgrelid = c.oid and (t.tgtype::int4 & 64) <> 0) as gatilhos_instead,
  case when c.relkind = 'S' then ${privilegios("$1", PRIVS_SEQUENCIA, "has_sequence_privilege")} else ${privilegios("$1", PRIVS_TABELA, "has_table_privilege")} end as anon,
  case when c.relkind = 'S' then ${privilegios("$2", PRIVS_SEQUENCIA, "has_sequence_privilege")} else ${privilegios("$2", PRIVS_TABELA, "has_table_privilege")} end as authenticated,
  case when c.relkind = 'S' then false else pg_catalog.has_any_column_privilege($1::oid, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES') end as anon_colunas,
  case when c.relkind = 'S' then false else pg_catalog.has_any_column_privilege($2::oid, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES') end as authenticated_colunas,
  case when c.relkind = 'S' then ${privilegios("$4", PRIVS_SEQUENCIA, "has_sequence_privilege")} else ${privilegios("$4", PRIVS_TABELA, "has_table_privilege")} end as service_role,
  case when c.relkind = 'S' then false else pg_catalog.has_any_column_privilege($4::oid, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES') end as service_role_colunas
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.oid = any($3::int8[]::oid[]) order by n.nspname, c.relname`;

// Privilégios de cada schema como itens "grantee:PRIVILEGIO" (ACL nula = padrão do Postgres).
const ITENS_SCHEMAS = `select n.oid::int8 as k, pg_catalog.quote_ident(n.nspname) as rotulo, pg_catalog.pg_get_userbyid(n.nspowner) as dono,
  (select pg_catalog.json_agg(x.grantee::int8 || ':' || x.privilege_type) from pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) x) as itens
  from pg_catalog.pg_namespace n`;
const DETALHE_SCHEMAS = `${ITENS_SCHEMAS} where n.oid = any($1::int8[]::oid[])`;

// Tipos (pg_type: inclui o tipo de linha de cada tabela, view e tipo composto, domínios e enums), para saber quais
// as migrações criaram (os que não estão na base).
const TIPOS = `select t.oid::int8 as k, n.nspname as schema, t.typname as nome, pg_catalog.format('%I.%I', n.nspname, t.typname) as rotulo
  from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace where ${SEM_TEMPORARIOS}`;

const DETALHE_PAPEIS = `select r.oid::int8 as k, pg_catalog.quote_ident(r.rolname) as rotulo, r.rolsuper as superusuario, r.rolbypassrls as bypassrls,
  r.rolreplication as replicacao
  from pg_catalog.pg_roles r where r.oid = any($1::int8[]::oid[])`;

// --- Instância compartilhada ------------------------------------------------------------------------------

let instancia = null; // Promise<{ db, base }>, criada na primeira análise e reaproveitada pelas seguintes
let fila = Promise.resolve(); // análises em série: cada uma usa a instância dentro de uma transação própria

async function criarInstancia() {
  if (!fs.existsSync(SIMULACAO)) throw new Error(`simulação do Supabase ausente: ${path.relative(RAIZ, SIMULACAO)}`);
  if (!fs.existsSync(DONO_MIGRACAO)) throw new Error(`dono das migrações ausente: ${path.relative(RAIZ, DONO_MIGRACAO)}`);
  const db = new PGlite();
  // Superusuário desta instância (o usuário da sessão do PGlite), para onde voltar() volta.
  const superusuario = (await db.query("select pg_catalog.quote_ident(session_user) as u")).rows[0].u;
  await db.exec(fs.readFileSync(SIMULACAO, "utf8"));
  await db.exec(fs.readFileSync(DONO_MIGRACAO, "utf8")); // como superusuário, logo depois da simulação (como em banco.ts)
  await db.exec(CAMINHO_SEGURO);
  const dono = (await db.query("select oid::int8 as oid, rolsuper from pg_catalog.pg_roles where rolname = $1", [DONO])).rows[0];
  if (!dono) throw new Error(`${path.relative(RAIZ, DONO_MIGRACAO)} não criou o papel ${DONO}`);
  if (dono.rolsuper) throw new Error(`o papel ${DONO} (dono das migrações) é superusuário: no Supabase o papel postgres não é`);
  const papeis = (await db.query(`select rolname, oid::int8 as oid from pg_catalog.pg_roles where rolname in ('anon', 'authenticated', 'service_role')`)).rows;
  const oid = (nome) => {
    const p = papeis.find((r) => r.rolname === nome);
    if (!p) throw new Error(`a simulação do Supabase não criou o papel ${nome}`);
    return Number(p.oid);
  };
  const base = {
    retrato: await retratar(db),
    itensSchemas: new Map((await db.query(ITENS_SCHEMAS)).rows.map((l) => [String(l.k), l.itens ?? []])),
    tipos: new Set((await db.query(TIPOS)).rows.map((l) => String(l.k))),
    anon: oid("anon"),
    authenticated: oid("authenticated"),
    serviceRole: oid("service_role"),
    dono: DONO,
    donoOid: Number(dono.oid),
    // PLA-003, D13: o dono das relações de storage e o schema (oids como texto; ausentes se a simulação não os tiver).
    storageAdmin: (await db.query("select oid::int8::text as k from pg_catalog.pg_roles where rolname = 'supabase_storage_admin'")).rows[0]?.k,
    schemaStorage: (await db.query("select oid::int8::text as k from pg_catalog.pg_namespace where nspname = 'storage'")).rows[0]?.k,
    bucketsOid: (await db.query("select pg_catalog.to_regclass('storage.buckets')::oid::int8::text as k")).rows[0]?.k ?? null,
    superusuario,
  };
  // Cópia do diretório de dados da base, para as instâncias descartáveis das análises com commit (analisarComCommits).
  base.dados = await db.dumpDataDir("none");
  return { db, base };
}

function descartarInstancia() {
  const atual = instancia;
  instancia = null;
  if (atual) atual.then(({ db }) => db.close()).catch(() => undefined);
}

/**
 * Volta ao superusuário da instância, sem papel (o `set session authorization` também zera o `set role`), com os parâmetros padrão e o search_path seguro (CAMINHO_SEGURO).
 * No PGlite, `reset session authorization`, `discard all` e o rollback de um `set session authorization` feito sem
 * valor anterior na sessão não voltam ao superusuário; só um `set session authorization <superusuário>` explícito.
 */
const voltar = (base) => `set session authorization ${base.superusuario}; reset all; ${CAMINHO_SEGURO}`;

/** Normaliza a entrada: texto SQL (uma migração chamada "sql") ou lista [{ arquivo, sql }]. */
function migracoesDe(entrada) {
  return typeof entrada === "string" ? [{ arquivo: "sql", sql: entrada }] : entrada;
}

/**
 * Aplica as migrações (texto SQL ou lista [{ arquivo, sql }], em ordem) sobre a simulação do Supabase e devolve
 * { erro, catalogo }: `erro` é a mensagem do Postgres (com o arquivo) quando uma migração falha ou foge da
 * transação; `catalogo` descreve o que as migrações criaram, alteraram ou removeram.
 * Uma migração roda numa transação desfeita no fim (rollback), sobre uma instância reaproveitada; duas ou mais, cada uma
 * com o seu commit, numa instância descartável restaurada da base (correção 18).
 */
export function analisarMigracoes(entrada) {
  const vez = fila.then(() => analisar(migracoesDe(entrada)));
  fila = vez.catch(() => undefined);
  return vez;
}

async function analisar(migracoes) {
  if (!instancia) instancia = criarInstancia();
  let inst;
  try {
    inst = await instancia;
  } catch (e) {
    instancia = null;
    throw e;
  }
  try {
    // Uma migração: numa transação sobre a instância compartilhada, desfeita no fim (o fim é simulado por
    // fimDaMigracao, como o commit). Duas ou mais: cada uma com o seu commit real, numa instância descartável
    // restaurada da base (correção 18), porque o efeito do commit muda o que a seguinte pode fazer (alter type ...
    // add value numa migração, usado na seguinte, só funciona depois do commit).
    if (migracoes.length > 1) return await analisarComCommits(inst.base, migracoes);
    const r = await analisarEm(inst.db, inst.base, migracoes);
    // Objeto temporário sobrando numa migração única: só o commit real mostra se ele some (on commit drop); a análise
    // é refeita com o commit. Os outros efeitos do commit (constraints e gatilhos adiados) o fim simulado já reproduz.
    return r.erro?.includes(SOBRA_TEMPORARIA) ? await analisarComCommits(inst.base, migracoes) : r;
  } catch (e) {
    descartarInstancia(); // estado desconhecido: a próxima análise começa de uma instância nova
    throw e;
  }
}

const xidAtual = async (db) => (await db.query("select pg_catalog.pg_current_xact_id()::text as x")).rows[0].x;

/**
 * Aplica uma migração dentro da transação já aberta (de xid `transacao`) e simula o fim dela (fimDaMigracao); com
 * `commit`, o fim é o commit real da transação. Devolve a mensagem de erro, ou null.
 */
async function aplicarMigracao(db, base, m, transacao, commit) {
  // Cada migração começa como uma sessão nova do dono (no editor, cada uma é aplicada à parte), com o search_path
  // padrão; o fim de cada uma (commit e fim de sessão) fica com fimDaMigracao(). O dono entra como usuário
  // da sessão (set session authorization), não só como papel (set role): assim um `reset role` da migração volta
  // a postgres_sim, como voltaria a postgres no Supabase, e não ao superusuário daqui. Aqui a sessão já é a do
  // superusuário (desde a criação da instância, e por voltar() no fim de cada análise e de cada migração).
  await db.exec(`reset all; set session authorization ${DONO}`);
  const avisos = [];
  if (m.sql.startsWith("\uFEFF")) { // o Postgres leria a marca como parte do primeiro comando ("syntax error at or near")
    return `${m.arquivo}: começa com a marca de ordem de bytes (BOM UTF-8): salve o arquivo sem BOM`;
  }
  let erro = null;
  await db.exec(`savepoint ${INICIO_DA_MIGRACAO}`); // para achar a linha de um erro sem posição (linhaSemPosicao)
  try {
    await db.exec(m.sql, { onNotice: (n) => avisos.push(n) });
  } catch (e) {
    erro = `${m.arquivo}: erro de SQL: ${await mensagemDoPostgres(db, e, m.sql)}`;
  }
  // begin/commit/rollback dentro da migração: no editor do Supabase mudariam o que fica gravado, e aqui
  // tirariam a migração da transação dela. Sinais: fora de transação, aviso 25001 (já há transação) ou 25P01
  // (não há transação), ou outra transação (outro xid) depois de um commit seguido de begin.
  if (!db.isInTransaction() || avisos.some((n) => n.code === "25001" || n.code === "25P01") || (!erro && (await xidAtual(db)) !== transacao)) {
    erro ??= `${m.arquivo}: controle de transação (begin/commit/rollback/end) na migração: forma não suportada`;
  }
  return erro ?? (await fimDaMigracao(db, base, m.arquivo, commit));
}

/** Uma migração (ou nenhuma) numa transação sobre a base: aplica, lê o catálogo e volta à base (rollback). */
async function analisarEm(db, base, migracoes) {
  await db.exec("begin");
  const transacao = await xidAtual(db);
  let erro = null;
  for (const m of migracoes) {
    erro = await aplicarMigracao(db, base, m, transacao, false);
    if (erro) break;
  }
  let catalogo = null;
  if (!erro) catalogo = await lerOuErro(db, base);
  if (typeof catalogo === "string") [erro, catalogo] = [catalogo, null];
  // Volta à base: desfaz a transação e limpa o estado de sessão (discard all não roda dentro de transação).
  // Se algo foi gravado fora da transação (commit dentro da migração), a instância deixa de ser a base.
  if (db.isInTransaction()) await db.exec("rollback");
  await db.exec("discard all");
  await db.exec(voltar(base));
  if (erro && !(await baseIntacta(db, base))) descartarInstancia();
  return { erro, catalogo: erro ? null : catalogo };
}

/**
 * Duas ou mais migrações, cada uma na sua transação, com commit real, como no Supabase (correção 18, revisão 16): numa
 * instância descartável, restaurada da cópia do diretório de dados da base (dumpDataDir, tirada ao criar a base; mesmos OIDs,
 * então o retrato da base continua valendo). A sessão é uma só, como na aplicação em lote: o que a sessão guarda entre
 * as migrações é recusado ou descartado por fimDaMigracao(). A instância é fechada no fim.
 */
async function analisarComCommits(base, migracoes) {
  const db = new PGlite({ loadDataDir: base.dados });
  try {
    let erro = null;
    for (const m of migracoes) {
      await db.exec("begin");
      erro = await aplicarMigracao(db, base, m, await xidAtual(db), true);
      if (erro) break;
    }
    let catalogo = null;
    if (!erro) catalogo = await lerOuErro(db, base);
    if (typeof catalogo === "string") [erro, catalogo] = [catalogo, null];
    return { erro, catalogo: erro ? null : catalogo };
  } finally {
    await db.close();
  }
}

/** Catálogo depois das migrações (como superusuário: fimDaMigracao() já chamou voltar()), ou a mensagem de erro. */
async function lerOuErro(db, base) {
  try {
    return await lerCatalogo(db, base);
  } catch (e) {
    return `não foi possível ler o catálogo depois das migrações: ${e instanceof Error ? e.message : String(e)}`;
  }
}

const SOBRA_TEMPORARIA = "objeto temporário sobrando no fim da migração";

// Objetos do schema temporário desta sessão (tabela, view, sequência, função, tipo...): todos dependem do schema.
const TEMPORARIOS = `select pg_catalog.pg_describe_object(d.classid, d.objid, d.objsubid) as o from pg_catalog.pg_depend d
  where d.refclassid = 'pg_catalog.pg_namespace'::pg_catalog.regclass and d.refobjid = pg_catalog.pg_my_temp_schema() order by 1`;
// Gatilhos de constraint adiáveis (create constraint trigger ... deferrable). Os internos (de chave estrangeira,
// unique e exclusion adiáveis) só conferem dados e ficam de fora.
const GATILHOS_ADIAVEIS = `select pg_catalog.quote_ident(t.tgname) || ' em ' || t.tgrelid::pg_catalog.regclass::text as o
  from pg_catalog.pg_trigger t where t.tgdeferrable and not t.tgisinternal order by 1`;

/**
 * Fim de uma migração: o que o commit e o fim da sessão fariam no Supabase, onde cada migração tem a sua transação.
 * Com duas ou mais migrações, o fim é o commit real (`commit`); com uma só, a transação é desfeita depois da leitura,
 * e o commit é simulado. Em ordem:
 * 0. O usuário da sessão tem de continuar o dono: trocá-lo (`set session authorization`) só funciona aqui, onde a
 *    sessão nasce de um superusuário; no Supabase, o postgres não consegue. A troca é recusada (falha fechada).
 * 1. O commit (ou, numa migração só, `set constraints all immediate`, que dispara o que o commit dispararia:
 *    constraints e gatilhos adiados); um erro aí é erro da migração, como o commit recusado.
 * 2. Gatilho de constraint adiável: forma não suportada, por decisão (falha fechada, desde a revisão 13). Com o commit
 *    por migração, o que ele faz no commit é conferido; a recusa fica porque ele muda o momento em que a regra roda.
 * 3. Objeto temporário sobrando: forma não suportada. Se a migração seguinte rodar numa sessão nova, ele some e
 *    um nome sem schema passa a ser o de public; se rodar na mesma sessão (aplicação em lote, como aqui), ele
 *    continua. Como não dá para saber qual vale, a checagem recusa (falha fechada).
 * 4. Descarta o estado de sessão que uma sessão nova não teria e que a migração seguinte poderia usar: cursores
 *    (`with hold`), comandos preparados, travas consultivas e o valor corrente das sequências (`currval`).
 *    `listen` e os planos guardados não mudam resultado (o Postgres invalida os planos a cada DDL e mudança de
 *    search_path).
 * Devolve a mensagem de erro, ou null.
 */
async function fimDaMigracao(db, base, arquivo, commit) {
  const sessao = (await db.query("select session_user as u")).rows[0].u;
  if (sessao !== DONO) {
    return `${arquivo}: a migração trocou o usuário da sessão para ${sessao} (set session authorization): só um superusuário consegue; no Supabase quem aplica as migrações (postgres) não é superusuário`;
  }
  try {
    await db.exec(commit ? "commit" : "set constraints all immediate");
  } catch (e) {
    return `${arquivo}: erro de SQL no fim da migração (no commit, ao conferir as constraints e disparar os gatilhos adiados): ${e instanceof Error ? e.message : String(e)}`;
  }
  await db.exec(voltar(base));
  const lista = async (sql) => (await db.query(sql)).rows.map((l) => l.o.replace(/\bpg_temp_\d+\./g, "pg_temp."));
  const adiaveis = await lista(GATILHOS_ADIAVEIS);
  if (adiaveis.length) {
    return `${arquivo}: gatilho de constraint adiável (deferrable) ${adiaveis.join(", ")}: forma não suportada (falha fechada, decisão desde a revisão 13: um gatilho adiável muda o momento em que a regra roda, o que é difícil de conferir na migração isolada)`;
  }
  const temporarios = await lista(TEMPORARIOS);
  if (temporarios.length) {
    return `${arquivo}: ${SOBRA_TEMPORARIA} (${temporarios.join(", ")}): forma não suportada; apague-o na própria migração (drop)`;
  }
  await db.exec("close all; deallocate all; select pg_catalog.pg_advisory_unlock_all(); discard sequences");
  return null;
}

/** O catálogo voltou exatamente ao retrato da base? */
async function baseIntacta(db, base) {
  const atual = await retratar(db, base);
  return Object.keys(atual).every((nome) => {
    const d = comparar(base.retrato[nome], atual[nome]);
    return d.novos.length + d.alterados.length + d.removidos.length === 0;
  });
}

/** Mensagem de erro do Postgres, com a linha da migração (da posição informada pelo Postgres ou de linhaSemPosicao). */
async function mensagemDoPostgres(db, e, sql) {
  if (!(e instanceof Error)) return String(e);
  const pos = Number(e.position);
  const linha = pos > 0 ? sql.slice(0, pos - 1).split("\n").length : await linhaSemPosicao(db, sql, e.message);
  return linha ? `${e.message} (linha ${linha})` : e.message;
}

const INICIO_DA_MIGRACAO = "catalogo_inicio_da_migracao";

/**
 * Linha do erro quando o Postgres não informa a posição (erros de execução, como "permission denied to create role"):
 * volta ao início da migração (savepoint) e procura, por busca binária, o menor trecho de linhas iniciais que dá o
 * mesmo erro; cada tentativa é desfeita. O trecho cortado no meio de um comando dá erro de sintaxe (o Postgres lê o
 * texto inteiro antes de executar), e um trecho que já inclui o comando que falhou para nele. Devolve null quando
 * não dá para voltar ao início (a migração saiu da transação ou apagou o savepoint).
 */
async function linhaSemPosicao(db, sql, mensagem) {
  try {
    await db.exec(`rollback to savepoint ${INICIO_DA_MIGRACAO}`);
    const linhas = sql.split("\n");
    let [inicio, fim] = [1, linhas.length];
    while (inicio < fim) {
      const meio = Math.floor((inicio + fim) / 2);
      // um comando preparado não é desfeito pelo rollback (nem o da migração que falhou): sem o deallocate, o
      // `prepare` da tentativa daria outro erro; no início da migração não há nenhum (fimDaMigracao os descarta)
      await db.exec("deallocate all; savepoint catalogo_tentativa");
      let repetiu = false;
      try {
        await db.exec(linhas.slice(0, meio).join("\n"));
      } catch (e) {
        repetiu = e instanceof Error && e.message === mensagem;
      }
      await db.exec("rollback to savepoint catalogo_tentativa");
      if (repetiu) fim = meio;
      else inicio = meio + 1;
    }
    return inicio;
  } catch {
    return null;
  }
}

/** Ganhos de privilégio (itens "grantee:PRIVILEGIO" que não existiam) de cada grantee. */
function ganhos(itens, antes) {
  const porPapel = new Map();
  for (const item of itens ?? []) {
    if (antes.has(item)) continue;
    const [grantee, privilegio] = item.split(":");
    if (!porPapel.has(grantee)) porPapel.set(grantee, []);
    porPapel.get(grantee).push(privilegio);
  }
  return porPapel;
}

async function lerCatalogo(db, base) {
  const atual = await retratar(db, base);
  const dif = {};
  for (const nome of Object.keys(atual)) dif[nome] = comparar(base.retrato[nome], atual[nome]);
  const ids = (linhas) => linhas.map((l) => String(l.k));
  const params = (linhas) => [base.anon, base.authenticated, ids(linhas)];

  const funcoes = dif.funcoes.novos.length ? (await db.query(DETALHE_FUNCOES, [...params(dif.funcoes.novos), base.serviceRole])).rows : [];
  const relacoes = dif.relacoes.novos.length ? (await db.query(DETALHE_RELACOES, [...params(dif.relacoes.novos), base.serviceRole])).rows : [];

  // Schemas: o dono e os privilégios ganhos por anon/PUBLIC (contra a base, ou contra o padrão para schema novo).
  const tocados = [...dif.schemas.novos, ...dif.schemas.alterados];
  const schemas = [];
  if (tocados.length) {
    for (const l of (await db.query(DETALHE_SCHEMAS, [ids(tocados)])).rows) {
      const antes = new Set(base.itensSchemas.get(String(l.k)) ?? []);
      schemas.push({ rotulo: l.rotulo, dono: l.dono, ganhos: ganhos(l.itens, antes) });
    }
  }

  const tiposNovos = (await db.query(TIPOS)).rows.filter((l) => !base.tipos.has(String(l.k))).map(({ schema, nome, rotulo }) => ({ schema, nome, rotulo }));
  const papeisNovos = dif.papeis.novos.length ? (await db.query(DETALHE_PAPEIS, [ids(dif.papeis.novos)])).rows : [];

  // Privilégios padrão: ganhos contra a linha da base (ou, numa linha global nova, contra o padrão do Postgres).
  const aclPadrao = [];
  for (const l of [...dif.aclPadrao.novos, ...dif.aclPadrao.alterados]) {
    const b = base.retrato.aclPadrao.get(String(l.k));
    const antes = new Set(b ? b.itens ?? [] : l.padrao ?? []);
    aclPadrao.push({ rotulo: l.rot, tipo: l.tipo, ganhos: ganhos(l.itens, antes) });
  }

  const outros = OUTROS.flatMap(([tipo]) => {
    const d = dif[`outro:${tipo}`];
    return [
      ...d.novos.map((l) => ({ tipo, rotulo: l.rot, mudanca: "criação" })),
      ...d.alterados.map((l) => ({ tipo, rotulo: l.rot, mudanca: "alteração" })),
      ...d.removidos.map((l) => ({ tipo, rotulo: l.rot, mudanca: "remoção" })),
    ];
  });

  const nomes = new Map([["0", "PUBLIC"], ...(await db.query("select oid::int8 as k, rolname from pg_catalog.pg_roles")).rows.map((l) => [String(l.k), l.rolname])]);
  // Relações de storage da base: as mudanças nelas saem em mudancasEmStorage, não em relacoesPreexistentes (PLA-003, D13).
  const emStorage = new Set(base.retrato.storage.keys());
  return {
    papeisDoSupabase: { anon: String(base.anon), authenticated: String(base.authenticated), serviceRole: String(base.serviceRole) },
    nomeDoPapel: (oid) => nomes.get(String(oid)) ?? `papel ${oid}`,
    donoDasMigracoes: base.dono,
    donoDasMigracoesOid: String(base.donoOid),
    funcoes,
    funcoesPreexistentes: mudancas(dif.funcoes),
    relacoes,
    relacoesPreexistentes: mudancas(dif.relacoes, emStorage),
    mudancasEmStorage: mudancasEmStorage(dif.storage, base.retrato.storage),
    // Privilégios padrão de supabase_storage_admin ou do schema storage criados, alterados ou removidos (D13: a participação
    // do dono simulado em supabase_storage_admin deixa mudá-los, e o postgres real não consegue).
    aclPadraoEmStorage: [["criação", dif.aclPadrao.novos], ["alteração", dif.aclPadrao.alterados], ["remoção", dif.aclPadrao.removidos]].flatMap(([mudanca, linhas]) =>
      linhas.filter((l) => String(l.papel) === base.storageAdmin || String(l.esquema) === base.schemaStorage).map((l) => ({ rotulo: l.rot, mudanca }))),
    politicasEmPreexistentes: politicasEmPreexistentes(dif.politicas, new Set(ids(dif.relacoes.novos))),
    schemas,
    schemasPreexistentes: mudancas(dif.schemas),
    tiposNovos,
    papeisNovos,
    papeisPreexistentes: mudancas(dif.papeis),
    participacoesNovas: dif.participacoes.novos.map((l) => ({ rotulo: l.rot, chave: String(l.k) })),
    aclPadrao,
    // Estado final só dos privilégios padrão do dono: só ele cria objetos (a regra de dono recusa os de outro papel).
    aclPadraoFinal: [...atual.aclPadrao.values()].filter((l) => Number(l.papel) === base.donoOid).map((l) => ({ rotulo: l.rot, tipo: l.tipo, itens: l.itens ?? [] })),
    outros,
    // Objetos do schema storage que não são relação, criados, alterados ou removidos (revisão 1 da Tarefa 2, I1).
    objetosEmStorage: [["criação", dif.objetosStorage.novos], ["alteração", dif.objetosStorage.alterados], ["remoção", dif.objetosStorage.removidos]]
      .flatMap(([mudanca, linhas]) => linhas.map((l) => ({ rotulo: l.rot, mudanca }))),
    // Linhas de storage.buckets no fim (dados, não catálogo), lidas como superusuário (PLA-003, D13: regra do bucket); null
    // quando a tabela da base não está mais em storage.buckets (movida, renomeada ou apagada; revisão 1, N3). Sem
    // storage.buckets na base (simulação sem storage), lista vazia.
    bucketsFinais: await lerBuckets(db, base),
  };
}

const BUCKETS_FINAIS = "select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id";

async function lerBuckets(db, base) {
  if (base.bucketsOid === null) return [];
  const agora = (await db.query("select pg_catalog.to_regclass('storage.buckets')::oid::int8::text as k")).rows[0].k;
  return agora === base.bucketsOid ? (await db.query(BUCKETS_FINAIS)).rows : null;
}

/** Objetos da base alterados ou removidos pelas migrações: [{ rotulo, mudanca: "alteração" | "remoção" }], sem as chaves de `fora`. */
function mudancas(d, fora = new Set()) {
  const fica = (l) => !fora.has(String(l.k));
  return [...d.alterados.filter(fica).map((l) => ({ rotulo: l.rot, mudanca: "alteração" })), ...d.removidos.filter(fica).map((l) => ({ rotulo: l.rot, mudanca: "remoção" }))];
}

/**
 * Relações do schema storage da base alteradas ou removidas: [{ rotulo, itens, mudanca }], com os itens de ITENS_STORAGE
 * que mudaram (vazio na remoção). Relação nova em storage não entra aqui: ela já é acusada como relação nova.
 */
function mudancasEmStorage(d, base) {
  return [
    ...d.alterados.map((l) => {
      const antes = JSON.parse(base.get(String(l.k)).v);
      const depois = JSON.parse(l.v);
      return { rotulo: l.rot, itens: ITENS_STORAGE.filter((i) => antes[i] !== depois[i]), mudanca: "alteração" };
    }),
    ...d.removidos.map((l) => ({ rotulo: l.rot, itens: [], mudanca: "remoção" })),
  ];
}

/**
 * Políticas criadas, alteradas ou removidas em relações que não foram criadas pelas migrações:
 * [{ rotulo, relacao, papeis, comando, usando, comCheck, mudanca }] (na remoção, os campos da base).
 */
function politicasEmPreexistentes(d, relacoesNovas) {
  const forma = (mudanca) => (l) => ({ rotulo: l.rot, relacao: l.relacao, papeis: l.papeis, comando: l.comando, usando: l.usando, comCheck: l.com_check, mudanca });
  const fica = (l) => !relacoesNovas.has(String(l.rel));
  return [...d.novos.filter(fica).map(forma("criação")), ...d.alterados.filter(fica).map(forma("alteração")), ...d.removidos.filter(fica).map(forma("remoção"))];
}

// --- Linha de comando -------------------------------------------------------------------------------------

/** Nomes de arquivo de migração (.sql) em ordem de nome. */
export function ordenarMigracoes(nomes) {
  return nomes.filter((f) => f.endsWith(".sql")).sort();
}

// Nome que a Supabase CLI aplica (`supabase db push`): dígitos (o carimbo), "_", nome, ".sql". Fora disso a CLI
// deixa o arquivo de fora, e a checagem não pode aprovar o que não seria aplicado (falha fechada).
const NOME_DA_CLI = /^[0-9]+_.*\.sql$/;

/**
 * Migrações de um diretório, em ordem de nome: [{ arquivo, sql }]; vazio se o diretório não existir.
 * Lança um erro com o nome quando um `.sql` não é arquivo (por exemplo, um subdiretório `x.sql`) ou quando
 * o nome foge do padrão da Supabase CLI (`<dígitos>_nome.sql`).
 */
export function lerMigracoes(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return ordenarMigracoes(fs.readdirSync(dir)).map((f) => {
    const caminho = path.join(dir, f);
    if (!fs.statSync(caminho).isFile()) throw new Error(`${f}: não é um arquivo`);
    if (!NOME_DA_CLI.test(f)) throw new Error(`${f}: nome fora do padrão da Supabase CLI (<dígitos>_nome.sql): a CLI não aplicaria o arquivo`);
    return { arquivo: f, sql: fs.readFileSync(caminho, "utf8") };
  });
}

/** Verdadeiro quando o módulo foi executado direto (também por link simbólico), não importado. */
export function executadoDiretamente(urlDoModulo) {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(urlDoModulo);
  } catch {
    return false;
  }
}

/** Linha de comando das checagens de banco: `node scripts/<nome>.mjs [diretório-de-migrações]`. */
export async function executar(nome, verificar, argv = process.argv) {
  if (argv.length > 3) {
    console.error(`uso: node scripts/${nome}.mjs [diretório-de-migrações]`);
    process.exit(2);
  }
  const dir = argv[2] ? path.resolve(argv[2]) : path.join(RAIZ, "supabase", "migrations");
  const r = reporter(nome);
  let migracoes = [];
  try {
    migracoes = lerMigracoes(dir);
  } catch (e) {
    r.erro(`não foi possível ler as migrações: ${e instanceof Error ? e.message : String(e)}`);
    r.fim();
  }
  if (migracoes.length === 0) {
    r.erro(`nenhuma migração .sql em ${path.relative(RAIZ, dir) || dir}: a checagem não conferiu nada`);
    r.fim();
  }
  try {
    for (const e of await verificar(migracoes)) r.erro(e);
  } catch (e) {
    r.erro(`não foi possível analisar as migrações: ${e instanceof Error ? e.message : String(e)}`);
  }
  r.fim(`${migracoes.length} migração(ões)`);
}
