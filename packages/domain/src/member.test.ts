import { describe, expect, it } from "vitest";
import { Account, Household, Member, type MemberOptions } from "./index";

const baseOptions: MemberOptions = {
  id: "member-1",
  householdId: "household-1",
  displayName: "Alex",
  status: "active",
};

describe("Member", () => {
  it("creates an active participant and preserves valid strings verbatim", () => {
    const member = new Member({
      id: " member-1 ",
      householdId: " household-1 ",
      displayName: "  Alex  ",
      status: "active",
    });
    expect(member.id).toBe(" member-1 ");
    expect(member.householdId).toBe(" household-1 ");
    expect(member.displayName).toBe("  Alex  ");
    expect(member.status).toBe("active");
  });

  it("rejects missing or non-object constructor options", () => {
    for (const options of [undefined, null, 123, "Alex", true]) {
      expect(() => Reflect.construct(Member, [options])).toThrow(TypeError);
    }
  });

  it.each(["id", "householdId", "displayName"] as const)(
    "requires a nonblank string %s without defaults",
    (field) => {
      const missing = { ...baseOptions };
      Reflect.deleteProperty(missing, field);
      expect(() => Reflect.construct(Member, [missing])).toThrow(TypeError);
      for (const value of [undefined, "", " \t ", null, 123]) {
        expect(() =>
          Reflect.construct(Member, [{ ...baseOptions, [field]: value }]),
        ).toThrow(TypeError);
      }
    },
  );

  it.each(["active", "archived"] as const)("accepts %s status", (status) => {
    expect(new Member({ ...baseOptions, status }).status).toBe(status);
  });

  it("requires an explicit supported status without defaulting to active", () => {
    const missing = { ...baseOptions };
    Reflect.deleteProperty(missing, "status");
    expect(() => Reflect.construct(Member, [missing])).toThrow(TypeError);
    for (const status of [
      undefined,
      null,
      "",
      " active ",
      "Active",
      "deleted",
      123,
    ]) {
      expect(() =>
        Reflect.construct(Member, [{ ...baseOptions, status }]),
      ).toThrow(TypeError);
    }
  });

  it("allows equal display names without deriving or merging Member identity", () => {
    const first = new Member({ ...baseOptions, id: "member-a" });
    const second = new Member({ ...baseOptions, id: "member-b" });
    expect(first.displayName).toBe(second.displayName);
    expect(first.householdId).toBe(second.householdId);
    expect(first.id).toBe("member-a");
    expect(second.id).toBe("member-b");
    expect(first).not.toBe(second);
  });

  it("preserves Member and Household identity across renamed snapshots", () => {
    const original = new Member(baseOptions);
    const renamed = new Member({ ...original, displayName: "Alexandra" });
    expect(renamed.id).toBe(original.id);
    expect(renamed.householdId).toBe(original.householdId);
    expect(renamed.displayName).toBe("Alexandra");
    expect(original.displayName).toBe("Alex");
  });

  it("archives the last active Member and reactivates without changing Household or individual ownership", () => {
    const household = new Household({
      id: baseOptions.householdId,
      label: "Home finances",
    });
    const active = new Member(baseOptions);
    const account = new Account({
      id: "account-1",
      householdId: household.id,
      label: "Everyday account",
      type: "transaction",
      status: "active",
      primaryCurrency: "AUD",
      ownership: { kind: "individual", memberId: active.id },
    });
    const ownership = account.ownership;
    const archived = new Member({ ...active, status: "archived" });
    const reactivated = new Member({ ...archived, status: "active" });
    for (const snapshot of [active, archived, reactivated]) {
      expect(snapshot.id).toBe(active.id);
      expect(snapshot.householdId).toBe(household.id);
      expect(snapshot.householdId).toBe(account.householdId);
      expect(snapshot.displayName).toBe("Alex");
    }
    expect(active.status).toBe("active");
    expect(archived.status).toBe("archived");
    expect(reactivated.status).toBe("active");
    expect(account.ownership).toBe(ownership);
    expect(account.ownership).toEqual({
      kind: "individual",
      memberId: archived.id,
    });
    expect(household.id).toBe(baseOptions.householdId);
    expect(household.label).toBe("Home finances");
  });

  it("composes shared ownership within one Household without rewriting archived Member references", () => {
    const household = new Household({
      id: baseOptions.householdId,
      label: "Home finances",
    });
    const first = new Member(baseOptions);
    const second = new Member({
      ...baseOptions,
      id: "member-2",
      displayName: "Sam",
    });
    const account = new Account({
      id: "joint-account",
      householdId: household.id,
      label: "Shared account",
      type: "transaction",
      status: "active",
      primaryCurrency: "AUD",
      ownership: { kind: "shared", memberIds: [first.id, second.id] },
    });
    const ownership = account.ownership;
    const archived = new Member({ ...first, status: "archived" });
    expect(archived.householdId).toBe(account.householdId);
    expect(second.householdId).toBe(account.householdId);
    expect(account.ownership).toBe(ownership);
    expect(account.ownership).toEqual({
      kind: "shared",
      memberIds: [archived.id, second.id],
    });
    expect(first.status).toBe("active");
    expect(archived.status).toBe("archived");
  });

  it("exposes only local identity, Household reference, display name, and status", () => {
    expect(Object.keys(new Member(baseOptions)).sort()).toEqual([
      "displayName",
      "householdId",
      "id",
      "status",
    ]);
  });

  it("copies fields and prevents runtime mutation, redefinition, deletion, and extension", () => {
    const options = { ...baseOptions };
    const member = new Member(options);
    options.id = "changed-id";
    options.householdId = "changed-household";
    options.displayName = "Changed name";
    options.status = "archived";
    for (const field of [
      "id",
      "householdId",
      "displayName",
      "status",
    ] as const) {
      const value = field === "status" ? "archived" : "changed";
      expect(Reflect.set(member, field, value)).toBe(false);
      expect(Reflect.defineProperty(member, field, { value })).toBe(false);
      expect(Reflect.deleteProperty(member, field)).toBe(false);
    }
    expect(Reflect.set(member, "permissions", [])).toBe(false);
    expect(Object.isFrozen(member)).toBe(true);
    expect(member.id).toBe(baseOptions.id);
    expect(member.householdId).toBe(baseOptions.householdId);
    expect(member.displayName).toBe(baseOptions.displayName);
    expect(member.status).toBe(baseOptions.status);
  });
});
