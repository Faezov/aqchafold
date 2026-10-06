/** Already-derived review observation; the caller establishes unknown resolution. */
export type UnknownMerchantObservation = {
  readonly transactionId: string;
  readonly normalizedDescription: string;
};

/** Review grouping by text only, never a canonical Merchant identity. */
export type UnknownMerchantGroup = {
  readonly normalizedDescription: string;
  readonly transactionIds: readonly string[];
  readonly transactionCount: number;
};

/**
 * Group unknown observations by exact, case-sensitive derived descriptions.
 * Reject blank fields and globally duplicate transaction IDs; never transform text.
 * Sort descriptions and IDs by ordinary JS string ordering, without locale rules.
 * Freeze every output layer. No normalization, resolution, or persistence occurs.
 */
export function aggregateUnknownMerchantObservations(
  observations: readonly UnknownMerchantObservation[],
): readonly UnknownMerchantGroup[] {
  if (!Array.isArray(observations)) {
    throw new TypeError("Unknown merchant observations must be an array.");
  }
  const byDescription = new Map<string, string[]>();
  const seenTransactionIds = new Set<string>();

  for (const observation of observations) {
    if (typeof observation !== "object" || observation === null) {
      throw new TypeError("Unknown merchant observation must be an object.");
    }
    const { transactionId, normalizedDescription } = observation;
    if (
      typeof transactionId !== "string" ||
      transactionId.trim().length === 0
    ) {
      throw new TypeError(
        "Unknown merchant transaction ID must be a nonblank string.",
      );
    }
    if (
      typeof normalizedDescription !== "string" ||
      normalizedDescription.trim().length === 0
    ) {
      throw new TypeError(
        "Unknown merchant description must be a nonblank string.",
      );
    }
    if (seenTransactionIds.has(transactionId)) {
      throw new Error(
        "Duplicate transaction IDs are not allowed in unknown merchant observations.",
      );
    }
    seenTransactionIds.add(transactionId);
    const ids = byDescription.get(normalizedDescription);
    if (ids === undefined)
      byDescription.set(normalizedDescription, [transactionId]);
    else ids.push(transactionId);
  }

  const groups = [...byDescription]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([normalizedDescription, ids]) =>
      Object.freeze({
        normalizedDescription,
        transactionIds: Object.freeze(ids.sort()),
        transactionCount: ids.length,
      }),
    );
  return Object.freeze(groups);
}
