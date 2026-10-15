import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { sessionIdentity } from "@/lib/auth";
import { tenantForEnquiry } from "@/lib/admissions";
import { localParts } from "@/lib/attendance";
import { readUpload } from "@/lib/files";
import { appUrl } from "@/lib/school";
import { emailPerson, leaveDeciders, tellStaff } from "@/lib/hr-server";

export const dynamic = "force-dynamic";

const CV = { "application/pdf": "pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx" };
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function load(slug: string, token: string) {
  if (!/^[0-9a-f]{18}$/.test(token)) return null;
  const svc = createServiceClient();
  const t = await tenantForEnquiry(svc, slug);
  if (!t) return null;
  const { data: p } = await svc.from("job_postings").select("id,tenant_id,title,department,employment_type,location,description,requirements,salary_range,closes_on,status,internal_only,published_at")
    .eq("tenant_id", t.tenant.id).eq("token", token).maybeSingle();
  if (!p || p.status === "draft") return null;
  const { data: tz } = await svc.from("tenants").select("timezone").eq("id", t.tenant.id).maybeSingle();
  const today = localParts(new Date(), tz?.timezone ?? "Africa/Lagos").date;
  const open = p.status === "open" && (!p.closes_on || p.closes_on >= today);
  // Internal posts are for this school's own staff, signed in.
  let staffId: string | null = null;
  if (p.internal_only) {
    const who = await sessionIdentity();
    if (!who || who.tenantId !== t.tenant.id) return { svc, t, p, open: false, internalBlocked: true as const, staffId };
    const { data: s } = await svc.from("staff").select("id").eq("tenant_id", t.tenant.id).eq("user_id", who.userId).maybeSingle();
    if (!s) return { svc, t, p, open: false, internalBlocked: true as const, staffId };
    staffId = s.id;
  }
  return { svc, t, p, open, internalBlocked: false as const, staffId };
}

export async function GET(_req: NextRequest, props: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await props.params;
  const r = await load(slug, token);
  if (!r) return NextResponse.json({ error: "This job is not available." }, { status: 404 });
  if (r.internalBlocked) return NextResponse.json({ error: "This post is open to the school's own staff. Sign in to the school's portal first, then open the link again." }, { status: 403 });
  const s: any = r.t.settings;
  const { id: _id, tenant_id: _t, ...job } = r.p;
  return NextResponse.json({ school: { name: s.school_name ?? r.t.tenant.name, logo_url: s.logo_url ?? null, brand_color: s.brand_color ?? null }, job, open: r.open });
}

/** Apply: name, email, phone, cover letter, CV (PDF or Word), consent. */
export async function POST(req: NextRequest, props: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await props.params;
  const r = await load(slug, token);
  if (!r || r.internalBlocked) return NextResponse.json({ error: "This job is not available." }, { status: 404 });
  if (!r.open) return NextResponse.json({ error: "Applications for this job have closed." }, { status: 410 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid form" }, { status: 400 });
  if (String(form.get("website") ?? "")) return NextResponse.json({ ok: true }, { status: 201 });   // honeypot: quietly ignore bots
  const fullName = String(form.get("full_name") ?? "").trim().slice(0, 120), email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 160);
  const phone = String(form.get("phone") ?? "").trim().slice(0, 30), cover = String(form.get("cover_letter") ?? "").trim().slice(0, 6000);
  if (fullName.length < 2 || !EMAIL.test(email) || phone.length < 7) return NextResponse.json({ error: "enter your full name, email address and phone number" }, { status: 400 });
  if (form.get("consent") !== "on" && form.get("consent") !== "true") return NextResponse.json({ error: "please agree to the school keeping your application" }, { status: 400 });
  const { svc, t, p } = r;
  // Abuse guard: at most 5 applications from one email address to this school a day.
  const { count } = await svc.from("job_applications").select("id", { count: "exact", head: true }).eq("tenant_id", t.tenant.id).eq("email", email)
    .gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
  if ((count ?? 0) >= 5) return NextResponse.json({ error: "too many applications from this email today" }, { status: 429 });
  const file = form.get("cv");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "attach your CV (PDF or Word)" }, { status: 400 });
  const up = await readUpload(file, CV, 5);
  if (!up.ok) return NextResponse.json({ error: up.error }, { status: up.status });
  const path = `${t.tenant.id}/${p.id}/${randomUUID()}.${up.ext}`;
  const stored = await svc.storage.from("job-applications").upload(path, up.buf, { contentType: up.type, upsert: false });
  if (stored.error) return NextResponse.json({ error: "could not store your CV; try again" }, { status: 500 });
  const { data: app, error } = await svc.from("job_applications").insert({ tenant_id: t.tenant.id, posting_id: p.id, full_name: fullName, email, phone, cover_letter: cover || null,
    cv_path: path, source: String(form.get("source") ?? "").trim().slice(0, 40) || (r.staffId ? "internal" : "careers page"), internal_staff_id: r.staffId }).select("id,track_token").single();
  if (error) {
    await svc.storage.from("job-applications").remove([path]);
    return NextResponse.json({ error: error.message.includes("duplicate") ? "you have already applied for this job" : "could not save your application" }, { status: 400 });
  }
  const base = appUrl(req), s: any = t.settings, school = s.school_name ?? t.tenant.name;
  await emailPerson(svc, t.tenant.id, { email, name: fullName, subject: `Application received: ${p.title}`, kind: "recruitment", refId: app.id,
    lines: [`Thank you for applying for ${p.title} at ${school}. We have received your application and will be in touch if you are shortlisted.`],
    link: `${base}/careers/track/${app.track_token}`, linkLabel: "See your application" });
  await tellStaff(svc, t.tenant.id, await leaveDeciders(svc, t.tenant.id), "recruitment_new", `New application: ${p.title}`,
    `${fullName} applied for ${p.title}.`, `${base}/school/hr?tab=recruitment&posting=${p.id}`, app.id);
  return NextResponse.json({ ok: true, track: `/careers/track/${app.track_token}` }, { status: 201 });
}
