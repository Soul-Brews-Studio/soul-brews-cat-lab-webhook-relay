import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.WEBHOOK_RELAY_URL || "http://localhost:5173";
const API_TOKEN = process.env.WEBHOOK_RELAY_TOKEN || process.env.API_TOKEN;

if (!API_TOKEN) {
  console.error("Missing WEBHOOK_RELAY_TOKEN or API_TOKEN env var");
  process.exit(1);
}

const AUTH_HEADERS = {
  authorization: `Bearer ${API_TOKEN}`,
  "content-type": "application/json",
};

async function api(path: string, opts?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { ...AUTH_HEADERS, ...opts?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

interface HitRecord {
  id: number;
  endpoint: string;
  suffix?: string | null;
  received_at: string;
  response_ms: number;
  body_length: number;
  body?: string | null;
  forward_status?: number | null;
  forward_ms?: number | null;
  forward_error?: string | null;
}

interface HitsResponse {
  date: string;
  from: string;
  to: string;
  count: number;
  hits: HitRecord[];
}

interface StatsResponse {
  total_requests: number;
  avg_response_ms: number;
  oldest_hit_at: string | null;
  recent: HitRecord[];
  forward_rules: unknown[];
  aliases: AliasRecord[];
  d1: { db_size_bytes: number; writes_today: number; limit_storage_bytes: number; limit_writes_day: number };
  [key: string]: unknown;
}

interface AliasRecord {
  id: number;
  value: string;
  label: string;
  created_at: string;
}

function stripBody(hit: HitRecord): Omit<HitRecord, "body"> {
  const { body, ...rest } = hit;
  return rest;
}

interface LineDigestRow {
  time: string;
  group: string;
  from: string;
  type: string;
  text: string;
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

function formatSize(bytes?: number): string {
  if (!bytes) return "?";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

interface LineWebhookBody {
  events?: LineEvent[];
}

function parseLineDigest(
  hits: HitRecord[],
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

      let txt: string;
      if (msg.type === "text") {
        txt = (msg.text ?? "").slice(0, 80);
      } else if (msg.type === "file") {
        txt = `[FILE] ${msg.fileName ?? "unknown"} (${formatSize(msg.fileSize)})`;
      } else if (msg.type === "image") {
        const setInfo = msg.imageSet ? ` ${msg.imageSet.index}/${msg.imageSet.total}` : "";
        txt = `[IMAGE${setInfo}]`;
      } else if (msg.type === "sticker") {
        const kw = msg.keywords?.slice(0, 2).join(", ") ?? "";
        txt = `[STICKER${kw ? `: ${kw}` : ""}]`;
      } else if (msg.type === "video") {
        txt = `[VIDEO]`;
      } else if (msg.type === "audio") {
        txt = `[AUDIO]`;
      } else if (msg.type === "location") {
        txt = `[LOCATION] ${msg.title ?? ""}`;
      } else if (msg.type) {
        txt = `[${msg.type}]`;
      } else {
        txt = `[${ev.type ?? "unknown"}]`;
      }

      rows.push({
        time: hit.received_at.replace("T", " ").replace(/\.\d+Z$/, ""),
        group: aliasMap.get(groupId) ?? (groupId.slice(-6) || "-"),
        from: aliasMap.get(userId) ?? (userId.slice(-6) || "-"),
        type: msg.type ?? ev.type ?? "?",
        text: txt,
      });
    }
  }
  return rows;
}

// ── Server ──

const server = new McpServer({
  name: "webhook-relay",
  version: "1.0.0",
});

// ── Tools ──

server.tool(
  "webhook_stats",
  "Get webhook relay dashboard stats: total requests, avg response time, recent hits, D1 usage",
  {},
  async () => {
    const stats = await api("/api/stats") as StatsResponse;
    const slim = { ...stats, recent: stats.recent.map(stripBody) };
    return text(JSON.stringify(slim, null, 2));
  }
);

server.tool(
  "webhook_hits",
  "Query webhook hits by date and/or endpoint. Date is in GMT+7.",
  {
    date: z.string().optional().describe('Date filter: "today" or "YYYY-MM-DD" (default: today)'),
    endpoint: z.string().optional().describe("Filter by endpoint name"),
  },
  async ({ date, endpoint }) => {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    if (endpoint) params.set("endpoint", endpoint);
    const qs = params.toString();
    const data = await api(`/api/hits${qs ? `?${qs}` : ""}`) as HitsResponse;
    const slim = { ...data, hits: data.hits.map(stripBody) };
    return text(JSON.stringify(slim, null, 2));
  }
);

server.tool(
  "list_forward_rules",
  "List all forwarding rules (endpoint → URL mappings with enabled/persist flags)",
  {},
  async () => {
    const rules = await api("/api/forward-rules");
    return text(JSON.stringify(rules, null, 2));
  }
);

server.tool(
  "set_forward_rule",
  "Create or update a forwarding rule for an endpoint",
  {
    endpoint: z.string().describe("Endpoint name"),
    forward_url: z.string().url().describe("URL to forward webhooks to"),
    enabled: z.boolean().optional().describe("Enable forwarding (default: true)"),
    persist: z.boolean().optional().describe("Save hits to DB (default: true)"),
  },
  async ({ endpoint, forward_url, enabled, persist }) => {
    const data = await api(`/api/forward-rules/${encodeURIComponent(endpoint)}`, {
      method: "PUT",
      body: JSON.stringify({ forward_url, enabled: enabled ?? true, persist: persist ?? true }),
    });
    return text(JSON.stringify(data, null, 2));
  }
);

server.tool(
  "delete_forward_rule",
  "Delete a forwarding rule for an endpoint",
  {
    endpoint: z.string().describe("Endpoint name to delete rule for"),
  },
  async ({ endpoint }) => {
    const data = await api(`/api/forward-rules/${encodeURIComponent(endpoint)}`, {
      method: "DELETE",
    });
    return text(JSON.stringify(data, null, 2));
  }
);

server.tool(
  "list_aliases",
  "List all value aliases with activity data. Filter by type (group/user) or find unaliased IDs from recent webhook hits.",
  {
    type: z.enum(["group", "user", "all"]).optional().describe('Filter: "group" (C-prefix), "user" (U-prefix), or "all" (default: all)'),
    unaliased: z.boolean().optional().describe("If true, return only IDs found in recent hits that have NO alias"),
  },
  async ({ type: typeFilter, unaliased: showUnaliased }) => {
    const filter = typeFilter || "all";

    // Fetch aliases and recent hits in parallel
    const [aliasData, hitsData] = await Promise.all([
      api("/api/aliases") as Promise<AliasRecord[]>,
      api("/api/hits?endpoint=line&date=today") as Promise<HitsResponse>,
    ]);
    const aliasMap = new Map(aliasData.map(a => [a.value, a.label]));

    // Build activity map from recent hits
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

    for (const hit of (hitsData.hits ?? [])) {
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
      const aliasedValues = new Set(aliasData.map(a => a.value));
      const unaliasedList = [...activityMap.entries()]
        .filter(([id]) => !aliasedValues.has(id))
        .map(([id, activity]) => ({
          id,
          type: id.startsWith("C") ? "group" : id.startsWith("U") ? "user" : "other",
          last_seen: activity.lastSeen,
          message_count: activity.count,
          seen_in_groups: [...activity.groups],
        }))
        .filter(item => filter === "all" || item.type === filter)
        .sort((a, b) => b.message_count - a.message_count);

      return text(JSON.stringify({ unaliased: unaliasedList }, null, 2));
    }

    // Normal list with activity enrichment
    let list = aliasData.map(a => {
      const activity = activityMap.get(a.value);
      return {
        ...a,
        last_seen: activity?.lastSeen ?? null,
        message_count: activity?.count ?? 0,
        seen_in_groups: activity ? [...activity.groups] : [],
      };
    });

    if (filter === "group") {
      list = list.filter(a => a.value.startsWith("C"));
    } else if (filter === "user") {
      list = list.filter(a => a.value.startsWith("U"));
    }

    return text(JSON.stringify(list, null, 2));
  }
);

server.tool(
  "set_alias",
  "Create or update an alias label for a webhook field value",
  {
    value: z.string().describe("The raw value to alias"),
    label: z.string().describe("Human-readable label"),
  },
  async ({ value, label }) => {
    const data = await api("/api/aliases", {
      method: "PUT",
      body: JSON.stringify({ value, label }),
    });
    return text(JSON.stringify(data, null, 2));
  }
);

server.tool(
  "delete_alias",
  "Delete an alias by its ID",
  {
    id: z.number().describe("Alias ID to delete"),
  },
  async ({ id }) => {
    const data = await api(`/api/aliases/${id}`, { method: "DELETE" });
    return text(JSON.stringify(data, null, 2));
  }
);

server.tool(
  "purge_old_hits",
  "Delete webhook hits older than 7 days to free D1 storage",
  {},
  async () => {
    const data = await api("/api/purge", { method: "POST" });
    return text(JSON.stringify(data, null, 2));
  }
);

server.tool(
  "generate_webhook_url",
  "Generate a signed webhook URL for an endpoint",
  {
    id: z.string().describe("Endpoint ID to generate URL for"),
  },
  async ({ id }) => {
    const data = await api(`/api/generate-url?id=${encodeURIComponent(id)}`);
    return text(JSON.stringify(data, null, 2));
  }
);

server.tool(
  "line_groups",
  "List active LINE groups for a date with message counts, member names, and alias status.",
  {
    date: z.string().optional().describe('Date filter: "today" or "YYYY-MM-DD" (default: today)'),
  },
  async ({ date }) => {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    params.set("endpoint", "line");
    const qs = params.toString();

    const [hitsData, aliasData] = await Promise.all([
      api(`/api/hits?${qs}`) as Promise<HitsResponse>,
      api("/api/aliases") as Promise<AliasRecord[]>,
    ]);

    const aliasMap = new Map(aliasData.map(a => [a.value, a.label]));
    const groups = new Map<string, { messages: number; users: Set<string>; lastMessage: string }>();

    for (const hit of (hitsData.hits ?? [])) {
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

    return text(JSON.stringify({ date: date || "today", groups: result }, null, 2));
  }
);

server.tool(
  "line_digest",
  "Parse LINE webhook hits into a readable digest table (time, group, from, type, text). Resolves IDs via aliases.",
  {
    date: z.string().optional().describe('Date filter: "today" or "YYYY-MM-DD" (default: today)'),
    endpoint: z.string().optional().describe("LINE endpoint name (default: line)"),
    group: z.string().optional().describe("Filter by group alias or ID substring"),
  },
  async ({ date, endpoint, group }) => {
    const ep = endpoint || "line";
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    params.set("endpoint", ep);
    const qs = params.toString();

    const [hitsData, aliasData] = await Promise.all([
      api(`/api/hits?${qs}`) as Promise<HitsResponse>,
      api("/api/aliases") as Promise<AliasRecord[]>,
    ]);

    const aliasMap = new Map(aliasData.map(a => [a.value, a.label]));
    let rows = parseLineDigest(hitsData.hits ?? [], aliasMap);

    if (group) {
      const gf = group.toLowerCase();
      rows = rows.filter(r => r.group.toLowerCase().includes(gf));
    }

    return text(JSON.stringify({ date: date || "today", endpoint: ep, count: rows.length, messages: rows }, null, 2));
  }
);

// ── Start ──

const transport = new StdioServerTransport();
await server.connect(transport);
