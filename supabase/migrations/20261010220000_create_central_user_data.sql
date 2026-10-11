create table if not exists public.central_user_data (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.central_user_data enable row level security;

grant select, insert, update, delete on table public.central_user_data to authenticated;

create policy "Users can read their own Central data"
  on public.central_user_data
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own Central data"
  on public.central_user_data
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own Central data"
  on public.central_user_data
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own Central data"
  on public.central_user_data
  for delete
  to authenticated
  using (auth.uid() = user_id);
