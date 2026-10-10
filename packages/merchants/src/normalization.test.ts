import { describe, expect, expectTypeOf, it } from "vitest";
import reference from "../../../fixtures/bank-statements/commbank/browser-summary-01.reference.json";
import { Money, Transaction } from "../../domain/src";
import {
  normalizeMerchantDescription,
  normalizePaymentProcessorPrefix,
  normalizeStatementMetadataSuffix,
} from "./index";
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
    expectTypeOf(
      normalizeStatementMetadataSuffix,
    ).toEqualTypeOf<MerchantDescriptionNormalizer>();
    expectTypeOf(
      normalizeMerchantDescription,
    ).toEqualTypeOf<MerchantDescriptionNormalizer>();
  });

  it("allows feeding a derived candidate into a later textual step", () => {
    expectTypeOf<
      MerchantNormalizationResult["normalizedDescription"]
    >().toEqualTypeOf<Parameters<MerchantDescriptionNormalizer>[0]>();
  });
});

describe("ambiguous location and numeric suffixes remain preserved", () => {
  it("preserves every tracked fixture description apart from whitespace", () => {
    const rawDescriptions = reference.sourceRows.map(
      ({ rawDescription }) => rawDescription,
    );
    const results = rawDescriptions.map(normalizeMerchantDescription);

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
    expect(normalizeMerchantDescription(raw)).toEqual({
      normalizedDescription: expected,
    });
  });
});

describe("normalizeStatementMetadataSuffix", () => {
  // All dates, names, card tokens, and monetary text below are invented.
  const metadata = "Value Date 29/02/2400";

  it.each([
    [`MiXeD Café & Co.!\n${metadata}`, "MiXeD Café & Co.!"],
    [`MiXeD Café & Co.!\r\n${metadata}`, "MiXeD Café & Co.!"],
    [`  MiXeD Café!\t東京\n Outlet  \n${metadata}`, "MiXeD Café! 東京 Outlet"],
    [`SQ *SYNTHETIC SHOP\n${metadata}`, "SQ *SYNTHETIC SHOP"],
    [`SYNTHETIC SHOP\nCard xx8080\n${metadata}`, "SYNTHETIC SHOP Card xx8080"],
    [
      `SYNTHETIC SHOP\nCard xx8080 CZK 6.54\n${metadata}`,
      "SYNTHETIC SHOP Card xx8080 CZK 6.54",
    ],
    [`SYNTHETIC SHOP\n${metadata}\n${metadata}`, `SYNTHETIC SHOP ${metadata}`],
  ])("removes only the supported final line in %j", (raw, expected) => {
    expect(normalizeStatementMetadataSuffix(raw)).toEqual({
      normalizedDescription: expected,
    });
  });

  it.each(["29/02/2404", "01/01/0001", "31/12/9999"])(
    "accepts a real Gregorian date %s",
    (date) => {
      expect(
        normalizeStatementMetadataSuffix(`SYNTHETIC SHOP\nValue Date ${date}`),
      ).toEqual({ normalizedDescription: "SYNTHETIC SHOP" });
    },
  );

  it.each([
    "29/02/2500",
    "29/02/2401",
    "31/04/2400",
    "00/01/2400",
    "32/01/2400",
    "01/00/2400",
    "01/13/2400",
    "01/01/0000",
    "1/01/2400",
    "01/1/2400",
    "01/01/400",
    "01/01/02400",
    "01-01-2400",
    "０１/01/2400",
  ])("retains impossible or malformed date %s", (date) => {
    expect(
      normalizeStatementMetadataSuffix(`SYNTHETIC SHOP\nValue Date ${date}`),
    ).toEqual({ normalizedDescription: `SYNTHETIC SHOP Value Date ${date}` });
  });

  it.each([
    [
      "SYNTHETIC SHOP\nvalue date 29/02/2400",
      "SYNTHETIC SHOP value date 29/02/2400",
    ],
    [
      "SYNTHETIC SHOP\nBooking Date 29/02/2400",
      "SYNTHETIC SHOP Booking Date 29/02/2400",
    ],
    [
      "SYNTHETIC SHOP\nValue Date: 29/02/2400",
      "SYNTHETIC SHOP Value Date: 29/02/2400",
    ],
    [
      "SYNTHETIC SHOP\nValue Date_29/02/2400",
      "SYNTHETIC SHOP Value Date_29/02/2400",
    ],
    [`SYNTHETIC SHOP ${metadata}`, `SYNTHETIC SHOP ${metadata}`],
    [`SYNTHETIC SHOP\r${metadata}`, `SYNTHETIC SHOP ${metadata}`],
    [`SYNTHETIC SHOP\u2028${metadata}`, `SYNTHETIC SHOP ${metadata}`],
    [`SYNTHETIC SHOP\u2029${metadata}`, `SYNTHETIC SHOP ${metadata}`],
    [`SYNTHETIC SHOP\n ${metadata}`, `SYNTHETIC SHOP ${metadata}`],
    ["SYNTHETIC SHOP\nValue  Date 29/02/2400", `SYNTHETIC SHOP ${metadata}`],
    ["SYNTHETIC SHOP\nValue\tDate 29/02/2400", `SYNTHETIC SHOP ${metadata}`],
    ["SYNTHETIC SHOP\nValue Date  29/02/2400", `SYNTHETIC SHOP ${metadata}`],
    [
      "SYNTHETIC SHOP\nValue Date\u00a029/02/2400",
      `SYNTHETIC SHOP ${metadata}`,
    ],
    [`SYNTHETIC SHOP\n${metadata}\nEXTRA`, `SYNTHETIC SHOP ${metadata} EXTRA`],
    [`SYNTHETIC SHOP\n${metadata} EXTRA`, `SYNTHETIC SHOP ${metadata} EXTRA`],
    ...["\n", "\r\n", " ", "\t"].map((ending) => [
      `SYNTHETIC SHOP\n${metadata}${ending}`,
      `SYNTHETIC SHOP ${metadata}`,
    ]),
    [metadata, metadata],
    [`\n${metadata}`, metadata],
    [` \t\r\n${metadata}`, metadata],
    ["", ""],
    [" \t\r\n", ""],
  ])(
    "preserves unsupported syntax in %j apart from whitespace",
    (raw, expected) => {
      expect(normalizeStatementMetadataSuffix(raw)).toEqual({
        normalizedDescription: expected,
      });
    },
  );

  it.each([
    [
      "SYNTHETIC SHOP EXAMPLEVILLE NS AUS",
      "SYNTHETIC SHOP EXAMPLEVILLE NS AUS",
    ],
    ["SYNTHETIC SHOP 42424242", "SYNTHETIC SHOP 42424242"],
    ["SYNTHETIC SHOP\n42424242", "SYNTHETIC SHOP 42424242"],
    ["SYNTHETIC SHOP | OUTLET", "SYNTHETIC SHOP | OUTLET"],
    ["SYNTHETIC SHOP - SERVICE", "SYNTHETIC SHOP - SERVICE"],
    ["SYNTHETIC SHOP\nCard xx8080", "SYNTHETIC SHOP Card xx8080"],
    ["SYNTHETIC SHOP\n29/02/2400", "SYNTHETIC SHOP 29/02/2400"],
  ])("preserves untyped tails in %j", (raw, expected) => {
    expect(normalizeMerchantDescription(raw)).toEqual({
      normalizedDescription: expected,
    });
  });

  it("composes suffix removal before whitespace and exactly one processor prefix", () => {
    const raw = ` \tSQ\t*PAYPAL *MiXeD Café!\r\n${metadata}`;
    const result = normalizeMerchantDescription(raw);
    expect(result).toEqual({ normalizedDescription: "PAYPAL *MiXeD Café!" });
    expect(normalizeMerchantDescription(raw)).toEqual(result);
    expect(
      normalizeMerchantDescription(`SQ*SYNTHETIC SHOP\n${metadata}`),
    ).toEqual({ normalizedDescription: "SQ*SYNTHETIC SHOP" });
  });

  it("retains the source Transaction and rawDescription unchanged", () => {
    const rawDescription = `  PAYPAL *MiXeD Café!\r\n${metadata}`;
    const source = new Transaction({
      id: "synthetic-transaction",
      accountId: "synthetic-account",
      postingDate: "2400-03-01",
      amount: new Money(-321, "AUD"),
      origin: "imported",
      rawDescription,
      merchantId: "existing-merchant",
      categoryId: "existing-category",
    });
    const before = { ...source };
    expect(normalizeMerchantDescription(source.rawDescription!)).toEqual({
      normalizedDescription: "MiXeD Café!",
    });
    expect(source.rawDescription).toBe(rawDescription);
    expect(source).toEqual(before);
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
