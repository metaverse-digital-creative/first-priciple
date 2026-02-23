/**
 * Classify Agent — Zone-Aware Triage
 * 
 * Novel Pattern: zone-aware-triage
 * Classify incoming email into engagement zones (Red/Yellow/Green)
 * based on sender relationship depth, content urgency, and thread temperature.
 * 
 * Wisdom Question: "Would the user regret missing this email?"
 */

import bus from '../bus.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

// Urgency signal keywords
const URGENCY_SIGNALS = {
    high: ['urgent', 'asap', 'immediately', 'deadline', 'critical', 'emergency', 'time-sensitive', 'action required'],
    medium: ['follow up', 'reminder', 'update', 'question', 'meeting', 'schedule', 'review', 'feedback'],
    low: ['newsletter', 'digest', 'notification', 'unsubscribe', 'no-reply', 'automated', 'noreply']
};

// VIP domain patterns (customize via config later)
const VIP_PATTERNS = ['apple.com', 'google.com', 'microsoft.com', 'gov'];

class ClassifyAgent {
    constructor(options = {}) {
        this.confidenceThreshold = options.confidenceThreshold || config.agents.classify.confidenceThreshold;
        this.vipSenders = new Set(options.vipSenders || []);
        this.senderHistory = new Map(); // Track sender interaction frequency
        this.classifications = []; // Log for mirror review
    }

    /**
     * Classify a single email into a zone
     * @param {object} email - Normalized email object
     * @returns {object} { zone, confidence, signals, reasoning }
     */
    classify(email) {
        const signals = this.detectSignals(email);
        const score = this.calculateScore(signals, email);
        const zone = this.scoreToZone(score);
        const confidence = this.calculateConfidence(signals);

        const result = {
            emailId: email.id,
            threadId: email.threadId,
            zone,
            score,
            confidence,
            signals,
            reasoning: this.generateReasoning(signals, zone),
            timestamp: new Date().toISOString()
        };

        // Track for mirror review
        this.classifications.push(result);

        bus.publish('classify', 'email.classified', {
            emailId: email.id,
            zone,
            confidence,
            signals: signals.length
        });

        return result;
    }

    /**
     * Batch classify multiple emails
     * @param {Array} emails - Array of normalized email objects
     * @returns {object} { red: [], yellow: [], green: [] }
     */
    batchClassify(emails) {
        const results = { red: [], yellow: [], green: [] };

        for (const email of emails) {
            const classification = this.classify(email);
            results[classification.zone].push({
                email,
                classification
            });
        }

        bus.publish('classify', 'batch.classified', {
            total: emails.length,
            red: results.red.length,
            yellow: results.yellow.length,
            green: results.green.length
        });

        return results;
    }

    /**
     * Detect signals in an email
     */
    detectSignals(email) {
        const signals = [];
        const text = `${email.subject} ${email.snippet}`.toLowerCase();

        // Urgency signals
        for (const keyword of URGENCY_SIGNALS.high) {
            if (text.includes(keyword)) {
                signals.push({ type: 'urgency', level: 'high', keyword });
            }
        }
        for (const keyword of URGENCY_SIGNALS.medium) {
            if (text.includes(keyword)) {
                signals.push({ type: 'urgency', level: 'medium', keyword });
            }
        }
        for (const keyword of URGENCY_SIGNALS.low) {
            if (text.includes(keyword)) {
                signals.push({ type: 'urgency', level: 'low', keyword });
            }
        }

        // VIP sender
        const senderEmail = email.from?.email || '';
        const senderDomain = senderEmail.split('@')[1] || '';
        if (this.vipSenders.has(senderEmail) || VIP_PATTERNS.some(p => senderDomain.includes(p))) {
            signals.push({ type: 'vip-sender', email: senderEmail });
        }

        // Gmail importance markers
        if (email.isImportant) {
            signals.push({ type: 'gmail-important' });
        }
        if (email.isStarred) {
            signals.push({ type: 'gmail-starred' });
        }

        // Thread depth (reply indicates conversation = higher priority)
        if (email.inReplyTo) {
            signals.push({ type: 'thread-reply' });
        }

        // Sender frequency (relationship depth)
        const senderCount = this.senderHistory.get(senderEmail) || 0;
        this.senderHistory.set(senderEmail, senderCount + 1);
        if (senderCount > 5) {
            signals.push({ type: 'frequent-sender', count: senderCount });
        }

        return signals;
    }

    /**
     * Calculate a numeric score from signals
     */
    calculateScore(signals, email) {
        let score = 50; // Baseline

        for (const signal of signals) {
            switch (signal.type) {
                case 'urgency':
                    score += signal.level === 'high' ? 30 : signal.level === 'medium' ? 15 : -10;
                    break;
                case 'vip-sender':
                    score += 25;
                    break;
                case 'gmail-important':
                    score += 10;
                    break;
                case 'gmail-starred':
                    score += 15;
                    break;
                case 'thread-reply':
                    score += 10;
                    break;
                case 'frequent-sender':
                    score += Math.min(signal.count, 10);
                    break;
            }
        }

        return Math.max(0, Math.min(100, score));
    }

    /**
     * Map score to zone
     */
    scoreToZone(score) {
        if (score >= 75) return 'red';
        if (score >= 45) return 'yellow';
        return 'green';
    }

    /**
     * Calculate classification confidence
     */
    calculateConfidence(signals) {
        if (signals.length === 0) return 0.3; // Low confidence with no signals
        if (signals.length >= 3) return 0.9;
        return 0.5 + (signals.length * 0.15);
    }

    /**
     * Generate human-readable reasoning
     */
    generateReasoning(signals, zone) {
        if (signals.length === 0) return `Zone ${zone}: no strong signals detected`;
        const top = signals.slice(0, 3).map(s => s.type).join(', ');
        return `Zone ${zone}: detected ${signals.length} signal(s) — ${top}`;
    }

    /**
     * Add a VIP sender
     */
    addVip(email) {
        this.vipSenders.add(email);
    }

    /**
     * Get classification log (for mirror review)
     */
    getLog() {
        return this.classifications;
    }
}

export { ClassifyAgent };
export default ClassifyAgent;
