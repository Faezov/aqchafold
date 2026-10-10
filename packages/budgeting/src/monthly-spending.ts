import {
  Money,
  type Transaction,
  type TransactionSpendingClassification,
} from "@aqchafold/domain";

export type MonthlySpendingTotal = {
  readonly month: string;
  readonly categoryId?: string;
  readonly currency: string;
  readonly total: Money;
};

/**
 * Net explicitly classified spending: each contribution negates the canonical
 * amount. Group by posting month, exact Category reference (or absence), and
 * currency. Reject unsafe intermediate sums; retain nonzero activity cancelling
 * to zero. Freeze results sorted by month, Category (uncategorized last), then
 * currency using ordinary JS string order. Only spending evidence is consumed.
 */
export function calculateMonthlySpending(
  transactions: readonly Transaction[],
  classifications: readonly TransactionSpendingClassification[],
): readonly MonthlySpendingTotal[] {
  const transactionIds = new Set<string>();
  for (const transaction of transactions) {
    if (transactionIds.has(transaction.id)) {
      throw new Error("Monthly spending requires unique Transaction IDs.");
    }
    transactionIds.add(transaction.id);
  }

  const decisions = new Map<string, TransactionSpendingClassification>();
  for (const decision of classifications) {
    if (decisions.has(decision.transactionId)) {
      throw new Error(
        "Monthly spending requires unique classification Transaction IDs.",
      );
    }
    if (!transactionIds.has(decision.transactionId)) {
      throw new Error(
        "Spending classifications must refer to supplied Transactions.",
      );
    }
    decisions.set(decision.transactionId, decision);
  }

  const groups = new Map<string, MonthlySpendingTotal>();
  for (const transaction of transactions) {
    if (decisions.get(transaction.id)?.classification !== "spending") continue;
    const { amountMinor, currency } = transaction.amount;
    if (amountMinor === 0) continue;

    const month = transaction.postingDate.slice(0, 7);
    const { categoryId } = transaction;
    // Tuple encoding preserves opaque Category IDs without delimiter collisions.
    const key = JSON.stringify([month, categoryId, currency]);
    const group = groups.get(key) ?? {
      month,
      ...(categoryId === undefined ? {} : { categoryId }),
      currency,
      total: new Money(0, currency),
    };
    const contribution = -amountMinor;
    const current = group.total.amountMinor;
    if (
      (contribution > 0 && current > Number.MAX_SAFE_INTEGER - contribution) ||
      (contribution < 0 && current < Number.MIN_SAFE_INTEGER - contribution)
    ) {
      throw new RangeError(
        "Monthly spending total exceeds the safe integer range.",
      );
    }
    groups.set(key, {
      ...group,
      total: group.total.subtract(transaction.amount),
    });
  }

  return Object.freeze(
    [...groups.values()]
      .sort(compareTotals)
      .map((group) => Object.freeze(group)),
  );
}

function compareTotals(
  left: MonthlySpendingTotal,
  right: MonthlySpendingTotal,
): number {
  if (left.month !== right.month) return left.month < right.month ? -1 : 1;
  if (left.categoryId !== right.categoryId) {
    if (left.categoryId === undefined) return 1;
    if (right.categoryId === undefined) return -1;
    return left.categoryId < right.categoryId ? -1 : 1;
  }
  return left.currency < right.currency
    ? -1
    : left.currency > right.currency
      ? 1
      : 0;
}
