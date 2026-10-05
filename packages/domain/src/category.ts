export type CategoryStatus = "active" | "archived";

export type CategoryOptions = {
  readonly id: string;
  readonly name: string;
  readonly status: CategoryStatus;
};

/** Flat economic-purpose identity; archived snapshots retain historical references. */
export class Category {
  readonly id: string;
  readonly name: string;
  readonly status: CategoryStatus;

  constructor(options: CategoryOptions) {
    if (typeof options !== "object" || options === null) {
      throw new TypeError("Category options must be an object.");
    }
    if (typeof options.id !== "string" || options.id.trim().length === 0) {
      throw new TypeError("Category ID must be a nonblank string.");
    }
    if (typeof options.name !== "string" || options.name.trim().length === 0) {
      throw new TypeError("Category name must be a nonblank string.");
    }
    if (options.status !== "active" && options.status !== "archived") {
      throw new TypeError("Category status must be active or archived.");
    }

    this.id = options.id;
    this.name = options.name;
    this.status = options.status;
    Object.freeze(this);
  }
}
