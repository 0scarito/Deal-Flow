-- Phase M.1 — vendeurs_db schema + seed
create table if not exists public.vendeurs_db (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  color text not null default 'blue',
  initial text not null default '?',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
-- Seed Audrey + David with current colors
insert into public.vendeurs_db (name, color, initial, sort_order)
values
  ('Audrey', 'blue', 'A', 1),
  ('David', 'green', 'D', 2)
on conflict (name) do nothing;
-- RLS — adjust if Oscar's other tables have specific policies
alter table public.vendeurs_db enable row level security;
drop policy if exists "vendeurs_db_read_all" on public.vendeurs_db;
create policy "vendeurs_db_read_all" on public.vendeurs_db for select using (true);
drop policy if exists "vendeurs_db_write_all" on public.vendeurs_db;
create policy "vendeurs_db_write_all" on public.vendeurs_db for insert with check (true);
drop policy if exists "vendeurs_db_update_all" on public.vendeurs_db;
create policy "vendeurs_db_update_all" on public.vendeurs_db for update using (true);
