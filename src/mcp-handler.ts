/**
 * MCP Streamable HTTP handler for Cloudflare Workers.
 * Implements JSON-RPC 2.0 protocol for MCP tools/list and tools/call.
 * No MCP SDK needed — just raw protocol over POST /mcp.
 */

import { eq, and, gte, lt, desc, asc } from "drizzle-orm";
import { getDb } from "./db/index";
import { webhookHits, forwardRules, aliases, type WebhookHit } from "./db/schema";
import { getStats, purgeOldHits } from "./stats";

const SERVER_INFO = {
  name: "webhook-relay",
  version: "1.0.0",
};

const PROTOCOL_VERSION = "2025-03-26";

// ── Helpers ──

function formatSize(bytes?: number): string {
  if (!bytes) return "?";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

interface LineMessage {
  type?: string;
  text?: string;
  fileName?: string;
  fileSize?: number;
  imageSet?: { index?: number; total?: number };
  keywords?: string[];
  title?: string;
}

interface LineEvent {
  type?: string;
  source?: { type?: string; groupId?: string; roomId?: string; userId?: string };
  message?: LineMessage;
}

interface LineWebhookBody {
  events?: LineEvent[];
}

interface LineDigestRow {
  time: string;
  group: string;
  from: string;
  type: string;
  text: string;
}

function parseLineDigest(
  hits: WebhookHit[],
  aliasMap: Map<string, string>,
): LineDigestRow[] {
  const rows: LineDigestRow[] = [];
  for (const hit of hits) {
    if (!hit.body) continue;
    let parsed: LineWebhookBody;
    try {
      parsed = JSON.parse(hit.body);
    } catch {
      continue;
    }
    const events = parsed.events ?? [];
    for (const ev of events) {
      const src = ev.source ?? {};
      const msg = ev.message ?? {};
      const groupId = src.groupId ?? src.roomId ?? "";
      const userId = src.userId ?? "";

      let text: string;
      if (msg.type === "text") {
        text = msg.text ?? "";
      } else if (msg.type === "file") {
        text = `[FILE] ${msg.fileName ?? "unknown"} (${formatSize(msg.fileSize)})`;
      } else if (msg.type === "image") {
        const setInfo = msg.imageSet ? ` ${msg.imageSet.index}/${msg.imageSet.total}` : "";
        text = `[IMAGE${setInfo}]`;
      } else if (msg.type === "sticker") {
        const kw = msg.keywords?.slice(0, 2).join(", ") ?? "";
        text = `[STICKER${kw ? `: ${kw}` : ""}]`;
      } else if (msg.type === "video") {
        text = `[VIDEO]`;
      } else if (msg.type === "audio") {
        text = `[AUDIO]`;
      } else if (msg.type === "location") {
        text = `[LOCATION] ${msg.title ?? ""}`;
      } else if (msg.type) {
        text = `[${msg.type}]`;
      } else {
        text = `[${ev.type ?? "unknown"}]`;
      }

      // Convert to Bangkok time (GMT+7)
      const utc = new Date(hit.received_at);
      const bkk = new Date(utc.getTime() + 7 * 60 * 60 * 1000);
      const timeStr = `${String(bkk.getUTCHours()).padStart(2, "0")}:${String(bkk.getUTCMinutes()).padStart(2, "0")}`;

      rows.push({
        time: timeStr,
        group: aliasMap.get(groupId) ?? (groupId.slice(-6) || "-"),
        from: aliasMap.get(userId) ?? (userId.slice(-6) || "-"),
        type: msg.type ?? ev.type ?? "?",
        text,
      });
    }
  }
  return rows;
}

// ── Tool Definitions ──

const TOOLS = [
  {
    name: "webhook_stats",
    description: "Get webhook relay dashboard stats: total requests, avg response time, recent hits, D1 usage",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "webhook_hits",
    description: "Query webhook hits by date and/or endpoint. Date is in GMT+7. Use group param to filter by LINE groupId.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: 'Date filter: "today" or "YYYY-MM-DD" (default: today)' },
        endpoint: { type: "string", description: "Filter by endpoint name" },
        group: { type: "string", description: "Filter by LINE groupId (exact match in body)" },
      },
    },
  },
  {
    name: "list_forward_rules",
    description: "List all forwarding rules (endpoint to URL mappings with enabled/persist flags)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_forward_rule",
    description: "Create or update a forwarding rule for an endpoint",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string", description: "Endpoint name" },
        forward_url: { type: "string", description: "URL to forward webhooks to" },
        enabled: { type: "boolean", description: "Enable forwarding (default: true)" },
        persist: { type: "boolean", description: "Save hits to DB (default: true)" },
      },
      required: ["endpoint", "forward_url"],
    },
  },
  {
    name: "delete_forward_rule",
    description: "Delete a forwarding rule for an endpoint",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string", description: "Endpoint name to delete rule for" },
      },
      required: ["endpoint"],
    },
  },
  {
    name: "list_aliases",
    description: "List all value aliases with activity data. Filter by type (group/user) or find unaliased IDs from recent webhook hits.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["group", "user", "all"], description: 'Filter by type: "group" (C-prefix), "user" (U-prefix), or "all" (default: all)' },
        unaliased: { type: "boolean", description: "If true, return only IDs found in recent hits that have NO alias" },
      },
    },
  },
  {
    name: "set_alias",
    description: "Create or update an alias label for a webhook field value",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string", description: "The raw value to alias" },
        label: { type: "string", description: "Human-readable label" },
      },
      required: ["value", "label"],
    },
  },
  {
    name: "delete_alias",
    description: "Delete an alias by its ID",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Alias ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "purge_old_hits",
    description: "Delete webhook hits older than 7 days to free D1 storage",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "generate_webhook_url",
    description: "Generate a signed webhook URL for an endpoint",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Endpoint ID to generate URL for" },
      },
      required: ["id"],
    },
  },
  {
    name: "line_groups",
    description: "List active LINE groups for a date with message counts and member names. Use this first to see which groups are active, then query line_digest per group for full detail.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: 'Date filter: "today" or "YYYY-MM-DD" (default: today)' },
      },
    },
  },
  {
    name: "line_digest",
    description: "Parse LINE webhook hits into a readable digest with full message text. Resolves IDs via aliases. Always filter by group for best results.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: 'Date filter: "today" or "YYYY-MM-DD" (default: today)' },
        endpoint: { type: "string", description: "LINE endpoint name (default: line)" },
        group: { type: "string", description: "Filter by group alias name or groupId (recommended — query one group at a time)" },
      },
    },
  },
];

// ── Tool Handlers ──

async function callTool(
  name: string,
  args: Record<string, unknown>,
  db: D1Database,
  generateToken: (id: string) => Promise<string>,
  origin: string,
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  const d = getDb(db);

  switch (name) {
    case "webhook_stats": {
      const stats = await getStats(db);
      return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
    }

    case "webhook_hits": {
      const dateParam = (args.date as string) || "today";
      const endpointParam = args.endpoint as string | undefined;
      const groupParam = args.group as string | undefined;
      const GMT7_OFFSET_MS = 7 * 60 * 60 * 1000;
      let fromISO: string;
      let toISO: string;

      if (dateParam === "today") {
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

      const conditions = [gte(webhookHits.received_at, fromISO), lt(webhookHits.received_at, toISO)];
      if (endpointParam) conditions.push(eq(webhookHits.endpoint, endpointParam));

      let hits = await d.select().from(webhookHits).where(and(...conditions)).orderBy(desc(webhookHits.received_at)).limit(500);

      // Client-side filter by groupId in body (D1 doesn't support JSON queries)
      if (groupParam) {
        hits = hits.filter(h => {
          if (!h.body) return false;
          try {
            const parsed = JSON.parse(h.body);
            return parsed?.events?.[0]?.source?.groupId === groupParam;
          } catch { return false; }
        });
      }

      return { content: [{ type: "text", text: JSON.stringify({ date: dateParam, count: hits.length, hits }, null, 2) }] };
    }

    case "list_forward_rules": {
      const rules = await d.select().from(forwardRules);
      return { content: [{ type: "text", text: JSON.stringify(rules, null, 2) }] };
    }

    case "set_forward_rule": {
      const ep = args.endpoint as string;
      const fwd = args.forward_url as string;
      try { new URL(fwd); } catch {
        return { content: [{ type: "text", text: "Error: Invalid forward_url" }], isError: true };
      }
      const now = new Date().toISOString();
      await d.insert(forwardRules).values({
        endpoint: ep,
        forward_url: fwd,
        enabled: (args.enabled as boolean) ?? true,
        persist: (args.persist as boolean) ?? true,
        created_at: now,
        updated_at: now,
      }).onConflictDoUpdate({
        target: forwardRules.endpoint,
        set: {
          forward_url: fwd,
          enabled: (args.enabled as boolean) ?? true,
          persist: (args.persist as boolean) ?? true,
          updated_at: now,
        },
      });
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, endpoint: ep }) }] };
    }

    case "delete_forward_rule": {
      await d.delete(forwardRules).where(eq(forwardRules.endpoint, args.endpoint as string));
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
    }

    case "list_aliases": {
      const typeFilter = (args.type as string) || "all";
      const showUnaliased = args.unaliased === true;

      // Scan recent hits (7 days) for activity data
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const recentHits = await d.select().from(webhookHits)
        .where(and(eq(webhookHits.endpoint, "line"), gte(webhookHits.received_at, sevenDaysAgo)))
        .orderBy(desc(webhookHits.received_at))
        .limit(2000);

      // Build activity map: id → { lastSeen, count, groups }
      const activityMap = new Map<string, { lastSeen: string; count: number; groups: Set<string> }>();
      function trackActivity(id: string, receivedAt: string, groupLabel?: string) {
        if (!id) return;
        let entry = activityMap.get(id);
        if (!entry) {
          entry = { lastSeen: receivedAt, count: 0, groups: new Set() };
          activityMap.set(id, entry);
        }
        entry.count++;
        if (receivedAt > entry.lastSeen) entry.lastSeen = receivedAt;
        if (groupLabel) entry.groups.add(groupLabel);
      }

      const allAliases = await d.select().from(aliases);
      const aliasMap = new Map(allAliases.map(a => [a.value, a.label]));

      for (const hit of recentHits) {
        if (!hit.body) continue;
        try {
          const parsed = JSON.parse(hit.body);
          for (const ev of (parsed.events ?? [])) {
            const gid = ev?.source?.groupId ?? "";
            const uid = ev?.source?.userId ?? "";
            const groupLabel = aliasMap.get(gid) ?? (gid.slice(-6) || undefined);
            if (gid) trackActivity(gid, hit.received_at, undefined);
            if (uid) trackActivity(uid, hit.received_at, groupLabel);
          }
        } catch {}
      }

      if (showUnaliased) {
        // Return IDs found in hits but missing from aliases
        const aliasedValues = new Set(allAliases.map(a => a.value));
        const unaliasedList = [...activityMap.entries()]
          .filter(([id]) => !aliasedValues.has(id))
          .map(([id, activity]) => ({
            id,
            type: id.startsWith("C") ? "group" : id.startsWith("U") ? "user" : "other",
            first_seen: activity.lastSeen, // approximate — we only have recent window
            last_seen: activity.lastSeen,
            message_count: activity.count,
            seen_in_groups: [...activity.groups],
          }))
          .filter(item => typeFilter === "all" || item.type === typeFilter)
          .sort((a, b) => b.message_count - a.message_count);

        return { content: [{ type: "text", text: JSON.stringify({ unaliased: unaliasedList }, null, 2) }] };
      }

      // Normal alias list with activity enrichment
      let list = allAliases.map(a => {
        const activity = activityMap.get(a.value);
        return {
          ...a,
          last_seen: activity?.lastSeen ?? null,
          message_count: activity?.count ?? 0,
          seen_in_groups: activity ? [...activity.groups] : [],
        };
      });

      if (typeFilter === "group") {
        list = list.filter(a => a.value.startsWith("C"));
      } else if (typeFilter === "user") {
        list = list.filter(a => a.value.startsWith("U"));
      }

      return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
    }

    case "set_alias": {
      await d.insert(aliases).values({
        value: args.value as string,
        label: args.label as string,
        created_at: new Date().toISOString(),
      }).onConflictDoUpdate({
        target: aliases.value,
        set: { label: args.label as string },
      });
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, value: args.value, label: args.label }) }] };
    }

    case "delete_alias": {
      await d.delete(aliases).where(eq(aliases.id, args.id as number));
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
    }

    case "purge_old_hits": {
      const result = await purgeOldHits(db);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    case "generate_webhook_url": {
      const id = args.id as string;
      const token = await generateToken(id);
      return { content: [{ type: "text", text: JSON.stringify({ url: `${origin}/w/${id}/${token}` }) }] };
    }

    case "line_groups": {
      const dateParam = (args.date as string) || "today";
      const GMT7_OFFSET_MS = 7 * 60 * 60 * 1000;
      let fromISO: string;
      let toISO: string;

      if (dateParam === "today") {
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

      const hits = await d.select().from(webhookHits)
        .where(and(eq(webhookHits.endpoint, "line"), gte(webhookHits.received_at, fromISO), lt(webhookHits.received_at, toISO)))
        .orderBy(desc(webhookHits.received_at)).limit(500);
      const allAliases = await d.select().from(aliases);
      const aliasMap = new Map(allAliases.map(a => [a.value, a.label]));

      // Aggregate by group
      const groups = new Map<string, { messages: number; users: Set<string>; lastMessage: string }>();
      for (const hit of hits) {
        if (!hit.body) continue;
        try {
          const parsed = JSON.parse(hit.body);
          for (const ev of (parsed.events ?? [])) {
            const gid = ev?.source?.groupId;
            const uid = ev?.source?.userId;
            if (!gid) continue;
            if (!groups.has(gid)) groups.set(gid, { messages: 0, users: new Set(), lastMessage: "" });
            const g = groups.get(gid)!;
            g.messages++;
            if (uid) g.users.add(uid);
            if (ev?.message?.type === "text" && ev.message.text && !g.lastMessage) {
              g.lastMessage = ev.message.text.slice(0, 60);
            }
          }
        } catch {}
      }

      const result = [...groups.entries()].map(([gid, g]) => ({
        groupId: gid,
        groupName: aliasMap.get(gid) ?? gid,
        aliased: aliasMap.has(gid),
        messages: g.messages,
        activeUsers: [...g.users].map(uid => ({
          name: aliasMap.get(uid) ?? uid.slice(-6),
          aliased: aliasMap.has(uid),
        })),
        lastMessage: g.lastMessage,
      })).sort((a, b) => b.messages - a.messages);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ date: dateParam, groups: result }, null, 2),
        }],
      };
    }

    case "line_digest": {
      const dateParam = (args.date as string) || "today";
      const endpointParam = (args.endpoint as string) || "line";
      const groupFilter = args.group as string | undefined;
      const GMT7_OFFSET_MS = 7 * 60 * 60 * 1000;
      let fromISO: string;
      let toISO: string;

      if (dateParam === "today") {
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

      const conditions = [
        eq(webhookHits.endpoint, endpointParam),
        gte(webhookHits.received_at, fromISO),
        lt(webhookHits.received_at, toISO),
      ];

      const hits = await d.select().from(webhookHits).where(and(...conditions)).orderBy(asc(webhookHits.received_at)).limit(500);
      const allAliases = await d.select().from(aliases);
      const aliasMap = new Map(allAliases.map(a => [a.value, a.label]));

      let rows = parseLineDigest(hits, aliasMap);
      if (groupFilter) {
        const gf = groupFilter.toLowerCase();
        rows = rows.filter(r => r.group.toLowerCase().includes(gf));
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ date: dateParam, endpoint: endpointParam, count: rows.length, messages: rows }, null, 2),
        }],
      };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}

// ── JSON-RPC helpers ──

function jsonrpc(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function jsonrpcError(id: unknown, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

// ── Main handler ──

export async function handleMcp(
  request: Request,
  db: D1Database,
  generateToken: (id: string) => Promise<string>,
): Promise<Response> {
  if (request.method === "GET") {
    return Response.json({
      jsonrpc: "2.0",
      result: {
        ...SERVER_INFO,
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
      },
    });
  }

  if (request.method === "DELETE") {
    return new Response(null, { status: 200 });
  }

  // POST — JSON-RPC request
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonrpcError(null, -32700, "Parse error");
  }

  const { id, method, params } = body;

  switch (method) {
    case "initialize":
      return jsonrpc(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case "notifications/initialized":
      return new Response(null, { status: 204 });

    case "ping":
      return jsonrpc(id, {});

    case "tools/list":
      return jsonrpc(id, { tools: TOOLS });

    case "tools/call": {
      const toolName = params?.name;
      const toolArgs = params?.arguments ?? {};
      const origin = new URL(request.url).origin;
      try {
        const result = await callTool(toolName, toolArgs, db, generateToken, origin);
        return jsonrpc(id, result);
      } catch (err: any) {
        return jsonrpc(id, {
          content: [{ type: "text", text: `Error: ${err?.message ?? "Unknown"}` }],
          isError: true,
        });
      }
    }

    default:
      return jsonrpcError(id, -32601, `Method not found: ${method}`);
  }
}
