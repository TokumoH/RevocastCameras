-- Migração da etapa E3: pareamento de dispositivos, revogação, episódio ativo, estado do episódio só por função e as
-- políticas dos canais privados do Realtime.
-- Modelo e segurança: DES-001, seções 7, 8 e 10.2; decisões D2 e D4 a D7 do PLA-004 (docs/planos/2026-11-27-e3-ao-vivo-por-toque.md).
-- Aplicada pelo editor SQL do Supabase depois de 20261117000000_fundacao.sql, 20261126142500_membros_sem_autoalteracao.sql
-- e 20261126190407_biblioteca_storage.sql (ver supabase/README.md).
-- Depois de aplicada, NUNCA é editada: qualquer correção vai numa migração nova.
-- Não contém e-mail. Todo objeto leva o schema explícito; dentro das funções (search_path vazio), as funções do Postgres
-- levam pg_catalog. Cria uma tabela (tentativas_pareamento, só por funções), nove funções (EXECUTE só para authenticated),
-- duas políticas em realtime.messages (to authenticated) e troca os privilégios de episodios e estudio_estado (D7).
-- Códigos de erro das funções (D7): 42501 negado, 22023 parâmetro inválido, 55000 o estado não permite, 23505 dois ao vivo.

-- =====================================================================================
-- Tentativas de pareamento (D2)
-- =====================================================================================

-- Tentativas falhas de pareamento por sessão anônima. Só funções: RLS ativa, nenhuma política e revoke all (como
-- codigos_pareamento); está em SOMENTE_FUNCOES do data-api:check. Apagar o usuário anônimo apaga as tentativas dele.
create table public.tentativas_pareamento (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now()
);
create index tentativas_pareamento_usuario_em on public.tentativas_pareamento (usuario_id, criado_em);
alter table public.tentativas_pareamento enable row level security;
revoke all on table public.tentativas_pareamento from anon, authenticated, service_role;

-- =====================================================================================
-- Pareamento (D2, D4)
-- =====================================================================================

-- Código de 244 bits aleatórios (dois gen_random_uuid(), gerador forte do Postgres) em base64url sem '=' (43 caracteres
-- [A-Za-z0-9_-]), devolvido UMA vez e guardado só como hash SHA-256 (D2). Só equipe/admin. Sem p_dispositivo, cria o
-- dispositivo (rótulo de 1 a 60 caracteres; obs_camera exige p_camera de um dispositivo camera); com p_dispositivo
-- (parear de novo, trocar o aparelho), ele tem de existir e ser do tipo p_tipo. Um código novo apaga o pendente do mesmo
-- dispositivo; códigos vencidos há mais de 1 dia são limpos aqui. Vale 2 min (padrão de expira_em).
create function public.criar_codigo_pareamento(p_tipo public.tipo_dispositivo, p_rotulo text, p_dispositivo uuid, p_camera uuid)
returns table (dispositivo uuid, codigo text, expira timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_disp uuid := p_dispositivo;
  v_rotulo text := pg_catalog.btrim(coalesce(p_rotulo, ''));
  v_codigo text;
begin
  if coalesce((select public.papel_atual()) in ('equipe', 'admin'), false) = false then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_tipo is null then
    raise exception 'tipo' using errcode = '22023';
  end if;
  if v_disp is null then
    if pg_catalog.char_length(v_rotulo) not between 1 and 60 then
      raise exception 'rótulo' using errcode = '22023';
    end if;
    if p_tipo = 'obs_camera' and not exists (select 1 from public.dispositivos c where c.id = p_camera and c.tipo = 'camera') then
      raise exception 'câmera' using errcode = '22023';
    end if;
    insert into public.dispositivos (tipo, rotulo, camera_id, criado_por)
      values (p_tipo, v_rotulo, case when p_tipo = 'obs_camera' then p_camera end, auth.uid())
      returning id into v_disp;
  elsif not exists (select 1 from public.dispositivos d where d.id = v_disp and d.tipo = p_tipo) then
    raise exception 'dispositivo' using errcode = '22023';
  end if;
  delete from public.codigos_pareamento c where c.dispositivo_id = v_disp and c.usado_em is null;
  delete from public.codigos_pareamento c where c.expira_em < now() - interval '1 day';
  v_codigo := pg_catalog.translate(pg_catalog.rtrim(pg_catalog.encode(
    pg_catalog.uuid_send(pg_catalog.gen_random_uuid()) || pg_catalog.uuid_send(pg_catalog.gen_random_uuid()), 'base64'), '='), '+/', '-_');
  return query
    insert into public.codigos_pareamento as c (dispositivo_id, codigo_hash)
    values (v_disp, pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_codigo, 'UTF8')), 'hex'))
    returning c.dispositivo_id, v_codigo, c.expira_em;
end;
$$;

revoke execute on function public.criar_codigo_pareamento(public.tipo_dispositivo, text, uuid, uuid) from public, anon, service_role;
grant execute on function public.criar_codigo_pareamento(public.tipo_dispositivo, text, uuid, uuid) to authenticated;

-- Exceção da chamada de papel (DES-001 §8; SEM_CHAMADA_DE_PAPEL do rpc:grants-check): quem chama ainda não é dispositivo.
-- Só sessão anônima (claim is_anonymous verdadeira; ausente nega). Com 5 falhas em 10 min na mesma sessão responde
-- 'limite' sem nem procurar o código. Código procurado só pelo hash, sem uso e dentro da validade, travado (for update)
-- contra dois pareamentos ao mesmo tempo; não encontrado → tentativa gravada e 'invalido'. Código válido de outro tipo
-- (ou tipo nulo) → 'tipo_errado', sem consumir o código e sem gravar tentativa (D2). Pareado: o código é marcado como
-- usado, a sessão solta qualquer outro dispositivo (uma sessão, um dispositivo) e assume este, tirando a sessão anterior
-- dele (parear de novo) e limpando revogado_em. Sempre uma linha (resultado, dispositivo, nome), sem exceção, para a
-- tentativa falha ficar gravada.
create function public.parear_dispositivo(p_codigo text, p_tipo public.tipo_dispositivo)
returns table (resultado text, dispositivo uuid, nome text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cod record;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false then
    raise exception 'só sessão anônima' using errcode = '42501';
  end if;
  delete from public.tentativas_pareamento t where t.criado_em < now() - interval '1 day';
  if (select count(*) from public.tentativas_pareamento t
      where t.usuario_id = v_uid and t.criado_em > now() - interval '10 minutes') >= 5 then
    return query select 'limite'::text, null::uuid, null::text;
    return;
  end if;
  select c.id, c.dispositivo_id, d.tipo into v_cod
    from public.codigos_pareamento c join public.dispositivos d on d.id = c.dispositivo_id
    where pg_catalog.char_length(coalesce(p_codigo, '')) = 43
      and c.codigo_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_codigo, 'UTF8')), 'hex')
      and c.usado_em is null
      and c.expira_em > now()
    for update of c;
  if not found then
    insert into public.tentativas_pareamento (usuario_id) values (v_uid);
    return query select 'invalido'::text, null::uuid, null::text;
    return;
  end if;
  if v_cod.tipo is distinct from p_tipo then
    return query select 'tipo_errado'::text, null::uuid, null::text;
    return;
  end if;
  update public.codigos_pareamento c set usado_em = now() where c.id = v_cod.id;
  update public.dispositivos d set usuario_anonimo_id = null
    where d.usuario_anonimo_id = v_uid and d.id <> v_cod.dispositivo_id;
  return query
    update public.dispositivos d set usuario_anonimo_id = v_uid, pareado_em = now(), revogado_em = null
    where d.id = v_cod.dispositivo_id
    returning 'pareado'::text, d.id, d.rotulo;
end;
$$;

revoke execute on function public.parear_dispositivo(text, public.tipo_dispositivo) from public, anon, service_role;
grant execute on function public.parear_dispositivo(text, public.tipo_dispositivo) to authenticated;

-- O próprio dispositivo da sessão, com o rótulo (D4; revisão do plano, I2): só a linha de dispositivo_atual() (sessão
-- anônima, não revogado) e só as quatro colunas que o app usa. Não abre a tabela: o obs_palco continua sem ler
-- dispositivos pela RLS. Membros, sessão anônima sem dispositivo e dispositivo revogado: nenhuma linha.
create function public.meu_dispositivo()
returns table (id uuid, tipo public.tipo_dispositivo, rotulo text, camera_id uuid)
language sql stable security definer set search_path = ''
as $$
  select d.id, d.tipo, d.rotulo, d.camera_id
  from public.dispositivos d
  join public.dispositivo_atual() a on a.id = d.id
$$;

revoke execute on function public.meu_dispositivo() from public, anon, service_role;
grant execute on function public.meu_dispositivo() to authenticated;

-- Revogação (D5): só equipe/admin. Marca revogado_em, apaga os códigos pendentes do dispositivo e devolve a sessão anônima
-- revogada (mantida na linha, para o aviso em estudio e a auditoria; nula se nunca foi pareado). Inexistente → 22023; já
-- revogado → 55000. Para voltar a usar, um código novo (criar_codigo_pareamento com p_dispositivo) pareia de novo.
create function public.revogar_dispositivo(p_dispositivo uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_usuario uuid;
begin
  if coalesce((select public.papel_atual()) in ('equipe', 'admin'), false) = false then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if not exists (select 1 from public.dispositivos d where d.id = p_dispositivo) then
    raise exception 'dispositivo' using errcode = '22023';
  end if;
  update public.dispositivos d set revogado_em = now()
    where d.id = p_dispositivo and d.revogado_em is null
    returning d.usuario_anonimo_id into v_usuario;
  if not found then
    raise exception 'já revogado' using errcode = '55000';
  end if;
  delete from public.codigos_pareamento c where c.dispositivo_id = p_dispositivo and c.usado_em is null;
  return v_usuario;
end;
$$;

revoke execute on function public.revogar_dispositivo(uuid) from public, anon, service_role;
grant execute on function public.revogar_dispositivo(uuid) to authenticated;

-- =====================================================================================
-- Episódio ativo e estado do episódio (D7)
-- =====================================================================================

-- O episódio ativo: o ao vivo (no máximo um, índice episodios_um_ao_vivo) ou, sem ele, o do modo teste, se for rascunho.
-- Só para membro com papel ou dispositivo não revogado; os demais recebem nenhuma linha. No máximo uma linha.
create function public.episodio_ativo()
returns table (id uuid, modo text)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.modo
  from (
    select e.id, 'ao_vivo'::text as modo from public.episodios e where e.estado = 'ao_vivo'
    union all
    select e.id, 'teste'::text from public.estudio_estado s join public.episodios e on e.id = s.episodio_teste_id
    where e.estado = 'rascunho' and not exists (select 1 from public.episodios x where x.estado = 'ao_vivo')
  ) a
  where (select public.papel_atual()) is not null or exists (select 1 from public.dispositivo_atual())
$$;

revoke execute on function public.episodio_ativo() from public, anon, service_role;
grant execute on function public.episodio_ativo() to authenticated;

-- Rascunho → ao vivo (só equipe/admin); desliga o modo teste. Outro ao vivo → 23505 do índice episodios_um_ao_vivo;
-- fora de rascunho → 55000; inexistente → 22023.
create function public.iniciar_ao_vivo(p_episodio uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if coalesce((select public.papel_atual()) in ('equipe', 'admin'), false) = false then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if not exists (select 1 from public.episodios e where e.id = p_episodio) then
    raise exception 'episódio' using errcode = '22023';
  end if;
  update public.episodios e set estado = 'ao_vivo' where e.id = p_episodio and e.estado = 'rascunho';
  if not found then
    raise exception 'só rascunho inicia' using errcode = '55000';
  end if;
  update public.estudio_estado s set episodio_teste_id = null, atualizado_por = auth.uid(), atualizado_em = now() where s.id = 1;
end;
$$;

revoke execute on function public.iniciar_ao_vivo(uuid) from public, anon, service_role;
grant execute on function public.iniciar_ao_vivo(uuid) to authenticated;

-- Ao vivo → encerrado (só equipe/admin), com gestos_ligados = false; desliga o modo teste. Fora de ao vivo → 55000;
-- inexistente → 22023.
create function public.encerrar_ao_vivo(p_episodio uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if coalesce((select public.papel_atual()) in ('equipe', 'admin'), false) = false then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if not exists (select 1 from public.episodios e where e.id = p_episodio) then
    raise exception 'episódio' using errcode = '22023';
  end if;
  update public.episodios e set estado = 'encerrado', gestos_ligados = false where e.id = p_episodio and e.estado = 'ao_vivo';
  if not found then
    raise exception 'só ao vivo encerra' using errcode = '55000';
  end if;
  update public.estudio_estado s set episodio_teste_id = null, atualizado_por = auth.uid(), atualizado_em = now() where s.id = 1;
end;
$$;

revoke execute on function public.encerrar_ao_vivo(uuid) from public, anon, service_role;
grant execute on function public.encerrar_ao_vivo(uuid) to authenticated;

-- Modo teste (só equipe/admin): liga num rascunho ou desliga (nulo). Enquanto há ao vivo, recusado (55000), inclusive o
-- desligar; episódio fora de rascunho → 55000; inexistente → 22023.
create function public.definir_modo_teste(p_episodio uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if coalesce((select public.papel_atual()) in ('equipe', 'admin'), false) = false then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if exists (select 1 from public.episodios x where x.estado = 'ao_vivo') then
    raise exception 'há episódio ao vivo' using errcode = '55000';
  end if;
  if p_episodio is not null then
    if not exists (select 1 from public.episodios e where e.id = p_episodio) then
      raise exception 'episódio' using errcode = '22023';
    end if;
    if not exists (select 1 from public.episodios e where e.id = p_episodio and e.estado = 'rascunho') then
      raise exception 'só rascunho' using errcode = '55000';
    end if;
  end if;
  update public.estudio_estado s set episodio_teste_id = p_episodio, atualizado_por = auth.uid(), atualizado_em = now() where s.id = 1;
end;
$$;

revoke execute on function public.definir_modo_teste(uuid) from public, anon, service_role;
grant execute on function public.definir_modo_teste(uuid) to authenticated;

-- D7: estado e gestos_ligados só por função. episodios fica com insert e update só nas colunas que o adaptador da E2
-- manda (o revoke de tabela também tira os de coluna; por isso o grant de coluna vem depois); delete só de rascunho.
-- estudio_estado fica só leitura (privilégio e política de update fora). Entre o drop e o create, a tabela fica sem
-- política de delete, o que nega (falha fechada).
revoke insert, update on table public.episodios from authenticated;
grant insert (titulo, data, criado_por), update (titulo, data) on table public.episodios to authenticated;
drop policy episodios_equipe_apaga on public.episodios;
create policy episodios_equipe_apaga on public.episodios
  for delete to authenticated
  using ((select public.papel_atual()) in ('equipe', 'admin') and estado = 'rascunho');
drop policy estudio_estado_equipe_altera on public.estudio_estado;
revoke update on table public.estudio_estado from authenticated;

-- =====================================================================================
-- Canais do Realtime (D6)
-- =====================================================================================

-- Matriz do canal: toda decisão de quem recebe (p_enviar falso) e quem envia (verdadeiro) fica aqui; as duas políticas de
-- realtime.messages só a chamam. Só broadcast e presence (persistence e qualquer outra: falso).
--   estudio: recebem e marcam presença todo membro com papel e todo dispositivo não revogado; broadcast só equipe/admin.
--   episodio:<id de episodio_ativo()>:controle: recebem todo membro e o obs_palco; presença só membros; broadcast todo
--   membro (comando) e o obs_palco (estado).
--   Qualquer outro tópico (episodio:<id>:video até a E4, outro episódio, ...): ninguém.
create function public.pode_usar_canal(p_topico text, p_extensao text, p_enviar boolean)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_papel public.papel_app := (select public.papel_atual());
  v_tipo public.tipo_dispositivo := (select d.tipo from public.dispositivo_atual() d);
  v_ativo uuid := (select a.id from public.episodio_ativo() a);
begin
  if p_extensao is null or p_extensao not in ('broadcast', 'presence') then
    return false;
  end if;
  if p_topico = 'estudio' then
    if p_enviar and p_extensao = 'broadcast' then
      return coalesce(v_papel in ('equipe', 'admin'), false);
    end if;
    return v_papel is not null or v_tipo is not null;
  end if;
  if v_ativo is not null and p_topico = 'episodio:' || v_ativo::text || ':controle' then
    if p_enviar and p_extensao = 'presence' then
      return v_papel is not null;
    end if;
    return v_papel is not null or coalesce(v_tipo = 'obs_palco', false);
  end if;
  return false;
end;
$$;

revoke execute on function public.pode_usar_canal(text, text, boolean) from public, anon, service_role;
grant execute on function public.pode_usar_canal(text, text, boolean) to authenticated;

-- As duas únicas políticas de realtime.messages (o data-api:check confere o texto exato, POLITICAS_DO_CANAL): receber
-- (select) e enviar (insert), sempre to authenticated; a chave publicável (anon) não entra em canal nenhum.
create policy canal_recebe on realtime.messages
  for select to authenticated
  using (public.pode_usar_canal(realtime.topic(), extension, false));
create policy canal_envia on realtime.messages
  for insert to authenticated
  with check (public.pode_usar_canal(realtime.topic(), extension, true));
