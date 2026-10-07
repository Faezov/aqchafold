import { Account, Money, Transaction } from "@aqchafold/domain";
import { describe, expect, it, vi } from "vitest";
import { buildMerchantReviewQueues } from "./merchant-review-data";

const accounts = Object.freeze([
  account("account-one", "household-one", "AUD"),
  account("account-two", "household-two", "AUD"),
  account("account-usd", "household-one", "USD"),
]);

function account(id: string, householdId: string, primaryCurrency: string) {
  return new Account({
    id,
    householdId,
    primaryCurrency,
    label: "Synthetic Account",
    type: "transaction",
    status: "active",
    ownership: { kind: "unknown" },
  });
}

function transaction(
  id: string,
  rawDescription: string,
  amountMinor = -100,
  options: {
    accountId?: string;
    currency?: string;
    merchantId?: string;
  } = {},
) {
  return new Transaction({
    id,
    rawDescription,
    accountId: options.accountId ?? "account-one",
    amount: new Money(amountMinor, options.currency ?? "AUD"),
    merchantId: options.merchantId,
    postingDate: "2026-01-01",
    origin: "imported",
  });
}

const noRule = () => undefined;

describe("read-only Merchant review data", () => {
  it("includes an unresolved imported Transaction without inventing identity", () => {
    expect(
      buildMerchantReviewQueues({
        transactions: [transaction("one", "Synthetic Shop")],
        accounts,
        findConfirmedMerchantId: noRule,
      }),
    ).toEqual([
      {
        currency: "AUD",
        groups: [
          {
            normalizedDescription: "Synthetic Shop",
            transactionIds: ["one"],
            transactionCount: 1,
            spendingMinor: 100,
          },
        ],
      },
    ]);
  });

  it("excludes an existing Merchant association without consulting a rule", () => {
    const lookup = vi.fn(noRule);
    expect(
      buildMerchantReviewQueues({
        transactions: [
          transaction("one", "Synthetic Shop", -100, {
            merchantId: "confirmed-identity",
          }),
        ],
        accounts: [],
        findConfirmedMerchantId: lookup,
      }),
    ).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("normalizes the exact rule key and applies it only in its Account Household", () => {
    const lookup = vi.fn((householdId: string, description: string) =>
      householdId === "household-one" && description === "MiXeD Café!"
        ? "confirmed-identity"
        : undefined,
    );
    const queues = buildMerchantReviewQueues({
      transactions: [
        transaction("resolved", " \nSQ * MiXeD   Café! \t"),
        transaction("other-household", "PAYPAL *MiXeD Café!", -200, {
          accountId: "account-two",
        }),
        transaction("different-case", "mixed café!"),
      ],
      accounts,
      findConfirmedMerchantId: lookup,
    });
    expect(lookup.mock.calls).toEqual([
      ["household-one", "MiXeD Café!"],
      ["household-two", "MiXeD Café!"],
      ["household-one", "mixed café!"],
    ]);
    expect(queues[0].groups.map((group) => group.transactionIds)).toEqual([
      ["other-household"],
      ["different-case"],
    ]);
  });

  it("omits empty candidates and manual Transactions without source text", () => {
    const lookup = vi.fn(noRule);
    const manual = new Transaction({
      id: "manual",
      accountId: "account-one",
      postingDate: "2026-01-01",
      amount: new Money(-100, "AUD"),
      origin: "manual",
    });
    expect(
      buildMerchantReviewQueues({
        transactions: [
          ...["", " \t\n", "SQ *", "PAYPAL * "].map((text, index) =>
            transaction(`empty-${index}`, text),
          ),
          manual,
        ],
        accounts,
        findConfirmedMerchantId: lookup,
      }),
    ).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
    expect(manual.rawDescription).toBeUndefined();
  });

  it("preserves currency-scoped ranking, credit/zero counts, and outflow totals", () => {
    const queues = buildMerchantReviewQueues({
      transactions: [
        transaction("z", "Shop Z", -200),
        transaction("high", "Shop High", -300),
        transaction("b", "Shop B", -200),
        transaction("a-debit", "Shop A", -200),
        transaction("a-credit", "Shop A", 900),
        transaction("a-zero", "Shop A", 0),
        transaction("usd", "Shop A", -99999, {
          accountId: "account-usd",
          currency: "USD",
        }),
      ],
      accounts,
      findConfirmedMerchantId: noRule,
    });
    expect(queues.map((queue) => queue.currency)).toEqual(["AUD", "USD"]);
    expect(
      queues[0].groups.map((group) => [
        group.normalizedDescription,
        group.spendingMinor,
        group.transactionCount,
      ]),
    ).toEqual([
      ["Shop High", 300, 1],
      ["Shop A", 200, 3],
      ["Shop B", 200, 1],
      ["Shop Z", 200, 1],
    ]);
    expect(queues[1].groups[0].spendingMinor).toBe(99999);
  });

  it("preserves frozen source values across repeated read-only builds", () => {
    const rawDescription = "  PAYPAL *MiXeD\nCafé! 東京  ";
    const source = transaction("source", rawDescription, -1234);
    const transactions = Object.freeze([source]);
    const snapshots = { ...source };
    const input = Object.freeze({
      transactions,
      accounts,
      findConfirmedMerchantId: noRule,
    });
    const first = buildMerchantReviewQueues(input);
    expect(buildMerchantReviewQueues(input)).toEqual(first);
    expect(source).toEqual(snapshots);
    expect(source.rawDescription).toBe(rawDescription);
    expect(source.merchantId).toBeUndefined();
    expect(source.categoryId).toBeUndefined();
    expect(first[0].groups[0].normalizedDescription).toBe("MiXeD Café! 東京");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0].groups)).toBe(true);
  });

  it("rejects missing Account context with a fixed error, without source details", () => {
    const lookup = vi.fn(noRule);
    expect(() =>
      buildMerchantReviewQueues({
        transactions: [transaction("private-id", "private source")],
        accounts: [],
        findConfirmedMerchantId: lookup,
      }),
    ).toThrow("Merchant review requires the associated Account.");
    expect(lookup).not.toHaveBeenCalled();
  });
});
