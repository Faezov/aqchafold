import type { Account, Merchant, Transaction } from "@aqchafold/domain";
import {
  normalizeMerchantDescription,
  rankUnknownMerchantReviewQueues,
  resolveMerchantIdentity,
  type MerchantResolution,
  type RankedUnknownMerchantGroup,
  type UnknownMerchantFinancialObservation,
} from "@aqchafold/merchants";

type ReviewCandidate =
  | (Extract<MerchantResolution, { status: "unknown" }> & {
      readonly displayName?: never;
    })
  | (Extract<MerchantResolution, { status: "suggested" }> & {
      readonly displayName: string;
    });

export type MerchantReviewGroup = RankedUnknownMerchantGroup & ReviewCandidate;

/** Internal Household context for each currency queue; never rendered as an ID. */
export type MerchantReviewQueue = {
  readonly householdId: string;
  readonly currency: string;
  readonly groups: readonly MerchantReviewGroup[];
};

type ReviewDataInput = {
  readonly transactions: readonly Transaction[];
  readonly accounts: readonly Account[];
  readonly findConfirmedMerchantId: (
    householdId: string,
    normalizedDescription: string,
  ) => string | undefined;
  readonly findMerchantById: (merchantId: string) => Merchant | undefined;
};

/** Read-only review orchestration; suggestions use existing historical associations. */
export function buildMerchantReviewQueues(
  input: ReviewDataInput,
): readonly MerchantReviewQueue[] {
  const householdByAccount = new Map(
    input.accounts.map((account) => [account.id, account.householdId]),
  );
  const seenTransactionIds = new Set<string>();
  const byHousehold = new Map<
    string,
    {
      history: Map<string, Set<string>>;
      observations: UnknownMerchantFinancialObservation[];
    }
  >();

  for (const transaction of input.transactions) {
    if (seenTransactionIds.has(transaction.id)) {
      throw new Error("Merchant review requires unique Transaction IDs.");
    }
    seenTransactionIds.add(transaction.id);
    if (transaction.rawDescription === undefined) continue;
    const { normalizedDescription } = normalizeMerchantDescription(
      transaction.rawDescription,
    );
    if (normalizedDescription === "") continue;

    const householdId = householdByAccount.get(transaction.accountId);
    if (householdId === undefined) {
      throw new Error("Merchant review requires the associated Account.");
    }
    let household = byHousehold.get(householdId);
    if (household === undefined) {
      household = { history: new Map(), observations: [] };
      byHousehold.set(householdId, household);
    }
    if (transaction.merchantId !== undefined) {
      let ids = household.history.get(normalizedDescription);
      if (ids === undefined) {
        ids = new Set();
        household.history.set(normalizedDescription, ids);
      }
      ids.add(transaction.merchantId);
      continue; // Evidence only: exclude its amount and count from review.
    }
    household.observations.push({
      transactionId: transaction.id,
      normalizedDescription,
      amountMinor: transaction.amount.amountMinor,
      currency: transaction.amount.currency,
    });
  }

  const queues: MerchantReviewQueue[] = [];
  const households = [...byHousehold].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  for (const [householdId, household] of households) {
    const candidates = new Map<string, ReviewCandidate>();
    const descriptions = new Set(
      household.observations.map(
        (observation) => observation.normalizedDescription,
      ),
    );
    for (const description of descriptions) {
      const resolution = resolveReviewDescription(
        input,
        householdId,
        description,
        household.history.get(description),
      );
      if (resolution.status !== "confirmed")
        candidates.set(description, resolution);
    }
    const observations = household.observations.filter((observation) =>
      candidates.has(observation.normalizedDescription),
    );
    // Reuse identity-free financial ranking, then attach unconfirmed review state.
    for (const queue of rankUnknownMerchantReviewQueues(observations)) {
      const groups = queue.groups.map((group) =>
        Object.freeze({
          ...group,
          // Every ranked observation has a candidate entry from the filter above.
          ...candidates.get(group.normalizedDescription)!,
        }),
      );
      queues.push(
        Object.freeze({
          householdId,
          currency: queue.currency,
          groups: Object.freeze(groups),
        }),
      );
    }
  }
  return Object.freeze(queues);
}

function resolveReviewDescription(
  input: ReviewDataInput,
  householdId: string,
  normalizedDescription: string,
  historicalIds: ReadonlySet<string> | undefined,
): Extract<MerchantResolution, { status: "confirmed" }> | ReviewCandidate {
  const confirmedMerchantId = input.findConfirmedMerchantId(
    householdId,
    normalizedDescription,
  );
  // Confirmation short-circuits even conflicting or invalid historical evidence.
  const suggestedMerchantId =
    confirmedMerchantId === undefined && historicalIds?.size === 1
      ? historicalIds.values().next().value
      : undefined;
  const resolution = resolveMerchantIdentity({
    confirmedMerchantId,
    suggestedMerchantId,
  });
  if (resolution.status !== "suggested") return resolution;
  const merchant = input.findMerchantById(resolution.merchantId);
  if (
    merchant === undefined ||
    merchant.id !== resolution.merchantId ||
    typeof merchant.displayName !== "string" ||
    merchant.displayName.trim().length === 0
  ) {
    throw new Error("Merchant review requires an existing canonical Merchant.");
  }
  return Object.freeze({ ...resolution, displayName: merchant.displayName });
}
