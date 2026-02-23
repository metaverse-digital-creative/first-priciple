#!/usr/bin/env node

/**
 * Email OS — Main Entry Point
 * 
 * Usage:
 *   node src/index.js --sync      # Fetch + process inbox
 *   node src/index.js --triage    # Classify unread emails by zone
 *   node src/index.js --digest    # Show thread intelligence digest
 *   node src/index.js --seeds     # Show active seeds
 *   node src/index.js --stats     # Show bus + agent stats
 * 
 * State Machine: IDLE → SYNCING → PROCESSING → SUGGESTING → COMPLETE
 */

import { getAuthClient } from './gmail/auth.js';
import bus from './bus.js';
import stateMachine, { STATES } from './state.js';
import IngestAgent from './agents/ingest.js';
import ClassifyAgent from './agents/classify.js';
import SeedAgent from './agents/seed.js';
import SuggestAgent from './agents/suggest.js';
import InsightAgent from './agents/insight.js';
import MirrorAgent from './agents/mirror.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

// Parse CLI args
const args = process.argv.slice(2);
const mode = args[0] || '--sync';

// --- Main Pipeline ---

async function main() {
    console.log('\n📧 Email OS v1.0.0');
    console.log('   Every inbox is a signal field.\n');

    // Authenticate
    const authClient = await getAuthClient();

    // Initialize agents
    const ingest = new IngestAgent(authClient, config.agents.ingest);
    const classify = new ClassifyAgent(config.agents.classify);
    const seed = new SeedAgent();
    const suggest = new SuggestAgent(config.agents.suggest);
    const insight = new InsightAgent();
    const mirror = new MirrorAgent(config.agents.mirror);

    // Wire bus logging
    bus.subscribe('*', (msg) => {
        if (mode === '--verbose') {
            console.log(`  [${msg.source}] ${msg.event}`, JSON.stringify(msg.payload).slice(0, 100));
        }
    });

    switch (mode) {
        case '--sync':
            await runSync(ingest, classify, seed, suggest, insight, mirror);
            break;
        case '--triage':
            await runTriage(ingest, classify);
            break;
        case '--digest':
            showDigest(insight, seed);
            break;
        case '--seeds':
            showSeeds(seed);
            break;
        case '--stats':
            showStats(seed, insight, mirror);
            break;
        case '--escalate':
            runEscalation(seed);
            break;
        default:
            console.log('Usage: email-os [--sync|--triage|--digest|--seeds|--stats|--escalate]');
    }
}

/**
 * Full sync pipeline: Ingest → Classify → Seed → Suggest → Insight → Mirror
 */
async function runSync(ingest, classify, seed, suggest, insight, mirror) {
    stateMachine.transition(STATES.SYNCING);
    console.log('📥 Syncing inbox...\n');

    try {
        // 1. Ingest
        const emails = await ingest.run({ query: 'is:inbox is:unread' });
        console.log(`   Fetched ${emails.length} new email(s)\n`);

        if (emails.length === 0) {
            console.log('   ✨ Inbox zero — nothing to process.\n');
            stateMachine.transition(STATES.COMPLETE);
            return;
        }

        // 2. Classify
        stateMachine.transition(STATES.PROCESSING);
        console.log('🏷️  Classifying by zone...\n');
        const classified = await classify.batchClassify(emails);

        // Print zone summary
        const zoneEmoji = { red: '🔴', yellow: '🟡', green: '🟢' };
        for (const [zone, items] of Object.entries(classified)) {
            if (items.length > 0) {
                console.log(`   ${zoneEmoji[zone]} ${zone.toUpperCase()} (${items.length})`);
                for (const { email, classification } of items.slice(0, 5)) {
                    console.log(`      ${email.from?.name || email.from?.email} — ${email.subject}`);
                    console.log(`      └─ ${classification.reasoning}`);
                }
                console.log();
            }
        }

        // 3. Seed + Suggest for non-green
        stateMachine.transition(STATES.SUGGESTING);
        console.log('🌱 Planting seeds + generating suggestions...\n');

        const allClassified = [
            ...classified.red,
            ...classified.yellow,
            ...classified.green
        ];

        for (const { email, classification } of allClassified) {
            // Seed
            const planted = seed.evaluate(email, classification);

            // Thread intelligence
            insight.trackThread(email, classification);

            // Suggest
            if (classification.zone !== 'green') {
                const suggestion = suggest.suggest(email, classification, planted);
                if (planted) {
                    console.log(`   🌱 ${planted.type}: "${email.subject}" (${planted.shelfLife} shelf-life)`);
                }
                if (suggestion.responseDraft) {
                    console.log(`   💬 Draft ready for "${email.subject}"`);
                }
            }
        }

        // 4. Mirror review
        // Classification stats
        const classifyStats = classify.getStats();
        console.log(`\n   📊 Classify: ${classifyStats.keyword} keyword / ${classifyStats.llm} LLM / ${classifyStats.fallback} fallback`);

        console.log('\n🪞 Mirror review...');
        const review = mirror.reviewClassifications(classify.getLog());
        if (review.feedback.length > 0) {
            for (const fb of review.feedback) {
                console.log(`   ❓ ${fb.message}`);
            }
        } else {
            console.log('   ✅ All agents performing within thresholds');
        }
        if (review.evolution) {
            console.log(`   🧬 Evolution triggered (cycle ${review.evolution.cycle})`);
            for (const rec of review.evolution.recommendations) {
                console.log(`      → ${rec.message}`);
            }
        }

        // 5. Check escalations
        const escalated = seed.checkEscalation();
        if (escalated.length > 0) {
            console.log(`\n⚠️  ${escalated.length} seed(s) escalated to Red Zone!`);
        }

        stateMachine.transition(STATES.COMPLETE);
        console.log(`\n✅ Sync complete (${stateMachine.elapsed()}ms)`);
        console.log(`   ${bus.getStats().totalEvents} bus events processed\n`);

    } catch (err) {
        stateMachine.transition(STATES.ERROR, { error: err.message });
        console.error(`\n❌ Sync failed: ${err.message}`);
        console.error('   Run with --verbose for details.\n');
    }
}

/**
 * Quick triage: classify unread, show zones
 */
async function runTriage(ingest, classify) {
    console.log('🏷️  Quick triage — classifying unread...\n');
    const emails = await ingest.run({ query: 'is:inbox is:unread', maxResults: 20 });
    const classified = await classify.batchClassify(emails);

    const zoneEmoji = { red: '🔴', yellow: '🟡', green: '🟢' };
    for (const [zone, items] of Object.entries(classified)) {
        console.log(`${zoneEmoji[zone]} ${zone.toUpperCase()} Zone (${items.length})`);
        for (const { email, classification } of items) {
            const time = email.date ? new Date(email.date).toLocaleTimeString() : '';
            console.log(`  ${time} | ${(email.from?.name || email.from?.email || '').padEnd(25)} | ${email.subject}`);
        }
        console.log();
    }
}

/**
 * Show thread intelligence digest
 */
function showDigest(insight, seed) {
    console.log('📊 Thread Intelligence Digest\n');

    const hotThreads = insight.getHotThreads(5);
    if (hotThreads.length > 0) {
        console.log('🔥 Hot Threads:');
        for (const t of hotThreads) {
            const arrow = t.trajectory === 'rising' ? '📈' : t.trajectory === 'falling' ? '📉' : '➡️';
            console.log(`  ${arrow} ${t.subject} (${t.temperature}° | ${t.velocity} msg/d | ${t.participants} people)`);
        }
    } else {
        console.log('   No thread data yet. Run --sync first.\n');
    }

    const insights = insight.getRecentInsights(5);
    if (insights.length > 0) {
        console.log('\n💡 Recent Insights:');
        for (const i of insights) {
            console.log(`  ${i.message}`);
        }
    }

    const active = seed.getActive();
    if (active.length > 0) {
        console.log(`\n🌱 Active Seeds (${active.length}):`);
        for (const s of active.slice(0, 5)) {
            const icon = s.escalated ? '🚨' : '🌱';
            console.log(`  ${icon} [${s.type}] ${s.source.subject} — expires ${new Date(s.expiresAt).toLocaleDateString()}`);
        }
    }

    console.log();
}

/**
 * Show active seeds
 */
function showSeeds(seed) {
    console.log('🌱 Active Seeds\n');
    const stats = seed.getStats();
    console.log(`   Total: ${stats.total} | Active: ${stats.active} | Harvested: ${stats.harvested} | Escalated: ${stats.escalated}\n`);

    const active = seed.getActive();
    for (const s of active) {
        const icon = s.escalated ? '🚨' : '🌱';
        const remaining = Math.round((new Date(s.expiresAt) - Date.now()) / 3600000);
        console.log(`  ${icon} ${s.id} [${s.type}] ${s.zone.toUpperCase()}`);
        console.log(`     ${s.source.subject}`);
        console.log(`     From: ${s.source.from?.name || s.source.from?.email}`);
        console.log(`     Remaining: ${remaining > 0 ? remaining + 'h' : '⏰ EXPIRED'}`);
        console.log();
    }
}

/**
 * Show bus + agent stats
 */
function showStats(seed, insight, mirror) {
    console.log('📊 Email OS Stats\n');

    const busStats = bus.getStats();
    console.log('Insight Bus:');
    console.log(`  Total events: ${busStats.totalEvents}`);
    console.log(`  By source:`, busStats.bySource);
    console.log();

    const seedStats = seed.getStats();
    console.log('Seeds:');
    console.log(`  Total: ${seedStats.total} | Active: ${seedStats.active} | Harvested: ${seedStats.harvested}`);
    console.log(`  By type:`, seedStats.byType);
    console.log();

    const mirrorHistory = mirror.getHistory();
    console.log('Mirror:');
    console.log(`  Review cycles: ${mirrorHistory.totalCycles}`);
    console.log(`  Evolutions: ${mirrorHistory.evolutions.length}`);
    console.log();

    console.log('State Machine:');
    console.log(`  Current: ${stateMachine.state}`);
    console.log(`  Errors: ${stateMachine.errorCount}`);
    console.log();
}

/**
 * Run seed escalation check
 */
function runEscalation(seed) {
    console.log('⏰ Checking seed escalations...\n');
    const escalated = seed.checkEscalation();
    if (escalated.length > 0) {
        console.log(`🚨 ${escalated.length} seed(s) escalated:`);
        for (const s of escalated) {
            console.log(`  → ${s.id} [${s.type}] "${s.source.subject}"`);
        }
    } else {
        console.log('   ✅ No seeds need escalation.\n');
    }
}

// Run
main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
