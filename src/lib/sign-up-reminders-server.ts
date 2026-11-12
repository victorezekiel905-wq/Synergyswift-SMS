/**
 * Invitations nobody answered, followed up by themselves (run once a day from the daily job):
 *  - staff with no account yet get their sign-up code again;
 *  - staff whose account was made by an email link or one-time password but who never signed in
 *    get a fresh link (3 days after they were added, then every 4 days, 3 sends in all);
 *  - parents who only have the private link get it again, and parents emailed an invitation who
 *    never signed in get their private link (7 days, then weekly);
 *  - on Mondays, the school's admins get one line saying who is still waiting.
 * How often each person was written to comes from the message outbox, and whether they have
 * signed in from migration 10200 (before it, only people with no account are followed up).
 * The run keeps to a time budget; a different school goes first each day.
 */
import { fetchAll, chunks } from "./fetch-all";
import { dayIn } from "./analysis";
import { sendCodes } from "./sign-up-codes-server";
import { ensureGuardianInvite } from "./accounts-server";
import { provisionUser } from "./provision";
import { tellStaff } from "./hr-server";
import { tenantSignIns } from "./staff-onboarding-server";
import { reminderDue, digestText, STAFF_RULE, PARENT_RULE } from "./sign-up-reminders";

type Svc = any;
const DAY = 86_400_000;

export async function remindUnansweredInvites(svc: Svc, baseUrl: string, now = new Date(), budgetMs = 25_000) {
  const out = { staff_reminded: 0, parents_reminded: 0, digests: 0, errors: 0, schools_left: 0 };
  const { data: all } = await svc.from("tenants").select("id,timezone").eq("status", "active").order("id");
  const tenants: { id: string; timezone: string | null }[] = all ?? [];
  const first = tenants.length ? Math.floor(now.getTime() / DAY) % tenants.length : 0;
  const order = [...tenants.slice(first), ...tenants.slice(0, first)];
  const deadline = Date.now() + budgetMs;
  const late = () => Date.now() > deadline;

  for (const [i, t] of order.entries()) {
    if (late()) { out.schools_left = order.length - i; break; }
    const tid = t.id;
    try {
      const signIns = await tenantSignIns(svc, tid);
      /** An account that exists but whose owner has never signed in. */
      const unused = (uid: string | null) => Boolean(uid) && signIns !== null && signIns.has(uid!) && !signIns.get(uid!);

      // ---- Staff ----
      const since = new Date(now.getTime() - STAFF_RULE.afterDays * DAY).toISOString();
      const staff = await fetchAll<{ id: string; created_at: string; user_id: string | null; full_name: string }>(() =>
        svc.from("staff").select("id,created_at,user_id,full_name").eq("tenant_id", tid).neq("status", "exited").lte("created_at", since).order("id"));
      const noAccount = staff.filter(s => !s.user_id), invited = staff.filter(s => unused(s.user_id));

      const sends = await sentBefore(svc, tid, "account_key", noAccount.map(s => s.id));
      const due = noAccount.filter(s => reminderDue(s.created_at, sends.get(s.id) ?? [], now, STAFF_RULE));
      if (due.length) {
        const r = await sendCodes(svc, { tenantId: tid, items: due.map(s => ({ kind: "staff" as const, id: s.id })), baseUrl, actor: null });
        out.staff_reminded += due.length - r.skipped;
      }

      if (invited.length) {
        const accounts = new Map<string, { email: string | null; role: string; extra_roles: string[] | null; active: boolean | null }>();
        for (const c of chunks(invited.map(s => s.user_id!))) {
          const { data } = await svc.from("users").select("id,email,role,extra_roles,active").eq("tenant_id", tid).in("id", c);
          for (const u of data ?? []) accounts.set(u.id, u);
        }
        const emails = [...accounts.values()].map(u => (u.email ?? "").toLowerCase()).filter(Boolean);
        const mailed = await sentTo(svc, tid, ["invite", "account_key"], emails);
        for (const s of invited) {
          if (late()) break;
          const u = accounts.get(s.user_id!);
          const email = (u?.email ?? "").toLowerCase();
          if (!u || u.active === false || !email) continue;          // a login the school switched off is left alone
          if (!reminderDue(s.created_at, mailed.get(email) ?? [], now, STAFF_RULE)) continue;
          try {
            await provisionUser(svc, { tenantId: tid, email, fullName: s.full_name, role: u.role, extraRoles: u.extra_roles ?? [], redirectTo: `${baseUrl}/auth/welcome?next=/dashboard`, createdBy: null });
            out.staff_reminded++;
          } catch { out.errors++; }
        }
      }

      // ---- Parents ----
      const pSince = new Date(now.getTime() - PARENT_RULE.afterDays * DAY).toISOString();
      const parents = await fetchAll<{ id: string; invited_at: string; user_id: string | null }>(() =>
        svc.from("guardians").select("id,invited_at,user_id").eq("tenant_id", tid).not("invited_at", "is", null).lte("invited_at", pSince).order("id"));
      const waitingParents = parents.filter(g => !g.user_id || unused(g.user_id));
      const pSends = await sentBefore(svc, tid, "portal_link", waitingParents.map(g => g.id));
      for (const g of waitingParents) {
        if (late()) break;
        const list = pSends.get(g.id) ?? [];
        const isDue = g.user_id
          ? reminderDue(g.invited_at, list, now, { ...PARENT_RULE, max: 2 })                 // emailed an invitation, never signed in: their private link, twice at most
          : list.length > 0 && reminderDue(list[0]!, list, now, PARENT_RULE);                 // has the private link only; never reached by any channel: nothing to repeat
        if (!isDue) continue;
        try { const r = await ensureGuardianInvite(svc, g.id, baseUrl); if (r.invited) out.parents_reminded++; } catch { out.errors++; }
      }

      // ---- Mondays: one line to the admins ----
      const local = new Date(`${dayIn(now, t.timezone || "Africa/Lagos")}T12:00:00Z`);
      if (local.getUTCDay() === 1) {
        const text = digestText({
          staffWaiting: noAccount.length + invited.length,
          parentsWaiting: parents.filter(g => unused(g.user_id)).length,
          parentsNoContact: parents.filter(g => !g.user_id && !(pSends.get(g.id)?.length)).length
        });
        if (text) {
          const { data: admins } = await svc.from("users").select("id,role,extra_roles").eq("tenant_id", tid).eq("active", true);
          const to = (admins ?? []).filter((u: any) => ["school_admin", "principal"].some(r => u.role === r || (u.extra_roles ?? []).includes(r))).map((u: any) => u.id);
          await tellStaff(svc, tid, to, "signup_digest", "Sign-ins still waiting", text, `${baseUrl}/school/onboarding`);
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

/** When each email address was written to before (invitations and one-time passwords), newest first. */
async function sentTo(svc: Svc, tenantId: string, kinds: string[], emails: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const c of chunks([...new Set(emails)], 100)) {
    const rows = await fetchAll<{ to_address: string; created_at: string }>(() =>
      svc.from("message_outbox").select("id,to_address,created_at").eq("tenant_id", tenantId).in("kind", kinds).in("to_address", c).order("id"));
    for (const r of rows) { const k = r.to_address.toLowerCase(); out.set(k, [...(out.get(k) ?? []), r.created_at]); }
  }
  for (const [k, v] of out) out.set(k, v.sort().reverse());
  return out;
}
