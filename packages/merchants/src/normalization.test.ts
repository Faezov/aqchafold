import { describe, expect, expectTypeOf, it } from "vitest";
import { Money, Transaction } from "../../domain/src/index";
import type {
  MerchantDescriptionNormalizer,
  MerchantNormalizationResult,
} from "./index";

// Test-only example of the text policy, not a production normalizer.
const exampleNormalizer: MerchantDescriptionNormalizer = (rawDescription) => ({
  normalizedDescription: rawDescription.replace(/\s+/g, " ").trim(),
});

describe("merchant normalization contract", () => {
  it("accepts one required string and returns a synchronous text-only result", () => {
    expectTypeOf<MerchantDescriptionNormalizer>().parameters.toEqualTypeOf<
      [rawDescription: string]
    >();
    expectTypeOf<MerchantDescriptionNormalizer>().returns.toEqualTypeOf<MerchantNormalizationResult>();
    expectTypeOf<MerchantNormalizationResult>().toEqualTypeOf<{
      readonly normalizedDescription: string;
    }>();
    expectTypeOf<Promise<MerchantNormalizationResult>>().not.toExtend<
      ReturnType<MerchantDescriptionNormalizer>
    >();
  });

  it("allows feeding a derived candidate into a later textual step", () => {
    expectTypeOf<
      MerchantNormalizationResult["normalizedDescription"]
    >().toEqualTypeOf<Parameters<MerchantDescriptionNormalizer>[0]>();
  });
});

describe("normalization contract examples (test implementation only)", () => {
  it.each([
    ["", ""],
    [" \t\r\n\u00a0 ", ""],
    ["  Example Shop  ", "Example Shop"],
    ["Example\t\tShop\r\nBranch", "Example Shop Branch"],
    ["\u00a0Example\u00a0\u2003Shop\u00a0", "Example Shop"],
    ["MiXeD Café * 東京", "MiXeD Café * 東京"],
    [" SQ *EXAMPLE SHOP Sydney NS AUS ", "SQ *EXAMPLE SHOP Sydney NS AUS"],
  ])(
    "produces %j -> %j synchronously and deterministically",
    (raw, expected) => {
      const result = exampleNormalizer(raw);
      expect(result).toEqual({ normalizedDescription: expected });
      expect(exampleNormalizer(raw)).toEqual(result);
    },
  );

  it("keeps derived text separate from all Transaction facts and assignments", () => {
    const rawDescription = "  MiXeD Café\tBranch\n ";
    const transaction = new Transaction({
      id: "synthetic-transaction",
      accountId: "synthetic-account",
      postingDate: "2026-10-07",
      amount: new Money(-1234, "AUD"),
      origin: "imported",
      rawDescription,
      merchantId: "existing-merchant",
      categoryId: "existing-category",
    });
    const before = { ...transaction };
    if (transaction.rawDescription === undefined) {
      throw new Error("Test Transaction must retain its source description.");
    }

    const result = exampleNormalizer(transaction.rawDescription);

    expect(result).toEqual({ normalizedDescription: "MiXeD Café Branch" });
    expect(transaction.rawDescription).toBe(rawDescription);
    expect(transaction).toEqual(before);
    expect(Object.isFrozen(transaction)).toBe(true);
  });
});
