import { Account, Member, type AccountOwnership } from "@aqchafold/domain";
import type { accountMembers, accounts, members } from "./schema";

/** Reconstruct canonical ownership without discarding malformed persisted rows. */
export function accountFromRows(
  row: typeof accounts.$inferSelect,
  ownershipRows: readonly (typeof accountMembers.$inferSelect)[],
  memberRows: readonly (typeof members.$inferSelect)[],
): Account {
  const orderedRows = [...ownershipRows].sort(
    (left, right) => left.memberOrder - right.memberOrder,
  );
  for (const [index, owner] of orderedRows.entries()) {
    if (owner.accountId !== row.id) {
      throw new Error("Account ownership row references a different Account.");
    }
    if (owner.memberOrder !== index) {
      throw new Error("Account ownership order must be contiguous from zero.");
    }
  }

  let ownership: AccountOwnership;
  switch (row.ownershipKind) {
    case "individual":
      if (orderedRows.length !== 1) {
        throw new Error("Individual Account ownership requires one Member.");
      }
      ownership = { kind: "individual", memberId: orderedRows[0].memberId };
      break;
    case "shared":
      ownership = {
        kind: "shared",
        memberIds: orderedRows.map((owner) => owner.memberId),
      };
      break;
    case "household-level":
    case "unknown":
      if (orderedRows.length !== 0) {
        throw new Error(
          "Household-level and unknown Account ownership cannot reference Members.",
        );
      }
      ownership = { kind: row.ownershipKind };
      break;
    default:
      throw new Error("Persisted Account ownership kind is unsupported.");
  }

  const account = new Account({
    id: row.id,
    householdId: row.householdId,
    label: row.label,
    type: row.type,
    status: row.status,
    primaryCurrency: row.primaryCurrency,
    ownership,
  });
  for (const owner of orderedRows) {
    const memberRow = memberRows.find((member) => member.id === owner.memberId);
    if (memberRow === undefined) {
      throw new Error("Account ownership references a missing Member.");
    }
    const member = new Member(memberRow);
    if (member.householdId !== account.householdId) {
      throw new Error("Account ownership Member belongs to another Household.");
    }
  }
  return account;
}
