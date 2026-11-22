-- Simulação mínima do Supabase para os testes de RLS em PGlite (só para testes; NÃO aplicar no Supabase).
-- Reproduz o que a migração usa do Supabase: os papéis anon, authenticated e service_role, os privilégios padrão
-- que o Supabase dá a esses papéis no schema public, o papel supabase_auth_admin (que grava em auth.users), a tabela auth.users (só as colunas usadas)
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
