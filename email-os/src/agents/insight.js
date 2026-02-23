/**
 * Insight Agent — Cross-Thread Intelligence
 * 
 * Novel Pattern: thread-intelligence
 * Model threads as living entities with velocity, temperature, and trajectory.
 * 
 * Pattern: anticipation-loop-engagement (franchise-os → email-os)
 * "This thread is heating up" creates an open loop.
 * 
 * Wisdom Question: "What story are these threads telling together?"
 */

import bus from '../bus.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const DATA_DIR = join(ROOT, 'data');

class InsightAgent {
    constructor() {
        this.threads = new Map();   // threadId → thread intelligence
        this.insights = this.loadInsights();
    }

    /**
     * Update thread intelligence with a new email
     * @param {object} email - Normalized email
     * @param {object} classification - Zone classification
     */
    trackThread(email, classification) {
        const threadId = email.threadId;

        if (!this.threads.has(threadId)) {
            this.threads.set(threadId, {
                threadId,
                subject: email.subject,
                participants: new Set(),
                messages: [],
                velocity: 0,        // replies per day
                temperature: 50,     // 0-100 engagement heat
                trajectory: 'stable', // rising, falling, stable
                zones: [],
                firstSeen: email.date,
                lastSeen: email.date
            });
        }

        const thread = this.threads.get(threadId);
        thread.participants.add(email.from?.email);
        thread.messages.push({
            id: email.id,
            from: email.from,
            date: email.date,
            zone: classification.zone,
            score: classification.score
        });
        thread.zones.push(classification.zone);
        thread.lastSeen = email.date;

        // Recalculate metrics
        this.updateVelocity(thread);
        this.updateTemperature(thread);
        this.updateTrajectory(thread);

        bus.publish('insight', 'thread.updated', {
            threadId,
            velocity: thread.velocity,
            temperature: thread.temperature,
            trajectory: thread.trajectory,
            messageCount: thread.messages.length
        });

        // Check for insight triggers
        this.checkInsightTriggers(thread);

        return thread;
    }

    /**
     * Calculate reply velocity (messages per day)
     */
    updateVelocity(thread) {
        if (thread.messages.length < 2) {
            thread.velocity = 0;
            return;
        }

        const first = new Date(thread.firstSeen);
        const last = new Date(thread.lastSeen);
        const days = Math.max(1, (last - first) / 86400000);
        thread.velocity = Math.round((thread.messages.length / days) * 10) / 10;
    }

    /**
     * Calculate thread temperature (engagement heat)
     */
    updateTemperature(thread) {
        let temp = 50; // baseline

        // More participants = hotter
        temp += Math.min(thread.participants.size * 5, 20);

        // More messages = hotter
        temp += Math.min(thread.messages.length * 3, 15);

        // High velocity = hotter
        temp += Math.min(thread.velocity * 5, 15);

        // Recent red zones = much hotter
        const recentZones = thread.zones.slice(-3);
        for (const zone of recentZones) {
            if (zone === 'red') temp += 10;
            if (zone === 'yellow') temp += 3;
        }

        // Decay for old threads
        const hoursSinceLastMessage = (Date.now() - new Date(thread.lastSeen)) / 3600000;
        temp -= Math.min(hoursSinceLastMessage * 0.5, 30);

        thread.temperature = Math.max(0, Math.min(100, Math.round(temp)));
    }

    /**
     * Determine thread trajectory
     */
    updateTrajectory(thread) {
        if (thread.messages.length < 3) {
            thread.trajectory = 'stable';
            return;
        }

        // Compare recent vs older zone scores
        const recent = thread.messages.slice(-3).map(m => m.score);
        const older = thread.messages.slice(-6, -3).map(m => m.score);

        if (older.length === 0) {
            thread.trajectory = 'stable';
            return;
        }

        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
        const delta = recentAvg - olderAvg;

        if (delta > 10) thread.trajectory = 'rising';
        else if (delta < -10) thread.trajectory = 'falling';
        else thread.trajectory = 'stable';
    }

    /**
     * Check for insight triggers and generate insights
     */
    checkInsightTriggers(thread) {
        // Hot thread alert
        if (thread.temperature > 80 && thread.trajectory === 'rising') {
            this.generateInsight({
                type: 'hot-thread',
                threadId: thread.threadId,
                subject: thread.subject,
                message: `🔥 Thread "${thread.subject}" is heating up (${thread.temperature}°, ${thread.velocity} msgs/day, ${thread.participants.size} participants)`,
                priority: 'high'
            });
        }

        // Multi-participant convergence
        if (thread.participants.size >= 4) {
            this.generateInsight({
                type: 'convergence',
                threadId: thread.threadId,
                subject: thread.subject,
                message: `👥 ${thread.participants.size} people are now in thread "${thread.subject}" — consider scheduling a call`,
                priority: 'medium'
            });
        }

        // Stalling thread (was hot, now cooling)
        if (thread.temperature < 30 && thread.messages.length >= 5 && thread.trajectory === 'falling') {
            this.generateInsight({
                type: 'stalling',
                threadId: thread.threadId,
                subject: thread.subject,
                message: `⏸️ Thread "${thread.subject}" has stalled (${thread.messages.length} msgs, now cooling) — needs a nudge?`,
                priority: 'low'
            });
        }
    }

    /**
     * Generate and store an insight
     */
    generateInsight(insight) {
        const full = {
            ...insight,
            id: `i${this.insights.length + 1}`,
            timestamp: new Date().toISOString()
        };

        // Deduplicate: don't repeat the same insight for the same thread within 24h
        const recent = this.insights.find(i =>
            i.type === insight.type &&
            i.threadId === insight.threadId &&
            (Date.now() - new Date(i.timestamp)) < 86400000
        );
        if (recent) return;

        this.insights.push(full);
        this.saveInsights();

        bus.publish('insight', 'insight.generated', {
            insightId: full.id,
            type: full.type,
            priority: full.priority
        });
    }

    /**
     * Get thread intelligence summary
     */
    getHotThreads(limit = 5) {
        return [...this.threads.values()]
            .sort((a, b) => b.temperature - a.temperature)
            .slice(0, limit)
            .map(t => ({
                threadId: t.threadId,
                subject: t.subject,
                temperature: t.temperature,
                velocity: t.velocity,
                trajectory: t.trajectory,
                participants: t.participants.size,
                messages: t.messages.length
            }));
    }

    /**
     * Get recent insights
     */
    getRecentInsights(limit = 10) {
        return this.insights.slice(-limit);
    }

    // --- Persistence ---

    loadInsights() {
        const file = join(DATA_DIR, 'insights.json');
        if (existsSync(file)) {
            try {
                return JSON.parse(readFileSync(file, 'utf8'));
            } catch {
                return [];
            }
        }
        return [];
    }

    saveInsights() {
        if (!existsSync(DATA_DIR)) {
            mkdirSync(DATA_DIR, { recursive: true });
        }
        writeFileSync(join(DATA_DIR, 'insights.json'), JSON.stringify(this.insights, null, 2));
    }
}

export { InsightAgent };
export default InsightAgent;
