// Grants platform (super) admin to an email address.
//
//   node --env-file=.env.local scripts/make-platform-admin.mjs you@company.com
//
// Platform admins live outside every school: they have no row in public.users,
// so no school can see them. If the email has no account yet, an invitation
// link is printed (and emailed by Supabase if SMTP is configured).
import { createClient } from "@supabase/supabase-js";

const email = (process.argv[2] ?? "").trim().toLowerCase();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!email || !url || !key) {
  console.error("usage: node --env-file=.env.local scripts/make-platform-admin.mjs <email>\n(needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

let userId = null;
for (let page = 1; page < 50 && !userId; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
  if (error) { console.error(error.message); process.exit(1); }
  userId = data.users.find(u => u.email?.toLowerCase() === email)?.id ?? null;
  if (data.users.length < 200) break;
}
if (!userId) {
  const app = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { data, error } = await sb.auth.admin.generateLink({ type: "invite", email, options: { redirectTo: `${app}/auth/welcome?next=/platform` } });
  if (error) { console.error(error.message); process.exit(1); }
  userId = data.user.id;
  console.log(`Created account. Set-password link (valid 24h):\n${data.properties.action_link}\n`);
}

const { data: profile } = await sb.from("users").select("tenant_id").eq("id", userId).maybeSingle();
if (profile) {
  console.error(`${email} belongs to a school (tenant ${profile.tenant_id}). Use a separate email for the platform console.`);
  process.exit(1);
}
const { error } = await sb.from("platform_admins").upsert({ user_id: userId });
if (error) { console.error(error.message); process.exit(1); }
console.log(`${email} is now a platform admin. Sign in, set up an authenticator app when asked (super admins must use two-factor sign-in), and you will land on /platform.`);
