create table if not exists public.google_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.google_tokens enable row level security;

revoke all on table public.google_tokens from anon, authenticated;
grant insert, update on table public.google_tokens to authenticated;

create policy "Users can insert their own Google token"
  on public.google_tokens
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own Google token"
  on public.google_tokens
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
