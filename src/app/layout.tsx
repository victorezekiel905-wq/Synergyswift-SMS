import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import AppShell from "@/components/AppShell";
import RegisterServiceWorker from "@/components/RegisterServiceWorker";
import EmbedResize from "@/components/EmbedResize";
import WebVitals from "@/components/WebVitals";
import Toaster from "@/components/Toaster";
import { BRAND_BOOT_SCRIPT } from "@/lib/theme";

// One type family throughout: Plex Sans for the interface, Plex Serif for titles, Plex Mono for codes.
// The files are in the project (src/app/fonts, IBM Plex, SIL Open Font Licence), so building never
// depends on reaching Google Fonts: a failed download there once stopped a deploy.
const sans = localFont({ variable: "--font-sans", display: "swap", fallback: ["system-ui", "sans-serif"], src: [
  { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
  { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
  { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  { path: "./fonts/ibm-plex-sans-latin-700-normal.woff2", weight: "700", style: "normal" }] });
const serif = localFont({ variable: "--font-serif", display: "swap", fallback: ["Georgia", "serif"], src: [
  { path: "./fonts/ibm-plex-serif-latin-500-normal.woff2", weight: "500", style: "normal" },
  { path: "./fonts/ibm-plex-serif-latin-600-normal.woff2", weight: "600", style: "normal" }] });
const mono = localFont({ variable: "--font-mono", display: "swap", fallback: ["ui-monospace", "monospace"], src: [
  { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
  { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" }] });

export const metadata: Metadata = {
  title: "Synergy Swift",
  description: "School management: admissions, attendance, results, fees, learning and the parent app.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: "/icons/apple-touch-icon.png"
  },
  appleWebApp: { capable: true, title: "Synergy Swift", statusBarStyle: "default" }
};

export const viewport: Viewport = {
  themeColor: "#263f73",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      {/* The school's colour from the last visit, before the first paint (src/lib/theme.ts). */}
      <head><script dangerouslySetInnerHTML={{ __html: BRAND_BOOT_SCRIPT }} /></head>
      <body className="min-h-screen bg-canvas font-sans text-[15px] text-slate-900 antialiased sm:text-sm">
        <WebVitals />
        <AppShell>{children}</AppShell>
        <Toaster />
        <RegisterServiceWorker />
        <EmbedResize />
      </body>
    </html>
  );
}
