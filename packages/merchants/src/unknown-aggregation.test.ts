import { describe, expect, expectTypeOf, it } from "vitest";
import {
  aggregateUnknownMerchantObservations,
  type UnknownMerchantGroup,
  type UnknownMerchantObservation,
} from "./index";

describe("aggregateUnknownMerchantObservations", () => {
  const observation: UnknownMerchantObservation = {
    transactionId: "transaction-1",
    normalizedDescription: "Synthetic Shop",
  };

  it("exposes only readonly observation and review-group fields", () => {
    expectTypeOf<UnknownMerchantObservation>().toEqualTypeOf<{
      readonly transactionId: string;
      readonly normalizedDescription: string;
    }>();
    expectTypeOf<UnknownMerchantGroup>().toEqualTypeOf<{
      readonly normalizedDescription: string;
      readonly transactionIds: readonly string[];
      readonly transactionCount: number;
    }>();
    expectTypeOf(aggregateUnknownMerchantObservations).parameters.toEqualTypeOf<
      [observations: readonly UnknownMerchantObservation[]]
    >();
    expectTypeOf(aggregateUnknownMerchantObservations).returns.toEqualTypeOf<
      readonly UnknownMerchantGroup[]
    >();
  });

  it("groups one observation and counts several exact descriptions", () => {
    expect(aggregateUnknownMerchantObservations([observation])).toEqual([
      {
        normalizedDescription: observation.normalizedDescription,
        transactionIds: [observation.transactionId],
        transactionCount: 1,
      },
    ]);
    expect(
      aggregateUnknownMerchantObservations([
        observation,
        { ...observation, transactionId: "transaction-2" },
      ]),
    ).toEqual([
      {
        normalizedDescription: observation.normalizedDescription,
        transactionIds: ["transaction-1", "transaction-2"],
        transactionCount: 2,
      },
    ]);
  });

  it("keeps case, partial text, whitespace, and Unicode differences separate", () => {
    const descriptions = [
      "Synthetic Shop",
      "synthetic shop",
      "Synthetic",
      "Shop",
      "nthetic Sho",
      "Synthetic Shop Annex",
      " Synthetic Shop ",
      "Synthetic  Shop",
      "Café",
      "Cafe\u0301",
      "SQ *Synthetic Shop",
    ];
    const groups = aggregateUnknownMerchantObservations(
      descriptions.map((normalizedDescription, index) => ({
        transactionId: `transaction-${index}`,
        normalizedDescription,
      })),
    );
    expect(groups.map((group) => group.normalizedDescription)).toEqual(
      [...descriptions].sort(),
    );
    expect(groups.every((group) => group.transactionCount === 1)).toBe(true);
  });

  it("orders descriptions and opaque IDs lexically regardless of input order", () => {
    const observations = [
      { transactionId: "transaction-2", normalizedDescription: "Shop 10" },
      { transactionId: "transaction-10", normalizedDescription: "Shop 10" },
      { transactionId: "transaction-1", normalizedDescription: "Shop 10" },
      { transactionId: "transaction-3", normalizedDescription: "shop 1" },
      { transactionId: "transaction-4", normalizedDescription: "Shop 2" },
    ];
    const expected = [
      {
        normalizedDescription: "Shop 10",
        transactionIds: ["transaction-1", "transaction-10", "transaction-2"],
        transactionCount: 3,
      },
      {
        normalizedDescription: "Shop 2",
        transactionIds: ["transaction-4"],
        transactionCount: 1,
      },
      {
        normalizedDescription: "shop 1",
        transactionIds: ["transaction-3"],
        transactionCount: 1,
      },
    ];
    expect(aggregateUnknownMerchantObservations(observations)).toEqual(
      expected,
    );
    expect(
      aggregateUnknownMerchantObservations([...observations].reverse()),
    ).toEqual(expected);
    expect(aggregateUnknownMerchantObservations(observations)).toEqual(
      expected,
    );
  });

  it.each(["", " \t\n\u00a0 ", undefined, null, 42])(
    "rejects invalid description or transaction ID %j",
    (invalid) => {
      for (const field of ["normalizedDescription", "transactionId"] as const) {
        expect(() =>
          aggregateUnknownMerchantObservations([
            { ...observation, [field]: invalid } as UnknownMerchantObservation,
          ]),
        ).toThrow(TypeError);
      }
    },
  );

  it.each([null, undefined, 42])(
    "rejects malformed observation %j",
    (invalid) => {
      expect(() =>
        aggregateUnknownMerchantObservations([
          invalid as unknown as UnknownMerchantObservation,
        ]),
      ).toThrow(TypeError);
    },
  );

  it.each([null, undefined, {}])("rejects non-array input %j", (invalid) => {
    expect(() =>
      aggregateUnknownMerchantObservations(
        invalid as unknown as readonly UnknownMerchantObservation[],
      ),
    ).toThrow(TypeError);
  });

  it.each(["Synthetic Shop", "Different Shop"])(
    "rejects duplicate IDs under %j",
    (description) => {
      const duplicate = { ...observation, normalizedDescription: description };
      expect(() =>
        aggregateUnknownMerchantObservations([observation, duplicate]),
      ).toThrow(Error);
      expect(() =>
        aggregateUnknownMerchantObservations([duplicate, observation]),
      ).toThrow(Error);
    },
  );

  it("preserves caller evidence and deeply freezes groups without implying identity", () => {
    const source = Object.freeze({
      transactionId: " transaction-1 ",
      normalizedDescription: " MiXeD  Café & 東京! ",
      rawDescription: "\tSQ * MiXeD  Café & 東京!\n",
    });
    const second = Object.freeze({
      ...source,
      transactionId: " transaction-0 ",
    });
    const input = Object.freeze([source, second]);
    const before = input.map((entry) => ({ ...entry }));
    const result = aggregateUnknownMerchantObservations(input);
    const group = result[0];
    expect(group).toEqual({
      normalizedDescription: source.normalizedDescription,
      transactionIds: [second.transactionId, source.transactionId],
      transactionCount: 2,
    });
    expect(Object.keys(group).sort()).toEqual([
      "normalizedDescription",
      "transactionCount",
      "transactionIds",
    ]);
    expect([result, group, group.transactionIds].every(Object.isFrozen)).toBe(
      true,
    );
    expect(Reflect.set(result, "0", {})).toBe(false);
    expect(Reflect.set(group, "merchantId", "invented-merchant")).toBe(false);
    expect(Reflect.set(group.transactionIds, "0", "changed-id")).toBe(false);
    expect(input).toEqual(before);
  });

  it("returns a frozen empty array for no reviewable observations", () => {
    const result = aggregateUnknownMerchantObservations([]);
    expect(result).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });
});
