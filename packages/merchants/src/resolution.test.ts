import { describe, expect, expectTypeOf, it } from "vitest";
import {
  confirmedMerchant,
  suggestedMerchant,
  unknownMerchant,
  type MerchantResolution,
} from "./index";

describe("MerchantResolution", () => {
  it("represents each state with only its required fields", () => {
    expect(confirmedMerchant("synthetic-merchant")).toEqual({
      status: "confirmed",
      merchantId: "synthetic-merchant",
    });
    expect(suggestedMerchant("synthetic-merchant")).toEqual({
      status: "suggested",
      merchantId: "synthetic-merchant",
    });
    expect(unknownMerchant()).toEqual({ status: "unknown" });
    expect(Object.hasOwn(unknownMerchant(), "merchantId")).toBe(false);
  });

  it("narrows the readonly union by status and excludes unknown identities", () => {
    const results: MerchantResolution[] = [
      confirmedMerchant("synthetic-merchant"),
      suggestedMerchant("synthetic-merchant"),
      unknownMerchant(),
    ];
    for (const result of results) {
      switch (result.status) {
        case "confirmed":
          expectTypeOf(result).toEqualTypeOf<{
            readonly status: "confirmed";
            readonly merchantId: string;
          }>();
          break;
        case "suggested":
          expectTypeOf(result).toEqualTypeOf<{
            readonly status: "suggested";
            readonly merchantId: string;
          }>();
          break;
        case "unknown":
          expectTypeOf(result.merchantId).toEqualTypeOf<undefined>();
          break;
        default:
          expectTypeOf(result).toEqualTypeOf<never>();
      }
    }
    expectTypeOf<{
      status: "unknown";
      merchantId: string;
    }>().not.toExtend<MerchantResolution>();
    expectTypeOf<{ status: "confirmed" }>().not.toExtend<MerchantResolution>();
    expectTypeOf<{ status: "suggested" }>().not.toExtend<MerchantResolution>();
    expectTypeOf(confirmedMerchant("id").status).toEqualTypeOf<"confirmed">();
    expectTypeOf(suggestedMerchant("id").status).toEqualTypeOf<"suggested">();
    expectTypeOf(unknownMerchant).parameters.toEqualTypeOf<[]>();
  });

  describe.each([
    ["confirmedMerchant", confirmedMerchant],
    ["suggestedMerchant", suggestedMerchant],
  ] as const)("%s", (_, create) => {
    it.each(["", " \t\n\u00a0 "])("rejects blank IDs %j", (merchantId) => {
      expect(() => create(merchantId)).toThrow(TypeError);
    });

    it.each([undefined, null, 42])(
      "rejects non-string IDs %j",
      (merchantId) => {
        expect(() => create(merchantId as unknown as string)).toThrow(
          TypeError,
        );
      },
    );

    it("preserves opaque IDs without normalization or changing surrounding data", () => {
      const context = Object.freeze({
        merchantId: " \tSQ *MiXeD  Café/東京 #42\n ",
        rawDescription: " PAYPAL *Synthetic Shop\n ",
        categoryId: "synthetic-category",
      });
      const before = { ...context };
      const result = create(context.merchantId);
      expect(result.merchantId).toBe(context.merchantId);
      expect(Object.keys(result).sort()).toEqual(["merchantId", "status"]);
      expect(context).toEqual(before);
      expect(create(context.merchantId)).toEqual(result);
    });
  });

  it("returns immutable outcomes without sharing mutable state", () => {
    const results = [
      confirmedMerchant("synthetic-merchant"),
      suggestedMerchant("synthetic-merchant"),
      unknownMerchant(),
    ];
    for (const result of results) {
      const before = { ...result };
      expect(Object.isFrozen(result)).toBe(true);
      expect(Reflect.set(result, "status", "suggested")).toBe(false);
      expect(Reflect.set(result, "merchantId", "other-merchant")).toBe(false);
      expect(result).toEqual(before);
    }
    expect(unknownMerchant()).toEqual(results[2]);
    expect(Object.hasOwn(results[2], "merchantId")).toBe(false);
  });
});
