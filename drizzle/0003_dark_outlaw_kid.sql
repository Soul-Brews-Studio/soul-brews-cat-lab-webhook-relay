CREATE TABLE `forward_rules` (
	`endpoint` text PRIMARY KEY NOT NULL,
	`forward_url` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `webhook_hits` ADD `forward_status` integer;--> statement-breakpoint
ALTER TABLE `webhook_hits` ADD `forward_ms` integer;--> statement-breakpoint
ALTER TABLE `webhook_hits` ADD `forward_error` text;