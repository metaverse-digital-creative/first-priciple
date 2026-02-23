/**
 * Full Analysis with Tuned Classifier — ckchiu@bytetcm.com
 * Uses cached 600 emails + new negative signals + MECHA AI tunnel
 */
import { readFileSync, writeFileSync } from 'node:fs';
import ClassifyAgent from './src/agents/classify.js';

const config = JSON.parse(readFileSync('config.json', 'utf8'));
const TUNNEL = 'https://associations-sending-vice-brandon.trycloudflare.com';
const SESSION_ID = `full-analysis-${Date.now()}`;
const cache = JSON.parse(readFileSync('/tmp/email-os-600-cache.json', 'utf8'));
const emails = cache.emails;

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

console.log('');
console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║  📊 ckchiu@bytetcm.com — Full Tuned Analysis                 ║');
console.log('║  京茂機電科技 × Negative Signal Classifier × MECHA AI          ║');
console.log('╚═══════════════════════════════════════════════════════════════╝');
console.log(`\n📧 ${emails.length} emails from cache\n`);

// Classify with tuned engine
console.log('═══ Classifying with tuned negative signals ═══\n');
const classify = new ClassifyAgent(config.agents.classify);
const results = await classify.batchClassify(emails);
const neg = classify.getNegativeStats();

const R = results.red.length, Y = results.yellow.length, G = results.green.length;
console.log(`   🔴 RED:    ${R} (${Math.round(R / emails.length * 100)}%)`);
console.log(`   🟡 YELLOW: ${Y} (${Math.round(Y / emails.length * 100)}%)`);
console.log(`   🟢 GREEN:  ${G} (${Math.round(G / emails.length * 100)}%)\n`);
console.log(`   Negative signals: newsletter=${neg.newsletter}, seasonal=${neg.seasonal}, auto=${neg.auto_notif}, marketing=${neg.marketing}, dup=${neg.duplicate}, vip=${neg.vip_override}\n`);

// Domain analysis
const domainMap = new Map();
for (const email of emails) {
    const d = (email.from?.email || '').split('@').pop() || '?';
    domainMap.set(d, (domainMap.get(d) || 0) + 1);
}
const topDomains = [...domainMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);

// Time analysis
const monthMap = {}, yearMap = {};
for (const email of emails) {
    if (!email.date) continue;
    const d = new Date(email.date);
    if (isNaN(d.getTime())) continue;
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const y = `${d.getFullYear()}`;
    monthMap[m] = (monthMap[m] || 0) + 1;
    yearMap[y] = (yearMap[y] || 0) + 1;
}

// RED zone
console.log('═══ RED Zone ═══\n');
for (const { email } of results.red) {
    const from = (email.from?.name || email.from?.email || '?').slice(0, 25).padEnd(25);
    const subj = (email.subject || '').slice(0, 55);
    const date = email.date ? new Date(email.date).toISOString().slice(0, 10) : '?';
    console.log(`  🔴 ${date} │ ${from} │ ${subj}`);
}

// Build tunnel prompt
const senderStr = topDomains.slice(0, 15).map(([d, c]) => `${d}: ${c}封 (${Math.round(c / emails.length * 100)}%)`).join('\n');
const redStr = results.red.map(r => `${r.email.from?.name || r.email.from?.email} | ${r.email.subject}`).join('\n');
const timeRange = Object.keys(monthMap).sort();
const monthStr = Object.entries(monthMap).sort().map(([m, c]) => `${m}: ${c}`).join(', ');

console.log('\n═══ MECHA AI Intelligence ═══\n');

const prompt = `京茂機電科技 (ckchiu@bytetcm.com) 信箱深度分析（使用優化後的負向信號分類器）：

📊 總量: ${emails.length} 封
📅 時間範圍: ${timeRange[0]} ~ ${timeRange[timeRange.length - 1]}
📅 月份分布: ${monthStr}

分區結果（負向信號優化後）:
🔴 RED: ${R} 封 (${Math.round(R / emails.length * 100)}%) — 只有真正需要行動的
🟡 YELLOW: ${Y} 封 (${Math.round(Y / emails.length * 100)}%)
🟢 GREEN: ${G} 封 (${Math.round(G / emails.length * 100)}%) — 噪音已過濾

負向信號觸發統計:
Newsletter: ${neg.newsletter}, Seasonal greeting: ${neg.seasonal}, Auto-notification: ${neg.auto_notif}, Marketing: ${neg.marketing}, Duplicate: ${neg.duplicate}, VIP precision: ${neg.vip_override}

分類前 vs 分類後:
BEFORE: RED 296 (49%) / YELLOW 261 (44%) / GREEN 43 (7%)
AFTER:  RED ${R} (${Math.round(R / emails.length * 100)}%) / YELLOW ${Y} (${Math.round(Y / emails.length * 100)}%) / GREEN ${G} (${Math.round(G / emails.length * 100)}%)
→ RED 減少 ${Math.round((1 - R / 296) * 100)}%

Top 15 寄件人域名:
${senderStr}

🔴 RED zone (${R} 封，全是真正需要行動的):
${redStr}

請以商業顧問角色分析：
1. Email 健康度評分 (1-100) — 基於分類器優化後的結果
2. 這 ${R} 封 RED 按緊急度排序，前 5 名是什麼？
3. 分類器遺漏了什麼嗎？有沒有該升級到 RED 但被放在 YELLOW/GREEN 的？
4. 京茂的業務關係網絡分析（從寄件人看）
5. 具體建議：下一步應該自動化什麼？（Gmail 過濾規則？週報？合規看板？）

繁體中文，商業顧問口吻。`;

console.log('⏳ Sending to MECHA AI...\n');
const analysis = await askMecha(prompt);
console.log(analysis);

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`✅ Full analysis complete: ${emails.length} emails, ${R} RED items`);
console.log('═══════════════════════════════════════════════════════════════\n');
