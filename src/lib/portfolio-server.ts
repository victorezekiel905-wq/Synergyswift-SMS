/**
 * Portfolios on the server (phase 14o): what a portfolio shows (to the family, or through a share link),
 * targets with progress, share links and photos. Every query filters on the school.
 */
import { readUpload } from "@/lib/files";
import { IMAGE_TYPES, targetProgress, shareState, type Target } from "@/lib/portfolio";

const BUCKET = "student-documents";

/** A photo for an achievement (jpg, png or webp, up to 8 MB). */
export async function savePhoto(svc: any, tenantId: string, folder: string, file: unknown): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const f = await readUpload(file, IMAGE_TYPES, 8);
  if (!f.ok) return { ok: false, error: f.error };
  const path = `${tenantId}/${folder}/achievement-${Date.now()}.${f.ext}`;
  const { error } = await svc.storage.from(BUCKET).upload(path, f.buf, { contentType: f.type });
  return error ? { ok: false, error: error.message } : { ok: true, path };
}

export async function photoUrl(svc: any, path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data } = await svc.storage.from(BUCKET).createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

/** A student's portfolio. `shared`: only what may leave the school (verified achievements, approved work shared with the family). */
export async function studentPortfolio(svc: any, tenantId: string, studentId: string, opts: { shared: boolean; achievementId?: string | null }) {
  let aq = svc.from("student_achievements").select("*").eq("tenant_id", tenantId).eq("student_id", studentId).order("achieved_on", { ascending: false });
  if (opts.shared) aq = aq.eq("shared_with_family", true).or("status.is.null,status.eq.verified");
  if (opts.achievementId) aq = aq.eq("id", opts.achievementId);
  const [{ data: achievements }, { data: work }, { data: certs }] = await Promise.all([
    aq,
    opts.achievementId ? { data: [] } : svc.from("portfolio_items").select("id,title,kind,description,link_url,path,content_type,created_at,subjects(name)").eq("tenant_id", tenantId).eq("student_id", studentId)
      .eq("status", "approved").eq("shared_with_family", true).order("created_at", { ascending: false }).limit(60),
    opts.achievementId ? { data: [] } : svc.from("certificates").select("id,title,kind,issued_on,verify_token").eq("tenant_id", tenantId).eq("student_id", studentId).eq("status", "issued").order("issued_on", { ascending: false })
  ]);
  return {
    achievements: await Promise.all((achievements ?? []).map(async (a: any) => ({ id: a.id, kind: a.kind, title: a.title, description: a.description, level: a.level, award: a.award,
      achieved_on: a.achieved_on, status: a.status ?? "verified", source: a.source ?? "staff", photo: await photoUrl(svc, a.photo_path) }))),
    work: await Promise.all((work ?? []).map(async (w: any) => ({ id: w.id, title: w.title, kind: w.kind, description: w.description, link_url: w.link_url, subject: w.subjects?.name ?? null,
      created_at: w.created_at, image: w.content_type?.startsWith("image/") ? await photoUrl(svc, w.path) : null }))),
    certificates: certs ?? []
  };
}

export async function staffPortfolio(svc: any, tenantId: string, staffId: string, achievementId?: string | null) {
  let q = svc.from("staff_achievements").select("*").eq("tenant_id", tenantId).eq("staff_id", staffId).order("achieved_on", { ascending: false });
  if (achievementId) q = q.eq("id", achievementId);
  const { data } = await q;
  return Promise.all((data ?? []).map(async (a: any) => ({ id: a.id, kind: a.kind, title: a.title, description: a.description, issuer: a.issuer, achieved_on: a.achieved_on, link_url: a.link_url, photo: await photoUrl(svc, a.photo_path) })));
}

/** Targets with where the student stands now. */
export async function targetsFor(sb: any, tenantId: string, studentId: string) {
  const { data: targets, error } = await sb.from("student_targets").select("*,subjects(name),terms(name)").eq("tenant_id", tenantId).eq("student_id", studentId).order("created_at", { ascending: false });
  if (error) return [];
  const { data: cards } = await sb.from("report_cards").select("term_id,average,data,published_at").eq("tenant_id", tenantId).eq("student_id", studentId).eq("status", "published").eq("kind", "term").order("published_at", { ascending: false }).limit(12);
  const { data: att } = await sb.from("class_attendance").select("status").eq("tenant_id", tenantId).eq("student_id", studentId).gte("date", new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10)).limit(400);
  const marked = (att ?? []).length;
  const evidence = {
    averages: (cards ?? []).map((c: any) => ({ term_id: c.term_id, average: c.average === null ? null : Number(c.average),
      subjects: (c.data?.subjects ?? []).map((s: any) => ({ subject_id: s.subject_id, total: s.total === null || s.total === undefined ? null : Number(s.total) })) })),
    attendance: marked ? Math.round((100 * (att ?? []).filter((a: any) => a.status === "present" || a.status === "late").length) / marked) : null
  };
  return (targets ?? []).map((t: any) => ({ id: t.id, kind: t.kind, target: t.target === null ? null : Number(t.target), description: t.description, status: t.status, set_by_kind: t.set_by_kind,
    subject: t.subjects?.name ?? null, term: t.terms?.name ?? null, ...targetProgress({ ...t, target: t.target === null ? null : Number(t.target) } as Target, evidence) }));
}

export async function sharesFor(svc: any, tenantId: string, owner: { student_id?: string; staff_id?: string }, baseUrl: string) {
  let q = svc.from("portfolio_shares").select("id,token,achievement_id,created_at,expires_at,revoked_at,views").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(20);
  q = owner.student_id ? q.eq("student_id", owner.student_id) : q.eq("staff_id", owner.staff_id);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []).map((s: any) => ({ id: s.id, url: `${baseUrl}/p/${s.token}`, achievement_id: s.achievement_id, created_at: s.created_at, expires_at: s.expires_at, views: s.views, state: shareState(s) }));
}

export async function createShare(svc: any, p: { tenantId: string; studentId?: string; staffId?: string; achievementId?: string | null; days: number; actor: string }) {
  const { data, error } = await svc.from("portfolio_shares").insert({ tenant_id: p.tenantId, student_id: p.studentId ?? null, staff_id: p.staffId ?? null, achievement_id: p.achievementId ?? null,
    created_by: p.actor, expires_at: new Date(Date.now() + p.days * 86_400_000).toISOString() }).select("id,token").single();
  if (error) throw new Error(error.message);
  return data as { id: string; token: string };
}
