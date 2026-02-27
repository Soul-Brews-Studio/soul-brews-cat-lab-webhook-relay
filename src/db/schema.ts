import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const webhookHits = sqliteTable('webhook_hits', {
  id:              integer('id').primaryKey({ autoIncrement: true }),
  endpoint:        text('endpoint').notNull(),
  suffix:          text('suffix'),
  received_at:     text('received_at').notNull(),
  response_ms:     integer('response_ms').notNull(),
  body_length:     integer('body_length').notNull(),
  body:            text('body'),
  forward_status:  integer('forward_status'),
  forward_ms:      integer('forward_ms'),
  forward_error:   text('forward_error'),
});

export const forwardRules = sqliteTable('forward_rules', {
  endpoint:    text('endpoint').primaryKey(),
  forward_url: text('forward_url').notNull(),
  enabled:     integer('enabled', { mode: 'boolean' }).notNull().default(true),
  persist:     integer('persist', { mode: 'boolean' }).notNull().default(true),
  created_at:  text('created_at').notNull(),
  updated_at:  text('updated_at').notNull(),
});

export const aliases = sqliteTable('aliases', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  value:      text('value').notNull().unique(),
  label:      text('label').notNull(),
  created_at: text('created_at').notNull(),
});

export type WebhookHit = typeof webhookHits.$inferSelect;
export type NewWebhookHit = typeof webhookHits.$inferInsert;
export type ForwardRule = typeof forwardRules.$inferSelect;
export type Alias = typeof aliases.$inferSelect;
