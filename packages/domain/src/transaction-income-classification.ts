export type IncomeClassification = "income" | "not-income";

export type TransactionIncomeClassificationOptions = {
  readonly transactionId: string;
  readonly classification: IncomeClassification;
};

/** Explicit local income decision; absence of a decision remains unresolved. */
export class TransactionIncomeClassification {
  readonly transactionId: string;
  readonly classification: IncomeClassification;

  constructor(options: TransactionIncomeClassificationOptions) {
    if (typeof options !== "object" || options === null) {
      throw new TypeError(
        "Transaction income classification options must be an object.",
      );
    }
    if (
      typeof options.transactionId !== "string" ||
      options.transactionId.trim().length === 0
    ) {
      throw new TypeError(
        "Classification Transaction ID must be a nonblank string.",
      );
    }
    if (
      options.classification !== "income" &&
      options.classification !== "not-income"
    ) {
      throw new TypeError(
        "Income classification must be income or not-income.",
      );
    }

    this.transactionId = options.transactionId;
    this.classification = options.classification;
    Object.freeze(this);
  }
}
