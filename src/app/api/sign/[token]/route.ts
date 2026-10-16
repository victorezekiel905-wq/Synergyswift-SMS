import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { studentName } from "@/lib/school";
import { checkSignature, CONSENT_TEXT } from "@/lib/esign";

export const dynamic = "force-dynamic";

async function load(token: string) {
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  const svc = createServiceClient();
  const { data: s } = await svc.from("signature_signers")
    .select("id,tenant_id,name,status,signed_at,typed_name,student_id,request_id,signature_requests(id,title,kind,body,document_id,content_hash,due_on,status,school_documents(title,path)),students(first_name,last_name,other_names)")
    .eq("token", token).maybeSingle();
  return s ? { svc, s } : null;
}

/** The form or contract behind a signing link: what it says, who it is for and whether it is signed. Opening it is recorded. */
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const l = await load(token);
  if (!l) return jsonError("This link is not valid.", 404);
  const { svc, s } = l;
  const r: any = s.signature_requests;
  const { data: school } = await svc.from("tenant_settings").select("school_name,logo_url,brand_color").eq("tenant_id", s.tenant_id).maybeSingle();
  if (s.status === "pending" && r.status === "open") await svc.from("signature_signers").update({ status: "viewed", viewed_at: new Date().toISOString() }).eq("id", s.id);
  let file: string | null = null;
  if (r.school_documents?.path) {
    const { data } = await svc.storage.from("school-documents").createSignedUrl(r.school_documents.path, 1800);
    file = data?.signedUrl ?? null;
  }
  return NextResponse.json({
    school: school ?? null, consent: CONSENT_TEXT,
    request: { title: r.title, kind: r.kind, body: r.body, due_on: r.due_on, status: r.status, fingerprint: r.content_hash, document: r.school_documents ? { title: r.school_documents.title, url: file } : null },
    signer: { name: s.name, status: s.status === "pending" ? "viewed" : s.status, signed_at: s.signed_at, typed_name: s.typed_name, child: (s as any).students ? studentName((s as any).students) : null }
  }, { headers: { "Cache-Control": "no-store" } });
}

const Body = z.union([
  z.object({ action: z.literal("sign"), agree: z.boolean(), typed_name: z.string().max(160), signature_png: z.string().max(400_000).nullish() }),
  z.object({ action: z.literal("decline"), reason: z.string().trim().min(2).max(1000) })
]);

/** Signs (or declines). The signature is checked against the fingerprint of what was sent. */
export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const l = await load(token);
  if (!l) return jsonError("This link is not valid.", 404);
  const { svc, s } = l;
  const r: any = s.signature_requests;
  if (r.status !== "open") return jsonError(r.status === "cancelled" ? "This request was cancelled." : "This request is already complete.", 409);
  if (!["pending", "viewed"].includes(s.status)) return jsonError(s.status === "not_needed" ? "Another parent has already signed this." : "This has already been answered.", 409);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  const meta = { ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64) || null, user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null };
  if (b.action === "decline") {
    const { error } = await svc.from("signature_signers").update({ status: "declined", decline_reason: b.reason, ...meta }).eq("id", s.id).in("status", ["pending", "viewed"]);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true, status: "declined" });
  }
  const problem = checkSignature(b);
  if (problem) return jsonError(problem);
  const { data, error } = await svc.from("signature_signers").update({
    status: "signed", signed_at: new Date().toISOString(), typed_name: b.typed_name.trim(), signature_png: b.signature_png || null, signed_hash: r.content_hash, ...meta
  }).eq("id", s.id).in("status", ["pending", "viewed"]).select("id");
  if (error) return jsonError(error.message.includes("changed since") ? "This document changed after it was sent; ask the school for a new link." : error.message);
  if (!data?.length) return jsonError("This has already been answered.", 409);
  return NextResponse.json({ ok: true, status: "signed" });
}
