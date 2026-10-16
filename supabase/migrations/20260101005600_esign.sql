-- =====================================================================
--  Phase 13g: e-signatures for forms and contracts.
--
--  * A signature request holds the text (and optionally a document from the
--    library) and the people who must sign: staff, parents (for a child) or
--    someone outside the school. Each signer gets a private single-use link.
--  * Signing records the typed name, an optional drawn signature, time,
--    IP address and browser, and a fingerprint (SHA-256) of exactly what was
--    signed. A signature cannot be changed afterwards.
--  * For parents' forms, one parent signing for a child is enough; the
--    request completes when every signer (or every child) is done.
--  * Signing a staff contract marks it accepted in HR.
-- =====================================================================

create table if not exists public.signature_requests (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  title              text not null check (length(trim(title)) between 2 and 200),
  kind               text not null default 'form' check (kind in ('form','contract','policy','consent','other')),
  body               text not null default '' check (length(body) <= 100000),
  document_id        uuid references public.school_documents(id) on delete set null,
  staff_contract_id  uuid references public.staff_contracts(id) on delete set null,
  rule               text not null default 'all' check (rule in ('all','any_per_child')),
  content_hash       text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  due_on             date,
  status             text not null default 'open' check (status in ('open','completed','cancelled')),
  created_by         uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  check (length(trim(body)) > 0 or document_id is not null)
);

create table if not exists public.signature_signers (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  request_id      uuid not null references public.signature_requests(id) on delete cascade,
  signer_type     text not null check (signer_type in ('staff','guardian','external')),
  user_id         uuid references public.users(id) on delete set null,
  guardian_id     uuid references public.guardians(id) on delete set null,
  student_id      uuid references public.students(id) on delete set null,
  name            text not null check (length(trim(name)) between 1 and 160),
  email           text,
  token           text not null unique default encode(gen_random_bytes(24), 'hex'),
  status          text not null default 'pending' check (status in ('pending','viewed','signed','declined','not_needed')),
  viewed_at       timestamptz,
  signed_at       timestamptz,
  typed_name      text,
  signature_png   text check (signature_png is null or (signature_png like 'data:image/png;base64,%' and length(signature_png) <= 400000)),
  decline_reason  text,
  signed_hash     text,
  ip              text,
  user_agent      text,
  created_at      timestamptz not null default now(),
  check (signer_type <> 'staff' or user_id is not null),
  check (signer_type <> 'guardian' or (guardian_id is not null and student_id is not null)),
  check (status <> 'signed' or (signed_at is not null and typed_name is not null and signed_hash is not null))
);
create index if not exists signature_signers_request on public.signature_signers(request_id);
create index if not exists signature_signers_user on public.signature_signers(user_id) where user_id is not null;

-- A signature, once given or declined, stays as it was; signatures must match what was sent.
create or replace function public.signature_signers_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.signature_requests;
begin
  if tg_op = 'DELETE' then
    if old.status = 'signed' and auth.uid() is not null then raise exception 'a signature cannot be deleted'; end if;
    return old;
  end if;
  if old.status in ('signed','declined') and row(new.*) is distinct from row(old.*) then
    raise exception 'a signature cannot be changed';
  end if;
  if new.status = 'signed' and old.status <> 'signed' then
    select * into r from public.signature_requests where id = new.request_id;
    if r.status <> 'open' then raise exception 'this request is no longer open'; end if;
    if new.signed_hash is distinct from r.content_hash then raise exception 'the document changed since it was sent'; end if;
  end if;
  return new;
end $$;
drop trigger if exists signature_signers_guard on public.signature_signers;
create trigger signature_signers_guard before update or delete on public.signature_signers for each row execute function public.signature_signers_guard();

-- After each signature: other parents of the same child are not needed (any-per-child forms);
-- the request completes when nobody is left to sign; a signed contract is accepted.
create or replace function public.signature_progress() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.signature_requests;
begin
  if new.status not in ('signed','declined') or old.status = new.status then return null; end if;
  select * into r from public.signature_requests where id = new.request_id;
  if new.status = 'signed' and r.rule = 'any_per_child' and new.student_id is not null then
    update public.signature_signers set status = 'not_needed'
      where request_id = new.request_id and student_id = new.student_id and id <> new.id and status in ('pending','viewed');
  end if;
  if new.status = 'signed' and not exists (select 1 from public.signature_signers where request_id = new.request_id and status in ('pending','viewed','declined')) then
    update public.signature_requests set status = 'completed', completed_at = now() where id = new.request_id and status = 'open';
    if r.staff_contract_id is not null then
      update public.staff_contracts set accepted_at = coalesce(accepted_at, now()) where id = r.staff_contract_id;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists signature_progress on public.signature_signers;
create trigger signature_progress after update on public.signature_signers for each row execute function public.signature_progress();

-- Requests with signatures on them are kept.
create or replace function public.signature_requests_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if auth.uid() is not null and exists (select 1 from public.signature_signers where request_id = old.id and status = 'signed') then
      raise exception 'a request with signatures cannot be deleted; cancel it instead';
    end if;
    return old;
  end if;
  if auth.uid() is not null and (new.content_hash <> old.content_hash or new.body <> old.body or new.title <> old.title or new.document_id is distinct from old.document_id) then
    raise exception 'a sent request cannot be edited; cancel it and send a new one';
  end if;
  if old.status in ('completed','cancelled') and new.status <> old.status and auth.uid() is not null then
    raise exception 'this request is closed';
  end if;
  return new;
end $$;
drop trigger if exists signature_requests_guard on public.signature_requests;
create trigger signature_requests_guard before update or delete on public.signature_requests for each row execute function public.signature_requests_guard();

-- Helpers (security definer) so the two tables' policies do not query each other.
create or replace function public.can_manage_signatures(p_created_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() and (public.is_school_admin() or public.is_hr() or p_created_by = auth.uid());
$$;
create or replace function public.manages_signature_request(p_request uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.signature_requests r where r.id = p_request and r.tenant_id = public.my_tenant_id() and public.can_manage_signatures(r.created_by));
$$;
create or replace function public.signs_request(p_request uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.signature_signers s where s.request_id = p_request and (s.user_id = auth.uid()
    or s.guardian_id in (select g.id from public.guardians g where g.user_id = auth.uid())));
$$;
grant execute on function public.can_manage_signatures(uuid), public.manages_signature_request(uuid), public.signs_request(uuid) to authenticated;

alter table public.signature_requests enable row level security;
drop policy if exists signature_requests_read on public.signature_requests;
create policy signature_requests_read on public.signature_requests for select
  using (tenant_id = public.my_tenant_id() and (public.can_manage_signatures(created_by) or public.signs_request(id)));
drop policy if exists signature_requests_cancel on public.signature_requests;
create policy signature_requests_cancel on public.signature_requests for update
  using (tenant_id = public.my_tenant_id() and public.can_manage_signatures(created_by))
  with check (tenant_id = public.my_tenant_id());
-- Requests and signers are created, and signatures recorded, by the server.
grant all on public.signature_requests to service_role;

alter table public.signature_signers enable row level security;
drop policy if exists signature_signers_read on public.signature_signers;
create policy signature_signers_read on public.signature_signers for select using (tenant_id = public.my_tenant_id() and (
  user_id = auth.uid() or guardian_id in (select g.id from public.guardians g where g.user_id = auth.uid()) or public.manages_signature_request(request_id)));
grant all on public.signature_signers to service_role;

select public.attach_change_log();
