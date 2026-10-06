/** AUD-only two-decimal display; other currencies retain exact minor units. */
export function formatTransactionAmount(
  amountMinor: number,
  currency: string,
): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError("Transaction amount must be a safe integer.");
  }
  const sign = amountMinor < 0 ? "-" : amountMinor > 0 ? "+" : "";
  const digits = String(amountMinor).replace(/^-/, "");
  if (currency !== "AUD") return `${currency} ${sign}${digits} minor units`;

  const padded = digits.padStart(3, "0");
  return `${currency} ${sign}${padded.slice(0, -2)}.${padded.slice(-2)}`;
}
