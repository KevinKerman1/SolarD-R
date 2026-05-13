#!/usr/bin/env node
// Apply SQL migrations to the leads DB and analytics DB. Idempotent.
// Usage: node migrate.js

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

async function run(label, connStr, sqlFiles) {
  if (!connStr) {
    console.log(`[migrate] skipping ${label}: no connection string`);
    return;
  }
  const pool = new Pool({
    connectionString: connStr,
    ssl: connStr.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  try {
    for (const f of sqlFiles) {
      const sql = fs.readFileSync(f, 'utf8');
      console.log(`[migrate] ${label} <- ${path.basename(f)}`);
      await pool.query(sql);
    }
    console.log(`[migrate] ${label} OK`);
  } finally {
    await pool.end();
  }
}

(async () => {
  const dir = path.join(__dirname, 'db', 'migrations');
  try {
    await run('leads',     process.env.DATABASE_URL_LEADS,     [path.join(dir, '001_leads.sql')]);
    await run('analytics', process.env.DATABASE_URL_ANALYTICS, [path.join(dir, '002_events.sql')]);
    process.exit(0);
  } catch (e) {
    console.error('[migrate] FAILED', e);
    process.exit(1);
  }
})();
