/**
 * PULSE CRM — Database Client
 * 
 * Architecture Decisions:
 * 
 * 1. CONNECTION POOLING (PgBouncer-aware):
 *    Uses connection pooling to prevent database collapse during campaign dispatch spikes.
 *    The pool configuration mirrors what PgBouncer would enforce in production.
 *    Reference: "PostgreSQL connection management and per-client process model"
 * 
 * 2. STORAGE-COMPUTE SEPARATION:
 *    Exposes both a primary (read-write) and replica (read-only) client.
 *    All AI-generated queries are routed to the replica to protect OLTP during dispatch.
 *    Reference: "AI Read-Replicas" pattern
 * 
 * 3. DEMO MODE:
 *    When DATABASE_URL is not set, the module exports null clients.
 *    All services fall back to in-memory stores, making the demo portable
 *    without requiring a PostgreSQL installation.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

// ─── Configuration ───────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_REPLICA_URL = process.env.DATABASE_REPLICA_URL || DATABASE_URL;

// Pool configuration — mirrors PgBouncer transaction-mode settings
export const POOL_CONFIG = {
  max: Number(process.env.DB_POOL_MAX || '20'),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT || '30000'),
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT || '5000'),
};

// ─── Primary Client (Read-Write — OLTP) ─────────────────────────────────────

export const db = DATABASE_URL
  ? drizzle(DATABASE_URL, {
      schema,
      logger: process.env.NODE_ENV === 'development',
    })
  : null;

// ─── Replica Client (Read-Only — AI Queries) ────────────────────────────────
// All AI-generated SQL queries are routed here to protect the primary
// during campaign dispatch. This is the "Storage-Compute Separation" pattern.

export const dbReplica = DATABASE_REPLICA_URL
  ? drizzle(DATABASE_REPLICA_URL, {
      schema,
      logger: process.env.NODE_ENV === 'development',
    })
  : null;

// ─── Demo Mode Detection ─────────────────────────────────────────────────────

export const isDemoMode = !DATABASE_URL;

if (isDemoMode) {
  console.log(
    '[DB] Running in DEMO MODE — using in-memory stores. ' +
    'Set DATABASE_URL to connect to PostgreSQL.'
  );
}

// ─── Type Exports ────────────────────────────────────────────────────────────

export type Database = NonNullable<typeof db>;
export type DatabaseReplica = NonNullable<typeof dbReplica>;
