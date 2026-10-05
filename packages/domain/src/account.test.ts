import { describe, expect, it } from "vitest";
import {
  Account,
  Money,
  Transaction,
  type AccountOptions,
  type AccountType,
} from "./index";

const baseOptions: AccountOptions = {
  id: "account-1",
  householdId: "household-1",
  label: "Everyday account",
  type: "transaction",
  status: "active",
  primaryCurrency: "AUD",
  ownership: { kind: "unknown" },
};

describe("Account", () => {
  it("preserves valid supplied fields without normalizing identifiers or labels", () => {
    const account = new Account({
      ...baseOptions,
      id: " account-1 ",
      householdId: " household-1 ",
      label: "  Everyday account  ",
    });
    expect(account.id).toBe(" account-1 ");
    expect(account.householdId).toBe(" household-1 ");
    expect(account.label).toBe("  Everyday account  ");
    expect(account.type).toBe("transaction");
    expect(account.status).toBe("active");
    expect(account.primaryCurrency).toBe("AUD");
  });

  it.each([
    "transaction",
    "savings",
    "credit-card",
    "cash",
    "other",
  ] satisfies AccountType[])(
    "preserves %s type without changing signed Transaction amounts",
    (type) => {
      const account = new Account({ ...baseOptions, type });
      expect(account.type).toBe(type);
      for (const amountMinor of [-2000, 0, 5000]) {
        const amount = new Money(amountMinor, account.primaryCurrency);
        const transaction = new Transaction({
          id: "tx-1",
          accountId: account.id,
          postingDate: "2026-10-05",
          amount,
          origin: "manual",
        });
        expect(transaction.accountId).toBe(account.id);
        expect(transaction.amount).toBe(amount);
        expect(transaction.amount.amountMinor).toBe(amountMinor);
        expect(account.type).toBe(type);
      }
    },
  );

  it("preserves identity, Household, and ownership across active and closed snapshots", () => {
    const active = new Account({
      ...baseOptions,
      ownership: { kind: "individual", memberId: "member-1" },
    });
    const closed = new Account({
      ...baseOptions,
      status: "closed",
      ownership: active.ownership,
    });
    expect(active.status).toBe("active");
    expect(closed.status).toBe("closed");
    expect(closed.id).toBe(active.id);
    expect(closed.householdId).toBe(active.householdId);
    expect(closed.ownership).toEqual(active.ownership);
    for (const account of [active, closed]) {
      expect(account).not.toHaveProperty("balance");
      expect(account).not.toHaveProperty("currentBalance");
      expect(account).not.toHaveProperty("transactions");
    }
  });

  it("allows duplicate labels and label changes without deriving identity", () => {
    const first = new Account({ ...baseOptions, id: "account-a" });
    const second = new Account({ ...baseOptions, id: "account-b" });
    const renamed = new Account({
      ...baseOptions,
      id: first.id,
      label: "New label",
    });
    expect(first.label).toBe(second.label);
    expect(first.id).not.toBe(second.id);
    expect(renamed.id).toBe(first.id);
    expect(renamed.label).toBe("New label");
    expect(renamed.householdId).toBe(first.householdId);
  });

  it("requires every canonical construction field without defaults", () => {
    for (const field of [
      "id",
      "householdId",
      "label",
      "type",
      "status",
      "primaryCurrency",
      "ownership",
    ]) {
      const options = { ...baseOptions };
      Reflect.deleteProperty(options, field);
      expect(() => Reflect.construct(Account, [options])).toThrow(TypeError);
    }
    for (const options of [undefined, null, 123]) {
      expect(() => Reflect.construct(Account, [options])).toThrow(TypeError);
    }
  });

  it("rejects blank or non-string identity, Household references, and labels", () => {
    for (const field of ["id", "householdId", "label"]) {
      for (const value of ["", " \t ", null, 123]) {
        expect(() =>
          Reflect.construct(Account, [{ ...baseOptions, [field]: value }]),
        ).toThrow(TypeError);
      }
    }
  });

  it("rejects unsupported types and statuses instead of mapping or defaulting them", () => {
    for (const type of ["checking", "loan", "TRANSACTION", null, 123]) {
      expect(() =>
        Reflect.construct(Account, [{ ...baseOptions, type }]),
      ).toThrow(TypeError);
    }
    for (const status of ["archived", "pending", "frozen", "deleted", null]) {
      expect(() =>
        Reflect.construct(Account, [{ ...baseOptions, status }]),
      ).toThrow(TypeError);
    }
  });

  it("accepts explicit structurally valid currencies without assuming an ISO registry", () => {
    for (const primaryCurrency of ["AUD", "USD", "JPY", "ZZZ"]) {
      expect(
        new Account({ ...baseOptions, primaryCurrency }).primaryCurrency,
      ).toBe(primaryCurrency);
    }
  });

  it("rejects malformed currency without normalization or an AUD default", () => {
    for (const primaryCurrency of [
      "aud",
      "Aud",
      "$",
      "AU",
      "AUDD",
      " AUD",
      "AUD ",
      "AUD\n",
      "A1D",
      "ÅUD",
      "",
      undefined,
      null,
      123,
    ]) {
      expect(() =>
        Reflect.construct(Account, [{ ...baseOptions, primaryCurrency }]),
      ).toThrow(TypeError);
    }
  });

  it("keeps unknown and household-level ownership distinct without Member references", () => {
    const unknown = new Account(baseOptions);
    const household = new Account({
      ...baseOptions,
      ownership: { kind: "household-level" },
    });
    expect(unknown.ownership).toEqual({ kind: "unknown" });
    expect(household.ownership).toEqual({ kind: "household-level" });
    const shared = new Account({
      ...baseOptions,
      ownership: { kind: "shared", memberIds: ["member-a", "member-b"] },
    });
    expect(household.ownership).not.toEqual(shared.ownership);
  });

  it("preserves one explicit individual Member reference", () => {
    const ownership = { kind: "individual" as const, memberId: " member-a " };
    const account = new Account({ ...baseOptions, ownership });
    ownership.memberId = "changed-member";
    expect(account.ownership).toEqual({
      kind: "individual",
      memberId: " member-a ",
    });
  });

  it("rejects missing, blank, or non-string individual Member IDs", () => {
    for (const memberId of [undefined, "", " \t ", null, 123]) {
      expect(() =>
        Reflect.construct(Account, [
          { ...baseOptions, ownership: { kind: "individual", memberId } },
        ]),
      ).toThrow(TypeError);
    }
  });

  it("preserves explicit shared Member IDs and order without assuming shares", () => {
    for (const memberIds of [
      ["member-a", "member-b"],
      [" member-a ", "member-b", "member-c"],
    ]) {
      const account = new Account({
        ...baseOptions,
        ownership: { kind: "shared", memberIds },
      });
      expect(account.ownership).toEqual({ kind: "shared", memberIds });
    }
  });

  it("rejects short or duplicate shared Member lists instead of deduplicating them", () => {
    for (const memberIds of [
      [],
      ["member-a"],
      ["member-a", "member-a"],
      ["member-a", "member-b", "member-a"],
    ]) {
      expect(
        () =>
          new Account({
            ...baseOptions,
            ownership: { kind: "shared", memberIds },
          }),
      ).toThrow(RangeError);
    }
  });

  it("rejects malformed shared collections, Member IDs, and sparse arrays", () => {
    const sparse = ["member-a", "member-b"];
    Reflect.deleteProperty(sparse, "1");
    for (const memberIds of [
      undefined,
      null,
      "member-a",
      ["member-a", ""],
      ["member-a", " \t "],
      ["member-a", 123],
      sparse,
    ]) {
      expect(() =>
        Reflect.construct(Account, [
          { ...baseOptions, ownership: { kind: "shared", memberIds } },
        ]),
      ).toThrow(TypeError);
    }
  });

  it("rejects missing, unknown, or contradictory ownership shapes", () => {
    for (const ownership of [
      null,
      "unknown",
      {},
      { kind: "joint" },
      {
        kind: "individual",
        memberId: "member-a",
        memberIds: ["member-a", "member-b"],
      },
      {
        kind: "shared",
        memberIds: ["member-a", "member-b"],
        memberId: "member-a",
      },
      { kind: "household-level", memberIds: [] },
      { kind: "unknown", memberId: undefined },
    ]) {
      expect(() =>
        Reflect.construct(Account, [{ ...baseOptions, ownership }]),
      ).toThrow(TypeError);
    }
  });

  it("copies and freezes shared ownership so caller mutation cannot alter the Account", () => {
    const memberIds = ["member-a", "member-b"];
    const ownership = { kind: "shared" as const, memberIds };
    const account = new Account({ ...baseOptions, ownership });
    memberIds[0] = "changed-member";
    memberIds.push("member-c");
    ownership.memberIds = ["replacement-a", "replacement-b"];
    expect(account.ownership).toEqual({
      kind: "shared",
      memberIds: ["member-a", "member-b"],
    });
    expect(account.ownership).not.toBe(ownership);
    expect(Reflect.set(account.ownership, "kind", "unknown")).toBe(false);
    if (account.ownership.kind !== "shared")
      throw new Error("Expected shared ownership.");
    expect(account.ownership.memberIds).not.toBe(memberIds);
    expect(
      Reflect.set(account.ownership.memberIds, "0", "changed-member"),
    ).toBe(false);
    expect(Reflect.set(account.ownership.memberIds, "length", 0)).toBe(false);
    const frozenMembers = account.ownership.memberIds;
    expect(() =>
      Reflect.apply(Array.prototype.push, frozenMembers, ["member-c"]),
    ).toThrow(TypeError);
  });

  it("freezes every ownership variant and the Account snapshot", () => {
    for (const ownership of [
      { kind: "individual", memberId: "member-a" },
      { kind: "shared", memberIds: ["member-a", "member-b"] },
      { kind: "household-level" },
      { kind: "unknown" },
    ] as const) {
      const options = { ...baseOptions, ownership };
      const account = new Account(options);
      options.label = "Changed label";
      for (const field of [
        "id",
        "householdId",
        "label",
        "type",
        "status",
        "primaryCurrency",
        "ownership",
      ]) {
        expect(Reflect.set(account, field, undefined)).toBe(false);
        expect(
          Reflect.defineProperty(account, field, { value: undefined }),
        ).toBe(false);
      }
      const changedKind =
        ownership.kind === "unknown" ? "household-level" : "unknown";
      expect(Reflect.set(account.ownership, "kind", changedKind)).toBe(false);
      expect(
        Reflect.defineProperty(account.ownership, "kind", {
          value: changedKind,
        }),
      ).toBe(false);
      expect(account.label).toBe(baseOptions.label);
      expect(account.id).toBe(baseOptions.id);
      expect(account.ownership).toEqual(ownership);
    }
  });
});
