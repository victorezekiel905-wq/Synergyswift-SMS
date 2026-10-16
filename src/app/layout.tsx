import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Serif, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";
import RegisterServiceWorker from "@/components/RegisterServiceWorker";
import EmbedResize from "@/components/EmbedResize";

// One type family throughout: Plex Sans for the interface, Plex Serif for titles, Plex Mono for codes.
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans", display: "swap" });
const serif = IBM_Plex_Serif({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-serif", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "EduClass Fusion",
  description: "School management: admissions, attendance, results, fees, learning and the parent app.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "EduClass", statusBarStyle: "default" }
};

export const viewport: Viewport = {
  themeColor: "#263f73",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-canvas font-sans text-[15px] text-slate-900 antialiased sm:text-sm">
        <AppShell>{children}</AppShell>
        <RegisterServiceWorker />
        <EmbedResize />
      </body>
    </html>
  );
}
