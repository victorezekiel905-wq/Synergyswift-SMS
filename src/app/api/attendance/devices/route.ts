import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { randomToken, sha256hex } from "@/lib/crypto";
import { appUrl, parseCsv } from "@/lib/school";

export const dynamic = "force-dynamic";
const ADMIN = ["school_admin", "principal", "platform_admin", "it_admin"];
const CARDS = [...ADMIN, "gate_officer"];

/** Clocking machines and the cards / user numbers that identify people on them. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(CARDS, "attendance");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const q = new URL(req.url).searchParams.get("q")?.trim();
  const [{ data: devices }, ids] = await Promise.all([
    ctx.sb.from("attendance_devices").select("id,name,kind,serial,location,mode,active,last_seen_at,last_error,created_at").eq("tenant_id", tid).order("name"),
    (async () => {
      let s = ctx.sb.from("attendance_identifiers").select("id,person_type,kind,value,created_at,students(first_name,last_name,admission_no),staff(full_name,staff_no)").eq("tenant_id", tid).order("created_at", { ascending: false }).limit(300);
      if (q) s = s.ilike("value", `%${q.replace(/[%_]/g, "")}%`);
      return (await s).data ?? [];
    })()
  ]);
  return NextResponse.json({ devices: devices ?? [], identifiers: ids, push_url: `${appUrl(req)}/iclock/cdata`, webhook_url: `${appUrl(req)}/api/attendance/device` });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_device"), name: z.string().trim().min(2).max(80), kind: z.enum(["zkteco", "webhook"]), serial: z.string().trim().regex(/^[A-Za-z0-9-]{4,40}$/).nullish(),
    location: z.string().trim().max(120).nullish(), mode: z.enum(["auto", "in", "out"]).default("auto") }),
  z.object({ action: z.literal("update_device"), id: z.string().uuid(), name: z.string().trim().min(2).max(80), location: z.string().trim().max(120).nullish(), mode: z.enum(["auto", "in", "out"]), active: z.boolean() }),
  z.object({ action: z.literal("new_key"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete_device"), id: z.string().uuid() }),
  z.object({ action: z.literal("add_identifier"), person: z.string().trim().min(1).max(60), kind: z.enum(["card", "device_pin"]), value: z.string().trim().min(1).max(64) }),
  z.object({ action: z.literal("import_identifiers"), csv: z.string().max(2_000_000) }),
  z.object({ action: z.literal("delete_identifier"), id: z.string().uuid() })
]);

/** Admission number or staff number to a person. */
async function findPerson(sb: any, tid: string, ref: string) {
  const { data: st } = await sb.from("students").select("id").eq("tenant_id", tid).eq("admission_no", ref).maybeSingle();
  if (st) return { person_type: "student", student_id: st.id, staff_id: null };
  const { data: sf } = await sb.from("staff").select("id").eq("tenant_id", tid).eq("staff_no", ref).maybeSingle();
  return sf ? { person_type: "staff", student_id: null, staff_id: sf.id } : null;
}

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(CARDS, "attendance");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id, sb = ctx.sb;
  const deviceAction = ["add_device", "update_device", "new_key", "delete_device"].includes(b.action);
  if (deviceAction && !ADMIN.some(r => ctx.roles.has(r))) return jsonError("only admins can manage clocking machines", 403);
  const dup = (m: string) => /duplicate|unique/.test(m);
  switch (b.action) {
    case "add_device": {
      if (b.kind === "zkteco" && !b.serial) return jsonError("enter the machine's serial number (Menu → System info → Device info)");
      const key = b.kind === "webhook" ? randomToken(24) : null;
      const { data, error } = await sb.from("attendance_devices").insert({ tenant_id: tid, name: b.name, kind: b.kind, serial: b.kind === "zkteco" ? b.serial!.toUpperCase() : null,
        secret: key ? sha256hex(key) : null, location: b.location ?? null, mode: b.mode, created_by: ctx.userId }).select("id").single();
      if (error) return jsonError(dup(error.message) ? "a machine with that serial number is already registered" : error.message);
      return NextResponse.json({ ok: true, id: data.id, key }, { status: 201 });
    }
    case "update_device": {
      const { error } = await sb.from("attendance_devices").update({ name: b.name, location: b.location ?? null, mode: b.mode, active: b.active }).eq("tenant_id", tid).eq("id", b.id);
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "new_key": {
      const key = randomToken(24);
      const { data, error } = await sb.from("attendance_devices").update({ secret: sha256hex(key) }).eq("tenant_id", tid).eq("id", b.id).eq("kind", "webhook").select("id").maybeSingle();
      return error || !data ? jsonError(error?.message ?? "not a webhook device") : NextResponse.json({ ok: true, key });
    }
    case "delete_device": {
      const { error } = await sb.from("attendance_devices").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "add_identifier": {
      const who = await findPerson(sb, tid, b.person);
      if (!who) return jsonError("no student or staff member has that admission or staff number");
      const { error } = await sb.from("attendance_identifiers").insert({ tenant_id: tid, kind: b.kind, value: b.value, ...who });
      return error ? jsonError(dup(error.message) ? "that card or user number already belongs to someone" : error.message) : NextResponse.json({ ok: true }, { status: 201 });
    }
    case "import_identifiers": {
      // Columns: number (admission or staff number), card and/or device_pin.
      const rows = parseCsv(b.csv).slice(0, 5000);
      let added = 0; const problems: string[] = [];
      for (const [i, r] of rows.entries()) {
        const ref = (r.number ?? r.admission_no ?? r.staff_no ?? "").trim();
        const who = ref ? await findPerson(sb, tid, ref) : null;
        if (!who) { problems.push(`row ${i + 2}: no one with number "${ref}"`); continue; }
        for (const kind of ["card", "device_pin"] as const) {
          const value = (r[kind] ?? "").trim();
          if (!value) continue;
          const { error } = await sb.from("attendance_identifiers").upsert({ tenant_id: tid, kind, value, ...who }, { onConflict: "tenant_id,kind,value" });
          if (error) problems.push(`row ${i + 2}: ${error.message}`); else added++;
        }
      }
      return NextResponse.json({ ok: true, added, problems: problems.slice(0, 50) });
    }
    case "delete_identifier": {
      const { error } = await sb.from("attendance_identifiers").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
  }
}
