/**
 * The company behind Synergy Swift, exactly as registered with the Corporate Affairs
 * Commission (certificate of incorporation and status report, 2 November 2026).
 * One place for the footer, the company page, invoices and sales documents.
 * Only company details belong here, never the director's own (home address, phone, date of birth).
 */
export const COMPANY = {
  legalName: "Synergy Swift Technology Limited",
  brand: "Synergy Swift",
  rcNumber: "9979873",
  /** Company type as on the certificate. */
  type: "Private company limited by shares",
  incorporated: "2026-11-02",
  incorporatedLabel: "2 November 2026",
  law: "Companies and Allied Matters Act 2020",
  tin: "2622450931737",
  registeredAddress: ["23 Joseph Avenue", "Lekki", "Lagos State 105102", "Nigeria"],
  country: "Nigeria",
  /** CAC's public register: anyone can look the company up by its RC number. */
  verifyUrl: "https://search.cac.gov.ng/home"
} as const;

/** "Synergy Swift Technology Limited (RC 9979873)": for invoices, emails and documents. */
export const companyLine = `${COMPANY.legalName} (RC ${COMPANY.rcNumber})`;

/** One-line registered address. */
export const registeredAddress = COMPANY.registeredAddress.join(", ");
