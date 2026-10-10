/// <reference types="node" />

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { URL } from "node:url";
import {
  Account,
  Category,
  Household,
  Merchant,
  Money,
  Transaction,
} from "@aqchafold/domain";
import { drizzle } from "drizzle-orm/expo-sqlite/driver";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMerchantReviewController,
  CATEGORY_ASSIGNMENT_FAILURE_MESSAGE,
  MERCHANT_CONFIRMATION_FAILURE_MESSAGE,
  type MerchantReviewState,
} from "../../../apps/mobile/src/presentation/merchant-review-controller";
import { buildMerchantReviewQueues } from "../../../apps/mobile/src/presentation/merchant-review-data";
import {
  resolveMerchantAlias,
  resolveMerchantIdentity,
} from "../../merchants/src/index";
import { AccountRepository } from "./account-repository";
import { CategoryRepository } from "./category-repository";
import { CategoryRuleRepository } from "./category-rule-repository";
import { assignCategoryAndRemember } from "./assign-category-and-remember";
import { HouseholdRepository } from "./household-repository";
import { MerchantRepository } from "./merchant-repository";
import {
  MerchantRuleRepository,
  type MerchantRule,
} from "./merchant-rule-repository";
import * as schema from "./schema";
import { TransactionRepository } from "./transaction-repository";

// Adapt only Expo's synchronous native boundary, using every forward migration.
function createDatabase(filename = ":memory:", initialize = true) {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  if (initialize) {
    const journal = JSON.parse(
      readFileSync(
        new URL("../drizzle/meta/_journal.json", import.meta.url),
        "utf8",
      ),
    ) as { entries: { tag: string }[] };
    for (const { tag } of journal.entries)
      sqlite.exec(
        readFileSync(
          new URL("../drizzle/" + tag + ".sql", import.meta.url),
          "utf8",
        ),
      );
  }
  const queries: string[] = [];
  const client = {
    prepareSync(query: string) {
      queries.push(query);
      const statement = sqlite.prepare(query);
      return {
        executeSync(params: readonly SQLInputValue[]) {
          const result = statement.run(...params);
          return {
            changes: Number(result.changes),
            lastInsertRowId: Number(result.lastInsertRowid),
          };
        },
        executeForRawResultSync(params: readonly SQLInputValue[]) {
          statement.setReturnArrays(true);
          return { getAllSync: () => statement.all(...params) };
        },
      };
    },
  };
  const database = drizzle(client as unknown as Parameters<typeof drizzle>[0], {
    schema,
  });
  return { sqlite, database, queries };
}

function seed(database: ReturnType<typeof createDatabase>["database"]): void {
  new HouseholdRepository(database).create(
    new Household({ id: "household-a", label: "Synthetic household A" }),
  );
  for (const id of ["merchant-a", "merchant-b"])
    new MerchantRepository(database).create(
      new Merchant({ id, displayName: "Synthetic shop" }),
    );
}

function rule(patch: Partial<MerchantRule> = {}): MerchantRule {
  return {
    householdId: "household-a",
    normalizedDescription: "Synthetic Shop",
    merchantId: "merchant-a",
    ...patch,
  };
}

function confirmationReview() {
  store.database
    .insert(schema.households)
    .values({ id: "household-b", label: "Synthetic household B" })
    .run();
  const accountRepository = new AccountRepository(store.database);
  for (const [id, householdId, primaryCurrency] of [
    ["account-a-aud", "household-a", "AUD"],
    ["account-a-usd", "household-a", "USD"],
    ["account-b-aud", "household-b", "AUD"],
  ]) {
    accountRepository.create(
      new Account({
        id,
        householdId,
        primaryCurrency,
        label: "Synthetic account",
        type: "transaction",
        status: "active",
        ownership: { kind: "household-level" },
      }),
    );
  }
  const transactionRepository = new TransactionRepository(store.database);
  const rawDescription =
    " \tPAYPAL * Synthetic   Descriptor\r\nValue Date 29/02/2400";
  for (const [id, accountId, currency, merchantId, description] of [
    ["history-a", "account-a-aud", "AUD", "merchant-a", rawDescription],
    ["pending-a-aud", "account-a-aud", "AUD", undefined, rawDescription],
    ["pending-a-usd", "account-a-usd", "USD", undefined, rawDescription],
    ["other-a", "account-a-aud", "AUD", undefined, "Other Synthetic Shop"],
    ["history-b", "account-b-aud", "AUD", "merchant-b", rawDescription],
    ["pending-b", "account-b-aud", "AUD", undefined, rawDescription],
  ] as const) {
    transactionRepository.create(
      new Transaction({
        id,
        accountId,
        postingDate: "2400-03-01",
        amount: new Money(-1200, currency),
        origin: "imported",
        merchantId,
        rawDescription: description,
      }),
    );
  }
  const repositories = {
    accountRepository,
    categoryRepository: new CategoryRepository(store.database),
    transactionRepository,
    merchantRepository: new MerchantRepository(store.database),
    merchantRuleRepository: repository,
    assignCategoryAndRemember: (
      input: Parameters<typeof assignCategoryAndRemember>[1],
    ) => assignCategoryAndRemember(store.database, input),
  };
  const states: MerchantReviewState[] = [];
  const controller = createMerchantReviewController(repositories, (state) =>
    states.push(state),
  );
  controller.load();
  return {
    controller,
    repositories,
    rawDescription,
    state: () => states.at(-1)!,
  };
}

function categoryReview() {
  const review = confirmationReview();
  const target = new Category({
    id: "target-category",
    name: "Target synthetic category",
    status: "active",
  });
  const existing = new Category({
    id: "existing-category",
    name: "Existing synthetic category",
    status: "active",
  });
  const archived = new Category({
    id: "archived-category",
    name: "Archived synthetic category",
    status: "archived",
  });
  store.database
    .insert(schema.categories)
    .values([target, existing, archived])
    .run();
  for (const [id, rawDescription, categoryId] of [
    ["pending-a-aud-second", review.rawDescription, archived.id],
    ["other-a-second", "Other Synthetic Shop", existing.id],
  ]) {
    review.repositories.transactionRepository.create(
      new Transaction({
        id,
        accountId: "account-a-aud",
        postingDate: "2400-03-02",
        transactionDate: "2400-02-29",
        amount: new Money(-350, "AUD"),
        origin: "imported",
        rawDescription,
        categoryId,
      }),
    );
  }
  review.controller.load();
  return { ...review, target, existing, archived };
}

function readyState(review: ReturnType<typeof confirmationReview>) {
  const state = review.state();
  if (state.status !== "ready") throw new Error("Expected ready review data.");
  return state;
}

function suggestedAction(
  state: MerchantReviewState,
  householdId = "household-a",
  currency = "AUD",
) {
  if (state.status !== "ready") throw new Error("Expected ready review data.");
  const group = state.queues
    .find(
      (queue) =>
        queue.householdId === householdId && queue.currency === currency,
    )
    ?.groups.find(
      (candidate) => candidate.normalizedDescription === "Synthetic Descriptor",
    );
  if (group?.status !== "suggested")
    throw new Error("Expected a suggested review group.");
  return { householdId, group };
}

let store: ReturnType<typeof createDatabase>;
let repository: MerchantRuleRepository;

beforeEach(() => {
  store = createDatabase();
  seed(store.database);
  repository = new MerchantRuleRepository(store.database);
  store.queries.length = 0;
});

afterEach(() => store.sqlite.close());

describe("MerchantRuleRepository with real SQLite", () => {
  it("roundtrips an explicit exact mapping without mutating its input", () => {
    const source = Object.freeze(rule());
    const before = structuredClone(source);
    repository.create(source);
    expect(
      repository.get(source.householdId, source.normalizedDescription),
    ).toEqual(source);
    expect(repository.list(source.householdId)).toEqual([source]);
    expect(source).toEqual(before);
  });

  it("keeps an explicitly user-confirmed stored mapping ahead of a conflicting alias suggestion", () => {
    const source = Object.freeze(rule());
    // Explicit creation represents the Household's confirmation of this mapping.
    repository.create(source);
    const confirmedMerchantId = repository.get(
      source.householdId,
      source.normalizedDescription,
    )?.merchantId;
    const suggestedMerchantId = resolveMerchantAlias(
      source.normalizedDescription,
      [
        {
          normalizedDescription: source.normalizedDescription,
          merchantId: "merchant-b",
        },
      ],
    );

    expect(
      resolveMerchantIdentity({ confirmedMerchantId, suggestedMerchantId }),
    ).toEqual({ status: "confirmed", merchantId: "merchant-a" });
    expect(resolveMerchantIdentity({ suggestedMerchantId })).toEqual({
      status: "suggested",
      merchantId: "merchant-b",
    });
    expect(resolveMerchantIdentity({ confirmedMerchantId })).toEqual({
      status: "confirmed",
      merchantId: "merchant-a",
    });

    expect(
      repository.get("household-b", source.normalizedDescription),
    ).toBeUndefined();
    expect(
      repository.get(source.householdId, source.normalizedDescription),
    ).toEqual(source);
    expect(repository.list(source.householdId)).toEqual([source]);
    expect(
      store.sqlite.prepare("SELECT count(*) AS count FROM transactions").get()
        ?.count,
    ).toBe(0);
  });

  it("preserves whitespace, punctuation, and Unicode in the exact key", () => {
    const source = rule({ normalizedDescription: " \tMiXeD Café & 東京!\n " });
    repository.create(source);
    expect(
      repository.get(source.householdId, source.normalizedDescription),
    ).toEqual(source);
    expect(
      repository.get(source.householdId, "MiXeD Café & 東京!"),
    ).toBeUndefined();
    expect(
      store.sqlite
        .prepare("SELECT normalized_description FROM merchant_rules")
        .get()?.normalized_description,
    ).toBe(source.normalizedDescription);
  });

  it.each([
    "synthetic shop",
    "SYNTHETIC SHOP",
    "Synthetic",
    "Synthetic Shop Extra",
    "Extra Synthetic Shop",
    " Synthetic Shop",
    "Synthetic  Shop",
    "",
    " \t\n ",
  ])("does not transform or partially match lookup %j", (description) => {
    repository.create(rule());
    expect(repository.get("household-a", description)).toBeUndefined();
  });

  it("returns no match for unknown descriptions and Households", () => {
    expect(repository.get("household-a", "Unknown Shop")).toBeUndefined();
    expect(
      repository.get("unknown-household", "Synthetic Shop"),
    ).toBeUndefined();
    expect(repository.list("unknown-household")).toEqual([]);
  });

  it("allows case-distinct keys in one Household", () => {
    const first = rule();
    const second = rule({
      normalizedDescription: "synthetic shop",
      merchantId: "merchant-b",
    });
    repository.create(first);
    repository.create(second);
    expect(
      repository.get(first.householdId, first.normalizedDescription),
    ).toEqual(first);
    expect(
      repository.get(second.householdId, second.normalizedDescription),
    ).toEqual(second);
  });

  it("scopes the same exact description independently to each Household", () => {
    // Seed a second Household without changing the single-local-Household API.
    store.database
      .insert(schema.households)
      .values({ id: "household-b", label: "Synthetic household B" })
      .run();
    const first = rule();
    const second = rule({
      householdId: "household-b",
      merchantId: "merchant-b",
    });
    repository.create(first);
    repository.create(second);
    expect(
      repository.get(first.householdId, first.normalizedDescription),
    ).toEqual(first);
    expect(
      repository.get(second.householdId, second.normalizedDescription),
    ).toEqual(second);
    expect(repository.list(first.householdId)).toEqual([first]);
    expect(repository.list(second.householdId)).toEqual([second]);
  });

  it("lists only one Household's rules in deterministic binary description order", () => {
    const sources = [
      rule({ normalizedDescription: "a Shop" }),
      rule({ normalizedDescription: "Z Shop" }),
      rule({ normalizedDescription: "A Shop" }),
    ];
    for (const source of sources) repository.create(source);
    const expected = [sources[2], sources[1], sources[0]];
    expect(repository.list("household-a")).toEqual(expected);
    expect(repository.list("household-a")).toEqual(expected);
    expect(repository.get("household-a", "A Shop")).toEqual(sources[2]);
    expect(repository.get("household-a", "A Shop")).toEqual(sources[2]);
  });

  it.each(["merchant-a", "merchant-b"])(
    "rejects repeated keys for %s without overwriting or partial state",
    (merchantId) => {
      const source = rule();
      repository.create(source);
      const duplicate = rule({ merchantId });
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(() => repository.create(duplicate)).toThrow(
          "Merchant rule already exists for this Household and description.",
        );
        expect(repository.list(source.householdId)).toEqual([source]);
      }
    },
  );

  it.each([
    [
      "householdId",
      "missing-household",
      "Merchant rule must reference an existing Household.",
    ],
    [
      "merchantId",
      "missing-merchant",
      "Merchant rule must reference an existing Merchant.",
    ],
  ] as const)(
    "rejects missing %s without storing a partial rule",
    (field, missingId, diagnostic) => {
      expect(() => repository.create(rule({ [field]: missingId }))).toThrow(
        diagnostic,
      );
      expect(repository.list("household-a")).toEqual([]);
      expect(
        store.sqlite
          .prepare("SELECT count(*) AS count FROM merchant_rules")
          .get()?.count,
      ).toBe(0);
    },
  );

  it.each(["householdId", "normalizedDescription", "merchantId"] as const)(
    "rejects blank %s before issuing SQL",
    (field) => {
      for (const value of ["", " \t\n "]) {
        expect(() => repository.create(rule({ [field]: value }))).toThrow(
          TypeError,
        );
        expect(store.queries).toEqual([]);
      }
      expect(repository.list("household-a")).toEqual([]);
    },
  );

  it("validates blank Household IDs for reads before issuing SQL", () => {
    expect(() => repository.get(" \t ", "Synthetic Shop")).toThrow(TypeError);
    expect(() => repository.list("")).toThrow(TypeError);
    expect(store.queries).toEqual([]);
  });

  it("enforces uniqueness and both foreign keys independently in SQLite", () => {
    const source = rule();
    repository.create(source);
    const insert = store.sqlite.prepare(
      "INSERT INTO merchant_rules (household_id, normalized_description, merchant_id) VALUES (?, ?, ?)",
    );
    expect(() =>
      insert.run(
        source.householdId,
        source.normalizedDescription,
        "merchant-b",
      ),
    ).toThrow(/UNIQUE constraint/i);
    expect(() =>
      insert.run("missing-household", "Other Shop", "merchant-a"),
    ).toThrow(/FOREIGN KEY constraint/i);
    expect(() =>
      insert.run("household-a", "Other Shop", "missing-merchant"),
    ).toThrow(/FOREIGN KEY constraint/i);
    expect(() =>
      store.sqlite
        .prepare("DELETE FROM households WHERE id = ?")
        .run(source.householdId),
    ).toThrow(/FOREIGN KEY constraint/i);
    expect(() =>
      store.sqlite
        .prepare("DELETE FROM merchants WHERE id = ?")
        .run(source.merchantId),
    ).toThrow(/FOREIGN KEY constraint/i);
    expect(repository.list(source.householdId)).toEqual([source]);
  });

  it.each(["create", "get", "list"] as const)(
    "sanitizes unexpected SQL errors from %s",
    (operation) => {
      const source = rule({
        normalizedDescription: "Synthetic sensitive description",
      });
      store.sqlite.exec("DROP TABLE merchant_rules;");
      let error: unknown;
      try {
        if (operation === "create") repository.create(source);
        else if (operation === "get")
          repository.get(source.householdId, source.normalizedDescription);
        else repository.list(source.householdId);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(
        source.normalizedDescription,
      );
      expect((error as Error).message).not.toContain(source.householdId);
      expect((error as Error).message).not.toContain(source.merchantId);
      expect((error as Error).message).not.toMatch(
        /select|insert|no such table/i,
      );
      expect((error as Error).cause).toBeUndefined();
    },
  );

  it("resolves a persisted rule by its retained description without learning rules or modifying Transactions", () => {
    const accounts = new AccountRepository(store.database);
    accounts.create(
      new Account({
        id: "synthetic-account",
        householdId: "household-a",
        label: "Synthetic account",
        type: "transaction",
        status: "active",
        primaryCurrency: "AUD",
        ownership: { kind: "household-level" },
      }),
    );
    const source = new Transaction({
      id: "synthetic-transaction",
      accountId: "synthetic-account",
      postingDate: "2036-01-31",
      amount: new Money(-1200, "AUD"),
      origin: "imported",
      rawDescription: " \tSQ *MiXeD Café & 東京!\r\nValue Date 29/02/2400",
    });
    const transactions = new TransactionRepository(store.database);
    transactions.create(source);
    const merchants = new MerchantRepository(store.database);
    const review = () =>
      buildMerchantReviewQueues({
        transactions: transactions.list(),
        accounts: accounts.list(),
        findConfirmedMerchantId: (householdId, normalizedDescription) =>
          repository.get(householdId, normalizedDescription)?.merchantId,
        findMerchantById: (merchantId) => merchants.getById(merchantId),
      });
    expect(review()[0].groups[0]).toMatchObject({
      normalizedDescription: "MiXeD Café & 東京!",
      status: "unknown",
    });
    expect(repository.list("household-a")).toEqual([]);
    const mapping = rule({ normalizedDescription: "MiXeD Café & 東京!" });
    repository.create(mapping);
    expect(review()).toEqual([]);
    expect(
      repository.get(mapping.householdId, mapping.normalizedDescription),
    ).toEqual(mapping);
    expect(transactions.getById(source.id)).toEqual(source);
    expect(transactions.getById(source.id)?.merchantId).toBeUndefined();
    expect(
      store.sqlite
        .prepare("SELECT raw_description FROM transactions WHERE id = ?")
        .get(source.id)?.raw_description,
    ).toBe(source.rawDescription);
    expect(source.rawDescription).toBe(
      " \tSQ *MiXeD Café & 東京!\r\nValue Date 29/02/2400",
    );
  });

  it("confirms a canonical suggestion across Household currencies without modifying Transactions", () => {
    const review = confirmationReview();
    const before = review.repositories.transactionRepository.list();
    const rowsBefore = store.sqlite
      .prepare("SELECT * FROM transactions ORDER BY id")
      .all();
    const action = suggestedAction(review.state());
    const siblingCurrency = suggestedAction(
      review.state(),
      "household-a",
      "USD",
    );
    const create = vi.spyOn(repository, "create");
    expect(action.group.displayName).toBe("Synthetic shop");
    expect(action.group.merchantId).toBe("merchant-a");
    review.controller.confirm(action);
    review.controller.confirm(action);
    review.controller.confirm(siblingCurrency);

    const mapping = rule({ normalizedDescription: "Synthetic Descriptor" });
    expect(create).toHaveBeenCalledExactlyOnceWith(mapping);
    expect(repository.list("household-a")).toEqual([mapping]);
    expect(repository.list("household-b")).toEqual([]);
    const state = review.state();
    expect(state.status).toBe("ready");
    if (state.status !== "ready")
      throw new Error("Expected ready review data.");
    expect(state.confirmationError).toBeUndefined();
    expect(
      state.queues.map((queue) => [
        queue.householdId,
        queue.currency,
        queue.groups.map((group) => [
          group.normalizedDescription,
          group.status,
        ]),
      ]),
    ).toEqual([
      ["household-a", "AUD", [["Other Synthetic Shop", "unknown"]]],
      ["household-b", "AUD", [["Synthetic Descriptor", "suggested"]]],
    ]);
    expect(review.repositories.transactionRepository.list()).toEqual(before);
    expect(
      review.repositories.transactionRepository.getById("pending-a-aud")
        ?.rawDescription,
    ).toBe(review.rawDescription);
    expect(
      store.sqlite.prepare("SELECT * FROM transactions ORDER BY id").all(),
    ).toEqual(rowsBefore);

    const reopenedStates: MerchantReviewState[] = [];
    createMerchantReviewController(review.repositories, (value) =>
      reopenedStates.push(value),
    ).load();
    expect(reopenedStates.at(-1)).toEqual(state);
  });

  it.each(["merchant-a", "merchant-b"])(
    "reloads a raced existing %s confirmation without overwriting it",
    (merchantId) => {
      const review = confirmationReview();
      const before = review.repositories.transactionRepository.list();
      const action = suggestedAction(review.state());
      const mapping = rule({
        normalizedDescription: "Synthetic Descriptor",
        merchantId,
      });
      repository.create(mapping);
      const create = vi.spyOn(repository, "create");
      review.controller.confirm(action);

      expect(create).toHaveBeenCalledExactlyOnceWith(
        rule({ normalizedDescription: "Synthetic Descriptor" }),
      );
      expect(repository.list("household-a")).toEqual([mapping]);
      const state = review.state();
      expect(state.status).toBe("ready");
      if (state.status !== "ready")
        throw new Error("Expected ready review data.");
      expect(state.confirmationError).toBe(
        MERCHANT_CONFIRMATION_FAILURE_MESSAGE,
      );
      expect(
        state.queues
          .filter((queue) => queue.householdId === "household-a")
          .flatMap((queue) => queue.groups)
          .map((group) => group.normalizedDescription),
      ).toEqual(["Other Synthetic Shop"]);
      expect(
        state.queues.find((queue) => queue.householdId === "household-b")
          ?.groups[0].status,
      ).toBe("suggested");
      expect(review.repositories.transactionRepository.list()).toEqual(before);
    },
  );

  it("assigns category to exact reviewed IDs and reloads without changing other groups, history, currencies, Households or rules", () => {
    const review = categoryReview();
    repository.create(
      rule({ normalizedDescription: "Unrelated Synthetic Descriptor" }),
    );
    const rulesBefore = repository.list("household-a");
    const rowsBefore = store.sqlite
      .prepare("SELECT * FROM transactions ORDER BY id")
      .all();
    const action = suggestedAction(review.state());
    expect(action.group.transactionIds).toEqual([
      "pending-a-aud",
      "pending-a-aud-second",
    ]);
    expect(action.group.categoryState).toEqual({ kind: "mixed" });
    expect(readyState(review).activeCategories).toEqual([
      review.existing,
      review.target,
    ]);
    const assign = vi.spyOn(
      review.repositories.transactionRepository,
      "assignCategory",
    );

    review.controller.applyCategory({
      ...action,
      categoryId: review.target.id,
    });

    expect(assign).toHaveBeenCalledExactlyOnceWith({
      householdId: "household-a",
      transactionIds: action.group.transactionIds,
      categoryId: review.target.id,
    });
    expect(
      store.sqlite.prepare("SELECT * FROM transactions ORDER BY id").all(),
    ).toEqual(
      rowsBefore.map((row) =>
        action.group.transactionIds.includes(row.id as string)
          ? { ...row, category_id: review.target.id }
          : row,
      ),
    );
    expect(repository.list("household-a")).toEqual(rulesBefore);
    expect(repository.list("household-b")).toEqual([]);
    expect(
      new CategoryRuleRepository(store.database).get(
        "household-a",
        action.group.normalizedDescription,
      ),
    ).toBeUndefined();
    expect(suggestedAction(review.state()).group.categoryState).toEqual({
      kind: "categorized",
      category: review.target,
    });
    expect(
      suggestedAction(review.state(), "household-a", "USD").group.categoryState,
    ).toEqual({ kind: "uncategorized" });
    expect(
      suggestedAction(review.state(), "household-b").group.categoryState,
    ).toEqual({ kind: "uncategorized" });
    expect(
      review.repositories.transactionRepository.getById("pending-a-aud")
        ?.rawDescription,
    ).toBe(review.rawDescription);
    const reopenedStates: MerchantReviewState[] = [];
    createMerchantReviewController(
      {
        ...review.repositories,
        categoryRepository: new CategoryRepository(store.database),
        transactionRepository: new TransactionRepository(store.database),
      },
      (value) => reopenedStates.push(value),
    ).load();
    expect(reopenedStates.at(-1)).toEqual(review.state());
  });

  it("changes an unknown group's category independently and keeps Merchant confirmation from assigning other categories", () => {
    const review = categoryReview();
    const queue = readyState(review).queues.find(
      (value) =>
        value.householdId === "household-a" && value.currency === "AUD",
    )!;
    const group = queue.groups.find((value) => value.status === "unknown")!;
    expect(group.categoryState).toEqual({ kind: "mixed" });
    const assign = vi.spyOn(
      review.repositories.transactionRepository,
      "assignCategory",
    );
    const create = vi.spyOn(repository, "create");
    review.controller.applyCategory({
      householdId: queue.householdId,
      group,
      categoryId: review.target.id,
    });
    expect(assign).toHaveBeenCalledExactlyOnceWith({
      householdId: queue.householdId,
      transactionIds: ["other-a", "other-a-second"],
      categoryId: review.target.id,
    });
    expect(
      review.repositories.transactionRepository.getById("other-a-second")
        ?.categoryId,
    ).toBe(review.target.id);
    expect(create).not.toHaveBeenCalled();
    expect(suggestedAction(review.state()).group.categoryState).toEqual({
      kind: "mixed",
    });
    const rowsBeforeConfirmation = store.sqlite
      .prepare("SELECT * FROM transactions ORDER BY id")
      .all();

    review.controller.confirm(suggestedAction(review.state()));

    expect(create).toHaveBeenCalledExactlyOnceWith(
      rule({ normalizedDescription: "Synthetic Descriptor" }),
    );
    expect(assign).toHaveBeenCalledTimes(1);
    expect(
      store.sqlite.prepare("SELECT * FROM transactions ORDER BY id").all(),
    ).toEqual(rowsBeforeConfirmation);
    const retained = readyState(review).queues.find(
      (value) => value.householdId === "household-a",
    )!;
    expect(retained.groups).toHaveLength(1);
    expect(retained.groups[0]).toMatchObject({
      normalizedDescription: "Other Synthetic Shop",
      status: "unknown",
      categoryState: { kind: "categorized", category: review.target },
    });
  });

  it("explicitly remembers an exact description while changing only the selected current group's categories", () => {
    const review = categoryReview();
    const action = suggestedAction(review.state());
    const rowsBefore = store.sqlite
      .prepare("SELECT * FROM transactions ORDER BY id")
      .all();
    const remembered = {
      householdId: action.householdId,
      normalizedDescription: action.group.normalizedDescription,
      categoryId: review.target.id,
    };
    const applyAndRemember = vi.spyOn(
      review.repositories,
      "assignCategoryAndRemember",
    );

    review.controller.applyCategory({
      ...action,
      categoryId: review.target.id,
      rememberForFuture: true,
    });

    expect(applyAndRemember).toHaveBeenCalledExactlyOnceWith({
      ...remembered,
      transactionIds: action.group.transactionIds,
    });
    const rules = new CategoryRuleRepository(store.database);
    expect(
      rules.get(remembered.householdId, remembered.normalizedDescription),
    ).toEqual(remembered);
    expect(
      rules.get("household-b", remembered.normalizedDescription),
    ).toBeUndefined();
    expect(
      store.sqlite.prepare("SELECT * FROM transactions ORDER BY id").all(),
    ).toEqual(
      rowsBefore.map((row) =>
        action.group.transactionIds.includes(row.id as string)
          ? { ...row, category_id: review.target.id }
          : row,
      ),
    );
    expect(repository.list("household-a")).toEqual([]);
    expect(repository.list("household-b")).toEqual([]);
    expect(suggestedAction(review.state()).group.categoryState).toEqual({
      kind: "categorized",
      category: review.target,
    });
    expect(
      suggestedAction(review.state(), "household-a", "USD").group.categoryState,
    ).toEqual({ kind: "uncategorized" });
    expect(
      suggestedAction(review.state(), "household-b").group.categoryState,
    ).toEqual({ kind: "uncategorized" });
    expect(readyState(review).categoryError).toBeUndefined();
    const reopenedStates: MerchantReviewState[] = [];
    createMerchantReviewController(
      {
        ...review.repositories,
        categoryRepository: new CategoryRepository(store.database),
        transactionRepository: new TransactionRepository(store.database),
      },
      (state) => reopenedStates.push(state),
    ).load();
    expect(reopenedStates.at(-1)).toEqual(review.state());
    expect(
      new CategoryRuleRepository(store.database).get(
        remembered.householdId,
        remembered.normalizedDescription,
      ),
    ).toEqual(remembered);
  });

  it.each(["target-category", "existing-category"])(
    "rejects a raced identical or conflicting remembered rule targeting %s without partially changing the current group",
    (categoryId) => {
      const review = categoryReview();
      const action = suggestedAction(review.state());
      const existingRule = {
        householdId: action.householdId,
        normalizedDescription: action.group.normalizedDescription,
        categoryId,
      };
      const rules = new CategoryRuleRepository(store.database);
      rules.create(existingRule);
      const rowsBefore = store.sqlite
        .prepare("SELECT * FROM transactions ORDER BY id")
        .all();

      review.controller.applyCategory({
        ...action,
        categoryId: review.target.id,
        rememberForFuture: true,
      });

      expect(
        rules.get(existingRule.householdId, existingRule.normalizedDescription),
      ).toEqual(existingRule);
      expect(
        store.sqlite.prepare("SELECT * FROM transactions ORDER BY id").all(),
      ).toEqual(rowsBefore);
      expect(readyState(review).categoryError).toBe(
        CATEGORY_ASSIGNMENT_FAILURE_MESSAGE,
      );
      expect(readyState(review).submitting).toBe(false);
      expect(suggestedAction(review.state()).group.categoryState).toEqual({
        kind: "mixed",
      });
      expect(
        rules.get("household-b", existingRule.normalizedDescription),
      ).toBeUndefined();
      expect(repository.list("household-a")).toEqual([]);
    },
  );

  it("remembers an unknown group's exact description without creating a Merchant rule or confirming identity", () => {
    const review = categoryReview();
    const queue = readyState(review).queues.find(
      (value) =>
        value.householdId === "household-a" && value.currency === "AUD",
    )!;
    const group = queue.groups.find((value) => value.status === "unknown")!;

    review.controller.applyCategory({
      householdId: queue.householdId,
      group,
      categoryId: review.target.id,
      rememberForFuture: true,
    });

    expect(
      new CategoryRuleRepository(store.database).get(
        queue.householdId,
        group.normalizedDescription,
      ),
    ).toEqual({
      householdId: queue.householdId,
      normalizedDescription: "Other Synthetic Shop",
      categoryId: review.target.id,
    });
    expect(repository.list(queue.householdId)).toEqual([]);
    const rebuilt = readyState(review)
      .queues.find((value) => value.householdId === queue.householdId)!
      .groups.find(
        (value) => value.normalizedDescription === group.normalizedDescription,
      )!;
    expect(rebuilt.status).toBe("unknown");
    expect(rebuilt.categoryState).toEqual({
      kind: "categorized",
      category: review.target,
    });
    expect(suggestedAction(review.state()).group.categoryState).toEqual({
      kind: "mixed",
    });
  });

  it("rolls back the remembered rule and every category write after a later group update fails", () => {
    const review = categoryReview();
    const action = suggestedAction(review.state());
    const rowsBefore = store.sqlite
      .prepare("SELECT * FROM transactions ORDER BY id")
      .all();
    store.sqlite.exec(`
      CREATE TRIGGER fail_remembered_category BEFORE UPDATE OF category_id ON transactions
      WHEN NEW.id = 'pending-a-aud-second'
      BEGIN SELECT RAISE(ABORT, 'synthetic private SQL detail'); END;
    `);
    store.queries.length = 0;

    review.controller.applyCategory({
      ...action,
      categoryId: review.target.id,
      rememberForFuture: true,
    });

    expect(
      store.queries.filter((query) => /^update /i.test(query)),
    ).toHaveLength(2);
    expect(
      store.sqlite.prepare("SELECT * FROM transactions ORDER BY id").all(),
    ).toEqual(rowsBefore);
    const rules = new CategoryRuleRepository(store.database);
    expect(
      rules.get(action.householdId, action.group.normalizedDescription),
    ).toBeUndefined();
    expect(readyState(review).categoryError).toBe(
      CATEGORY_ASSIGNMENT_FAILURE_MESSAGE,
    );
    expect(readyState(review).submitting).toBe(false);
    expect(suggestedAction(review.state()).group.categoryState).toEqual({
      kind: "mixed",
    });
    expect(JSON.stringify(review.state())).not.toContain("private SQL");
    expect(repository.list("household-a")).toEqual([]);
    store.sqlite.exec("DROP TRIGGER fail_remembered_category;");
    review.controller.applyCategory({
      ...suggestedAction(review.state()),
      categoryId: review.target.id,
      rememberForFuture: true,
    });
    expect(readyState(review).categoryError).toBeUndefined();
    expect(
      rules.get(action.householdId, action.group.normalizedDescription),
    ).toEqual({
      householdId: action.householdId,
      normalizedDescription: action.group.normalizedDescription,
      categoryId: review.target.id,
    });
  });

  it("guards reentrant and stale remembered submissions with one durable write", () => {
    const review = categoryReview();
    const action = {
      ...suggestedAction(review.state()),
      categoryId: review.target.id,
      rememberForFuture: true,
    };
    const applyAndRemember = vi
      .spyOn(review.repositories, "assignCategoryAndRemember")
      .mockImplementation((input) => {
        review.controller.applyCategory(action);
        review.controller.confirm(action);
        assignCategoryAndRemember(store.database, input);
      });

    review.controller.applyCategory(action);
    review.controller.applyCategory(action);

    expect(applyAndRemember).toHaveBeenCalledTimes(1);
    expect(
      store.sqlite.prepare("SELECT COUNT(*) AS count FROM category_rules").get()
        ?.count,
    ).toBe(1);
    expect(
      new CategoryRuleRepository(store.database).get(
        action.householdId,
        action.group.normalizedDescription,
      ),
    ).toEqual({
      householdId: action.householdId,
      normalizedDescription: action.group.normalizedDescription,
      categoryId: action.categoryId,
    });
    expect(readyState(review).categoryError).toBeUndefined();
    expect(repository.list("household-a")).toEqual([]);
  });

  it("rolls back an entire reviewed group after a later category write failure and reloads sanitized source truth", () => {
    const review = categoryReview();
    const action = suggestedAction(review.state());
    const rowsBefore = store.sqlite
      .prepare("SELECT * FROM transactions ORDER BY id")
      .all();
    store.sqlite.exec(`
      CREATE TRIGGER fail_review_category BEFORE UPDATE OF category_id ON transactions
      WHEN NEW.id = 'pending-a-aud-second'
      BEGIN SELECT RAISE(ABORT, 'synthetic secret SQL details'); END;
    `);
    store.queries.length = 0;

    review.controller.applyCategory({
      ...action,
      categoryId: review.target.id,
    });

    expect(
      store.queries.filter((query) => /^update /i.test(query)),
    ).toHaveLength(2);
    expect(
      store.sqlite.prepare("SELECT * FROM transactions ORDER BY id").all(),
    ).toEqual(rowsBefore);
    expect(readyState(review).categoryError).toBe(
      CATEGORY_ASSIGNMENT_FAILURE_MESSAGE,
    );
    expect(readyState(review).submitting).toBe(false);
    expect(suggestedAction(review.state()).group.categoryState).toEqual({
      kind: "mixed",
    });
    expect(JSON.stringify(review.state())).not.toContain("secret SQL");
    expect(repository.list("household-a")).toEqual([]);
    store.sqlite.exec("DROP TRIGGER fail_review_category;");
    review.controller.applyCategory({
      ...suggestedAction(review.state()),
      categoryId: review.target.id,
    });
    expect(readyState(review).categoryError).toBeUndefined();
    expect(suggestedAction(review.state()).group.categoryState).toEqual({
      kind: "categorized",
      category: review.target,
    });
  });

  it.each(["missing-category", "archived-category"])(
    "rejects unavailable assignment %s without writing or altering current categories",
    (categoryId) => {
      const review = categoryReview();
      const rowsBefore = store.sqlite
        .prepare("SELECT * FROM transactions ORDER BY id")
        .all();
      const assign = vi.spyOn(
        review.repositories.transactionRepository,
        "assignCategory",
      );
      review.controller.applyCategory({
        ...suggestedAction(review.state()),
        categoryId,
      });
      expect(assign).not.toHaveBeenCalled();
      expect(readyState(review).categoryError).toBe(
        CATEGORY_ASSIGNMENT_FAILURE_MESSAGE,
      );
      expect(
        store.sqlite.prepare("SELECT * FROM transactions ORDER BY id").all(),
      ).toEqual(rowsBefore);
    },
  );

  it("retains rules after closing and reopening the local SQLite file", () => {
    const directory = mkdtempSync(join(tmpdir(), "ledgerase-merchant-rules-"));
    const filename = join(directory, "ledgerase.db");
    const source = rule();
    try {
      const first = createDatabase(filename);
      try {
        seed(first.database);
        new MerchantRuleRepository(first.database).create(source);
      } finally {
        first.sqlite.close();
      }
      const reopened = createDatabase(filename, false);
      try {
        const restored = new MerchantRuleRepository(reopened.database);
        expect(
          restored.get(source.householdId, source.normalizedDescription),
        ).toEqual(source);
        expect(restored.list(source.householdId)).toEqual([source]);
      } finally {
        reopened.sqlite.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
