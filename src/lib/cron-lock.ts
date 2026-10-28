/**
 * One scheduled run at a time (migration 7600). take() returns a run id, or
 * null when another run still holds the lock. Before the migration is applied
 * the functions don't exist; then every run goes ahead, as before.
 */
export async function takeCronLock(svc: any, key: string, seconds: number): Promise<{ run: string | null; skip: boolean }> {
  const { data, error } = await svc.rpc("take_cron_lock", { p_key: key, p_seconds: seconds });
  if (error) return { run: null, skip: false };
  return { run: (data as string | null) ?? null, skip: !data };
}

export async function releaseCronLock(svc: any, key: string, run: string | null) {
  if (run) await svc.rpc("release_cron_lock", { p_key: key, p_run: run }).then(() => null, () => null);
}

/** Starts another scheduled route in its own request without waiting for it (the server keeps running it). */
export function startCron(base: string, path: string, secret: string) {
  void fetch(`${base}${path}`, { headers: { authorization: `Bearer ${secret}` } }).catch(() => null);
}
