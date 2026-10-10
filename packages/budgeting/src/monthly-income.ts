import {
  Money,
  type Transaction,
  type TransactionIncomeClassification,
} from "@aqchafold/domain";

export type MonthlyIncomeTotal = {
  readonly month: string;
  readonly currency: string;
  readonly total: Money;
};

/**
 * Net signed activity explicitly classified as income, by posting month and
 * currency. Validate exact unique references before calculation. Reject unsafe
 * intermediate sums; zero-only activity creates no group, but cancellation does.
 * Freeze results sorted by month then currency using ordinary JS string order.
 */
export function calculateMonthlyIncome(
  transactions: readonly Transaction[],
  classifications: readonly TransactionIncomeClassification[],
): readonly MonthlyIncomeTotal[] {
  const transactionIds = new Set<string>();
  for (const transaction of transactions) {
    if (transactionIds.has(transaction.id)) {
      throw new Error("Monthly income requires unique Transaction IDs.");
    }
    transactionIds.add(transaction.id);
  }

  const decisions = new Map<string, TransactionIncomeClassification>();
  for (const decision of classifications) {
    if (decisions.has(decision.transactionId)) {
      throw new Error(
        "Monthly income requires unique classification Transaction IDs.",
      );
    }
    if (!transactionIds.has(decision.transactionId)) {
      throw new Error(
        "Income classifications must refer to supplied Transactions.",
      );
    }
    decisions.set(decision.transactionId, decision);
  }

  const groups = new Map<string, MonthlyIncomeTotal>();
  for (const transaction of transactions) {
    if (decisions.get(transaction.id)?.classification !== "income") continue;
    const { amountMinor, currency } = transaction.amount;
    if (amountMinor === 0) continue;

    const month = transaction.postingDate.slice(0, 7);
    const key = JSON.stringify([month, currency]);
    const group = groups.get(key) ?? {
      month,
      currency,
      total: new Money(0, currency),
    };
    const current = group.total.amountMinor;
    if (
      (amountMinor > 0 && current > Number.MAX_SAFE_INTEGER - amountMinor) ||
      (amountMinor < 0 && current < Number.MIN_SAFE_INTEGER - amountMinor)
    ) {
      throw new RangeError(
        "Monthly income total exceeds the safe integer range.",
      );
    }
    groups.set(key, { ...group, total: group.total.add(transaction.amount) });
  }

  return Object.freeze(
    [...groups.values()]
      .sort(compareTotals)
      .map((group) => Object.freeze(group)),
  );
}

function compareTotals(
  left: MonthlyIncomeTotal,
  right: MonthlyIncomeTotal,
): number {
  if (left.month !== right.month) return left.month < right.month ? -1 : 1;
  return left.currency < right.currency
    ? -1
    : left.currency > right.currency
      ? 1
      : 0;
}
