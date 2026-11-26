-- Migração da etapa E1: nenhum admin altera nem remove a própria linha da lista de acesso.
-- Segurança: DES-001, seção 8 ("admin lê e escreve membros_permitidos"), com a regra da decisão D1 do PLA-002.
-- Aplicada pelo editor SQL do Supabase depois de 20261117000000_fundacao.sql (ver supabase/README.md).
-- Depois de aplicada, NUNCA é editada: qualquer correção vai numa migração nova.
-- Não cria tabela, função nem grant: só recria as políticas de update e delete de membros_permitidos,
-- sempre to authenticated (o grant de update e delete da migração inicial continua com política correspondente).

-- Nenhum admin altera nem remove a própria linha da lista de acesso (PLA-002, decisão D1).
-- A comparação de e-mail é a mesma de public.papel_atual() (minúsculas). Um admin continua alterando e
-- removendo outros admins; como nenhum mexe em si, sempre sobra ao menos um (exceto se dois admins se
-- removerem um ao outro no mesmo instante; recuperação: supabase/README.md).
-- Entre o drop e o create a tabela fica sem política de update/delete, o que nega (falha fechada).
drop policy membros_permitidos_admin_altera on public.membros_permitidos;
drop policy membros_permitidos_admin_apaga on public.membros_permitidos;

create policy membros_permitidos_admin_altera on public.membros_permitidos
  for update to authenticated
  using ((select public.papel_atual()) = 'admin' and email <> (select lower(auth.jwt() ->> 'email')))
  with check ((select public.papel_atual()) = 'admin' and email <> (select lower(auth.jwt() ->> 'email')));
create policy membros_permitidos_admin_apaga on public.membros_permitidos
  for delete to authenticated
  using ((select public.papel_atual()) = 'admin' and email <> (select lower(auth.jwt() ->> 'email')));
