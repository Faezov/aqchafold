import { validateCalendarDate } from "./calendar-date";
import { Money } from "./money";

export type TransactionOptions = {
  readonly id: string;
  readonly accountId: string;
  readonly postingDate: string;
  readonly transactionDate?: string;
  readonly amount: Money;
  readonly merchantId?: string;
  readonly categoryId?: string;
} & (
  | { readonly origin: "manual"; readonly rawDescription?: string }
  | { readonly origin: "imported"; readonly rawDescription: string }
);

/**
 * A posted Account movement: positive increases its canonical balance,
 * negative decreases it, and zero leaves it unchanged for every Account type.
 * Economic classification is separate and is not inferred here.
 */
export class Transaction {
  readonly id: string;
  readonly accountId: string;
  readonly postingDate: string;
  readonly transactionDate?: string;
  readonly amount: Money;
  readonly origin: "manual" | "imported";
  readonly rawDescription?: string;
  readonly merchantId?: string;
  readonly categoryId?: string;

  constructor(options: TransactionOptions) {
    if (typeof options !== "object" || options === null) {
      throw new TypeError("Transaction options must be an object.");
    }
    validateIdentifier(options.id, "Transaction ID");
    validateIdentifier(options.accountId, "Account ID");
    validateCalendarDate(options.postingDate, "Posting date");
    if (options.transactionDate !== undefined) {
      validateCalendarDate(options.transactionDate, "Transaction date");
    }
    if (!(options.amount instanceof Money)) {
      throw new TypeError("Transaction amount must be a Money instance.");
    }
    if (options.origin !== "manual" && options.origin !== "imported") {
      throw new TypeError("Transaction origin must be manual or imported.");
    }
    // Detailed source provenance belongs to the later Import implementation.
    if (
      (options.origin === "imported" || options.rawDescription !== undefined) &&
      typeof options.rawDescription !== "string"
    ) {
      throw new TypeError(
        "Transaction raw description must be a string when supplied or imported.",
      );
    }
    if (options.merchantId !== undefined) {
      validateIdentifier(options.merchantId, "Merchant ID");
    }
    if (options.categoryId !== undefined) {
      validateIdentifier(options.categoryId, "Category ID");
    }

    this.id = options.id;
    this.accountId = options.accountId;
    this.postingDate = options.postingDate;
    this.transactionDate = options.transactionDate;
    this.amount = options.amount;
    this.origin = options.origin;
    this.rawDescription = options.rawDescription;
    this.merchantId = options.merchantId;
    this.categoryId = options.categoryId;
    Object.freeze(this);
  }
}

function validateIdentifier(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a nonblank string.`);
  }
}
