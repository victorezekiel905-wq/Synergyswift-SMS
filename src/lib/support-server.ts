/** Support access sessions (phase 14k). */

/** Ends a support session: the account stops working at once (and its sign-in is banned). */
export async function endSupportSession(svc: any, id: string, by: string | null) {
  const { data: s } = await svc.from("platform_support_sessions").select("id,support_user_id,tenant_id,ended_at").eq("id", id).maybeSingle();
  if (!s) return false;
  const now = new Date().toISOString();
  if (s.support_user_id) {
    await svc.from("users").update({ active: false, support_until: now }).eq("id", s.support_user_id);
    await svc.auth.admin.updateUserById(s.support_user_id, { ban_duration: "876000h" }).catch(() => null);
  }
  if (!s.ended_at) {
    await svc.from("platform_support_sessions").update({ ended_at: now, ended_by: by }).eq("id", s.id);
    await svc.from("audit_logs").insert({ tenant_id: s.tenant_id, actor_id: s.support_user_id, action: "support.ended", meta: { session_id: s.id } });
  }
  return true;
}

/** The scheduler ends support sessions that have run out (the database already ignores them). */
export async function endExpiredSupport(svc: any, now = new Date()) {
  const { data, error } = await svc.from("platform_support_sessions").select("id").is("ended_at", null).lt("expires_at", now.toISOString()).limit(50);
  if (error) return 0;
  for (const s of data ?? []) await endSupportSession(svc, s.id, null);
  return (data ?? []).length;
}
