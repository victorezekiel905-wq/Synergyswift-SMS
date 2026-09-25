/**
 * Safe Exam Browser (SEB) integration.
 *
 * SEB adds two request headers to every request it makes:
 *   X-SafeExamBrowser-RequestHash    = SHA256(absoluteURL + BrowserExamKey)
 *   X-SafeExamBrowser-ConfigKeyHash  = SHA256(absoluteURL + ConfigKey)
 * The server recomputes these for each allowed key. The Config Key is the
 * more stable choice (it does not change between SEB versions); teachers
 * copy it from the SEB Config Tool after opening the generated .seb file.
 */
import { sha256hex } from "../crypto";

export type SebSettings = {
  require_seb?: boolean;
  seb_browser_keys?: string[];
  seb_config_keys?: string[];
  quit_password?: string;
  allow_spellcheck?: boolean;
  allow_downloads_uploads?: boolean;
};

export type SebCheck = { ok: boolean; level: "hash" | "user_agent" | "none"; reason?: string };

/** Absolute URL of the request as SEB sees it (no fragment). Honours proxies. */
export function absoluteRequestUrl(req: Request): string {
  const u = new URL(req.url);
  const h = req.headers;
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() ?? h.get("host");
  if (proto) u.protocol = proto + ":";
  if (host) u.host = host;
  u.hash = "";
  return u.toString();
}

export function isSebUserAgent(ua: string | null | undefined): boolean {
  return /\bSEB\/\d/i.test(ua ?? "") || /SafeExamBrowser/i.test(ua ?? "");
}

export function verifySeb(url: string, headers: Headers, s: SebSettings): SebCheck {
  if (!s.require_seb) return { ok: true, level: "none" };
  const bek = (s.seb_browser_keys ?? []).map(k => k.trim()).filter(Boolean);
  const ck = (s.seb_config_keys ?? []).map(k => k.trim()).filter(Boolean);
  const reqHash = headers.get("x-safeexambrowser-requesthash")?.toLowerCase();
  const cfgHash = headers.get("x-safeexambrowser-configkeyhash")?.toLowerCase();

  if (bek.length || ck.length) {
    if (ck.length && cfgHash && ck.some(k => sha256hex(url + k) === cfgHash)) return { ok: true, level: "hash" };
    if (bek.length && reqHash && bek.some(k => sha256hex(url + k) === reqHash)) return { ok: true, level: "hash" };
    return {
      ok: false, level: "hash",
      reason: reqHash || cfgHash
        ? "Safe Exam Browser keys do not match this exam. Download the exam's SEB file again."
        : "This exam must be opened in Safe Exam Browser."
    };
  }
  // No keys configured: fall back to user-agent detection (weaker, documented).
  if (isSebUserAgent(headers.get("user-agent"))) return { ok: true, level: "user_agent" };
  return { ok: false, level: "user_agent", reason: "This exam must be opened in Safe Exam Browser." };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Generates an unencrypted XML-plist .seb configuration. SEB accepts plain
 * XML configuration files; schools that need encryption can re-save it with
 * the SEB Config Tool.
 */
export function buildSebConfig(opts: { startUrl: string; quitUrl: string; title: string } & SebSettings): string {
  const bool = (b: boolean) => (b ? "<true/>" : "<false/>");
  const entries: [string, string][] = [
    ["originatorVersion", `<string>EduClass Fusion</string>`],
    ["startURL", `<string>${esc(opts.startUrl)}</string>`],
    ["quitURL", `<string>${esc(opts.quitUrl)}</string>`],
    ["quitURLConfirm", bool(false)],
    ["sendBrowserExamKey", bool(true)],
    ["browserWindowTitleSuffix", `<string>${esc(opts.title)}</string>`],
    ["allowQuit", bool(true)],
    ["hashedQuitPassword", `<string>${opts.quit_password ? sha256hex(opts.quit_password) : ""}</string>`],
    ["allowSpellCheck", bool(Boolean(opts.allow_spellcheck))],
    ["allowDictionaryLookup", bool(false)],
    ["enableRightMouse", bool(false)],
    ["enablePrintScreen", bool(false)],
    ["allowPreferencesWindow", bool(false)],
    ["allowDownUploads", bool(Boolean(opts.allow_downloads_uploads))],
    ["browserViewMode", "<integer>1</integer>"],
    ["mainBrowserWindowWidth", "<string>100%</string>"],
    ["mainBrowserWindowHeight", "<string>100%</string>"],
    ["newBrowserWindowByLinkPolicy", "<integer>0</integer>"],
    ["newBrowserWindowByScriptPolicy", "<integer>0</integer>"],
    ["enableAppSwitcherCheck", bool(true)],
    ["forceAppFolderInstall", bool(true)],
    ["detectStoppedProcess", bool(true)],
    ["allowVirtualMachine", bool(false)],
    ["allowScreenSharing", bool(false)],
    ["enableZoomPage", bool(true)],
    ["enableZoomText", bool(true)],
    ["URLFilterEnable", bool(false)],
    ["sebConfigPurpose", "<integer>0</integer>"]
  ];
  const body = entries.map(([k, v]) => `\t<key>${k}</key>\n\t${v}`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
</dict>
</plist>
`;
}

/** seb:// or sebs:// link that makes SEB download and start the config. */
export function sebLaunchUrl(configUrl: string): string {
  return configUrl.replace(/^https:/, "sebs:").replace(/^http:/, "seb:");
}
