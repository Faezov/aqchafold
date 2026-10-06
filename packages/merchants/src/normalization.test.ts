import { describe, expect, expectTypeOf, it } from "vitest";
import reference from "../../../fixtures/bank-statements/commbank/browser-summary-01.reference.json";
import { normalizePaymentProcessorPrefix } from "./index";
import type {
  MerchantDescriptionNormalizer,
  MerchantNormalizationResult,
} from "./index";

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
    expectTypeOf(
      normalizePaymentProcessorPrefix,
    ).toEqualTypeOf<MerchantDescriptionNormalizer>();
  });

  it("allows feeding a derived candidate into a later textual step", () => {
    expectTypeOf<
      MerchantNormalizationResult["normalizedDescription"]
    >().toEqualTypeOf<Parameters<MerchantDescriptionNormalizer>[0]>();
  });
});

describe("suffix evidence remains unresolved", () => {
  it("preserves every tracked fixture description apart from whitespace", () => {
    const rawDescriptions = reference.sourceRows.map(
      ({ rawDescription }) => rawDescription,
    );
    const results = rawDescriptions.map(normalizePaymentProcessorPrefix);

    expect(
      results.map(({ normalizedDescription }) => normalizedDescription),
    ).toEqual([
      "FIXTURE MARKET EXAMPLEVILLE",
      "SYNTHETIC HOME SUPPLIES",
      "Credit SYNTHETIC EMPLOYER",
      "Direct Debit SYNTHETIC UTILITIES 91007382",
      "FIXTURE REPAIR WORKSHOP",
      "Refund SYNTHETIC HOME SUPPLIES",
      "FIXTURE COFFEE STAND",
      "Transfer SYNTHETIC SAVINGS",
      "SYNTHETIC TRANSIT PASS",
      "FIXTURE BOOK SHOP",
      "Credit SYNTHETIC PROJECT PAY",
    ]);
    expect(rawDescriptions.map(normalizePaymentProcessorPrefix)).toEqual(
      results,
    );
    expect(
      reference.sourceRows.map(({ rawDescription }) => rawDescription),
    ).toEqual(rawDescriptions);
    expect(reference.sourceRows[3].rawDescription).toBe(
      "Direct Debit SYNTHETIC UTILITIES\n91007382",
    );
  });

  // Architecture example and user-supplied ambiguity; neither defines a suffix grammar.
  it.each([
    ["SQ *KAHII Sydney NS AUS", "KAHII Sydney NS AUS"],
    ["Sydney Tools", "Sydney Tools"],
    ["SQ *KAHII Sydney NS AUS Branch", "KAHII Sydney NS AUS Branch"],
  ])("retains ambiguous location text in %j", (raw, expected) => {
    expect(normalizePaymentProcessorPrefix(raw)).toEqual({
      normalizedDescription: expected,
    });
  });
});

describe("normalizePaymentProcessorPrefix", () => {
  it.each([
    [" SQ *EXAMPLE SHOP ", "EXAMPLE SHOP"],
    ["SQ * EXAMPLE SHOP", "EXAMPLE SHOP"],
    ["PAYPAL *MiXeD Café", "MiXeD Café"],
    ["PAYPAL * 東京 STORE", "東京 STORE"],
    ["sq *MiXeD Café!", "MiXeD Café!"],
    ["pAyPaL * O'Example & Co. #42", "O'Example & Co. #42"],
    ["\u00a0sQ\t*\nMiXeD Café! 東京 NS AUS\u2003", "MiXeD Café! 東京 NS AUS"],
    [" PAYPAL\t \t*\u00a0MiXeD\nCafé ", "MiXeD Café"],
    ["", ""],
    [" \t\r\n\u00a0 ", ""],
    ["SQ *", ""],
    [" \tSQ\t* \n ", ""],
    ["PAYPAL *", ""],
    [" paypal * \t ", ""],
    ["  Example Shop  ", "Example Shop"],
    ["  Ordinary   Shop  ", "Ordinary Shop"],
    ["Example\t\tShop\r\nBranch", "Example Shop Branch"],
    ["\u00a0Example\u00a0\u2003Shop\u00a0", "Example Shop"],
    ["MiXeD Café * 東京", "MiXeD Café * 東京"],
    [" SQ *EXAMPLE SHOP Sydney NS AUS ", "EXAMPLE SHOP Sydney NS AUS"],
    ["SQ *PAYPAL *MiXeD Café", "PAYPAL *MiXeD Café"],
    ["PAYPAL * SQ *Shop", "SQ *Shop"],
    ["SQ *SQ *Shop", "SQ *Shop"],
    ["SQ **SHOP", "*SHOP"],
  ])(
    "normalizes %j -> %j synchronously and deterministically",
    (raw, expected) => {
      const result = normalizePaymentProcessorPrefix(raw);
      expect(result).toEqual({ normalizedDescription: expected });
      expect(normalizePaymentProcessorPrefix(raw)).toEqual(result);
    },
  );

  it.each([
    "SQ*SHOP",
    "PAYPAL*SHOP",
    "PP*SHOP",
    "SQUARE *SHOP",
    "STRIPE *SHOP",
    "SQUID *SHOP",
    "PAYPALISH *SHOP",
    "ſQ *SHOP",
    "ＰＡＹＰＡＬ *SHOP",
    "SQ SHOP",
    "PAYPAL SHOP",
    "SQ",
    "PAYPAL",
    "SQ -SHOP",
    "PAYPAL :SHOP",
    "SQ ＊SHOP",
    "*SQ *SHOP",
    "Shop SQ *Branch",
    "Shop PAYPAL *Branch",
    "Shop SQ *",
    "Shop PAYPAL *",
    "ShopSQ *Branch",
    "ShopPAYPAL *Branch",
  ])("preserves unsupported or non-leading syntax %j", (raw) => {
    expect(normalizePaymentProcessorPrefix(raw)).toEqual({
      normalizedDescription: raw,
    });
  });

  it("keeps the source record unchanged and returns only derived text", () => {
    const rawDescription = "  PAYPAL *MiXeD Café\tBranch\n ";
    const source = Object.freeze({
      rawDescription,
      merchantId: "existing-merchant",
      categoryId: "existing-category",
    });
    const before = { ...source };

    const result = normalizePaymentProcessorPrefix(source.rawDescription);

    expect(result).toEqual({ normalizedDescription: "MiXeD Café Branch" });
    expect(source.rawDescription).toBe(rawDescription);
    expect(source).toEqual(before);
  });
});
