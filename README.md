# Webhook Relay

Receive, store, and forward webhooks with a dashboard. Built on Cloudflare Workers + D1.

## Quick Start (Local)

```bash
git clone https://github.com/Soul-Brews-Studio/webhook-relay-oss.git
cd webhook-relay-oss
npm install
cp .dev.vars.example .dev.vars   # edit credentials if you like
npm run dev                       # → http://localhost:5173
```

`npm run dev` starts a local Vite + Wrangler dev server with a **local D1 database** — no Cloudflare account needed. Migrations run automatically.

Login with the credentials from `.dev.vars` (default: `admin` / `changeme`).

## Expose to the Internet

To receive webhooks from LINE or any external service, expose your local server with a free [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/):

```bash
cloudflared tunnel --url http://localhost:5173
```

This gives you a public `https://xxx.trycloudflare.com` URL. Then:

1. Open the dashboard at your tunnel URL and log in
2. Go to **Generate URL** → enter an endpoint name (e.g. `line`) → copy the signed webhook URL
3. Paste that URL (`https://xxx.trycloudflare.com/w/{id}/{token}`) into your webhook provider (LINE Console, GitHub, etc.)
4. Webhooks arrive in your dashboard

> The signed URL pattern is `/w/{id}/{token}` — the token is HMAC-SHA256, so the URL itself is the auth. No API key needed for senders.

## Production Deploy

When you're ready for always-on hosting:

```bash
npm run deploy   # builds frontend + deploys to CF Workers
```

Or one-click:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Soul-Brews-Studio/webhook-relay-oss)

After deploying, set your `API_TOKEN` secret:

```bash
wrangler secret put API_TOKEN   # enter user:pass when prompted
```

## Features

- **Signed webhook URLs** — Discord-style `/w/{id}/{token}`, no auth headers needed for senders
- **Dashboard** — React + Tailwind v4, real-time hit viewer, login, forwarding rules, alias management
- **Forwarding** — receive → store → forward to any URL, with enable/disable toggle
- **LINE integration** — auto-alias LINE users/groups, message digest with alias resolution
- **GitHub integration** — parsed webhook summaries via `/w/{id}/{token}/github`
- **MCP server** — 12 tools for Claude Code integration (stdio or HTTP transport)
- **D1 storage** — hits, forwarding rules, aliases — all in SQLite

## Connect LINE Webhooks

1. Go to [LINE Developers Console](https://developers.line.biz/console/) → your Messaging API channel
2. Generate a signed webhook URL from the dashboard (endpoint name: `line`)
3. Paste the full `/w/{id}/{token}` URL as the webhook URL in LINE Console
4. Enable "Use webhook"
5. Messages appear in your dashboard with alias resolution

Optional: set `LINE_CHANNEL_ACCESS_TOKEN` in `.dev.vars` to auto-resolve LINE display names.

## Connect to Claude Code (MCP)

### Local stdio (recommended for development)

```bash
claude mcp add webhook-relay \
  -e API_TOKEN=admin:changeme \
  -e WEBHOOK_RELAY_URL=http://localhost:5173 \
  -- npx tsx src/mcp.ts
```

### Remote HTTP (no local install)

```bash
claude mcp add webhook-relay \
  -e API_TOKEN=user:pass \
  -e WEBHOOK_RELAY_URL=https://your-worker.workers.dev \
  -- npx tsx src/mcp.ts
```

See [MCP.md](MCP.md) for the full 12-tool reference.

### Available MCP Tools

| Tool | What it does |
|------|-------------|
| `webhook_stats` | Dashboard overview — total hits, avg response time, D1 usage |
| `webhook_hits` | Query hits by date and/or endpoint |
| `list_forward_rules` | Show all forwarding rules |
| `set_forward_rule` | Create/update forwarding rule |
| `delete_forward_rule` | Remove a forwarding rule |
| `list_aliases` | Show value → label mappings |
| `set_alias` | Create/update an alias |
| `delete_alias` | Remove an alias |
| `purge_old_hits` | Delete hits older than 7 days |
| `generate_webhook_url` | Get a signed URL for an endpoint |
| `line_groups` | List active LINE groups for a date |
| `line_digest` | Parse LINE webhook hits into readable digest |

## Setup Prompt for AI Agents

> Copy this prompt to give an AI coding agent (Claude Code, Cursor, etc.) everything it needs to set up webhook-relay for you.

<details>
<summary>Click to expand agent setup prompt</summary>

```
Set up webhook-relay — a webhook receiver with dashboard and MCP tools.

## Install

git clone https://github.com/Soul-Brews-Studio/webhook-relay-oss.git
cd webhook-relay-oss
npm install
cp .dev.vars.example .dev.vars
npm run dev

The dev server runs at http://localhost:5173 with a local D1 database.
Default login: admin / changeme (configured in .dev.vars as API_TOKEN=admin:changeme).

## Connect as MCP Server

Run this to add webhook-relay as an MCP server:

claude mcp add webhook-relay \
  -e API_TOKEN=admin:changeme \
  -e WEBHOOK_RELAY_URL=http://localhost:5173 \
  -- npx tsx src/mcp.ts

This gives you 12 tools: webhook_stats, webhook_hits, list_forward_rules,
set_forward_rule, delete_forward_rule, list_aliases, set_alias, delete_alias,
purge_old_hits, generate_webhook_url, line_groups, line_digest.

## Receive Webhooks from External Services

Option A — Free tunnel (no account needed):
  cloudflared tunnel --url http://localhost:5173

Option B — Production deploy:
  npm run deploy
  wrangler secret put API_TOKEN

After getting a public URL, generate a signed webhook URL:
  curl -H "Authorization: Bearer admin:changeme" \
    "http://localhost:5173/api/generate-url?id=line"

The returned URL (e.g. /w/line/{token}) goes into LINE Console or any
webhook provider. The URL IS the auth — no extra headers needed.

## Key Routes

POST /w/:id/:token         — receive webhook (signed URL, no auth header needed)
POST /w/:id/:token/github  — receive + parse GitHub events
POST /mcp                  — MCP server (JSON-RPC, needs Bearer auth)
GET  /api/stats            — dashboard stats (needs auth)
GET  /api/hits?date=today  — query stored hits (needs auth)
GET  /api/generate-url?id= — generate signed webhook URL (needs auth)

## Stack

Hono (router) + Cloudflare Workers + D1 (SQLite via Drizzle ORM)
React + Tailwind v4 (dashboard)
HMAC-SHA256 signed URLs (Discord-style)
```

</details>

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `API_TOKEN` | Yes | Auth token (`user:pass` format) — used for dashboard login, API access, and webhook URL signing |
| `LINE_CHANNEL_ACCESS_TOKEN` | No | Auto-fetch LINE display names for aliases |

Set via `.dev.vars` (local) or `wrangler secret put` (production).

## Development

```bash
npm run dev          # Local dev server (Vite + Wrangler, local D1)
npm run build        # Build frontend
npm run deploy       # Build + deploy to CF Workers
npm run db:generate  # Generate Drizzle migrations
npm run db:studio    # Drizzle Studio (inspect local DB)
```

## Architecture

```
LINE / GitHub / Any Service
        │
        ▼
  CF Worker (Hono)
   ├── /w/:id/:token       → receive + store + forward (signed URL)
   ├── /w/:id/:token/github → GitHub event parser
   ├── /mcp                 → MCP server (HTTP transport)
   ├── /api/*               → REST API (auth required)
   └── /*                   → Dashboard (React + Tailwind v4)
        │
        ▼
     D1 (SQLite via Drizzle ORM)
   ├── hits              → webhook payloads
   ├── forward_rules     → endpoint → URL mappings
   └── aliases           → ID → human name
```

## Credits

Built by [Soul Brews Studio](https://github.com/soul-brews-studio)

## License

MIT
