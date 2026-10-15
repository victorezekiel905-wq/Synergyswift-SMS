/**
 * Helpers for the ZKTeco push (ADMS) endpoints under /iclock. Machines are
 * known by their serial number, which an admin registers first; unknown or
 * disabled machines are refused.
 */
export const text = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function iclockDevice(svc: any, serial: string) {
  const sn = serial.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,40}$/.test(sn)) return null;
  const { data } = await svc.from("attendance_devices").select("id,tenant_id,name,mode,active,tenants(timezone,status)").eq("serial", sn).eq("kind", "zkteco").maybeSingle();
  if (!data || !data.active || data.tenants?.status !== "active") return null;
  await svc.from("attendance_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  return data as { id: string; tenant_id: string; name: string; mode: string; tenants: { timezone: string } | null };
}
