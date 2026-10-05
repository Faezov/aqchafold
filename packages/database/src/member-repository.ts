import { Household, Member } from "@aqchafold/domain";
import { eq } from "drizzle-orm";
import type { openLedgeraseDatabase } from "./database";
import { households, members } from "./schema";

/** Creates and reads local Members, including archived participants. */
export class MemberRepository {
  constructor(
    private readonly database: ReturnType<typeof openLedgeraseDatabase>,
  ) {}

  create(member: Member): void {
    const validated = new Member(member);
    this.database.transaction(
      (transaction) => {
        const household = transaction
          .select()
          .from(households)
          .where(eq(households.id, validated.householdId))
          .get();
        if (household === undefined) {
          throw new Error("Member must reference an existing Household.");
        }
        new Household(household);
        transaction
          .insert(members)
          .values({
            id: validated.id,
            householdId: validated.householdId,
            displayName: validated.displayName,
            status: validated.status,
          })
          .run();
      },
      { behavior: "immediate" },
    );
  }

  getById(id: string): Member | undefined {
    return this.database.transaction((transaction) => {
      const stored = transaction
        .select()
        .from(members)
        .where(eq(members.id, id))
        .get();
      if (stored === undefined) {
        return undefined;
      }
      const member = new Member(stored);
      const household = transaction
        .select()
        .from(households)
        .where(eq(households.id, member.householdId))
        .get();
      if (household === undefined) {
        throw new Error("Member must reference an existing Household.");
      }
      new Household(household);
      return member;
    });
  }
}
