/**
 * Email-OS Database Connection — Drizzle ORM + PostgreSQL
 * Singleton pool. Reads DATABASE_URL from .env.
 */

import 'dotenv/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
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

export const db: NodePgDatabase<typeof schema> | null = pool ? drizzle(pool, { schema }) : null;

export function isDbAvailable(): boolean {
    return db !== null;
}

export async function closeDb(): Promise<void> {
    if (pool) {
        await pool.end();
        console.log('🔌 Database pool closed');
    }
}

export { schema };
export default db;
