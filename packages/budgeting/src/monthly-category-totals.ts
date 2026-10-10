import { Money, type Transaction } from "@aqchafold/domain";

/** Raw balance-direction activity, without spending/income classification. */
export type MonthlyCategoryTotal = {
  readonly month: string;
  readonly categoryId?: string;
  readonly currency: string;
  readonly debitTotal: Money;
  readonly creditTotal: Money;
};

/**
 * Group canonical Transactions by posting month, exact Category reference, and
 * currency. Zero movements create no groups; debits and credits never net.
 * Sort by month, categorized IDs (uncategorized last), then currency, using
 * ordinary JS string ordering. Freeze the returned array and every result.
 */
export function calculateMonthlyCategoryTotals(
  transactions: readonly Transaction[],
): readonly MonthlyCategoryTotal[] {
  const groups = new Map<string, MonthlyCategoryTotal>();

  for (const transaction of transactions) {
    const { amountMinor, currency } = transaction.amount;
    if (amountMinor === 0) continue;

    const month = transaction.postingDate.slice(0, 7);
    const { categoryId } = transaction;
    // Tuple encoding avoids delimiter collisions in opaque Category IDs.
    const key = JSON.stringify([month, categoryId, currency]);
    const group = groups.get(key) ?? {
      month,
      ...(categoryId === undefined ? {} : { categoryId }),
      currency,
      debitTotal: new Money(0, currency),
      creditTotal: new Money(0, currency),
    };
    const field = amountMinor < 0 ? "debitTotal" : "creditTotal";
    const magnitude = amountMinor < 0 ? -amountMinor : amountMinor;
    if (group[field].amountMinor > Number.MAX_SAFE_INTEGER - magnitude) {
      throw new RangeError(
        "Monthly category total exceeds the safe integer range.",
      );
    }
    groups.set(key, {
      ...group,
      [field]: group[field].add(new Money(magnitude, currency)),
    });
  }

  return Object.freeze(
    [...groups.values()]
      .sort(compareTotals)
      .map((group) => Object.freeze(group)),
  );
}

function compareTotals(
  left: MonthlyCategoryTotal,
  right: MonthlyCategoryTotal,
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
