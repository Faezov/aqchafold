export type MerchantOptions = {
  readonly id: string;
  readonly displayName: string;
};

/** Canonical Merchant identity; descriptors and association decisions are separate. */
export class Merchant {
  readonly id: string;
  readonly displayName: string;

  constructor(options: MerchantOptions) {
    if (typeof options !== "object" || options === null) {
      throw new TypeError("Merchant options must be an object.");
    }
    if (typeof options.id !== "string" || options.id.trim().length === 0) {
      throw new TypeError("Merchant ID must be a nonblank string.");
    }
    if (
      typeof options.displayName !== "string" ||
      options.displayName.trim().length === 0
    ) {
      throw new TypeError("Merchant display name must be a nonblank string.");
    }

    this.id = options.id;
    this.displayName = options.displayName;
    Object.freeze(this);
  }
}
