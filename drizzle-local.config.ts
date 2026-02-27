import { defineConfig } from 'drizzle-kit';
import { readdirSync } from 'fs';
import { join } from 'path';

// Find the local D1 SQLite file created by wrangler dev
const d1Dir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const files = readdirSync(d1Dir).filter(f => f.endsWith('.sqlite'));
const dbPath = join(d1Dir, files[0]);

export default defineConfig({
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: { url: dbPath },
});
