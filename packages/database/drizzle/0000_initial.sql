CREATE TABLE `account_members` (
	`account_id` text NOT NULL,
	`member_id` text NOT NULL,
	`member_order` integer NOT NULL,
	PRIMARY KEY(`account_id`, `member_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_members_order_nonnegative" CHECK(typeof("account_members"."member_order") = 'integer' and "account_members"."member_order" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_members_order` ON `account_members` (`account_id`,`member_order`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`label` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`primary_currency` text NOT NULL,
	`ownership_kind` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "accounts_type" CHECK("accounts"."type" in ('transaction', 'savings', 'credit-card', 'cash', 'other')),
	CONSTRAINT "accounts_status" CHECK("accounts"."status" in ('active', 'closed')),
	CONSTRAINT "accounts_currency" CHECK(length("accounts"."primary_currency") = 3 and "accounts"."primary_currency" glob '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "accounts_ownership_kind" CHECK("accounts"."ownership_kind" in ('individual', 'shared', 'household-level', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	CONSTRAINT "categories_status" CHECK("categories"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`processing_status` text NOT NULL,
	`source_kind` text,
	`source_format` text,
	`original_filename` text,
	`display_label` text,
	`fingerprint_method` text,
	`fingerprint_value` text,
	`parser_id` text,
	`parser_version` text,
	`confirmed_account_id` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "imports_processing_status" CHECK("imports"."processing_status" in ('pending', 'processing', 'completed', 'failed')),
	CONSTRAINT "imports_fingerprint_pair" CHECK(("imports"."fingerprint_method" is null) = ("imports"."fingerprint_value" is null)),
	CONSTRAINT "imports_parser_pair" CHECK(("imports"."parser_id" is null) = ("imports"."parser_version" is null))
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "members_status" CHECK("members"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`posting_date` text NOT NULL,
	`transaction_date` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`origin` text NOT NULL,
	`raw_description` text,
	`merchant_id` text,
	`category_id` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transactions_amount_minor" CHECK(typeof("transactions"."amount_minor") = 'integer' and "transactions"."amount_minor" between -9007199254740991 and 9007199254740991),
	CONSTRAINT "transactions_currency" CHECK(length("transactions"."currency") = 3 and "transactions"."currency" glob '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "transactions_origin" CHECK("transactions"."origin" in ('manual', 'imported')),
	CONSTRAINT "transactions_imported_description" CHECK("transactions"."origin" = 'manual' or "transactions"."raw_description" is not null)
);
