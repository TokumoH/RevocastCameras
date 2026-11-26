-- Migração da etapa E2: bucket privado da Biblioteca (midias) e políticas de storage.objects.
-- Modelo e segurança: DES-001, seções 7, 8 e 15; decisões D3 a D5 do PLA-003 (docs/planos/2026-11-26-e2-preparar-episodio.md).
-- Aplicada pelo editor SQL do Supabase depois de 20261117000000_fundacao.sql e de
-- 20261126142500_membros_sem_autoalteracao.sql (ver supabase/README.md).
-- Depois de aplicada, NUNCA é editada: qualquer correção vai numa migração nova.
-- Não contém e-mail. Não cria tabela, função nem grant: só a linha do bucket e três políticas, sempre to authenticated
-- (os privilégios de storage.* são os do Supabase; quem protege é a RLS). Sem política de update (D5).

-- Bucket privado da Biblioteca (PLA-003, D3 a D5). public = false: nenhuma URL pública. Limite de 50 MB por arquivo
-- (DES-001 §3) e só os tipos da D4 (sem SVG). O on conflict cobre um bucket criado antes à mão pelo painel:
-- os limites e o "privado" valem do mesmo jeito.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('midias', 'midias', false, 52428800,
  array['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Leitura: equipe/admin (prévia na Biblioteca) e o obs_palco (toca os sons e mostra as imagens). DES-001 §8.
create policy midias_storage_le on storage.objects
  for select to authenticated
  using (bucket_id = 'midias' and (
    (select public.papel_atual()) in ('equipe', 'admin')
    or (select tipo from public.dispositivo_atual()) = 'obs_palco'));

-- Envio: só equipe/admin, só com o caminho que o app gera (pasta do tipo, uuid em minúsculas, extensão do tipo).
create policy midias_storage_insere on storage.objects
  for insert to authenticated
  with check (bucket_id = 'midias' and (select public.papel_atual()) in ('equipe', 'admin')
    and name ~ '^(som/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp3|wav|ogg|m4a)|imagem/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif))$');

-- Exclusão: só equipe/admin. Sem política de update: nada é sobrescrito (D5).
create policy midias_storage_apaga on storage.objects
  for delete to authenticated
  using (bucket_id = 'midias' and (select public.papel_atual()) in ('equipe', 'admin'));
