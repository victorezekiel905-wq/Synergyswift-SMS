/**
 * Client IP and allow-list checks (exam IP restriction, staff portals).
 *
 * X-Forwarded-For is a list the client can pre-fill, so the leftmost entry can
 * be forged. Each proxy appends the address it saw, so with N trusted proxies
 * in front of the app (Render = 1, Cloudflare + Render = 2) the real client is
 * the Nth entry from the right. Set TRUSTED_PROXY_HOPS when that differs.
 */
export function clientIp(headers: Headers, hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1)): string | null {
  const cf = headers.get("cf-connecting-ip");
  if (cf && hops >= 2) return normalizeIp(cf);
  const xff = (headers.get("x-forwarded-for") ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (xff.length) return normalizeIp(xff[Math.max(0, xff.length - Math.max(1, hops))]);
  const real = headers.get("x-real-ip");
  return real ? normalizeIp(real) : null;
}

export function normalizeIp(ip: string): string {
  let s = ip.trim().toLowerCase();
  if (s.startsWith("[") && s.includes("]")) s = s.slice(1, s.indexOf("]"));          // [v6]:port
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(s)) s = s.split(":")[0];               // v4:port
  if (s.startsWith("::ffff:") && /^\d+\.\d+\.\d+\.\d+$/.test(s.slice(7))) s = s.slice(7); // v4-mapped v6
  return s;
}

function v4ToBig(ip: string): bigint | null {
  const p = ip.split(".");
  if (p.length !== 4 || p.some(x => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null;
  return p.reduce((a, x) => (a << 8n) + BigInt(Number(x)), 0n);
}

function v6ToBig(ip: string): bigint | null {
  if (!ip.includes(":")) return null;
  let s = ip;
  // Embedded IPv4 tail (::ffff:1.2.3.4 or 64:ff9b::1.2.3.4)
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const v4 = v4ToBig(tail[1]);
    if (v4 === null) return null;
    s = s.slice(0, -tail[1].length) + ((v4 >> 16n) & 0xffffn).toString(16) + ":" + (v4 & 0xffffn).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...right];
  if (groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.reduce((a, g) => (a << 16n) + BigInt(parseInt(g, 16)), 0n);
}

function parse(ip: string): { v: 4 | 6; n: bigint } | null {
  const s = normalizeIp(ip);
  const v4 = v4ToBig(s);
  if (v4 !== null) return { v: 4, n: v4 };
  const v6 = v6ToBig(s);
  return v6 !== null ? { v: 6, n: v6 } : null;
}

/** Is a rule ("41.58.10.7", "41.58.0.0/16", "2c0f:f5c0::/32") well formed? */
export function isValidIpRule(rule: string): boolean {
  const [addr, bits, extra] = rule.trim().split("/");
  if (extra !== undefined) return false;
  const p = parse(addr);
  if (!p) return false;
  if (bits === undefined) return true;
  const n = Number(bits);
  return /^\d+$/.test(bits) && n >= 0 && n <= (p.v === 4 ? 32 : 128);
}

/** True when `ip` matches any rule. An empty rule list allows everyone. */
export function ipAllowed(ip: string | null | undefined, rules: string[] | null | undefined): boolean {
  const list = (rules ?? []).map(r => r.trim()).filter(Boolean);
  if (!list.length) return true;
  if (!ip) return false;
  const a = parse(ip);
  if (!a) return false;
  return list.some(rule => {
    const [addr, bitsRaw] = rule.split("/");
    const r = parse(addr);
    if (!r || r.v !== a.v) return false;
    const width = a.v === 4 ? 32 : 128;
    const bits = bitsRaw === undefined ? width : Number(bitsRaw);
    if (!(bits >= 0 && bits <= width)) return false;
    const shift = BigInt(width - bits);
    return (a.n >> shift) === (r.n >> shift);
  });
}
