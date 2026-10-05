export type AccountType =
  "transaction" | "savings" | "credit-card" | "cash" | "other";
export type AccountStatus = "active" | "closed";
export type AccountOwnership =
  | { readonly kind: "individual"; readonly memberId: string }
  | { readonly kind: "shared"; readonly memberIds: readonly string[] }
  | { readonly kind: "household-level" }
  | { readonly kind: "unknown" };

export type AccountOptions = {
  readonly id: string;
  readonly householdId: string;
  readonly label: string;
  readonly type: AccountType;
  readonly status: AccountStatus;
  readonly primaryCurrency: string;
  readonly ownership: AccountOwnership;
};

/**
 * Account context within a Household ledger, independent of legal ownership.
 * Canonical positive balances are value held or owed to the user; negative
 * balances are debt, and zero is neutral. Type and status do not constrain signs.
 * Known balances require as-of evidence and verification; unknown is not zero.
 */
export class Account {
  readonly id: string;
  readonly householdId: string;
  readonly label: string;
  readonly type: AccountType;
  readonly status: AccountStatus;
  // Referencing Transactions must use this currency; integration validates that.
  readonly primaryCurrency: string;
  // Individual/shared Members must belong to this Household; lookup is deferred.
  readonly ownership: AccountOwnership;

  constructor(options: AccountOptions) {
    if (typeof options !== "object" || options === null) {
      throw new TypeError("Account options must be an object.");
    }
    validateNonblankString(options.id, "Account ID");
    validateNonblankString(options.householdId, "Household ID");
    validateNonblankString(options.label, "Account label");
    if (
      !["transaction", "savings", "credit-card", "cash", "other"].includes(
        options.type,
      )
    ) {
      throw new TypeError("Account type must be a supported canonical type.");
    }
    if (options.status !== "active" && options.status !== "closed") {
      throw new TypeError("Account status must be active or closed.");
    }
    // Same temporary structural boundary as Money, without an ISO/support registry.
    if (
      typeof options.primaryCurrency !== "string" ||
      options.primaryCurrency.length !== 3 ||
      !/^[A-Z]{3}$/.test(options.primaryCurrency)
    ) {
      throw new TypeError(
        "Account currency must be three uppercase ASCII letters.",
      );
    }

    this.ownership = copyOwnership(options.ownership);
    this.id = options.id;
    this.householdId = options.householdId;
    this.label = options.label;
    this.type = options.type;
    this.status = options.status;
    this.primaryCurrency = options.primaryCurrency;
    Object.freeze(this);
  }
}

function validateNonblankString(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a nonblank string.`);
  }
}

function copyOwnership(value: AccountOwnership): AccountOwnership {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(
      "Account ownership must be an explicit ownership object.",
    );
  }
  switch (value.kind) {
    case "individual":
      if ("memberIds" in value) {
        throw new TypeError(
          "Individual ownership must identify one Member only.",
        );
      }
      validateNonblankString(value.memberId, "Member ID");
      return Object.freeze({ kind: "individual", memberId: value.memberId });
    case "shared": {
      if ("memberId" in value || !Array.isArray(value.memberIds)) {
        throw new TypeError("Shared ownership must supply a Member ID array.");
      }
      const memberIds = [...value.memberIds];
      if (memberIds.length < 2) {
        throw new RangeError(
          "Shared ownership requires at least two distinct Members.",
        );
      }
      for (const memberId of memberIds) {
        validateNonblankString(memberId, "Member ID");
      }
      if (new Set(memberIds).size !== memberIds.length) {
        throw new RangeError(
          "Shared ownership must not contain duplicate Member IDs.",
        );
      }
      return Object.freeze({
        kind: "shared",
        memberIds: Object.freeze(memberIds),
      });
    }
    case "household-level":
    case "unknown":
      if ("memberId" in value || "memberIds" in value) {
        throw new TypeError(
          "Household-level and unknown ownership must not identify Members.",
        );
      }
      return Object.freeze({ kind: value.kind });
    default:
      throw new TypeError(
        "Account ownership kind must be a supported association.",
      );
  }
}
