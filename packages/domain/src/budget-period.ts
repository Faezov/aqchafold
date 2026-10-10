import { validateCalendarDate } from "./calendar-date";

export type BudgetPeriodOptions = {
  readonly startDate: string;
  readonly endDate: string;
};

/** An immutable, inclusive Gregorian date range, independent of budget allocations. */
export class BudgetPeriod {
  readonly startDate: string;
  readonly endDate: string;

  constructor(options: BudgetPeriodOptions) {
    if (typeof options !== "object" || options === null) {
      throw new TypeError("Budget period options must be an object.");
    }
    validateCalendarDate(options.startDate, "Budget period start date");
    validateCalendarDate(options.endDate, "Budget period end date");
    if (options.startDate > options.endDate) {
      throw new RangeError(
        "Budget period start date must not follow end date.",
      );
    }

    this.startDate = options.startDate;
    this.endDate = options.endDate;
    Object.freeze(this);
  }

  /** Both edges are included; budgeting callers supply Transaction.postingDate. */
  contains(date: string): boolean {
    validateCalendarDate(date, "Budget period membership date");
    return this.startDate <= date && date <= this.endDate;
  }
}
