import type { MerchantRule } from "@aqchafold/database";
import { Account, Merchant, Money, Transaction } from "@aqchafold/domain";
import { describe, expect, it, vi } from "vitest";
import {
  createMerchantReviewController,
  MERCHANT_CONFIRMATION_FAILURE_MESSAGE,
  type MerchantReviewState,
  type SuggestedMerchantReviewAction,
} from "./merchant-review-controller";

function setup() {
  const merchant = new Merchant({
    id: "canonical-id",
    displayName: "Canonical Café!",
  });
  const account = new Account({
    id: "account",
    householdId: "household",
    label: "Synthetic Account",
    type: "transaction",
    status: "active",
    primaryCurrency: "AUD",
    ownership: { kind: "unknown" },
  });
  const transactions = [
    new Transaction({
      id: "history",
      accountId: account.id,
      origin: "imported",
      postingDate: "2400-03-01",
      amount: new Money(-100, "AUD"),
      rawDescription: "SQ * Synthetic Shop",
      merchantId: merchant.id,
    }),
    new Transaction({
      id: "pending",
      accountId: account.id,
      origin: "imported",
      postingDate: "2400-03-02",
      amount: new Money(-200, "AUD"),
      rawDescription: " PAYPAL * Synthetic   Shop\r\nValue Date 01/03/2400",
    }),
    new Transaction({
      id: "unknown",
      accountId: account.id,
      origin: "imported",
      postingDate: "2400-03-02",
      amount: new Money(-100, "AUD"),
      rawDescription: "Other Shop",
    }),
  ];
  const rules: MerchantRule[] = [];
  const create = vi.fn((rule: MerchantRule) => {
    rules.push({ ...rule });
  });
  const list = vi.fn(() => transactions);
  const getById = vi.fn((id: string) =>
    id === merchant.id ? merchant : undefined,
  );
  let state: MerchantReviewState = { status: "loading" };
  const changes: MerchantReviewState[] = [];
  const controller = createMerchantReviewController(
    {
      accountRepository: { list: () => [account] },
      transactionRepository: { list },
      merchantRepository: { getById },
      merchantRuleRepository: {
        create,
        get: (householdId, normalizedDescription) =>
          rules.find(
            (rule) =>
              rule.householdId === householdId &&
              rule.normalizedDescription === normalizedDescription,
          ),
      },
    },
    (next) => {
      state = next;
      changes.push(next);
    },
  );

  function ready() {
    if (state.status !== "ready") throw new Error("Expected a ready review.");
    return state;
  }
  function action(): SuggestedMerchantReviewAction {
    const queue = ready().queues[0];
    const group = queue.groups.find((item) => item.status === "suggested");
    if (group === undefined || group.status !== "suggested")
      throw new Error("Expected a suggestion.");
    return { householdId: queue.householdId, group };
  }
  return {
    controller,
    ready,
    action,
    create,
    list,
    getById,
    transactions,
    rules,
    changes,
    state: () => state,
  };
}

describe("Merchant suggestion confirmation controller", () => {
  it("persists only the exact suggested identity and rebuilds without changing source Transactions", () => {
    const fixture = setup();
    const before = fixture.transactions.map((transaction) => ({
      ...transaction,
    }));
    fixture.controller.load();
    const action = fixture.action();
    expect(action.group.displayName).not.toBe(action.group.merchantId);
    fixture.controller.confirm(action);
    expect(fixture.create).toHaveBeenCalledExactlyOnceWith({
      householdId: "household",
      normalizedDescription: "Synthetic Shop",
      merchantId: "canonical-id",
    });
    expect(fixture.rules).toEqual([
      {
        householdId: "household",
        normalizedDescription: "Synthetic Shop",
        merchantId: "canonical-id",
      },
    ]);
    expect(
      fixture
        .ready()
        .queues[0].groups.map((group) => group.normalizedDescription),
    ).toEqual(["Other Shop"]);
    expect(fixture.list).toHaveBeenCalledTimes(2);
    expect(fixture.transactions).toEqual(before);
    expect(fixture.transactions[1].rawDescription).toBe(
      " PAYPAL * Synthetic   Shop\r\nValue Date 01/03/2400",
    );
    expect(fixture.transactions[1].merchantId).toBeUndefined();
  });

  it("blocks reentrant and rapid repeated taps and keeps the group until persistence succeeds", () => {
    const fixture = setup();
    fixture.controller.load();
    const action = fixture.action();
    const write = fixture.create.getMockImplementation()!;
    fixture.create.mockImplementationOnce((rule) => {
      expect(fixture.ready().submitting).toBe(true);
      expect(fixture.ready().queues[0].groups).toContain(action.group);
      fixture.controller.confirm(action);
      write(rule);
    });
    fixture.controller.confirm(action);
    fixture.controller.confirm(action);
    expect(fixture.create).toHaveBeenCalledTimes(1);
    expect(fixture.ready().submitting).toBe(false);
  });

  it("cannot confirm an unknown group", () => {
    const fixture = setup();
    fixture.controller.load();
    const queue = fixture.ready().queues[0];
    const group = queue.groups.find((item) => item.status === "unknown")!;
    const action = { householdId: queue.householdId, group };
    // @ts-expect-error Unknown groups cannot satisfy the confirmation contract.
    fixture.controller.confirm(action);
    expect(fixture.create).not.toHaveBeenCalled();
    expect(
      fixture
        .ready()
        .queues[0].groups.some((item) => item.status === "unknown"),
    ).toBe(true);
  });

  it("rejects fabricated or mismatched-Household actions outside the current suggestion snapshot", () => {
    const fixture = setup();
    fixture.controller.load();
    const action = fixture.action();
    fixture.controller.confirm({
      ...action,
      group: { ...action.group, merchantId: "arbitrary-id" },
    });
    fixture.controller.confirm({ ...action, householdId: "another-household" });
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it.each(["householdId", "normalizedDescription", "merchantId"] as const)(
    "rejects blank or non-string %s without a write",
    (field) => {
      for (const value of ["", " \t\n ", null, 42]) {
        const fixture = setup();
        fixture.controller.load();
        const action = fixture.action();
        const invalid =
          field === "householdId"
            ? { ...action, [field]: value }
            : { ...action, group: { ...action.group, [field]: value } };
        fixture.controller.confirm(invalid as SuggestedMerchantReviewAction);
        expect(fixture.create).not.toHaveBeenCalled();
        expect(fixture.ready().confirmationError).toBe(
          MERCHANT_CONFIRMATION_FAILURE_MESSAGE,
        );
      }
    },
  );

  it.each([null, undefined, { householdId: "household", group: null }])(
    "rejects malformed action %j without exposing diagnostics",
    (action) => {
      const fixture = setup();
      fixture.controller.load();
      fixture.controller.confirm(
        action as unknown as SuggestedMerchantReviewAction,
      );
      expect(fixture.create).not.toHaveBeenCalled();
      expect(fixture.ready().confirmationError).toBe(
        MERCHANT_CONFIRMATION_FAILURE_MESSAGE,
      );
    },
  );

  it.each([
    undefined,
    new Merchant({ id: "other-id", displayName: "Other Canonical Merchant" }),
  ])("rechecks the canonical Merchant before writing", (merchant) => {
    const fixture = setup();
    fixture.controller.load();
    const action = fixture.action();
    fixture.getById.mockReturnValueOnce(merchant);
    fixture.controller.confirm(action);
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.ready().confirmationError).toBe(
      MERCHANT_CONFIRMATION_FAILURE_MESSAGE,
    );
    expect(fixture.action().group.normalizedDescription).toBe("Synthetic Shop");
  });

  it("sanitizes failed persistence, reloads source truth and permits a fresh retry", () => {
    const fixture = setup();
    fixture.controller.load();
    const action = fixture.action();
    fixture.create.mockImplementationOnce(() => {
      throw new Error("SECRET SQL diagnostics");
    });
    fixture.controller.confirm(action);
    expect(fixture.ready().confirmationError).toBe(
      MERCHANT_CONFIRMATION_FAILURE_MESSAGE,
    );
    expect(JSON.stringify(fixture.changes)).not.toContain("SECRET");
    expect(fixture.list).toHaveBeenCalledTimes(2);
    expect(fixture.rules).toEqual([]);
    expect(
      fixture
        .ready()
        .queues[0].groups.map((group) => group.normalizedDescription),
    ).toEqual(["Synthetic Shop", "Other Shop"]);
    fixture.controller.confirm(action);
    expect(fixture.create).toHaveBeenCalledTimes(1);
    fixture.controller.confirm(fixture.action());
    expect(fixture.create).toHaveBeenCalledTimes(2);
    expect(fixture.ready().confirmationError).toBeUndefined();
  });

  it.each([true, false])(
    "shows a sanitized read error when refresh fails after persistence success=%s",
    (succeeds) => {
      const fixture = setup();
      fixture.controller.load();
      const action = fixture.action();
      fixture.list.mockImplementationOnce(() => {
        throw new Error("SECRET read failure");
      });
      if (!succeeds)
        fixture.create.mockImplementationOnce(() => {
          throw new Error("SECRET write failure");
        });
      fixture.controller.confirm(action);
      expect(fixture.state()).toEqual({
        status: "error",
        confirmationError: succeeds
          ? undefined
          : MERCHANT_CONFIRMATION_FAILURE_MESSAGE,
      });
      expect(JSON.stringify(fixture.changes)).not.toContain("SECRET");
      fixture.controller.confirm(action);
      expect(fixture.create).toHaveBeenCalledTimes(1);
    },
  );
});
