-- Links secretos .ics do Google Agenda, guardados só no servidor.
-- Nenhuma política e nenhum grant para anon/authenticated: somente a Edge Function
-- (papel service_role) lê e grava. O navegador nunca recebe o link de volta.
create table if not exists public.calendar_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ics_url text not null,
  created_at timestamptz not null default now(),
  unique (user_id, ics_url)
);

alter table public.calendar_links enable row level security;

revoke all on table public.calendar_links from anon, authenticated;
grant select, insert, update, delete on table public.calendar_links to service_role;
