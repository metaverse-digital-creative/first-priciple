/**
 * 600-Email Deep Analysis via MECHA AI Tunnel
 * 
 * Fetches 600 emails from Gmail (with pagination),
 * classifies with keyword engine, then sends batched
 * summaries to MECHA AI tunnel for business intelligence.
 */

import { getAuthClient } from './src/gmail/auth.js';
import { google } from 'googleapis';
import ClassifyAgent from './src/agents/classify.js';
import { readFileSync, writeFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('config.json', 'utf8'));
const TUNNEL = 'https://associations-sending-vice-brandon.trycloudflare.com';
const SESSION_ID = `inbox-600-${Date.now()}`;
const TARGET = 600;
const CACHE_FILE = '/tmp/email-os-600-cache.json';

// ─── Gmail Pagination ──────────────────────────────────────
async function fetchWithPagination(gmail, target) {
    let allMessages = [];
    let pageToken = null;
    let page = 1;

    while (allMessages.length < target) {
        const batchSize = Math.min(100, target - allMessages.length);
        const params = {
            userId: 'me',
            q: 'is:inbox',
            maxResults: batchSize
        };
        if (pageToken) params.pageToken = pageToken;

        console.log(`   Page ${page}: fetching ${batchSize} message IDs...`);
        const res = await gmail.users.messages.list(params);
        const ids = res.data.messages || [];

        if (ids.length === 0) break;

        // Fetch metadata in batches of 20
        for (let i = 0; i < ids.length; i += 20) {
            const batch = ids.slice(i, i + 20);
            const details = await Promise.all(
                batch.map(async m => {
                    try {
                        const msg = await gmail.users.messages.get({
                            userId: 'me',
                            id: m.id,
                            format: 'metadata',
                            metadataHeaders: ['From', 'To', 'Subject', 'Date']
                        });
                        return normalizeMessage(msg.data);
                    } catch { return null; }
                })
            );
            allMessages.push(...details.filter(Boolean));
            process.stdout.write(`\r   Fetched: ${allMessages.length}/${target}`);
        }

        pageToken = res.data.nextPageToken;
        if (!pageToken) break;
        page++;
    }
    console.log('');
    return allMessages;
}

function normalizeMessage(data) {
    const headers = {};
    for (const h of (data.payload?.headers || [])) {
        headers[h.name.toLowerCase()] = h.value;
    }
    const fromStr = headers.from || '';
    const nameMatch = fromStr.match(/^"?([^"<]+)"?\s*</);
    const emailMatch = fromStr.match(/<([^>]+)>/) || fromStr.match(/([^\s]+@[^\s]+)/);

    return {
        id: data.id,
        threadId: data.threadId,
        from: {
            name: nameMatch ? nameMatch[1].trim() : (emailMatch ? emailMatch[1] : fromStr),
            email: emailMatch ? emailMatch[1] : fromStr
        },
        subject: headers.subject || '(no subject)',
        date: headers.date || '',
        snippet: data.snippet || '',
        labelIds: data.labelIds || [],
        isImportant: (data.labelIds || []).includes('IMPORTANT'),
        isStarred: (data.labelIds || []).includes('STARRED')
    };
}

// ─── Talk to MECHA AI ──────────────────────────────────────
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

// ─── Compress emails for tunnel ────────────────────────────
function compressForTunnel(emails, zone) {
    return emails.map(({ email }) => {
        const from = email.from?.name || email.from?.email || '?';
        const domain = (email.from?.email || '').split('@').pop();
        return `${from} <${domain}> | ${email.subject}`;
    }).join('\n');
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

console.log('');
console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║     📊 京茂機電科技 — 600 封郵件深度分析                        ║');
console.log('║     MECHA AI Tunnel × Email-OS Pipeline                      ║');
console.log('╚═══════════════════════════════════════════════════════════════╝');
console.log('');

// Step 1: Fetch 600 emails
console.log('═══ STEP 1: 擷取 600 封郵件 ═══\n');
const auth = await getAuthClient();
const gmail = google.gmail({ version: 'v1', auth });
const emails = await fetchWithPagination(gmail, TARGET);
console.log(`\n   ✅ Fetched ${emails.length} emails total\n`);

// Step 2: Classify all
console.log('═══ STEP 2: 分區分類 ═══\n');
const classify = new ClassifyAgent(config.agents.classify);
const classified = await classify.batchClassify(emails);
const stats = classify.getStats();

const red = classified.red || [];
const yellow = classified.yellow || [];
const green = classified.green || [];

console.log(`   🔴 RED:    ${red.length} (${Math.round(red.length / emails.length * 100)}%)`);
console.log(`   🟡 YELLOW: ${yellow.length} (${Math.round(yellow.length / emails.length * 100)}%)`);
console.log(`   🟢 GREEN:  ${green.length} (${Math.round(green.length / emails.length * 100)}%)`);
console.log(`   📊 Method: ${stats.keyword} keyword / ${stats.llm} LLM / ${stats.fallback} fallback\n`);

// Step 3: Build sender profile
console.log('═══ STEP 3: 寄件人分析 ═══\n');
const senderMap = new Map();
for (const email of emails) {
    const domain = (email.from?.email || '').split('@').pop() || '?';
    const name = email.from?.name || email.from?.email || '?';
    const key = domain;
    if (!senderMap.has(key)) senderMap.set(key, { name, domain, count: 0, subjects: [] });
    const entry = senderMap.get(key);
    entry.count++;
    if (entry.subjects.length < 3) entry.subjects.push(email.subject);
}
const topDomains = [...senderMap.values()].sort((a, b) => b.count - a.count).slice(0, 20);

console.log('   Top 20 Sender Domains:');
for (const { name, domain, count, subjects } of topDomains) {
    const bar = '█'.repeat(Math.min(20, Math.ceil(count / 3))) + '░'.repeat(Math.max(0, 20 - Math.ceil(count / 3)));
    console.log(`   ${bar} ${String(count).padStart(3)}x  ${domain}`);
    console.log(`   ${''.padEnd(20)}        ${subjects[0]?.slice(0, 50) || ''}`);
}

// Step 4: Time pattern analysis
console.log('\n═══ STEP 4: 時間模式 ═══\n');
const dayMap = {};
const monthMap = {};
for (const email of emails) {
    if (!email.date) continue;
    const d = new Date(email.date);
    if (isNaN(d.getTime())) continue;
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    dayMap[dayName] = (dayMap[dayName] || 0) + 1;
    monthMap[monthKey] = (monthMap[monthKey] || 0) + 1;
}

console.log('   By Day of Week:');
for (const [day, count] of Object.entries(dayMap).sort((a, b) => b[1] - a[1])) {
    const bar = '█'.repeat(Math.ceil(count / 5));
    console.log(`   ${day}  ${bar} ${count}`);
}

console.log('\n   By Month:');
for (const [month, count] of Object.entries(monthMap).sort()) {
    const bar = '█'.repeat(Math.ceil(count / 5));
    console.log(`   ${month}  ${bar} ${count}`);
}

// Save cache
writeFileSync(CACHE_FILE, JSON.stringify({ emails, classified, stats: { red: red.length, yellow: yellow.length, green: green.length, total: emails.length } }, null, 2));

// Step 5: Send to MECHA AI tunnel for deep analysis
console.log('\n═══ STEP 5: MECHA AI 深度分析 ═══\n');

// Build compressed summary
const senderSummary = topDomains.slice(0, 15).map(s => `${s.domain}: ${s.count}封 (e.g. "${s.subjects[0]?.slice(0, 40)}")`).join('\n');

const prompt1 = `我是京茂機電科技的管理者。我的 Gmail 收件匣有 ${emails.length} 封郵件，email-os 分類結果：

🔴 RED: ${red.length} 封 (${Math.round(red.length / emails.length * 100)}%)
🟡 YELLOW: ${yellow.length} 封 (${Math.round(yellow.length / emails.length * 100)}%)
🟢 GREEN: ${green.length} 封 (${Math.round(green.length / emails.length * 100)}%)

寄件人 Top 15 域名：
${senderSummary}

🔴 RED 區重點（前 20 封）：
${compressForTunnel({ red: red.slice(0, 20) }.red.map(r => ({ email: r.email })), 'red')}

🟡 YELLOW 區重點（前 15 封）：
${compressForTunnel({ yellow: yellow.slice(0, 15) }.yellow.map(r => ({ email: r.email })), 'yellow')}

請從 ${emails.length} 封郵件的宏觀角度分析：
1. 京茂機電的收件匣健康度評分 (1-100)
2. 信件噪音比 — 多少比例是不需要看的？
3. 最大的 3 個行政瓶頸是什麼？
4. 隱藏的商業機會（從 600 封的模式中找）
5. 建議退訂或設定自動過濾的寄件人
6. 多少封信值得 AI 深度分析（值得花 LLM token 的）

用商業顧問口吻，繁體中文回答。`;

console.log('⏳ MECHA AI analyzing patterns across', emails.length, 'emails...\n');
const analysis1 = await askMecha(prompt1);
console.log('═══ MECHA AI 宏觀分析 ═══\n');
console.log(analysis1);

// Step 6: Pattern analysis
console.log('\n═══ STEP 6: MECHA AI 行為模式分析 ═══\n');

const dayStr = Object.entries(dayMap).sort((a, b) => b[1] - a[1]).map(([d, c]) => `${d}: ${c}`).join(', ');
const monthStr = Object.entries(monthMap).sort().map(([m, c]) => `${m}: ${c}`).join(', ');

const prompt2 = `繼續分析京茂機電的 ${emails.length} 封郵件。

時間模式：
- 星期分布: ${dayStr}
- 月份分布: ${monthStr}

Sender 集中度：前 5 大寄件域名佔了 ${topDomains.slice(0, 5).reduce((s, d) => s + d.count, 0)} / ${emails.length} 封 (${Math.round(topDomains.slice(0, 5).reduce((s, d) => s + d.count, 0) / emails.length * 100)}%)

GREEN 區（${green.length} 封）的前 10 封：
${compressForTunnel({ green: green.slice(0, 10) }.green.map(r => ({ email: r.email })), 'green')}

請給我：
1. **收件匣瘦身計畫** — 具體要退訂、過濾、建立規則的項目（目標：砍掉 50% 的噪音）
2. **Email-OS 分類器優化建議** — 基於你看到的 600 封模式，keyword 規則應該怎麼調？
3. **每週自動化報告** — 如果 email-os 每週跑一次，報告應該包含哪些 KPI？
4. **ROI 預估** — 如果京茂花 30 分鐘/天處理郵件，email-os 能幫他們省多少時間？

繁體中文，具體可執行。`;

console.log('⏳ Analyzing behavioral patterns...\n');
const analysis2 = await askMecha(prompt2);
console.log('═══ MECHA AI 行為模式分析 ═══\n');
console.log(analysis2);

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`✅ ${emails.length}-email analysis complete via MECHA AI tunnel`);
console.log('═══════════════════════════════════════════════════════════════\n');
