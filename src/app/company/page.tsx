import Link from "next/link";
import { SiteHeader, SiteFooter, SectionTitle } from "@/components/site/SiteChrome";
import { COMPANY } from "@/lib/company";

export const metadata = {
  title: "Company details · Synergy Swift",
  description: `${COMPANY.brand} is a product of ${COMPANY.legalName}, a company registered in Nigeria with the Corporate Affairs Commission, RC ${COMPANY.rcNumber}.`
};

/** Who schools are dealing with: the registered company, as on its CAC certificate. */
export default function CompanyPage() {
  const rows: [string, React.ReactNode][] = [
    ["Registered name", COMPANY.legalName],
    ["RC number", <span key="rc" className="font-mono">{COMPANY.rcNumber}</span>],
    ["Company type", COMPANY.type],
    ["Incorporated", `${COMPANY.incorporatedLabel}, under the ${COMPANY.law}`],
    ["Registered with", "Corporate Affairs Commission (CAC), Nigeria"],
    ["Registered office", <span key="addr">{COMPANY.registeredAddress.map((l) => <span key={l} className="block">{l}</span>)}</span>]
  ];
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader />
      <main>
        <section className="border-b border-slate-200 bg-paper">
          <div className="mx-auto max-w-6xl px-5 pb-12 pt-14 sm:px-8 sm:pt-20">
            <SectionTitle label="Company" title="Who you are working with"
              text={`${COMPANY.brand} is built and run by ${COMPANY.legalName}, a registered Nigerian company. Schools sign their agreements with, and pay, the company below.`} />
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
          <div className="max-w-3xl overflow-hidden rounded-xl border border-slate-200">
            <dl className="divide-y divide-slate-200">
              {rows.map(([k, v]) => (
                <div key={k} className="grid gap-1 px-5 py-4 sm:grid-cols-[14rem_1fr] sm:gap-6">
                  <dt className="text-[13px] font-medium text-slate-500">{k}</dt>
                  <dd className="text-[15px] text-slate-900">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="mt-6 max-w-3xl text-[14px] leading-relaxed text-slate-600">
            You can check these details yourself on the CAC public register: search for RC {COMPANY.rcNumber} at{" "}
            <a href={COMPANY.verifyUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700">search.cac.gov.ng</a>.
          </p>
          <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-slate-600">
            Questions about an agreement, an invoice or your school&apos;s data? <Link href="/demo" className="text-brand-700">Get in touch</Link>.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
