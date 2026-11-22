-- Migração inicial do RevocastCameras (etapa E0).
-- Modelo de dados: DES-001, seção 7. Segurança (RLS e funções): DES-001, seção 8.
-- Aplicada pelo editor SQL do Supabase (ver supabase/README.md). Depois de aplicada, NUNCA é editada:
-- qualquer correção vai numa migração nova.
-- Não contém e-mail: o primeiro admin é inserido à mão no editor SQL (supabase/README.md).
-- Todo objeto leva o schema explícito (public.), para não depender do search_path de quem aplica.
-- As checagens rpc:grants-check e data-api:check aplicam as migrações num PGlite e leem o catálogo.

-- =====================================================================================
-- Tipos
-- =====================================================================================

create type public.papel_app as enum ('admin', 'equipe', 'apresentadora');
create type public.tipo_midia as enum ('som', 'imagem');
create type public.estado_episodio as enum ('rascunho', 'ao_vivo', 'encerrado');
create type public.gesto as enum (
  'Closed_Fist', 'Open_Palm', 'Pointing_Up', 'Thumb_Down', 'Thumb_Up', 'Victory', 'ILoveYou'
);
create type public.acao_gesto as enum (
  'clipe', 'marcador', 'cena', 'som', 'proximo_aviso', 'ocultar_aviso', 'proxima_cena', 'nenhuma'
);
create type public.tipo_dispositivo as enum ('camera', 'obs_palco', 'obs_camera');
create type public.local_reconhecimento as enum ('celular', 'computador');
create type public.origem_acao as enum ('gesto', 'toque');

-- =====================================================================================
-- Tabelas
-- =====================================================================================

-- Perfil de quem entrou com conta não anônima; criado pelo gatilho criar_perfil_membro.
-- Não guarda papel e não é chave estrangeira para membros_permitidos (o papel vem da junção por e-mail).
create table public.membros (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  nome text not null
);

-- Lista de acesso e fonte única do papel. E-mail sempre em minúsculas.
-- criado_por é nulo para o primeiro admin, que ainda não entrou.
create table public.membros_permitidos (
  email text primary key constraint membros_permitidos_email_minusculo check (email = lower(email)),
  papel public.papel_app not null,
  criado_por uuid null references public.membros (id) on delete set null
);

-- unique (id, tipo) existe para as chaves estrangeiras compostas de sons e avisos garantirem o tipo da mídia.
create table public.midias (
  id uuid primary key default gen_random_uuid(),
  tipo public.tipo_midia not null,
  nome text not null,
  caminho text not null unique,
  mime text not null,
  tamanho_bytes bigint not null
    constraint midias_tamanho_ate_50mb check (tamanho_bytes > 0 and tamanho_bytes <= 52428800),
  enviado_por uuid references public.membros (id) on delete set null,
  constraint midias_id_tipo_unico unique (id, tipo)
);

-- tipo_midia fica preso a 'som'; a chave composta (midia_id, tipo_midia) só aceita mídia do tipo som.
create table public.sons (
  id uuid primary key default gen_random_uuid(),
  midia_id uuid not null unique,
  tipo_midia public.tipo_midia not null default 'som' constraint sons_tipo_midia_som check (tipo_midia = 'som'),
  rotulo text not null,
  emoji text,
  volume real not null default 1 constraint sons_volume_0_a_1 check (volume >= 0 and volume <= 1),
  ordem integer not null default 0,
  constraint sons_midia_do_tipo_som foreign key (midia_id, tipo_midia)
    references public.midias (id, tipo) on delete cascade
);

create table public.cenas (
  id uuid primary key default gen_random_uuid(),
  nome_exibicao text not null,
  nome_obs text not null unique,
  ordem integer not null default 0
);

create table public.episodios (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  data date not null default current_date,
  estado public.estado_episodio not null default 'rascunho',
  gestos_ligados boolean not null default false,
  criado_por uuid references public.membros (id) on delete set null
);

-- No máximo um episódio ao_vivo por vez.
create unique index episodios_um_ao_vivo on public.episodios (estado) where estado = 'ao_vivo';

-- tipo_imagem fica preso a 'imagem'; a chave composta (imagem_midia_id, tipo_imagem) só aceita mídia
-- do tipo imagem (com imagem_midia_id nulo a chave não é conferida: a imagem é opcional).
create table public.avisos (
  id uuid primary key default gen_random_uuid(),
  episodio_id uuid not null references public.episodios (id) on delete cascade,
  titulo text not null,
  texto text not null default '',
  link text constraint avisos_link_https check (link is null or link like 'https://%'),
  imagem_midia_id uuid,
  tipo_imagem public.tipo_midia not null default 'imagem' constraint avisos_tipo_imagem check (tipo_imagem = 'imagem'),
  duracao_s integer not null default 10 constraint avisos_duracao_positiva check (duracao_s > 0),
  ordem integer not null default 0,
  constraint avisos_midia_do_tipo_imagem foreign key (imagem_midia_id, tipo_imagem)
    references public.midias (id, tipo) on delete set null (imagem_midia_id)
);

-- Mapa global de gestos. CHECK de equivalência: acao = 'cena' <=> cena_id não nulo; acao = 'som' <=> som_id não nulo.
create table public.mapa_gestos (
  gesto public.gesto primary key,
  acao public.acao_gesto not null default 'nenhuma',
  cena_id uuid references public.cenas (id),
  som_id uuid references public.sons (id),
  constraint mapa_gestos_equivalencia check (
    (acao = 'cena') = (cena_id is not null) and (acao = 'som') = (som_id is not null)
  )
);

-- reconhecer_no: só a camera pode ter valor (nas outras é nulo); na camera, nulo = padrão do app (decidido na E3).
-- camera_id: obrigatório para obs_camera e nulo nos outros tipos.
-- usuario_anonimo_id: uma sessão anônima pertence a no máximo um dispositivo (índice único abaixo).
create table public.dispositivos (
  id uuid primary key default gen_random_uuid(),
  tipo public.tipo_dispositivo not null,
  rotulo text not null,
  reconhecer_no public.local_reconhecimento,
  camera_id uuid references public.dispositivos (id),
  usuario_anonimo_id uuid references auth.users (id) on delete set null,
  pareado_em timestamptz,
  revogado_em timestamptz,
  criado_por uuid references public.membros (id) on delete set null,
  constraint dispositivos_reconhecer_so_camera check (reconhecer_no is null or tipo = 'camera'),
  constraint dispositivos_camera_so_obs_camera check ((tipo = 'obs_camera') = (camera_id is not null))
);

create unique index dispositivos_usuario_anonimo_unico
  on public.dispositivos (usuario_anonimo_id) where usuario_anonimo_id is not null;

-- Acessada só por funções (E3): RLS ativa, nenhuma política e REVOKE ALL (mais abaixo).
create table public.codigos_pareamento (
  id uuid primary key default gen_random_uuid(),
  dispositivo_id uuid not null references public.dispositivos (id) on delete cascade,
  codigo_hash text not null unique,
  expira_em timestamptz not null default (now() + interval '2 minutes'),
  usado_em timestamptz
);

-- Linha única (id = 1): guarda o modo teste.
create table public.estudio_estado (
  id smallint primary key default 1 constraint estudio_estado_linha_unica check (id = 1),
  episodio_teste_id uuid references public.episodios (id) on delete set null,
  atualizado_por uuid references public.membros (id) on delete set null,
  atualizado_em timestamptz not null default now()
);

-- Só inserção (pelo obs_palco). Autoria (membro_id ou dispositivo_id, exatamente um) declarada pelo cliente.
create table public.registro_acoes (
  id uuid primary key default gen_random_uuid(),
  episodio_id uuid not null references public.episodios (id) on delete cascade,
  origem public.origem_acao not null,
  acao public.acao_gesto not null,
  cena_id uuid references public.cenas (id) on delete set null,
  som_id uuid references public.sons (id) on delete set null,
  aviso_id uuid references public.avisos (id) on delete set null,
  membro_id uuid references public.membros (id),
  dispositivo_id uuid references public.dispositivos (id),
  teste boolean not null default false,
  criado_em timestamptz not null default now(),
  constraint registro_acoes_um_autor check (num_nonnulls(membro_id, dispositivo_id) = 1)
);

-- =====================================================================================
-- Funções auxiliares (DES-001, seção 8)
-- =====================================================================================

-- Papel do app da sessão: junção do e-mail da sessão (em minúsculas) com membros_permitidos,
-- aceito só para sessão não anônima, provedor google e e-mail confirmado. Nulo nos demais casos.
-- email_confirmed_at vem de auth.users: o JWT não traz esse campo, e user_metadata.email_verified
-- pode ser alterado pelo próprio usuário. Claim is_anonymous ausente conta como anônima (nega).
create function public.papel_atual() returns public.papel_app
language sql stable security definer set search_path = ''
as $$
  select mp.papel
  from auth.users u
  join public.membros_permitidos mp on mp.email = lower(auth.jwt() ->> 'email')
  where u.id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) = false
    and auth.jwt() -> 'app_metadata' ->> 'provider' = 'google'
    and u.email_confirmed_at is not null
$$;

revoke execute on function public.papel_atual() from public, anon, service_role;
grant execute on function public.papel_atual() to authenticated;

-- Dispositivo da sessão: só sessão anônima, dispositivo não revogado e usuario_anonimo_id = auth.uid().
-- Por ser SECURITY DEFINER, roda como o dono da tabela, e o dono não passa pela RLS (a tabela não tem FORCE ROW
-- LEVEL SECURITY); por isso as políticas de dispositivos podem usá-la sem recursão.
create function public.dispositivo_atual()
returns table (id uuid, tipo public.tipo_dispositivo, camera_id uuid)
language sql stable security definer set search_path = ''
as $$
  select d.id, d.tipo, d.camera_id
  from public.dispositivos d
  where d.usuario_anonimo_id = auth.uid()
    and d.revogado_em is null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = true
$$;

revoke execute on function public.dispositivo_atual() from public, anon, service_role;
grant execute on function public.dispositivo_atual() to authenticated;

-- Gatilho: cria o perfil em membros no primeiro login de conta não anônima.
-- nome = full_name, senão name, senão a parte do e-mail antes do @.
-- Cadastro sem e-mail também é ignorado (membros.email é obrigatório; sem e-mail não há papel),
-- para que a falta de e-mail não faça o cadastro falhar. Um segundo cadastro com o mesmo e-mail em
-- outra caixa ainda falha em membros_email_key (ver Riscos em supabase/migrations/README.md).
create function public.criar_perfil_membro() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(new.is_anonymous, false) = false and new.email is not null then
    insert into public.membros (id, email, nome)
    values (
      new.id,
      lower(new.email),
      coalesce(
        nullif(new.raw_user_meta_data ->> 'full_name', ''),
        nullif(new.raw_user_meta_data ->> 'name', ''),
        split_part(new.email, '@', 1)
      )
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.criar_perfil_membro() from public, anon, service_role;
grant execute on function public.criar_perfil_membro() to authenticated;

create trigger criar_perfil_membro_ao_cadastrar
  after insert on auth.users
  for each row execute function public.criar_perfil_membro();

-- =====================================================================================
-- RLS (DES-001, seção 8). Toda política é "to authenticated": o papel anon não recebe nenhuma.
-- (select public.papel_atual()) é avaliado uma vez por consulta.
-- =====================================================================================

alter table public.membros_permitidos enable row level security;
alter table public.membros enable row level security;
alter table public.midias enable row level security;
alter table public.sons enable row level security;
alter table public.cenas enable row level security;
alter table public.episodios enable row level security;
alter table public.avisos enable row level security;
alter table public.mapa_gestos enable row level security;
alter table public.estudio_estado enable row level security;
alter table public.dispositivos enable row level security;
alter table public.codigos_pareamento enable row level security;
alter table public.registro_acoes enable row level security;

-- membros_permitidos: só admin lê e escreve.
create policy membros_permitidos_admin_le on public.membros_permitidos
  for select to authenticated using ((select public.papel_atual()) = 'admin');
create policy membros_permitidos_admin_insere on public.membros_permitidos
  for insert to authenticated with check ((select public.papel_atual()) = 'admin');
create policy membros_permitidos_admin_altera on public.membros_permitidos
  for update to authenticated
  using ((select public.papel_atual()) = 'admin') with check ((select public.papel_atual()) = 'admin');
create policy membros_permitidos_admin_apaga on public.membros_permitidos
  for delete to authenticated using ((select public.papel_atual()) = 'admin');

-- membros: equipe/admin leem; escrita só pelo gatilho.
create policy membros_equipe_le on public.membros
  for select to authenticated using ((select public.papel_atual()) in ('equipe', 'admin'));

-- Preparação (midias, sons, cenas, episodios, avisos): todo membro e o obs_palco leem; equipe/admin escrevem.
create policy midias_le on public.midias
  for select to authenticated
  using ((select public.papel_atual()) is not null or (select tipo from public.dispositivo_atual()) = 'obs_palco');
create policy midias_equipe_insere on public.midias
  for insert to authenticated with check ((select public.papel_atual()) in ('equipe', 'admin'));
create policy midias_equipe_altera on public.midias
  for update to authenticated
  using ((select public.papel_atual()) in ('equipe', 'admin')) with check ((select public.papel_atual()) in ('equipe', 'admin'));
create policy midias_equipe_apaga on public.midias
  for delete to authenticated using ((select public.papel_atual()) in ('equipe', 'admin'));

create policy sons_le on public.sons
  for select to authenticated
  using ((select public.papel_atual()) is not null or (select tipo from public.dispositivo_atual()) = 'obs_palco');
create policy sons_equipe_insere on public.sons
  for insert to authenticated with check ((select public.papel_atual()) in ('equipe', 'admin'));
create policy sons_equipe_altera on public.sons
  for update to authenticated
  using ((select public.papel_atual()) in ('equipe', 'admin')) with check ((select public.papel_atual()) in ('equipe', 'admin'));
create policy sons_equipe_apaga on public.sons
  for delete to authenticated using ((select public.papel_atual()) in ('equipe', 'admin'));

create policy cenas_le on public.cenas
  for select to authenticated
  using ((select public.papel_atual()) is not null or (select tipo from public.dispositivo_atual()) = 'obs_palco');
create policy cenas_equipe_insere on public.cenas
  for insert to authenticated with check ((select public.papel_atual()) in ('equipe', 'admin'));
create policy cenas_equipe_altera on public.cenas
  for update to authenticated
  using ((select public.papel_atual()) in ('equipe', 'admin')) with check ((select public.papel_atual()) in ('equipe', 'admin'));
create policy cenas_equipe_apaga on public.cenas
  for delete to authenticated using ((select public.papel_atual()) in ('equipe', 'admin'));

create policy episodios_le on public.episodios
  for select to authenticated
  using ((select public.papel_atual()) is not null or (select tipo from public.dispositivo_atual()) = 'obs_palco');
create policy episodios_equipe_insere on public.episodios
  for insert to authenticated with check ((select public.papel_atual()) in ('equipe', 'admin'));
create policy episodios_equipe_altera on public.episodios
  for update to authenticated
  using ((select public.papel_atual()) in ('equipe', 'admin')) with check ((select public.papel_atual()) in ('equipe', 'admin'));
create policy episodios_equipe_apaga on public.episodios
  for delete to authenticated using ((select public.papel_atual()) in ('equipe', 'admin'));

create policy avisos_le on public.avisos
  for select to authenticated
  using ((select public.papel_atual()) is not null or (select tipo from public.dispositivo_atual()) = 'obs_palco');
create policy avisos_equipe_insere on public.avisos
  for insert to authenticated with check ((select public.papel_atual()) in ('equipe', 'admin'));
create policy avisos_equipe_altera on public.avisos
  for update to authenticated
  using ((select public.papel_atual()) in ('equipe', 'admin')) with check ((select public.papel_atual()) in ('equipe', 'admin'));
create policy avisos_equipe_apaga on public.avisos
  for delete to authenticated using ((select public.papel_atual()) in ('equipe', 'admin'));

-- mapa_gestos: as 7 linhas vêm desta migração (gesto é a chave e o tipo só tem 7 valores);
-- equipe/admin só alteram.
create policy mapa_gestos_le on public.mapa_gestos
  for select to authenticated
  using ((select public.papel_atual()) is not null or (select tipo from public.dispositivo_atual()) = 'obs_palco');
create policy mapa_gestos_equipe_altera on public.mapa_gestos
  for update to authenticated
  using ((select public.papel_atual()) in ('equipe', 'admin')) with check ((select public.papel_atual()) in ('equipe', 'admin'));

-- estudio_estado: todo membro lê; equipe/admin só alteram a linha única (id = 1).
create policy estudio_estado_le on public.estudio_estado
  for select to authenticated using ((select public.papel_atual()) is not null);
create policy estudio_estado_equipe_altera on public.estudio_estado
  for update to authenticated
  using ((select public.papel_atual()) in ('equipe', 'admin')) with check ((select public.papel_atual()) in ('equipe', 'admin'));

-- dispositivos: equipe/admin leem todos; camera e obs_camera leem o próprio registro e o da câmera
-- indicada (camera_id); obs_palco não lê. Nenhuma política lê dispositivos dentro de si (daria
-- 42P17 infinite recursion): as sessões de dispositivo passam só por dispositivo_atual().
-- Escrita só por funções (E3).
create policy dispositivos_equipe_le on public.dispositivos
  for select to authenticated using ((select public.papel_atual()) in ('equipe', 'admin'));
create policy dispositivos_proprio_le on public.dispositivos
  for select to authenticated
  using (
    (select tipo from public.dispositivo_atual()) in ('camera', 'obs_camera')
    and (id = (select id from public.dispositivo_atual()) or id = (select camera_id from public.dispositivo_atual()))
  );

-- codigos_pareamento: nenhuma política (nega tudo) e nenhum privilégio direto.
revoke all on table public.codigos_pareamento from anon, authenticated, service_role;

-- Privilégios de tabela: explícitos, só o que a matriz de acesso (DES-001 §8) precisa.
-- Desde 2026-10-30 o Supabase não dá mais select/insert/update/delete automáticos em tabelas novas de public
-- (changelog "Breaking change: tables not exposed to Data and GraphQL API automatically" e
-- https://supabase.com/docs/guides/api/hardening-data-api), mas ainda dá truncate, references, trigger e
-- maintain (Postgres 17+), e com "Automatically expose new tables" ligado (ou em projeto anterior à mudança)
-- dá "grant all"; vale para anon, authenticated e service_role. Por isso a migração começa tirando tudo dos três
-- (o "all" cobre maintain sem citar a palavra, que não existe no 15; truncate passaria por cima da RLS) e dá a
-- authenticated só as operações que alguma política permite. Assim o resultado é o mesmo com qualquer padrão.
-- Nada para anon (nenhuma política é para anon), nada em codigos_pareamento (acima) e nada para service_role:
-- a chave de serviço passa por cima da RLS (BYPASSRLS), mas sem privilégio não acessa nenhuma tabela. Um uso
-- futuro no servidor (Edge Function) pede decisão própria, com o GRANT explícito a service_role e, a partir do
-- VER-011, o ajuste do data-api:check, que acusa qualquer privilégio de service_role.
revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;
grant select, insert, update, delete on table
  public.membros_permitidos, public.midias, public.sons, public.cenas, public.episodios, public.avisos
  to authenticated;
grant select, update on table public.mapa_gestos, public.estudio_estado to authenticated;
grant select on table public.membros, public.dispositivos to authenticated;
grant select, insert on table public.registro_acoes to authenticated;
-- O mesmo ponto de partida para tabelas e sequências criadas depois pelo papel que roda as migrações: nenhum
-- privilégio automático para anon, authenticated e service_role; cada migração futura dá os seus GRANT explícitos.
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;

-- registro_acoes: só o obs_palco insere (sem conferir dispositivo_id: autoria declarada); todo membro lê.
create policy registro_acoes_palco_insere on public.registro_acoes
  for insert to authenticated with check ((select tipo from public.dispositivo_atual()) = 'obs_palco');
create policy registro_acoes_membros_le on public.registro_acoes
  for select to authenticated using ((select public.papel_atual()) is not null);

-- =====================================================================================
-- Dados iniciais
-- =====================================================================================

-- Mapa padrão (DES-001, seção 7). Os gestos de som começam como 'nenhuma': a migração não cria sons.
insert into public.mapa_gestos (gesto, acao) values
  ('ILoveYou', 'clipe'),
  ('Closed_Fist', 'marcador'),
  ('Victory', 'proxima_cena'),
  ('Thumb_Up', 'nenhuma'),
  ('Thumb_Down', 'nenhuma'),
  ('Pointing_Up', 'proximo_aviso'),
  ('Open_Palm', 'ocultar_aviso');

insert into public.estudio_estado (id) values (1);
