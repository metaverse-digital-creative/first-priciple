/**
 * Seed Agent — Signal-to-Seed Pipeline
 */

import bus from '../bus.js';
import { db, isDbAvailable } from '../db/db.js';
import { seeds as seedsTable } from '../db/schema.js';
import { eq, and, asc, desc } from 'drizzle-orm';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Email, Classification, Seed, SeedType, SeedStats, Zone } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
const DATA_DIR = join(ROOT, 'data');

class SeedAgent {
    private seeds: Seed[] = [];
    private seedCounter: number = 0;

    async init(): Promise<void> {
        this.seeds = await this._loadSeeds();
        this.seedCounter = this.seeds.length;
    }

    async evaluate(email: Email, classification: Classification): Promise<Seed | null> {
        if (classification.zone === 'green' && classification.confidence > 0.7) return null;
        const seedType = this.detectSeedType(email, classification);
        if (!seedType) return null;
        return await this.plant(email, seedType, classification);
    }

    detectSeedType(email: Email, classification: Classification): SeedType | null {
        const text = `${email.subject} ${email.snippet}`.toLowerCase();
        const signals = classification.signals || [];

        if (signals.some(s => s.type === 'urgency' && s.level === 'high')) return 'decision-needed';
        if (signals.some(s => s.type === 'vip-sender') ||
            ['opportunity', 'proposal', 'partnership', 'collaboration', 'interested', 'offer',
                'rfq', 'quotation', 'inquiry', 'enquiry', 'quote', '報價', '詢價', '見積'].some(k => text.includes(k))) return 'opportunity';
        if (email.inReplyTo || signals.some(s => s.type === 'urgency' && s.level === 'medium')) return 'follow-up';
        if (signals.some(s => s.type === 'frequent-sender') && classification.zone !== 'green') return 'relationship-build';
        if (classification.zone === 'red') return 'follow-up';
        return null;
    }

    async plant(email: Email, type: SeedType, classification: Classification): Promise<Seed> {
        this.seedCounter++;
        const shelfLife = config.seeds.shelfLife[type] || '7d';
        const expiresAt = this.calculateExpiry(shelfLife);

        const seed: Seed = {
            id: `s${this.seedCounter}`,
            type,
            status: 'planted',
            emailId: email.id,
            threadId: email.threadId,
            sourceFrom: email.from?.email || '',
            sourceSubject: email.subject || '',
            zone: classification.zone,
            score: classification.score,
            shelfLife,
            plantedAt: new Date().toISOString(),
            expiresAt,
            escalated: false,
            harvestedAt: null,
            outcome: null,
            notes: ''
        };

        this.seeds.push(seed);

        if (isDbAvailable() && db) {
            try {
                await db.insert(seedsTable).values({
                    id: seed.id,
                    emailId: seed.emailId,
                    threadId: seed.threadId,
                    type: seed.type,
                    zone: seed.zone,
                    score: seed.score,
                    status: seed.status,
                    shelfLife: seed.shelfLife,
                    escalated: false,
                    sourceFrom: seed.sourceFrom,
                    sourceSubject: seed.sourceSubject,
                    plantedAt: new Date(seed.plantedAt),
                    expiresAt: new Date(seed.expiresAt),
                }).onConflictDoNothing();
            } catch (err) {
                console.warn(`   ⚠️  DB seed insert: ${(err as Error).message}`);
            }
        } else {
            this._saveToFile();
        }

        bus.publish('seed', 'seed.planted', { seedId: seed.id, type, zone: classification.zone, expiresAt });
        return seed;
    }

    async checkEscalation(): Promise<Seed[]> {
        const escalated: Seed[] = [];

        if (isDbAvailable() && db) {
            try {
                const activeSeedsRows = await db.select().from(seedsTable)
                    .where(and(
                        eq(seedsTable.status, 'planted'),
                        eq(seedsTable.escalated, false)
                    ));

                const now = new Date();
                for (const seed of activeSeedsRows) {
                    if (!seed.expiresAt || !seed.plantedAt) continue;
                    const expiry = new Date(seed.expiresAt);
                    const remaining = expiry.getTime() - now.getTime();
                    const halfLife = (expiry.getTime() - new Date(seed.plantedAt).getTime()) / 2;

                    if (remaining < halfLife) {
                        await db.update(seedsTable)
                            .set({ escalated: true, zone: 'red' })
                            .where(eq(seedsTable.id, seed.id));
                        escalated.push({ ...seed, escalated: true, zone: 'red' as Zone } as unknown as Seed);

                        bus.publish('seed', 'seed.escalated', {
                            seedId: seed.id, type: seed.type,
                            remaining: Math.round(remaining / 60000) + 'min'
                        });
                    }
                }
            } catch (err) {
                console.warn(`   ⚠️  DB escalation check: ${(err as Error).message}`);
            }
        } else {
            const now = new Date();
            for (const seed of this.seeds) {
                if (seed.status !== 'planted' || seed.escalated) continue;
                const expiry = new Date(seed.expiresAt);
                const remaining = expiry.getTime() - now.getTime();
                const halfLife = (expiry.getTime() - new Date(seed.plantedAt).getTime()) / 2;

                if (remaining < halfLife) {
                    seed.escalated = true;
                    seed.zone = 'red';
                    escalated.push(seed);
                    bus.publish('seed', 'seed.escalated', {
                        seedId: seed.id, type: seed.type,
                        remaining: Math.round(remaining / 60000) + 'min'
                    });
                }
            }
            if (escalated.length > 0) this._saveToFile();
        }

        return escalated;
    }

    async harvest(seedId: string, outcome: Record<string, unknown> = {}): Promise<Seed | null> {
        const now = new Date().toISOString();

        if (isDbAvailable() && db) {
            try {
                const [updated] = await db.update(seedsTable)
                    .set({ status: 'harvested', harvestedAt: new Date(now), outcome })
                    .where(eq(seedsTable.id, seedId))
                    .returning();

                if (updated) {
                    bus.publish('seed', 'seed.harvested', {
                        seedId, type: updated.type,
                        duration: new Date(now).getTime() - new Date(updated.plantedAt!).getTime()
                    });
                }
                return (updated as unknown as Seed) || null;
            } catch (err) {
                console.warn(`   ⚠️  DB harvest: ${(err as Error).message}`);
            }
        }

        const seed = this.seeds.find(s => s.id === seedId);
        if (!seed) return null;
        seed.status = 'harvested';
        seed.harvestedAt = now;
        seed.outcome = outcome as Seed['outcome'];
        this._saveToFile();
        bus.publish('seed', 'seed.harvested', {
            seedId, type: seed.type,
            duration: new Date(now).getTime() - new Date(seed.plantedAt).getTime()
        });
        return seed;
    }

    async getActive(): Promise<Seed[]> {
        if (isDbAvailable() && db) {
            try {
                return await db.select().from(seedsTable)
                    .where(eq(seedsTable.status, 'planted'))
                    .orderBy(asc(seedsTable.expiresAt)) as unknown as Seed[];
            } catch { /* fallback */ }
        }
        return this.seeds
            .filter(s => s.status === 'planted')
            .sort((a, b) => {
                if (a.zone !== b.zone) return a.zone === 'red' ? -1 : 1;
                return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
            });
    }

    async getStats(): Promise<SeedStats> {
        if (isDbAvailable() && db) {
            try {
                const all = await db.select().from(seedsTable);
                const active = all.filter(s => s.status === 'planted');
                const harvested = all.filter(s => s.status === 'harvested');
                const byType: Record<string, number> = {};
                for (const s of all) byType[s.type] = (byType[s.type] || 0) + 1;
                return {
                    total: all.length, active: active.length, harvested: harvested.length,
                    escalated: active.filter(s => s.escalated).length, byType
                };
            } catch { /* fallback */ }
        }
        const active = this.seeds.filter(s => s.status === 'planted');
        const harvested = this.seeds.filter(s => s.status === 'harvested');
        const byType: Record<string, number> = {};
        for (const s of this.seeds) byType[s.type] = (byType[s.type] || 0) + 1;
        return {
            total: this.seeds.length, active: active.length, harvested: harvested.length,
            escalated: active.filter(s => s.escalated).length, byType
        };
    }

    private calculateExpiry(shelfLife: string): string {
        const now = new Date();
        const match = shelfLife.match(/^(\d+)(h|d)$/);
        if (!match) return new Date(now.getTime() + 7 * 86400000).toISOString();
        const value = parseInt(match[1]);
        const unit = match[2];
        const ms = unit === 'h' ? value * 3600000 : value * 86400000;
        return new Date(now.getTime() + ms).toISOString();
    }

    private async _loadSeeds(): Promise<Seed[]> {
        if (isDbAvailable() && db) {
            try { return await db.select().from(seedsTable) as unknown as Seed[]; }
            catch { /* fallback */ }
        }
        return this._loadFromFile();
    }

    private _loadFromFile(): Seed[] {
        const seedFile = join(DATA_DIR, 'seeds.json');
        if (existsSync(seedFile)) {
            try { return JSON.parse(readFileSync(seedFile, 'utf8')); }
            catch { return []; }
        }
        return [];
    }

    private _saveToFile(): void {
        if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
        writeFileSync(join(DATA_DIR, 'seeds.json'), JSON.stringify(this.seeds, null, 2));
    }
}

export { SeedAgent };
export default SeedAgent;
