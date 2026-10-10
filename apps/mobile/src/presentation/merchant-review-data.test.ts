import { Account, Merchant, Money, Transaction } from "@aqchafold/domain";
import { describe, expect, it, vi } from "vitest";
import { buildMerchantReviewQueues } from "./merchant-review-data";

const accounts = Object.freeze([
  account("account-one", "household-one", "AUD"),
  account("account-two", "household-two", "AUD"),
  account("account-usd", "household-one", "USD"),
]);
const canonicalMerchant = new Merchant({
  id: "merchant-one",
  displayName: "Canonical Café!",
});

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
const noMerchant = () => undefined;
const findMerchant = (id: string) =>
  id === canonicalMerchant.id ? canonicalMerchant : undefined;

function review(
  transactions: readonly Transaction[],
  reads: Partial<
    Omit<Parameters<typeof buildMerchantReviewQueues>[0], "transactions">
  > = {},
) {
  return buildMerchantReviewQueues({
    transactions,
    accounts,
    findConfirmedMerchantId: noRule,
    findMerchantById: noMerchant,
    ...reads,
  });
}

function history(
  id = "history",
  options: Parameters<typeof transaction>[3] = {},
) {
  return transaction(id, "SQ * Synthetic Shop", -9000, {
    merchantId: canonicalMerchant.id,
    ...options,
  });
}

describe("read-only Merchant review data", () => {
  it("includes an unresolved imported Transaction without inventing identity", () => {
    expect(review([transaction("one", "Synthetic Shop")])).toEqual([
      {
        householdId: "household-one",
        currency: "AUD",
        groups: [
          {
            normalizedDescription: "Synthetic Shop",
            transactionIds: ["one"],
            transactionCount: 1,
            spendingMinor: 100,
            status: "unknown",
          },
        ],
      },
    ]);
  });

  it.each(["\n", "\r\n"])(
    "groups terminal metadata with the retained description using %j line endings",
    (lineEnding) => {
      const queues = review([
        transaction("plain", "Synthetic Shop"),
        transaction(
          "metadata",
          `SQ * Synthetic   Shop${lineEnding}Value Date 29/02/2400`,
        ),
      ]);
      expect(queues).toHaveLength(1);
      expect(queues[0].groups).toEqual([
        {
          normalizedDescription: "Synthetic Shop",
          transactionIds: ["metadata", "plain"],
          transactionCount: 2,
          spendingMinor: 200,
          status: "unknown",
        },
      ]);
    },
  );

  it.each(["Value Date 31/02/2400", "Value Date 1/01/2400"])(
    "preserves malformed metadata %j instead of matching retained history",
    (metadata) => {
      const queues = review(
        [transaction("pending", `SQ * Synthetic Shop\n${metadata}`), history()],
        { findMerchantById: findMerchant },
      );
      expect(queues[0].groups[0]).toMatchObject({
        normalizedDescription: `Synthetic Shop ${metadata}`,
        transactionIds: ["pending"],
        status: "unknown",
      });
    },
  );

  it("excludes associated Transactions themselves without looking up rules or candidates", () => {
    const rule = vi.fn(noRule);
    const merchant = vi.fn(findMerchant);
    expect(
      review([history()], {
        findConfirmedMerchantId: rule,
        findMerchantById: merchant,
      }),
    ).toEqual([]);
    expect(rule).not.toHaveBeenCalled();
    expect(merchant).not.toHaveBeenCalled();
  });

  it("keeps equal descriptions and currencies separate across Households", () => {
    const queues = review([
      transaction("two", "Synthetic Shop\nValue Date 01/03/2400", -300, {
        accountId: "account-two",
      }),
      transaction("one", "Synthetic Shop\nValue Date 29/02/2400", -100),
    ]);
    expect(queues.map((queue) => [queue.householdId, queue.currency])).toEqual([
      ["household-one", "AUD"],
      ["household-two", "AUD"],
    ]);
    expect(queues.map((queue) => queue.groups[0].transactionIds)).toEqual([
      ["one"],
      ["two"],
    ]);
    expect(queues.map((queue) => queue.groups[0].spendingMinor)).toEqual([
      100, 300,
    ]);
  });

  it("normalizes the exact rule key and applies it only in its Account Household", () => {
    const lookup = vi.fn((householdId: string, description: string) =>
      householdId === "household-one" && description === "MiXeD Café!"
        ? "confirmed-identity"
        : undefined,
    );
    const queues = review(
      [
        transaction(
          "resolved",
          " \nSQ * MiXeD   Café! \t\nValue Date 29/02/2400",
        ),
        transaction(
          "other-household",
          "PAYPAL *MiXeD Café!\nValue Date 01/03/2400",
          -200,
          { accountId: "account-two" },
        ),
        transaction("different-case", "mixed café!"),
      ],
      { findConfirmedMerchantId: lookup },
    );
    expect(lookup.mock.calls).toEqual(
      expect.arrayContaining([
        ["household-one", "MiXeD Café!"],
        ["household-two", "MiXeD Café!"],
        ["household-one", "mixed café!"],
      ]),
    );
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(queues.map((queue) => queue.groups[0].transactionIds)).toEqual([
      ["different-case"],
      ["other-household"],
    ]);
  });

  it("suggests an existing canonical Merchant from one exact normalized historical association", () => {
    const lookup = vi.fn(findMerchant);
    const queues = review(
      [
        transaction(
          "pending",
          " PAYPAL * Synthetic   Shop \nValue Date 01/03/2400",
        ),
        transaction(
          "history",
          "SQ * Synthetic Shop\r\nValue Date 29/02/2400",
          -9000,
          {
            merchantId: canonicalMerchant.id,
          },
        ),
      ],
      { findMerchantById: lookup },
    );
    expect(queues[0].groups[0]).toEqual({
      normalizedDescription: "Synthetic Shop",
      transactionIds: ["pending"],
      transactionCount: 1,
      spendingMinor: 100,
      status: "suggested",
      merchantId: canonicalMerchant.id,
      displayName: canonicalMerchant.displayName,
    });
    expect(lookup).toHaveBeenCalledWith(canonicalMerchant.id);
  });

  it("treats several agreeing historical associations as one candidate", () => {
    const queues = review(
      [
        history("old-one"),
        history("old-two"),
        transaction("pending", "Synthetic Shop"),
      ],
      { findMerchantById: findMerchant },
    );
    expect(queues[0].groups[0]).toMatchObject({
      status: "suggested",
      merchantId: canonicalMerchant.id,
      transactionCount: 1,
      spendingMinor: 100,
    });
  });

  it("treats conflicting historical Merchant IDs as unknown without choosing or throwing", () => {
    const lookup = vi.fn(findMerchant);
    const queues = review(
      [
        history("old-one"),
        history("old-two", { merchantId: "merchant-two" }),
        transaction("pending", "Synthetic Shop"),
      ],
      { findMerchantById: lookup },
    );
    expect(queues[0].groups[0].status).toBe("unknown");
    expect(queues[0].groups[0]).not.toHaveProperty("merchantId");
    expect(queues[0].groups[0]).not.toHaveProperty("displayName");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("uses historical evidence only within its Account Household", () => {
    const queues = review(
      [
        history(),
        transaction("same-household", "Synthetic Shop\nValue Date 29/02/2400"),
        transaction(
          "other-household",
          "Synthetic Shop\nValue Date 01/03/2400",
          -100,
          {
            accountId: "account-two",
          },
        ),
      ],
      { findMerchantById: findMerchant },
    );
    expect(queues.map((queue) => queue.groups[0].status)).toEqual([
      "suggested",
      "unknown",
    ]);
    expect(queues[1].groups[0]).not.toHaveProperty("merchantId");
  });

  it("does not infer a candidate from case differences, substrings, or suffixes", () => {
    const lookup = vi.fn(findMerchant);
    const queues = review(
      [
        history(),
        transaction("case", "synthetic shop"),
        transaction("prefix", "Synthetic"),
        transaction("suffix", "Synthetic Shop Sydney"),
      ],
      { findMerchantById: lookup },
    );
    expect(queues[0].groups.every((group) => group.status === "unknown")).toBe(
      true,
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it("uses same-Household evidence across currencies while keeping financial groups separate", () => {
    const queues = review(
      [
        history(),
        transaction("aud", "Synthetic Shop\nValue Date 29/02/2400", -100),
        transaction("usd", "Synthetic Shop\nValue Date 01/03/2400", -500, {
          accountId: "account-usd",
          currency: "USD",
        }),
      ],
      { findMerchantById: findMerchant },
    );
    expect(queues.map((queue) => queue.currency)).toEqual(["AUD", "USD"]);
    expect(queues.map((queue) => queue.groups[0].status)).toEqual([
      "suggested",
      "suggested",
    ]);
    expect(queues.map((queue) => queue.groups[0].spendingMinor)).toEqual([
      100, 500,
    ]);
  });

  it("lets confirmed rules beat conflicting or stale historical suggestions without candidate lookup", () => {
    const merchant = vi.fn(noMerchant);
    const rule = vi.fn(() => "confirmed-identity");
    expect(
      review([history(), transaction("pending", "Synthetic Shop")], {
        findConfirmedMerchantId: rule,
        findMerchantById: merchant,
      }),
    ).toEqual([]);
    expect(rule).toHaveBeenCalledWith("household-one", "Synthetic Shop");
    expect(merchant).not.toHaveBeenCalled();
  });

  it.each([
    ["stale", undefined],
    [
      "mismatched",
      new Merchant({ id: "other-id", displayName: "Other Merchant" }),
    ],
    [
      "blank name",
      { id: canonicalMerchant.id, displayName: " \t" } as Merchant,
    ],
  ])(
    "rejects a %s historical candidate instead of silently suggesting it",
    (_name, merchant) => {
      expect(() =>
        review([history(), transaction("pending", "Synthetic Shop")], {
          findMerchantById: () => merchant,
        }),
      ).toThrow("Merchant review requires an existing canonical Merchant.");
    },
  );

  it("omits empty candidates and manual Transactions without source text, including historical evidence", () => {
    const rule = vi.fn(noRule);
    const merchant = vi.fn(findMerchant);
    const manual = new Transaction({
      id: "manual",
      accountId: "account-one",
      postingDate: "2026-01-01",
      amount: new Money(-100, "AUD"),
      origin: "manual",
      merchantId: canonicalMerchant.id,
    });
    const texts = ["", " \t\n", "SQ *", "PAYPAL * "];
    expect(
      review(
        [
          ...texts.map((text, index) => transaction(`empty-${index}`, text)),
          ...texts.map((text, index) =>
            transaction(`history-empty-${index}`, text, -100, {
              merchantId: canonicalMerchant.id,
            }),
          ),
          manual,
        ],
        { findConfirmedMerchantId: rule, findMerchantById: merchant },
      ),
    ).toEqual([]);
    expect(rule).not.toHaveBeenCalled();
    expect(merchant).not.toHaveBeenCalled();
    expect(manual.rawDescription).toBeUndefined();
  });

  it("preserves currency-scoped ranking, credit/zero counts, and outflow totals within a Household", () => {
    const queues = review([
      transaction("z", "Shop Z", -200),
      transaction("high", "Shop High\nValue Date 29/02/2400", -300),
      transaction("b", "Shop B", -200),
      transaction("a-debit", "Shop A\nValue Date 29/02/2400", -200),
      transaction("a-credit", "Shop A\nValue Date 01/03/2400", 900),
      transaction("a-zero", "Shop A", 0),
      transaction("usd", "Shop A\r\nValue Date 29/02/2400", -99999, {
        accountId: "account-usd",
        currency: "USD",
      }),
    ]);
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

  it("preserves source evidence and associations across deterministic builds without writes", () => {
    const rawDescription =
      "  PAYPAL *Synthetic\nShop  \r\nValue Date 29/02/2400";
    const source = transaction("source", rawDescription, -1234);
    const associated = history();
    const transactions = Object.freeze([
      source,
      associated,
      transaction("other", "Unknown Shop", -1500),
    ]);
    const snapshots = transactions.map((value) => ({ ...value }));
    const first = review(transactions, { findMerchantById: findMerchant });
    expect(review(transactions, { findMerchantById: findMerchant })).toEqual(
      first,
    );
    expect(
      review(Object.freeze([...transactions].reverse()), {
        accounts: Object.freeze([...accounts].reverse()),
        findMerchantById: findMerchant,
      }),
    ).toEqual(first);
    expect(transactions).toEqual(snapshots);
    expect(source.rawDescription).toBe(rawDescription);
    expect(source.merchantId).toBeUndefined();
    expect(source.categoryId).toBeUndefined();
    expect(associated.merchantId).toBe(canonicalMerchant.id);
    expect(associated.rawDescription).toBe("SQ * Synthetic Shop");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(Object.isFrozen(first[0].groups)).toBe(true);
    expect(
      first[0].groups.every(
        (group) =>
          Object.isFrozen(group) && Object.isFrozen(group.transactionIds),
      ),
    ).toBe(true);
  });

  it("rejects duplicate Transaction IDs globally even across Households", () => {
    expect(() =>
      review([
        transaction("duplicate", "Synthetic Shop"),
        transaction("duplicate", "Other Shop", -100, {
          accountId: "account-two",
        }),
      ]),
    ).toThrow(Error);
  });

  it("rejects missing Account context for pending and historical Transactions without source details", () => {
    const lookup = vi.fn(noRule);
    for (const source of [
      transaction("private-id", "private source"),
      history(),
    ]) {
      expect(() =>
        review([source], { accounts: [], findConfirmedMerchantId: lookup }),
      ).toThrow("Merchant review requires the associated Account.");
    }
    expect(lookup).not.toHaveBeenCalled();
  });
});
