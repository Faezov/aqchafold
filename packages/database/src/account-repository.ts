import { Account, Household } from "@aqchafold/domain";
import { eq, inArray } from "drizzle-orm";
import { accountFromRows } from "./account-mapping";
import type { openLedgeraseDatabase } from "./database";
import { accountMembers, accounts, households, members } from "./schema";

/** Creates and reads canonical Accounts with ordered Household ownership. */
export class AccountRepository {
  constructor(
    private readonly database: ReturnType<typeof openLedgeraseDatabase>,
  ) {}

  create(account: Account): void {
    const validated = new Account(account);
    const accountRow = {
      id: validated.id,
      householdId: validated.householdId,
      label: validated.label,
      type: validated.type,
      status: validated.status,
      primaryCurrency: validated.primaryCurrency,
      ownershipKind: validated.ownership.kind,
    };
    let memberIds: readonly string[] = [];
    if (validated.ownership.kind === "individual") {
      memberIds = [validated.ownership.memberId];
    } else if (validated.ownership.kind === "shared") {
      memberIds = validated.ownership.memberIds;
    }
    const ownershipRows = memberIds.map((memberId, memberOrder) => ({
      accountId: validated.id,
      memberId,
      memberOrder,
    }));

    this.database.transaction(
      (transaction) => {
        const household = transaction
          .select()
          .from(households)
          .where(eq(households.id, validated.householdId))
          .get();
        if (household === undefined) {
          throw new Error("Account must reference an existing Household.");
        }
        new Household(household);
        const ownershipMembers =
          memberIds.length === 0
            ? []
            : transaction
                .select()
                .from(members)
                .where(inArray(members.id, [...memberIds]))
                .all();
        accountFromRows(accountRow, ownershipRows, ownershipMembers);

        transaction.insert(accounts).values(accountRow).run();
        if (ownershipRows.length !== 0) {
          transaction.insert(accountMembers).values(ownershipRows).run();
        }
      },
      { behavior: "immediate" },
    );
  }

  getById(id: string): Account | undefined {
    return this.database.transaction((transaction) => {
      const account = transaction
        .select()
        .from(accounts)
        .where(eq(accounts.id, id))
        .get();
      if (account === undefined) {
        return undefined;
      }
      const household = transaction
        .select()
        .from(households)
        .where(eq(households.id, account.householdId))
        .get();
      if (household === undefined) {
        throw new Error("Account must reference an existing Household.");
      }
      new Household(household);
      const ownershipRows = transaction
        .select()
        .from(accountMembers)
        .where(eq(accountMembers.accountId, account.id))
        .all();
      const ownershipMembers =
        ownershipRows.length === 0
          ? []
          : transaction
              .select()
              .from(members)
              .where(
                inArray(
                  members.id,
                  ownershipRows.map((row) => row.memberId),
                ),
              )
              .all();
      return accountFromRows(account, ownershipRows, ownershipMembers);
    });
  }

  /** Lists all local Accounts, including closed Accounts, in label/ID order. */
  list(): readonly Account[] {
    return this.database.transaction((transaction) => {
      const accountRows = transaction
        .select()
        .from(accounts)
        .orderBy(accounts.label, accounts.id)
        .all();
      if (accountRows.length === 0) {
        return [];
      }
      const householdRows = transaction.select().from(households).all();
      const ownershipRows = transaction.select().from(accountMembers).all();
      const memberRows = transaction.select().from(members).all();
      return accountRows.map((account) => {
        const household = householdRows.find(
          (row) => row.id === account.householdId,
        );
        if (household === undefined) {
          throw new Error("Account must reference an existing Household.");
        }
        new Household(household);
        return accountFromRows(
          account,
          ownershipRows.filter((row) => row.accountId === account.id),
          memberRows,
        );
      });
    });
  }
}
