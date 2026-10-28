import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { ussdReply } from "@/lib/ussd";
import { ussdData } from "@/lib/ussd-server";

export const dynamic = "force-dynamic";

const reply = (text: string, status = 200) => new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

function keyOk(given: string | null): boolean {
  const want = process.env.AT_USSD_SECRET;
  if (!want || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Africa's Talking USSD callback (phase 14q): set the callback URL to
 * <app>/api/ussd?key=<AT_USSD_SECRET>. The key proves the call comes from
 * Africa's Talking, because the phone number in it is how the parent is recognised.
 */
export async function POST(req: NextRequest) {
  if (!process.env.AT_USSD_SECRET) return reply("END This service is not available yet.", 503);
  if (!keyOk(new URL(req.url).searchParams.get("key"))) return reply("END Not allowed.", 403);
  const form = await req.formData().catch(() => null);
  const phone = String(form?.get("phoneNumber") ?? "").trim();
  const text = String(form?.get("text") ?? "").slice(0, 200);
  if (!/^\+?\d{8,15}$/.test(phone)) return reply("END We could not read your phone number. Please try again.");
  try {
    return reply(await ussdReply(text, phone, ussdData(createServiceClient(), appUrl(req))));
  } catch (e) {
    console.error("[ussd]", (e as Error).message);
    return reply("END Sorry, something went wrong. Please try again in a few minutes.");
  }
}
