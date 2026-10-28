-- =========================================================================
-- Synergy Swift: USSD menus for parents on basic phones (phase 14q).
--  Parents dial the platform's USSD code (Africa's Talking). The phone number
--  they dial from is how they are recognised: it must be on a guardian record
--  at the school. They only ever see their own children. Schools can switch
--  USSD off.
-- Idempotent. Apply after 20260101008100.
-- =========================================================================

alter table public.tenant_settings add column if not exists ussd_enabled boolean not null default true;

-- The children of whoever owns this phone number (last 10 digits of phone or WhatsApp number),
-- at active schools that have USSD on. Server only.
create or replace function public.ussd_children(p_digits text)
returns table (tenant_id uuid, guardian_id uuid, guardian_name text, student_id uuid, first_name text, last_name text, class_name text, timezone text, school_name text)
language sql stable security definer set search_path = public as $$
  with d as (select right(regexp_replace(coalesce(p_digits, ''), '\D', '', 'g'), 10) as tail)
  select g.tenant_id, g.id, g.full_name, s.id, s.first_name, s.last_name, cg.name, coalesce(t.timezone, 'Africa/Lagos'), coalesce(ts.school_name, t.name)
    from d
    join public.guardians g on length(d.tail) = 10 and (
         right(regexp_replace(coalesce(g.phone, ''), '\D', '', 'g'), 10) = d.tail
      or right(regexp_replace(coalesce(g.whatsapp_phone, ''), '\D', '', 'g'), 10) = d.tail)
    join public.tenants t on t.id = g.tenant_id and t.status = 'active'
    left join public.tenant_settings ts on ts.tenant_id = g.tenant_id
    join public.student_guardians sg on sg.guardian_id = g.id
    join public.students s on s.id = sg.student_id and s.status = 'active'
    left join public.class_groups cg on cg.id = s.class_group_id
   where coalesce(ts.ussd_enabled, true)
   order by s.first_name, s.last_name
   limit 12;
$$;
revoke all on function public.ussd_children(text) from public, anon, authenticated;
grant execute on function public.ussd_children(text) to service_role;
