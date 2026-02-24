#!/usr/bin/env tsx

/**
 * Email OS — Main Entry Point
 *
 * Usage:
 *   tsx src/index.ts --sync      # Fetch + process inbox
 *   tsx src/index.ts --triage    # Classify unread emails by zone
 *   tsx src/index.ts --digest    # Show thread intelligence digest
 *   tsx src/index.ts --seeds     # Show active seeds
 *   tsx src/index.ts --stats     # Show bus + agent stats
 */

import { getAuthClient } from './gmail/auth.js';
import bus from './bus.js';
import stateMachine, { State } from './state.js';
import IngestAgent from './agents/ingest.js';
import ClassifyAgent from './agents/classify.js';
import SeedAgent from './agents/seed.js';
import SuggestAgent from './agents/suggest.js';
import InsightAgent from './agents/insight.js';
import MirrorAgent from './agents/mirror.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Email, Classification, Seed } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

const args = process.argv.slice(2);
const mode = args[0] || '--sync';

// ─── Main Pipeline ─────────────────────────────────────────

async function main(): Promise<void> {
    console.log('\n📧 Email OS v1.0.0');
    console.log('   Every inbox is a signal field.\n');

    const authClient = await getAuthClient();

    const ingest = new IngestAgent(authClient, config.agents.ingest);
    const classify = new ClassifyAgent(config.agents.classify);
    const seed = new SeedAgent();
    const suggest = new SuggestAgent(config.agents.suggest);
    const insight = new InsightAgent();
    const mirror = new MirrorAgent(config.agents.mirror);

    bus.subscribe('*', (msg) => {
        if (mode === '--verbose') {
            console.log(`  [${msg.agent}] ${msg.type}`, JSON.stringify(msg.data).slice(0, 100));
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
            await showDigest(insight, seed);
            break;
        case '--seeds':
            await showSeeds(seed);
            break;
        case '--stats':
            await showStats(seed, insight, mirror);
            break;
        case '--escalate':
            await runEscalation(seed);
            break;
        default:
            console.log('Usage: email-os [--sync|--triage|--digest|--seeds|--stats|--escalate]');
    }
}

async function runSync(
    ingest: IngestAgent, classify: ClassifyAgent, seed: SeedAgent,
    suggest: SuggestAgent, insight: InsightAgent, mirror: MirrorAgent
): Promise<void> {
    stateMachine.transition(State.SYNCING);
    console.log('📥 Syncing inbox...\n');

    try {
        const emails = await ingest.run({ query: 'is:inbox is:unread' });
        console.log(`   Fetched ${emails.length} new email(s)\n`);

        if (emails.length === 0) {
            console.log('   ✨ Inbox zero — nothing to process.\n');
            stateMachine.transition(State.COMPLETE);
            return;
        }

        stateMachine.transition(State.PROCESSING);
        console.log('🏷️  Classifying by zone...\n');
        const classified = await classify.batchClassify(emails);

        const zoneEmoji: Record<string, string> = { red: '🔴', yellow: '🟡', green: '🟢' };
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

        stateMachine.transition(State.SUGGESTING);
        console.log('🌱 Planting seeds + generating suggestions...\n');

        const allClassified = [...classified.red, ...classified.yellow, ...classified.green];

        for (const { email, classification } of allClassified) {
            const planted = await seed.evaluate(email, classification);
            await insight.trackThread(email, classification);

            if (classification.zone !== 'green') {
                const suggestion = await suggest.suggest(email, classification, planted);
                if (planted) {
                    console.log(`   🌱 ${planted.type}: "${email.subject}" (${planted.shelfLife} shelf-life)`);
                }
                if (suggestion.responseDraft) {
                    console.log(`   💬 Draft ready for "${email.subject}"`);
                }
            }
        }

        console.log('\n🪞 Mirror review...');
        const classifyLog = await classify.getLog();
        const review = await mirror.reviewClassifications(classifyLog);
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

        const escalated = await seed.checkEscalation();
        if (escalated.length > 0) {
            console.log(`\n⚠️  ${escalated.length} seed(s) escalated to Red Zone!`);
        }

        stateMachine.transition(State.COMPLETE);
        console.log(`\n✅ Sync complete (${stateMachine.elapsed()}ms)`);
        console.log(`   ${bus.getStats().totalEvents} bus events processed\n`);

    } catch (err) {
        stateMachine.transition(State.ERROR, { error: (err as Error).message });
        console.error(`\n❌ Sync failed: ${(err as Error).message}`);
    }
}

async function runTriage(ingest: IngestAgent, classify: ClassifyAgent): Promise<void> {
    console.log('🏷️  Quick triage — classifying unread...\n');
    const emails = await ingest.run({ query: 'is:inbox is:unread', maxResults: 20 });
    const classified = await classify.batchClassify(emails);

    const zoneEmoji: Record<string, string> = { red: '🔴', yellow: '🟡', green: '🟢' };
    for (const [zone, items] of Object.entries(classified)) {
        console.log(`${zoneEmoji[zone]} ${zone.toUpperCase()} Zone (${items.length})`);
        for (const { email } of items) {
            const time = email.date ? new Date(email.date).toLocaleTimeString() : '';
            console.log(`  ${time} | ${(email.from?.name || email.from?.email || '').padEnd(25)} | ${email.subject}`);
        }
        console.log();
    }
}

async function showDigest(insight: InsightAgent, seed: SeedAgent): Promise<void> {
    console.log('📊 Thread Intelligence Digest\n');

    const hotThreads = await insight.getHotThreads(5);
    if (hotThreads.length > 0) {
        console.log('🔥 Hot Threads:');
        for (const t of hotThreads) {
            const arrow = t.trajectory === 'heating' ? '📈' : t.trajectory === 'cooling' ? '📉' : '➡️';
            console.log(`  ${arrow} ${t.subject} (${t.temperature}° | ${t.velocity} msg/d | ${t.participantCount} people)`);
        }
    } else {
        console.log('   No thread data yet. Run --sync first.\n');
    }

    const insights = await insight.getRecentInsights(5);
    if (insights.length > 0) {
        console.log('\n💡 Recent Insights:');
        for (const i of insights) {
            console.log(`  ${i.message}`);
        }
    }

    const active = await seed.getActive();
    if (active.length > 0) {
        console.log(`\n🌱 Active Seeds (${active.length}):`);
        for (const s of active.slice(0, 5)) {
            const icon = s.escalated ? '🚨' : '🌱';
            console.log(`  ${icon} [${s.type}] ${s.sourceSubject} — expires ${new Date(s.expiresAt).toLocaleDateString()}`);
        }
    }
    console.log();
}

async function showSeeds(seed: SeedAgent): Promise<void> {
    console.log('🌱 Active Seeds\n');
    const stats = await seed.getStats();
    console.log(`   Total: ${stats.total} | Active: ${stats.active} | Harvested: ${stats.harvested} | Escalated: ${stats.escalated}\n`);

    const active = await seed.getActive();
    for (const s of active) {
        const icon = s.escalated ? '🚨' : '🌱';
        const remaining = Math.round((new Date(s.expiresAt).getTime() - Date.now()) / 3600000);
        console.log(`  ${icon} ${s.id} [${s.type}] ${s.zone.toUpperCase()}`);
        console.log(`     ${s.sourceSubject}`);
        console.log(`     From: ${s.sourceFrom}`);
        console.log(`     Remaining: ${remaining > 0 ? remaining + 'h' : '⏰ EXPIRED'}`);
        console.log();
    }
}

async function showStats(seed: SeedAgent, insight: InsightAgent, mirror: MirrorAgent): Promise<void> {
    console.log('📊 Email OS Stats\n');

    const busStats = bus.getStats();
    console.log('Insight Bus:');
    console.log(`  Total events: ${busStats.totalEvents}`);
    console.log(`  Agents:`, busStats.agents);
    console.log();

    const seedStats = await seed.getStats();
    console.log('Seeds:');
    console.log(`  Total: ${seedStats.total} | Active: ${seedStats.active} | Harvested: ${seedStats.harvested}`);
    console.log(`  By type:`, seedStats.byType);
    console.log();

    const mirrorHistory = await mirror.getHistory();
    console.log('Mirror:');
    console.log(`  Review cycles: ${mirrorHistory.totalCycles}`);
    console.log(`  Evolutions: ${mirrorHistory.evolutions.length}`);
    console.log();

    console.log('State Machine:');
    console.log(`  Current: ${stateMachine.state}`);
    console.log(`  Errors: ${stateMachine.errorCount}`);
    console.log();
}

async function runEscalation(seed: SeedAgent): Promise<void> {
    console.log('⏰ Checking seed escalations...\n');
    const escalated = await seed.checkEscalation();
    if (escalated.length > 0) {
        console.log(`🚨 ${escalated.length} seed(s) escalated:`);
        for (const s of escalated) {
            console.log(`  → ${s.id} [${s.type}] "${s.sourceSubject}"`);
        }
    } else {
        console.log('   ✅ No seeds need escalation.\n');
    }
}

main().catch(err => {
    console.error('Fatal:', (err as Error).message);
    process.exit(1);
});
