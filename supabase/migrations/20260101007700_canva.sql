-- =========================================================================
-- Synergy Swift: "Open in Canva" for slides.
--  A teacher connects their own Canva account once (OAuth with PKCE); the
--  server keeps the tokens (encrypted by the app) and sends a finished deck to
--  Canva as a PowerPoint import, so the teacher designs it further in Canva.
--  Only the server reads or writes this table.
-- Idempotent. Apply after 20260101007600.
-- =========================================================================

create table if not exists public.canva_connections (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  tenant_id      uuid references public.tenants(id) on delete cascade,
  access_token   text not null,        -- encrypted
  refresh_token  text not null,        -- encrypted; Canva refresh tokens are single-use
  expires_at     timestamptz not null,
  scope          text,
  connected_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.canva_connections enable row level security;
revoke all on public.canva_connections from anon, authenticated;
