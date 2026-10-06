/** Derived text candidate, never a Merchant identity or Category assignment. */
export type MerchantNormalizationResult = {
  /**
   * Trim surrounding ECMAScript whitespace and collapse internal whitespace runs
   * to one ASCII space. Preserve case, accents, and punctuation in retained text.
   * May be empty when no candidate text remains; never invent a placeholder.
   */
  readonly normalizedDescription: string;
};

/**
 * Pure, deterministic, synchronous textual normalization, independent of banks,
 * persistence, and platforms. Accept only a description string, not a Transaction.
 * Empty and whitespace-only input produce an empty normalizedDescription.
 *
 * The caller retains rawDescription as immutable source evidence. Never overwrite
 * Transaction.rawDescription or assign a Merchant/Category from this result.
 * Later steps may consume normalizedDescription as derived text; it is not new
 * source evidence. No implementation or transformation pipeline is defined here.
 */
export interface MerchantDescriptionNormalizer {
  (rawDescription: string): MerchantNormalizationResult;
}
