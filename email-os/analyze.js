/**
 * Deep Email Analysis via MECHA AI Tunnel
 * 
 * Sends emails to the MECHA AI agent (via Cloudflare tunnel)
 * for intelligent analysis and actionable recommendations.
 */

import { readFileSync } from 'node:fs';

const CACHE_FILE = '/tmp/email-os-step-cache.json';
const TUNNEL = 'https://associations-sending-vice-brandon.trycloudflare.com';
const SESSION_ID = `email-analysis-${Date.now()}`;

const cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
if (!cache?.emails || !cache?.classified) {
    console.error('Run step-by-step.js steps 1-2 first');
    process.exit(1);
}

const { emails, classified } = cache;

// Helper: talk to MECHA AI
async function askMecha(message) {
    try {
        const res = await fetch(`${TUNNEL}/api/v1/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agentId: 'mecha',
                sessionId: SESSION_ID,
                message
            })
        });
        const data = await res.json();
        return data.reply || data.error || 'No response';
    } catch (err) {
        return `⚠️ Tunnel error: ${err.message}`;
    }
}

// Build email summary for the agent
function summarizeEmails() {
    const lines = [];
    lines.push(`收件匣共 ${emails.length} 封未讀郵件。分區結果：`);
    lines.push(`🔴 RED (${classified.red.length}封) 🟡 YELLOW (${classified.yellow.length}封) 🟢 GREEN (${classified.green.length}封)\n`);

    lines.push('--- 🔴 RED ZONE (需立即處理) ---');
    for (const { email, classification } of classified.red) {
        const from = email.from?.name || email.from?.email || '?';
        lines.push(`[RED] From: ${from} | Subject: ${email.subject} | Confidence: ${(classification.confidence * 100).toFixed(0)}% | Signals: ${classification.reasoning}`);
    }

    lines.push('\n--- 🟡 YELLOW ZONE (今天處理) ---');
    for (const { email, classification } of classified.yellow) {
        const from = email.from?.name || email.from?.email || '?';
        lines.push(`[YLW] From: ${from} | Subject: ${email.subject} | Confidence: ${(classification.confidence * 100).toFixed(0)}%`);
    }

    lines.push('\n--- 🟢 GREEN ZONE (批次處理) ---');
    for (const { email, classification } of classified.green) {
        const from = email.from?.name || email.from?.email || '?';
        lines.push(`[GRN] From: ${from} | Subject: ${email.subject}`);
    }

    return lines.join('\n');
}

// ═══ Run Analysis ═══════════════════════════════

console.log('');
console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║     📊 京茂機電科技 — MECHA AI 收件匣深度分析                    ║');
console.log('║     Powered by MECHA AI Tunnel                               ║');
console.log('╚═══════════════════════════════════════════════════════════════╝');
console.log('');
console.log(`🔗 Tunnel: ${TUNNEL}`);
console.log(`📧 Analyzing ${emails.length} emails...\n`);

// Step 1: Send email data and ask for analysis
console.log('─── Step 1: Sending inbox to MECHA AI ───\n');
const emailSummary = summarizeEmails();

const prompt1 = `我是京茂機電科技的管理者。以下是我的收件匣 ${emails.length} 封未讀郵件的分類結果。

${emailSummary}

請分析這些郵件，給我：
1. 最重要的 5 件需要立即處理的事項（依優先順序）
2. 哪些郵件分類可能有誤？（例如：應該是 GREEN 但被放到 RED）
3. 從這些郵件中看到什麼商業趨勢或機會？
4. 具體的執行建議（用中文回答）`;

console.log('⏳ Waiting for MECHA AI response...\n');
const analysis1 = await askMecha(prompt1);
console.log('═══ MECHA AI 分析結果 ═══\n');
console.log(analysis1);

// Step 2: Ask for deeper insights
console.log('\n─── Step 2: 深度洞察 ───\n');
const prompt2 = `根據剛才的分析，進一步告訴我：

1. 銀行相關郵件（合庫 TCB）有 ${classified.red.filter(r => (r.email.from?.email || '').includes('tcb')).length} 封 RED — 這些「待放行」是否代表京茂有大量應付帳款需要處理？這對現金流有什麼暗示？

2. 有 3 封請假簽核未處理 — 這是否暗示人力管理上的潛在問題？

3. NAS 套件過時通知出現 2 次 — 這代表什麼資安風險？

4. 多封「免費講座/研討會」屬於 GREEN — 但其中哪些其實對京茂的業務發展有價值？（例如：數位轉型、AI、工廠自動化相關的）

請用商業顧問的角度回答。`;

console.log('⏳ Waiting for deeper analysis...\n');
const analysis2 = await askMecha(prompt2);
console.log('═══ MECHA AI 深度洞察 ═══\n');
console.log(analysis2);

// Step 3: Action plan
console.log('\n─── Step 3: 行動方案 ───\n');
const prompt3 = `最後，請幫我生成一個「今天的行動清單」：

把 ${classified.red.length} 封 RED 和 ${classified.yellow.length} 封 YELLOW 的郵件整理成一個 30 分鐘可以完成的行動清單。

格式：
⏱️ 第 1-5 分鐘：___
⏱️ 第 5-10 分鐘：___
⏱️ 第 10-20 分鐘：___
⏱️ 第 20-30 分鐘：___

重點是：哪些可以批次處理？哪些需要深思？哪些可以直接刪除/歸檔？`;

console.log('⏳ Generating action plan...\n');
const analysis3 = await askMecha(prompt3);
console.log('═══ MECHA AI 30分鐘行動方案 ═══\n');
console.log(analysis3);

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('✅ Analysis complete via MECHA AI tunnel');
console.log('═══════════════════════════════════════════════════════════════\n');
