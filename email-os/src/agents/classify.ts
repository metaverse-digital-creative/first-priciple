/**
 * Classify Agent — LLM-Powered Zone-Aware Triage
 *
 * Target Inbox: ckchiu@bytetcm.com (京茂機電科技股份有限公司)
 * Architecture: Email → Keyword Pre-scan → High confidence? → Use keyword result
 *                                          Low confidence? → LLM classify
 * Benchmark: RED 296→24 (-92%) on 600-email dataset
 */

import bus from '../bus.js';
import { createProviderFromEnv, LLMError } from '../llm.js';
import type { LLMProviderInstance } from '../llm.js';
import { db, isDbAvailable } from '../db/db.js';
import { classifications } from '../db/schema.js';
import { desc } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Email, Classification, Zone, Signal, ClassifyMethod, AgentConfig } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

// ─── POSITIVE SIGNALS ──────────────────────────────────────
const URGENCY_SIGNALS: Record<string, string[]> = {
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
    low: ['notification', 'automated', '通知']
};

const ACTION_REQUIRED: string[] = [
    '簽核', '需要簽核', 'action required', 'approve', 'approval needed',
    '屆期', 'expire', 'expir',
    '安全性快訊', 'security alert',
    'rfq', 'request for quot', 'quotation', 'inquiry', 'enquiry',
    '報價', '詢價', '見積', '請報價', 'quote request'
];

// ─── NEGATIVE SIGNALS ──────────────────────────────────────
const NEWSLETTER_PATTERNS: string[] = [
    'newsletter', 'digest', 'unsubscribe', 'no-reply', 'noreply',
    'promotion', 'edm', 'subscribe',
    '電子報', '快訊', '促銷', '優惠', '免費', '講座', '研討會',
    '活動', '活動推薦', '限時', '折扣', '獨家', '立即搶購',
    '推薦活動', '熱門推薦',
    '應徵履歷', '調查表', '問卷', '教育訓練需求',
    '補助申請', 'survey'
];

const SEASONAL_GREETING_PATTERNS: string[] = [
    '新年快樂', '春節', '祝福', '恭喜發財', '新春', '開工大吉',
    '馬到成功', '馬年', '大吉', '迎春', '賀年', '佳節',
    'happy new year', 'season\'s greetings', 'merry christmas',
    '感恩', '耶誕'
];

const AUTO_NOTIFICATION_PATTERNS: string[] = [
    '交易結果通知', '結果通知', '成功通知', '自動發送', '請勿直接回信',
    '系統自動', 'do not reply', 'automated message',
    '電子發票通知', '對帳單', '月報', '成效', '績效報告',
    'monthly report', 'your monthly', 'performance',
    '驗證碼', 'verification code', 'otp',
    '費用通知', '繳款單', '帳單',
    '新訊', '重要通知', '水費', '繳費'
];

const MARKETING_PATTERNS: string[] = [
    '拓展事業', '獨特之處', '升級', '全新', '新品', '方案',
    '了解更多', 'learn more', 'discover', 'introducing',
    '快速編輯', '井然有序', '輕鬆辦到',
    '逆襲', '狂飆', '業績', '免費工具'
];

const KNOWN_NEWSLETTER_DOMAINS: string[] = [
    'accuvally.com', 'mail.adobe.com', 'edmapac.trendmicro.com',
    'service.alibaba.com', 'mymkc.com', 'edm.taitra.org.tw'
];

// ─── VIP PRECISION RULES ───────────────────────────────────
interface VipRule {
    domainContains: string;
    subjectContains?: string;
    zone: Zone | null;
}

const VIP_PRECISION_RULES: VipRule[] = [
    { domainContains: 'gov.tw', zone: null },
    { domainContains: 'gov', zone: null },
    { domainContains: 'tcb-bank.com.tw', subjectContains: '待放行', zone: 'green' },
    { domainContains: 'tcb-bank.com.tw', subjectContains: '交易結果', zone: 'green' },
    { domainContains: 'tcb-bank.com.tw', subjectContains: '對帳單', zone: 'yellow' },
    { domainContains: 'tcb-bank.com.tw', subjectContains: 'EDI', zone: 'green' },
    { domainContains: 'tcb-bank.com.tw', subjectContains: '財經', zone: 'green' },
    { domainContains: 'tcb-bank.com.tw', subjectContains: '經濟', zone: 'green' },
    { domainContains: 'tcb-bank.com.tw', subjectContains: '權益', zone: 'green' },
    { domainContains: 'google.com', subjectContains: '安全性', zone: 'red' },
    { domainContains: 'google.com', subjectContains: 'security', zone: 'red' },
    { domainContains: 'google.com', subjectContains: 'Action Advised', zone: 'yellow' },
    { domainContains: 'google.com', subjectContains: 'Action Required', zone: 'yellow' },
    { domainContains: 'google.com', subjectContains: '成效', zone: 'green' },
    { domainContains: 'google.com', subjectContains: '拓展', zone: 'green' },
    { domainContains: 'google.com', subjectContains: '獨特', zone: 'green' },
    { domainContains: 'google.com', subjectContains: 'welcome', zone: 'green' },
    { domainContains: 'femascloud.com', subjectContains: '簽核', zone: 'red' },
    { domainContains: 'femascloud.com', subjectContains: '稽催', zone: 'red' },
    { domainContains: 'firstbank.com', subjectContains: '對帳單', zone: 'yellow' },
    { domainContains: 'cht.com.tw', subjectContains: '發票', zone: 'yellow' },
    { domainContains: 'cht.com.tw', subjectContains: '費用', zone: 'yellow' },
    { domainContains: '1111.com.tw', zone: null },
    { domainContains: 'ms.104.com.tw', zone: 'green' },
    { domainContains: '104.com.tw', subjectContains: '驗證碼', zone: 'green' },
    { domainContains: 'water.gov.tw', zone: 'yellow' },
    { domainContains: 'nhi.gov.tw', subjectContains: '新訊', zone: 'yellow' },
    { domainContains: 'nhi.gov.tw', subjectContains: '調整通知', zone: 'yellow' },
    { domainContains: 'google.com', subjectContains: '提醒', zone: 'yellow' },
    { domainContains: 'google.com', subjectContains: 'Merchant', zone: 'yellow' },
];

const VIP_PATTERNS: string[] = ['gov', 'gov.tw'];

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

// ─── Augmented signal array with possible _forcedZone ───
interface ClassifySignal extends Signal {
    zone?: Zone;
    rule?: string;
    email?: string;
    domain?: string;
    count?: number;
}

type SignalArray = ClassifySignal[] & { _forcedZone?: Zone };

class ClassifyAgent {
    private confidenceThreshold: number;
    private vipSenders: Set<string>;
    private senderHistory: Map<string, number> = new Map();
    private subjectHistory: Map<string, number> = new Map();
    private classifications: Classification[] = [];
    private llm: LLMProviderInstance | null = null;
    private llmEnabled: boolean = true;
    stats: { keyword: number; llm: number; fallback: number } = { keyword: 0, llm: 0, fallback: 0 };
    negativeStats: Record<string, number> = { newsletter: 0, seasonal: 0, auto_notif: 0, marketing: 0, duplicate: 0, vip_override: 0 };

    constructor(options: AgentConfig & { vipSenders?: string[]; confidenceThreshold?: number } = {}) {
        this.confidenceThreshold = options.confidenceThreshold || config.agents.classify.confidenceThreshold;
        this.vipSenders = new Set(options.vipSenders || []);

        try {
            this.llm = createProviderFromEnv();
            console.log(`   🧠 LLM classify enabled (${this.llm.name})`);
        } catch (err) {
            console.warn(`   ⚠️  LLM not available: ${(err as Error).message}. Using keyword-only mode.`);
            this.llmEnabled = false;
        }
    }

    async classify(email: Email): Promise<Classification> {
        const signals = this.detectSignals(email);
        const keywordScore = this.calculateScore(signals, email);
        const keywordConfidence = this.calculateConfidence(signals);

        if (keywordConfidence >= 0.8) {
            this.stats.keyword++;
            return this._makeResult(email, this.scoreToZone(keywordScore), keywordScore, keywordConfidence, signals, 'keyword');
        }

        if (this.llmEnabled && this.llm) {
            try {
                const llmResult = await this.classifyWithLLM(email);
                this.stats.llm++;

                const mergedSignals: SignalArray = [
                    ...signals,
                    ...llmResult.signals.map((s: string) => ({ type: s, source: 'llm' }))
                ] as SignalArray;

                return this._makeResult(
                    email, llmResult.zone, this.zoneToScore(llmResult.zone),
                    llmResult.confidence, mergedSignals, 'llm', llmResult.reasoning
                );
            } catch (err) {
                console.warn(`   ⚠️  LLM fallback for "${email.subject?.slice(0, 30)}": ${(err as Error).message}`);
                this.stats.fallback++;
            }
        }

        this.stats.keyword++;
        return this._makeResult(email, this.scoreToZone(keywordScore), keywordScore, keywordConfidence, signals, 'keyword');
    }

    async classifyWithLLM(email: Email): Promise<{ zone: Zone; confidence: number; reasoning: string; signals: string[] }> {
        const emailContext = [
            `From: ${email.from?.name || ''} <${email.from?.email || ''}>`,
            `Subject: ${email.subject || '(no subject)'}`,
            `Preview: ${email.snippet || ''}`,
            `Labels: ${(email.labelIds || []).join(', ')}`,
            email.isImportant ? 'Gmail: IMPORTANT' : '',
            email.isStarred ? 'Gmail: STARRED' : '',
            email.inReplyTo ? 'Type: Reply in thread' : 'Type: New email'
        ].filter(Boolean).join('\n');

        const result = await this.llm!.chat([
            { role: 'system', content: CLASSIFY_PROMPT },
            { role: 'user', content: emailContext }
        ], { temperature: 0.1, maxTokens: 200, json: true });

        try {
            const parsed = JSON.parse(result.content);
            if (!['red', 'yellow', 'green'].includes(parsed.zone)) {
                throw new Error(`Invalid zone: ${parsed.zone}`);
            }
            return {
                zone: parsed.zone as Zone,
                confidence: Math.min(1, Math.max(0, parsed.confidence || 0.8)),
                reasoning: parsed.reasoning || 'LLM classification',
                signals: Array.isArray(parsed.signals) ? parsed.signals : []
            };
        } catch (parseErr) {
            throw new LLMError(`Failed to parse LLM response: ${(parseErr as Error).message}`, {
                provider: this.llm!.name, raw: result.content
            });
        }
    }

    async batchClassify(emails: Email[]): Promise<{ red: { email: Email; classification: Classification }[]; yellow: { email: Email; classification: Classification }[]; green: { email: Email; classification: Classification }[] }> {
        const results: { red: { email: Email; classification: Classification }[]; yellow: { email: Email; classification: Classification }[]; green: { email: Email; classification: Classification }[] } = { red: [], yellow: [], green: [] };

        for (const email of emails) {
            try {
                const classification = await this.classify(email);
                results[classification.zone].push({ email, classification });
            } catch {
                results.yellow.push({
                    email,
                    classification: {
                        emailId: email.id, zone: 'yellow', score: 50, confidence: 0.3,
                        signals: [], reasoning: 'Classification failed — defaulting to yellow',
                        method: 'fallback', timestamp: new Date().toISOString()
                    }
                });
            }
        }

        bus.publish('classify', 'batch.classified', {
            total: emails.length, red: results.red.length,
            yellow: results.yellow.length, green: results.green.length,
            stats: { ...this.stats }
        });

        return results;
    }

    _makeResult(email: Email, zone: Zone, score: number, confidence: number, signals: ClassifySignal[], method: ClassifyMethod, reasoning: string | null = null): Classification {
        const result: Classification = {
            emailId: email.id, threadId: email.threadId, zone, score, confidence,
            signals: signals as Signal[], reasoning: reasoning || this.generateReasoning(signals, zone),
            method, timestamp: new Date().toISOString()
        };

        this.classifications.push(result);

        if (isDbAvailable() && db) {
            db.insert(classifications).values({
                emailId: email.id, threadId: email.threadId, zone, score, confidence,
                method, signals: signals as unknown[], reasoning: result.reasoning,
            }).catch(err => console.warn(`   ⚠️  DB classify insert: ${(err as Error).message}`));
        }

        bus.publish('classify', 'email.classified', {
            emailId: email.id, zone, confidence, signals: signals.length, method
        });

        return result;
    }

    detectSignals(email: Email): SignalArray {
        const signals: SignalArray = [] as unknown as SignalArray;
        const text = `${email.subject} ${email.snippet}`.toLowerCase();
        const senderEmail = email.from?.email || '';
        const senderDomain = senderEmail.split('@')[1] || '';
        const subject = (email.subject || '').toLowerCase();

        // VIP precision rules
        let vipOverride: Zone | null = null;
        for (const rule of VIP_PRECISION_RULES) {
            if (senderDomain.includes(rule.domainContains)) {
                if (rule.subjectContains && subject.includes(rule.subjectContains.toLowerCase())) {
                    vipOverride = rule.zone;
                    signals.push({ type: 'vip-precision', zone: rule.zone!, rule: `${rule.domainContains}+${rule.subjectContains}` });
                    this.negativeStats.vip_override++;
                    break;
                } else if (!rule.subjectContains) {
                    signals.push({ type: 'vip-sender', email: senderEmail });
                    break;
                }
            }
        }

        if (vipOverride) {
            signals._forcedZone = vipOverride;
            return signals;
        }

        // Newsletter / EDM
        if (KNOWN_NEWSLETTER_DOMAINS.some(d => senderDomain.includes(d))) {
            signals.push({ type: 'newsletter', source: 'domain', domain: senderDomain });
            this.negativeStats.newsletter++;
        } else {
            for (const pattern of NEWSLETTER_PATTERNS) {
                if (text.includes(pattern.toLowerCase())) {
                    signals.push({ type: 'newsletter', source: 'keyword', keyword: pattern });
                    this.negativeStats.newsletter++;
                    break;
                }
            }
        }

        // Seasonal greetings
        for (const pattern of SEASONAL_GREETING_PATTERNS) {
            if (text.includes(pattern.toLowerCase())) {
                signals.push({ type: 'seasonal-greeting', keyword: pattern });
                this.negativeStats.seasonal++;
                break;
            }
        }

        // Auto-notifications
        for (const pattern of AUTO_NOTIFICATION_PATTERNS) {
            if (text.includes(pattern.toLowerCase())) {
                signals.push({ type: 'auto-notification', keyword: pattern });
                this.negativeStats.auto_notif++;
                break;
            }
        }

        // Marketing
        for (const pattern of MARKETING_PATTERNS) {
            if (text.includes(pattern.toLowerCase())) {
                signals.push({ type: 'marketing', keyword: pattern });
                this.negativeStats.marketing++;
                break;
            }
        }

        // Duplicate detection
        const dedupKey = `${senderDomain}::${subject.slice(0, 50)}`;
        const dupCount = this.subjectHistory.get(dedupKey) || 0;
        this.subjectHistory.set(dedupKey, dupCount + 1);
        if (dupCount > 0) {
            signals.push({ type: 'duplicate', count: dupCount + 1 });
            this.negativeStats.duplicate++;
        }

        // Action-required
        for (const pattern of ACTION_REQUIRED) {
            if (text.includes(pattern.toLowerCase())) {
                signals.push({ type: 'action-required', keyword: pattern });
                break;
            }
        }

        // Urgency
        for (const keyword of URGENCY_SIGNALS.high) {
            if (text.includes(keyword.toLowerCase())) signals.push({ type: 'urgency', level: 'high', keyword });
        }
        for (const keyword of URGENCY_SIGNALS.medium) {
            if (text.includes(keyword.toLowerCase())) signals.push({ type: 'urgency', level: 'medium', keyword });
        }
        for (const keyword of URGENCY_SIGNALS.low) {
            if (text.includes(keyword.toLowerCase())) signals.push({ type: 'urgency', level: 'low', keyword });
        }

        // Legacy VIP
        if (this.vipSenders.has(senderEmail) || VIP_PATTERNS.some(p => senderDomain.includes(p))) {
            signals.push({ type: 'vip-sender', email: senderEmail });
        }

        if (email.isImportant) signals.push({ type: 'gmail-important' });
        if (email.isStarred) signals.push({ type: 'gmail-starred' });
        if (email.inReplyTo) signals.push({ type: 'thread-reply' });

        const senderCount = this.senderHistory.get(senderEmail) || 0;
        this.senderHistory.set(senderEmail, senderCount + 1);
        if (senderCount > 5) signals.push({ type: 'frequent-sender', count: senderCount });

        return signals;
    }

    calculateScore(signals: SignalArray, _email: Email): number {
        if (signals._forcedZone) return this.zoneToScore(signals._forcedZone);

        let score = 50;
        let hasNegative = false;

        for (const signal of signals) {
            switch (signal.type) {
                case 'action-required': score += 40; break;
                case 'urgency':
                    score += signal.level === 'high' ? 25 : signal.level === 'medium' ? 10 : -5; break;
                case 'vip-sender': score += 15; break;
                case 'gmail-important': score += 5; break;
                case 'gmail-starred': score += 15; break;
                case 'thread-reply': score += 10; break;
                case 'frequent-sender': score += Math.min(signal.count || 0, 5); break;
                case 'newsletter': score -= 30; hasNegative = true; break;
                case 'seasonal-greeting': score -= 40; hasNegative = true; break;
                case 'auto-notification': score -= 25; hasNegative = true; break;
                case 'marketing': score -= 20; hasNegative = true; break;
                case 'duplicate':
                    score -= (signal.count || 0) >= 3 ? 35 : 20; hasNegative = true; break;
            }
        }

        const hasAction = signals.some(s => s.type === 'action-required');
        if (hasNegative && hasAction) score = Math.max(score, 75);

        return Math.max(0, Math.min(100, score));
    }

    scoreToZone(score: number): Zone {
        if (score >= 75) return 'red';
        if (score >= 45) return 'yellow';
        return 'green';
    }

    zoneToScore(zone: Zone): number {
        return ({ red: 85, yellow: 60, green: 30 } as Record<Zone, number>)[zone] || 50;
    }

    calculateConfidence(signals: ClassifySignal[]): number {
        if (signals.length === 0) return 0.3;
        if (signals.length >= 3) return 0.9;
        return 0.5 + (signals.length * 0.15);
    }

    generateReasoning(signals: ClassifySignal[], zone: Zone): string {
        if (signals.length === 0) return `Zone ${zone}: no strong signals detected`;
        const top = signals.slice(0, 3).map(s => s.type).join(', ');
        return `Zone ${zone}: detected ${signals.length} signal(s) — ${top}`;
    }

    addVip(email: string): void { this.vipSenders.add(email); }

    getNegativeStats(): Record<string, number> { return { ...this.negativeStats }; }

    async getLog(): Promise<Classification[]> {
        if (isDbAvailable() && db) {
            try {
                return await db.select().from(classifications).orderBy(desc(classifications.classifiedAt)).limit(100) as unknown as Classification[];
            } catch { /* fallback */ }
        }
        return this.classifications;
    }

    getStats(): { keyword: number; llm: number; fallback: number; total: number } {
        return { ...this.stats, total: this.classifications.length };
    }
}

export { ClassifyAgent };
export default ClassifyAgent;
