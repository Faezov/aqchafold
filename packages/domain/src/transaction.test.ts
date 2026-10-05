import { describe, expect, it } from "vitest";
import { Money, Transaction, type TransactionOptions } from "./index";

const baseOptions: TransactionOptions = {
  id: "tx-1",
  accountId: "account-1",
  postingDate: "2026-10-05",
  amount: new Money(-1000, "AUD"),
  origin: "manual",
};

describe("Transaction", () => {
  it.each([
    ["checking purchase", "checking", -2000],
    ["checking salary", "checking", 5000],
    ["credit-card purchase", "credit-card", -2000],
    ["credit-card repayment", "credit-card", 5000],
    ["credit-card refund", "credit-card", 1500],
    ["outgoing transfer", "sending-account", -1000],
    ["incoming transfer", "receiving-account", 1000],
    ["zero movement", "checking", -0],
  ] as const)(
    "preserves %s as its supplied canonical balance change",
    (description, accountId, amountMinor) => {
      const amount = new Money(amountMinor, "AUD");
      const transaction = new Transaction({
        ...baseOptions,
        accountId,
        amount,
        origin: "imported",
        rawDescription: description,
      });
      expect(transaction.amount).toBe(amount);
      expect(transaction.amount.amountMinor).toBe(
        amountMinor === 0 ? 0 : amountMinor,
      );
      expect(transaction.amount.currency).toBe("AUD");
      expect(transaction.rawDescription).toBe(description);
    },
  );

  it("retains canonical zero without discarding the posted movement", () => {
    const transaction = new Transaction({
      ...baseOptions,
      amount: new Money(-0, "JPY"),
    });
    expect(Object.is(transaction.amount.amountMinor, 0)).toBe(true);
    expect(transaction.id).toBe(baseOptions.id);
    expect(transaction.amount.currency).toBe("JPY");
  });

  it("retains supplied identity independently of equal financial fields", () => {
    const first = new Transaction({ ...baseOptions, id: "tx-a" });
    const second = new Transaction({ ...baseOptions, id: "tx-b" });
    expect(first.id).toBe("tx-a");
    expect(second.id).toBe("tx-b");
    expect(first.accountId).toBe(second.accountId);
    expect(first.postingDate).toBe(second.postingDate);
    expect(first.amount.equals(second.amount)).toBe(true);
    expect(first).not.toBe(second);
  });

  it("keeps a positive refund separate from the unchanged negative purchase", () => {
    const purchase = new Transaction({ ...baseOptions, id: "purchase" });
    const refund = new Transaction({
      ...baseOptions,
      id: "refund",
      amount: new Money(500, "AUD"),
    });
    expect(purchase.id).toBe("purchase");
    expect(purchase.amount.amountMinor).toBe(-1000);
    expect(refund.id).toBe("refund");
    expect(refund.amount.amountMinor).toBe(500);
  });

  it("keeps supplied transfer sides as separate records on distinct posting dates", () => {
    const sent = new Transaction({
      ...baseOptions,
      id: "sent",
      accountId: "sending-account",
    });
    const received = new Transaction({
      ...baseOptions,
      id: "received",
      accountId: "receiving-account",
      postingDate: "2026-10-06",
      amount: new Money(1000, "AUD"),
    });
    expect(sent.id).toBe("sent");
    expect(received.id).toBe("received");
    expect(sent.accountId).not.toBe(received.accountId);
    expect(sent.postingDate).toBe("2026-10-05");
    expect(received.postingDate).toBe("2026-10-06");
    expect(sent.amount.amountMinor).toBe(-1000);
    expect(received.amount.amountMinor).toBe(1000);
  });

  it("leaves transaction date absent and preserves distinct or equal dates when supplied", () => {
    expect(new Transaction(baseOptions).transactionDate).toBeUndefined();
    for (const transactionDate of ["2026-10-01", "2026-10-05", "2026-10-06"]) {
      const transaction = new Transaction({ ...baseOptions, transactionDate });
      expect(transaction.postingDate).toBe("2026-10-05");
      expect(transaction.transactionDate).toBe(transactionDate);
    }
  });

  it("accepts real Gregorian calendar dates including leap centuries and year limits", () => {
    for (const date of [
      "2026-01-31",
      "2026-02-28",
      "2024-02-29",
      "2000-02-29",
      "0001-01-01",
      "9999-12-31",
    ]) {
      const transaction = new Transaction({
        ...baseOptions,
        postingDate: date,
        transactionDate: date,
      });
      expect(transaction.postingDate).toBe(date);
      expect(transaction.transactionDate).toBe(date);
    }
  });

  it("rejects impossible Gregorian dates in either date field", () => {
    for (const field of ["postingDate", "transactionDate"] as const) {
      for (const date of [
        "2026-02-29",
        "2026-02-30",
        "1900-02-29",
        "2026-04-31",
        "2026-13-01",
        "2026-00-10",
        "2026-10-00",
        "0000-01-01",
      ]) {
        expect(
          () => new Transaction({ ...baseOptions, [field]: date }),
        ).toThrow(RangeError);
      }
    }
  });

  it("rejects wrong date shapes, timestamps, whitespace, and non-string values", () => {
    for (const field of ["postingDate", "transactionDate"] as const) {
      for (const date of [
        "",
        "2026-2-28",
        "2026-10-05T00:00:00Z",
        "2026-10-05\n",
        " 2026-10-05",
        "2026-10-05 ",
        null,
        123,
      ]) {
        expect(() =>
          Reflect.construct(Transaction, [{ ...baseOptions, [field]: date }]),
        ).toThrow(TypeError);
      }
    }
  });

  it("requires identity, one Account reference, posting date, Money, and origin without defaults", () => {
    for (const field of [
      "id",
      "accountId",
      "postingDate",
      "amount",
      "origin",
    ]) {
      const options = { ...baseOptions, transactionDate: "2026-10-01" };
      Reflect.deleteProperty(options, field);
      expect(() => Reflect.construct(Transaction, [options])).toThrow(
        TypeError,
      );
    }
  });

  it("rejects invalid identifiers while preserving valid identifiers verbatim", () => {
    for (const field of [
      "id",
      "accountId",
      "merchantId",
      "categoryId",
    ] as const) {
      for (const value of ["", " \t ", null, 123]) {
        expect(() =>
          Reflect.construct(Transaction, [{ ...baseOptions, [field]: value }]),
        ).toThrow(TypeError);
      }
    }
    const transaction = new Transaction({
      ...baseOptions,
      id: " tx-1 ",
      accountId: " account-1 ",
    });
    expect(transaction.id).toBe(" tx-1 ");
    expect(transaction.accountId).toBe(" account-1 ");
  });

  it("requires an existing Money instance rather than a raw amount object", () => {
    for (const amount of [
      null,
      1234,
      { amountMinor: -1000, currency: "AUD" },
    ]) {
      expect(() =>
        Reflect.construct(Transaction, [{ ...baseOptions, amount }]),
      ).toThrow(TypeError);
    }
  });

  it("requires a valid explicit manual or imported origin", () => {
    for (const origin of ["", "bank", "MANUAL", null]) {
      expect(() =>
        Reflect.construct(Transaction, [{ ...baseOptions, origin }]),
      ).toThrow(TypeError);
    }
    expect(new Transaction(baseOptions).origin).toBe("manual");
    expect(new Transaction(baseOptions).rawDescription).toBeUndefined();
  });

  it("preserves imported raw descriptions exactly, including empty source text", () => {
    for (const rawDescription of ["", "  RAW *Purchase\n  "]) {
      const transaction = new Transaction({
        ...baseOptions,
        origin: "imported",
        rawDescription,
      });
      expect(transaction.origin).toBe("imported");
      expect(transaction.rawDescription).toBe(rawDescription);
    }
    const manual = new Transaction({
      ...baseOptions,
      rawDescription: "Manual description",
    });
    expect(manual.origin).toBe("manual");
    expect(manual.rawDescription).toBe("Manual description");
  });

  it("rejects missing imported descriptions and non-string raw descriptions", () => {
    for (const origin of ["manual", "imported"]) {
      for (const rawDescription of [null, 123]) {
        expect(() =>
          Reflect.construct(Transaction, [
            { ...baseOptions, origin, rawDescription },
          ]),
        ).toThrow(TypeError);
      }
    }
    expect(() =>
      Reflect.construct(Transaction, [{ ...baseOptions, origin: "imported" }]),
    ).toThrow(TypeError);
  });

  it("allows missing or independently supplied Merchant and Category references", () => {
    for (const relationships of [
      {},
      { merchantId: "merchant-1" },
      { categoryId: "category-1" },
      { merchantId: "merchant-1", categoryId: "category-1" },
    ]) {
      const transaction = new Transaction({ ...baseOptions, ...relationships });
      expect(transaction.merchantId).toBe(relationships.merchantId);
      expect(transaction.categoryId).toBe(relationships.categoryId);
    }
  });

  it("rejects non-object constructor options", () => {
    for (const options of [undefined, null, 123]) {
      expect(() => Reflect.construct(Transaction, [options])).toThrow(
        TypeError,
      );
    }
  });

  it("copies input fields and prevents runtime mutation or redefinition", () => {
    const options = {
      ...baseOptions,
      transactionDate: "2026-10-01",
      merchantId: "merchant-1",
      categoryId: "category-1",
      rawDescription: "Original description",
    };
    const transaction = new Transaction(options);
    options.id = "changed-id";
    options.postingDate = "2026-10-06";
    for (const field of [
      "id",
      "accountId",
      "postingDate",
      "transactionDate",
      "amount",
      "origin",
      "rawDescription",
      "merchantId",
      "categoryId",
    ]) {
      expect(Reflect.set(transaction, field, undefined)).toBe(false);
      expect(
        Reflect.defineProperty(transaction, field, { value: undefined }),
      ).toBe(false);
    }
    expect(Reflect.set(transaction.amount, "amountMinor", 999)).toBe(false);
    expect(transaction.id).toBe("tx-1");
    expect(transaction.postingDate).toBe("2026-10-05");
    expect(transaction.transactionDate).toBe("2026-10-01");
    expect(transaction.amount).toBe(baseOptions.amount);
    expect(transaction.rawDescription).toBe("Original description");
    expect(transaction.merchantId).toBe("merchant-1");
    expect(transaction.categoryId).toBe("category-1");
  });
});
