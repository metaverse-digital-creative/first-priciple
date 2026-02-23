/**
 * Seed Agent — Signal-to-Seed Pipeline
 * 
 * Novel Pattern: signal-to-seed-pipeline
 * Converts high-signal emails into typed seeds with shelf-life and escalation.
 * 
 * Pattern: seed-and-harvest-loop (research-lab → email-os)
 * Every email is a potential seed. Important threads are harvested into insights.
 * 
 * Wisdom Question: "If I ignore this for a week, will something be lost?"
 */

import bus from '../bus.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
const DATA_DIR = join(ROOT, 'data');

class SeedAgent {
    constructor() {
        this.seeds = this.loadSeeds();
        this.seedCounter = this.seeds.length;
    }

    /**
     * Analyze a classified email and decide whether to plant a seed
     * @param {object} email - Normalized email
     * @param {object} classification - From ClassifyAgent
     * @returns {object|null} Planted seed or null
     */
    evaluate(email, classification) {
        // Green zone emails rarely become seeds
        if (classification.zone === 'green' && classification.confidence > 0.7) {
            return null;
        }

        const seedType = this.detectSeedType(email, classification);
        if (!seedType) return null;

        const seed = this.plant(email, seedType, classification);
        return seed;
    }

    /**
     * Detect the most appropriate seed type
     */
    detectSeedType(email, classification) {
        const text = `${email.subject} ${email.snippet}`.toLowerCase();
        const signals = classification.signals || [];

        // Decision-needed: urgent + question signals
        if (signals.some(s => s.type === 'urgency' && s.level === 'high')) {
            return 'decision-needed';
        }

        // Opportunity: VIP sender or contains opportunity keywords
        if (signals.some(s => s.type === 'vip-sender') ||
            ['opportunity', 'proposal', 'partnership', 'collaboration', 'interested', 'offer'].some(k => text.includes(k))) {
            return 'opportunity';
        }

        // Follow-up: thread reply or medium urgency
        if (email.inReplyTo || signals.some(s => s.type === 'urgency' && s.level === 'medium')) {
            return 'follow-up';
        }

        // Relationship-build: frequent sender in yellow zone
        if (signals.some(s => s.type === 'frequent-sender') && classification.zone !== 'green') {
            return 'relationship-build';
        }

        // Red zone always gets a seed (at minimum follow-up)
        if (classification.zone === 'red') {
            return 'follow-up';
        }

        return null;
    }

    /**
     * Plant a seed from an email
     * @param {object} email - Source email
     * @param {string} type - Seed type
     * @param {object} classification - Zone classification
     * @returns {object} The planted seed
     */
    plant(email, type, classification) {
        this.seedCounter++;
        const shelfLife = config.seeds.shelfLife[type] || '7d';
        const expiresAt = this.calculateExpiry(shelfLife);

        const seed = {
            id: `s${this.seedCounter}`,
            type,
            status: 'planted',
            source: {
                emailId: email.id,
                threadId: email.threadId,
                from: email.from,
                subject: email.subject,
                date: email.date
            },
            zone: classification.zone,
            score: classification.score,
            shelfLife,
            plantedAt: new Date().toISOString(),
            expiresAt,
            escalated: false,
            harvestedAt: null,
            actions: [],
            notes: ''
        };

        this.seeds.push(seed);
        this.saveSeeds();

        bus.publish('seed', 'seed.planted', {
            seedId: seed.id,
            type,
            zone: classification.zone,
            expiresAt
        });

        return seed;
    }

    /**
     * Check for seeds approaching expiration and escalate
     * @returns {Array} Escalated seeds
     */
    checkEscalation() {
        const now = new Date();
        const escalated = [];

        for (const seed of this.seeds) {
            if (seed.status !== 'planted' || seed.escalated) continue;

            const expiry = new Date(seed.expiresAt);
            const remaining = expiry - now;
            const halfLife = (expiry - new Date(seed.plantedAt)) / 2;

            // Escalate when past half-life
            if (remaining < halfLife) {
                seed.escalated = true;
                seed.zone = 'red'; // Escalate to red zone
                escalated.push(seed);

                bus.publish('seed', 'seed.escalated', {
                    seedId: seed.id,
                    type: seed.type,
                    remaining: Math.round(remaining / 60000) + 'min'
                });
            }
        }

        if (escalated.length > 0) {
            this.saveSeeds();
        }

        return escalated;
    }

    /**
     * Harvest a seed — mark it as completed with outcome
     * @param {string} seedId
     * @param {object} outcome - { action, result, notes }
     */
    harvest(seedId, outcome = {}) {
        const seed = this.seeds.find(s => s.id === seedId);
        if (!seed) return null;

        seed.status = 'harvested';
        seed.harvestedAt = new Date().toISOString();
        seed.outcome = outcome;
        this.saveSeeds();

        bus.publish('seed', 'seed.harvested', {
            seedId,
            type: seed.type,
            duration: new Date(seed.harvestedAt) - new Date(seed.plantedAt)
        });

        return seed;
    }

    /**
     * Get active (unharvested) seeds, sorted by urgency
     */
    getActive() {
        return this.seeds
            .filter(s => s.status === 'planted')
            .sort((a, b) => {
                // Red zone first, then by expiry
                if (a.zone !== b.zone) return a.zone === 'red' ? -1 : 1;
                return new Date(a.expiresAt) - new Date(b.expiresAt);
            });
    }

    /**
     * Get seed stats
     */
    getStats() {
        const active = this.seeds.filter(s => s.status === 'planted');
        const harvested = this.seeds.filter(s => s.status === 'harvested');
        const byType = {};
        for (const s of this.seeds) {
            byType[s.type] = (byType[s.type] || 0) + 1;
        }

        return {
            total: this.seeds.length,
            active: active.length,
            harvested: harvested.length,
            escalated: active.filter(s => s.escalated).length,
            byType
        };
    }

    // --- Helpers ---

    calculateExpiry(shelfLife) {
        const now = new Date();
        const match = shelfLife.match(/^(\d+)(h|d)$/);
        if (!match) return new Date(now.getTime() + 7 * 86400000).toISOString();

        const value = parseInt(match[1]);
        const unit = match[2];
        const ms = unit === 'h' ? value * 3600000 : value * 86400000;
        return new Date(now.getTime() + ms).toISOString();
    }

    loadSeeds() {
        const seedFile = join(DATA_DIR, 'seeds.json');
        if (existsSync(seedFile)) {
            try {
                return JSON.parse(readFileSync(seedFile, 'utf8'));
            } catch {
                return [];
            }
        }
        return [];
    }

    saveSeeds() {
        if (!existsSync(DATA_DIR)) {
            mkdirSync(DATA_DIR, { recursive: true });
        }
        writeFileSync(join(DATA_DIR, 'seeds.json'), JSON.stringify(this.seeds, null, 2));
    }
}

export { SeedAgent };
export default SeedAgent;
