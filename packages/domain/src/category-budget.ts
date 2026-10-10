import { Money } from "./money";

export type CategoryBudgetRole = "spending" | "income";
export type SpendingCharacter = "essential" | "discretionary";
export type SpendingRegularity = "regular" | "irregular";

export type CategoryBudgetOptions = {
  readonly categoryId: string;
  readonly amount: Money;
} & (
  | {
      readonly role: "spending";
      readonly spendingCharacter: SpendingCharacter;
      readonly spendingRegularity: SpendingRegularity;
    }
  | {
      readonly role: "income";
      readonly spendingCharacter?: never;
      readonly spendingRegularity?: never;
    }
);

/** Immutable planned category target; its containing Budget supplies shared context. */
export class CategoryBudget {
  readonly categoryId: string;
  readonly amount: Money;
  readonly role: CategoryBudgetRole;
  // Income values have neither spending field, including after object spread.
  declare readonly spendingCharacter?: SpendingCharacter;
  declare readonly spendingRegularity?: SpendingRegularity;

  constructor(options: CategoryBudgetOptions) {
    if (typeof options !== "object" || options === null) {
      throw new TypeError("Category budget options must be an object.");
    }
    if (
      typeof options.categoryId !== "string" ||
      options.categoryId.trim().length === 0
    ) {
      throw new TypeError(
        "Category budget category ID must be a nonblank string.",
      );
    }
    if (!(options.amount instanceof Money)) {
      throw new TypeError("Category budget amount must be a Money instance.");
    }
    if (options.amount.amountMinor < 0) {
      throw new RangeError("Category budget amount must be nonnegative.");
    }
    if (options.role !== "spending" && options.role !== "income") {
      throw new TypeError("Category budget role must be spending or income.");
    }
    if (options.role === "spending") {
      if (
        options.spendingCharacter !== "essential" &&
        options.spendingCharacter !== "discretionary"
      ) {
        throw new TypeError(
          "Spending targets require an explicit essential or discretionary character.",
        );
      }
      if (
        options.spendingRegularity !== "regular" &&
        options.spendingRegularity !== "irregular"
      ) {
        throw new TypeError(
          "Spending regularity must be explicitly regular or irregular.",
        );
      }
      this.spendingCharacter = options.spendingCharacter;
      this.spendingRegularity = options.spendingRegularity;
    } else if (
      "spendingCharacter" in options ||
      "spendingRegularity" in options
    ) {
      throw new TypeError(
        "Income targets must not have spending character or regularity.",
      );
    }

    this.categoryId = options.categoryId;
    this.amount = options.amount;
    this.role = options.role;
    Object.freeze(this);
  }
}
