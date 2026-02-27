/**
 * Auto-alias: resolve unknown LINE user/group IDs via LINE Messaging API.
 * Called in waitUntil() after recording a webhook hit — non-blocking.
 */

import { getDb } from "./db/index";
import { aliases } from "./db/schema";

interface LineSource {
  type?: string;
  groupId?: string;
  roomId?: string;
  userId?: string;
}

interface LineEvent {
  source?: LineSource;
}

/**
 * Extract unique groupIds and userIds from a LINE webhook body.
 */
function extractIds(body: string): { groupIds: Set<string>; userIds: Map<string, string> } {
  const groupIds = new Set<string>();
  const userIds = new Map<string, string>(); // userId → groupId (for group member profile lookup)

  try {
    const parsed = JSON.parse(body);
    for (const ev of (parsed.events ?? []) as LineEvent[]) {
      const src = ev.source;
      if (!src) continue;
      if (src.groupId) {
        groupIds.add(src.groupId);
        if (src.userId) userIds.set(src.userId, src.groupId);
      } else if (src.userId) {
        userIds.set(src.userId, "");
      }
    }
  } catch {}

  return { groupIds, userIds };
}

/**
 * Fetch LINE group summary (name).
 * https://developers.line.biz/en/reference/messaging-api/#get-group-summary
 */
async function fetchGroupName(groupId: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/group/${groupId}/summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json() as { groupName?: string };
    return data.groupName ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch LINE user display name.
 * If groupId is provided, uses group member profile endpoint.
 * Otherwise falls back to regular profile endpoint.
 */
async function fetchUserName(userId: string, groupId: string, token: string): Promise<string | null> {
  try {
    const url = groupId
      ? `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`
      : `https://api.line.me/v2/bot/profile/${userId}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json() as { displayName?: string };
    return data.displayName ?? null;
  } catch {
    return null;
  }
}

/**
 * Auto-create aliases for unknown LINE IDs found in a webhook body.
 * Safe to call in waitUntil() — all errors are caught.
 */
export async function autoAlias(db: D1Database, body: string, lineToken: string): Promise<void> {
  const { groupIds, userIds } = extractIds(body);
  if (groupIds.size === 0 && userIds.size === 0) return;

  const d = getDb(db);

  // Load existing aliases to check which IDs are already known
  const existing = await d.select({ value: aliases.value }).from(aliases);
  const known = new Set(existing.map(a => a.value));

  const unknownGroups = [...groupIds].filter(id => !known.has(id));
  const unknownUsers = [...userIds.entries()].filter(([id]) => !known.has(id));

  if (unknownGroups.length === 0 && unknownUsers.length === 0) return;

  // Resolve in parallel (but limit concurrency to avoid rate limits)
  const results: { value: string; label: string }[] = [];

  await Promise.all([
    ...unknownGroups.map(async (gid) => {
      const name = await fetchGroupName(gid, lineToken);
      if (name) results.push({ value: gid, label: name });
    }),
    ...unknownUsers.map(async ([uid, gid]) => {
      const name = await fetchUserName(uid, gid, lineToken);
      if (name) results.push({ value: uid, label: name });
    }),
  ]);

  // Insert aliases
  for (const { value, label } of results) {
    await d.insert(aliases).values({
      value,
      label,
      created_at: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: aliases.value,
      set: { label },
    });
  }
}
