-- A conexão OAuth com o Google Agenda foi removida; os refresh tokens não são mais usados.
drop table if exists public.google_tokens;
