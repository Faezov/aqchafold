import { Household } from "@aqchafold/domain";
import type { openLedgeraseDatabase } from "./database";
import { households } from "./schema";

/** Creates and reads the single local v0.1 Household. */
export class HouseholdRepository {
  constructor(
    private readonly database: Pick<
      ReturnType<typeof openLedgeraseDatabase>,
      "select" | "transaction"
    >,
  ) {}

  create(household: Household): void {
    const validated = new Household(household);
    this.database.transaction(
      (transaction) => {
        const existing = transaction.select().from(households).limit(2).all();
        if (existing.length > 1) {
          throw new Error("Local store contains multiple Households.");
        }
        if (existing.length !== 0) {
          throw new Error("Local store already contains a Household.");
        }
        transaction
          .insert(households)
          .values({ id: validated.id, label: validated.label })
          .run();
      },
      { behavior: "immediate" },
    );
  }

  get(): Household | undefined {
    const stored = this.database.select().from(households).limit(2).all();
    if (stored.length > 1) {
      throw new Error("Local store contains multiple Households.");
    }
    const household = stored[0];
    return household === undefined ? undefined : new Household(household);
  }
}
