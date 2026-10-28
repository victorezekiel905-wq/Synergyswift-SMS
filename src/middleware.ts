import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(toSet: { name: string; value: string; options?: any }[]) {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        }
      }
    }
  );
  // Refreshes the session cookie when it is about to expire. getClaims checks the token locally when the
  // project uses asymmetric signing keys (no call to Supabase Auth on every page and API request).
  await supabase.auth.getClaims();
  // A long-lived random id for this browser, used when a school only lets staff in from approved devices.
  if (!request.cookies.get("ecf_dev")) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(20)), b => b.toString(16).padStart(2, "0")).join("");
    response.cookies.set("ecf_dev", id, { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 400 });
  }
  // Other websites may frame only the public admissions and enquiry forms (school sites embed them); nothing else, against clickjacking.
  if (!/^\/(apply|enquire)\//.test(request.nextUrl.pathname)) response.headers.set("Content-Security-Policy", "frame-ancestors 'self'");
  return response;
}

// Content packages (/pkg/…), their record store (/api/xapi/…), clocking machines (/iclock/…), the open API (/api/v1/…)
// and the public website feeds (/api/public/…) do not use the session. Live lessons' code workers (/sandbox/…)
// keep the strict policy next.config.mjs gives them.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|pkg/|api/xapi/|api/v1/|api/v1$|api/public/|api/whatsapp/|api/ussd|api/vitals|iclock/|sandbox/|embed\\.js|.*\\.svg$).*)"]
};
