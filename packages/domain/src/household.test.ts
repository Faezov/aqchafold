import { describe, expect, it } from "vitest";
import { Household } from "./index";

const baseOptions = { id: "household-1", label: "Home finances" };

describe("Household", () => {
  it("creates a workspace and preserves valid identity and label verbatim", () => {
    const household = new Household({
      id: " household-1 ",
      label: "  Home finances  ",
    });
    expect(household.id).toBe(" household-1 ");
    expect(household.label).toBe("  Home finances  ");
  });

  it("rejects missing or non-object constructor options", () => {
    for (const options of [undefined, null, 123, "Home finances", true]) {
      expect(() => Reflect.construct(Household, [options])).toThrow(TypeError);
    }
  });

  it.each(["id", "label"] as const)(
    "requires a nonblank string %s without defaults",
    (field) => {
      const missing = { ...baseOptions };
      Reflect.deleteProperty(missing, field);
      expect(() => Reflect.construct(Household, [missing])).toThrow(TypeError);
      for (const value of [undefined, "", " \t ", null, 123]) {
        expect(() =>
          Reflect.construct(Household, [{ ...baseOptions, [field]: value }]),
        ).toThrow(TypeError);
      }
    },
  );

  it("allows equal labels across distinct identities without global construction limits", () => {
    const first = new Household({ ...baseOptions, id: "household-a" });
    const second = new Household({ ...baseOptions, id: "household-b" });
    expect(first.label).toBe(second.label);
    expect(first.id).toBe("household-a");
    expect(second.id).toBe("household-b");
    expect(first).not.toBe(second);
  });

  it("preserves identity across renamed snapshots without changing the original", () => {
    const original = new Household(baseOptions);
    const renamed = new Household({ ...original, label: "Our ledger" });
    expect(renamed.id).toBe(original.id);
    expect(renamed.label).toBe("Our ledger");
    expect(original.label).toBe("Home finances");
  });

  it("needs no Members and exposes only identity and label", () => {
    expect(Object.keys(new Household(baseOptions)).sort()).toEqual([
      "id",
      "label",
    ]);
  });

  it("copies fields and prevents runtime mutation, redefinition, deletion, and extension", () => {
    const options = { ...baseOptions };
    const household = new Household(options);
    options.id = "changed-id";
    options.label = "Changed label";
    for (const field of ["id", "label"] as const) {
      expect(Reflect.set(household, field, "changed")).toBe(false);
      expect(
        Reflect.defineProperty(household, field, { value: "changed" }),
      ).toBe(false);
      expect(Reflect.deleteProperty(household, field)).toBe(false);
    }
    expect(Reflect.set(household, "members", [])).toBe(false);
    expect(Object.isFrozen(household)).toBe(true);
    expect(household.id).toBe(baseOptions.id);
    expect(household.label).toBe(baseOptions.label);
  });
});
