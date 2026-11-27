-- Simulação mínima do Supabase para os testes de RLS em PGlite (só para testes; NÃO aplicar no Supabase).
-- Reproduz o que a migração usa do Supabase: os papéis anon, authenticated e service_role, os privilégios padrão
-- que o Supabase dá a esses papéis no schema public, o papel supabase_auth_admin (que grava em auth.users), a tabela auth.users (só as colunas usadas), o schema storage (bloco no fim, PLA-003 D13)
-- e as funções auth.jwt() e auth.uid(), e o schema realtime (bloco no fim, PLA-004 D6). Os privilégios padrão são os de hoje (abaixo): tabelas novas não
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

-- ---------------------------------------------------------------------------------------------------------------
-- Realtime (PLA-004, Tarefa 2, D6): o schema realtime com realtime.messages (particionada), realtime.topic() e
-- realtime.authorize(...), a RLS e os privilégios que mudam o resultado da autorização de um canal privado.
-- Fontes (lidas em 2026-11-27):
-- - github.com/supabase/realtime (commit 9a2cfba), lib/realtime/tenants/authorization.ex: o servidor confere a
--   autorização de um canal privado pela função do banco realtime.authorize(role_name, topic_name, claims, sub, headers,
--   read_extensions, write_extensions), numa ida só (@authorize_query, com role = a claim role do JWT, as claims em JSON,
--   sub = a claim sub e os cabeçalhos em JSON); só cai na reserva (insert e select numa transação, read_policies_with_
--   transaction e write_policies_with_transaction) quando a própria função falha (fallback?/1: undefined_function sem
--   "where", ou resposta inesperada). Extensões de leitura: broadcast e presence (@all_extensions; só broadcast sem
--   presença); de escrita: broadcast, presence e persistence (@write_extensions; persistence vira broadcast.persist).
--   lib/realtime_web/channels/realtime_channel.ex: a leitura é conferida na entrada (maybe_assign_policies) e de novo a
--   cada token novo (handle_in "access_token" → apply_access_token, que fecha o canal se a leitura foi revogada:
--   "You no longer have permission to read from this Channel topic"); a escrita, no primeiro envio
--   (broadcast_handler.ex, authorize_write) e de novo depois de cada token novo (as políticas voltam a nil). O
--   :confirm_token periódico só confere o JWT (validade), sem refazer as políticas. Reconectar é entrar de novo.
-- - Migrações do servidor (lib/realtime/tenants/repo/migrations/, aplicadas pelo Realtime como supabase_admin, que é
--   superusuário; DB_USER do docker/docker-compose.yml do github.com/supabase/supabase): 20240401105812 (papel
--   supabase_realtime_admin NOINHERIT NOLOGIN NOREPLICATION, "grant all privileges on schema realtime"),
--   20240523004032 (realtime.topic(), sql stable, de supabase_realtime_admin), 20241030150047 (messages particionada por
--   range de inserted_at, chave primária com inserted_at, RLS ativa, "grant select/insert/update" a anon, authenticated e
--   service_role, dono supabase_realtime_admin), 20241108114728 (id uuid), 20240919163303 e 20260514120000 (payload,
--   event, private, binary_payload e a restrição messages_payload_exclusive), 20260714120000 (skip_broadcast),
--   20261007120000 (expires_at), 20261009120000 (padrões com clock_timestamp), 20260925120000 (os privilégios de
--   anon, authenticated e service_role de hoje: select, insert e update), 20260922120000 (sem grant option no schema
--   para supabase_realtime_admin), 20261002120000, 20261008120000 e 20261111120000 (realtime.authorize: plpgsql
--   volatile, NÃO security definer, de supabase_realtime_admin; o corpo abaixo é o da 20261111120000, copiado sem os
--   comentários). Nenhuma migração cria gatilho em realtime.messages. As partições são diárias, criadas pelo servidor
--   (lib/realtime/tenants.ex, create_messages_partitions: de ontem a daqui a 3 dias, sem RLS própria, de
--   supabase_realtime_admin); aqui uma partição só, de minvalue a maxvalue, cobre os testes.
-- - github.com/supabase/postgres (commit cceedbd): migrations/db/migrations/20211118015519_create-realtime-schema.sql
--   (o schema, criado pelo supabase_admin; aqui o dono é o superusuário do PGlite, como em storage).
-- - Documentação "Realtime Authorization" (supabase.com/docs/guides/realtime/authorization, lida em 2026-11-27): as
--   políticas de realtime.messages leem realtime.topic(), a coluna extension ('broadcast' ou 'presence') e as claims em
--   request.jwt.claims; as permissões ficam guardadas durante a conexão e são refeitas na entrada e a cada token novo;
--   canal privado só é obrigatório com "Allow public access" desligado (passo do responsável).
-- Como realtime.authorize decide: insere uma sonda por extensão de leitura como o papel da conexão (o servidor conecta
-- como supabase_admin, superusuário; nos testes, comoCanal chama como o superusuário do PGlite), troca o papel para
-- role_name e define realtime.topic, request.jwt.claims, request.jwt.claim.sub e request.headers (set_config local),
-- lê de volta as sondas (receber = a sonda é visível pela RLS de select) e tenta inserir uma linha por extensão de
-- escrita (enviar = o insert passou pela RLS de insert; 42501 = negado); no fim, o raise RTA01 desfaz tudo (sondas,
-- papel e parâmetros). O que fica de fora: os índices (só desempenho; desde a E4, messages_replay_index entra no bloco do
-- fim), as colunas não lidas pela autorização continuam (com os tipos da fonte), as demais funções e tabelas de realtime
-- (send até a E4, que entra no bloco do fim; broadcast_changes, subscription, as do
-- Postgres Changes...), os privilégios do papel postgres e de dashboard_user (o postgres_sim é o dono via
-- supabase_realtime_admin, dono-migracao.sql) e a publicação de mensagens.

create role supabase_realtime_admin nologin noinherit noreplication;
create schema realtime;
grant usage on schema realtime to anon, authenticated, service_role;
grant all on schema realtime to supabase_realtime_admin;

create table realtime.messages (
  topic text not null,
  extension text not null,
  payload jsonb,
  event text,
  private boolean default false,
  updated_at timestamp not null default timezone('utc', clock_timestamp()),
  inserted_at timestamp not null default timezone('utc', clock_timestamp()),
  id uuid not null default gen_random_uuid(),
  binary_payload bytea,
  skip_broadcast boolean not null default false,
  expires_at timestamp,
  primary key (id, inserted_at)
) partition by range (inserted_at);
alter table realtime.messages add constraint messages_payload_exclusive check (payload is null or binary_payload is null) not valid;
alter table realtime.messages enable row level security;
grant select, insert, update on realtime.messages to anon, authenticated, service_role;
alter table realtime.messages owner to supabase_realtime_admin;

create table realtime.messages_simulacao partition of realtime.messages for values from (minvalue) to (maxvalue);
alter table realtime.messages_simulacao owner to supabase_realtime_admin;

create function realtime.topic() returns text as $$
select nullif(current_setting('realtime.topic', true), '')::text;
$$ language sql stable;
alter function realtime.topic() owner to supabase_realtime_admin;

create function realtime.authorize(
  role_name text,
  topic_name text,
  claims text,
  sub text,
  headers text,
  read_extensions text[],
  write_extensions text[],
  out read_allowed boolean[],
  out write_allowed boolean[])
language plpgsql
volatile
as $$
declare
  probe_ids uuid[];
  probe_inserted_at timestamp := now() at time zone 'utc';
  visible_ids uuid[];
  ext text;
  allowed boolean;
begin
  perform set_config('synchronous_commit', 'off', true);

  begin
    probe_ids := array(select gen_random_uuid() from unnest(read_extensions));

    insert into realtime.messages (id, topic, extension, inserted_at, updated_at)
    select p.id, topic_name, p.extension, probe_inserted_at, probe_inserted_at
    from unnest(probe_ids, read_extensions) as p(id, extension);

    perform set_config('role', role_name, true),
            set_config('realtime.topic', topic_name, true),
            set_config('request.jwt.claims', claims, true),
            set_config('request.jwt.claim.sub', sub, true),
            set_config('request.jwt.claim.role', role_name, true),
            set_config('request.headers', headers, true);

    if cardinality(probe_ids) > 0 then
      visible_ids := array(
        select m.id
        from realtime.messages m
        where m.inserted_at = probe_inserted_at
          and m.id = any(probe_ids));
    end if;

    read_allowed := array(
      select p.id = any(visible_ids)
      from unnest(probe_ids) with ordinality as p(id, n)
      order by p.n);

    write_allowed := '{}';

    foreach ext in array write_extensions loop
      begin
        insert into realtime.messages (topic, extension, inserted_at, updated_at)
        values (topic_name, ext, now() at time zone 'utc', now() at time zone 'utc');

        allowed := true;
      exception when insufficient_privilege then
        allowed := false;
      end;

      write_allowed := write_allowed || allowed;
    end loop;

    raise sqlstate 'RTA01';
  exception when sqlstate 'RTA01' then
    null;
  end;
end;
$$;
alter function realtime.authorize(text, text, text, text, text, text[], text[]) owner to supabase_realtime_admin;

-- ---------------------------------------------------------------------------------------------------------------
-- realtime.send e o índice de replay (PLA-005, Tarefa 2, D2; fontes F15, F16, F19 e F20, lidas em 2026-11-27):
-- - github.com/supabase/realtime (commit 9a2cfba), lib/realtime/tenants/repo/migrations/
--   20261107120000_broadcast_send_non_object_payloads.ex: o corpo atual de realtime.send(payload jsonb, event text, topic
--   text, private boolean default true) returns void, copiado abaixo sem os comentários: plpgsql, NÃO security definer
--   (roda com o papel de quem chama, e por isso a política canal_envia vale para um cliente que o chame direto), acrescenta
--   id ao payload de objeto, faz SET LOCAL realtime.topic, grava em realtime.messages com extension = 'broadcast' e engole
--   qualquer erro como WARNING 'WarnSendingBroadcastMessage' (F19). 20260707120000_restrict_realtime_schema.ex (linha 48):
--   dono supabase_realtime_admin. 20231204144023_set_required_grants.ex (linha 16): "GRANT EXECUTE ON ALL FUNCTIONS IN
--   SCHEMA realtime TO postgres, anon, authenticated, service_role" (o postgres_sim executa pela participação no dono,
--   dono-migracao.sql). No Supabase, o postgres grava em realtime.messages pelo INSERT (20260914120000) e pelo BYPASSRLS
--   (F17); aqui, pela participação do postgres_sim no dono (a RLS não vale para o dono, sem FORCE): o mesmo efeito, pelo
--   caminho que o teste e4-funcao-publica-pelo-dono mostra lado a lado com um papel que imita o postgres real.
-- - 20261022120000_messages_replay_index.ex: o índice messages_replay_index (a contagem do limite de sinais de
--   public.enviar_sinal_de_video repete o predicado dele; teste e4-limite-usa-o-indice). O drop de
--   messages_inserted_at_topic_index da mesma migração não se aplica (a simulação nunca o criou).
-- O que continua de fora: realtime.send_binary, broadcast_changes e a entrega pelo servidor (os testes leem a linha gravada,
-- que é o que o servidor replica; F22).

create index messages_replay_index on realtime.messages
  (topic, inserted_at desc, (coalesce(expires_at, 'infinity'::timestamp)))
  where extension = 'broadcast' and private = true;

CREATE OR REPLACE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true ) RETURNS void
AS $$
DECLARE
  generated_id uuid;
  final_payload jsonb;
BEGIN
  BEGIN
    generated_id := gen_random_uuid();

    IF jsonb_typeof(payload) <> 'object' OR payload ? 'id' THEN
      final_payload := payload;
    ELSE
      final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    END IF;

    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)
    VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'WarnSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$
LANGUAGE plpgsql;
alter function realtime.send(jsonb, text, text, boolean) owner to supabase_realtime_admin;
grant execute on function realtime.send(jsonb, text, text, boolean) to anon, authenticated, service_role;
