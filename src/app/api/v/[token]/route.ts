import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError } from "@/lib/auth";
import { certificateByToken } from "@/lib/sis-server";

export const dynamic = "force-dynamic";

/**
 * Public check of a certificate from the QR code printed on it: genuine or
 * not, revoked or not, and what it certifies. Shows only what the certificate
 * itself shows.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const r = await certificateByToken(createServiceClient(), (await props.params).token);
  if (!r) return jsonError("No certificate matches this code.", 404);
  const { c, genuine, school } = r;
  return NextResponse.json({
    certificate: { kind: c.kind, serial_no: c.serial_no, issued_on: c.issued_on, title: c.title, body: c.body, student: c.data?.student ?? null, admission_no: c.data?.admission_no ?? null,
      signer_name: c.signer_name, signer_title: c.signer_title, status: c.status, revoked_reason: c.status === "revoked" ? c.revoked_reason : null },
    genuine: genuine && c.status === "issued", altered: !genuine, school
  });
}
