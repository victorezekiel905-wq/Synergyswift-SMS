import localFont from "next/font/local";
import { ToastProvider } from "@/live/components/ui";
import { KeyboardScroll } from "@/live/components/KeyboardScroll";
import { LiveSupports } from "./LiveSupports";

// "Easy-to-read font" learning support: designed for low vision, with dyslexia-friendly letter
// shapes. Only students whose teacher turns it on use it, so it is not downloaded up front.
const readable = localFont({
  src: [{ path: "./fonts/atkinson-hyperlegible-latin-400-normal.woff2", weight: "400" }, { path: "./fonts/atkinson-hyperlegible-latin-700-normal.woff2", weight: "700" }],
  variable: "--font-readable", display: "swap", preload: false
});

/** Live lessons' own toasts and confirm dialogs, keyboard-scrollable regions and learning supports. */
export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`live-root ${readable.variable}`}>
      <KeyboardScroll />
      <LiveSupports />
      <ToastProvider>{children}</ToastProvider>
    </div>
  );
}
