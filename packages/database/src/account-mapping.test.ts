import { Account, type AccountOwnership } from "@aqchafold/domain";
import { describe, expect, it } from "vitest";
import { accountFromRows } from "./account-mapping";
import type { accountMembers, accounts, members } from "./schema";

const accountRow: typeof accounts.$inferSelect = {
  id: "account-1",
  householdId: "household-1",
  label: "  Shared savings  ",
  type: "savings",
  status: "closed",
  primaryCurrency: "USD",
  ownershipKind: "unknown",
};
const memberRows: (typeof members.$inferSelect)[] = [
  {
    id: "member-a",
    householdId: "household-1",
    displayName: "Alex",
    status: "active",
  },
  {
    id: "member-b",
    householdId: "household-1",
    displayName: "Sam",
    status: "archived",
  },
];

function ownerRows(
  memberIds: readonly string[],
): (typeof accountMembers.$inferSelect)[] {
  return memberIds.map((memberId, memberOrder) => ({
    accountId: accountRow.id,
    memberId,
    memberOrder,
  }));
}

describe("Account row reconstruction (pure mapping, without SQLite)", () => {
  it.each([
    { kind: "individual", memberId: "member-b" },
    { kind: "shared", memberIds: ["member-b", "member-a"] },
    { kind: "household-level" },
    { kind: "unknown" },
  ] satisfies AccountOwnership[])("preserves $kind ownership", (ownership) => {
    const memberIds =
      ownership.kind === "individual"
        ? [ownership.memberId]
        : ownership.kind === "shared"
          ? ownership.memberIds
          : [];
    const rows = ownerRows(memberIds).reverse();
    const originalRows = [...rows];
    const account = accountFromRows(
      { ...accountRow, ownershipKind: ownership.kind },
      rows,
      memberRows,
    );
    expect(account).toBeInstanceOf(Account);
    expect(account).toEqual(new Account({ ...accountRow, ownership }));
    expect(account.ownership).toEqual(ownership);
    expect(rows).toEqual(originalRows);
  });

  it("rejects incorrect ownership cardinality without inferring a different kind", () => {
    for (const [ownershipKind, memberIds] of [
      ["individual", []],
      ["individual", ["member-a", "member-b"]],
      ["shared", []],
      ["shared", ["member-a"]],
      ["household-level", ["member-a"]],
      ["unknown", ["member-a"]],
    ] as const) {
      expect(() =>
        accountFromRows(
          { ...accountRow, ownershipKind },
          ownerRows(memberIds),
          memberRows,
        ),
      ).toThrow();
    }
  });

  it("rejects duplicate shared Members rather than deduplicating them", () => {
    expect(() =>
      accountFromRows(
        { ...accountRow, ownershipKind: "shared" },
        ownerRows(["member-a", "member-a"]),
        memberRows,
      ),
    ).toThrow("duplicate Member IDs");
  });

  it("rejects missing, duplicate, fractional, or negative ownership ordinals", () => {
    for (const orders of [
      [1, 2],
      [0, 2],
      [0, 0],
      [0, 0.5],
      [-1, 0],
    ]) {
      const rows = ownerRows(["member-a", "member-b"]).map((owner, index) => ({
        ...owner,
        memberOrder: orders[index],
      }));
      expect(() =>
        accountFromRows(
          { ...accountRow, ownershipKind: "shared" },
          rows,
          memberRows,
        ),
      ).toThrow("contiguous from zero");
    }
  });

  it("rejects ownership rows belonging to a different Account", () => {
    expect(() =>
      accountFromRows(
        { ...accountRow, ownershipKind: "individual" },
        [{ ...ownerRows(["member-a"])[0], accountId: "other-account" }],
        memberRows,
      ),
    ).toThrow("different Account");
  });

  it("rejects absent ownership Members without dropping their rows", () => {
    expect(() =>
      accountFromRows(
        { ...accountRow, ownershipKind: "shared" },
        ownerRows(["member-a", "member-b"]),
        [memberRows[0]],
      ),
    ).toThrow("missing Member");
  });

  it("rejects ownership Members from a different Household", () => {
    expect(() =>
      accountFromRows(
        { ...accountRow, ownershipKind: "individual" },
        ownerRows(["member-b"]),
        [{ ...memberRows[1], householdId: "other-household" }],
      ),
    ).toThrow("another Household");
  });

  it("uses domain validation for persisted Account and referenced Member fields", () => {
    expect(() =>
      accountFromRows({ ...accountRow, label: " " }, [], []),
    ).toThrow(TypeError);
    expect(() =>
      accountFromRows(
        { ...accountRow, ownershipKind: "individual" },
        ownerRows(["member-a"]),
        [{ ...memberRows[0], displayName: " " }],
      ),
    ).toThrow(TypeError);
    expect(() =>
      Reflect.apply(accountFromRows, undefined, [
        { ...accountRow, ownershipKind: "joint" },
        [],
        [],
      ]),
    ).toThrow("ownership kind is unsupported");
  });
});
