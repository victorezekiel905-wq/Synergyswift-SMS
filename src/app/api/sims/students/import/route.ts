import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { parseCsv } from "@/lib/school";
import { StudentInput, GuardianInput, cleanStudent } from "@/lib/validators";

/**
 * CSV import. Columns (header names, any order):
 *   admission_no, first_name, last_name, other_names, gender, date_of_birth, class,
 *   guardian_name, guardian_email, guardian_phone, guardian_relation
 * Existing admission numbers are updated; new ones created. "class" matches a
 * class group by name and is created when missing.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.sims, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const { csv } = await readJson<{ csv?: string }>(req);
  if (!csv || csv.length > 2_000_000) return jsonError("csv text (max 2MB) required");
  const rows = parseCsv(csv);
  if (!rows.length) return jsonError("no rows found");
  if (rows.length > 3000) return jsonError("import at most 3000 rows at a time");
  const tid = ctx.tenant.id;
  const sb = ctx.sb;

  const { data: groups } = await sb.from("class_groups").select("id,name").eq("tenant_id", tid);
  const groupByName = new Map<string, string>((groups ?? []).map((g: any) => [g.name.toLowerCase(), g.id]));
  const result = { created: 0, updated: 0, guardians: 0, errors: [] as { row: number; error: string }[] };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      let classId: string | null = null;
      const cname = (r.class || r.class_group || "").trim();
      if (cname) {
        classId = groupByName.get(cname.toLowerCase()) ?? null;
        if (!classId) {
          const { data: g, error } = await sb.from("class_groups").insert({ tenant_id: tid, name: cname }).select("id").single();
          if (error) throw new Error(error.message);
          classId = g.id as string;
          groupByName.set(cname.toLowerCase(), g.id);
        }
      }
      const gender = (r.gender || "").toLowerCase();
      const parsed = StudentInput.safeParse({
        admission_no: r.admission_no, first_name: r.first_name, last_name: r.last_name,
        other_names: r.other_names || null,
        gender: gender.startsWith("m") ? "male" : gender.startsWith("f") ? "female" : gender ? "other" : null,
        date_of_birth: r.date_of_birth || null, class_group_id: classId
      });
      if (!parsed.success) throw new Error(parsed.error.issues.map(x => `${x.path.join(".")}: ${x.message}`).join("; "));

      const { data: existing } = await sb.from("students").select("id").eq("tenant_id", tid).eq("admission_no", parsed.data.admission_no).maybeSingle();
      let studentId: string;
      if (existing) {
        const { error } = await sb.from("students").update(cleanStudent(parsed.data)).eq("id", existing.id);
        if (error) throw new Error(error.message);
        studentId = existing.id; result.updated++;
      } else {
        const { data: s, error } = await sb.from("students").insert({ ...cleanStudent(parsed.data), tenant_id: tid }).select("id").single();
        if (error) throw new Error(error.message);
        studentId = s.id; result.created++;
      }

      if (r.guardian_name) {
        const g = GuardianInput.safeParse({ full_name: r.guardian_name, email: r.guardian_email || null, phone: r.guardian_phone || null, relation: r.guardian_relation || "parent", is_primary: true });
        if (!g.success) throw new Error("guardian: " + g.error.issues.map(x => x.message).join("; "));
        // Reuse a guardian with the same phone or email (siblings share parents).
        let gid: string | null = null;
        const match = [g.data.phone ? `phone.eq.${g.data.phone.replace(/[,()]/g, "")}` : "", g.data.email ? `email.eq.${g.data.email.replace(/[,()]/g, "")}` : ""].filter(Boolean).join(",");
        if (match) {
          const { data: found } = await sb.from("guardians").select("id").eq("tenant_id", tid).or(match).limit(1);
          gid = found?.[0]?.id ?? null;
        }
        if (!gid) {
          const { relation: _r, is_primary: _p, can_pickup: _c, ...gRow } = g.data;
          const { data: ng, error } = await sb.from("guardians").insert({ ...gRow, email: gRow.email || null, tenant_id: tid }).select("id").single();
          if (error) throw new Error(error.message);
          gid = ng.id; result.guardians++;
        }
        await sb.from("student_guardians").upsert({ tenant_id: tid, student_id: studentId, guardian_id: gid, relation: g.data.relation, is_primary: true, can_pickup: true },
          { onConflict: "student_id,guardian_id" });
      }
    } catch (e) {
      result.errors.push({ row: i + 2, error: (e as Error).message });
    }
  }
  await sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "students.imported", meta: { created: result.created, updated: result.updated, errors: result.errors.length } });
  return NextResponse.json(result);
}
