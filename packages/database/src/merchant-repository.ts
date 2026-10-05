import { Merchant } from "@aqchafold/domain";
import { eq } from "drizzle-orm";
import type { openLedgeraseDatabase } from "./database";
import { merchants } from "./schema";

/** Creates and reads canonical Merchant identities without resolution logic. */
export class MerchantRepository {
  constructor(
    private readonly database: ReturnType<typeof openLedgeraseDatabase>,
  ) {}

  create(merchant: Merchant): void {
    const validated = new Merchant(merchant);
    this.database
      .insert(merchants)
      .values({ id: validated.id, displayName: validated.displayName })
      .run();
  }

  getById(id: string): Merchant | undefined {
    const stored = this.database
      .select()
      .from(merchants)
      .where(eq(merchants.id, id))
      .get();
    return stored === undefined ? undefined : new Merchant(stored);
  }
}
