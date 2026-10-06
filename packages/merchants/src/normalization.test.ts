import { describe, expect, expectTypeOf, it } from "vitest";
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
