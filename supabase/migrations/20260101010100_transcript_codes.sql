-- 10100: transcript codes. A parent opens a child's transcript only after entering a code the
-- school's admins made for that child (School office → Transcripts). A code works only for a
-- parent already linked to that child, a few parents at most, and can expire or be withdrawn.
-- Each parent who unlocked a child's transcript is recorded, and the school can take it back.
-- Nobody but the server reads these tables. Safe to run again.

create table if not exists public.transcript_codes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  code        text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  max_uses    int not null default 4 check (max_uses between 1 and 10),
  uses        int not null default 0,
  expires_at  timestamptz,
  revoked_at  timestamptz,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
-- One live code per child (a new one replaces the old).
create unique index if not exists transcript_codes_live on public.transcript_codes(student_id) where revoked_at is null;
create index if not exists transcript_codes_tenant on public.transcript_codes(tenant_id);

create table if not exists public.transcript_access (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  code_id     uuid references public.transcript_codes(id) on delete set null,
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  primary key (student_id, user_id)
);
create index if not exists transcript_access_tenant on public.transcript_access(tenant_id);

alter table public.transcript_codes enable row level security;
alter table public.transcript_access enable row level security;
revoke all on public.transcript_codes, public.transcript_access from anon, authenticated;
grant select, insert, update, delete on public.transcript_codes, public.transcript_access to service_role;

/** Makes (or replaces) a child's transcript code. Returns the code. Server only. */
create or replace function public.issue_transcript_code(p_student uuid, p_by uuid default null, p_days int default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_tenant uuid; c text; i int;
begin
  select tenant_id into v_tenant from public.students where id = p_student;
  if v_tenant is null then raise exception 'student not found' using errcode = 'P0002'; end if;
  update public.transcript_codes set revoked_at = now() where student_id = p_student and revoked_at is null;
  loop
    c := '';
    for i in 0..7 loop
      c := c || substr(a, 1 + (('x' || substr(md5(gen_random_uuid()::text || clock_timestamp()::text), i * 3 + 1, 3))::bit(12)::int % 32), 1);
    end loop;
    exit when not exists (select 1 from public.transcript_codes where code = c);
  end loop;
  insert into public.transcript_codes (tenant_id, student_id, code, expires_at, created_by)
    values (v_tenant, p_student, c, case when p_days is null then null else now() + make_interval(days => p_days) end,
            (select id from public.users where id = p_by));
  return c;
end$$;

/**
 * A parent enters a transcript code (server only). It must be the live code of a child already
 * linked to this parent, not expired, with uses left. Unlocking again (after the school took it
 * back) is allowed with a live code. Errors are worded for the parent.
 */
create or replace function public.unlock_transcript(p_code text, p_user uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c       public.transcript_codes;
  u       public.users;
  v_name  text;
  v_had   boolean;
begin
  select * into u from public.users where id = p_user;
  if u.id is null or not (u.role = 'parent' or 'parent' = any(coalesce(u.extra_roles, '{}'))) then
    raise exception 'Only parents unlock transcripts with a code.' using errcode = '42501';
  end if;
  select * into c from public.transcript_codes
    where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) for update;
  if c.id is null or c.revoked_at is not null or c.tenant_id <> u.tenant_id
     or not exists (select 1 from public.student_guardians sg join public.guardians g on g.id = sg.guardian_id
                    where sg.student_id = c.student_id and g.user_id = p_user) then
    raise exception 'That transcript code is not right for any of your children. Check it with the school.' using errcode = 'P0002';
  end if;
  if c.expires_at is not null and c.expires_at <= now() then
    raise exception 'That transcript code has expired. Ask the school for a new one.' using errcode = 'P0001';
  end if;
  select exists (select 1 from public.transcript_access where student_id = c.student_id and user_id = p_user and revoked_at is null) into v_had;
  if not v_had then
    if c.uses >= c.max_uses then
      raise exception 'That transcript code has been used as many times as it allows. Ask the school for a new one.' using errcode = 'P0001';
    end if;
    insert into public.transcript_access (tenant_id, student_id, user_id, code_id) values (c.tenant_id, c.student_id, p_user, c.id)
      on conflict (student_id, user_id) do update set revoked_at = null, granted_at = now(), code_id = excluded.code_id;
    update public.transcript_codes set uses = uses + 1 where id = c.id;
    insert into public.audit_logs (tenant_id, actor_id, action, target, meta)
      values (c.tenant_id, p_user, 'transcript.unlocked', c.student_id::text, jsonb_build_object('code_id', c.id));
  end if;
  select first_name || ' ' || last_name into v_name from public.students where id = c.student_id;
  return jsonb_build_object('student_id', c.student_id, 'name', v_name, 'already', v_had);
end$$;

revoke execute on function public.issue_transcript_code(uuid, uuid, int), public.unlock_transcript(text, uuid) from public, anon, authenticated;
grant execute on function public.issue_transcript_code(uuid, uuid, int), public.unlock_transcript(text, uuid) to service_role;

-- A parent no longer linked to a child loses that child's transcript at once: linking them again
-- later needs a fresh code from the school.
create or replace function public.transcript_access_on_unlink() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.transcript_access ta
   where ta.student_id = old.student_id
     and ta.user_id = (select g.user_id from public.guardians g where g.id = old.guardian_id);
  return old;
end$$;
drop trigger if exists transcript_access_on_unlink on public.student_guardians;
create trigger transcript_access_on_unlink after delete on public.student_guardians
  for each row execute function public.transcript_access_on_unlink();

-- Codes are secrets: never kept in the recycle bin (9400).
do $$ begin
  drop trigger if exists aaa_recycle_bin on public.transcript_codes;
  drop trigger if exists aaa_recycle_bin_unlink on public.transcript_codes;
  drop trigger if exists aaa_recycle_bin on public.transcript_access;
  drop trigger if exists aaa_recycle_bin_unlink on public.transcript_access;
end $$;
