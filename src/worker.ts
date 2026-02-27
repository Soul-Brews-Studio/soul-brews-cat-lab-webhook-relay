import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq, and, gte, lt, desc } from "drizzle-orm";
import { recordHit, getStats, purgeOldHits } from "./stats";
import { parseGitHubEvent } from "./github";
import { getForwardRule, executeForward } from "./forward";
import { getDb } from "./db/index";
import { webhookHits, forwardRules, aliases } from "./db/schema";
import { handleMcp } from "./mcp-handler";
import { autoAlias } from "./auto-alias";
import pkg from "../package.json";

export interface Env {
  API_TOKEN?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  DB: D1Database;
  ASSETS: Fetcher;
}

declare const __DEPLOY_TIME__: string;
const DEPLOYED_AT = __DEPLOY_TIME__;

// HMAC-based webhook token: token = HMAC-SHA256(id, API_TOKEN)
async function generateWebhookToken(id: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function verifyWebhookToken(id: string, token: string, secret: string): Promise<boolean> {
  const expected = await generateWebhookToken(id, secret);
  return token === expected;
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

function checkAuth(request: Request, env: Env): boolean {
  if (!env.API_TOKEN) return true;
  const bearer = request.headers.get("authorization");
  if (bearer === `Bearer ${env.API_TOKEN}`) return true;
  const cookie = getCookie(request, "api_token");
  if (cookie === env.API_TOKEN) return true;
  return false;
}

type HonoEnv = { Bindings: Env };

const app = new Hono<HonoEnv>();
app.use("*", cors());

// Auth check — for React SPA to determine logged-in state
app.get("/api/me", (c) => {
  return c.json({ loggedIn: checkAuth(c.req.raw, c.env) });
});

// Generate webhook URL — called by React dashboard
app.get("/api/generate-url", async (c) => {
  if (!checkAuth(c.req.raw, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.query("id");
  if (!id) return c.json({ error: "Missing id" }, 400);
  if (!c.env.API_TOKEN) return c.json({ error: "No API token configured" }, 500);
  const token = await generateWebhookToken(id, c.env.API_TOKEN);
  const url = new URL(c.req.url);
  return c.json({ url: `${url.origin}/w/${id}/${token}` });
});

// Raw webhook: POST /w/{id}/{token}
app.post("/w/:id/:token", async (c) => {
  if (c.env.API_TOKEN) {
    const valid = await verifyWebhookToken(c.req.param("id"), c.req.param("token"), c.env.API_TOKEN);
    if (!valid) return c.json({ error: "Invalid webhook token" }, 401);
  }

  const start = performance.now();
  const body = await c.req.text();
  const received_at = new Date().toISOString();
  const response_ms = Math.round(performance.now() - start);
  const endpoint = c.req.param("id");

  const rule = await getForwardRule(c.env.DB, endpoint);
  const hitId = rule?.persist === false
    ? null
    : await recordHit(c.env.DB, { endpoint, received_at, response_ms, body_length: body.length, body: body.slice(0, 4096) });

  if (rule?.enabled && rule.forward_url) {
    c.executionCtx.waitUntil(executeForward(c.env.DB, hitId, rule.forward_url, body, c.req.raw.headers));
  }

  // Auto-alias unknown LINE users/groups
  if (endpoint === "line" && c.env.LINE_CHANNEL_ACCESS_TOKEN) {
    c.executionCtx.waitUntil(autoAlias(c.env.DB, body, c.env.LINE_CHANNEL_ACCESS_TOKEN));
  }

  return c.json({ ok: true, endpoint, received_at, response_ms });
});

// GitHub-parsed webhook: POST /w/{id}/{token}/github
app.post("/w/:id/:token/github", async (c) => {
  if (c.env.API_TOKEN) {
    const valid = await verifyWebhookToken(c.req.param("id"), c.req.param("token"), c.env.API_TOKEN);
    if (!valid) return c.json({ error: "Invalid webhook token" }, 401);
  }

  const start = performance.now();
  const raw = await c.req.text();
  const event = c.req.header("x-github-event") ?? "unknown";

  let parsed: string;
  try {
    parsed = parseGitHubEvent(event, JSON.parse(raw));
  } catch {
    parsed = `[${event}] (invalid JSON) ${raw.slice(0, 512)}`;
  }

  const received_at = new Date().toISOString();
  const response_ms = Math.round(performance.now() - start);
  const endpoint = c.req.param("id");

  const rule = await getForwardRule(c.env.DB, endpoint);
  const hitId = rule?.persist === false
    ? null
    : await recordHit(c.env.DB, { endpoint, suffix: "/github", received_at, response_ms, body_length: raw.length, body: parsed });

  if (rule?.enabled && rule.forward_url) {
    c.executionCtx.waitUntil(executeForward(c.env.DB, hitId, rule.forward_url, raw, c.req.raw.headers));
  }

  return c.json({ ok: true, endpoint, event, received_at, response_ms });
});

// Dynamic suffix: POST /w/{id}/{token}/{suffix}
app.post("/w/:id/:token/:suffix", async (c) => {
  if (c.env.API_TOKEN) {
    const valid = await verifyWebhookToken(c.req.param("id"), c.req.param("token"), c.env.API_TOKEN);
    if (!valid) return c.json({ error: "Invalid webhook token" }, 401);
  }

  const start = performance.now();
  const body = await c.req.text();
  const received_at = new Date().toISOString();
  const response_ms = Math.round(performance.now() - start);
  const endpoint = c.req.param("id");
  const suffix = c.req.param("suffix");

  const rule = await getForwardRule(c.env.DB, endpoint);
  const hitId = rule?.persist === false
    ? null
    : await recordHit(c.env.DB, { endpoint, suffix: `/${suffix}`, received_at, response_ms, body_length: body.length, body: body.slice(0, 4096) });

  if (rule?.enabled && rule.forward_url) {
    c.executionCtx.waitUntil(executeForward(c.env.DB, hitId, rule.forward_url, body, c.req.raw.headers));
  }

  return c.json({ ok: true, endpoint, suffix, received_at, response_ms });
});

// Login — set cookie
app.post("/auth/login", async (c) => {
  const form = await c.req.formData();
  const user = form.get("username") as string;
  const pass = form.get("password") as string;
  const credential = `${user}:${pass}`;

  if (!c.env.API_TOKEN || credential !== c.env.API_TOKEN) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": `api_token=${credential}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=86400`,
    },
  });
});

// Logout — clear cookie
app.get("/auth/logout", (c) => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": "api_token=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0",
    },
  });
});

// Purge old data
app.post("/api/purge", async (c) => {
  if (!checkAuth(c.req.raw, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const result = await purgeOldHits(c.env.DB);
  return c.json(result);
});

// Forward rules CRUD
app.get("/api/forward-rules", async (c) => {
  if (!checkAuth(c.req.raw, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const d = getDb(c.env.DB);
  const rules = await d.select().from(forwardRules);
  return c.json(rules);
});

app.put("/api/forward-rules/:endpoint", async (c) => {
  if (!checkAuth(c.req.raw, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json() as { forward_url: string; enabled?: boolean; persist?: boolean };
  if (!body.forward_url) return c.json({ error: "Missing forward_url" }, 400);
  try { new URL(body.forward_url); } catch {
    return c.json({ error: "Invalid forward_url" }, 400);
  }
  const now = new Date().toISOString();
  const d = getDb(c.env.DB);
  await d.insert(forwardRules).values({
    endpoint: c.req.param("endpoint"),
    forward_url: body.forward_url,
    enabled: body.enabled ?? true,
    persist: body.persist ?? true,
    created_at: now,
    updated_at: now,
  }).onConflictDoUpdate({
    target: forwardRules.endpoint,
    set: {
      forward_url: body.forward_url,
      enabled: body.enabled ?? true,
      persist: body.persist ?? true,
      updated_at: now,
    },
  });
  return c.json({ ok: true, endpoint: c.req.param("endpoint") });
});

app.delete("/api/forward-rules/:endpoint", async (c) => {
  if (!checkAuth(c.req.raw, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const d = getDb(c.env.DB);
  await d.delete(forwardRules).where(eq(forwardRules.endpoint, c.req.param("endpoint")));
  return c.json({ ok: true });
});

// Aliases CRUD
app.get("/api/aliases", async (c) => {
  if (!checkAuth(c.req.raw, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const d = getDb(c.env.DB);
  const result = await d.select().from(aliases);
  return c.json(result);
});

app.put("/api/aliases", async (c) => {
  if (!checkAuth(c.req.raw, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json() as { value: string; label: string };
  if (!body.value || !body.label) return c.json({ error: "Missing value or label" }, 400);
  const d = getDb(c.env.DB);
  await d.insert(aliases).values({
    value: body.value,
    label: body.label,
    created_at: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: aliases.value,
    set: { label: body.label },
  });
  return c.json({ ok: true, value: body.value, label: body.label });
});

app.delete("/api/aliases/:id", async (c) => {
  if (!checkAuth(c.req.raw, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const d = getDb(c.env.DB);
  await d.delete(aliases).where(eq(aliases.id, Number(c.req.param("id"))));
  return c.json({ ok: true });
});

// Unknown aliases — scan recent hits for IDs without aliases
app.get("/api/aliases/unknown", async (c) => {
  if (!checkAuth(c.req.raw, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const d = getDb(c.env.DB);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [recentHits, allAliases] = await Promise.all([
    d.select().from(webhookHits)
      .where(and(eq(webhookHits.endpoint, "line"), gte(webhookHits.received_at, sevenDaysAgo)))
      .orderBy(desc(webhookHits.received_at)).limit(2000),
    d.select().from(aliases),
  ]);
  const aliasMap = new Map(allAliases.map(a => [a.value, a.label]));

  const activity = new Map<string, { count: number; lastSeen: string; groups: Set<string> }>();
  for (const hit of recentHits) {
    if (!hit.body) continue;
    try {
      const parsed = JSON.parse(hit.body);
      for (const ev of (parsed.events ?? [])) {
        const gid = ev?.source?.groupId ?? "";
        const uid = ev?.source?.userId ?? "";
        for (const id of [gid, uid]) {
          if (!id) continue;
          let entry = activity.get(id);
          if (!entry) { entry = { count: 0, lastSeen: hit.received_at, groups: new Set() }; activity.set(id, entry); }
          entry.count++;
          if (hit.received_at > entry.lastSeen) entry.lastSeen = hit.received_at;
          if (gid && id !== gid) entry.groups.add(aliasMap.get(gid) ?? gid.slice(-8));
        }
      }
    } catch {}
  }

  const unknown = [...activity.entries()]
    .filter(([id]) => !aliasMap.has(id))
    .map(([id, a]) => ({
      id,
      type: id.startsWith("C") ? "group" : id.startsWith("U") ? "user" : "other",
      count: a.count,
      last_seen: a.lastSeen,
      seen_in_groups: [...a.groups],
    }))
    .sort((a, b) => b.count - a.count);

  return c.json(unknown);
});

// Resolve a LINE ID via LINE API and save as alias
app.post("/api/aliases/resolve", async (c) => {
  if (!checkAuth(c.req.raw, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const token = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return c.json({ error: "No LINE_CHANNEL_ACCESS_TOKEN configured" }, 500);
  const body = await c.req.json() as { id: string; groupId?: string };
  if (!body.id) return c.json({ error: "Missing id" }, 400);

  let name: string | null = null;
  const id = body.id;

  if (id.startsWith("C")) {
    const res = await fetch(`https://api.line.me/v2/bot/group/${id}/summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json() as { groupName?: string };
      name = data.groupName ?? null;
    }
  } else if (id.startsWith("U")) {
    const gid = body.groupId;
    const url = gid
      ? `https://api.line.me/v2/bot/group/${gid}/member/${id}`
      : `https://api.line.me/v2/bot/profile/${id}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json() as { displayName?: string };
      name = data.displayName ?? null;
    }
  }

  if (!name) return c.json({ ok: false, error: "Could not resolve name from LINE API" }, 404);

  const d = getDb(c.env.DB);
  await d.insert(aliases).values({
    value: id,
    label: name,
    created_at: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: aliases.value,
    set: { label: name },
  });

  return c.json({ ok: true, value: id, label: name });
});

// Hits query API (date filtering, GMT+7)
app.get("/api/hits", async (c) => {
  if (!checkAuth(c.req.raw, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const dateParam = c.req.query("date");
  const endpointParam = c.req.query("endpoint");

  const GMT7_OFFSET_MS = 7 * 60 * 60 * 1000;
  let fromISO: string;
  let toISO: string;

  if (dateParam === "today" || !dateParam) {
    const nowGmt7 = new Date(Date.now() + GMT7_OFFSET_MS);
    const yyyy = nowGmt7.getUTCFullYear();
    const mm = String(nowGmt7.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(nowGmt7.getUTCDate()).padStart(2, "0");
    fromISO = new Date(`${yyyy}-${mm}-${dd}T00:00:00+07:00`).toISOString();
    toISO = new Date(`${yyyy}-${mm}-${dd}T23:59:59.999+07:00`).toISOString();
  } else {
    fromISO = new Date(`${dateParam}T00:00:00+07:00`).toISOString();
    toISO = new Date(`${dateParam}T23:59:59.999+07:00`).toISOString();
  }

  const d = getDb(c.env.DB);
  const conditions = [gte(webhookHits.received_at, fromISO), lt(webhookHits.received_at, toISO)];
  if (endpointParam) conditions.push(eq(webhookHits.endpoint, endpointParam));

  const hits = await d
    .select()
    .from(webhookHits)
    .where(and(...conditions))
    .orderBy(desc(webhookHits.received_at))
    .limit(500);

  return c.json({ date: dateParam || "today", from: fromISO, to: toISO, count: hits.length, hits });
});

// Stats JSON API
app.get("/api/stats", async (c) => {
  if (!checkAuth(c.req.raw, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const stats = await getStats(c.env.DB);
  return c.json({
    ...stats,
    started_at: DEPLOYED_AT,
    uptime_ms: Date.now() - new Date(DEPLOYED_AT).getTime(),
    version: pkg.version,
    deployedAt: DEPLOYED_AT,
  });
});

// MCP endpoint
app.post("/mcp", async (c) => {
  if (!checkAuth(c.req.raw, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const tokenGen = (id: string) => generateWebhookToken(id, c.env.API_TOKEN!);
  return handleMcp(c.req.raw, c.env.DB, tokenGen);
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const res = await app.fetch(request, env, ctx);
    if (res.status === 404) return env.ASSETS.fetch(request);
    return res;
  },
} satisfies ExportedHandler<Env>;
