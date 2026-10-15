import { text } from "@/lib/iclock";

export const dynamic = "force-dynamic";

/** Command results from the machine (none are sent). */
export async function POST() {
  return text("OK");
}
