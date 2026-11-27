-- Migração de correção da etapa E3 (VER-047; fecha o I4 da revisão final, VER-046): o estado no ar do palco passa a ter um
-- tópico próprio, só membros enviam em :controle, e só pode haver um obs_palco não revogado.
-- Motivo: no Realtime, a permissão de envio é conferida só pelo tópico e pela extensão (o event do Broadcast não chega à
-- autorização, e a resposta fica guardada por conexão até o token novo; evidência no VER-046, "Era proposital?"). Com o
-- obs_palco enviando broadcast em episodio:<id>:controle para publicar o estado, qualquer obs_palco (um segundo, criado por
-- chamada direta à API, ou a sessão antiga de um palco trocado) podia publicar comando ali, e um segundo obs_palco podia
-- publicar estado falso, aceito pelo /controle e pela aba Ao vivo.
-- Aplicada pelo editor SQL do Supabase depois de 20261127200000_episodio_em_teste_nao_se_apaga.sql (ver supabase/README.md).
-- Depois de aplicada, NUNCA é editada: qualquer correção vai numa migração nova.
-- Não cria tabela, função nova, política nem grant novo: recria public.pode_usar_canal com o mesmo nome e os mesmos tipos
-- (create or replace mantém o oid, então as duas políticas de realtime.messages continuam chamando a mesma função, como o
-- data-api:check confere em FUNCOES_DO_CANAL) e cria um índice único parcial em public.dispositivos. Não contém e-mail.

-- =====================================================================================
-- Um palco só (VER-047)
-- =====================================================================================

-- No máximo um obs_palco não revogado (pareado ou com código pendente): o estado em episodio:<id>:estado tem um autor só.
-- criar_codigo_pareamento sem p_dispositivo, com um palco ativo, passa a dar 23505 (duplicado) no insert; a aba Ao vivo já
-- reaproveita o palco cadastrado (Tarefa 8 do PLA-004), então só a chamada direta à API cai aqui. Parear de novo um palco
-- revogado (parear_dispositivo limpa revogado_em) com outro ativo também dá 23505, sem consumir o código. Se o banco já tiver
-- dois obs_palco ativos, o create unique index falha com 23505 e nada desta migração é aplicado: revogar o que sobra pela
-- aba Ao vivo e rodar de novo (consulta de conferência no guia "Ao vivo e pareamento (E3)", supabase/README.md).
create unique index dispositivos_um_palco_ativo
  on public.dispositivos (tipo) where tipo = 'obs_palco' and revogado_em is null;

-- =====================================================================================
-- Canais do Realtime (D6, revista no VER-047)
-- =====================================================================================

-- Matriz do canal: toda decisão de quem recebe (p_enviar falso) e quem envia (verdadeiro) fica aqui; as duas políticas de
-- realtime.messages só a chamam. Só broadcast e presence (persistence e qualquer outra: falso).
--   estudio: recebem e marcam presença todo membro com papel e todo dispositivo não revogado; broadcast só equipe/admin.
--   episodio:<id de episodio_ativo()>:controle (comandos): recebem todo membro e o obs_palco (os comandos e a presença
--   dos membros); broadcast (comando) e presença só membros. O obs_palco não envia nada aqui.
--   episodio:<id de episodio_ativo()>:estado (estado no ar): recebem todo membro e o obs_palco (o palco precisa da leitura
--   para entrar no canal); broadcast só o obs_palco (há no máximo um não revogado, índice acima); presença ninguém.
--   Qualquer outro tópico (episodio:<id>:video até a E4, outro episódio, ...): ninguém.
create or replace function public.pode_usar_canal(p_topico text, p_extensao text, p_enviar boolean)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_papel public.papel_app := (select public.papel_atual());
  v_tipo public.tipo_dispositivo := (select d.tipo from public.dispositivo_atual() d);
  v_ativo uuid := (select a.id from public.episodio_ativo() a);
  v_palco boolean := coalesce(v_tipo = 'obs_palco', false);
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
  return false;
end;
$$;

-- O create or replace mantém os privilégios; repetidos aqui para a migração dizer sozinha o que vale (DES-001 §8).
revoke execute on function public.pode_usar_canal(text, text, boolean) from public, anon, service_role;
grant execute on function public.pode_usar_canal(text, text, boolean) to authenticated;
