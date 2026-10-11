revoke all on table public.google_tokens from anon, authenticated;
grant select, insert, update on table public.google_tokens to service_role;

drop policy if exists "Users can insert their own Google token" on public.google_tokens;
drop policy if exists "Users can update their own Google token" on public.google_tokens;
