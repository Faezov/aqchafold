import { sql } from "drizzle-orm";
import {
  check,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const households = sqliteTable("households", {
  id: text("id").primaryKey().notNull(),
  label: text("label").notNull(),
});

export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey().notNull(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    displayName: text("display_name").notNull(),
    status: text("status", { enum: ["active", "archived"] }).notNull(),
  },
  (table) => [
    check("members_status", sql`${table.status} in ('active', 'archived')`),
  ],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey().notNull(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    label: text("label").notNull(),
    type: text("type", {
      enum: ["transaction", "savings", "credit-card", "cash", "other"],
    }).notNull(),
    status: text("status", { enum: ["active", "closed"] }).notNull(),
    primaryCurrency: text("primary_currency").notNull(),
    ownershipKind: text("ownership_kind", {
      enum: ["individual", "shared", "household-level", "unknown"],
    }).notNull(),
  },
  (table) => [
    check(
      "accounts_type",
      sql`${table.type} in ('transaction', 'savings', 'credit-card', 'cash', 'other')`,
    ),
    check("accounts_status", sql`${table.status} in ('active', 'closed')`),
    check(
      "accounts_currency",
      sql`length(${table.primaryCurrency}) = 3 and ${table.primaryCurrency} glob '[A-Z][A-Z][A-Z]'`,
    ),
    check(
      "accounts_ownership_kind",
      sql`${table.ownershipKind} in ('individual', 'shared', 'household-level', 'unknown')`,
    ),
  ],
);

// Repositories must enforce ownership cardinality and same-Household membership.
export const accountMembers = sqliteTable(
  "account_members",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    // Preserve the domain array's order, without implying rank or ownership shares.
    memberOrder: integer("member_order").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.memberId] }),
    uniqueIndex("account_members_order").on(table.accountId, table.memberOrder),
    check(
      "account_members_order_nonnegative",
      sql`typeof(${table.memberOrder}) = 'integer' and ${table.memberOrder} >= 0`,
    ),
  ],
);

export const merchants = sqliteTable("merchants", {
  id: text("id").primaryKey().notNull(),
  displayName: text("display_name").notNull(),
});

export const merchantRules = sqliteTable(
  "merchant_rules",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    normalizedDescription: text("normalized_description").notNull(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.normalizedDescription] }),
  ],
);

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: ["active", "archived"] }).notNull(),
  },
  (table) => [
    check("categories_status", sql`${table.status} in ('active', 'archived')`),
  ],
);

export const categoryRules = sqliteTable(
  "category_rules",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    normalizedDescription: text("normalized_description").notNull(),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.normalizedDescription] }),
  ],
);

export const imports = sqliteTable(
  "imports",
  {
    id: text("id").primaryKey().notNull(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    processingStatus: text("processing_status", {
      enum: ["pending", "processing", "completed", "failed"],
    }).notNull(),
    sourceKind: text("source_kind"),
    sourceFormat: text("source_format"),
    originalFilename: text("original_filename"),
    displayLabel: text("display_label"),
    fingerprintMethod: text("fingerprint_method"),
    fingerprintValue: text("fingerprint_value"),
    parserId: text("parser_id"),
    parserVersion: text("parser_version"),
    confirmedAccountId: text("confirmed_account_id").references(
      () => accounts.id,
    ),
  },
  (table) => [
    uniqueIndex("imports_completed_artifact")
      .on(table.householdId, table.fingerprintMethod, table.fingerprintValue)
      .where(sql`${table.processingStatus} = 'completed'`),
    check(
      "imports_processing_status",
      sql`${table.processingStatus} in ('pending', 'processing', 'completed', 'failed')`,
    ),
    check(
      "imports_fingerprint_pair",
      sql`(${table.fingerprintMethod} is null) = (${table.fingerprintValue} is null)`,
    ),
    check(
      "imports_parser_pair",
      sql`(${table.parserId} is null) = (${table.parserVersion} is null)`,
    ),
  ],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey().notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    postingDate: text("posting_date").notNull(),
    transactionDate: text("transaction_date"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    origin: text("origin", { enum: ["manual", "imported"] }).notNull(),
    rawDescription: text("raw_description"),
    merchantId: text("merchant_id").references(() => merchants.id),
    categoryId: text("category_id").references(() => categories.id),
  },
  (table) => [
    check(
      "transactions_amount_minor",
      sql`typeof(${table.amountMinor}) = 'integer' and ${table.amountMinor} between -9007199254740991 and 9007199254740991`,
    ),
    check(
      "transactions_currency",
      sql`length(${table.currency}) = 3 and ${table.currency} glob '[A-Z][A-Z][A-Z]'`,
    ),
    check(
      "transactions_origin",
      sql`${table.origin} in ('manual', 'imported')`,
    ),
    check(
      "transactions_imported_description",
      sql`${table.origin} = 'manual' or ${table.rawDescription} is not null`,
    ),
  ],
);
