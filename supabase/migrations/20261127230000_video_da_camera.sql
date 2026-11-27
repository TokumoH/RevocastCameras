-- Migração da etapa E4 (VER-050): vídeo da câmera. A sinalização WebRTC entre a câmera e o obs_camera sai por uma função do
-- banco que confere a sessão a cada chamada e põe o remetente no servidor, publicada com realtime.send no tópico
-- video:<uid da sessão do par>, em que só a própria sessão recebe e ninguém envia; e só pode haver um obs_camera não revogado.
-- Modelo e segurança: DES-001, seções 8 e 10.3; decisões D2 a D5 do PLA-005 (docs/planos/2026-11-27-e4-celular-como-camera.md),
-- sobre o VER-046 (a autorização do Realtime vê só o tópico e a extensão, e guarda a resposta por conexão até o token novo) e
-- o VER-047 (pode_usar_canal recriada por create or replace). Fontes F15 a F21 do PLA-005 (realtime.send, privilégios de
-- realtime.messages, BYPASSRLS do postgres, retenção de 3 dias, índice messages_replay_index, tamanho do SDP).
-- Aplicada pelo editor SQL do Supabase depois de 20261127220000_estado_do_palco_em_topico_proprio.sql (ver supabase/README.md).
-- Depois de aplicada, NUNCA é editada: qualquer correção vai numa migração nova.
-- Cria uma função (enviar_sinal_de_video, EXECUTE só para authenticated) e um índice único parcial em public.dispositivos, e
-- recria public.pode_usar_canal com o mesmo nome e os mesmos tipos (create or replace mantém o oid, então as duas políticas
-- de realtime.messages continuam chamando a mesma função, como o data-api:check confere em FUNCOES_DO_CANAL). Não cria
-- tabela, política nem privilégio de tabela. Não contém e-mail. Códigos de erro: 42501 negado, 22023 sinal inválido, 55000 o
-- estado não permite, 54000 limite de sinais, 23505 dois obs_camera ativos.

-- =====================================================================================
-- Um obs_camera só (D2; revisão 3 do PLA-005, N11)
-- =====================================================================================

-- No máximo um obs_camera não revogado no banco (pareado ou com código pendente): um único par sinaliza, e o teto de disco
-- do limite de sinais (abaixo) não cresce com o número de câmeras (DES-001 §2: várias câmeras simultâneas são não-objetivo).
-- criar_codigo_pareamento('obs_camera', ...) sem p_dispositivo, com um ativo, passa a dar 23505 no insert; parear de novo um
-- obs_camera revogado (parear_dispositivo limpa revogado_em) com outro ativo também dá 23505, sem consumir o código. Se o
-- banco já tiver dois, o create unique index falha com 23505 e nada desta migração é aplicado (consultas no guia "Vídeo da
-- câmera (E4)", supabase/README.md).
create unique index dispositivos_um_obs_camera_ativo
  on public.dispositivos (tipo) where tipo = 'obs_camera' and revogado_em is null;

-- =====================================================================================
-- Canais do Realtime (D6 do PLA-004, revista no VER-047 e ampliada na D2 do PLA-005)
-- =====================================================================================

-- Matriz do canal: toda decisão de quem recebe (p_enviar falso) e quem envia (verdadeiro) fica aqui; as duas políticas de
-- realtime.messages só a chamam. Só broadcast e presence (persistence e qualquer outra: falso).
--   estudio, episodio:<id de episodio_ativo()>:controle e episodio:<id de episodio_ativo()>:estado: exatamente como no
--   VER-047 (o trecho é o da 20261127220000, copiado; a única troca é ler o dispositivo uma vez, com select ... into).
--   video:<auth.uid()> (D2): só recebe (broadcast e presence) a própria sessão, se for câmera ou obs_camera não revogado,
--   com episódio ativo e com a câmera (a própria, ou a do camera_id) existente e não revogada. A comparação é de texto
--   exato com auth.uid()::text (uuid canônico, minúsculo): sufixo, subtópico, maiúsculas e espaço no fim não entram.
--   Envio nos tópicos de vídeo: ninguém (os sinais saem por enviar_sinal_de_video, abaixo; isso nega também um
--   realtime.send chamado direto pelo cliente, que roda como authenticated e passa pela política de insert; F16).
--   Qualquer outro tópico (episodio:<id>:video, outro episódio, ...): ninguém.
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
  return false;
end;
$$;

-- O create or replace mantém os privilégios; repetidos aqui para a migração dizer sozinha o que vale (DES-001 §8).
revoke execute on function public.pode_usar_canal(text, text, boolean) from public, anon, service_role;
grant execute on function public.pode_usar_canal(text, text, boolean) to authenticated;

-- =====================================================================================
-- Sinalização do vídeo (D2 a D4)
-- =====================================================================================

-- A cada chamada, a sessão é conferida no banco (dispositivo_atual(), lido uma vez) e o remetente é posto aqui: a sessão
-- antiga de um dispositivo trocado ou revogado não sinaliza mais, e o cliente não declara quem é. Só câmera ou obs_camera
-- (42501), com episódio ativo (55000) e com a câmera do par não revogada (55000). O tipo é conferido pelo lado (câmera:
-- oferta e encerrar; obs_camera: pronto, resposta e encerrar), o SDP vai exatamente nos tipos que o levam (oferta e
-- resposta) e na mesma forma do leitor do domínio (D4; revisão 2, N8): começa com v=0\r\n, só ASCII imprimível, \r e \n,
-- até 12 000 caracteres (fora disso, 22023). O destinatário é a sessão atual do par (o obs_camera não revogado da câmera, ou
-- a câmera do camera_id), lida no banco a cada chamada; sem ele, 'sem_par' e nada é publicado. O payload só leva tipo,
-- sessão, SDP e remetente (mais o id que o realtime.send acrescenta) e fica em realtime.messages de 72 h a 4 dias (F18).
-- realtime.send roda como o dono desta função (postgres no Supabase: INSERT e BYPASSRLS em realtime.messages, F16 e F17) e
-- engole qualquer erro como WARNING (F19): 'enviado' quer dizer que a função chamou o realtime.send.
create function public.enviar_sinal_de_video(p_tipo text, p_sessao uuid, p_sdp text)
returns text -- 'enviado' | 'sem_par'
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_disp record;
  v_camera uuid;
  v_destino uuid; -- auth.uid() da sessão destinatária
  v_ultimos_10s bigint;
  v_ultima_hora bigint;
  v_sdp_ultima_hora bigint;
begin
  select d.id, d.tipo, d.camera_id into v_disp from public.dispositivo_atual() d;
  if v_disp.tipo is null or v_disp.tipo not in ('camera', 'obs_camera') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if not exists (select 1 from public.episodio_ativo()) then
    raise exception 'sem episódio ativo' using errcode = '55000';
  end if;
  v_camera := case when v_disp.tipo = 'camera' then v_disp.id else v_disp.camera_id end;
  if not exists (select 1 from public.dispositivos c where c.id = v_camera and c.tipo = 'camera' and c.revogado_em is null) then
    raise exception 'câmera revogada' using errcode = '55000';
  end if;
  if p_sessao is null or p_tipo is null -- tipo nulo: sem isto, o "not (... in ...)" abaixo daria nulo e deixaria passar
     or not ((v_disp.tipo = 'camera' and p_tipo in ('oferta', 'encerrar'))
          or (v_disp.tipo = 'obs_camera' and p_tipo in ('pronto', 'resposta', 'encerrar')))
     or ((p_tipo in ('oferta', 'resposta')) <> (p_sdp is not null))
     or (p_sdp is not null and (pg_catalog.length(p_sdp) > 12000
         or pg_catalog.left(p_sdp, 5) <> 'v=0' || pg_catalog.chr(13) || pg_catalog.chr(10)
         or pg_catalog.translate(p_sdp, pg_catalog.chr(13) || pg_catalog.chr(10), '') !~ '^[ -~]*$')) then
    -- a mesma regra do leitor do domínio (D4; revisão 2, N8): começa com v=0\r\n, só ASCII imprimível, \r e \n, até 12 000
    raise exception 'sinal inválido' using errcode = '22023';
  end if;
  if v_disp.tipo = 'camera' then
    select o.usuario_anonimo_id into v_destino from public.dispositivos o
      where o.tipo = 'obs_camera' and o.camera_id = v_camera and o.revogado_em is null; -- um só (índice)
  else
    select c.usuario_anonimo_id into v_destino from public.dispositivos c where c.id = v_camera;
  end if;
  if v_destino is null then
    return 'sem_par';
  end if;
  -- Limite por remetente (revisão 2, I7): cada chamada grava uma linha em realtime.messages, guardada até 4 dias (F18), e o
  -- limite de mensagens do Realtime não freia o insert. Conta, no tópico do destinatário (o único deste remetente), as linhas
  -- deste remetente: no máximo 10 em 10 s, 600 por hora e 1 000 000 caracteres de SDP por hora. A consulta usa o índice
  -- messages_replay_index (topic, inserted_at desc) where extension = 'broadcast' and private (F20): o filtro repete o
  -- predicado do índice. A trava de transação por remetente (revisão 3, N10) deixa contar e gravar atômicos: duas chamadas
  -- paralelas da mesma sessão (pool do PostgREST) esperam uma pela outra; ela sai sozinha no fim da transação.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('enviar_sinal_de_video:' || (select auth.uid())::text));
  -- inserted_at é timestamp sem fuso, em UTC (timezone('utc', clock_timestamp()) na fonte): a comparação
  -- usa timezone('utc', now()), para não depender do TimeZone da sessão. Acima do limite, 54000 com mensagem fixa, nada publicado.
  select pg_catalog.count(*) filter (where m.inserted_at > pg_catalog.timezone('utc', pg_catalog.now()) - interval '10 seconds'),
         pg_catalog.count(*),
         coalesce(pg_catalog.sum(pg_catalog.length(m.payload ->> 'sdp')), 0)
    into v_ultimos_10s, v_ultima_hora, v_sdp_ultima_hora
    from realtime.messages m
    where m.topic = 'video:' || v_destino::text and m.extension = 'broadcast' and m.private
      and m.inserted_at > pg_catalog.timezone('utc', pg_catalog.now()) - interval '1 hour'
      and m.payload ->> 'remetente' = (select auth.uid())::text;
  if v_ultimos_10s >= 10 or v_ultima_hora >= 600 or v_sdp_ultima_hora + coalesce(pg_catalog.length(p_sdp), 0) > 1000000 then
    raise exception 'limite de sinais' using errcode = '54000';
  end if;
  perform realtime.send(
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'tipo', p_tipo, 'sessao', p_sessao, 'sdp', p_sdp, 'remetente', (select auth.uid()))),
    'sinal', 'video:' || v_destino::text, true);
  return 'enviado';
end;
$$;

revoke execute on function public.enviar_sinal_de_video(text, uuid, text) from public, anon, service_role;
grant execute on function public.enviar_sinal_de_video(text, uuid, text) to authenticated;
