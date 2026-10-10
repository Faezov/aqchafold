import type { MerchantDescriptionNormalizer } from "./normalization";

/** Remove only the evidenced terminal date line, before collapsing whitespace. */
export const normalizeStatementMetadataSuffix: MerchantDescriptionNormalizer = (
  rawDescription,
) => {
  // Check the real end explicitly: JavaScript's $ also matches before a final LF.
  const suffix = /\r?\nValue Date ([0-9]{2})\/([0-9]{2})\/([0-9]{4})$/.exec(
    rawDescription,
  );
  let retained = rawDescription;
  if (
    suffix &&
    suffix.index + suffix[0].length === rawDescription.length &&
    rawDescription.slice(0, suffix.index).trim() !== "" &&
    isGregorianDate(Number(suffix[1]), Number(suffix[2]), Number(suffix[3]))
  ) {
    retained = rawDescription.slice(0, suffix.index);
  }
  return { normalizedDescription: retained.replace(/\s+/g, " ").trim() };
};

function isGregorianDate(day: number, month: number, year: number): boolean {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}
