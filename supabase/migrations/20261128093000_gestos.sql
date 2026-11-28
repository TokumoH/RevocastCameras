-- Migração da etapa E5 (VER-060): gestos. O gesto confirmado no aparelho sai por uma função do banco que confere a sessão,
-- o episódio ativo, a câmera, quem reconhece, o interruptor e o intervalo do servidor a cada chamada, põe o remetente e o
-- dispositivo no servidor e publica com realtime.send no tópico gestos:<uid da sessão do palco>, em que só a própria sessão
-- recebe e ninguém envia; o interruptor muda por função, que avisa as sessões dos dispositivos sem levar o valor.
-- Modelo e segurança: DES-001, seções 7, 8 e 10.1; decisões D2 a D5 do PLA-006 (docs/planos/2026-11-28-e5-gestos.md), sobre
-- o VER-046 (a autorização do Realtime vê só o tópico e a extensão, e guarda a resposta por conexão até o token novo), o
-- VER-047 (papéis separados por tópico; pode_usar_canal recriada por create or replace) e o VER-050 (envio sensível por
-- função, remetente posto pelo servidor, limite com trava). Fontes F15 (realtime.send como o dono da função) e F16 (índice
-- messages_replay_index e retenção de 72 h a 4 dias) do PLA-006.
-- Aplicada pelo editor SQL do Supabase depois de 20261127230000_video_da_camera.sql (ver supabase/README.md).
-- Depois de aplicada, NUNCA é editada: qualquer correção vai numa migração nova.
-- Cria quatro funções (definir_gestos_ligados, definir_reconhecimento, situacao_dos_gestos e enviar_gesto; EXECUTE só para
-- authenticated) e recria public.pode_usar_canal com o mesmo nome e os mesmos tipos (create or replace mantém o oid, então as
-- duas políticas de realtime.messages continuam chamando a mesma função, como o data-api:check confere em
-- FUNCOES_DO_CANAL). Não cria tabela, índice, política nem privilégio de tabela. Não contém e-mail. Códigos de erro: 42501
-- negado, 22023 parâmetro inválido, 55000 o estado não permite, 54000 limite.

-- =====================================================================================
-- Canais do Realtime (D6 do PLA-004, revista no VER-047, ampliada na D2 do PLA-005 e na D2 do PLA-006)
-- =====================================================================================

-- Matriz do canal: toda decisão de quem recebe (p_enviar falso) e quem envia (verdadeiro) fica aqui; as duas políticas de
-- realtime.messages só a chamam. Só broadcast e presence (persistence e qualquer outra: falso).
--   estudio, episodio:<id de episodio_ativo()>:controle, episodio:<id de episodio_ativo()>:estado e video:<auth.uid()>:
--   exatamente como na 20261127230000 (o corpo é o dela, copiado).
--   gestos:<auth.uid()> (D2 do PLA-006): só recebe (broadcast e presence) a própria sessão, se for obs_palco, câmera ou
--   obs_camera não revogado, com episódio ativo; a câmera e o obs_camera só com a câmera (a própria, ou a do camera_id)
--   existente e não revogada, como no vídeo. A comparação é de texto exato com auth.uid()::text (uuid canônico, minúsculo):
--   sufixo, subtópico, maiúsculas, espaço ou tab no fim e o id do dispositivo no lugar do uid não entram.
--   Envio nos tópicos de gestos: ninguém (os gestos e os avisos saem por enviar_gesto e definir_gestos_ligados, abaixo; isso
--   nega também um realtime.send chamado direto pelo cliente, que roda como authenticated e passa pela política de insert).
--   Qualquer outro tópico (episodio:<id>:video, episodio:<id>:gestos, outro episódio, ...): ninguém.
create or replace function public.pode_usar_canal(p_topico text, p_extensao text, p_enviar boolean)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_papel public.papel_app := (select public.papel_atual());
  v_disp record; -- (id, tipo, camera_id) de dispositivo_atual(), lido uma vez (revisão 1 do PLA-005, N5)
  v_tipo public.tipo_dispositivo;
  v_ativo uuid := (select a.id from public.episodio_ativo() a);
  v_palco boolean;
  v_camera uuid; -- a câmera do vídeo desta sessão: a própria (camera) ou a do camera_id (obs_camera)
begin
  select d.id, d.tipo, d.camera_id into v_disp from public.dispositivo_atual() d;
  v_tipo := v_disp.tipo;
  v_palco := coalesce(v_tipo = 'obs_palco', false);
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
    if p_enviar then
      return v_papel is not null;
    end if;
    return v_papel is not null or v_palco;
  end if;
  if v_ativo is not null and p_topico = 'episodio:' || v_ativo::text || ':estado' then
    if p_enviar then
      return p_extensao = 'broadcast' and v_palco;
    end if;
    return v_papel is not null or v_palco;
  end if;
  -- Vídeo (D2): só receber, só no tópico da própria sessão, só com episódio ativo e câmera não revogada. Envio: ninguém
  -- (os sinais saem por enviar_sinal_de_video, que publica com realtime.send como postgres, dono da função; F15 a F17).
  if not p_enviar and v_ativo is not null and v_tipo in ('camera', 'obs_camera')
     and p_topico = 'video:' || (select auth.uid())::text then
    v_camera := case when v_tipo = 'camera' then v_disp.id else v_disp.camera_id end;
    return exists (select 1 from public.dispositivos c where c.id = v_camera and c.tipo = 'camera' and c.revogado_em is null);
  end if;
  -- Gestos (D2 do PLA-006): só receber, só no tópico da própria sessão, só obs_palco, camera ou obs_camera não revogado e com
  -- episódio ativo; camera e obs_camera só com a câmera (a própria ou a do camera_id) não revogada, como no vídeo (revisão 1,
  -- N2). Envio: ninguém (os gestos e os avisos saem por enviar_gesto e definir_gestos_ligados, com realtime.send como o dono).
  if not p_enviar and v_ativo is not null and v_tipo in ('obs_palco', 'camera', 'obs_camera')
     and p_topico = 'gestos:' || (select auth.uid())::text then
    if v_palco then
      return true;
    end if;
    v_camera := case when v_tipo = 'camera' then v_disp.id else v_disp.camera_id end;
    return exists (select 1 from public.dispositivos c where c.id = v_camera and c.tipo = 'camera' and c.revogado_em is null);
  end if;
  return false;
end;
$$;

-- O create or replace mantém os privilégios; repetidos aqui para a migração dizer sozinha o que vale (DES-001 §8).
revoke execute on function public.pode_usar_canal(text, text, boolean) from public, anon, service_role;
grant execute on function public.pode_usar_canal(text, text, boolean) to authenticated;

-- =====================================================================================
-- Interruptor dos gestos (D4)
-- =====================================================================================

-- Qualquer membro (42501 sem papel), parâmetros não nulos (22023), só o episódio ativo (55000 em outro, encerrado ou sem
-- episódio ativo). Primeiro a trava de transação de chave fixa (revisão 1, N1; o limite é do projeto, I4): contar, gravar e
-- publicar ficam atômicos entre chamadas paralelas. Depois os destinos (até 5 sessões não revogadas e pareadas, em ordem
-- definida: o palco, o obs_camera e as câmeras pareadas mais recentes) e o valor atual: igual ao pedido, devolve-o sem
-- gravar, contar nem publicar (revisão 2, I10). Só ao LIGAR, o limite global: 20 avisos no último minuto ou 120 na última
-- hora no tópico do primeiro destino (todo aviso vai a todos os destinos, então o primeiro vê todos), contados só com
-- event = 'gestos_mudaram' (no tópico do palco também chegam os gestos, que não podem bloquear o religar; revisão 3, I11),
-- pelo índice messages_replay_index (F16; o filtro de event fica fora do índice). DESLIGAR nunca é negado pelo limite (os
-- gestos desligados são a proteção contra o gesto acidental; revisão 2, I10). Sem destino nenhum, nada é contado nem
-- publicado, e a coluna é gravada. O aviso não leva o valor (quem recebe relê no banco): tipo e remetente, mais o id que o
-- realtime.send acrescenta. Devolve o valor gravado.
create function public.definir_gestos_ligados(p_episodio uuid, p_ligado boolean)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_atual boolean;
  v_destinos uuid[]; -- auth.uid() das sessões que recebem o aviso, na ordem da contagem
  v_destino uuid;
  v_ultimo_minuto bigint;
  v_ultima_hora bigint;
begin
  if (select public.papel_atual()) is null then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_episodio is null or p_ligado is null then
    raise exception 'parâmetro inválido' using errcode = '22023';
  end if;
  if p_episodio is distinct from (select a.id from public.episodio_ativo() a) then
    raise exception 'não é o episódio ativo' using errcode = '55000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('definir_gestos_ligados'));
  v_destinos := array(
    select d.usuario_anonimo_id from public.dispositivos d
    where d.revogado_em is null and d.usuario_anonimo_id is not null
    order by (d.tipo = 'obs_palco') desc, (d.tipo = 'obs_camera') desc, d.pareado_em desc nulls last, d.id
    limit 5);
  select e.gestos_ligados into v_atual from public.episodios e where e.id = p_episodio;
  if v_atual = p_ligado then
    return v_atual;
  end if;
  if p_ligado and pg_catalog.cardinality(v_destinos) > 0 then
    -- inserted_at é timestamp sem fuso, em UTC: a comparação usa timezone('utc', now()), como no VER-050.
    select pg_catalog.count(*) filter (where m.inserted_at > pg_catalog.timezone('utc', pg_catalog.now()) - interval '1 minute'),
           pg_catalog.count(*)
      into v_ultimo_minuto, v_ultima_hora
      from realtime.messages m
      where m.topic = 'gestos:' || v_destinos[1]::text and m.extension = 'broadcast' and m.private
        and m.inserted_at > pg_catalog.timezone('utc', pg_catalog.now()) - interval '1 hour' and m.event = 'gestos_mudaram';
    if v_ultimo_minuto >= 20 or v_ultima_hora >= 120 then
      raise exception 'limite do interruptor' using errcode = '54000';
    end if;
  end if;
  update public.episodios e set gestos_ligados = p_ligado where e.id = p_episodio;
  foreach v_destino in array v_destinos loop
    perform realtime.send(
      pg_catalog.jsonb_build_object('tipo', 'gestos_mudaram', 'remetente', (select auth.uid())),
      'gestos_mudaram', 'gestos:' || v_destino::text, true);
  end loop;
  return p_ligado;
end;
$$;

revoke execute on function public.definir_gestos_ligados(uuid, boolean) from public, anon, service_role;
grant execute on function public.definir_gestos_ligados(uuid, boolean) to authenticated;

-- =====================================================================================
-- Onde reconhecer (D5)
-- =====================================================================================

-- Só equipe ou admin (42501). Dispositivo inexistente ou que não é câmera, ou local nulo: 22023 (para voltar ao padrão,
-- grava 'celular'; nulo continua valendo 'celular' na regra abaixo). Depois, a aba avisa em estudio (dispositivo_mudou).
create function public.definir_reconhecimento(p_dispositivo uuid, p_local public.local_reconhecimento)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if coalesce((select public.papel_atual()) in ('equipe', 'admin'), false) = false then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_local is null or not exists (select 1 from public.dispositivos d where d.id = p_dispositivo and d.tipo = 'camera') then
    raise exception 'parâmetro inválido' using errcode = '22023';
  end if;
  update public.dispositivos d set reconhecer_no = p_local where d.id = p_dispositivo;
end;
$$;

revoke execute on function public.definir_reconhecimento(uuid, public.local_reconhecimento) from public, anon, service_role;
grant execute on function public.definir_reconhecimento(uuid, public.local_reconhecimento) to authenticated;

-- Regra única de "reconhecer aqui" (D5): repetida em situacao_dos_gestos e em enviar_gesto; o teste
-- e5-reconhecer-aqui-igual-nas-duas as compara em todos os casos. Na câmera, nulo = 'celular' (o padrão do DES-001 §4.2); no
-- obs_camera, só com 'computador' na câmera do camera_id; e só com a câmera existente e não revogada. O coalesce externo
-- faz o "não" valer quando reconhecer_no é nulo no obs_camera (sem ele, a comparação daria nulo).

-- Só câmera ou obs_camera (42501). ligados = gestos_ligados do episódio ativo (falso sem episódio ativo).
create function public.situacao_dos_gestos()
returns table (ligados boolean, reconhecer_aqui boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_disp record;
  v_camera record;
begin
  select d.id, d.tipo, d.camera_id into v_disp from public.dispositivo_atual() d;
  if v_disp.tipo is null or v_disp.tipo not in ('camera', 'obs_camera') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select c.id, c.reconhecer_no into v_camera from public.dispositivos c
    where c.id = case when v_disp.tipo = 'camera' then v_disp.id else v_disp.camera_id end
      and c.tipo = 'camera' and c.revogado_em is null;
  return query select
    coalesce((select e.gestos_ligados from public.episodios e join public.episodio_ativo() a on a.id = e.id), false),
    coalesce(v_camera.id is not null and case when v_disp.tipo = 'camera'
      then coalesce(v_camera.reconhecer_no, 'celular') = 'celular'
      else v_camera.reconhecer_no = 'computador' end, false);
end;
$$;

revoke execute on function public.situacao_dos_gestos() from public, anon, service_role;
grant execute on function public.situacao_dos_gestos() to authenticated;

-- =====================================================================================
-- Envio do gesto (D2 e D3)
-- =====================================================================================

-- A cada chamada, a sessão é conferida no banco (dispositivo_atual(), lido uma vez) e o remetente e o dispositivo são postos
-- aqui: a sessão antiga de um dispositivo trocado ou revogado não envia mais, e o cliente não declara quem é. Só câmera ou
-- obs_camera (42501), com episódio ativo (55000), com a câmera do par não revogada (55000) e só o aparelho que reconhece
-- (a regra acima; 42501); id e gesto não nulos (22023; um texto fora do tipo public.gesto dá 22P02 antes de entrar). Com o
-- interruptor desligado, 'desligados'; sem obs_palco pareado e não revogado, 'sem_palco': nada publicado. O destino é a
-- sessão atual do palco (uma só: índice dispositivos_um_palco_ativo, VER-047), lida no banco a cada chamada.
-- Intervalo do servidor de 2,5 s (INTERVALO_DO_SERVIDOR_MS = INTERVALO_MS - 500, D3; a margem de 500 ms cobre a diferença
-- de atraso entre os relógios) desde o último gesto publicado para o palco atual, de qualquer remetente ('intervalo', nada
-- publicado), e 600 por hora por remetente (54000), contados no tópico do palco pelo índice messages_replay_index (F16),
-- sob uma trava de transação de chave fixa (o intervalo é do projeto): contar e gravar ficam atômicos. O payload só leva
-- tipo, gesto_id (o uuid do gesto: o realtime.send acrescenta o próprio id), gesto, dispositivo e remetente, e fica em
-- realtime.messages de 72 h a 4 dias (F16). realtime.send roda como o dono desta função (F15) e engole qualquer erro como
-- WARNING: 'enviado' quer dizer que a função chamou o realtime.send.
create function public.enviar_gesto(p_id uuid, p_gesto public.gesto)
returns text -- 'enviado' | 'intervalo' | 'desligados' | 'sem_palco'
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_disp record;
  v_camera record;
  v_ativo uuid;
  v_palco uuid; -- auth.uid() da sessão do palco
begin
  select d.id, d.tipo, d.camera_id into v_disp from public.dispositivo_atual() d;
  if v_disp.tipo is null or v_disp.tipo not in ('camera', 'obs_camera') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_ativo := (select a.id from public.episodio_ativo() a);
  if v_ativo is null then
    raise exception 'sem episódio ativo' using errcode = '55000';
  end if;
  select c.id, c.reconhecer_no into v_camera from public.dispositivos c
    where c.id = case when v_disp.tipo = 'camera' then v_disp.id else v_disp.camera_id end
      and c.tipo = 'camera' and c.revogado_em is null;
  if v_camera.id is null then
    raise exception 'câmera revogada' using errcode = '55000';
  end if;
  if not coalesce(case when v_disp.tipo = 'camera'
      then coalesce(v_camera.reconhecer_no, 'celular') = 'celular'
      else v_camera.reconhecer_no = 'computador' end, false) then
    raise exception 'não reconhece aqui' using errcode = '42501';
  end if;
  if p_id is null or p_gesto is null then
    raise exception 'gesto inválido' using errcode = '22023';
  end if;
  if not (select e.gestos_ligados from public.episodios e where e.id = v_ativo) then
    return 'desligados';
  end if;
  select p.usuario_anonimo_id into v_palco from public.dispositivos p
    where p.tipo = 'obs_palco' and p.revogado_em is null and p.usuario_anonimo_id is not null; -- um só (índice da E3)
  if v_palco is null then
    return 'sem_palco';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('enviar_gesto'));
  if exists (select 1 from realtime.messages m
             where m.topic = 'gestos:' || v_palco::text and m.extension = 'broadcast' and m.private
               and m.inserted_at > pg_catalog.timezone('utc', pg_catalog.now()) - interval '2.5 seconds' and m.event = 'gesto') then
    return 'intervalo';
  end if;
  if (select pg_catalog.count(*) from realtime.messages m
      where m.topic = 'gestos:' || v_palco::text and m.extension = 'broadcast' and m.private
        and m.inserted_at > pg_catalog.timezone('utc', pg_catalog.now()) - interval '1 hour' and m.payload ->> 'remetente' = (select auth.uid())::text) >= 600 then
    raise exception 'limite de gestos' using errcode = '54000';
  end if;
  perform realtime.send(
    pg_catalog.jsonb_build_object('tipo', 'gesto', 'gesto_id', p_id, 'gesto', p_gesto,
      'dispositivo', v_disp.id, 'remetente', (select auth.uid())),
    'gesto', 'gestos:' || v_palco::text, true);
  return 'enviado';
end;
$$;

revoke execute on function public.enviar_gesto(uuid, public.gesto) from public, anon, service_role;
grant execute on function public.enviar_gesto(uuid, public.gesto) to authenticated;
