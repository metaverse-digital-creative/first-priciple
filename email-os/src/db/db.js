/**
 * Email-OS Database Connection — Drizzle ORM + PostgreSQL
 * 
 * Singleton connection pool. Reads DATABASE_URL from .env.
 * Usage: import { db } from './db/db.js';
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
    console.warn('⚠️  DATABASE_URL not set. Database features disabled.');
}

const pool = process.env.DATABASE_URL
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    })
    : null;

/** @type {import('drizzle-orm/node-postgres').NodePgDatabase<typeof schema> | null} */
export const db = pool ? drizzle(pool, { schema }) : null;

/**
 * Check if DB is available
 */
export function isDbAvailable() {
    return db !== null;
}

/**
 * Graceful shutdown
 */
export async function closeDb() {
    if (pool) {
        await pool.end();
        console.log('🔌 Database pool closed');
    }
}

export { schema };
export default db;
