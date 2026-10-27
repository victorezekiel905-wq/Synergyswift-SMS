import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError, readJson } from "@/lib/auth";
import { clientIp } from "@/lib/net";
import { sendEmail } from "@/lib/messaging/providers";
import { leadScore } from "@/lib/sales";

export const dynamic = "force-dynamic";

const Body = z.object({
  school_name: z.string().trim().min(2).max(200), contact_name: z.string().trim().min(2).max(120), contact_role: z.string().trim().max(80).nullish(),
  phone: z.string().trim().min(7).max(30), email: z.string().trim().email(), city: z.string().trim().max(80).nullish(), state: z.string().trim().max(80).nullish(),
  students_estimate: z.number().int().min(0).max(100000).nullish(), needs: z.string().trim().max(2000).nullish(),
  website: z.string().max(0).optional() // honeypot: people leave it empty
});

/**
 * "Book a demo" on the Synergy Swift website (phase 14g-1): becomes a lead in the platform's
 * sales CRM, scored by size, and the platform team is told at once. A few per hour per address.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("Please fill in the school's name, your name, phone and email.");
  const b = parsed.data;
  const svc = createServiceClient();
  const ip = clientIp(req.headers) ?? "unknown";
  const { count } = await svc.from("demo_request_tries").select("id", { count: "exact", head: true }).eq("ip", ip).gte("at", new Date(Date.now() - 3_600_000).toISOString());
  if ((count ?? 0) >= 5) return jsonError("Thank you; we already have your request. We'll be in touch shortly.", 429);
  await svc.from("demo_request_tries").insert({ ip });
  const { website: _w, ...row } = b;
  const now = new Date().toISOString();
  const score = leadScore({ stage: "new", source: "website", students_estimate: row.students_estimate ?? null, last_activity_at: now, created_at: now, next_action_at: null });
  const { data: lead, error } = await svc.from("sales_leads").insert({ ...row, source: "website", stage: "new", score,
    next_action: "Call back and book the demo", next_action_at: new Date(Date.now() + 24 * 3_600_000).toISOString() }).select("id").single();
  if (error) return jsonError("Sorry, the request could not be saved. Please try again or email us.");
  await svc.from("sales_activities").insert({ lead_id: lead.id, kind: "system", body: `Demo requested on the website${row.needs ? `: ${row.needs}` : ""}.` });
  const { data: team } = await svc.from("platform_admins").select("email").not("email", "is", null);
  for (const t of team ?? []) {
    await sendEmail({ to: t.email, subject: `Demo request: ${row.school_name}${row.students_estimate ? ` (${row.students_estimate} students)` : ""}`,
      text: `${row.contact_name}${row.contact_role ? `, ${row.contact_role}` : ""}\n${row.school_name}, ${[row.city, row.state].filter(Boolean).join(", ")}\n${row.phone} · ${row.email}\nStudents: ${row.students_estimate ?? "not given"}\n\n${row.needs ?? ""}\n\nOpen the sales CRM to follow up.` }).catch(() => null);
  }
  return NextResponse.json({ ok: true });
}
