/**
 * Applies an import (or tries it without saving) and builds exports in the
 * same columns, so a file can go out, be edited, and come back in. Writes use
 * the caller's own client, so row-level security and the change history apply.
 */
import { fetchAll } from "./results";
import { studentName } from "./school";
import { createInvoice } from "./fees";
import { provisionUser } from "./provision";
import { STAFF_ROLE_OPTIONS } from "./auth";
import { entity, readRow, type RowResult } from "./importers";
import type { Table } from "./spreadsheet";

export type ImportOptions = { dryRun: boolean; createLogins?: boolean; baseUrl: string; userId: string; svc: any };
export type ImportResult = { rows: number; created: number; updated: number; skipped: number; invited: number; errors: { row: number; error: string }[] };

const lc = (s: unknown) => String(s ?? "").trim().toLowerCase();
const digits = (p: unknown) => String(p ?? "").replace(/\D/g, "").replace(/^(234|0)/, "");

/** Reads every row of a table through the column mapping. */
export function readTable(entityKey: string, table: Table, map: Record<string, number>): RowResult[] {
  const e = entity(entityKey);
  if (!e) throw new Error("unknown import type");
  return table.rows.map((cells, i) => readRow(e, map, cells, i + 2));
}

export async function runImport(sb: any, tid: string, entityKey: string, rows: RowResult[], o: ImportOptions): Promise<ImportResult> {
  const r: ImportResult = { rows: rows.length, created: 0, updated: 0, skipped: 0, invited: 0, errors: [] };
  const fail = (row: number, error: string) => { r.errors.push({ row, error }); r.skipped++; };
  const good = rows.filter(x => { if (x.errors.length) { fail(x.row, x.errors.join("; ")); return false; } return true; });
  // The same key twice in one file is almost always a mistake: only the first is used.
  const e = entity(entityKey)!;
  const seen = new Set<string>();
  const unique = entityKey === "guardians" || entityKey === "class_subjects" || entityKey === "balances" ? good : good.filter(x => {
    const k = lc(x.values[e.matchOn]);
    if (!k) return true;
    if (seen.has(k)) { fail(x.row, `${e.fields.find(f => f.key === e.matchOn)?.label} "${x.values[e.matchOn]}" appears earlier in the file`); return false; }
    seen.add(k);
    return true;
  });
  const write = async (q: Promise<{ error: any; data?: any }>, row: number) => {
    if (o.dryRun) return { ok: true, data: null };
    const { error, data } = await q;
    if (error) { fail(row, error.message.includes("duplicate") ? "already exists" : error.message); return { ok: false, data: null }; }
    return { ok: true, data };
  };

  // Shared lookups.
  const classes = async () => new Map<string, string>((await fetchAll<any>(() => sb.from("class_groups").select("id,name").eq("tenant_id", tid).order("id"))).map(c => [lc(c.name), c.id]));
  const studentsByAdm = async () => new Map<string, string>((await fetchAll<any>(() => sb.from("students").select("id,admission_no").eq("tenant_id", tid).order("id"))).map(s => [lc(s.admission_no), s.id]));
  const staffByEmail = async () => new Map<string, string>((await fetchAll<any>(() => sb.from("users").select("id,email").eq("tenant_id", tid).not("role", "in", "(student,parent,alumni)").order("id"))).map(u => [lc(u.email), u.id]));
  const guardianIndex = async () => {
    const gs = await fetchAll<any>(() => sb.from("guardians").select("id,phone,email").eq("tenant_id", tid).order("id"));
    const byPhone = new Map<string, string>(), byEmail = new Map<string, string>();
    for (const g of gs) { if (digits(g.phone)) byPhone.set(digits(g.phone), g.id); if (g.email) byEmail.set(lc(g.email), g.id); }
    return { byPhone, byEmail };
  };
  /** Finds a parent by phone or email, creating one when new. */
  const guardianFor = async (gi: Awaited<ReturnType<typeof guardianIndex>>, v: { name: string; phone: string | null; email: string | null; whatsapp?: string | null }, row: number) => {
    const found = (v.phone && gi.byPhone.get(digits(v.phone))) || (v.email && gi.byEmail.get(lc(v.email)));
    if (found) return { id: found, created: false };
    if (o.dryRun) return { id: `new:${row}`, created: true };
    const { data, error } = await sb.from("guardians").insert({ tenant_id: tid, full_name: v.name, phone: v.phone, email: v.email, whatsapp_phone: v.whatsapp ?? null }).select("id").single();
    if (error) { fail(row, `parent: ${error.message}`); return null; }
    if (v.phone) gi.byPhone.set(digits(v.phone), data.id);
    if (v.email) gi.byEmail.set(lc(v.email), data.id);
    return { id: data.id as string, created: true };
  };

  switch (entityKey) {
    case "students": {
      const [cls, adm, gi] = await Promise.all([classes(), studentsByAdm(), guardianIndex()]);
      for (const x of unique) {
        const v = x.values;
        let classId: string | null = null;
        if (v.class) {
          classId = cls.get(lc(v.class)) ?? null;
          if (!classId && !o.dryRun) {
            const { data, error } = await sb.from("class_groups").insert({ tenant_id: tid, name: v.class }).select("id").single();
            if (error) { fail(x.row, `class: ${error.message}`); continue; }
            classId = data.id; cls.set(lc(v.class), data.id);
          }
        }
        const row = { admission_no: v.admission_no, first_name: v.first_name, last_name: v.last_name, other_names: v.other_names, gender: v.gender,
          date_of_birth: v.date_of_birth, address: v.address, ...(v.class ? { class_group_id: classId } : {}) };
        const existing = adm.get(lc(v.admission_no));
        const w = existing
          ? await write(sb.from("students").update(row).eq("tenant_id", tid).eq("id", existing).select("id").single(), x.row)
          : await write(sb.from("students").insert({ ...row, tenant_id: tid }).select("id").single(), x.row);
        if (!w.ok) continue;
        if (existing) r.updated++; else r.created++;
        const studentId = existing ?? w.data?.id;
        if (v.guardian_name && (v.guardian_phone || v.guardian_email)) {
          const g = await guardianFor(gi, { name: String(v.guardian_name), phone: v.guardian_phone as string | null, email: v.guardian_email as string | null }, x.row);
          if (g && studentId && !o.dryRun) await sb.from("student_guardians").upsert({ tenant_id: tid, student_id: studentId, guardian_id: g.id, relation: v.guardian_relation || "parent", is_primary: true }, { onConflict: "student_id,guardian_id" });
        }
      }
      break;
    }
    case "guardians": {
      const [adm, gi] = await Promise.all([studentsByAdm(), guardianIndex()]);
      for (const x of unique) {
        const v = x.values;
        const studentId = adm.get(lc(v.admission_no));
        if (!studentId) { fail(x.row, `no student with admission number "${v.admission_no}"`); continue; }
        if (!v.phone && !v.email) { fail(x.row, "add a phone or email so the parent can be reached"); continue; }
        const g = await guardianFor(gi, { name: String(v.full_name), phone: v.phone as string | null, email: v.email as string | null, whatsapp: v.whatsapp_phone as string | null }, x.row);
        if (!g) continue;
        if (g.created) r.created++; else r.updated++;
        if (!o.dryRun) {
          if (!g.created) await sb.from("guardians").update({ full_name: v.full_name, ...(v.whatsapp_phone ? { whatsapp_phone: v.whatsapp_phone } : {}) }).eq("tenant_id", tid).eq("id", g.id);
          await sb.from("student_guardians").upsert({ tenant_id: tid, student_id: studentId, guardian_id: g.id, relation: v.relation || "parent", is_primary: v.is_primary === true }, { onConflict: "student_id,guardian_id" });
        }
      }
      break;
    }
    case "staff": {
      const existing = new Map<string, any>((await fetchAll<any>(() => sb.from("staff").select("id,staff_no,user_id").eq("tenant_id", tid).order("id"))).map(s => [lc(s.staff_no), s]));
      const roles = new Set<string>(STAFF_ROLE_OPTIONS);
      for (const x of unique) {
        const v = x.values;
        const type = lc(v.employment_type).replace(/[\s-]+/g, "_");
        if (v.role && !roles.has(lc(v.role).replace(/\s+/g, "_"))) { fail(x.row, `role "${v.role}" is not one of: ${[...roles].join(", ")}`); continue; }
        const row = { staff_no: v.staff_no, full_name: v.full_name, email: v.email, phone: v.phone, department: v.department, position: v.position, hire_date: v.hire_date,
          ...(["full_time", "part_time", "contract", "volunteer"].includes(type) ? { employment_type: type } : {}) };
        const had = existing.get(lc(v.staff_no));
        const w = had
          ? await write(sb.from("staff").update(row).eq("tenant_id", tid).eq("id", had.id).select("id").single(), x.row)
          : await write(sb.from("staff").insert({ ...row, tenant_id: tid }).select("id").single(), x.row);
        if (!w.ok) continue;
        if (had) r.updated++; else r.created++;
        if (o.createLogins && v.role && v.email && !had?.user_id && r.invited < 100) {
          if (o.dryRun) { r.invited++; continue; }
          try {
            const { userId } = await provisionUser(o.svc, { tenantId: tid, email: String(v.email), fullName: String(v.full_name), role: lc(v.role).replace(/\s+/g, "_"),
              redirectTo: `${o.baseUrl}/auth/welcome?next=/dashboard`, createdBy: o.userId });
            await sb.from("staff").update({ user_id: userId }).eq("tenant_id", tid).eq("id", had?.id ?? w.data.id);
            r.invited++;
          } catch (err) { r.errors.push({ row: x.row, error: `saved, but the login was not created: ${(err as Error).message}` }); }
        }
      }
      break;
    }
    case "classes": {
      const [cls, staff, { data: sections }] = await Promise.all([classes(), staffByEmail(), sb.from("school_sections").select("id,name").eq("tenant_id", tid)]);
      const sec = new Map<string, string>((sections ?? []).map((s: any) => [lc(s.name), s.id]));
      for (const x of unique) {
        const v = x.values;
        let sectionId: string | null | undefined;
        if (v.section) {
          sectionId = sec.get(lc(v.section));
          if (!sectionId && !o.dryRun) {
            const { data, error } = await sb.from("school_sections").insert({ tenant_id: tid, name: v.section }).select("id").single();
            if (error) { fail(x.row, `section: ${error.message}`); continue; }
            sectionId = data.id; sec.set(lc(v.section), data.id);
          }
        }
        let teacher: string | undefined;
        if (v.form_teacher_email) { teacher = staff.get(lc(v.form_teacher_email)); if (!teacher) { fail(x.row, `no staff account with email ${v.form_teacher_email}`); continue; } }
        const row = { name: v.name, ...(v.level ? { level: v.level } : {}), ...(sectionId ? { section_id: sectionId } : {}), ...(teacher ? { form_teacher_id: teacher } : {}) };
        const had = cls.get(lc(v.name));
        const w = had ? await write(sb.from("class_groups").update(row).eq("tenant_id", tid).eq("id", had).select("id").single(), x.row)
          : await write(sb.from("class_groups").insert({ ...row, tenant_id: tid }).select("id").single(), x.row);
        if (!w.ok) continue;
        if (had) r.updated++; else { r.created++; if (w.data) cls.set(lc(v.name), w.data.id); }
      }
      break;
    }
    case "subjects": {
      const [subs, { data: depts }] = await Promise.all([
        fetchAll<any>(() => sb.from("subjects").select("id,name").eq("tenant_id", tid).order("id")),
        sb.from("departments").select("id,name").eq("tenant_id", tid)
      ]);
      const byName = new Map<string, string>(subs.map(s => [lc(s.name), s.id]));
      const dep = new Map<string, string>((depts ?? []).map((d: any) => [lc(d.name), d.id]));
      for (const x of unique) {
        const v = x.values;
        let depId: string | undefined;
        if (v.department) {
          depId = dep.get(lc(v.department));
          if (!depId && !o.dryRun) {
            const { data, error } = await sb.from("departments").insert({ tenant_id: tid, name: v.department }).select("id").single();
            if (error) { fail(x.row, `department: ${error.message}`); continue; }
            depId = data.id; dep.set(lc(v.department), data.id);
          }
        }
        const row = { name: v.name, ...(v.code ? { code: v.code } : {}), ...(depId ? { department_id: depId } : {}) };
        const had = byName.get(lc(v.name));
        const w = had ? await write(sb.from("subjects").update(row).eq("tenant_id", tid).eq("id", had).select("id").single(), x.row)
          : await write(sb.from("subjects").insert({ ...row, tenant_id: tid }).select("id").single(), x.row);
        if (!w.ok) continue;
        if (had) r.updated++; else r.created++;
      }
      break;
    }
    case "class_subjects": {
      const [cls, staff, subs, offers] = await Promise.all([
        classes(), staffByEmail(),
        fetchAll<any>(() => sb.from("subjects").select("id,name").eq("tenant_id", tid).order("id")),
        fetchAll<any>(() => sb.from("subject_offerings").select("class_group_id,subject_id").eq("tenant_id", tid).order("id"))
      ]);
      const subject = new Map<string, string>(subs.map(s => [lc(s.name), s.id]));
      const have = new Set(offers.map(x => `${x.class_group_id}:${x.subject_id}`));
      for (const x of unique) {
        const v = x.values;
        const c = cls.get(lc(v.class)), s = subject.get(lc(v.subject));
        if (!c) { fail(x.row, `no class called "${v.class}"`); continue; }
        if (!s) { fail(x.row, `no subject called "${v.subject}" (import subjects first)`); continue; }
        let teacher: string | null = null;
        if (v.teacher_email) { teacher = staff.get(lc(v.teacher_email)) ?? null; if (!teacher) { fail(x.row, `no staff account with email ${v.teacher_email}`); continue; } }
        const w = await write(sb.from("subject_offerings").upsert({ tenant_id: tid, class_group_id: c, subject_id: s, ...(teacher ? { teacher_id: teacher } : {}) }, { onConflict: "class_group_id,subject_id" }).select("id").single(), x.row);
        if (!w.ok) continue;
        if (have.has(`${c}:${s}`)) r.updated++; else { r.created++; have.add(`${c}:${s}`); }
      }
      break;
    }
    case "balances": {
      const adm = await studentsByAdm();
      const invoices = await fetchAll<any>(() => sb.from("fee_invoices").select("student_id,title,total").eq("tenant_id", tid).neq("status", "void").order("id"));
      const dup = new Set(invoices.map(i => `${i.student_id}:${lc(i.title)}:${Number(i.total)}`));
      for (const x of unique) {
        const v = x.values;
        const studentId = adm.get(lc(v.admission_no));
        if (!studentId) { fail(x.row, `no student with admission number "${v.admission_no}"`); continue; }
        const amount = Number(v.amount);
        if (!(amount > 0)) { r.skipped++; continue; }            // nothing owed
        const title = String(v.title || "Balance brought forward");
        const key = `${studentId}:${lc(title)}:${amount}`;
        // Running the same file twice must not bill a family twice.
        if (dup.has(key)) { fail(x.row, "this balance has already been imported"); continue; }
        dup.add(key);
        if (!o.dryRun) {
          try { await createInvoice(o.svc, { tenantId: tid, studentId, title, lines: [{ description: title, amount }], createdBy: o.userId, dueDate: (v.due_date as string | null) ?? null }); }
          catch (err) { fail(x.row, (err as Error).message); continue; }
        }
        r.created++;
      }
      break;
    }
    case "alumni": {
      const al = await fetchAll<any>(() => sb.from("alumni").select("id,email").eq("tenant_id", tid).not("email", "is", null).order("id"));
      const byEmail = new Map<string, string>(al.map(a => [lc(a.email), a.id]));
      for (const x of unique) {
        const v = x.values;
        const row = { full_name: v.full_name, graduation_year: v.graduation_year, email: v.email, phone: v.phone, occupation: v.occupation, employer: v.employer, city: v.city, country: v.country };
        const had = v.email ? byEmail.get(lc(v.email)) : undefined;
        const w = had ? await write(sb.from("alumni").update({ ...row, updated_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", had).select("id").single(), x.row)
          : await write(sb.from("alumni").insert({ ...row, tenant_id: tid, source: "import", status: "active" }).select("id").single(), x.row);
        if (!w.ok) continue;
        if (had) r.updated++; else r.created++;
      }
      break;
    }
    case "partners": {
      const ps = await fetchAll<any>(() => sb.from("crm_partners").select("id,name").eq("tenant_id", tid).order("id"));
      const byName = new Map<string, string>(ps.map(p => [lc(p.name), p.id]));
      const kinds = ["vendor", "supplier", "partner", "sponsor", "ngo", "government", "media", "other"];
      for (const x of unique) {
        const v = x.values;
        const row = { name: v.name, kind: kinds.includes(lc(v.kind)) ? lc(v.kind) : "vendor", category: v.category, contact_name: v.contact_name, email: v.email, phone: v.phone };
        const had = byName.get(lc(v.name));
        const w = had ? await write(sb.from("crm_partners").update({ ...row, updated_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", had).select("id").single(), x.row)
          : await write(sb.from("crm_partners").insert({ ...row, tenant_id: tid, created_by: o.userId }).select("id").single(), x.row);
        if (!w.ok) continue;
        if (had) r.updated++; else r.created++;
      }
      break;
    }
    default: throw new Error("unknown import type");
  }
  r.errors.sort((a, b) => a.row - b.row);
  return r;
}

/** Everything of one kind as a table in the import columns (plus a few read-only extras at the end). */
export async function exportTable(sb: any, tid: string, entityKey: string): Promise<Table> {
  const e = entity(entityKey);
  if (!e) throw new Error("unknown export type");
  const headers = e.fields.map(f => f.key);
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  switch (entityKey) {
    case "students": {
      const st = await fetchAll<any>(() => sb.from("students").select("id,admission_no,first_name,last_name,other_names,gender,date_of_birth,address,status,class_groups(name)").eq("tenant_id", tid).order("admission_no"));
      const links = await fetchAll<any>(() => sb.from("student_guardians").select("student_id,relation,is_primary,guardians(full_name,phone,email)").eq("tenant_id", tid).order("student_id"));
      const main = new Map<string, any>();
      for (const l of links) if (!main.has(l.student_id) || l.is_primary) main.set(l.student_id, l);
      return { headers: [...headers, "status"], rows: st.map(x => { const g = main.get(x.id); return [x.admission_no, x.first_name, x.last_name, x.other_names, x.gender, x.date_of_birth, x.class_groups?.name, x.address,
        g?.guardians?.full_name, g?.guardians?.phone, g?.guardians?.email, g?.relation, x.status].map(s); }) };
    }
    case "guardians": {
      const links = await fetchAll<any>(() => sb.from("student_guardians").select("relation,is_primary,students(admission_no),guardians(full_name,phone,whatsapp_phone,email)").eq("tenant_id", tid).order("student_id"));
      return { headers, rows: links.filter(l => l.students && l.guardians).map(l => [l.students.admission_no, l.guardians.full_name, l.guardians.phone, l.guardians.whatsapp_phone, l.guardians.email, l.relation, l.is_primary ? "yes" : "no"].map(s)) };
    }
    case "staff": {
      const st = await fetchAll<any>(() => sb.from("staff").select("staff_no,full_name,email,phone,department,position,employment_type,hire_date,status,users(role)").eq("tenant_id", tid).order("staff_no"));
      return { headers: [...headers, "status"], rows: st.map(x => [x.staff_no, x.full_name, x.email, x.phone, x.department, x.position, x.employment_type, x.hire_date, x.users?.role, x.status].map(s)) };
    }
    case "classes": {
      const cl = await fetchAll<any>(() => sb.from("class_groups").select("name,level,school_sections(name),users:form_teacher_id(email)").eq("tenant_id", tid).order("name"));
      return { headers, rows: cl.map(x => [x.name, x.level, x.school_sections?.name, x.users?.email].map(s)) };
    }
    case "subjects": {
      const su = await fetchAll<any>(() => sb.from("subjects").select("name,code,departments(name)").eq("tenant_id", tid).order("name"));
      return { headers, rows: su.map(x => [x.name, x.code, x.departments?.name].map(s)) };
    }
    case "class_subjects": {
      const of = await fetchAll<any>(() => sb.from("subject_offerings").select("class_groups(name),subjects(name),users:teacher_id(email)").eq("tenant_id", tid).order("id"));
      return { headers, rows: of.filter(x => x.class_groups && x.subjects).map(x => [x.class_groups.name, x.subjects.name, x.users?.email].map(s)) };
    }
    case "balances": {
      const inv = await fetchAll<any>(() => sb.from("fee_invoices").select("invoice_no,title,total,amount_paid,due_date,status,students(admission_no,first_name,last_name,other_names)").eq("tenant_id", tid).in("status", ["issued", "part_paid"]).order("invoice_no"));
      return { headers: [...headers, "invoice_no", "student"], rows: inv.map(x => [x.students?.admission_no, (Number(x.total) - Number(x.amount_paid)).toFixed(2), x.title, x.due_date, x.invoice_no, studentName(x.students)].map(s)) };
    }
    case "alumni": {
      const al = await fetchAll<any>(() => sb.from("alumni").select("full_name,graduation_year,email,phone,occupation,employer,city,country").eq("tenant_id", tid).order("full_name"));
      return { headers, rows: al.map(x => headers.map(h => s(x[h]))) };
    }
    case "partners": {
      const ps = await fetchAll<any>(() => sb.from("crm_partners").select("name,kind,category,contact_name,email,phone").eq("tenant_id", tid).order("name"));
      return { headers, rows: ps.map(x => headers.map(h => s(x[h]))) };
    }
  }
  throw new Error("unknown export type");
}
