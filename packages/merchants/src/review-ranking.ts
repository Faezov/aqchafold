import {
  aggregateUnknownMerchantObservations,
  type UnknownMerchantGroup,
  type UnknownMerchantObservation,
} from "./unknown-aggregation";

/** Derived unknown review observation with canonical signed integer minor units. */
export type UnknownMerchantFinancialObservation = UnknownMerchantObservation & {
  readonly amountMinor: number;
  readonly currency: string;
};

/** Currency-scoped review group, never a canonical Merchant identity. */
export type RankedUnknownMerchantGroup = UnknownMerchantGroup & {
  readonly spendingMinor: number;
};

export type UnknownMerchantReviewQueue = {
  readonly currency: string;
  readonly groups: readonly RankedUnknownMerchantGroup[];
};

/**
 * Rank unknown review groups by canonical outflow, separately for each currency.
 * Credits/zero remain in counts but never reduce spending. Callers supply only
 * unknown observations; no normalization, resolution, or assignment occurs.
 */
export function rankUnknownMerchantReviewQueues(
  observations: readonly UnknownMerchantFinancialObservation[],
): readonly UnknownMerchantReviewQueue[] {
  // Validate text and transaction IDs globally before partitioning currencies.
  aggregateUnknownMerchantObservations(observations);
  const byCurrency = new Map<
    string,
    {
      observations: UnknownMerchantFinancialObservation[];
      spendingByDescription: Map<string, number>;
    }
  >();

  for (const observation of observations) {
    const { amountMinor, currency, normalizedDescription } = observation;
    if (!Number.isSafeInteger(amountMinor)) {
      throw new RangeError(
        "Review amount must be a safe integer in minor units.",
      );
    }
    if (
      typeof currency !== "string" ||
      currency.length !== 3 ||
      !/^[A-Z]{3}$/.test(currency)
    ) {
      throw new TypeError(
        "Review currency must be three uppercase ASCII letters.",
      );
    }

    let queue = byCurrency.get(currency);
    if (queue === undefined) {
      queue = { observations: [], spendingByDescription: new Map() };
      byCurrency.set(currency, queue);
    }
    const previous =
      queue.spendingByDescription.get(normalizedDescription) ?? 0;
    const contribution = amountMinor < 0 ? -amountMinor : 0;
    if (previous > Number.MAX_SAFE_INTEGER - contribution) {
      throw new RangeError(
        "Unknown merchant spending exceeds the safe integer range.",
      );
    }
    queue.spendingByDescription.set(
      normalizedDescription,
      previous + contribution,
    );
    queue.observations.push(observation);
  }

  const queues = [...byCurrency]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([currency, queue]) => {
      const groups = aggregateUnknownMerchantObservations(queue.observations)
        .map((group) =>
          Object.freeze({
            ...group,
            spendingMinor:
              queue.spendingByDescription.get(group.normalizedDescription) ?? 0,
          }),
        )
        .sort(
          (left, right) =>
            right.spendingMinor - left.spendingMinor ||
            right.transactionCount - left.transactionCount ||
            (left.normalizedDescription < right.normalizedDescription
              ? -1
              : left.normalizedDescription > right.normalizedDescription
                ? 1
                : 0),
        );
      return Object.freeze({ currency, groups: Object.freeze(groups) });
    });
  return Object.freeze(queues);
}
