import { eq } from 'drizzle-orm';
import { getDb } from './db/index';
import { forwardRules, webhookHits } from './db/schema';
import type { ForwardRule } from './db/schema';

export async function getForwardRule(db: D1Database, endpoint: string): Promise<ForwardRule | null> {
  const d = getDb(db);
  const [rule] = await d
    .select()
    .from(forwardRules)
    .where(eq(forwardRules.endpoint, endpoint))
    .limit(1);
  return rule ?? null;
}

export async function executeForward(
  db: D1Database,
  hitId: number | null,
  forwardUrl: string,
  body: string,
  originalHeaders: Headers,
): Promise<void> {
  const d = getDb(db);
  const start = performance.now();
  let status: number | null = null;
  let error: string | null = null;

  try {
    const headers: Record<string, string> = {
      'content-type': originalHeaders.get('content-type') || 'application/json',
      'user-agent': 'webhook-relay/0.5.0',
    };
    const ghEvent = originalHeaders.get('x-github-event');
    if (ghEvent) headers['x-github-event'] = ghEvent;

    const res = await fetch(forwardUrl, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
  } catch (err: any) {
    status = 0;
    error = err?.message ?? 'Unknown fetch error';
  }

  const forward_ms = Math.round(performance.now() - start);

  if (hitId !== null) {
    await d
      .update(webhookHits)
      .set({ forward_status: status, forward_ms, forward_error: error })
      .where(eq(webhookHits.id, hitId));
  }
}
