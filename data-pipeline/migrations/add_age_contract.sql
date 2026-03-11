-- Run this once in the Supabase SQL editor
-- Then run: python data-pipeline/update_ages.py

alter table players add column if not exists age int;
alter table players add column if not exists contract_info jsonb default '{}';
