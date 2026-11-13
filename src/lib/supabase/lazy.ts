/**
 * The browser's Supabase client, loaded when it is first needed instead of with the page.
 * The sign-in library is large; pages that only sign in or out (sign-in, sign-up, the app frame)
 * show at once and fetch it right after (warmBrowserClient) or when a button is pressed.
 */
type Client = ReturnType<typeof import("./client")["createClient"]>;
let loading: Promise<typeof import("./client")> | null = null;
const load = () => (loading ??= import("./client").catch(e => { loading = null; throw e; }));

export async function browserClient(): Promise<Client> {
  return (await load()).createClient();
}

/** Starts downloading the client after the page has shown, so a press of "Sign in" does not wait for it. */
export function warmBrowserClient() {
  if (typeof window === "undefined") return;
  const go = () => { void load().catch(() => {}); };
  const idle = (window as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(go, { timeout: 1500 }); else setTimeout(go, 300);
}
