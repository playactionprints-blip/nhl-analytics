-- Allows the existing data-pipeline anon-key logger to insert freshness rows
-- into sync_log while keeping public reads intact.

drop policy if exists "sync_log_anon_insert" on public.sync_log;
create policy "sync_log_anon_insert"
on public.sync_log for insert
to anon
with check (true);
