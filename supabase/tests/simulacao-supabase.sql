-- Simulação mínima do Supabase para os testes de RLS em PGlite (só para testes; NÃO aplicar no Supabase).
-- Reproduz o que a migração usa do Supabase: os papéis anon, authenticated e service_role, os privilégios padrão
-- que o Supabase dá a esses papéis no schema public, o papel supabase_auth_admin (que grava em auth.users), a tabela auth.users (só as colunas usadas), o schema storage (bloco no fim, PLA-003 D13)
-- e as funções auth.jwt() e auth.uid(). Os privilégios padrão são os de hoje (abaixo): tabelas novas não
-- recebem select/insert/update/delete, então o acesso nos testes vem só dos GRANT explícitos da migração, e
-- quem bloqueia dentro deles é a RLS.

create role anon nologin;
create role authenticated nologin;

-- Privilégios padrão do Supabase no padrão vigente desde 2026-10-30 para todos os projetos (2026-05-30 para os
-- novos): tabelas e sequências novas em public deixaram de ser expostas automaticamente à Data API.
-- Fontes (lidas em 2026-11-22): changelog "Breaking change: tables not exposed to Data and GraphQL API
-- automatically" (https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
-- e https://supabase.com/docs/guides/api/hardening-data-api. Pela documentação, tabelas novas mantêm truncate,
-- references, trigger e maintain (maintain só no Postgres 17 ou mais novo; o PGlite daqui é 18), sequências
-- novas mantêm update, e funções continuam com execute (a documentação diz que funções novas seguem executáveis por todos os papéis). Antes eram "grant all"
-- em tabelas, sequências e funções. Os três papéis da Data API recebem o mesmo padrão; service_role tem
-- BYPASSRLS, como no Supabase (passa por cima da RLS, mas não da falta de privilégio).
-- Este é o padrão com a opção "Automatically expose new tables" desligada (o padrão de hoje). Com ela ligada
-- (ou num projeto que manteve o padrão antigo), tabelas e sequências novas recebem "grant all"; essa variante é
-- banco.ts, criarBanco({ exporTabelasNovas: true }), e o teste mesmo-catalogo-com-tabelas-expostas confere que
-- a migração deixa o mesmo catálogo de privilégios nas duas.
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant truncate, references, trigger, maintain on tables to anon, authenticated, service_role;
alter default privileges in schema public grant update on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated;

-- Papel que o Auth do Supabase usa para gravar em auth.users: só insert/select/update nessa tabela e nenhum
-- privilégio nas tabelas de public. Assim o gatilho criar_perfil_membro só cria o perfil se for security definer.
create role supabase_auth_admin nologin;
grant usage on schema auth to supabase_auth_admin;

create table auth.users (
  id uuid primary key,
  email text,
  is_anonymous boolean not null default false,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
grant select, insert, update on auth.users to supabase_auth_admin;

-- Claims da sessão, lidas de request.jwt.claims (como o PostgREST do Supabase define).
-- Claims vazias ('') ou ausentes viram '{}', para que uma recusa venha só de permissão, nunca de erro de conversão.
-- O auth.jwt() real devolve NULL sem claims; nas funções da migração '{}' e NULL dão o mesmo resultado
-- (toda condição sobre as claims fica nula ou falsa e nega).
create function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

-- Usuário da sessão: a claim "sub".
create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Storage (PLA-003, Tarefa 2, D13): o schema storage com storage.buckets e storage.objects (só as colunas usadas),
-- storage.foldername(), a RLS, os privilégios e o gatilho que muda o resultado de um comando de authenticated.
-- Fontes (lidas em 2026-11-26):
-- - github.com/supabase/postgres (commit cceedbd), migrations/db/init-scripts/00000000000002-storage-schema.sql:
--   "CREATE SCHEMA IF NOT EXISTS storage AUTHORIZATION supabase_admin", "CREATE USER supabase_storage_admin NOINHERIT
--   CREATEROLE LOGIN NOREPLICATION" e "grant all on schema storage to supabase_storage_admin with grant option".
--   Aqui o dono do schema é o superusuário do PGlite (no lugar do supabase_admin, que também é superusuário).
-- - github.com/supabase/storage (commit 4341c44), migrations/tenant/ (o servidor do Storage aplica como
--   supabase_storage_admin, que fica dono das tabelas e das funções): 0002-storage-schema.sql (buckets, objects com a
--   chave estrangeira "objects_bucketId_fkey", RLS em objects, foldername, "grant usage on schema storage" e
--   "alter default privileges in schema storage grant all on tables/functions/sequences" a postgres, anon,
--   authenticated e service_role); 0003-pathtoken-column.sql (path_tokens gerada); 0007-add-rls-to-buckets.sql;
--   0008-add-public-to-buckets.sql; 0013-add-bucket-custom-limits.sql e 0014-use-bytes-for-max-size.sql
--   (allowed_mime_types text[] e file_size_limit bigint); 0018-add_owner_id_column_deprecate_owner.sql (owner_id);
--   0060-optimize-existing-functions-again.sql (foldername atual, plpgsql immutable); 0073-revoke-grants-to-unused-
--   operations.sql (tira TRUNCATE, REFERENCES, TRIGGER e MAINTAIN de anon e authenticated nas tabelas, inclusive dos
--   privilégios padrão; service_role continua com tudo).
-- - Gatilhos atuais de storage.objects (as migrações 0026 a 0052 criaram e apagaram os de prefixos; 0052 apagou
--   storage.prefixes): update_objects_updated_at (0011, before update: não dispara em insert nem em delete e não escreve
--   em outra tabela; fica fora) e protect_objects_delete (0055, before delete for each statement: recusa com 42501 todo
--   delete direto se storage.allow_delete_query não for 'true'; entra, porque muda o resultado de um delete de
--   authenticated). O servidor do Storage liga storage.allow_delete_query = 'true' em cada transação, junto com o papel
--   e as claims (src/internal/database/postgres/scope.ts): um delete de teste que imita o servidor faz o mesmo.
-- - Gatilhos de storage.buckets (fora): enforce_bucket_name_length_trigger (0037, nome até 100 caracteres),
--   protect_bucket_control_insert (0068, só recusa insert com as colunas de ciclo de vida preenchidas),
--   wake_lifecycle_on_policy_write (0079, sai logo quando lifecycle_configuration é nulo), protect_buckets_delete (0055) e
--   os de update de colunas que a simulação não tem: num insert de bucket com nome curto e sem ciclo de vida, nenhum
--   muda o resultado.
-- O que fica de fora: as demais colunas (version, last_accessed_at, user_metadata, type, ciclo de vida...), os índices
-- (inclusive o único de nome por bucket), as demais tabelas e funções de storage e os comentários de coluna.

create role supabase_storage_admin nologin;
create schema storage;
grant all on schema storage to supabase_storage_admin with grant option;
grant usage on schema storage to anon, authenticated, service_role;
alter default privileges for role supabase_storage_admin in schema storage grant all on tables to anon, authenticated, service_role;
alter default privileges for role supabase_storage_admin in schema storage grant all on functions to anon, authenticated, service_role;
alter default privileges for role supabase_storage_admin in schema storage grant all on sequences to anon, authenticated, service_role;
alter default privileges for role supabase_storage_admin in schema storage revoke truncate, references, trigger, maintain on tables from anon, authenticated;

set role supabase_storage_admin;

create table storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  owner_id text,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text constraint "objects_bucketId_fkey" references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

create function storage.foldername(name text) returns text[]
language plpgsql immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end
$$;

create function storage.protect_delete() returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
      using hint = 'This prevents accidental data loss from orphaned objects.', errcode = '42501';
  end if;
  return null;
end;
$$;

create trigger protect_objects_delete before delete on storage.objects
  for each statement execute function storage.protect_delete();

reset role;
