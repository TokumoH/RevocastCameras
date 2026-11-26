import { PGlite } from '@electric-sql/pglite'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { analisarMigracoes } from '../_catalogo.mjs'

// O primeiro teste inicializa o PGlite (alguns segundos, mais com a máquina ocupada).
vi.setConfig({ testTimeout: 60_000 })

const TABELA = 'create table public.t (id int);'
const nomes = (r) => r.catalogo.relacoes.map((x) => x.rotulo)

describe('analisarMigracoes', () => {
  test('aceita texto (migração "sql") e lista [{ arquivo, sql }], aplicada em ordem', async () => {
    expect(nomes(await analisarMigracoes(TABELA))).toEqual(['public.t'])
    const r = await analisarMigracoes([
      { arquivo: 'a.sql', sql: TABELA },
      { arquivo: 'b.sql', sql: 'alter table public.t rename to u;' },
    ])
    expect(r.erro).toBeNull()
    expect(nomes(r)).toEqual(['public.u'])
  })

  test('erro numa migração cita o arquivo e para ali', async () => {
    const r = await analisarMigracoes([
      { arquivo: 'a.sql', sql: TABELA },
      { arquivo: 'b.sql', sql: 'select 1/0;' },
      { arquivo: 'c.sql', sql: 'select 1/0 + 1;' },
    ])
    expect(r).toEqual({ erro: 'b.sql: erro de SQL: division by zero (linha 1)', catalogo: null })
  })

  // Revisão 12, N5: sem esta conferência, o Postgres diria só 'syntax error at or near "﻿create"'.
  test('migração que começa com BOM UTF-8: mensagem clara, e a seguinte não roda', async () => {
    const r = await analisarMigracoes([
      { arquivo: 'a.sql', sql: TABELA },
      { arquivo: 'b.sql', sql: `﻿${TABELA.replace('public.t', 'public.u')}` },
      { arquivo: 'c.sql', sql: 'select 1/0;' },
    ])
    expect(r).toEqual({ erro: 'b.sql: começa com a marca de ordem de bytes (BOM UTF-8): salve o arquivo sem BOM', catalogo: null })
    expect(nomes(await analisarMigracoes(`${TABELA} -- ﻿ no meio não é BOM`))).toEqual(['public.t'])
  })

  test('cada análise parte da base: o que uma análise criou não aparece na seguinte', async () => {
    await analisarMigracoes('create table public.sobra (id int);')
    expect(nomes(await analisarMigracoes(TABELA))).toEqual(['public.t'])
  })

  test.each([
    ['commit', `${TABELA} commit;`],
    ['commit seguido de begin (outra transação)', `${TABELA} commit; begin; revoke all on public.t from anon;`],
    ['begin dentro da migração', `begin; ${TABELA}`],
    ['rollback seguido de begin', `rollback; begin; ${TABELA}`],
    ['end', `${TABELA} end;`],
    ['commit seguido de erro', `${TABELA} commit; select 1/0;`],
  ])('controle de transação (%s): forma não suportada, e a base continua limpa', async (_caso, sql) => {
    const r = await analisarMigracoes(sql)
    expect(r.catalogo).toBeNull()
    expect(r.erro).toMatch(/^sql: (controle de transação \(begin\/commit\/rollback\/end\) na migração: forma não suportada|erro de SQL: division by zero)$/)
    const limpa = await analisarMigracoes('select 1;')
    expect(limpa.erro).toBeNull()
    expect(limpa.catalogo.relacoes).toEqual([])
    expect(limpa.catalogo.outros).toEqual([])
  })

  test('análises simultâneas rodam em série, cada uma com o seu resultado', async () => {
    const [a, b] = await Promise.all([analisarMigracoes('create table public.a (id int);'), analisarMigracoes('create table public.b (id int);')])
    expect(nomes(a)).toEqual(['public.a'])
    expect(nomes(b)).toEqual(['public.b'])
  })

  test('tabela temporária com nome de catálogo (pg_class, pg_depend) não engana a leitura do catálogo', async () => {
    const r = await analisarMigracoes(`create temp table pg_class (x int); create temp table pg_depend (x int); ${TABELA} drop table pg_temp.pg_class, pg_temp.pg_depend;`)
    expect(nomes(r)).toEqual(['public.t'])
    // sobrando no fim, são acusadas pelo nome: a consulta dos temporários também não é enganada
    const s = await analisarMigracoes(`create temp table pg_class (x int); create temp table pg_depend (x int); create function pg_temp.f() returns int language sql as 'select 1'; ${TABELA}`)
    expect(s).toEqual({ erro: 'sql: objeto temporário sobrando no fim da migração (function pg_temp.f(), table pg_temp.pg_class, table pg_temp.pg_depend): forma não suportada; apague-o na própria migração (drop)', catalogo: null })
  })

  test('set search_path e set role da migração não mudam a leitura do catálogo', async () => {
    const r = await analisarMigracoes(`${TABELA} set session authorization postgres; create schema s authorization postgres_sim; set session authorization postgres_sim;
create table s.pg_class (x int); set search_path = s, public; set role anon;`)
    expect(nomes(r)).toEqual(['public.t', 's.pg_class'])
  })

  // Revisão 13, I1: o fim de cada migração (commit e fim da sessão no Supabase) é simulado por fimDaMigracao().
  const CENAS = 'create table public.cenas (id int); alter table public.cenas enable row level security;'
  test('prova 1 da r13: tabela temporária de uma migração não engana a seguinte (forma não suportada)', async () => {
    const r = await analisarMigracoes([
      { arquivo: 'a.sql', sql: `${CENAS} create temp table cenas (id int);` },
      { arquivo: 'b.sql', sql: 'alter table cenas disable row level security;' },
    ])
    expect(r).toEqual({ erro: 'a.sql: objeto temporário sobrando no fim da migração (table cenas): forma não suportada; apague-o na própria migração (drop)', catalogo: null })
  })

  const GATILHO = `${CENAS}
create table public.gatilho (id int);
create function public.no_commit() returns trigger language plpgsql as $$ begin execute 'alter table public.cenas disable row level security'; return null; end $$;
create constraint trigger tg after insert on public.gatilho deferrable initially deferred for each row execute function public.no_commit();`
  test('prova 2 da r13: gatilho de constraint adiável é forma não suportada (também sem evento pendente)', async () => {
    const erro = 'a.sql: gatilho de constraint adiável (deferrable) tg em public.gatilho: forma não suportada (falha fechada, decisão desde a revisão 13: um gatilho adiável muda o momento em que a regra roda, o que é difícil de conferir na migração isolada)'
    expect(await analisarMigracoes([{ arquivo: 'a.sql', sql: `${GATILHO} insert into public.gatilho values (1);` }])).toEqual({ erro, catalogo: null })
    expect(await analisarMigracoes([{ arquivo: 'a.sql', sql: GATILHO }, { arquivo: 'b.sql', sql: 'insert into public.gatilho values (1);' }])).toEqual({ erro, catalogo: null })
  })

  test('gatilho de constraint não adiável: aceito, e já disparou no fim do comando', async () => {
    const sql = `${GATILHO.replace('deferrable initially deferred ', '')} insert into public.gatilho values (1);`
    const r = await analisarMigracoes(sql)
    expect(r.erro).toBeNull()
    expect(r.catalogo.relacoes.find((x) => x.rotulo === 'public.cenas').rls).toBe(false)
  })

  const FK = 'create table public.a (id int primary key); create table public.b (a int references public.a deferrable initially deferred);'
  test('chave estrangeira adiável violada: o commit recusaria, a checagem acusa no fim da migração', async () => {
    const r = await analisarMigracoes([{ arquivo: 'a.sql', sql: `${FK} insert into public.b values (1);` }, { arquivo: 'b.sql', sql: 'select 1/0;' }])
    expect(r).toEqual({
      erro: 'a.sql: erro de SQL no fim da migração (no commit, ao conferir as constraints e disparar os gatilhos adiados): insert or update on table "b" violates foreign key constraint "b_a_fkey"',
      catalogo: null,
    })
    expect((await analisarMigracoes(`${FK} insert into public.b values (1); insert into public.a values (1);`)).erro).toBeNull()
  })

  test.each([
    ['comando preparado', 'prepare p as select 1;', 'execute p;', 'prepared statement "p" does not exist'],
    ['cursor with hold', 'declare c cursor with hold for select 1;', 'fetch c;', 'cursor "c" does not exist'],
    ['trava consultiva', 'select pg_advisory_lock(1);', "do $$ begin if pg_advisory_unlock(1) then raise exception 'trava passou'; end if; end $$;", null],
    ['valor corrente de sequência', 'create sequence public.s; select nextval(\'public.s\');', "select currval('public.s');", 'currval of sequence "s" is not yet defined in this session'],
  ])('estado de sessão não passa para a migração seguinte: %s', async (_caso, a, b, msg) => {
    const r = await analisarMigracoes([{ arquivo: 'a.sql', sql: `${TABELA} ${a}` }, { arquivo: 'b.sql', sql: b }])
    if (msg === null) expect(r.erro).toBeNull() // pg_advisory_unlock devolve falso: a trava não passou
    else expect(r).toEqual({ erro: `b.sql: erro de SQL: ${msg} (linha 1)`, catalogo: null })
  })

  test('privilégios padrão: o estado final de todas as linhas e os ganhos das alteradas', async () => {
    const r = await analisarMigracoes('alter default privileges in schema public grant truncate on tables to public;')
    const { anon } = r.catalogo.papeisDoSupabase
    expect(r.catalogo.aclPadrao).toEqual([
      { rotulo: 'alter default privileges (papel postgres_sim, schema public, tabelas)', tipo: 'r', ganhos: new Map([['0', ['TRUNCATE']]]) },
    ])
    const tabelas = r.catalogo.aclPadraoFinal.find((a) => a.tipo === 'r')
    expect(tabelas.itens).toContain(`${anon}:TRUNCATE`)
  })
})

// Correção 14: cada migração é aplicada como postgres_sim (supabase/tests/dono-migracao.sql, da Tarefa 3), sem
// superusuário, como o papel postgres do Supabase.
// Correção 18 (revisão 16, I2): com duas ou mais migrações, cada uma tem o seu commit real, como no Supabase.
describe('cada migração com o seu commit (correção 18)', () => {
  const ENUM = "create type public.acao as enum ('a'); create table public.x (v public.acao);"

  test.each([
    ['update que usa o valor novo (sonda c3 da revisão 16)', "update public.x set v = 'b' where false;"],
    ['default com o valor novo', "alter table public.x alter column v set default 'b';"],
  ])('alter type ... add value numa migração e uso na seguinte: sem erro (%s)', async (_caso, uso) => {
    const r = await analisarMigracoes([
      { arquivo: 'a.sql', sql: ENUM },
      { arquivo: 'b.sql', sql: "alter type public.acao add value 'b';" },
      { arquivo: 'c.sql', sql: uso },
    ])
    expect(r.erro).toBeNull()
    expect(nomes(r)).toEqual(['public.x'])
  })

  // Revisão r18, I1: com exatamente duas migrações (a real e a próxima, o estado provável do repositório) também há
  // commit por migração; sem este caso, o limite "duas ou mais" ficava sem guarda.
  test('exatamente duas migrações: add value no fim da primeira e uso na segunda, sem erro (revisão r18)', async () => {
    const r = await analisarMigracoes([
      { arquivo: 'a.sql', sql: `${ENUM} alter type public.acao add value 'b';` },
      { arquivo: 'b.sql', sql: "alter table public.x alter column v set default 'b';" },
    ])
    expect({ erro: r.erro, relacoes: nomes(r) }).toEqual({ erro: null, relacoes: ['public.x'] })
  })

  test('add value e uso na mesma migração: erro de SQL, como no Postgres', async () => {
    const r = await analisarMigracoes([
      { arquivo: 'a.sql', sql: ENUM },
      { arquivo: 'b.sql', sql: "alter type public.acao add value 'b'; alter table public.x alter column v set default 'b';" },
    ])
    expect(r).toEqual({ erro: 'b.sql: erro de SQL: unsafe use of new value "b" of enum type acao (linha 1)', catalogo: null })
  })

  test('tabela temporária "on commit drop" numa migração que não é a última: some no commit', async () => {
    const r = await analisarMigracoes([{ arquivo: 'a.sql', sql: `${TABELA} create temp table rascunho (id int) on commit drop;` }, { arquivo: 'b.sql', sql: 'select 1;' }])
    expect(r.erro).toBeNull()
  })

  test('tabela temporária "on commit drop" numa migração única: some no commit (a análise é refeita com o commit)', async () => {
    expect((await analisarMigracoes(`${TABELA} create temp table rascunho (id int) on commit drop;`)).erro).toBeNull()
    expect(await analisarMigracoes(`${TABELA} create temp table rascunho (id int);`)).toEqual({
      erro: 'sql: objeto temporário sobrando no fim da migração (table rascunho): forma não suportada; apague-o na própria migração (drop)',
      catalogo: null,
    })
  })

  test('o que as migrações gravaram com commit não fica na base: a análise seguinte parte da base', async () => {
    expect((await analisarMigracoes([{ arquivo: 'a.sql', sql: TABELA }, { arquivo: 'b.sql', sql: 'select 1;' }])).erro).toBeNull()
    expect(nomes(await analisarMigracoes(TABELA))).toEqual(['public.t'])
    const r = await analisarMigracoes([{ arquivo: 'a.sql', sql: TABELA }, { arquivo: 'b.sql', sql: TABELA }])
    expect(r).toEqual({ erro: 'b.sql: erro de SQL: relation "t" already exists (linha 1)', catalogo: null })
    expect(nomes(await analisarMigracoes([{ arquivo: 'a.sql', sql: TABELA }, { arquivo: 'b.sql', sql: 'alter table public.t rename to u;' }]))).toEqual(['public.u'])
  })
})

describe('dono das migrações (postgres_sim)', () => {
  const dono = (r, rotulo) => r.catalogo.relacoes.find((x) => x.rotulo === rotulo).dono

  test('a migração roda como postgres_sim; reset role e reset session authorization voltam a ele, não ao superusuário', async () => {
    const r = await analisarMigracoes(`${TABELA} set role authenticated; reset role; create table public.u (id int);
reset session authorization; create table public.v (id int);`)
    expect(r.catalogo.donoDasMigracoes).toBe('postgres_sim')
    expect(['public.t', 'public.u', 'public.v'].map((t) => dono(r, t))).toEqual(['postgres_sim', 'postgres_sim', 'postgres_sim'])
  })

  test.each([
    // Correção 15: postgres_sim tem CREATEROLE e CREATEDB (como o postgres do Supabase); create role comum não está aqui.
    ['create role ... superuser', 'create role r superuser;', 'permission denied to create role'],
    ['create role ... bypassrls', 'create role r bypassrls;', 'permission denied to create role'],
    ['alter role (pré-existente)', 'alter role anon bypassrls;', 'permission denied to alter role'],
    ['alter role ... superuser no papel que a própria migração criou', 'create role r; alter role r superuser;', 'permission denied to alter role'],
    ['drop role (pré-existente)', 'drop role supabase_auth_admin;', 'permission denied to drop role'],
    ['grant <papel> sem admin option', 'grant authenticated to anon;', 'permission denied to grant role "authenticated"'],
    ['grant anon ao papel que a própria migração criou (sem admin option em anon)', 'create role r; grant anon to r;', 'permission denied to grant role "anon"'],
    ['create role ... in role anon (sem admin option em anon)', 'create role r in role anon;', 'permission denied to grant role "anon"'],
    ['set role para quem não é membro', 'set role postgres;', 'permission denied to set role "postgres"'],
    ['UPDATE no catálogo', "update pg_catalog.pg_class set relrowsecurity = false where relname = 't';", 'permission denied for table pg_class'],
    ['create event trigger', "create function public.e() returns event_trigger language plpgsql as $$ begin end $$; create event trigger et on ddl_command_end execute function public.e();", 'permission denied to create event trigger "et"'],
    ['linguagem não confiável (internal)', "create function public.g(text) returns text language internal as 'textin';", 'permission denied for language internal'],
    ['linguagem não confiável (c)', "create function public.g() returns int language c as 'x', 'y';", 'permission denied for language c'],
    ['wrapper de dados externos', 'create foreign data wrapper w;', 'permission denied to create foreign-data wrapper "w"'],
    ['copy ... program', "copy (select 1) to program 'true';", 'permission denied to COPY to or from an external program'],
    ['função restrita (pg_read_file)', "select pg_catalog.pg_read_file('x');", 'permission denied for function pg_read_file'],
    ['load', "load 'plpgsql';", 'access to library "plpgsql" is not allowed'],
    ['checkpoint', 'checkpoint;', 'permission denied to execute CHECKPOINT command'],
    ['alter database ... set', 'alter database postgres set work_mem = 100;', 'must be owner of database postgres'],
    ['objeto da simulação (dono superusuário)', 'alter table auth.users enable row level security;', 'must be owner of table users'],
  ])('forma que só um superusuário consegue (%s): erro de SQL com o arquivo e a linha', async (_caso, sql, msg) => {
    expect(await analisarMigracoes([{ arquivo: 'a.sql', sql: `${TABELA}\n${sql}` }])).toEqual({ erro: `a.sql: erro de SQL: ${msg} (linha 2)`, catalogo: null })
  })

  // Correção 15: o que o dono consegue de fato (CREATEROLE, CREATEDB e todos os privilégios no banco, como o postgres
  // do Supabase) não dá erro de SQL; quem decide é a regra sobre o catálogo (check-data-api.mjs).
  test('o que o dono consegue: create role (sem SUPERUSER/BYPASSRLS) e create schema chegam ao catálogo', async () => {
    const r = await analisarMigracoes(`${TABELA} create role r login createrole createdb; create role q role r; create schema s;`)
    expect(r.erro).toBeNull()
    expect(r.catalogo.papeisNovos.map((p) => [p.rotulo, p.superusuario, p.bypassrls, p.replicacao])).toEqual([['r', false, false, false], ['q', false, false, false]])
    expect(r.catalogo.participacoesNovas.map((m) => m.rotulo).sort()).toEqual(['postgres_sim membro de q', 'postgres_sim membro de r', 'r membro de q'])
    expect(r.catalogo.outros).toEqual([])
  })

  test('grant ... on database pelo dono (sem grant option): não muda o banco, e nada chega ao catálogo', async () => {
    const r = await analisarMigracoes(`${TABELA} grant create on database postgres to anon; grant create on database postgres to public;`)
    expect(r.erro).toBeNull()
    expect(r.catalogo.outros).toEqual([])
  })

  test('trocar o usuário da sessão (set session authorization) é recusado, e a migração seguinte não roda', async () => {
    const msg = (u) => `a.sql: a migração trocou o usuário da sessão para ${u} (set session authorization): só um superusuário consegue; no Supabase quem aplica as migrações (postgres) não é superusuário`
    expect(await analisarMigracoes([{ arquivo: 'a.sql', sql: `${TABELA} set session authorization postgres;` }, { arquivo: 'b.sql', sql: 'select 1/0;' }])).toEqual({ erro: msg('postgres'), catalogo: null })
    expect(await analisarMigracoes([{ arquivo: 'a.sql', sql: `${TABELA} set session authorization anon;` }])).toEqual({ erro: msg('anon'), catalogo: null })
  })

  test('escalar e voltar ao dono não esconde o que o superusuário fez: o catálogo mostra o dono postgres', async () => {
    const r = await analisarMigracoes(`${TABELA} set session authorization postgres; create table public.u (id int); set session authorization postgres_sim;`)
    expect(r.erro).toBeNull()
    expect(dono(r, 'public.u')).toBe('postgres')
  })

  test('a migração seguinte começa de novo como postgres_sim', async () => {
    const r = await analisarMigracoes([{ arquivo: 'a.sql', sql: `${TABELA} set role anon;` }, { arquivo: 'b.sql', sql: 'create table public.u (id int);' }])
    expect(dono(r, 'public.u')).toBe('postgres_sim')
  })

  test('privilégios padrão no estado final: só as linhas do dono (só ele cria objetos)', async () => {
    const r = await analisarMigracoes('alter default privileges in schema public revoke truncate on tables from anon;')
    expect(r.catalogo.aclPadraoFinal.map((a) => a.rotulo).sort()).toEqual(['alter default privileges (papel postgres_sim, schema public, tabelas)', 'alter default privileges (papel postgres_sim, schema public, sequências)', 'alter default privileges (papel postgres_sim, schema public, funções)'].sort())
  })

  // Erro sem posição (de execução): a linha vem da busca pelo menor trecho inicial que repete o erro.
  test.each([
    ['comando em várias linhas: a linha em que o trecho já é um comando completo', 'create table public.a (\n  id int\n);\nselect 1;\ncreate role r superuser\n  login;\nselect 2;', 5],
    ['dois comandos na mesma linha', 'select 1;\nselect 2; create role r superuser; select 3;\nselect 4;', 2],
    ['dentro de um bloco do', 'select 1;\ndo $$\nbegin\n  create role r superuser;\nend $$;', 5],
    ['comando preparado antes do erro (desfeito a cada tentativa)', 'prepare p as select 1;\nselect 2;\ncreate role r superuser;', 3],
    ['comando preparado antes do erro, que fica na primeira metade', 'prepare p as select 1;\ncreate role r superuser;\nselect 3;\nselect 4;\nselect 5;', 2],
    ['erro na última linha, sem quebra no fim', 'select 1;\nselect 2;\nselect 3;\ncreate role r superuser;', 4],
  ])('linha de erro sem posição: %s', async (_caso, sql, linha) => {
    expect((await analisarMigracoes(sql)).erro).toMatch(new RegExp(`^sql: erro de SQL: .* \\(linha ${linha}\\)$`))
  })

  test('linha de erro sem posição: sem o savepoint do início da migração, a mensagem sai sem a linha', async () => {
    expect((await analisarMigracoes('select 1;\nrelease savepoint catalogo_inicio_da_migracao;\ncreate role r superuser;')).erro).toBe('sql: erro de SQL: permission denied to create role')
  })
})

// O que codigoDoCorpo() (check-rpc-grants.mjs) supõe sobre a leitura de texto do Postgres, conferido no próprio
// Postgres: se uma premissa mudar numa versão nova, este teste falha antes de a regra do corpo errar.
describe('premissas do Postgres usadas na leitura do corpo', () => {
  test.each([
    ['`--` termina em \\r', 'select 1 -- x\r + 1 as v', 2],
    ['tag de dollar-quote com letra não-ASCII', "select length($é$a'b$é$) as v", 3],
    ["E'...' tem escape com barra", "select length(E'a\\'b') as v", 3],
    ["'...' comum não tem escape com barra", "select length('a\\b') as v", 3],
    ['comentário de bloco aninhado', 'select 1 /* a /* b */ c */ + 1 as v', 2],
    ["U&'...' é texto comum", "select length(U&'a''b') as v", 3],
    ['identificador com $ no meio não abre dollar-quote', 'select length(a$b$) as v from (select \'xy\' as a$b$) z', 2],
  ])('%s', async (_caso, sql, esperado) => {
    const db = await premissas()
    expect((await db.query(sql)).rows[0].v).toBe(esperado)
  })
})

// PLA-003, D13 (Tarefa 2 da E2): a simulação tem o schema storage; o catálogo devolve, para as relações dele, as
// mudanças por item (mudancasEmStorage, no lugar de relacoesPreexistentes), as políticas em relações pré-existentes com
// o texto das expressões e, no fim, as linhas de storage.buckets (bucketsFinais).
describe('storage (PLA-003, D13)', () => {
  const POLITICA = "create policy m_le on storage.objects for select to authenticated using (bucket_id = 'midias' and name like 'som/%');"

  test('política em relação pré-existente: forma nova, com relação, papéis, comando e o texto das expressões', async () => {
    const r = await analisarMigracoes(POLITICA)
    expect(r.catalogo.politicasEmPreexistentes).toEqual([{
      rotulo: 'm_le em storage.objects', relacao: 'storage.objects', papeis: ['authenticated'], comando: 'r',
      usando: "((bucket_id = 'midias'::text) AND (name ~~ 'som/%'::text))", comCheck: null, mudanca: 'criação',
    }])
    expect(r.catalogo.relacoesPreexistentes).toEqual([])
    expect(r.catalogo.mudancasEmStorage).toEqual([])
  })

  test.each([
    ['RLS', 'alter table storage.objects disable row level security;'],
    ['coluna', 'alter table storage.objects rename column metadata to meta;'],
    ['padrão', 'alter table storage.objects alter column created_at drop default;'],
    ['índice', 'create index on storage.objects (owner_id);'],
    ['gatilho', 'alter table storage.objects enable replica trigger protect_objects_delete;'],
    ['restrição', 'alter table storage.objects drop constraint "objects_bucketId_fkey";'],
    ['comentário', "comment on column storage.objects.name is 'x';"],
    ['replica identity', 'alter table storage.objects replica identity nothing;'],
    ['privilégio', 'revoke select on storage.objects from anon;'],
  ])('mudancasEmStorage: %s', async (item, sql) => {
    const r = await analisarMigracoes(sql)
    expect(r.catalogo.mudancasEmStorage).toEqual([{ rotulo: 'storage.objects', itens: [item], mudanca: 'alteração' }])
    expect(r.catalogo.relacoesPreexistentes).toEqual([])
  })

  test('mudancasEmStorage: estatística, herança e chave estrangeira vindas de public', async () => {
    const r = await analisarMigracoes(`create statistics public.st on bucket_id, name from storage.objects;
create table public.filha () inherits (storage.objects);
create table public.ref (o uuid references storage.objects (id));`)
    expect(r.catalogo.mudancasEmStorage).toEqual([{ rotulo: 'storage.objects', itens: ['estatística', 'herança', 'chave estrangeira'], mudanca: 'alteração' }])
  })

  test('mudancasEmStorage: relação removida', async () => {
    const r = await analisarMigracoes('drop table storage.objects;')
    expect(r.catalogo.mudancasEmStorage).toEqual([{ rotulo: 'storage.objects', itens: [], mudanca: 'remoção' }])
    expect(r.catalogo.relacoesPreexistentes).toEqual([])
  })

  test('relação pré-existente fora de storage continua em relacoesPreexistentes', async () => {
    const r = await analisarMigracoes('set session authorization postgres; grant select on auth.users to anon; set session authorization postgres_sim;')
    expect(r.catalogo.relacoesPreexistentes).toEqual([{ rotulo: 'auth.users', mudanca: 'alteração' }])
    expect(r.catalogo.mudancasEmStorage).toEqual([])
  })

  test('aclPadraoEmStorage: privilégios padrão de supabase_storage_admin ou do schema storage', async () => {
    const r = await analisarMigracoes('alter default privileges for role supabase_storage_admin in schema storage grant truncate on tables to authenticated;')
    expect(r.catalogo.aclPadraoEmStorage).toEqual([{ rotulo: 'alter default privileges (papel supabase_storage_admin, schema storage, tabelas)', mudanca: 'alteração' }])
    expect((await analisarMigracoes('alter default privileges in schema public grant select on tables to authenticated;')).catalogo.aclPadraoEmStorage).toEqual([])
  })

  test('objetosEmStorage: objeto que não é relação no schema storage; bucketsFinais null com storage.buckets movida', async () => {
    const r = await analisarMigracoes("create type storage.e as enum ('a'); alter table storage.buckets set schema public;")
    expect(r.catalogo.objetosEmStorage).toEqual([{ rotulo: 'type storage.e', mudanca: 'criação' }])
    expect(r.catalogo.bucketsFinais).toBeNull()
    expect((await analisarMigracoes(TABELA)).catalogo.objetosEmStorage).toEqual([])
  })

  test('bucketsFinais: vazio sem linha; com a linha, os quatro campos lidos como superusuário', async () => {
    expect((await analisarMigracoes(TABELA)).catalogo.bucketsFinais).toEqual([])
    const r = await analisarMigracoes("insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('midias', 'midias', false, 52428800, array['image/png']);")
    expect(r.catalogo.bucketsFinais).toEqual([{ id: 'midias', public: false, file_size_limit: 52428800, allowed_mime_types: ['image/png'] }])
  })

  test('a linha gravada em storage.buckets não fica na base: a análise seguinte não a vê', async () => {
    await analisarMigracoes("insert into storage.buckets (id, name) values ('x', 'x');")
    expect((await analisarMigracoes(TABELA)).catalogo.bucketsFinais).toEqual([])
  })
})

let banco
/** PGlite puro (sem a simulação), criado no primeiro uso e fechado no fim do arquivo. */
function premissas() {
  banco ??= PGlite.create()
  return banco
}
afterAll(async () => (banco ? (await banco).close() : undefined))
