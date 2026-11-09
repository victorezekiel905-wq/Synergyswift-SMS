-- Recycle bin: what a school deletes can be put back, or deleted for good.
--
-- A deletion is caught by the database, so it works the same from every page, API and app.
-- When someone deletes one of the things people think of as a record (a student, a class,
-- an exam, a document...), that row and everything removed with it in the same go (the
-- class's homework, the exam's papers and attempts...) are kept together as one deletion.
-- Links that were only cleared (a class deleted, its students left with no class) are kept
-- too, so putting the class back puts the students back in it.
--
-- Not kept: logs and machine state, sign-in codes and secrets, monitoring captures, and a
-- whole school being deleted by the platform. Only the server (service role) reads the bin;
-- the school's admins reach it through /school/recycle-bin.

create table if not exists public.recycle_bin (
  id          bigint generated always as identity primary key,
  batch       text not null,                 -- one deletion: everything removed in the same transaction
  tenant_id   uuid,
  schema_name text not null,
  table_name  text not null,
  row_id      text,
  op          text not null default 'delete' check (op in ('delete','unlink')),
  top         boolean not null default false, -- what the person deleted (the rest went with it)
  data        jsonb not null,                -- the whole row; for 'unlink', the links that were cleared
  actor_id    uuid,
  actor       text not null default 'system',
  deleted_at  timestamptz not null default now()
);
create index if not exists recycle_bin_list on public.recycle_bin(tenant_id, deleted_at desc) where top;
create index if not exists recycle_bin_batch on public.recycle_bin(batch, id);
create index if not exists recycle_bin_age on public.recycle_bin(deleted_at);
alter table public.recycle_bin enable row level security;
revoke all on public.recycle_bin from anon, authenticated;
grant select, delete on public.recycle_bin to service_role;

-- Keeps a deleted row (or the links a deletion cleared). Runs before every other delete trigger.
create or replace function public.recycle_bin_capture()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb;
  n jsonb;
  d jsonb := '{}'::jsonb;
  k text;
  tid uuid;
  is_top boolean;
  active boolean := coalesce(current_setting('app.bin_active', true), '') = 'on';
  claims jsonb;
  hdr jsonb;
  who uuid;
  label text := 'user';
begin
  -- A school being removed by the platform, or a deletion being put back: nothing to keep.
  if coalesce(current_setting('app.purging_tenant', true), '') <> '' or coalesce(current_setting('app.bin_restoring', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' then
    -- Only links cleared as part of a deletion being kept (on delete set null).
    if not active then return new; end if;
    o := to_jsonb(old); n := to_jsonb(new);
    if not (o ? 'id') then return new; end if;
    for k in select e.key from jsonb_each(o) e where jsonb_typeof(e.value) <> 'null' and jsonb_typeof(n -> e.key) = 'null' loop
      d := d || jsonb_build_object(k, o -> k);
    end loop;
    if d = '{}'::jsonb then return new; end if;
    insert into public.recycle_bin (batch, tenant_id, schema_name, table_name, row_id, op, data)
    values (current_setting('app.bin_batch', true), coalesce(nullif(o ->> 'tenant_id', '')::uuid, nullif(current_setting('app.bin_tenant', true), '')::uuid),
            tg_table_schema, tg_table_name, o ->> 'id', 'unlink', d);
    return new;
  end if;

  -- DELETE. "top": a record a person deleted directly (not removed because something else was).
  is_top := tg_argv[0] = 'top' and pg_trigger_depth() = 1;
  if not is_top and not active then return old; end if;
  o := to_jsonb(old);
  tid := nullif(o ->> 'tenant_id', '')::uuid;
  if is_top then
    if tid is null or not exists (select 1 from public.tenants where id = tid) then return old; end if;
    if not active then
      perform set_config('app.bin_active', 'on', true);
      perform set_config('app.bin_batch', 't' || txid_current()::text, true);
      perform set_config('app.bin_tenant', tid::text, true);
    end if;
  else
    tid := coalesce(tid, nullif(current_setting('app.bin_tenant', true), '')::uuid);
  end if;

  -- Who: the signed-in person, or the person the server says it acts for (as in the change history).
  claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  hdr := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  who := auth.uid();
  if who is null then
    if claims ->> 'role' = 'service_role' and coalesce(hdr ->> 'x-actor', '') <> '' then
      label := left(hdr ->> 'x-actor', 80);
      if label ~ '^user:[0-9a-f-]{36}$' then who := substr(label, 6)::uuid; label := 'user'; end if;
    else
      label := 'system';
    end if;
  end if;

  insert into public.recycle_bin (batch, tenant_id, schema_name, table_name, row_id, op, top, data, actor_id, actor)
  values (current_setting('app.bin_batch', true), tid, tg_table_schema, tg_table_name, o ->> 'id', 'delete', is_top, o, who, label);
  return old;
end $$;
revoke all on function public.recycle_bin_capture() from public, anon, authenticated;

-- The records a person deletes (each shows in the bin). Anything else is kept only when it
-- goes with one of these.
create or replace function public.recycle_bin_top_tables() returns text[] language sql immutable as $$
  select array[
    'public.students','public.guardians','public.staff','public.class_groups','public.subjects','public.departments','public.school_sections',
    'public.academic_sessions','public.terms','public.exams','public.exam_series','public.exam_papers','public.exam_halls','public.question_bank',
    'public.homework','public.lessons','public.lesson_notes','public.schemes_of_work','public.learning_paths','public.learning_groups','public.online_lessons',
    'public.content_packages','public.lti_tools','public.lti_links','public.forums','public.forum_threads','public.notices','public.news_posts',
    'public.school_events','public.message_templates','public.surveys','public.tickets','public.class_story_posts','public.school_documents',
    'public.student_documents','public.staff_documents','public.student_achievements','public.staff_achievements','public.portfolio_items',
    'public.staff_qualifications','public.job_postings','public.job_applications','public.applications','public.admission_leads','public.admission_events',
    'public.admission_sequences','public.entrance_plans','public.alumni','public.crm_partners','public.crm_campaigns','public.family_segments',
    'public.fee_items','public.fee_invoices','public.fee_awards','public.fee_discount_rules','public.installment_plans','public.expenses','public.budgets',
    'public.ledger_accounts','public.journal_entries','public.payroll_runs','public.pay_grades','public.appraisals','public.cpd_activities','public.staff_shifts',
    'public.staff_checklists','public.hr_checklist_templates','public.staff_absences','public.leave_requests','public.library_books','public.inventory_items',
    'public.assets','public.suppliers','public.purchase_orders','public.requisitions','public.rooms','public.timetable_periods','public.transport_routes',
    'public.vehicles','public.drivers','public.hostels','public.hostel_rooms','public.houses','public.behaviour_incidents','public.detention_sessions',
    'public.ieps','public.iep_targets','public.elections','public.election_posts','public.election_candidates','public.competitions','public.cc_groups',
    'public.badges','public.trait_definitions','public.early_years_areas','public.early_years_items','public.grading_schemes','public.comment_bank',
    'public.curriculum_objectives','public.reenrolment_rounds','public.result_pin_batches','public.saved_reports','public.reports','public.signature_requests',
    'public.statutory_returns','public.pt_conferences','public.fundraising_campaigns','public.shop_items','public.consent_purposes','public.immunisations',
    'public.attendance_devices','public.visitors','public.qa_checklists','public.rubrics',
    'live.lessons','live.lesson_media','live.media_folders','live.rubrics','live.assignments','live.student_groups','live.scenes'
  ]::text[]
$$;

-- Never kept: logs, telemetry, sign-in and device state, secrets, platform tables, the bin itself.
create or replace function public.recycle_bin_skip_tables() returns text[] language sql immutable as $$
  select array[
    'public.recycle_bin','public.data_changes','public.audit_logs','public.platform_audit_logs','public.message_outbox','public.browser_events',
    'public.environment_events','public.screen_snapshots','public.student_presence','public.raise_hands','public.rtc_rooms','public.rtc_peers',
    'public.rtc_signals','public.transport_live','public.push_subscriptions','public.doc_counters','public.lead_sequence_runs','public.access_grants',
    'public.phone_login_codes','public.device_enrollments','public.devices','public.teacher_commands','public.tenants','public.users','public.perf_samples',
    'public.result_pin_tries','public.cron_locks','public.demo_request_tries','public.auth_mail_log','public.api_keys','public.integration_secrets',
    'public.admission_secrets','public.oauth_connections','public.canva_connections','public.lti_platform_keys','public.sensitive_access_log','public.ai_usage',
    'public.notifications','public.webhook_deliveries','public.webhook_endpoints','public.kpi_snapshots','public.platform_support_sessions',
    'public.platform_admins','public.plans','public.platform_settings','public.entrance_lookups','public.staff_devices','public.signup_requests',
    'public.tenant_module_overrides','public.subscriptions','public.feature_flags','public.weekly_report_runs','public.tenant_groups','public.group_admins',
    'public.sales_leads','public.sales_activities','public.sales_quotes','public.whatsapp_unmatched','public.open_books',
    'live.audit_logs','live.browser_events','live.browser_sessions','live.environment_events','live.error_events','live.screen_snapshots','live.rtc_rooms',
    'live.rtc_peers','live.rtc_signals','live.raise_hands','live.teacher_commands','live.device_enrollments','live.device_pairing_codes','live.devices',
    'live.rate_buckets','live.platform_admins','live.platform_audit','live.platform_config','live.platform_stats','live.notifications','live.users',
    'live.tenants','live.schools','live.feature_flags','live.seb_passes','live.invites','live.subscriptions','live.invoices','live.plans','live.roles',
    'live.support_accounts','live.monitoring_consents','live.consents','live.off_task_feedback','live.off_task_mutes','live.spotlights','live.domain_categories',
    'live.library_lessons','live.tenant_settings'
  ]::text[]
$$;

-- Every table in public and live gets the bin's triggers, except the ones above. Re-run safely.
-- A table added by a later update gets them by repeating this block at the end of that update.
do $$
declare
  r record;
  tops text[] := public.recycle_bin_top_tables();
  skip text[] := public.recycle_bin_skip_tables();
begin
  for r in
    select n.nspname s, c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r','p') and n.nspname in ('public','live') and not c.relispartition
  loop
    execute format('drop trigger if exists aaa_recycle_bin on %I.%I', r.s, r.t);
    execute format('drop trigger if exists aaa_recycle_bin_unlink on %I.%I', r.s, r.t);
    continue when (r.s || '.' || r.t) = any(skip);
    execute format('create trigger aaa_recycle_bin before delete on %I.%I for each row execute function public.recycle_bin_capture(%L)',
      r.s, r.t, case when (r.s || '.' || r.t) = any(tops) then 'top' else 'child' end);
    -- Only updates made inside a trigger (a cascade) can be the clearing of a link.
    execute format('create trigger aaa_recycle_bin_unlink before update on %I.%I for each row when (pg_trigger_depth() > 0) execute function public.recycle_bin_capture(%L)',
      r.s, r.t, 'child');
  end loop;
end $$;

-- A short name for a kept row, for the bin's list.
create or replace function public.recycle_bin_label(d jsonb) returns text language sql immutable as $$
  select left(coalesce(
    nullif(trim(concat_ws(' ', d ->> 'first_name', d ->> 'last_name')), ''),
    nullif(d ->> 'full_name', ''), nullif(d ->> 'title', ''), nullif(d ->> 'name', ''), nullif(d ->> 'subject', ''),
    nullif(d ->> 'invoice_no', ''), nullif(d ->> 'reference', ''), nullif(d ->> 'label', ''), nullif(d ->> 'admission_no', ''),
    nullif(d ->> 'code', ''), nullif(d ->> 'email', ''), nullif(d ->> 'description', ''), nullif(d ->> 'body', ''), 'Untitled'), 120)
$$;

-- The school's deletions, newest first.
create or replace function public.recycle_bin_list(p_tenant uuid, p_limit int default 300)
returns table (batch text, deleted_at timestamptz, actor_id uuid, actor text, items jsonb, linked int, unlinked int)
language sql stable security definer set search_path = public as $$
  with tops as (
    select b.batch, min(b.deleted_at) deleted_at, (array_agg(b.actor_id order by b.id))[1] actor_id, (array_agg(b.actor order by b.id))[1] actor,
      jsonb_agg(jsonb_build_object('schema', b.schema_name, 'table', b.table_name, 'id', b.row_id, 'label', public.recycle_bin_label(b.data)) order by b.id) items
    from public.recycle_bin b where b.tenant_id = p_tenant and b.top
    group by b.batch order by 2 desc limit greatest(1, least(p_limit, 1000))
  )
  select t.batch, t.deleted_at, t.actor_id, t.actor, t.items,
    (select count(*)::int from public.recycle_bin c where c.batch = t.batch and not c.top and c.op = 'delete'),
    (select count(*)::int from public.recycle_bin c where c.batch = t.batch and c.op = 'unlink')
  from tops t order by t.deleted_at desc
$$;

-- Puts a deletion back: every row, then the links that were cleared. All or nothing for what
-- the person deleted; a linked row that cannot come back (what it belonged to is gone for good,
-- or the same thing has been added again since) is left out and counted.
create or replace function public.recycle_bin_restore(p_tenant uuid, p_batch text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  pending bigint[];
  still bigint[];
  progress boolean;
  rel regclass;
  cols text;
  ovr boolean;
  n int;
  k text;
  restored int := 0;
  relinked int := 0;
  skipped int := 0;
  why text;
begin
  if not exists (select 1 from public.recycle_bin where batch = p_batch and tenant_id = p_tenant and top) then
    raise exception 'That is no longer in the recycle bin.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.recycle_bin where batch = p_batch and tenant_id is not null and tenant_id <> p_tenant) then
    raise exception 'That is no longer in the recycle bin.' using errcode = 'P0002';
  end if;
  perform set_config('app.bin_restoring', 'on', true);

  select coalesce(array_agg(id order by id), '{}') into pending from public.recycle_bin where batch = p_batch and op = 'delete';
  -- Parents were kept before their children, but a later pass picks up anything that needed
  -- a row further down the list.
  loop
    progress := false;
    still := '{}';
    for r in select * from public.recycle_bin where id = any(pending) order by id loop
      rel := to_regclass(format('%I.%I', r.schema_name, r.table_name));
      if rel is null then
        if r.top then raise exception 'Cannot restore "%": that part of the system has been removed.', public.recycle_bin_label(r.data); end if;
        skipped := skipped + 1; continue;
      end if;
      select string_agg(quote_ident(a.attname), ',' order by a.attnum), coalesce(bool_or(a.attidentity = 'a'), false)
        into cols, ovr
        from pg_attribute a
       where a.attrelid = rel and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and r.data ? a.attname;
      if cols is null then skipped := skipped + 1; continue; end if;
      begin
        execute format('insert into %s (%s) %s select %s from jsonb_populate_record(null::%s, $1) %s',
          rel, cols, case when ovr then 'overriding system value' else '' end, cols, rel, case when r.top then '' else 'on conflict do nothing' end)
          using r.data;
        get diagnostics n = row_count;
        if n > 0 then restored := restored + 1; else skipped := skipped + 1; end if;
        progress := true;
      exception
        when foreign_key_violation then
          still := still || r.id;
          why := sqlerrm;
        when unique_violation then
          if r.top then
            raise exception 'Cannot restore "%": something with the same details has been added since. Rename or remove it, then try again.', public.recycle_bin_label(r.data);
          end if;
          skipped := skipped + 1;
        when others then
          if r.top then raise exception 'Cannot restore "%": %', public.recycle_bin_label(r.data), sqlerrm; end if;
          skipped := skipped + 1;
      end;
    end loop;
    pending := still;
    exit when cardinality(pending) = 0 or not progress;
  end loop;
  for r in select * from public.recycle_bin where id = any(pending) and top loop
    raise exception 'Cannot restore "%": it belonged to something that has since been deleted for good.', public.recycle_bin_label(r.data);
  end loop;
  skipped := skipped + cardinality(pending);

  -- Links cleared by the deletion, where nothing else has been set since.
  for r in select * from public.recycle_bin where batch = p_batch and op = 'unlink' and row_id is not null order by id loop
    rel := to_regclass(format('%I.%I', r.schema_name, r.table_name));
    continue when rel is null;
    for k in select jsonb_object_keys(r.data) loop
      continue when not exists (select 1 from pg_attribute a where a.attrelid = rel and a.attname = k and not a.attisdropped and a.attgenerated = '');
      begin
        execute format('update %s t set %I = (jsonb_populate_record(null::%s, $1)).%I where t.id::text = $2 and t.%I is null', rel, k, rel, k, k)
          using r.data, r.row_id;
        get diagnostics n = row_count;
        relinked := relinked + n;
      exception when others then null;
      end;
    end loop;
  end loop;

  delete from public.recycle_bin where batch = p_batch;
  perform set_config('app.bin_restoring', '', true);
  return jsonb_build_object('restored', restored, 'relinked', relinked, 'skipped', skipped);
end $$;

revoke all on function public.recycle_bin_list(uuid, int) from public, anon, authenticated;
revoke all on function public.recycle_bin_restore(uuid, text) from public, anon, authenticated;
revoke all on function public.recycle_bin_label(jsonb) from public, anon, authenticated;
grant execute on function public.recycle_bin_list(uuid, int), public.recycle_bin_restore(uuid, text), public.recycle_bin_label(jsonb) to service_role;

-- A student put back from the bin was not admitted again: no second "admitted" entry.
create or replace function public.student_admitted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.bin_restoring', true), '') = 'on' then return new; end if;
  insert into public.student_movements (tenant_id, student_id, kind, effective_on, to_class, school, recorded_by)
  values (new.tenant_id, new.id, 'admitted', coalesce(new.admitted_on, current_date),
          (select name from public.class_groups where id = new.class_group_id), new.previous_school, auth.uid());
  return new;
end $$;
