import { describe, expect, expectTypeOf, it } from "vitest";
import {
  rankUnknownMerchantReviewQueues,
  type RankedUnknownMerchantGroup,
  type UnknownMerchantFinancialObservation,
  type UnknownMerchantGroup,
  type UnknownMerchantObservation,
  type UnknownMerchantReviewQueue,
} from "./index";

function observation(
  transactionId: string,
  normalizedDescription: string,
  amountMinor: number,
  currency = "AUD",
): UnknownMerchantFinancialObservation {
  return { transactionId, normalizedDescription, amountMinor, currency };
}

describe("rankUnknownMerchantReviewQueues", () => {
  it("extends readonly textual observations/groups without creating identity", () => {
    expectTypeOf<UnknownMerchantFinancialObservation>().toEqualTypeOf<
      UnknownMerchantObservation & {
        readonly amountMinor: number;
        readonly currency: string;
      }
    >();
    expectTypeOf<RankedUnknownMerchantGroup>().toEqualTypeOf<
      UnknownMerchantGroup & { readonly spendingMinor: number }
    >();
    expectTypeOf<UnknownMerchantReviewQueue>().toEqualTypeOf<{
      readonly currency: string;
      readonly groups: readonly RankedUnknownMerchantGroup[];
    }>();
    expectTypeOf(rankUnknownMerchantReviewQueues).parameters.toEqualTypeOf<
      [observations: readonly UnknownMerchantFinancialObservation[]]
    >();
    expectTypeOf(rankUnknownMerchantReviewQueues).returns.toEqualTypeOf<
      readonly UnknownMerchantReviewQueue[]
    >();
  });

  it("sums integer outflows without netting credits and ranks larger spending first", () => {
    const result = rankUnknownMerchantReviewQueues([
      observation("transaction-2", "Synthetic Shop", -125),
      observation("transaction-10", "Synthetic Shop", -76),
      observation("transaction-1", "Synthetic Shop", 999),
      observation("transaction-3", "Synthetic Shop", 0),
      observation("transaction-4", "Synthetic Cafe", -200),
      observation("transaction-5", "Synthetic Credit", 100),
    ]);
    expect(result).toEqual([
      {
        currency: "AUD",
        groups: [
          {
            normalizedDescription: "Synthetic Shop",
            transactionIds: [
              "transaction-1",
              "transaction-10",
              "transaction-2",
              "transaction-3",
            ],
            transactionCount: 4,
            spendingMinor: 201,
          },
          {
            normalizedDescription: "Synthetic Cafe",
            transactionIds: ["transaction-4"],
            transactionCount: 1,
            spendingMinor: 200,
          },
          {
            normalizedDescription: "Synthetic Credit",
            transactionIds: ["transaction-5"],
            transactionCount: 1,
            spendingMinor: 0,
          },
        ],
      },
    ]);
  });

  it("breaks spending ties by count, then ordinary JS description ordering", () => {
    const groups = rankUnknownMerchantReviewQueues([
      observation("b", "Shop 2", -100),
      observation("c", "shop 1", -100),
      observation("a", "Shop 10", -100),
      observation("d", "Z Shop", -100),
      observation("e", "Z Shop", 0),
    ])[0].groups;
    expect(groups.map((group) => group.normalizedDescription)).toEqual([
      "Z Shop",
      "Shop 10",
      "Shop 2",
      "shop 1",
    ]);
  });

  it("keeps the same description separate across currencies, ordered only by code", () => {
    const result = rankUnknownMerchantReviewQueues([
      observation("usd", "Synthetic Shop", -900, "USD"),
      observation("jpy", "Synthetic Shop", -10000, "JPY"),
      observation("aud", "Synthetic Shop", -1, "AUD"),
    ]);
    expect(
      result.map(({ currency, groups }) => [currency, groups[0].spendingMinor]),
    ).toEqual([
      ["AUD", 1],
      ["JPY", 10000],
      ["USD", 900],
    ]);
    expect(result.every(({ groups }) => groups[0].transactionCount === 1)).toBe(
      true,
    );
  });

  it("preserves case, whitespace, punctuation, and Unicode without normalization", () => {
    const descriptions = ["MiXeD Café!", "mixed café!", " MiXeD  Café! "];
    const result = rankUnknownMerchantReviewQueues(
      descriptions.map((description, index) =>
        observation(`transaction-${index}`, description, -1),
      ),
    );
    expect(
      result[0].groups.map((group) => group.normalizedDescription),
    ).toEqual([...descriptions].sort());
    expect(
      result[0].groups.every((group) => group.transactionCount === 1),
    ).toBe(true);
  });

  it("accepts maximum safe debit/credit magnitudes without counting credits", () => {
    const groups = rankUnknownMerchantReviewQueues([
      observation("debit", "Synthetic Shop", -Number.MAX_SAFE_INTEGER),
      observation("credit", "Synthetic Shop", Number.MAX_SAFE_INTEGER),
      observation("zero", "Synthetic Shop", -0),
    ])[0].groups;
    expect(groups[0].spendingMinor).toBe(Number.MAX_SAFE_INTEGER);
    expect(groups[0].transactionCount).toBe(3);
  });

  it("accepts an exactly safe accumulated total in either input order", () => {
    const input = [
      observation("a", "Synthetic Shop", -(Number.MAX_SAFE_INTEGER - 1)),
      observation("b", "Synthetic Shop", -1),
    ];
    for (const observations of [input, [...input].reverse()]) {
      expect(
        rankUnknownMerchantReviewQueues(observations)[0].groups[0]
          .spendingMinor,
      ).toBe(Number.MAX_SAFE_INTEGER);
    }
  });

  it("rejects unsafe group accumulation in either input order", () => {
    const input = [
      observation("a", "Synthetic Shop", -Number.MAX_SAFE_INTEGER),
      observation("b", "Synthetic Shop", -1),
    ];
    for (const observations of [input, [...input].reverse()]) {
      expect(() => rankUnknownMerchantReviewQueues(observations)).toThrow(
        RangeError,
      );
    }
  });

  it("does not accumulate an unnecessary total across independent groups/currencies", () => {
    const queues = rankUnknownMerchantReviewQueues([
      observation("a", "Synthetic A", -Number.MAX_SAFE_INTEGER),
      observation("b", "Synthetic B", -Number.MAX_SAFE_INTEGER),
      observation("c", "Synthetic A", -Number.MAX_SAFE_INTEGER, "EUR"),
    ]);
    expect(queues.map((queue) => queue.groups.length)).toEqual([2, 1]);
    expect(
      queues.every((queue) =>
        queue.groups.every(
          (group) => group.spendingMinor === Number.MAX_SAFE_INTEGER,
        ),
      ),
    ).toBe(true);
  });

  it.each([
    1.5,
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    -(Number.MAX_SAFE_INTEGER + 1),
    "1",
    null,
    undefined,
  ])("rejects invalid amount %j", (amountMinor) => {
    expect(() =>
      rankUnknownMerchantReviewQueues([
        {
          ...observation("a", "Synthetic Shop", 0),
          amountMinor,
        } as UnknownMerchantFinancialObservation,
      ]),
    ).toThrow(RangeError);
  });

  it.each([
    "",
    "aud",
    "AU",
    "AUSD",
    " AUD",
    "AUD ",
    "AUD\n",
    "ＡＵＤ",
    "A1D",
    123,
    null,
    undefined,
  ])("rejects invalid currency %j without repairing it", (currency) => {
    expect(() =>
      rankUnknownMerchantReviewQueues([
        {
          ...observation("a", "Synthetic Shop", -1),
          currency,
        } as UnknownMerchantFinancialObservation,
      ]),
    ).toThrow(TypeError);
  });

  it.each(["transactionId", "normalizedDescription"] as const)(
    "rejects blank %s through textual aggregation validation",
    (field) => {
      expect(() =>
        rankUnknownMerchantReviewQueues([
          { ...observation("a", "Synthetic Shop", -1), [field]: " \t\n " },
        ]),
      ).toThrow(TypeError);
    },
  );

  it("rejects duplicate transaction IDs globally, including across currencies", () => {
    expect(() =>
      rankUnknownMerchantReviewQueues([
        observation("same", "Synthetic A", -1, "AUD"),
        observation("same", "Synthetic B", -1, "EUR"),
      ]),
    ).toThrow(Error);
  });

  it("is deterministic, preserves frozen evidence, and deeply freezes identity-free output", () => {
    const input = Object.freeze([
      Object.freeze({
        ...observation(" transaction-2 ", " MiXeD  Café/東京! ", -5, "EUR"),
        rawDescription: "\tSQ * MiXeD  Café/東京!\n",
      }),
      Object.freeze(
        observation(" transaction-1 ", " MiXeD  Café/東京! ", 10, "EUR"),
      ),
      Object.freeze(observation("other", "Synthetic Shop", -20)),
    ]);
    const before = input.map((entry) => ({ ...entry }));
    const result = rankUnknownMerchantReviewQueues(input);
    expect(rankUnknownMerchantReviewQueues(input)).toEqual(result);
    expect(rankUnknownMerchantReviewQueues([...input].reverse())).toEqual(
      result,
    );
    expect(
      rankUnknownMerchantReviewQueues([input[1], input[2], input[0]]),
    ).toEqual(result);
    expect(input).toEqual(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Reflect.set(result, "0", {})).toBe(false);
    for (const queue of result) {
      expect(Object.keys(queue).sort()).toEqual(["currency", "groups"]);
      expect([queue, queue.groups].every(Object.isFrozen)).toBe(true);
      expect(Reflect.set(queue, "currency", "USD")).toBe(false);
      for (const group of queue.groups) {
        expect(Object.keys(group).sort()).toEqual([
          "normalizedDescription",
          "spendingMinor",
          "transactionCount",
          "transactionIds",
        ]);
        expect([group, group.transactionIds].every(Object.isFrozen)).toBe(true);
        expect(Reflect.set(group, "merchantId", "invented-merchant")).toBe(
          false,
        );
        expect(Reflect.set(group.transactionIds, "0", "changed-id")).toBe(
          false,
        );
      }
    }
  });

  it("returns a frozen empty queue collection for no observations", () => {
    const result = rankUnknownMerchantReviewQueues([]);
    expect(result).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });
});
