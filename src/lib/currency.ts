/** Currencies a school can use. Paystack takes NGN, GHS, KES, ZAR and USD; Flutterwave also takes GBP and EUR. */
export const CURRENCIES: [string, string][] = [
  ["NGN", "Nigerian naira (₦)"], ["GHS", "Ghanaian cedi (GH₵)"], ["KES", "Kenyan shilling (KSh)"], ["ZAR", "South African rand (R)"],
  ["XOF", "West African CFA franc"], ["USD", "US dollar ($)"], ["GBP", "Pound sterling (£)"], ["EUR", "Euro (€)"]
];
export const PAYSTACK_CURRENCIES = ["NGN", "GHS", "KES", "ZAR", "USD"];
