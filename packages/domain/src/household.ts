export type HouseholdOptions = {
  readonly id: string;
  readonly label: string;
};

/** Local finance workspace; store cardinality and membership queries belong to persistence. */
export class Household {
  readonly id: string;
  readonly label: string;

  constructor(options: HouseholdOptions) {
    if (typeof options !== "object" || options === null) {
      throw new TypeError("Household options must be an object.");
    }
    if (typeof options.id !== "string" || options.id.trim().length === 0) {
      throw new TypeError("Household ID must be a nonblank string.");
    }
    if (
      typeof options.label !== "string" ||
      options.label.trim().length === 0
    ) {
      throw new TypeError("Household label must be a nonblank string.");
    }

    this.id = options.id;
    this.label = options.label;
    Object.freeze(this);
  }
}
