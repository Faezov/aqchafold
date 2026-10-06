import { Account, Household } from "@aqchafold/domain";
import { AccountRepository } from "./account-repository";
import type { openLedgeraseDatabase } from "./database";
import { HouseholdRepository } from "./household-repository";

/** Create a local Account and, when needed, its explicitly supplied Household. */
export function createLocalAccount(
  database: ReturnType<typeof openLedgeraseDatabase>,
  context: { account: Account; newHousehold?: Household },
): void {
  try {
    const account = new Account(context.account);
    const newHousehold =
      context.newHousehold === undefined
        ? undefined
        : new Household(context.newHousehold);
    if (newHousehold && newHousehold.id !== account.householdId)
      throw new Error("Account and new Household must share context.");

    database.transaction(
      (transaction) => {
        const households = new HouseholdRepository(transaction);
        const existing = households.get();
        if (existing === undefined) {
          if (newHousehold === undefined)
            throw new Error("An explicit Household is required.");
          households.create(newHousehold);
        } else if (existing.id !== account.householdId) {
          throw new Error("Account must use the existing Household.");
        }
        new AccountRepository(transaction).create(account);
      },
      { behavior: "immediate" },
    );
  } catch {
    // Native/Drizzle failures may contain SQL parameters and user-entered values.
    throw new Error("Local account setup failed.");
  }
}
