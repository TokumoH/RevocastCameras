-- Dono das migrações nos testes (só para testes; NÃO aplicar no Supabase). banco.ts roda este arquivo como
-- superusuário logo depois de simulacao-supabase.sql e aplica a migração com set role postgres_sim.
--
-- No Supabase, quem aplica a migração pelo editor SQL é o papel postgres, que NÃO é superusuário:
-- "ALTER ROLE postgres NOSUPERUSER CREATEDB CREATEROLE LOGIN REPLICATION BYPASSRLS" em
-- migrations/db/migrations/10000000000000_demote-postgres.sql do repositório github.com/supabase/postgres.
-- Aqui ele é postgres_sim, com os mesmos atributos do real (NOSUPERUSER CREATEDB CREATEROLE LOGIN REPLICATION),
-- menos um: de propósito, sem BYPASSRLS (mais restrito que o postgres real). A migração não pode depender de passar
-- por cima da RLS; o dono só passa por ela porque as tabelas não têm FORCE ROW LEVEL SECURITY. Decisão do
-- controlador (Correção 12 da Tarefa 3): sem CREATEROLE e CREATEDB, um create role legítimo falharia por engano
-- nos testes e nas checagens de banco, que também carregam este arquivo. LOGIN e REPLICATION não têm efeito no
-- PGlite (uma sessão só, sem replicação) e entram só para os atributos baterem com os do real.
-- O que continua diferente do real: sem BYPASSRLS; só os privilégios que a migração usa (abaixo), e não o
-- GRANT ALL nos schemas auth, extensions e storage nem nas suas funções e sequências.
--
-- Os privilégios imitam os do postgres no mesmo repositório: membro de anon, authenticated e service_role
-- (20230201083204_grant_auth_roles_to_postgres.sql), todos os privilégios nas tabelas de auth
-- (10000000000000_demote-postgres.sql) e os privilégios padrão de public para os objetos que ele cria
-- (init-scripts/00000000000000-initial-schema.sql, com a mudança de 2026-10-30 descrita em
-- simulacao-supabase.sql). O "revoke" nos privilégios padrão feito pela migração vale para o que postgres_sim
-- cria (os privilégios padrão da simulação, sem "for role", são os do superusuário).
--
-- Fica num arquivo próprio, fora de simulacao-supabase.sql: é o papel que aplica a migração, não algo que a
-- migração usa. As checagens de banco (scripts/_catalogo.mjs, Tarefa 4) também carregam este arquivo, como
-- superusuário logo depois da simulação, e aplicam cada migração como postgres_sim (como banco.ts).

create role postgres_sim login nosuperuser createdb createrole replication nobypassrls;
-- GRANT ALL ON DATABASE postgres TO postgres (10000000000000_demote-postgres.sql): sem o create no banco,
-- um create schema falharia. Aqui o banco do PGlite também se chama postgres.
grant all on database postgres to postgres_sim;
grant anon, authenticated, service_role to postgres_sim;
grant usage, create on schema public to postgres_sim;
grant usage on schema auth to postgres_sim;
grant all on auth.users to postgres_sim;
-- Privilégios padrão de public no padrão vigente desde 2026-10-30 (fontes e detalhes em simulacao-supabase.sql):
-- tabelas novas só com truncate, references, trigger e maintain; sequências novas só com update; funções com tudo;
-- para anon, authenticated e service_role (opção "Automatically expose new tables" desligada; a variante ligada
-- está em banco.ts).
alter default privileges for role postgres_sim in schema public grant truncate, references, trigger, maintain on tables to anon, authenticated, service_role;
alter default privileges for role postgres_sim in schema public grant update on sequences to anon, authenticated, service_role;
alter default privileges for role postgres_sim in schema public grant all on functions to anon, authenticated, service_role;
