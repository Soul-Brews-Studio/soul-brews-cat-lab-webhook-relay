import { asc, desc, count, avg, gte, lt, sql } from 'drizzle-orm';
import { getDb } from './db/index';
import { webhookHits, forwardRules, aliases, type NewWebhookHit } from './db/schema';

export type { WebhookHit } from './db/schema';

const D1_LIMIT_STORAGE_BYTES = 5_000_000_000; // 5 GB
const D1_LIMIT_WRITES_DAY = 100_000;

export async function recordHit(db: D1Database, hit: Omit<NewWebhookHit, 'id'>): Promise<number> {
  const result = await getDb(db).insert(webhookHits).values(hit).run();
  return result.meta.last_row_id as number;
}

export async function purgeOldHits(db: D1Database) {
  const d = getDb(db);
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await d.delete(webhookHits).where(lt(webhookHits.received_at, cutoff));
  return { deleted: result.meta.changes ?? 0 };
}

export async function getStats(db: D1Database) {
  const d = getDb(db);
  const todayISO = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();

  const [totals] = await d
    .select({ total_requests: count(), avg_response_ms: avg(webhookHits.response_ms) })
    .from(webhookHits);

  const [{ writes_today }] = await d
    .select({ writes_today: count() })
    .from(webhookHits)
    .where(gte(webhookHits.received_at, todayISO));

  const sizeResult = await d.run(sql`SELECT 1`);
  const db_size_bytes = sizeResult.meta.size_after ?? 0;

  const recent = await d
    .select()
    .from(webhookHits)
    .orderBy(desc(webhookHits.received_at))
    .limit(50);

  const oldest = await d
    .select({ received_at: webhookHits.received_at })
    .from(webhookHits)
    .orderBy(asc(webhookHits.received_at))
    .limit(1);

  const rules = await d.select().from(forwardRules);
  const allAliases = await d.select().from(aliases);

  return {
    total_requests: totals.total_requests ?? 0,
    avg_response_ms: Math.round(Number(totals.avg_response_ms ?? 0)),
    oldest_hit_at: oldest[0]?.received_at ?? null,
    recent,
    forward_rules: rules,
    aliases: allAliases,
    d1: {
      db_size_bytes,
      writes_today,
      limit_storage_bytes: D1_LIMIT_STORAGE_BYTES,
      limit_writes_day: D1_LIMIT_WRITES_DAY,
    },
  };
}
