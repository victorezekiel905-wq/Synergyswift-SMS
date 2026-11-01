-- =========================================================================
-- Synergy Swift: the results portal.
--  - Grading systems say which stage they are for (preschool, primary,
--    secondary, sixth form), so each stage keeps its own.
--  - Preschool is assessed the early-years way: no scores, no positions.
--    Each child is rated against the school's own checklist (areas of
--    learning and statements, e.g. the EYFS areas) on the school's own
--    scale, with a short comment per area. A grading system with the
--    'early_years' layout turns this on for the classes that use it.
--  - tenant_settings.early_years holds the scale and report options.
--  - Subject teachers can set the parts for their own subject in a class
--    (CAT 1, CAT 2, HW, Test, Exam…) when the school's grading system
--    allows it. Grades, pass mark and report layout stay the school's.
-- Idempotent. Apply after 20260101009110.
-- =========================================================================

alter table public.grading_schemes add column if not exists stage text;
alter table public.grading_schemes drop constraint if exists grading_schemes_stage_check;
alter table public.grading_schemes add constraint grading_schemes_stage_check
  check (stage is null or stage in ('preschool', 'primary', 'secondary', 'sixth_form'));
alter table public.grading_schemes drop constraint if exists grading_schemes_template_check;
alter table public.grading_schemes add constraint grading_schemes_template_check
  check (template in ('nigerian', 'british', 'american', 'early_years'));

-- { "scale": [{ "value": 3, "short": "SEC", "label": "Secure" }, …], "options": { "area_comments": true, … } }
alter table public.tenant_settings add column if not exists early_years jsonb not null default '{}'::jsonb;
alter table public.tenant_settings drop constraint if exists tenant_settings_early_years_shape;
alter table public.tenant_settings add constraint tenant_settings_early_years_shape check (jsonb_typeof(early_years) = 'object');

-- Areas of learning (Communication and language, Physical development, …).
create table if not exists public.early_years_areas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80),
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name),
  unique (id, tenant_id)
);

-- What the child can do, within an area ("Listens attentively in a group").
create table if not exists public.early_years_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  area_id     uuid not null,
  text        text not null check (length(btrim(text)) between 1 and 200),
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  -- An item can only sit in an area of its own school.
  foreign key (area_id, tenant_id) references public.early_years_areas(id, tenant_id) on delete cascade
);

create table if not exists public.early_years_ratings (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  term_id     uuid not null references public.terms(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  item_id     uuid not null,
  rating      int not null check (rating between 1 and 6),
  rated_by    uuid references public.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (term_id, student_id, item_id),
  foreign key (item_id, tenant_id) references public.early_years_items(id, tenant_id) on delete cascade
);

create table if not exists public.early_years_comments (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  term_id     uuid not null references public.terms(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  area_id     uuid not null,
  comment     text not null check (length(comment) <= 1500),
  written_by  uuid references public.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (term_id, student_id, area_id),
  foreign key (area_id, tenant_id) references public.early_years_areas(id, tenant_id) on delete cascade
);

-- Every link gets an index (see 8800).
create index if not exists early_years_items_area on public.early_years_items(area_id, position);
create index if not exists early_years_items_tenant on public.early_years_items(tenant_id);
create index if not exists early_years_ratings_tenant on public.early_years_ratings(tenant_id);
create index if not exists early_years_ratings_student on public.early_years_ratings(student_id);
create index if not exists early_years_ratings_item on public.early_years_ratings(item_id, tenant_id);
create index if not exists early_years_ratings_rated_by on public.early_years_ratings(rated_by);
create index if not exists early_years_comments_tenant on public.early_years_comments(tenant_id);
create index if not exists early_years_comments_student on public.early_years_comments(student_id);
create index if not exists early_years_comments_area on public.early_years_comments(area_id, tenant_id);
create index if not exists early_years_comments_written_by on public.early_years_comments(written_by);

alter table public.early_years_areas    enable row level security;
alter table public.early_years_items    enable row level security;
alter table public.early_years_ratings  enable row level security;
alter table public.early_years_comments enable row level security;

-- The checklist: everyone in the school reads it, admins change it.
do $$
declare t text;
begin
  foreach t in array array['early_years_areas', 'early_years_items'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (tenant_id = public.my_tenant_id())', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all using (tenant_id = public.my_tenant_id() and public.is_school_admin()) with check (tenant_id = public.my_tenant_id() and public.is_school_admin())', t || '_write', t);
  end loop;
end $$;

-- Ratings and comments: staff read; the child's teachers (or admins) write. Families see them on the published report card.
do $$
declare t text;
begin
  foreach t in array array['early_years_ratings', 'early_years_comments'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (tenant_id = public.my_tenant_id() and public.is_staff())', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all using (tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.teaches_student(student_id))) with check (tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.teaches_student(student_id)))', t || '_write', t);
  end loop;
end $$;

revoke all on public.early_years_areas, public.early_years_items, public.early_years_ratings, public.early_years_comments from anon;
grant select, insert, update, delete on public.early_years_areas, public.early_years_items, public.early_years_ratings, public.early_years_comments to authenticated;

-- ---------- Subject teachers set their subject's own parts ----------
-- The school decides per grading system whether its subject teachers may.
alter table public.grading_schemes add column if not exists subject_parts boolean not null default false;

-- A part belongs either to a grading system (the school's parts for its classes)
-- or to one subject in one class (that subject's own parts).
alter table public.grading_components add column if not exists offering_id uuid references public.subject_offerings(id) on delete cascade;
alter table public.grading_components alter column scheme_id drop not null;
alter table public.grading_components drop constraint if exists grading_components_owner_check;
alter table public.grading_components add constraint grading_components_owner_check check (num_nonnulls(scheme_id, offering_id) = 1);
create index if not exists grading_components_offering on public.grading_components(offering_id, position);

-- Admins always; the subject's teacher when the class's grading system (or the school
-- default, for a class without one) lets subject teachers set their own parts.
create or replace function public.can_set_subject_parts(p_offering uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subject_offerings o
    join public.class_groups g on g.id = o.class_group_id
    where o.id = p_offering and o.tenant_id = public.my_tenant_id()
      and (public.is_school_admin() or (
        o.teacher_id = (select auth.uid()) and coalesce(
          (select s.subject_parts from public.grading_schemes s where s.id = g.scheme_id),
          (select s.subject_parts from public.grading_schemes s where s.tenant_id = o.tenant_id order by s.is_default desc, s.created_at limit 1),
          false)))
  );
$$;
revoke all on function public.can_set_subject_parts(uuid) from public, anon;
grant execute on function public.can_set_subject_parts(uuid) to authenticated;

drop policy if exists grading_components_read on public.grading_components;
create policy grading_components_read on public.grading_components for select using (
  exists (select 1 from public.grading_schemes s where s.id = grading_components.scheme_id and s.tenant_id = public.my_tenant_id())
  or exists (select 1 from public.subject_offerings o where o.id = grading_components.offering_id and o.tenant_id = public.my_tenant_id()));
drop policy if exists grading_components_write on public.grading_components;
create policy grading_components_write on public.grading_components for all using (
  (public.is_school_admin() and exists (select 1 from public.grading_schemes s where s.id = grading_components.scheme_id and s.tenant_id = public.my_tenant_id()))
  or (grading_components.offering_id is not null and public.can_set_subject_parts(grading_components.offering_id))
) with check (
  (public.is_school_admin() and exists (select 1 from public.grading_schemes s where s.id = grading_components.scheme_id and s.tenant_id = public.my_tenant_id()))
  or (grading_components.offering_id is not null and public.can_set_subject_parts(grading_components.offering_id)));

select public.attach_change_log();
