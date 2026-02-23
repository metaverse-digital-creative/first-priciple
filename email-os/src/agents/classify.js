/**
 * Classify Agent — LLM-Powered Zone-Aware Triage
 * 
 * Novel Pattern: zone-aware-triage + llm-hybrid (openclaw → email-os)
 * Classify incoming email into engagement zones (Red/Yellow/Green)
 * using a hybrid approach: fast keyword pre-scan + LLM for uncertain cases.
 * 
 * Architecture:
 *   Email → Keyword Pre-scan → High confidence? → Use keyword result
 *                                Low confidence? → LLM classify (Gemini/OpenAI)
 * 
 * Wisdom Question: "Would the user regret missing this email?"
 */

import bus from '../bus.js';
import { createProviderFromEnv, LLMError } from '../llm.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

// Urgency signal keywords (bilingual: English + Traditional Chinese)
const URGENCY_SIGNALS = {
    high: [
        'urgent', 'asap', 'immediately', 'deadline', 'critical', 'emergency',
        'time-sensitive', 'action required',
        '緊急', '立即', '截止', '到期', '逾期', '限期', '安全性快訊',
        '簽核', '待放行', '過時', '逾時'
    ],
    medium: [
        'follow up', 'reminder', 'update', 'question', 'meeting', 'schedule',
        'review', 'feedback',
        '提醒', '更新', '會議', '排程', '回覆', '確認', '通知',
        '申請', '審核', '變更'
    ],
    low: [
        'newsletter', 'digest', 'notification', 'unsubscribe', 'no-reply',
        'automated', 'noreply', 'promotion',
        '電子報', '快訊', '促銷', '優惠', '免費', '講座', '研討會',
        '祝福', '新年快樂', '春節', '活動'
    ]
};

// VIP domain patterns
const VIP_PATTERNS = ['apple.com', 'google.com', 'microsoft.com', 'gov', 'gov.tw'];

// LLM Classification Prompt (bilingual)
const CLASSIFY_PROMPT = `You are an email triage assistant for a Taiwanese business executive (京茂機電科技).
Classify this email into exactly one zone based on how urgently it needs attention:

🔴 RED — Requires action within 2 hours:
- Decisions needed, hard deadlines, security alerts
- Government/legal (勞保、健保、稅務、法規)
- Financial transactions needing approval (轉帳待放行)
- System security warnings, password changes
- Messages from VIP contacts about urgent matters

🟡 YELLOW — Handle today:
- HR requests needing approval (請假簽核、考勤)
- Business partner communications requiring response
- Meeting invitations and schedule changes
- Follow-ups on active projects
- Account statements and invoices (對帳單、電子發票)

🟢 GREEN — Batch weekly:
- Marketing newsletters and promotions
- Event invitations (講座、研討會)
- Automated system notifications (非緊急)
- Holiday greetings (新年快樂、春節祝福)
- Product announcements and advertising
- FYI-only notifications

Respond ONLY with valid JSON, no markdown:
{"zone":"red|yellow|green","confidence":0.85,"reasoning":"one concise line","signals":["signal1","signal2"]}`;

class ClassifyAgent {
    constructor(options = {}) {
        this.confidenceThreshold = options.confidenceThreshold || config.agents.classify.confidenceThreshold;
        this.vipSenders = new Set(options.vipSenders || []);
        this.senderHistory = new Map();
        this.classifications = [];
        this.llm = null;
        this.llmEnabled = true;
        this.stats = { keyword: 0, llm: 0, fallback: 0 };

        // Initialize LLM provider (lazy)
        try {
            this.llm = createProviderFromEnv();
            console.log(`   🧠 LLM classify enabled (${this.llm.name})`);
        } catch (err) {
            console.warn(`   ⚠️  LLM not available: ${err.message}. Using keyword-only mode.`);
            this.llmEnabled = false;
        }
    }

    /**
     * Classify a single email into a zone (hybrid: keyword + LLM)
     */
    async classify(email) {
        // Step 1: Fast keyword pre-scan
        const signals = this.detectSignals(email);
        const keywordScore = this.calculateScore(signals, email);
        const keywordConfidence = this.calculateConfidence(signals);

        // Step 2: If keyword confidence is high enough, use it directly
        if (keywordConfidence >= 0.8) {
            this.stats.keyword++;
            return this._makeResult(email, this.scoreToZone(keywordScore), keywordScore, keywordConfidence, signals, 'keyword');
        }

        // Step 3: Use LLM for uncertain cases
        if (this.llmEnabled && this.llm) {
            try {
                const llmResult = await this.classifyWithLLM(email);
                this.stats.llm++;

                // Merge LLM signals with keyword signals
                const mergedSignals = [
                    ...signals,
                    ...llmResult.signals.map(s => ({ type: s, source: 'llm' }))
                ];

                return this._makeResult(
                    email,
                    llmResult.zone,
                    this.zoneToScore(llmResult.zone),
                    llmResult.confidence,
                    mergedSignals,
                    'llm',
                    llmResult.reasoning
                );
            } catch (err) {
                // LLM failed — fall back to keyword
                console.warn(`   ⚠️  LLM fallback for "${email.subject?.slice(0, 30)}": ${err.message}`);
                this.stats.fallback++;
            }
        }

        // Fallback: keyword-only result
        this.stats.keyword++;
        return this._makeResult(email, this.scoreToZone(keywordScore), keywordScore, keywordConfidence, signals, 'keyword');
    }

    /**
     * Classify using LLM (Gemini/OpenAI via OpenClaw pattern)
     */
    async classifyWithLLM(email) {
        const emailContext = [
            `From: ${email.from?.name || ''} <${email.from?.email || ''}>`,
            `Subject: ${email.subject || '(no subject)'}`,
            `Preview: ${email.snippet || ''}`,
            `Labels: ${(email.labelIds || []).join(', ')}`,
            email.isImportant ? 'Gmail: IMPORTANT' : '',
            email.isStarred ? 'Gmail: STARRED' : '',
            email.inReplyTo ? 'Type: Reply in thread' : 'Type: New email'
        ].filter(Boolean).join('\n');

        const result = await this.llm.chat([
            { role: 'system', content: CLASSIFY_PROMPT },
            { role: 'user', content: emailContext }
        ], { temperature: 0.1, maxTokens: 200, json: true });

        try {
            const parsed = JSON.parse(result.content);

            // Validate response
            if (!['red', 'yellow', 'green'].includes(parsed.zone)) {
                throw new Error(`Invalid zone: ${parsed.zone}`);
            }

            return {
                zone: parsed.zone,
                confidence: Math.min(1, Math.max(0, parsed.confidence || 0.8)),
                reasoning: parsed.reasoning || 'LLM classification',
                signals: Array.isArray(parsed.signals) ? parsed.signals : []
            };
        } catch (parseErr) {
            throw new LLMError(`Failed to parse LLM response: ${parseErr.message}`, {
                provider: this.llm.name,
                raw: result.content
            });
        }
    }

    /**
     * Batch classify multiple emails (async for LLM support)
     */
    async batchClassify(emails) {
        const results = { red: [], yellow: [], green: [] };

        // Process sequentially to respect Gemini free tier (15 RPM)
        for (const email of emails) {
            try {
                const classification = await this.classify(email);
                results[classification.zone].push({ email, classification });
            } catch (err) {
                results.yellow.push({
                    email,
                    classification: {
                        emailId: email.id,
                        zone: 'yellow',
                        score: 50,
                        confidence: 0.3,
                        signals: [],
                        reasoning: 'Classification failed — defaulting to yellow',
                        method: 'fallback',
                        timestamp: new Date().toISOString()
                    }
                });
            }
        }

        bus.publish('classify', 'batch.classified', {
            total: emails.length,
            red: results.red.length,
            yellow: results.yellow.length,
            green: results.green.length,
            stats: { ...this.stats }
        });

        return results;
    }

    /**
     * Build a classification result object
     */
    _makeResult(email, zone, score, confidence, signals, method, reasoning = null) {
        const result = {
            emailId: email.id,
            threadId: email.threadId,
            zone,
            score,
            confidence,
            signals,
            reasoning: reasoning || this.generateReasoning(signals, zone),
            method,
            timestamp: new Date().toISOString()
        };

        this.classifications.push(result);

        bus.publish('classify', 'email.classified', {
            emailId: email.id,
            zone,
            confidence,
            signals: signals.length,
            method
        });

        return result;
    }

    /**
     * Detect signals in an email (bilingual keywords)
     */
    detectSignals(email) {
        const signals = [];
        const text = `${email.subject} ${email.snippet}`.toLowerCase();

        for (const keyword of URGENCY_SIGNALS.high) {
            if (text.includes(keyword.toLowerCase())) {
                signals.push({ type: 'urgency', level: 'high', keyword });
            }
        }
        for (const keyword of URGENCY_SIGNALS.medium) {
            if (text.includes(keyword.toLowerCase())) {
                signals.push({ type: 'urgency', level: 'medium', keyword });
            }
        }
        for (const keyword of URGENCY_SIGNALS.low) {
            if (text.includes(keyword.toLowerCase())) {
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
        if (email.isImportant) signals.push({ type: 'gmail-important' });
        if (email.isStarred) signals.push({ type: 'gmail-starred' });

        // Thread depth
        if (email.inReplyTo) signals.push({ type: 'thread-reply' });

        // Sender frequency
        const senderCount = this.senderHistory.get(senderEmail) || 0;
        this.senderHistory.set(senderEmail, senderCount + 1);
        if (senderCount > 5) signals.push({ type: 'frequent-sender', count: senderCount });

        return signals;
    }

    calculateScore(signals, email) {
        let score = 50;
        for (const signal of signals) {
            switch (signal.type) {
                case 'urgency':
                    score += signal.level === 'high' ? 30 : signal.level === 'medium' ? 15 : -10;
                    break;
                case 'vip-sender': score += 25; break;
                case 'gmail-important': score += 10; break;
                case 'gmail-starred': score += 15; break;
                case 'thread-reply': score += 10; break;
                case 'frequent-sender': score += Math.min(signal.count, 10); break;
            }
        }
        return Math.max(0, Math.min(100, score));
    }

    scoreToZone(score) {
        if (score >= 75) return 'red';
        if (score >= 45) return 'yellow';
        return 'green';
    }

    zoneToScore(zone) {
        return { red: 85, yellow: 60, green: 30 }[zone] || 50;
    }

    calculateConfidence(signals) {
        if (signals.length === 0) return 0.3;
        if (signals.length >= 3) return 0.9;
        return 0.5 + (signals.length * 0.15);
    }

    generateReasoning(signals, zone) {
        if (signals.length === 0) return `Zone ${zone}: no strong signals detected`;
        const top = signals.slice(0, 3).map(s => s.type).join(', ');
        return `Zone ${zone}: detected ${signals.length} signal(s) — ${top}`;
    }

    addVip(email) { this.vipSenders.add(email); }
    getLog() { return this.classifications; }
    getStats() { return { ...this.stats, total: this.classifications.length }; }
}

export { ClassifyAgent };
export default ClassifyAgent;
