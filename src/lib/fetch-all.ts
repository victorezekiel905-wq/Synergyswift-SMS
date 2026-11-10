/**
 * Supabase returns at most 1000 rows per request (the API's "max rows" setting, which
 * .limit() cannot raise), so a big school would otherwise lose rows silently: invoices not
 * made, families not messaged, students not promoted. These read every row, a page at a time.
 */
const PAGE = 1000;

/** Every row of a query. `build` makes a fresh query each call and must order by a unique key. */
export async function fetchAll<T>(build: () => any, max = 200_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
  return out;
}

/** Like fetchAll, but a failed read gives what was read so far (for pages that should still show). */
export async function fetchAllSafe<T>(build: () => any, max = 200_000): Promise<T[]> {
  try { return await fetchAll<T>(build, max); } catch { return []; }
}

/** Splits ids for `.in()` filters: a very long list makes the request URL too long. */
export function chunks<T>(list: readonly T[], size = 300): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
