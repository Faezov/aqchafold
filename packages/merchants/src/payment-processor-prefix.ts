import type { MerchantDescriptionNormalizer } from "./normalization";

/**
 * Normalize whitespace, then remove one leading SQ * or PAYPAL * wrapper.
 * Tokens match ASCII case-insensitively; whitespace before * is required and
 * whitespace after it is optional. Retained text remains a derived candidate.
 */
export const normalizePaymentProcessorPrefix: MerchantDescriptionNormalizer = (
  rawDescription,
) => {
  const description = rawDescription.replace(/\s+/g, " ").trim();
  return {
    normalizedDescription: description.replace(/^(?:SQ|PAYPAL) \* ?/i, ""),
  };
};
