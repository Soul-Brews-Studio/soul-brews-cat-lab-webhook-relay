# Webhook Relay MCP

## Install (Claude Code CLI)

```bash
claude mcp add webhook-relay \
  -e API_TOKEN=<user>:<pass> \
  -- npx tsx /path/to/webhook-relay/src/mcp.ts
```

Or add to `.claude.json`:

```json
{
  "mcpServers": {
    "webhook-relay": {
      "command": "npx",
      "args": ["tsx", "/path/to/webhook-relay/src/mcp.ts"],
      "env": { "API_TOKEN": "<user>:<pass>" }
    }
  }
}
```

## Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| `API_TOKEN` | Yes | — |
| `WEBHOOK_RELAY_URL` | No | `http://localhost:5173` (local) or your production URL |

## Remote MCP (HTTP, no local install)

```
POST https://your-worker.workers.dev/mcp
Authorization: Bearer <user>:<pass>
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

## Tools

| Tool | Purpose |
|------|---------|
| `webhook_stats` | Dashboard overview (total, avg response, D1 usage) |
| `webhook_hits` | Query hits by date/endpoint (GMT+7) |
| `list_forward_rules` | Show all forwarding rules |
| `set_forward_rule` | Create/update rule (endpoint, url, enabled, persist) |
| `delete_forward_rule` | Remove a rule |
| `list_aliases` | Show value aliases |
| `set_alias` | Create/update alias (value → label) |
| `delete_alias` | Remove alias by ID |
| `purge_old_hits` | Delete hits older than 7 days |
| `generate_webhook_url` | Get signed URL for an endpoint |

## Architecture

```
Local stdio MCP → REST API → CF Worker → D1 (Drizzle ORM)
Remote HTTP MCP → CF Worker → D1 (Drizzle ORM, direct)
```
