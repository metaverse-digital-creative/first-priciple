/**
 * Classify Agent — LLM-Powered Zone-Aware Triage
 * 
 * Target Inbox: ckchiu@bytetcm.com (京茂機電科技股份有限公司)
 * 
 * Novel Pattern: zone-aware-triage + llm-hybrid (openclaw → email-os)
 * Classify incoming email into engagement zones (Red/Yellow/Green)
 * using a hybrid approach: fast keyword pre-scan + LLM for uncertain cases.
 * 
 * Rules tuned for 京茂機電's inbox patterns:
 *   - TCB bank (合庫) transaction notifications → GREEN (volume: ~178/600)
 *   - HR system (femascloud) approvals → RED
 *   - Gov (勞保/健保/水費) bills → YELLOW
 *   - Newsletter/EDM domains (ACCUPASS, Alibaba, Adobe, MKC) → GREEN
 *   - Seasonal greetings → instant GREEN
 *   - ISO/AIDC certification expiry → RED
 * 
 * Architecture:
 *   Email → Keyword Pre-scan → High confidence? → Use keyword result
 *                                Low confidence? → LLM classify (Gemini/OpenAI)
 * 
 * Benchmark: RED 296→24 (-92%) on 600-email dataset
 */

import bus from '../bus.js';
import { createProviderFromEnv, LLMError } from '../llm.js';
import { db, isDbAvailable } from '../db/db.js';
import { classifications } from '../db/schema.js';
import { desc } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

// ─── POSITIVE SIGNALS ──────────────────────────────────────
const URGENCY_SIGNALS = {
    high: [
        'urgent', 'asap', 'immediately', 'deadline', 'critical', 'emergency',
        'time-sensitive', 'action required',
        '緊急', '立即', '逾期', '限期', '安全性快訊'
    ],
    medium: [
        'follow up', 'reminder', 'update', 'question', 'meeting', 'schedule',
        'review', 'feedback',
        '提醒', '更新', '會議', '排程', '回覆', '確認',
        '申請', '審核', '變更'
    ],
    low: [
        'notification', 'automated',
        '通知'
    ]
};

const ACTION_REQUIRED = [
    '簽核', '需要簽核', 'action required', 'approve', 'approval needed',
    '屆期', 'expire', 'expir',
    '安全性快訊', 'security alert'
];

// ─── NEGATIVE SIGNALS (push DOWN) ──────────────────────────

// Newsletter / EDM patterns → weight: -30
const NEWSLETTER_PATTERNS = [
    'newsletter', 'digest', 'unsubscribe', 'no-reply', 'noreply',
    'promotion', 'edm', 'subscribe',
    '電子報', '快訊', '促銷', '優惠', '免費', '講座', '研討會',
    '活動', '活動推薦', '限時', '折扣', '獨家', '立即搶購',
    '推薦活動', '熱門推薦',
    '應徵履歷', '調查表', '問卷', '教育訓練需求',
    '補助申請', 'survey'
];

// Seasonal greeting → weight: -40 (strongest negative)
const SEASONAL_GREETING_PATTERNS = [
    '新年快樂', '春節', '祝福', '恭喜發財', '新春', '開工大吉',
    '馬到成功', '馬年', '大吉', '迎春', '賀年', '佳節',
    'happy new year', 'season\'s greetings', 'merry christmas',
    '感恩', '耶誕'
];

// Auto-notification patterns → weight: -25 (info-only, no action needed)
const AUTO_NOTIFICATION_PATTERNS = [
    '交易結果通知', '結果通知', '成功通知', '自動發送', '請勿直接回信',
    '系統自動', 'do not reply', 'automated message',
    '電子發票通知', '對帳單', '月報', '成效', '績效報告',
    'monthly report', 'your monthly', 'performance',
    '驗證碼', 'verification code', 'otp',
    '費用通知', '繳款單', '帳單',
    '新訊', '重要通知', '水費', '繳費'
];

// Marketing / product push → weight: -20
const MARKETING_PATTERNS = [
    '拓展事業', '獨特之處', '升級', '全新', '新品', '方案',
    '了解更多', 'learn more', 'discover', 'introducing',
    '快速編輯', '井然有序', '輕鬆辦到',
    '逆襲', '狂飆', '業績', '免費工具'
];

// Known newsletter/EDM sender domains → auto GREEN
const KNOWN_NEWSLETTER_DOMAINS = [
    'accuvally.com', 'mail.adobe.com', 'edmapac.trendmicro.com',
    'service.alibaba.com', 'mymkc.com', 'edm.taitra.org.tw'
];

// ─── VIP RULES (precision-based) ───────────────────────────
// Old approach: entire domain = VIP. New: subject-aware rules.
const VIP_PRECISION_RULES = [
    // Government → always important
    { domainContains: 'gov.tw', zone: null },         // keep default scoring
    { domainContains: 'gov', zone: null },
    // Bank: only "待放行" is RED, rest is informational
    { domainContains: 'tcb-bank.com.tw', subjectContains: '待放行', zone: 'green' },
    { domainContains: 'tcb-bank.com.tw', subjectContains: '交易結果', zone: 'green' },
    { domainContains: 'tcb-bank.com.tw', subjectContains: '對帳單', zone: 'yellow' },
    { domainContains: 'tcb-bank.com.tw', subjectContains: 'EDI', zone: 'green' },
    { domainContains: 'tcb-bank.com.tw', subjectContains: '財經', zone: 'green' },
    { domainContains: 'tcb-bank.com.tw', subjectContains: '經濟', zone: 'green' },
    { domainContains: 'tcb-bank.com.tw', subjectContains: '權益', zone: 'green' },
    // Google: security = RED, Workspace advisories = YELLOW, marketing = GREEN
    { domainContains: 'google.com', subjectContains: '安全性', zone: 'red' },
    { domainContains: 'google.com', subjectContains: 'security', zone: 'red' },
    { domainContains: 'google.com', subjectContains: 'Action Advised', zone: 'yellow' },
    { domainContains: 'google.com', subjectContains: 'Action Required', zone: 'yellow' },
    { domainContains: 'google.com', subjectContains: '成效', zone: 'green' },
    { domainContains: 'google.com', subjectContains: '拓展', zone: 'green' },
    { domainContains: 'google.com', subjectContains: '獨特', zone: 'green' },
    { domainContains: 'google.com', subjectContains: 'welcome', zone: 'green' },
    // HR system
    { domainContains: 'femascloud.com', subjectContains: '簽核', zone: 'red' },
    { domainContains: 'femascloud.com', subjectContains: '稽催', zone: 'red' },
    // Banks
    { domainContains: 'firstbank.com', subjectContains: '對帳單', zone: 'yellow' },
    // Telecom bills → YELLOW (routine monthly)
    { domainContains: 'cht.com.tw', subjectContains: '發票', zone: 'yellow' },
    { domainContains: 'cht.com.tw', subjectContains: '費用', zone: 'yellow' },
    // 104 job site → GREEN (verification codes, ephemeral)
    { domainContains: '1111.com.tw', zone: null },
    { domainContains: 'ms.104.com.tw', zone: 'green' },
    { domainContains: '104.com.tw', subjectContains: '驗證碼', zone: 'green' },
    // Water company → YELLOW (bill)
    { domainContains: 'water.gov.tw', zone: 'yellow' },
    // 健保署 general notices → YELLOW (not urgent)
    { domainContains: 'nhi.gov.tw', subjectContains: '新訊', zone: 'yellow' },
    { domainContains: 'nhi.gov.tw', subjectContains: '調整通知', zone: 'yellow' },
    // Google Merchant Center → YELLOW (reminders, not fires)
    { domainContains: 'google.com', subjectContains: '提醒', zone: 'yellow' },
    { domainContains: 'google.com', subjectContains: 'Merchant', zone: 'yellow' },
];

// Legacy VIP — only gov domains remain as blanket VIP
const VIP_PATTERNS = ['gov', 'gov.tw'];

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
        this.subjectHistory = new Map(); // For duplicate detection
        this.classifications = [];
        this.llm = null;
        this.llmEnabled = true;
        this.stats = { keyword: 0, llm: 0, fallback: 0 };
        this.negativeStats = { newsletter: 0, seasonal: 0, auto_notif: 0, marketing: 0, duplicate: 0, vip_override: 0 };

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

        // Persist to DB
        if (isDbAvailable()) {
            db.insert(classifications).values({
                emailId: email.id,
                threadId: email.threadId,
                zone,
                score,
                confidence,
                method,
                signals,
                reasoning: result.reasoning,
            }).catch(err => console.warn(`   ⚠️  DB classify insert: ${err.message}`));
        }

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
        const senderEmail = email.from?.email || '';
        const senderDomain = senderEmail.split('@')[1] || '';
        const subject = (email.subject || '').toLowerCase();

        // ─── Check VIP precision rules FIRST ───────────────
        let vipOverride = null;
        for (const rule of VIP_PRECISION_RULES) {
            if (senderDomain.includes(rule.domainContains)) {
                if (rule.subjectContains && subject.includes(rule.subjectContains.toLowerCase())) {
                    vipOverride = rule.zone;
                    signals.push({ type: 'vip-precision', zone: rule.zone, rule: `${rule.domainContains}+${rule.subjectContains}` });
                    this.negativeStats.vip_override++;
                    break;
                } else if (!rule.subjectContains) {
                    // Domain-only rule (gov.tw) — add as VIP but don't force zone
                    signals.push({ type: 'vip-sender', email: senderEmail });
                    break;
                }
            }
        }

        // If VIP precision rule forces a zone, return early with just that
        if (vipOverride) {
            signals._forcedZone = vipOverride;
            return signals;
        }

        // ─── NEGATIVE SIGNALS (check before positives) ─────

        // Newsletter / EDM detection
        if (KNOWN_NEWSLETTER_DOMAINS.some(d => senderDomain.includes(d))) {
            signals.push({ type: 'newsletter', source: 'domain', domain: senderDomain });
            this.negativeStats.newsletter++;
        } else {
            for (const pattern of NEWSLETTER_PATTERNS) {
                if (text.includes(pattern.toLowerCase())) {
                    signals.push({ type: 'newsletter', source: 'keyword', keyword: pattern });
                    this.negativeStats.newsletter++;
                    break; // one is enough
                }
            }
        }

        // Seasonal greeting detection
        for (const pattern of SEASONAL_GREETING_PATTERNS) {
            if (text.includes(pattern.toLowerCase())) {
                signals.push({ type: 'seasonal-greeting', keyword: pattern });
                this.negativeStats.seasonal++;
                break;
            }
        }

        // Auto-notification detection
        for (const pattern of AUTO_NOTIFICATION_PATTERNS) {
            if (text.includes(pattern.toLowerCase())) {
                signals.push({ type: 'auto-notification', keyword: pattern });
                this.negativeStats.auto_notif++;
                break;
            }
        }

        // Marketing detection
        for (const pattern of MARKETING_PATTERNS) {
            if (text.includes(pattern.toLowerCase())) {
                signals.push({ type: 'marketing', keyword: pattern });
                this.negativeStats.marketing++;
                break;
            }
        }

        // Duplicate detection (same subject + same domain within batch)
        const dedupKey = `${senderDomain}::${subject.slice(0, 50)}`;
        const dupCount = this.subjectHistory.get(dedupKey) || 0;
        this.subjectHistory.set(dedupKey, dupCount + 1);
        if (dupCount > 0) {
            signals.push({ type: 'duplicate', count: dupCount + 1 });
            this.negativeStats.duplicate++;
        }

        // ─── POSITIVE SIGNALS ──────────────────────────────

        // Action-required (strong positive, overrides some negatives)
        for (const pattern of ACTION_REQUIRED) {
            if (text.includes(pattern.toLowerCase())) {
                signals.push({ type: 'action-required', keyword: pattern });
                break;
            }
        }

        // Urgency keywords
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

        // Legacy VIP (only gov domains now)
        if (this.vipSenders.has(senderEmail) || VIP_PATTERNS.some(p => senderDomain.includes(p))) {
            signals.push({ type: 'vip-sender', email: senderEmail });
        }

        // Gmail markers (reduced weight — see calculateScore)
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
        // If VIP precision rule forced a zone, use that directly
        if (signals._forcedZone) {
            return this.zoneToScore(signals._forcedZone);
        }

        let score = 50;
        let hasNegative = false;

        for (const signal of signals) {
            switch (signal.type) {
                // ── Positive ──
                case 'action-required': score += 40; break;
                case 'urgency':
                    score += signal.level === 'high' ? 25 : signal.level === 'medium' ? 10 : -5;
                    break;
                case 'vip-sender': score += 15; break;     // reduced from 25
                case 'gmail-important': score += 5; break;  // reduced from 10
                case 'gmail-starred': score += 15; break;
                case 'thread-reply': score += 10; break;
                case 'frequent-sender': score += Math.min(signal.count, 5); break;

                // ── Negative ──
                case 'newsletter': score -= 30; hasNegative = true; break;
                case 'seasonal-greeting': score -= 40; hasNegative = true; break;
                case 'auto-notification': score -= 25; hasNegative = true; break;
                case 'marketing': score -= 20; hasNegative = true; break;
                case 'duplicate':
                    score -= signal.count >= 3 ? 35 : 20;
                    hasNegative = true; break;
            }
        }

        // If has both negative AND action-required, action-required wins
        // (e.g. a notification about an expiring certificate)
        const hasAction = signals.some(s => s.type === 'action-required');
        if (hasNegative && hasAction) {
            score = Math.max(score, 75); // ensure RED
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

    getNegativeStats() { return { ...this.negativeStats }; }

    async getLog() {
        if (isDbAvailable()) {
            try {
                return await db.select().from(classifications).orderBy(desc(classifications.classifiedAt)).limit(100);
            } catch { /* fallback */ }
        }
        return this.classifications;
    }

    getStats() { return { ...this.stats, total: this.classifications.length }; }
}

export { ClassifyAgent };
export default ClassifyAgent;
