// Grants platform (super) admin to an email address.
//
//   node --env-file=.env.local scripts/make-platform-admin.mjs you@company.com [--owner]
//
// --owner makes them the platform owner (the only role that creates schools);
// otherwise they are an admin. Platform admins live outside every school: they
// have no row in public.users, so no school can see them. A one-time link to set
// the password is printed (a new account gets an invitation, an existing one a
// reset). It opens the site's own confirm page, so mail scanners can't use it up.
import { createClient } from "@supabase/supabase-js";

const email = (process.argv.slice(2).find(a => !a.startsWith("--")) ?? "").trim().toLowerCase();
const role = process.argv.includes("--owner") ? "owner" : "admin";
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
const app = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const type = userId ? "recovery" : "invite";
const { data: link, error: linkError } = await sb.auth.admin.generateLink({ type, email });
if (linkError) { console.error(linkError.message); process.exit(1); }
userId = link.user.id;

const { data: profile } = await sb.from("users").select("tenant_id").eq("id", userId).maybeSingle();
if (profile) {
  console.error(`${email} belongs to a school (tenant ${profile.tenant_id}). Use a separate email for the platform console.`);
  process.exit(1);
}
const { error } = await sb.from("platform_admins").upsert({ user_id: userId, role });
if (error) { console.error(error.message); process.exit(1); }
const next = encodeURIComponent("/platform");
console.log(`${email} is now platform ${role}.\n\nOne-time link to set the password (valid 24 hours, works once; don't share it):\n` +
  `${app}/auth/confirm?token_hash=${link.properties.hashed_token}&type=${type}&next=${next}\n\n` +
  `Then sign in, set up an authenticator app when asked (super admins must use two-factor sign-in), and you land on /platform.`);
