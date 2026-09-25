import { createHash, randomBytes, randomInt } from "crypto";

export function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("hex");
}

/** Cryptographically random numeric code, e.g. pickup codes. */
export function randomDigits(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += String(randomInt(0, 10));
  return s;
}

/** Fisher–Yates shuffle using a CSPRNG. Returns a new array. */
export function secureShuffle<T>(items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickupCodeHash(tenantId: string, code: string): string {
  return sha256hex(`${tenantId}:${code.trim()}`);
}
