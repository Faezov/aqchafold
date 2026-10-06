/** Explicit identity mapping for already-normalized text, not a normalization rule. */
export type MerchantAlias = {
  readonly normalizedDescription: string;
  readonly merchantId: string;
};

/**
 * Pure, synchronous exact lookup; returns only an opaque Merchant ID.
 * Validate the whole supplied collection before lookup, including empty queries.
 * Blank fields throw TypeError; conflicting IDs for one exact key throw Error.
 * Identical duplicates are allowed. No strings or source records are transformed.
 */
export function resolveMerchantAlias(
  normalizedDescription: string,
  aliases: readonly MerchantAlias[],
): string | undefined {
  const byDescription = new Map<string, string>();

  for (const alias of aliases) {
    if (
      typeof alias.normalizedDescription !== "string" ||
      alias.normalizedDescription.trim().length === 0
    ) {
      throw new TypeError(
        "Merchant alias description must be a nonblank string.",
      );
    }
    if (
      typeof alias.merchantId !== "string" ||
      alias.merchantId.trim().length === 0
    ) {
      throw new TypeError("Merchant alias ID must be a nonblank string.");
    }

    const existingId = byDescription.get(alias.normalizedDescription);
    if (existingId !== undefined && existingId !== alias.merchantId) {
      throw new Error("Conflicting Merchant IDs for an alias description.");
    }
    byDescription.set(alias.normalizedDescription, alias.merchantId);
  }

  return byDescription.get(normalizedDescription);
}
