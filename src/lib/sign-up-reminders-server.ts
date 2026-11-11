/**
 * Invitations nobody answered, followed up by themselves (run once a day from the daily job):
 *  - staff still waiting to sign up get their sign-up code again (3 days after they were added,
 *    then every 4 days, 3 sends in all);
 *  - parents who only got the private link (no email) get it again (7 days, then weekly, 3 in all);
 *  - on Mondays, the school's admins get one line saying how many have still not signed up.
 * How often each person was already written to comes from the message outbox, so no new column.
 */
import { fetchAll, chunks } from "./fetch-all";
import { dayIn } from "./analysis";
import { sendCodes } from "./sign-up-codes-server";
import { ensureGuardianInvite } from "./accounts-server";
import { tellStaff } from "./hr-server";
import { reminderDue, digestText, STAFF_RULE, PARENT_RULE } from "./sign-up-reminders";

type Svc = any;

export async function remindUnansweredInvites(svc: Svc, baseUrl: string, now = new Date()) {
  const out = { staff_reminded: 0, parents_reminded: 0, digests: 0, errors: 0 };
  const { data: tenants } = await svc.from("tenants").select("id,timezone").eq("status", "active");
  for (const t of tenants ?? []) {
    const tid = t.id as string;
    try {
      // Staff: no account yet, on the books for a few days.
      const since = new Date(now.getTime() - STAFF_RULE.afterDays * 86_400_000).toISOString();
      const staff = await fetchAll<{ id: string; created_at: string }>(() =>
        svc.from("staff").select("id,created_at").eq("tenant_id", tid).is("user_id", null).neq("status", "exited").lte("created_at", since).order("id"));
      const sends = await sentBefore(svc, tid, "account_key", staff.map(s => s.id));
      const due = staff.filter(s => reminderDue(s.created_at, sends.get(s.id) ?? [], now, STAFF_RULE));
      if (due.length) {
        const r = await sendCodes(svc, { tenantId: tid, items: due.map(s => ({ kind: "staff" as const, id: s.id })), baseUrl, actor: null });
        out.staff_reminded += due.length - r.skipped;
      }

      // Parents with the private link only (those with an email got an account invitation and can use "Forgot password").
      const pSince = new Date(now.getTime() - PARENT_RULE.afterDays * 86_400_000).toISOString();
      const parents = await fetchAll<{ id: string; invited_at: string }>(() =>
        svc.from("guardians").select("id,invited_at").eq("tenant_id", tid).is("user_id", null).not("invited_at", "is", null).lte("invited_at", pSince).order("id"));
      const pSends = await sentBefore(svc, tid, "portal_link", parents.map(g => g.id));
      for (const g of parents) {
        const list = pSends.get(g.id) ?? [];
        if (!list.length || !reminderDue(list[0]!, list, now, PARENT_RULE)) continue;   // never reached by any channel: nothing to repeat
        try { const r = await ensureGuardianInvite(svc, g.id, baseUrl); if (r.invited) out.parents_reminded++; } catch { out.errors++; }
      }

      // Mondays: one line to the admins.
      const local = new Date(`${dayIn(now, t.timezone || "Africa/Lagos")}T12:00:00Z`);
      if (local.getUTCDay() === 1) {
        const [{ count: staffWaiting }, { count: parentsWaiting }] = await Promise.all([
          svc.from("staff").select("id", { count: "exact", head: true }).eq("tenant_id", tid).is("user_id", null).neq("status", "exited").lte("created_at", since),
          svc.from("guardians").select("id", { count: "exact", head: true }).eq("tenant_id", tid).is("user_id", null).lte("created_at", pSince)
        ]);
        const text = digestText({ staffWaiting: staffWaiting ?? 0, parentsWaiting: parentsWaiting ?? 0 });
        if (text) {
          const { data: admins } = await svc.from("users").select("id,role,extra_roles").eq("tenant_id", tid).eq("active", true);
          const to = (admins ?? []).filter((u: any) => ["school_admin", "principal"].some(r => u.role === r || (u.extra_roles ?? []).includes(r))).map((u: any) => u.id);
          await tellStaff(svc, tid, to, "signup_digest", "Sign-ups still waiting", text, `${baseUrl}/school/staff-onboarding`);
          out.digests++;
        }
      }
    } catch { out.errors++; }
  }
  return out;
}

/** When each person was written to before (outbox rows of one kind, by ref_id), newest first. */
async function sentBefore(svc: Svc, tenantId: string, kind: string, ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const c of chunks(ids)) {
    const rows = await fetchAll<{ ref_id: string; created_at: string }>(() =>
      svc.from("message_outbox").select("id,ref_id,created_at").eq("tenant_id", tenantId).eq("kind", kind).in("ref_id", c).order("id"));
    for (const r of rows) out.set(r.ref_id, [...(out.get(r.ref_id) ?? []), r.created_at]);
  }
  for (const [k, v] of out) out.set(k, v.sort().reverse());
  return out;
}
