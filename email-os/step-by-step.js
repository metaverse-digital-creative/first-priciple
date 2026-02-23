/**
 * Step-by-step email pipeline runner
 * Usage: node step-by-step.js [step]
 *   step 1: Ingest — fetch emails from Gmail
 *   step 2: Classify — zone triage
 *   step 3: Seed — plant seeds
 *   step 4: Suggest — generate suggestions
 *   step 5: Mirror — self-review
 */

import { getAuthClient } from './src/gmail/auth.js';
import { IngestAgent } from './src/agents/ingest.js';
import ClassifyAgent from './src/agents/classify.js';
import SeedAgent from './src/agents/seed.js';
import SuggestAgent from './src/agents/suggest.js';
import InsightAgent from './src/agents/insight.js';
import MirrorAgent from './src/agents/mirror.js';
import { readFileSync, writeFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('config.json', 'utf8'));
const step = parseInt(process.argv[2] || '1');
const CACHE_FILE = '/tmp/email-os-step-cache.json';

// Helper
function saveCache(data) {
    writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}
function loadCache() {
    try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')); }
    catch { return null; }
}

// ═══════════════════════════════════════
// STEP 1: INGEST
// ═══════════════════════════════════════
if (step === 1) {
    console.log('═══ STEP 1: INGEST ═══\n');
    const auth = await getAuthClient();
    const ingest = new IngestAgent(auth, config.agents.ingest);
    const emails = await ingest.run({ query: 'is:inbox is:unread' });

    console.log(`Fetched ${emails.length} unread emails\n`);

    for (const email of emails) {
        const from = email.from?.name || email.from?.email || '?';
        console.log(`  📩 ${from.padEnd(30)} | ${email.subject}`);
    }

    saveCache({ emails });
    console.log(`\n✅ ${emails.length} emails cached to ${CACHE_FILE}`);
    console.log('   Next: node step-by-step.js 2');
}

// ═══════════════════════════════════════
// STEP 2: CLASSIFY
// ═══════════════════════════════════════
else if (step === 2) {
    const cache = loadCache();
    if (!cache?.emails) { console.error('Run step 1 first'); process.exit(1); }

    console.log('═══ STEP 2: CLASSIFY ═══\n');
    const classify = new ClassifyAgent(config.agents.classify);
    const classified = await classify.batchClassify(cache.emails);

    const zoneEmoji = { red: '🔴', yellow: '🟡', green: '🟢' };
    for (const [zone, items] of Object.entries(classified)) {
        console.log(`\n${zoneEmoji[zone]} ${zone.toUpperCase()} (${items.length})`);
        console.log('─'.repeat(60));
        for (const { email, classification } of items) {
            const from = email.from?.name || email.from?.email || '?';
            console.log(`  ${from.padEnd(25)} | ${email.subject}`);
            console.log(`  ${''.padEnd(25)} | Confidence: ${(classification.confidence * 100).toFixed(0)}% | Method: ${classification.method}`);
            console.log(`  ${''.padEnd(25)} | ${classification.reasoning}`);
            console.log();
        }
    }

    const stats = classify.getStats();
    console.log(`\n📊 Stats: ${stats.keyword} keyword / ${stats.llm} LLM / ${stats.fallback} fallback`);

    cache.classified = classified;
    cache.classifyLog = await classify.getLog();
    saveCache(cache);
    console.log(`\n✅ Classifications cached. Next: node step-by-step.js 3`);
}

// ═══════════════════════════════════════
// STEP 3: SEED
// ═══════════════════════════════════════
else if (step === 3) {
    const cache = loadCache();
    if (!cache?.classified) { console.error('Run step 2 first'); process.exit(1); }

    console.log('═══ STEP 3: SEED ═══\n');
    const seed = new SeedAgent();
    await seed.init();

    const allClassified = [
        ...cache.classified.red,
        ...cache.classified.yellow,
        ...cache.classified.green
    ];

    let planted = 0;
    let skipped = 0;

    for (const { email, classification } of allClassified) {
        const result = await seed.evaluate(email, classification);
        if (result) {
            planted++;
            console.log(`  🌱 [${result.type}] ${email.subject}`);
            console.log(`     Shelf-life: ${result.shelfLife} | Expires: ${new Date(result.expiresAt).toLocaleString('zh-TW')}`);
            console.log();
        } else {
            skipped++;
        }
    }

    console.log(`\n📊 Seeds: ${planted} planted / ${skipped} skipped`);

    const active = await seed.getActive();
    cache.seeds = active;
    cache.seedStats = seed.getStats();
    saveCache(cache);
    console.log(`✅ Seeds cached. Next: node step-by-step.js 4`);
}

// ═══════════════════════════════════════
// STEP 4: SUGGEST
// ═══════════════════════════════════════
else if (step === 4) {
    const cache = loadCache();
    if (!cache?.classified) { console.error('Run step 2 first'); process.exit(1); }

    console.log('═══ STEP 4: SUGGEST ═══\n');
    const suggest = new SuggestAgent(config.agents.suggest);

    const nonGreen = [
        ...cache.classified.red,
        ...cache.classified.yellow
    ];

    for (const { email, classification } of nonGreen) {
        const suggestion = suggest.suggest(email, classification, null);
        console.log(`  📬 ${email.subject}`);
        console.log(`     Zone: ${classification.zone} | Action: ${suggestion.action}`);
        if (suggestion.responseDraft) {
            console.log(`     💬 Draft: "${suggestion.responseDraft.slice(0, 80)}..."`);
        }
        console.log();
    }

    console.log(`✅ Suggestions generated. Next: node step-by-step.js 5`);
}

// ═══════════════════════════════════════
// STEP 5: MIRROR
// ═══════════════════════════════════════
else if (step === 5) {
    const cache = loadCache();
    if (!cache?.classifyLog) { console.error('Run step 2 first'); process.exit(1); }

    console.log('═══ STEP 5: MIRROR ═══\n');
    const mirror = new MirrorAgent();
    const review = await mirror.reviewClassifications(cache.classifyLog);

    console.log(`  Sample size: ${review.sampleSize}`);
    console.log(`  Avg confidence: ${(review.scores.avgConfidence * 100).toFixed(1)}%`);
    console.log(`  Low confidence rate: ${(review.scores.lowConfidenceRate * 100).toFixed(1)}%`);
    console.log(`  Zone balance:`, review.scores.zoneBalance);
    console.log();

    if (review.feedback.length > 0) {
        console.log('  Feedback:');
        for (const fb of review.feedback) {
            console.log(`    ❓ ${fb.message}`);
        }
    } else {
        console.log('  ✅ All agents performing within thresholds');
    }

    if (review.evolution) {
        console.log(`\n  🧬 Evolution triggered (cycle ${review.evolution.cycle})`);
    }

    console.log('\n✅ Mirror review complete. Pipeline done!');
}

else {
    console.log('Usage: node step-by-step.js [1-5]');
    console.log('  1: Ingest   — fetch emails from Gmail');
    console.log('  2: Classify — zone triage (Red/Yellow/Green)');
    console.log('  3: Seed     — plant opportunity/decision seeds');
    console.log('  4: Suggest  — generate action suggestions');
    console.log('  5: Mirror   — self-review + quality check');
}
