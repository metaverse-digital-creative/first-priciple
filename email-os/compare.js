/**
 * Before/After comparison — negative signals impact
 * Runs the new classifier against 600 cached emails
 */
import { readFileSync } from 'node:fs';
import ClassifyAgent from './src/agents/classify.js';

const config = JSON.parse(readFileSync('config.json', 'utf8'));
const cache = JSON.parse(readFileSync('/tmp/email-os-600-cache.json', 'utf8'));

if (!cache?.emails) { console.error('Run analyze-600.js first'); process.exit(1); }

console.log('');
console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║  📊 Negative Signal Classifier — Before/After Comparison      ║');
console.log('╚═══════════════════════════════════════════════════════════════╝');
console.log('');

// Show old results
const old = cache.stats;
console.log('═══ BEFORE (old classifier) ═══');
console.log(`   🔴 RED:    ${old.red} (${Math.round(old.red / old.total * 100)}%)`);
console.log(`   🟡 YELLOW: ${old.yellow} (${Math.round(old.yellow / old.total * 100)}%)`);
console.log(`   🟢 GREEN:  ${old.green} (${Math.round(old.green / old.total * 100)}%)`);
console.log('');

// Run new classifier
const classify = new ClassifyAgent(config.agents.classify);
const newResults = await classify.batchClassify(cache.emails);
const negStats = classify.getNegativeStats();

const newRed = newResults.red.length;
const newYellow = newResults.yellow.length;
const newGreen = newResults.green.length;
const total = cache.emails.length;

console.log('═══ AFTER (negative signals + VIP precision) ═══');
console.log(`   🔴 RED:    ${newRed} (${Math.round(newRed / total * 100)}%)`);
console.log(`   🟡 YELLOW: ${newYellow} (${Math.round(newYellow / total * 100)}%)`);
console.log(`   🟢 GREEN:  ${newGreen} (${Math.round(newGreen / total * 100)}%)`);
console.log('');

// Delta
console.log('═══ DELTA ═══');
const redDelta = newRed - old.red;
const yellowDelta = newYellow - old.yellow;
const greenDelta = newGreen - old.green;
console.log(`   🔴 RED:    ${old.red} → ${newRed}  (${redDelta >= 0 ? '+' : ''}${redDelta})`);
console.log(`   🟡 YELLOW: ${old.yellow} → ${newYellow}  (${yellowDelta >= 0 ? '+' : ''}${yellowDelta})`);
console.log(`   🟢 GREEN:  ${old.green} → ${newGreen}  (${greenDelta >= 0 ? '+' : ''}${greenDelta})`);
console.log('');

// Negative signal breakdown
console.log('═══ NEGATIVE SIGNALS FIRED ═══');
console.log(`   📰 Newsletter:        ${negStats.newsletter}`);
console.log(`   🎊 Seasonal greeting:  ${negStats.seasonal}`);
console.log(`   🤖 Auto-notification:  ${negStats.auto_notif}`);
console.log(`   📢 Marketing:          ${negStats.marketing}`);
console.log(`   ♻️  Duplicate:          ${negStats.duplicate}`);
console.log(`   🎯 VIP precision:      ${negStats.vip_override}`);
console.log('');

// Show what's in RED now (should be truly important)
console.log('═══ NEW RED ZONE (truly urgent) ═══\n');
for (const { email, classification } of newResults.red.slice(0, 30)) {
    const from = (email.from?.name || email.from?.email || '?').slice(0, 25).padEnd(25);
    const signals = classification.signals
        .filter(s => typeof s === 'object')
        .map(s => s.type)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(', ');
    console.log(`  🔴 ${from} │ ${(email.subject || '').slice(0, 45)}`);
    console.log(`     Signals: ${signals} │ Score: ${classification.score}`);
}
if (newResults.red.length > 30) console.log(`  ... and ${newResults.red.length - 30} more`);

console.log('');
console.log(`✅ RED reduced ${Math.round((1 - newRed / old.red) * 100)}% — from ${old.red} to ${newRed}`);
console.log(`✅ GREEN increased ${Math.round((newGreen / old.green - 1) * 100)}% — from ${old.green} to ${newGreen}`);
console.log('');
