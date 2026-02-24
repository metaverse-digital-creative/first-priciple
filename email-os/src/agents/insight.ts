/**
 * Insight Agent — Cross-Thread Intelligence
 */

import bus from '../bus.js';
import { db, isDbAvailable } from '../db/db.js';
import { threads as threadsTable, insights as insightsTable } from '../db/schema.js';
import { desc } from 'drizzle-orm';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Email, Classification, Zone, Trajectory, Insight, Thread } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const DATA_DIR = join(ROOT, 'data');

interface ThreadMessage {
    id: string;
    from?: string;
    zone: Zone;
    date: string;
}

interface InternalThread {
    threadId: string;
    subject: string;
    participants: Set<string>;
    messages: ThreadMessage[];
    zones: Zone[];
    participantCount: number;
    messageCount: number;
    velocity: number;
    temperature: number;
    trajectory: Trajectory;
    firstMessageAt: string;
    lastMessageAt: string;
}

class InsightAgent {
    private threads: Map<string, InternalThread> = new Map();
    private insights: Insight[] = [];

    async init(): Promise<void> {
        this.insights = await this._loadInsights();
    }

    async trackThread(email: Email, classification: Classification): Promise<InternalThread | null> {
        const threadId = email.threadId;
        if (!threadId) return null;

        let thread = this.threads.get(threadId);
        if (!thread) {
            thread = {
                threadId,
                subject: email.subject || '(no subject)',
                participants: new Set<string>(),
                messages: [],
                zones: [],
                participantCount: 0,
                messageCount: 0,
                velocity: 0,
                temperature: 0,
                trajectory: 'new',
                firstMessageAt: email.date || new Date().toISOString(),
                lastMessageAt: email.date || new Date().toISOString()
            };
            this.threads.set(threadId, thread);
        }

        if (email.from?.email) thread.participants.add(email.from.email);
        thread.messages.push({
            id: email.id, from: email.from?.email,
            zone: classification.zone, date: email.date || new Date().toISOString()
        });
        thread.zones.push(classification.zone);
        thread.lastMessageAt = email.date || new Date().toISOString();
        thread.participantCount = thread.participants.size;
        thread.messageCount = thread.messages.length;

        this.updateVelocity(thread);
        this.updateTemperature(thread);
        this.updateTrajectory(thread);

        if (isDbAvailable() && db) {
            try {
                await db.insert(threadsTable).values({
                    threadId: thread.threadId,
                    subject: thread.subject,
                    participantCount: thread.participantCount,
                    messageCount: thread.messageCount,
                    velocity: thread.velocity,
                    temperature: thread.temperature,
                    trajectory: thread.trajectory,
                    zonesSeen: [...thread.zones],
                    participants: [...thread.participants],
                    firstMessageAt: new Date(thread.firstMessageAt),
                    lastMessageAt: new Date(thread.lastMessageAt),
                }).onConflictDoUpdate({
                    target: threadsTable.threadId,
                    set: {
                        participantCount: thread.participantCount,
                        messageCount: thread.messageCount,
                        velocity: thread.velocity,
                        temperature: thread.temperature,
                        trajectory: thread.trajectory,
                        zonesSeen: [...thread.zones],
                        participants: [...thread.participants],
                        lastMessageAt: new Date(thread.lastMessageAt),
                        updatedAt: new Date(),
                    }
                });
            } catch (err) {
                console.warn(`   ⚠️  DB thread upsert: ${(err as Error).message}`);
            }
        }

        await this.checkInsightTriggers(thread);

        bus.publish('insight', 'thread.updated', {
            threadId, messageCount: thread.messageCount,
            velocity: thread.velocity, temperature: thread.temperature,
            trajectory: thread.trajectory
        });

        return thread;
    }

    private updateVelocity(thread: InternalThread): void {
        if (thread.messages.length < 2) { thread.velocity = 0; return; }
        const dates = thread.messages.map(m => new Date(m.date).getTime()).sort((a, b) => a - b);
        const span = (dates[dates.length - 1] - dates[0]) / 86400000;
        thread.velocity = span > 0 ? Math.round((thread.messages.length / span) * 100) / 100 : 0;
    }

    private updateTemperature(thread: InternalThread): void {
        let temp = 0;
        temp += Math.min(thread.messages.length * 10, 30);
        temp += Math.min(thread.participantCount * 10, 20);
        temp += thread.velocity * 5;

        const redCount = thread.zones.filter(z => z === 'red').length;
        const yellowCount = thread.zones.filter(z => z === 'yellow').length;
        temp += redCount * 15;
        temp += yellowCount * 5;

        const lastMsg = new Date(thread.lastMessageAt).getTime();
        const hoursSince = (Date.now() - lastMsg) / 3600000;
        if (hoursSince < 2) temp += 20;
        else if (hoursSince < 24) temp += 10;
        else if (hoursSince > 168) temp -= 20;

        thread.temperature = Math.max(0, Math.min(100, temp));
    }

    private updateTrajectory(thread: InternalThread): void {
        if (thread.messages.length < 3) { thread.trajectory = 'new'; return; }
        const recentZones = thread.zones.slice(-3);
        const weights: Record<string, number> = { red: 3, yellow: 2, green: 1 };
        const recentHeat = recentZones.reduce((sum, z) => sum + (weights[z] || 0), 0) / 3;
        const histHeat = thread.zones.reduce((sum, z) => sum + (weights[z] || 0), 0) / thread.zones.length;

        if (recentHeat > histHeat + 0.5) thread.trajectory = 'heating';
        else if (recentHeat < histHeat - 0.5) thread.trajectory = 'cooling';
        else thread.trajectory = 'steady';
    }

    private async checkInsightTriggers(thread: InternalThread): Promise<void> {
        if (thread.velocity > 3) {
            await this.generateInsight({
                threadId: thread.threadId, type: 'velocity-spike',
                message: `Thread "${thread.subject}" has high velocity (${thread.velocity} msgs/day)`,
                severity: 'warning', data: { velocity: thread.velocity }, createdAt: ''
            });
        }
        if (thread.temperature > 80) {
            await this.generateInsight({
                threadId: thread.threadId, type: 'hot-thread',
                message: `Thread "${thread.subject}" is very hot (temp: ${thread.temperature})`,
                severity: 'critical', data: { temperature: thread.temperature }, createdAt: ''
            });
        }
        if (thread.participantCount >= 5) {
            await this.generateInsight({
                threadId: thread.threadId, type: 'multi-party',
                message: `Thread "${thread.subject}" has ${thread.participantCount} participants`,
                severity: 'info', data: { participants: [...thread.participants] }, createdAt: ''
            });
        }
    }

    async generateInsight(insight: Insight): Promise<void> {
        const full: Insight = { ...insight, createdAt: new Date().toISOString() };
        this.insights.push(full);

        if (isDbAvailable() && db) {
            try {
                await db.insert(insightsTable).values({
                    threadId: insight.threadId,
                    type: insight.type,
                    message: insight.message,
                    severity: insight.severity || 'info',
                    data: (insight.data || {}) as Record<string, unknown>,
                });
            } catch (err) {
                console.warn(`   ⚠️  DB insight insert: ${(err as Error).message}`);
                this._saveToFile();
            }
        } else {
            this._saveToFile();
        }

        bus.publish('insight', 'insight.generated', {
            type: insight.type, severity: insight.severity, threadId: insight.threadId
        });
    }

    async getHotThreads(limit: number = 5): Promise<InternalThread[]> {
        if (isDbAvailable() && db) {
            try {
                return await db.select().from(threadsTable)
                    .orderBy(desc(threadsTable.temperature))
                    .limit(limit) as unknown as InternalThread[];
            } catch { /* fallback */ }
        }
        return [...this.threads.values()]
            .sort((a, b) => b.temperature - a.temperature)
            .slice(0, limit);
    }

    async getRecentInsights(limit: number = 10): Promise<Insight[]> {
        if (isDbAvailable() && db) {
            try {
                return await db.select().from(insightsTable)
                    .orderBy(desc(insightsTable.createdAt))
                    .limit(limit) as unknown as Insight[];
            } catch { /* fallback */ }
        }
        return this.insights.slice(-limit);
    }

    private async _loadInsights(): Promise<Insight[]> {
        if (isDbAvailable() && db) {
            try { return await db.select().from(insightsTable) as unknown as Insight[]; }
            catch { /* fallback */ }
        }
        const insightFile = join(DATA_DIR, 'insights.json');
        if (existsSync(insightFile)) {
            try { return JSON.parse(readFileSync(insightFile, 'utf8')); }
            catch { return []; }
        }
        return [];
    }

    private _saveToFile(): void {
        if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
        writeFileSync(join(DATA_DIR, 'insights.json'), JSON.stringify(this.insights, null, 2));
    }
}

export { InsightAgent };
export default InsightAgent;
