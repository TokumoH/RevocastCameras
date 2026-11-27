-- Migração de correção da etapa E3 (VER-046, I3): o episódio que está no modo teste não pode ser apagado.
-- Motivo: estudio_estado.episodio_teste_id tem "on delete set null" (20261117000000_fundacao.sql); apagar o rascunho do
-- teste desligava o modo teste sem passar por definir_modo_teste (contra a D7 do PLA-004: estado do episódio só por
-- função) e sem o aviso episodio_ativo_mudou, e o palco e o /controle ficavam no tópico do episódio apagado.
-- Aplicada pelo editor SQL do Supabase depois de 20261127124303_ao_vivo_e_pareamento.sql (ver supabase/README.md).
-- Depois de aplicada, NUNCA é editada: qualquer correção vai numa migração nova.
-- Não cria tabela, função nem grant: troca a ação da chave estrangeira estudio_estado.episodio_teste_id (set null →
-- no action) e recria a política de delete de episodios, sempre to authenticated (o grant de delete continua com política
-- correspondente). Não contém e-mail.

-- A chave estrangeira do modo teste passa a recusar o delete do episódio que está no teste (no action: 23503, que os
-- adaptadores já traduzem como em_uso; restrict daria 23001 com a mesma recusa), em vez de limpar o teste em silêncio
-- (set null). É ela que fecha qualquer caminho, por construção: a checagem da chave usa uma
-- foto nova e trava a linha, então a corrida "definir_modo_teste(X) numa transação e delete X noutra" (a política abaixo
-- é avaliada com a foto do início do comando e deixaria passar) termina em erro, nunca no teste desligado; e um delete que
-- contorne a política (dono, superusuário) também é recusado. O nome é o que o Postgres deu à restrição da coluna em
-- 20261117000000_fundacao.sql (<tabela>_<coluna>_fkey). As funções que mexem no teste (definir_modo_teste,
-- iniciar_ao_vivo, encerrar_ao_vivo) só gravam estudio_estado e não apagam episódio: não mudam.
alter table public.estudio_estado
  drop constraint estudio_estado_episodio_teste_id_fkey,
  add constraint estudio_estado_episodio_teste_id_fkey
    foreign key (episodio_teste_id) references public.episodios (id) on delete no action;

-- equipe/admin apagam só rascunho (D7) e, agora, só o que não está no modo teste: a política dá a recusa sem erro (0 linhas,
-- e a aba Episódios mostra a frase) no caso comum; a chave estrangeira acima é a garantia. "is distinct from" trata o modo
-- teste desligado (nulo) como diferente de todo id. Para apagar o episódio do teste, primeiro sai-se do teste (aba Ao vivo).
-- DEPENDÊNCIA: a subconsulta lê estudio_estado como quem apaga, e só enxerga a linha porque a política estudio_estado_le
-- deixa todo membro ler. Se uma migração futura estreitar essa leitura, a subconsulta vira nula e esta condição deixa de
-- filtrar; o delete do episódio do teste continua recusado pela chave estrangeira (falha fechada, com 23503 em vez de 0
-- linhas). O teste e3-episodio-do-teste-dependencia-da-leitura (supabase/tests/rls.test.ts) fixa esse comportamento.
-- Entre o drop e o create a tabela fica sem política de delete, o que nega (falha fechada).
drop policy episodios_equipe_apaga on public.episodios;
create policy episodios_equipe_apaga on public.episodios
  for delete to authenticated
  using (
    (select public.papel_atual()) in ('equipe', 'admin')
    and estado = 'rascunho'
    and id is distinct from (select e.episodio_teste_id from public.estudio_estado e)
  );
