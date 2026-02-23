/**
 * RFQ Hunter — ckchiu@bytetcm.com
 * 
 * Based on analyze-full.js + email-os wisdom (WISDOM.md):
 *   Pillar 1: Signal Over Noise — find the 10% that matters
 *   Pillar 4: Relationships Compound — track repeat inquirers
 *   Pillar 3: Time Is the Hidden Variable — old RFQs may have expired
 * 
 * Scans all cached emails for RFQ/quotation/inquiry patterns,
 * classifies with seed agent, then asks MECHA AI for deal intelligence.
 */
import { readFileSync } from 'node:fs';
import ClassifyAgent from './src/agents/classify.js';

const config = JSON.parse(readFileSync('config.json', 'utf8'));
const TUNNEL = 'https://associations-sending-vice-brandon.trycloudflare.com';
const SESSION_ID = `rfq-hunter-${Date.now()}`;
const cache = JSON.parse(readFileSync('/tmp/email-os-600-cache.json', 'utf8'));
const emails = cache.emails;

// ─── RFQ Detection Patterns ────────────────────────────────
const RFQ_PATTERNS = [
    // English
    'rfq', 'request for quot', 'quotation', 'inquiry', 'enquiry',
    'quote', 'pricing', 'price list', 'unit price', 'moq',
    'lead time', 'delivery', 'sample', 'spec', 'drawing',
    'purchase order', 'p.o.', 'po#', 'order',
    // Chinese
    '報價', '詢價', '見積', '請報價', '單價', '交期',
    '樣品', '圖面', '圖紙', '規格', '採購', '下單',
    '訂單', '跟催', '催貨', '追蹤'
];

// Business relationship signals
const BIZ_DOMAINS = [
    'cfprec.com.tw',     // 群豐精密 — active supplier/customer
    'misumi-tw.com.tw',  // 三住 — parts supplier
    'bytetcm.com',       // Own domain
    'jjengitech.com',    // RFQ sender
];

async function askMecha(message) {
    try {
        const res = await fetch(`${TUNNEL}/api/v1/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: 'mecha', sessionId: SESSION_ID, message })
        });
        const data = await res.json();
        return data.reply || data.error || 'No response';
    } catch (err) {
        return `⚠️ Tunnel error: ${err.message}`;
    }
}

// ═══════════════════════════════════════════════════════════
console.log('');
console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║  🎯 RFQ Hunter — ckchiu@bytetcm.com                          ║');
console.log('║  京茂機電科技 × Email-OS Wisdom × MECHA AI                     ║');
console.log('╚═══════════════════════════════════════════════════════════════╝');
console.log(`\n📧 Scanning ${emails.length} emails for RFQ/quotation signals...\n`);

// Step 1: Find all RFQ-related emails
const rfqHits = [];
const bizHits = [];

for (const email of emails) {
    const text = `${email.subject || ''} ${email.snippet || ''}`.toLowerCase();
    const domain = (email.from?.email || '').split('@').pop() || '';

    // Check RFQ patterns
    const matchedPatterns = RFQ_PATTERNS.filter(p => text.includes(p));
    if (matchedPatterns.length > 0) {
        rfqHits.push({
            email,
            patterns: matchedPatterns,
            score: matchedPatterns.length * 10,
            domain,
            isBizDomain: BIZ_DOMAINS.includes(domain)
        });
    }

    // Check business domains
    if (BIZ_DOMAINS.includes(domain)) {
        bizHits.push({ email, domain });
    }
}

// Sort by pattern match count (more patterns = more likely real RFQ)
rfqHits.sort((a, b) => b.score - a.score);

console.log(`═══ STEP 1: RFQ Signal Detection ═══\n`);
console.log(`   🎯 RFQ pattern matches: ${rfqHits.length} emails`);
console.log(`   🏭 Business domain emails: ${bizHits.length} emails\n`);

// Step 2: Classify RFQ emails
console.log(`═══ STEP 2: Classify RFQ Emails ═══\n`);
const classify = new ClassifyAgent(config.agents.classify);
const rfqEmails = rfqHits.map(h => h.email);
const classified = await classify.batchClassify(rfqEmails);

const rfqRed = classified.red || [];
const rfqYellow = classified.yellow || [];
const rfqGreen = classified.green || [];

console.log(`   🔴 RED RFQ:    ${rfqRed.length} (urgent — respond now)`);
console.log(`   🟡 YELLOW RFQ: ${rfqYellow.length} (follow up today)`);
console.log(`   🟢 GREEN RFQ:  ${rfqGreen.length} (batched/old)\n`);

// Step 3: Detailed RFQ list
console.log(`═══ STEP 3: RFQ Pipeline ═══\n`);

const allRfq = [
    ...rfqRed.map(r => ({ ...r, priority: '🔴' })),
    ...rfqYellow.map(r => ({ ...r, priority: '🟡' })),
    ...rfqGreen.map(r => ({ ...r, priority: '🟢' }))
];

for (const { email, classification, priority } of allRfq) {
    const from = (email.from?.name || email.from?.email || '?').slice(0, 30).padEnd(30);
    const subj = (email.subject || '').slice(0, 50);
    const date = email.date ? new Date(email.date).toISOString().slice(0, 10) : '?';
    const domain = (email.from?.email || '').split('@').pop();
    const hit = rfqHits.find(h => h.email.id === email.id);
    const patterns = hit ? hit.patterns.slice(0, 3).join(', ') : '';
    console.log(`  ${priority} ${date} │ ${from} │ ${subj}`);
    console.log(`     Domain: ${domain} │ Patterns: ${patterns}`);
}

// Step 4: Sender analysis for RFQ
console.log(`\n═══ STEP 4: RFQ Sender Analysis ═══\n`);
const rfqSenderMap = new Map();
for (const hit of rfqHits) {
    const key = hit.domain;
    if (!rfqSenderMap.has(key)) rfqSenderMap.set(key, { count: 0, subjects: [], name: '' });
    const entry = rfqSenderMap.get(key);
    entry.count++;
    entry.name = hit.email.from?.name || entry.name;
    if (entry.subjects.length < 3) entry.subjects.push(hit.email.subject);
}
const topRfqSenders = [...rfqSenderMap.entries()].sort((a, b) => b[1].count - a[1].count);

console.log('   RFQ Senders (Wisdom Pillar 4: Relationships Compound):');
for (const [domain, { count, name, subjects }] of topRfqSenders.slice(0, 15)) {
    const bar = '█'.repeat(Math.min(20, count * 2));
    const isBiz = BIZ_DOMAINS.includes(domain) ? ' ⭐' : '';
    console.log(`   ${bar} ${String(count).padStart(3)}x  ${domain}${isBiz}`);
    console.log(`   ${''.padEnd(20)}        ${name || ''} — ${subjects[0]?.slice(0, 40) || ''}`);
}

// Step 5: MECHA AI RFQ Intelligence
console.log(`\n═══ STEP 5: MECHA AI RFQ Intelligence ═══\n`);

const rfqSummary = allRfq.slice(0, 30).map(({ email, priority }) => {
    const from = email.from?.name || email.from?.email || '?';
    const domain = (email.from?.email || '').split('@').pop();
    const date = email.date ? new Date(email.date).toISOString().slice(0, 10) : '?';
    return `${priority} ${date} | ${from} <${domain}> | ${email.subject}`;
}).join('\n');

const senderSummary = topRfqSenders.slice(0, 10).map(([d, v]) =>
    `${d}: ${v.count}封 (${v.name}) — "${v.subjects[0]?.slice(0, 40)}"`
).join('\n');

const prompt = `京茂機電科技 (ckchiu@bytetcm.com) 的 RFQ/詢價分析結果：

📧 掃描 ${emails.length} 封郵件，找到 ${rfqHits.length} 封 RFQ/詢價相關信件

分區：
🔴 急件 RFQ: ${rfqRed.length} 封
🟡 今天回: ${rfqYellow.length} 封
🟢 已過期/批次: ${rfqGreen.length} 封

RFQ 詳細列表 (前 30 封):
${rfqSummary}

RFQ 寄件人分析:
${senderSummary}

京茂機電是做精密機械加工、鑄造、CNC 的公司，也做醫療器材零件 (ResMed 供應鏈) 和航太零件 (AS9100 認證)。

用 MECHA AI 商業顧問角色分析：
1. 這些 RFQ 的商業價值排序 — 哪些最值得立即回覆？為什麼？
2. 從 RFQ 寄件人分析，京茂的客戶組成是什麼？（內銷/外銷比例？產業分布？）
3. 有沒有「漏接的商機」— 超過 7 天沒回的 RFQ？
4. RFQ 的回覆 SOP 建議 — 京茂應該如何標準化報價流程？
5. 如果京茂要用 email-os 自動化 RFQ 流程，應該怎麼做？（自動偵測 → 分類 → 提醒 → 追蹤 → 結案）

繁體中文，具體可執行。`;

console.log('⏳ MECHA AI analyzing RFQ pipeline...\n');
const analysis = await askMecha(prompt);
console.log(analysis);

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`✅ RFQ Analysis: ${rfqHits.length} opportunities from ${emails.length} emails`);
console.log(`   🔴 Urgent: ${rfqRed.length} | 🟡 Today: ${rfqYellow.length} | 🟢 Batched: ${rfqGreen.length}`);
console.log('═══════════════════════════════════════════════════════════════\n');
