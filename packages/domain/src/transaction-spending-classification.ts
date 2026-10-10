export type SpendingClassification = "spending" | "not-spending";

export type TransactionSpendingClassificationOptions = {
  readonly transactionId: string;
  readonly classification: SpendingClassification;
};

/** Explicit local spending decision; absence of a decision remains unresolved. */
export class TransactionSpendingClassification {
  readonly transactionId: string;
  readonly classification: SpendingClassification;

  constructor(options: TransactionSpendingClassificationOptions) {
    if (typeof options !== "object" || options === null) {
      throw new TypeError(
        "Transaction spending classification options must be an object.",
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
      options.classification !== "spending" &&
      options.classification !== "not-spending"
    ) {
      throw new TypeError(
        "Spending classification must be spending or not-spending.",
      );
    }

    this.transactionId = options.transactionId;
    this.classification = options.classification;
    Object.freeze(this);
  }
}
