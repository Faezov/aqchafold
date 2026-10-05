export class Money {
  readonly amountMinor: number;
  readonly currency: string;

  constructor(amountMinor: number, currency: string) {
    if (!Number.isSafeInteger(amountMinor)) {
      throw new RangeError(
        "Money amount must be a safe integer in minor units.",
      );
    }
    // Structural validation only; supported currencies and metadata remain open.
    if (
      typeof currency !== "string" ||
      currency.length !== 3 ||
      !/^[A-Z]{3}$/.test(currency)
    ) {
      throw new TypeError(
        "Money currency must be three uppercase ASCII letters.",
      );
    }

    this.amountMinor = amountMinor === 0 ? 0 : amountMinor;
    this.currency = currency;
    Object.freeze(this);
  }

  equals(other: Money): boolean {
    return (
      this.amountMinor === other.amountMinor && this.currency === other.currency
    );
  }

  add(other: Money): Money {
    this.requireMatchingCurrency(other);
    return new Money(this.amountMinor + other.amountMinor, this.currency);
  }

  subtract(other: Money): Money {
    this.requireMatchingCurrency(other);
    return new Money(this.amountMinor - other.amountMinor, this.currency);
  }

  compare(other: Money): -1 | 0 | 1 {
    this.requireMatchingCurrency(other);
    if (this.amountMinor < other.amountMinor) return -1;
    if (this.amountMinor > other.amountMinor) return 1;
    return 0;
  }

  private requireMatchingCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new RangeError(
        "Money currencies must match for arithmetic or ordering.",
      );
    }
  }
}
