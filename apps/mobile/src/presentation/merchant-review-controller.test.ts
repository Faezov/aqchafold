import type {
  CategoryRule,
  MerchantRule,
  RememberedTransactionCategoryAssignment,
} from "@aqchafold/database";
import {
  Account,
  Category,
  Merchant,
  Money,
  Transaction,
} from "@aqchafold/domain";
import { describe, expect, it, vi } from "vitest";
import {
  createMerchantReviewController,
  CATEGORY_ASSIGNMENT_FAILURE_MESSAGE,
  MERCHANT_CONFIRMATION_FAILURE_MESSAGE,
  type MerchantReviewState,
  type MerchantReviewCategoryAction,
  type SuggestedMerchantReviewAction,
} from "./merchant-review-controller";

function withCategory(
  transaction: Transaction,
  categoryId: string,
): Transaction {
  const options = { ...transaction, categoryId };
  return transaction.origin === "imported"
    ? new Transaction({
        ...options,
        origin: "imported",
        rawDescription: transaction.rawDescription!,
      })
    : new Transaction({ ...options, origin: "manual" });
}

function setup(
  categories = [
    new Category({ id: "category-a", name: "Alpha purpose", status: "active" }),
    new Category({
      id: "archived",
      name: "Beta past purpose",
      status: "archived",
    }),
    new Category({ id: "category-b", name: "Gamma purpose", status: "active" }),
  ],
) {
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
  const categoryRules: CategoryRule[] = [];
  const create = vi.fn((rule: MerchantRule) => {
    rules.push({ ...rule });
  });
  const list = vi.fn(() => transactions);
  const getCategoryById = vi.fn((id: string) =>
    categories.find((category) => category.id === id),
  );
  const assignCategory = vi.fn(
    (input: {
      householdId: string;
      transactionIds: readonly string[];
      categoryId: string;
    }) => {
      for (const id of input.transactionIds) {
        const index = transactions.findIndex(
          (transaction) => transaction.id === id,
        );
        transactions[index] = withCategory(
          transactions[index],
          input.categoryId,
        );
      }
    },
  );
  const assignCategoryAndRemember = vi.fn(
    (input: RememberedTransactionCategoryAssignment) => {
      if (
        categoryRules.some(
          (rule) =>
            rule.householdId === input.householdId &&
            rule.normalizedDescription === input.normalizedDescription,
        )
      ) {
        throw new Error("SECRET duplicate category rule");
      }
      assignCategory({
        householdId: input.householdId,
        transactionIds: input.transactionIds,
        categoryId: input.categoryId,
      });
      categoryRules.push({
        householdId: input.householdId,
        normalizedDescription: input.normalizedDescription,
        categoryId: input.categoryId,
      });
    },
  );
  const getById = vi.fn((id: string) =>
    id === merchant.id ? merchant : undefined,
  );
  let state: MerchantReviewState = { status: "loading" };
  const changes: MerchantReviewState[] = [];
  const controller = createMerchantReviewController(
    {
      accountRepository: { list: () => [account] },
      categoryRepository: { list: () => categories, getById: getCategoryById },
      assignCategoryAndRemember,
      transactionRepository: { list, assignCategory },
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
  function categoryAction(
    categoryId = "category-a",
    status: "suggested" | "unknown" = "suggested",
  ): MerchantReviewCategoryAction {
    const queue = ready().queues[0];
    const group = queue.groups.find((item) => item.status === status)!;
    return { householdId: queue.householdId, group, categoryId };
  }
  return {
    controller,
    ready,
    action,
    categoryAction,
    categories,
    getCategoryById,
    assignCategory,
    assignCategoryAndRemember,
    categoryRules,
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

describe("Merchant review category assignment controller", () => {
  it("offers persisted active Categories in repository order and displays an archived current Category", () => {
    const fixture = setup();
    fixture.transactions[1] = withCategory(fixture.transactions[1], "archived");
    fixture.controller.load();
    expect(fixture.ready().activeCategories).toEqual([
      fixture.categories[0],
      fixture.categories[2],
    ]);
    expect(fixture.categoryAction().group.categoryState).toEqual({
      kind: "categorized",
      category: fixture.categories[1],
    });
    expect(fixture.assignCategory).not.toHaveBeenCalled();
  });

  it("loads an explicit empty choice list without seeding or assigning anything", () => {
    const fixture = setup([]);
    fixture.controller.load();
    expect(fixture.ready().activeCategories).toEqual([]);
    expect(fixture.categoryAction().group.categoryState).toEqual({
      kind: "uncategorized",
    });
    expect(fixture.assignCategory).not.toHaveBeenCalled();
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it.each([undefined, false, true])(
    "assigns the current group with explicit remember opt-in=%s",
    (rememberForFuture) => {
      const fixture = setup();
      const before = fixture.transactions.map((transaction) => ({
        ...transaction,
      }));
      fixture.controller.load();
      const action = { ...fixture.categoryAction(), rememberForFuture };
      fixture.controller.applyCategory(action);
      expect(fixture.getCategoryById).toHaveBeenCalledExactlyOnceWith(
        "category-a",
      );
      expect(fixture.assignCategory).toHaveBeenCalledExactlyOnceWith({
        householdId: "household",
        transactionIds: action.group.transactionIds,
        categoryId: "category-a",
      });
      if (rememberForFuture === true) {
        expect(
          fixture.assignCategoryAndRemember,
        ).toHaveBeenCalledExactlyOnceWith({
          householdId: "household",
          transactionIds: action.group.transactionIds,
          categoryId: "category-a",
          normalizedDescription: "Synthetic Shop",
        });
        expect(fixture.categoryRules).toEqual([
          {
            householdId: "household",
            normalizedDescription: "Synthetic Shop",
            categoryId: "category-a",
          },
        ]);
      } else {
        expect(fixture.assignCategoryAndRemember).not.toHaveBeenCalled();
        expect(fixture.categoryRules).toEqual([]);
      }
      expect(fixture.categoryAction().group.categoryState).toEqual({
        kind: "categorized",
        category: fixture.categories[0],
      });
      expect(fixture.categoryAction().group).not.toBe(action.group);
      expect(
        fixture.transactions.map((transaction) => ({ ...transaction })),
      ).toEqual(
        before.map((transaction) =>
          transaction.id === "pending"
            ? { ...transaction, categoryId: "category-a" }
            : transaction,
        ),
      );
      expect(fixture.list).toHaveBeenCalledTimes(2);
      expect(fixture.rules).toEqual([]);
      expect(fixture.create).not.toHaveBeenCalled();
    },
  );

  it("changes an existing Category without teaching future matching Transactions", () => {
    const fixture = setup();
    fixture.controller.load();
    fixture.controller.applyCategory(fixture.categoryAction());
    fixture.controller.applyCategory(fixture.categoryAction("category-b"));
    expect(fixture.transactions[1].categoryId).toBe("category-b");
    fixture.transactions.push(
      new Transaction({
        id: "future",
        accountId: "account",
        origin: "manual",
        postingDate: "2400-03-03",
        amount: new Money(-100, "AUD"),
        rawDescription: "Synthetic Shop",
      }),
    );
    fixture.controller.load();
    expect(fixture.transactions[3].categoryId).toBeUndefined();
    expect(fixture.categoryAction().group.categoryState).toEqual({
      kind: "mixed",
    });
    expect(fixture.rules).toEqual([]);
    expect(fixture.categoryRules).toEqual([]);
    expect(fixture.assignCategoryAndRemember).not.toHaveBeenCalled();
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "allows unknown groups to be categorized without confirming a Merchant with remember=%s",
    (rememberForFuture) => {
      const fixture = setup();
      fixture.controller.load();
      fixture.controller.applyCategory({
        ...fixture.categoryAction("category-a", "unknown"),
        rememberForFuture,
      });
      expect(fixture.transactions[2].categoryId).toBe("category-a");
      expect(fixture.transactions[2].merchantId).toBeUndefined();
      expect(fixture.categoryAction("category-a", "unknown").group.status).toBe(
        "unknown",
      );
      expect(fixture.create).not.toHaveBeenCalled();
      expect(fixture.categoryRules).toEqual(
        rememberForFuture
          ? [
              {
                householdId: "household",
                normalizedDescription: "Other Shop",
                categoryId: "category-a",
              },
            ]
          : [],
      );
    },
  );

  it("prevents reentrant, repeated and competing confirmation writes while retaining source state until persistence", () => {
    const fixture = setup();
    fixture.controller.load();
    const action = fixture.categoryAction();
    const confirm = fixture.action();
    const write = fixture.assignCategory.getMockImplementation()!;
    fixture.assignCategory.mockImplementationOnce((input) => {
      expect(fixture.ready().submitting).toBe(true);
      expect(action.group.categoryState).toEqual({ kind: "uncategorized" });
      expect(fixture.ready().queues[0].groups).toContain(action.group);
      fixture.controller.applyCategory(action);
      fixture.controller.confirm(confirm);
      write(input);
    });
    fixture.controller.applyCategory(action);
    fixture.controller.applyCategory(action);
    fixture.controller.confirm(confirm);
    expect(fixture.assignCategory).toHaveBeenCalledTimes(1);
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.ready().submitting).toBe(false);
    fixture.controller.confirm(fixture.action());
    expect(fixture.create).toHaveBeenCalledTimes(1);
    expect(fixture.transactions[1].categoryId).toBe("category-a");
  });

  it("confirmation independently blocks category writes and does not assign implicitly", () => {
    const fixture = setup();
    fixture.controller.load();
    const categoryAction = fixture.categoryAction();
    const write = fixture.create.getMockImplementation()!;
    fixture.create.mockImplementationOnce((rule) => {
      fixture.controller.applyCategory(categoryAction);
      write(rule);
    });
    fixture.controller.confirm(fixture.action());
    fixture.controller.applyCategory(categoryAction);
    expect(fixture.assignCategory).not.toHaveBeenCalled();
    expect(
      fixture.transactions.every(
        (transaction) => transaction.categoryId === undefined,
      ),
    ).toBe(true);
    expect(
      fixture
        .ready()
        .queues[0].groups.map((group) => group.normalizedDescription),
    ).toEqual(["Other Shop"]);
  });

  it("rejects copied groups, unrelated Household contexts and stale snapshots", () => {
    const fixture = setup();
    fixture.controller.load();
    const action = fixture.categoryAction();
    fixture.controller.applyCategory({ ...action, group: { ...action.group } });
    fixture.controller.applyCategory({
      ...action,
      householdId: "other-household",
    });
    fixture.controller.load();
    fixture.controller.applyCategory(action);
    expect(fixture.assignCategory).not.toHaveBeenCalled();
    expect(fixture.getCategoryById).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    new Category({
      id: "category-a",
      name: "Past purpose",
      status: "archived",
    }),
    new Category({
      id: "different-id",
      name: "Same display",
      status: "active",
    }),
  ])("rechecks the selected Category before writing", (category) => {
    const fixture = setup();
    fixture.controller.load();
    fixture.getCategoryById.mockReturnValueOnce(category);
    fixture.controller.applyCategory(fixture.categoryAction());
    expect(fixture.assignCategory).not.toHaveBeenCalled();
    expect(fixture.ready().categoryError).toBe(
      CATEGORY_ASSIGNMENT_FAILURE_MESSAGE,
    );
  });

  it("rejects a Category archived after selection before a remembered assignment", () => {
    const fixture = setup();
    fixture.controller.load();
    const action = { ...fixture.categoryAction(), rememberForFuture: true };
    fixture.getCategoryById.mockReturnValueOnce(
      new Category({
        id: action.categoryId,
        name: "Past purpose",
        status: "archived",
      }),
    );
    fixture.controller.applyCategory(action);
    expect(fixture.assignCategoryAndRemember).not.toHaveBeenCalled();
    expect(fixture.assignCategory).not.toHaveBeenCalled();
    expect(fixture.categoryRules).toEqual([]);
    expect(fixture.ready().categoryError).toBe(
      CATEGORY_ASSIGNMENT_FAILURE_MESSAGE,
    );
  });

  it.each(["householdId", "categoryId", "normalizedDescription"] as const)(
    "rejects invalid %s",
    (field) => {
      for (const value of ["", " \t\n ", null, 42]) {
        const fixture = setup();
        fixture.controller.load();
        const action = fixture.categoryAction();
        const invalid =
          field === "normalizedDescription"
            ? {
                ...action,
                group: { ...action.group, normalizedDescription: value },
              }
            : { ...action, [field]: value };
        fixture.controller.applyCategory(
          invalid as MerchantReviewCategoryAction,
        );
        expect(fixture.assignCategory).not.toHaveBeenCalled();
        expect(fixture.ready().categoryError).toBe(
          CATEGORY_ASSIGNMENT_FAILURE_MESSAGE,
        );
      }
    },
  );

  it.each([
    null,
    undefined,
    { householdId: "household", group: null, categoryId: "category-a" },
  ])("rejects malformed category actions", (action) => {
    const fixture = setup();
    fixture.controller.load();
    fixture.controller.applyCategory(
      action as unknown as MerchantReviewCategoryAction,
    );
    expect(fixture.assignCategory).not.toHaveBeenCalled();
    expect(fixture.ready().categoryError).toBe(
      CATEGORY_ASSIGNMENT_FAILURE_MESSAGE,
    );
  });

  it.each([null, "true", 0, 1, {}])(
    "rejects malformed remember opt-in %j without either persistence path",
    (rememberForFuture) => {
      const fixture = setup();
      fixture.controller.load();
      fixture.controller.applyCategory({
        ...fixture.categoryAction(),
        rememberForFuture,
      } as MerchantReviewCategoryAction);
      expect(fixture.assignCategory).not.toHaveBeenCalled();
      expect(fixture.assignCategoryAndRemember).not.toHaveBeenCalled();
      expect(fixture.categoryRules).toEqual([]);
      expect(fixture.ready().categoryError).toBe(
        CATEGORY_ASSIGNMENT_FAILURE_MESSAGE,
      );
    },
  );

  it.each(["category-a", "category-b"])(
    "shows a failed remembered assignment without replacing the existing rule for %s",
    (categoryId) => {
      const fixture = setup();
      const existingRule = {
        householdId: "household",
        normalizedDescription: "Synthetic Shop",
        categoryId,
      };
      fixture.categoryRules.push(existingRule);
      fixture.controller.load();
      const before = [...fixture.transactions];
      fixture.controller.applyCategory({
        ...fixture.categoryAction(),
        rememberForFuture: true,
      });
      expect(fixture.assignCategoryAndRemember).toHaveBeenCalledTimes(1);
      expect(fixture.assignCategory).not.toHaveBeenCalled();
      expect(fixture.transactions).toEqual(before);
      expect(fixture.categoryRules).toEqual([existingRule]);
      expect(fixture.ready().categoryError).toBe(
        CATEGORY_ASSIGNMENT_FAILURE_MESSAGE,
      );
      expect(JSON.stringify(fixture.changes)).not.toContain("SECRET");
      // A new action can still make a current-only correction without touching the rule.
      fixture.controller.applyCategory(fixture.categoryAction());
      expect(fixture.transactions[1].categoryId).toBe("category-a");
      expect(fixture.assignCategoryAndRemember).toHaveBeenCalledTimes(1);
      expect(fixture.categoryRules).toEqual([existingRule]);
      expect(fixture.ready().categoryError).toBeUndefined();
    },
  );

  it.each([false, true])(
    "sanitizes persistence failure and allows a fresh retry with remember=%s",
    (rememberForFuture) => {
      const fixture = setup();
      fixture.controller.load();
      const action = { ...fixture.categoryAction(), rememberForFuture };
      const before = fixture.transactions.map((transaction) => ({
        ...transaction,
      }));
      const write = rememberForFuture
        ? fixture.assignCategoryAndRemember
        : fixture.assignCategory;
      write.mockImplementationOnce(() => {
        throw new Error("SECRET SQL parameters");
      });
      fixture.controller.applyCategory(action);
      expect(fixture.ready().categoryError).toBe(
        CATEGORY_ASSIGNMENT_FAILURE_MESSAGE,
      );
      expect(fixture.categoryAction().group.categoryState).toEqual({
        kind: "uncategorized",
      });
      expect(fixture.transactions).toEqual(before);
      expect(fixture.categoryRules).toEqual([]);
      expect(fixture.list).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(fixture.changes)).not.toContain("SECRET");
      fixture.controller.applyCategory(action);
      expect(write).toHaveBeenCalledTimes(1);
      fixture.controller.applyCategory({
        ...fixture.categoryAction(),
        rememberForFuture,
      });
      expect(write).toHaveBeenCalledTimes(2);
      expect(fixture.categoryRules).toHaveLength(rememberForFuture ? 1 : 0);
      expect(fixture.ready().categoryError).toBeUndefined();
    },
  );

  it.each([
    { succeeds: true, rememberForFuture: false },
    { succeeds: false, rememberForFuture: false },
    { succeeds: true, rememberForFuture: true },
    { succeeds: false, rememberForFuture: true },
  ])(
    "shows fixed source-read failure after assignment success=$succeeds and remember=$rememberForFuture",
    ({ succeeds, rememberForFuture }) => {
      const fixture = setup();
      fixture.controller.load();
      const action = { ...fixture.categoryAction(), rememberForFuture };
      const write = rememberForFuture
        ? fixture.assignCategoryAndRemember
        : fixture.assignCategory;
      fixture.list.mockImplementationOnce(() => {
        throw new Error("SECRET read failure");
      });
      if (!succeeds)
        write.mockImplementationOnce(() => {
          throw new Error("SECRET write failure");
        });
      fixture.controller.applyCategory(action);
      expect(fixture.state()).toEqual({
        status: "error",
        categoryError: succeeds
          ? undefined
          : CATEGORY_ASSIGNMENT_FAILURE_MESSAGE,
      });
      expect(JSON.stringify(fixture.changes)).not.toContain("SECRET");
      fixture.controller.applyCategory(action);
      expect(write).toHaveBeenCalledTimes(1);
      expect(fixture.categoryRules).toHaveLength(
        succeeds && rememberForFuture ? 1 : 0,
      );
    },
  );
});
