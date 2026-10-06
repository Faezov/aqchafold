import { describe, expect, expectTypeOf, it } from "vitest";
import {
  normalizePaymentProcessorPrefix,
  resolveMerchantAlias,
  type MerchantAlias,
} from "./index";

describe("resolveMerchantAlias", () => {
  const alias: MerchantAlias = {
    normalizedDescription: "Example Shop",
    merchantId: "merchant-example",
  };

  it("exposes readonly mappings and a synchronous ID-only resolver", () => {
    expectTypeOf<MerchantAlias>().toEqualTypeOf<{
      readonly normalizedDescription: string;
      readonly merchantId: string;
    }>();
    expectTypeOf(resolveMerchantAlias).parameters.toEqualTypeOf<
      [normalizedDescription: string, aliases: readonly MerchantAlias[]]
    >();
    expectTypeOf(resolveMerchantAlias).returns.toEqualTypeOf<
      string | undefined
    >();
  });

  it("resolves multiple explicit aliases to the same Merchant ID", () => {
    const aliases = [
      alias,
      { ...alias, normalizedDescription: "Example Shop Branch" },
      { ...alias, normalizedDescription: "MiXeD Café & 東京 #42" },
    ];
    for (const { normalizedDescription } of aliases) {
      expect(resolveMerchantAlias(normalizedDescription, aliases)).toBe(
        alias.merchantId,
      );
    }
  });

  it.each([
    "",
    " \t\n ",
    "Unlisted Shop",
    "example shop",
    "Example",
    "Shop",
    "Example Shop Branch",
    "Prefix Example Shop",
    "Prefix Example Shop Suffix",
    " Example Shop ",
    "Example  Shop",
    "Example\tShop",
  ])("does not normalize or partially match %j", (description) => {
    expect(resolveMerchantAlias(description, [alias])).toBeUndefined();
  });

  it("returns undefined for an empty alias collection", () => {
    expect(
      resolveMerchantAlias(alias.normalizedDescription, []),
    ).toBeUndefined();
  });

  it("preserves nonblank keys and opaque IDs exactly", () => {
    const padded = {
      normalizedDescription: " Example Shop ",
      merchantId: " merchant-example ",
    };
    expect(resolveMerchantAlias(padded.normalizedDescription, [padded])).toBe(
      padded.merchantId,
    );
    expect(resolveMerchantAlias("Example Shop", [padded])).toBeUndefined();
  });

  it.each(["", " \t\n\u00a0 "])("rejects blank fields %j", (blank) => {
    expect(() =>
      resolveMerchantAlias("", [{ ...alias, normalizedDescription: blank }]),
    ).toThrow(TypeError);
    expect(() =>
      resolveMerchantAlias("Unlisted Shop", [{ ...alias, merchantId: blank }]),
    ).toThrow(TypeError);
  });

  it("tolerates repeated identical mappings", () => {
    expect(
      resolveMerchantAlias(alias.normalizedDescription, [alias, alias]),
    ).toBe(alias.merchantId);
  });

  it("rejects conflicting mappings regardless of lookup or ordering", () => {
    const conflicting = { ...alias, merchantId: "merchant-other" };
    for (const aliases of [
      [alias, conflicting],
      [conflicting, alias],
    ]) {
      for (const description of [alias.normalizedDescription, "Unlisted", ""]) {
        expect(() => resolveMerchantAlias(description, aliases)).toThrow(
          "Conflicting Merchant IDs for an alias description.",
        );
      }
    }
  });

  it("is deterministic and leaves the readonly collection and records unchanged", () => {
    const aliases = Object.freeze([Object.freeze({ ...alias })]);
    const before = aliases.map((entry) => ({ ...entry }));
    for (let iteration = 0; iteration < 3; iteration++) {
      expect(resolveMerchantAlias(alias.normalizedDescription, aliases)).toBe(
        alias.merchantId,
      );
      expect(resolveMerchantAlias("Unlisted Shop", aliases)).toBeUndefined();
    }
    expect(aliases).toEqual(before);
  });

  it("uses derived normalized text while keeping raw source evidence unchanged", () => {
    const rawDescription = " \tSQ *Example   Shop\n ";
    const source = Object.freeze({ rawDescription });
    for (let iteration = 0; iteration < 3; iteration++) {
      const { normalizedDescription } = normalizePaymentProcessorPrefix(
        source.rawDescription,
      );
      expect(normalizedDescription).toBe(alias.normalizedDescription);
      expect(resolveMerchantAlias(normalizedDescription, [alias])).toBe(
        alias.merchantId,
      );
      expect(source.rawDescription).toBe(rawDescription);
    }
  });
});
