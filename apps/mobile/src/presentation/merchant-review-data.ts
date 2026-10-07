import type { Account, Transaction } from "@aqchafold/domain";
import {
  normalizePaymentProcessorPrefix,
  rankUnknownMerchantReviewQueues,
  resolveMerchantIdentity,
  type UnknownMerchantFinancialObservation,
  type UnknownMerchantReviewQueue,
} from "@aqchafold/merchants";

/** Read-only orchestration; confirmed identities come from Household-scoped lookup. */
export function buildMerchantReviewQueues(input: {
  readonly transactions: readonly Transaction[];
  readonly accounts: readonly Account[];
  readonly findConfirmedMerchantId: (
    householdId: string,
    normalizedDescription: string,
  ) => string | undefined;
}): readonly UnknownMerchantReviewQueue[] {
  const householdByAccount = new Map(
    input.accounts.map((account) => [account.id, account.householdId]),
  );
  const observations: UnknownMerchantFinancialObservation[] = [];
  for (const transaction of input.transactions) {
    // A historical association is already resolved without requiring a rule.
    if (
      transaction.merchantId !== undefined ||
      transaction.rawDescription === undefined
    ) {
      continue;
    }
    const { normalizedDescription } = normalizePaymentProcessorPrefix(
      transaction.rawDescription,
    );
    if (normalizedDescription === "") continue;

    const householdId = householdByAccount.get(transaction.accountId);
    if (householdId === undefined) {
      throw new Error("Merchant review requires the associated Account.");
    }
    const resolution = resolveMerchantIdentity({
      confirmedMerchantId: input.findConfirmedMerchantId(
        householdId,
        normalizedDescription,
      ),
    });
    if (resolution.status !== "unknown") continue;
    observations.push({
      transactionId: transaction.id,
      normalizedDescription,
      amountMinor: transaction.amount.amountMinor,
      currency: transaction.amount.currency,
    });
  }
  return rankUnknownMerchantReviewQueues(observations);
}
