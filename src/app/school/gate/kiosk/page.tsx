"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import GateScanner from "@/components/gate/GateScanner";

/** Full-screen gate kiosk for a tablet or PC with a QR scanner at the school entrance. */
export default function KioskPage() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return (
    <main className="min-h-screen bg-slate-900 p-6 text-white sm:p-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-bold">Gate sign in / out</h1>
          <p className="text-3xl font-light tabular-nums">{now?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</p>
        </div>
        <div className="rounded-2xl bg-white p-6 text-slate-900"><GateScanner big /></div>
        <Link href="/school/gate" className="mt-6 inline-block text-sm text-slate-400 hover:text-white">Exit kiosk</Link>
      </div>
    </main>
  );
}
