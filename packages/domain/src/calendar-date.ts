/** Validate canonical date-only Gregorian values without timezone conversion. */
export function validateCalendarDate(value: unknown, field: string): void {
  if (
    typeof value !== "string" ||
    value.length !== 10 ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)
  ) {
    throw new TypeError(`${field} must be a YYYY-MM-DD calendar date.`);
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  // Four-digit civil Gregorian years, without timestamps or timezone conversion.
  if (year < 1 || month < 1 || month > 12) {
    throw new RangeError(
      `${field} must be a valid Gregorian date in years 0001–9999.`,
    );
  }
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (day < 1 || day > daysInMonth[month - 1]) {
    throw new RangeError(`${field} must be a valid Gregorian calendar date.`);
  }
}
