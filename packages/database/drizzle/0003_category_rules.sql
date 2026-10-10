CREATE TABLE `category_rules` (
	`household_id` text NOT NULL,
	`normalized_description` text NOT NULL,
	`category_id` text NOT NULL,
	PRIMARY KEY(`household_id`, `normalized_description`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
