// Postgres pool shared by the auth and admin routes.
//
// The web service runs inside Railway, so it uses the PRIVATE DATABASE_URL
// (postgres.railway.internal). That host does not resolve outside Railway,
// which is why CI uses DATABASE_PUBLIC_URL instead.

import pg from "pg";

const { Pool } = pg;

let pool = null;

export function databaseUrl() {
  return (process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || "").trim();
}

export function dbEnabled() {
  return databaseUrl().length > 0;
}

export function getPool() {
  if (pool) return pool;
  const connectionString = databaseUrl();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — accounts are unavailable");
  }
  pool = new Pool({
    connectionString,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Railway's public proxy terminates TLS with a cert the default trust
    // store does not chain to. The private host is inside their network.
    ssl: /proxy\.rlwy\.net|\.railway\.app/.test(connectionString)
      ? { rejectUnauthorized: false }
      : false,
  });
  pool.on("error", (err) => console.error("pg pool error:", err.message));
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

/** Apply the app schema. Idempotent — safe on every boot. */
export async function ensureSchema() {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(path.join(here, "schema.sql"), "utf8");
  await query(sql);
}
