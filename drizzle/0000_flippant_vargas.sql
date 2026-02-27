CREATE TABLE `webhook_hits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`endpoint` text NOT NULL,
	`suffix` text,
	`received_at` text NOT NULL,
	`response_ms` integer NOT NULL,
	`body_length` integer NOT NULL,
	`body` text
);
