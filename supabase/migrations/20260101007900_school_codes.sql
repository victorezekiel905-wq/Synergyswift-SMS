-- =========================================================================
-- Synergy Swift: only the platform owner creates schools.
--  A school is created either by the owner in the platform console, or by a
--  prospect using a one-time school code the owner generated. A code works
--  once: the moment a school is created with it, it is used up. Unused codes
--  expire on their date and can be revoked.
--  Codes are stored as a hash; the plain code is shown to the owner once.
--  Also closes a back door: the live-lessons engine let any signed-in account
--  create its own school (live.bootstrap_school). Live schools now come only
--  from Synergy Swift schools (live_sync).
-- Idempotent. Apply after 20260101007800.
-- =========================================================================

create table if not exists public.school_signup_codes (
  id           uuid primary key default gen_random_uuid(),
  code_hash    text not null unique,
  hint         text not null,                       -- the last 4 characters, to tell codes apart
  label        text not null check (length(btrim(label)) between 2 and 200),   -- e.g. the school it is for
  lead_id      uuid references public.sales_leads(id) on delete set null,
  plan_code    text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  used_by      uuid references auth.users(id) on delete set null,
  tenant_id    uuid references public.tenants(id) on delete set null,
  revoked_at   timestamptz,
  check (expires_at > created_at)
);
create index if not exists school_signup_codes_open on public.school_signup_codes(expires_at) where used_at is null and revoked_at is null;
alter table public.school_signup_codes enable row level security;
revoke all on public.school_signup_codes from anon, authenticated;

-- Uses up a code in one step: returns its id when it was valid (unused, not revoked, not expired), else null.
-- Two people racing with the same code: only one gets it.
create or replace function public.claim_school_code(p_hash text, p_user uuid)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  update public.school_signup_codes set used_at = now(), used_by = p_user
   where code_hash = p_hash and used_at is null and revoked_at is null and expires_at > now()
  returning id into v_id;
  return v_id;
end $$;
-- Puts a claimed code back when creating the school failed, so the prospect can try again.
create or replace function public.release_school_code(p_id uuid)
returns void language sql volatile security definer set search_path = public as $$
  update public.school_signup_codes set used_at = null, used_by = null where id = p_id and tenant_id is null;
$$;
revoke all on function public.claim_school_code(text, uuid) from public, anon, authenticated;
revoke all on function public.release_school_code(uuid) from public, anon, authenticated;
grant execute on function public.claim_school_code(text, uuid) to service_role;
grant execute on function public.release_school_code(uuid) to service_role;

-- The live-lessons engine's own school creation is closed to signed-in accounts.
do $$ begin
  if to_regprocedure('live.bootstrap_school(text,text,text)') is not null then
    execute 'revoke execute on function live.bootstrap_school(text,text,text) from public, anon, authenticated';
  end if;
  if to_regprocedure('live.sa_create_tenant(text,text,text,text)') is not null then
    execute 'revoke execute on function live.sa_create_tenant(text,text,text,text) from public, anon, authenticated';
  end if;
end $$;
