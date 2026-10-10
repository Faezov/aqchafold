import {
  Account,
  Category,
  Merchant,
  Money,
  Transaction,
} from "@aqchafold/domain";
import { describe, expect, it } from "vitest";
import { addReviewCategoryState } from "./merchant-review-categories";
import { buildMerchantReviewQueues } from "./merchant-review-data";

const active = new Category({
  id: "category-active",
  name: "Synthetic purpose",
  status: "active",
});
const other = new Category({
  id: "category-other",
  name: "Other purpose",
  status: "active",
});
const archived = new Category({
  id: "category-archived",
  name: "Archived purpose",
  status: "archived",
});
const categories = [active, other, archived];
const merchant = new Merchant({
  id: "canonical-merchant",
  displayName: "Canonical Shop",
});
const accounts = [
  account("aud", "household", "AUD"),
  account("usd", "household", "USD"),
  account("another", "another-household", "AUD"),
];

function account(id: string, householdId: string, currency: string) {
  return new Account({
    id,
    householdId,
    label: "Synthetic account",
    type: "transaction",
    status: "active",
    primaryCurrency: currency,
    ownership: { kind: "unknown" },
  });
}

function transaction(
  id: string,
  categoryId?: string,
  options: {
    accountId?: string;
    currency?: string;
    merchantId?: string;
    rawDescription?: string;
  } = {},
) {
  return new Transaction({
    id,
    categoryId,
    accountId: options.accountId ?? "aud",
    amount: new Money(-100, options.currency ?? "AUD"),
    postingDate: "2400-03-01",
    origin: "imported",
    rawDescription: options.rawDescription ?? "Synthetic Shop",
    merchantId: options.merchantId,
  });
}

function queues(transactions: readonly Transaction[]) {
  return buildMerchantReviewQueues({
    transactions,
    accounts,
    findConfirmedMerchantId: () => undefined,
    findMerchantById: () => merchant,
  });
}

function review(
  transactions: readonly Transaction[],
  availableCategories: readonly Category[] = categories,
) {
  return addReviewCategoryState({
    queues: queues(transactions),
    transactions,
    categories: availableCategories,
  });
}

describe("Merchant review category presentation", () => {
  it("represents uncategorized groups without requiring persisted Categories", () => {
    expect(
      review([transaction("one"), transaction("two")], [])[0].groups[0]
        .categoryState,
    ).toEqual({ kind: "uncategorized" });
    expect(review([], [])).toEqual([]);
  });

  it("retains the canonical Category and name when every Transaction has the same ID", () => {
    const group = review([
      transaction("one", active.id),
      transaction("two", active.id),
    ])[0].groups[0];
    expect(group.categoryState).toEqual({
      kind: "categorized",
      category: active,
    });
    if (group.categoryState.kind !== "categorized")
      throw new Error("Expected a uniform Category.");
    expect(group.categoryState.category).toBe(active);
    expect(group.categoryState.category.name).toBe("Synthetic purpose");
  });

  it.each([
    [active.id, other.id],
    [undefined, active.id],
    [active.id, undefined],
  ])(
    "represents different category states %j / %j as mixed",
    (first, second) => {
      expect(
        review([transaction("one", first), transaction("two", second)])[0]
          .groups[0].categoryState,
      ).toEqual({ kind: "mixed" });
    },
  );

  it("uses Category identity rather than equal display names to determine uniformity", () => {
    const sameName = new Category({
      id: "another-category-id",
      name: active.name,
      status: "active",
    });
    expect(
      review(
        [transaction("one", active.id), transaction("two", sameName.id)],
        [active, sameName],
      )[0].groups[0].categoryState,
    ).toEqual({ kind: "mixed" });
  });

  it("keeps an archived current Category readable by its canonical name", () => {
    expect(
      review([transaction("one", archived.id)])[0].groups[0].categoryState,
    ).toEqual({ kind: "categorized", category: archived });
  });

  it("derives state only from each exact group, excluding history and other currency/Household groups", () => {
    const result = review([
      transaction("pending"),
      transaction("history", archived.id, { merchantId: merchant.id }),
      transaction("usd-pending", active.id, {
        accountId: "usd",
        currency: "USD",
      }),
      transaction("another-pending", archived.id, { accountId: "another" }),
      transaction("other-group", other.id, { rawDescription: "Other Shop" }),
    ]);
    const main = result.find(
      (queue) => queue.householdId === "household" && queue.currency === "AUD",
    )!;
    expect(
      main.groups.find((group) => group.transactionIds.includes("pending")),
    ).toMatchObject({
      status: "suggested",
      merchantId: merchant.id,
      transactionIds: ["pending"],
      categoryState: { kind: "uncategorized" },
    });
    expect(
      main.groups.find((group) => group.transactionIds.includes("other-group")),
    ).toMatchObject({
      categoryState: { kind: "categorized", category: other },
    });
    expect(
      result.find((queue) => queue.currency === "USD")!.groups[0].categoryState,
    ).toEqual({ kind: "categorized", category: active });
    expect(
      result.find((queue) => queue.householdId === "another-household")!
        .groups[0].categoryState,
    ).toEqual({ kind: "categorized", category: archived });
  });

  it("preserves merchant fields, order, immutable snapshots and source Transactions", () => {
    const transactions = [
      transaction("one", active.id),
      transaction("other", other.id, { rawDescription: "Another Shop" }),
      transaction("history", archived.id, { merchantId: merchant.id }),
    ];
    const before = transactions.map((source) => ({ ...source }));
    const base = queues(transactions);
    const result = addReviewCategoryState({
      queues: base,
      transactions,
      categories,
    });
    expect(
      result.map((queue) => ({
        ...queue,
        groups: queue.groups.map(
          ({ categoryState: _categoryState, ...group }) => group,
        ),
      })),
    ).toEqual(base);
    expect(transactions).toEqual(before);
    expect(base[0].groups[0]).not.toHaveProperty("categoryState");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(Object.isFrozen(result[0].groups)).toBe(true);
    for (const group of result[0].groups) {
      expect(Object.isFrozen(group)).toBe(true);
      expect(Object.isFrozen(group.categoryState)).toBe(true);
      expect(group.transactionIds).toBe(
        base[0].groups.find(
          (item) => item.normalizedDescription === group.normalizedDescription,
        )!.transactionIds,
      );
    }
    expect(
      addReviewCategoryState({
        queues: base,
        transactions: [...transactions].reverse(),
        categories: [...categories].reverse(),
      }),
    ).toEqual(result);
  });

  it("rejects missing Transaction evidence instead of presenting it as uncategorized", () => {
    const sources = [transaction("sensitive-source-id", active.id)];
    expect(() =>
      addReviewCategoryState({
        queues: queues(sources),
        transactions: [],
        categories,
      }),
    ).toThrow("Merchant review requires valid category source data.");
  });

  it("rejects a missing Category even when the group would otherwise be mixed", () => {
    const sources = [
      transaction("one", "sensitive-category-id"),
      transaction("two"),
    ];
    expect(() => review(sources)).toThrow(
      "Merchant review requires valid category source data.",
    );
  });

  it("rejects duplicate Transaction or Category source IDs without exposing them", () => {
    const source = transaction("sensitive-source-id");
    const base = queues([source]);
    for (const input of [
      { queues: base, transactions: [source, source], categories },
      { queues: base, transactions: [source], categories: [active, active] },
      {
        queues: [
          {
            ...base[0],
            groups: [
              { ...base[0].groups[0], transactionIds: [source.id, source.id] },
            ],
          },
        ],
        transactions: [source],
        categories,
      },
      {
        queues: [
          {
            ...base[0],
            groups: [{ ...base[0].groups[0], transactionIds: [] }],
          },
        ],
        transactions: [source],
        categories,
      },
    ]) {
      expect(() => addReviewCategoryState(input)).toThrow(
        "Merchant review requires valid category source data.",
      );
    }
  });
});
