/**
 * E-signatures on the server: making a request (fingerprinting exactly what
 * will be signed), sending each signer their private link, and reminders.
 * Rules live in esign.ts.
 */
import { contentHash, fileFingerprint } from "./esign";
import { tellStaff, emailPerson } from "./hr-server";
import { notifyGuardians } from "./notify";
import { communityNote } from "./messaging/notices";
import { guardiansByStudent } from "./messaging/outbox";
import { studentName } from "./school";

export type NewRequest = {
  title: string; kind: "form" | "contract" | "policy" | "consent" | "other"; body: string; document_id: string | null; due_on: string | null;
  staff_contract_id?: string | null;
  staff_ids: string[];                                  // users
  student_ids: string[];                                // their parents sign, one per child
  external: { name: string; email: string }[];
};

/** The fingerprint of an attached library document's file (or its id and version when it has no file). */
async function documentFingerprint(svc: any, tenantId: string, documentId: string | null): Promise<string | null> {
  if (!documentId) return null;
  const { data: d } = await svc.from("school_documents").select("id,version,path,status").eq("tenant_id", tenantId).eq("id", documentId).maybeSingle();
  if (!d) throw new Error("the attached document was not found");
  if (!d.path) return `${d.id}:${d.version}`;
  const { data: blob } = await svc.storage.from("school-documents").download(d.path);
  if (!blob) throw new Error("could not read the attached document");
  return fileFingerprint(Buffer.from(await blob.arrayBuffer()));
}

export async function createRequest(svc: any, tenantId: string, actorId: string, base: string, r: NewRequest): Promise<{ id: string; signers: number; noContact: number }> {
  const hash = contentHash(r.title, r.body, await documentFingerprint(svc, tenantId, r.document_id));
  const [{ data: users }, guardianMap, { data: students }] = await Promise.all([
    r.staff_ids.length ? svc.from("users").select("id,full_name,email,role").eq("tenant_id", tenantId).in("id", r.staff_ids).eq("active", true) : { data: [] },
    guardiansByStudent(svc, tenantId, r.student_ids),
    r.student_ids.length ? svc.from("students").select("id,first_name,last_name,other_names").eq("tenant_id", tenantId).in("id", r.student_ids) : { data: [] }
  ]);
  const staff = (users ?? []).filter((u: any) => !["parent", "student"].includes(u.role));
  const signers: any[] = [
    ...staff.map((u: any) => ({ signer_type: "staff", user_id: u.id, name: u.full_name, email: u.email })),
    ...r.student_ids.flatMap(sid => (guardianMap.get(sid) ?? []).map(g => ({ signer_type: "guardian", guardian_id: g.id, student_id: sid, name: g.full_name, email: g.email }))),
    ...r.external.map(e => ({ signer_type: "external", name: e.name, email: e.email }))
  ];
  if (!signers.length) throw new Error("nobody to send it to (the children chosen have no parents on record)");
  const { data: req, error } = await svc.from("signature_requests").insert({
    tenant_id: tenantId, title: r.title, kind: r.kind, body: r.body, document_id: r.document_id, staff_contract_id: r.staff_contract_id ?? null,
    rule: r.student_ids.length && !r.staff_ids.length && !r.external.length ? "any_per_child" : "all", content_hash: hash, due_on: r.due_on, created_by: actorId
  }).select("id").single();
  if (error) throw new Error(error.message);
  const { data: made, error: e2 } = await svc.from("signature_signers").insert(signers.map(s => ({ ...s, tenant_id: tenantId, request_id: req.id }))).select("id,signer_type,user_id,guardian_id,student_id,name,email,token");
  if (e2) { await svc.from("signature_requests").delete().eq("id", req.id); throw new Error(e2.message); }
  const noContact = await sendLinks(svc, tenantId, base, req.id, r.title, r.due_on, made ?? [], new Map((students ?? []).map((s: any) => [s.id, studentName(s)])));
  return { id: req.id, signers: (made ?? []).length, noContact };
}

/** Sends each waiting signer their private link (staff: app notification or email; parents: their usual channels; others: email). */
export async function sendLinks(svc: any, tenantId: string, base: string, requestId: string, title: string, dueOn: string | null, signers: any[], childNames: Map<string, string> = new Map()) {
  const due = dueOn ? ` by ${dueOn}` : "";
  for (const s of signers.filter(x => x.signer_type === "staff")) {
    await tellStaff(svc, tenantId, [s.user_id], "form_to_sign", `Please sign: ${title}`, `"${title}" is waiting for your signature${due}.`, `${base}/sign/${s.token}`, requestId);
  }
  for (const s of signers.filter(x => x.signer_type === "external" && x.email)) {
    await emailPerson(svc, tenantId, { email: s.email, name: s.name, subject: `Please sign: ${title}`, lines: [`"${title}" is waiting for your signature${due}.`, "Open the link to read it and sign."],
      link: `${base}/sign/${s.token}`, linkLabel: "Read and sign", kind: "form_to_sign", refId: requestId });
  }
  const parents = signers.filter(x => x.signer_type === "guardian");
  if (!parents.length) return 0;
  const token = new Map(parents.map(s => [`${s.guardian_id}|${s.student_id}`, s.token]));
  const studentIds = [...new Set(parents.map(s => s.student_id))] as string[];
  if (!childNames.size) {
    const { data } = await svc.from("students").select("id,first_name,last_name,other_names").in("id", studentIds);
    for (const s of data ?? []) childNames.set(s.id, studentName(s));
  }
  const { noContact } = await notifyGuardians(svc, {
    tenantId, studentIds, kind: "form_to_sign", refId: requestId,
    build: (brand, g, sid) => communityNote(brand, { name: g.full_name, subject: `Please sign: ${title}`,
      lines: [`"${title}" for ${childNames.get(sid) ?? "your child"} needs a parent's signature${due}.`, "Open the link to read it and sign. One parent signing is enough."],
      link: `${base}/sign/${token.get(`${g.id}|${sid}`) ?? ""}`, linkLabel: "Read and sign" })
  });
  return noContact.length;
}
