import {
  Account,
  type AccountOwnership,
  Category,
  Household,
  Member,
  Merchant,
  Money,
  Transaction,
} from "@aqchafold/domain";
import { deleteDatabaseSync } from "expo-sqlite";
import { AccountRepository } from "./account-repository";
import { openLedgeraseDatabase } from "./database";
import { HouseholdRepository } from "./household-repository";
import { MemberRepository } from "./member-repository";
import { MerchantRepository } from "./merchant-repository";
import { migrateLedgeraseDatabase } from "./migrate";
import { categories } from "./schema";
import { TransactionRepository } from "./transaction-repository";

declare const __DEV__: boolean;

/** Exercises native SQLite in an isolated, disposable synthetic database. */
export async function runPersistenceSmokeCheck(): Promise<void> {
  if (!__DEV__) {
    throw new Error("Persistence smoke check requires development mode.");
  }
  const filename = `ledgerase-persistence-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  const household = new Household({
    id: "smoke-household",
    label: " Synthetic smoke household ",
  });
  const memberRecords = (["active", "archived"] as const).map(
    (status, index) =>
      new Member({
        id: index === 0 ? "member-a" : "member-b",
        householdId: household.id,
        displayName: `Synthetic member ${index}`,
        status,
      }),
  );
  const ownerships: AccountOwnership[] = [
    { kind: "individual", memberId: "member-a" },
    { kind: "shared", memberIds: ["member-b", "member-a"] },
    { kind: "household-level" },
    { kind: "unknown" },
  ];
  const accountRecords = ownerships.map(
    (ownership, index) =>
      new Account({
        id: `account-${index}`,
        householdId: household.id,
        label: `Synthetic account ${index}`,
        type: "transaction",
        status: index === 3 ? "closed" : "active",
        primaryCurrency: "USD",
        ownership,
      }),
  );
  const merchantRecords = ["merchant-a", "merchant-b"].map(
    (id) =>
      new Merchant({
        id,
        displayName: "Synthetic merchant",
      }),
  );
  const category = new Category({
    id: "smoke-category",
    name: "Synthetic category",
    status: "archived",
  });
  const baseTransaction = {
    accountId: accountRecords[1].id,
    postingDate: "2026-01-02",
  };
  const transactionRecords = [
    new Transaction({
      ...baseTransaction,
      id: "transaction-absent",
      origin: "manual",
      amount: new Money(-1234, "USD"),
    }),
    new Transaction({
      ...baseTransaction,
      id: "transaction-merchant",
      origin: "manual",
      amount: new Money(1234, "USD"),
      rawDescription: "Synthetic manual note",
      transactionDate: "2026-01-01",
      merchantId: merchantRecords[0].id,
    }),
    new Transaction({
      ...baseTransaction,
      id: "transaction-category",
      origin: "imported",
      amount: new Money(0, "USD"),
      rawDescription: "",
      categoryId: category.id,
    }),
    new Transaction({
      ...baseTransaction,
      id: "transaction-both",
      origin: "imported",
      amount: new Money(-567, "USD"),
      rawDescription: "Synthetic source text",
      transactionDate: "2026-01-01",
      merchantId: merchantRecords[1].id,
      categoryId: category.id,
    }),
  ];
  const readBack = (connection: ReturnType<typeof openLedgeraseDatabase>) => {
    assertSame(new HouseholdRepository(connection).get(), household);
    const memberRepository = new MemberRepository(connection);
    for (const member of memberRecords)
      assertSame(memberRepository.getById(member.id), member);
    const accountRepository = new AccountRepository(connection);
    for (const account of accountRecords)
      assertSame(accountRepository.getById(account.id), account);
    const merchantRepository = new MerchantRepository(connection);
    for (const merchant of merchantRecords)
      assertSame(merchantRepository.getById(merchant.id), merchant);
    const transactionRepository = new TransactionRepository(connection);
    for (const transaction of transactionRecords) {
      const stored = transactionRepository.getById(transaction.id);
      assertSame(stored, transaction);
      assert(stored?.amount instanceof Money);
    }
    const storedCategory = connection.select().from(categories).get();
    assert(storedCategory !== undefined);
    assertSame(new Category(storedCategory), category);
    assert(accountRepository.getById("missing-owner-account") === undefined);
    assert(transactionRepository.getById("currency-mismatch") === undefined);
  };
  let database: ReturnType<typeof openLedgeraseDatabase> | undefined;
  try {
    database = openLedgeraseDatabase(filename);
    await migrateLedgeraseDatabase(database);
    const householdRepository = new HouseholdRepository(database);
    assert(householdRepository.get() === undefined);
    householdRepository.create(household);
    const memberRepository = new MemberRepository(database);
    for (const member of memberRecords) memberRepository.create(member);
    const accountRepository = new AccountRepository(database);
    for (const account of accountRecords) accountRepository.create(account);
    const merchantRepository = new MerchantRepository(database);
    for (const merchant of merchantRecords) merchantRepository.create(merchant);
    database.insert(categories).values(category).run();
    const transactionRepository = new TransactionRepository(database);
    for (const transaction of transactionRecords)
      transactionRepository.create(transaction);
    assertFails(
      () =>
        householdRepository.create(
          new Household({
            ...household,
            id: "second-household",
          }),
        ),
      "Local store already contains a Household.",
    );
    assertFails(
      () =>
        accountRepository.create(
          new Account({
            ...accountRecords[0],
            id: "missing-owner-account",
            ownership: { kind: "individual", memberId: "missing-member" },
          }),
        ),
      "Account ownership references a missing Member.",
    );
    assertFails(
      () =>
        transactionRepository.create(
          new Transaction({
            ...baseTransaction,
            id: "currency-mismatch",
            origin: "manual",
            amount: new Money(1, "AUD"),
          }),
        ),
      "Transaction currency must match its Account currency.",
    );
    readBack(database);
    const closing = database;
    database = undefined;
    closing.$client.closeSync();
    database = openLedgeraseDatabase(filename);
    await migrateLedgeraseDatabase(database);
    readBack(database);
  } finally {
    const closing = database;
    database = undefined;
    try {
      closing?.$client.closeSync();
    } finally {
      deleteDatabaseSync(filename);
    }
  }
}

function assert(condition: unknown): asserts condition {
  if (!condition) throw new Error("Persistence smoke assertion failed.");
}

function assertSame(actual: object | undefined, expected: object): void {
  assert(actual?.constructor === expected.constructor);
  assert(JSON.stringify(actual) === JSON.stringify(expected));
}

function assertFails(action: () => void, message: string): void {
  try {
    action();
  } catch (error) {
    assert(error instanceof Error && error.message === message);
    return;
  }
  throw new Error("Persistence smoke check expected an operation to fail.");
}
