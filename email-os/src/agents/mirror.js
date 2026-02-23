/**
 * Mirror Agent — Self-Review and Improvement
 * 
 * Pattern: meta-learning-qa (openclaw → email-os)
 * Don't just check work — track what feedback actually improves outcomes.
 * 
 * Persistence: PostgreSQL via Drizzle ORM
 * 
 * Wisdom Question: "Am I getting better at getting better?"
 */

import bus from '../bus.js';
import { db, isDbAvailable } from '../db/db.js';
import { reviews as reviewsTable } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';

class MirrorAgent {
    constructor(config = {}) {
        this.reviewCycle = config.reviewCycle || 10;
        this.reviews = [];
        this.evolutionLog = [];
        this.cycleCount = 0;
    }

    /**
     * Review classify agent's work
     */
    async reviewClassifications(classifications) {
        const review = {
            agent: 'classify',
            cycleNumber: ++this.cycleCount,
            sampleSize: classifications.length,
            timestamp: new Date().toISOString(),
            scores: {},
            feedback: [],
            evolution: null
        };

        const confidences = classifications.map(c => c.confidence);
        review.scores.avgConfidence = this.avg(confidences);
        review.scores.lowConfidenceRate = confidences.filter(c => c < 0.5).length / (confidences.length || 1);

        const zones = classifications.map(c => c.zone);
        const zoneDist = { red: 0, yellow: 0, green: 0 };
        zones.forEach(z => zoneDist[z]++);
        review.scores.zoneBalance = zoneDist;

        if (review.scores.lowConfidenceRate > 0.3) {
            review.feedback.push({ type: 'question', message: 'Over 30% of emails have low confidence — do we need more signal sources?', actionable: true });
        }
        if (classifications.length > 0 && zoneDist.red / classifications.length > 0.5) {
            review.feedback.push({ type: 'question', message: 'Over 50% classified as Red Zone — are thresholds too sensitive?', actionable: true });
        }
        if (classifications.length > 0 && zoneDist.green / classifications.length > 0.7) {
            review.feedback.push({ type: 'question', message: 'Over 70% are Green Zone — are we missing important signals?', actionable: true });
        }

        this.reviews.push(review);

        if (this.cycleCount % this.reviewCycle === 0) {
            review.evolution = this.evolve();
        }

        // Persist to DB
        if (isDbAvailable()) {
            db.insert(reviewsTable).values({
                agent: review.agent,
                cycleNumber: review.cycleNumber,
                sampleSize: review.sampleSize,
                scores: review.scores,
                feedback: review.feedback,
                evolution: review.evolution,
            }).catch(err => console.warn(`   ⚠️  DB review insert: ${err.message}`));
        }

        bus.publish('mirror', 'review.completed', {
            agent: 'classify', cycle: this.cycleCount,
            avgConfidence: review.scores.avgConfidence,
            feedbackCount: review.feedback.length,
            evolved: !!review.evolution
        });

        return review;
    }

    /**
     * Review seed agent's work
     */
    async reviewSeeds(seedStats) {
        const review = {
            agent: 'seed',
            timestamp: new Date().toISOString(),
            scores: {},
            feedback: []
        };

        if (seedStats.total > 0) review.scores.harvestRate = seedStats.harvested / seedStats.total;
        if (seedStats.active > 0) review.scores.escalationRate = seedStats.escalated / seedStats.active;

        if (seedStats.active > 20) {
            review.feedback.push({ type: 'question', message: `${seedStats.active} active seeds — planting too many without harvesting?`, actionable: true });
        }
        if (review.scores.escalationRate > 0.4) {
            review.feedback.push({ type: 'question', message: 'Over 40% of seeds escalating — shelf-lives too short?', actionable: true });
        }

        this.reviews.push(review);

        if (isDbAvailable()) {
            db.insert(reviewsTable).values({
                agent: review.agent,
                scores: review.scores,
                feedback: review.feedback,
            }).catch(err => console.warn(`   ⚠️  DB review insert: ${err.message}`));
        }

        bus.publish('mirror', 'review.completed', {
            agent: 'seed', harvestRate: review.scores.harvestRate,
            feedbackCount: review.feedback.length
        });

        return review;
    }

    evolve() {
        const recent = this.reviews.slice(-this.reviewCycle);
        const evolution = {
            cycle: this.cycleCount,
            timestamp: new Date().toISOString(),
            feedbackPatterns: {},
            recommendations: []
        };

        for (const review of recent) {
            for (const fb of review.feedback || []) {
                evolution.feedbackPatterns[fb.type] = (evolution.feedbackPatterns[fb.type] || 0) + 1;
            }
        }

        for (const [type, count] of Object.entries(evolution.feedbackPatterns)) {
            if (count >= Math.ceil(this.reviewCycle / 2)) {
                evolution.recommendations.push({
                    priority: 'high',
                    message: `Recurring "${type}" appeared ${count}/${this.reviewCycle} cycles — consider structural fix`,
                    actionable: true
                });
            }
        }

        const classifyReviews = recent.filter(r => r.agent === 'classify');
        if (classifyReviews.length >= 3) {
            const confidences = classifyReviews.map(r => r.scores?.avgConfidence || 0);
            const trend = confidences[confidences.length - 1] - confidences[0];
            if (trend > 0.1) evolution.recommendations.push({ priority: 'positive', message: `Confidence improving (+${(trend * 100).toFixed(1)}%)` });
            if (trend < -0.1) evolution.recommendations.push({ priority: 'warning', message: `Confidence declining (${(trend * 100).toFixed(1)}%)` });
        }

        this.evolutionLog.push(evolution);
        bus.publish('mirror', 'evolution.completed', { cycle: this.cycleCount, recommendations: evolution.recommendations.length });
        return evolution;
    }

    async getHistory() {
        if (isDbAvailable()) {
            try {
                const dbReviews = await db.select().from(reviewsTable).orderBy(desc(reviewsTable.createdAt));
                return { reviews: dbReviews, evolutions: this.evolutionLog, totalCycles: this.cycleCount };
            } catch { /* fallback */ }
        }
        return { reviews: this.reviews, evolutions: this.evolutionLog, totalCycles: this.cycleCount };
    }

    avg(arr) {
        if (arr.length === 0) return 0;
        return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
    }
}

export { MirrorAgent };
export default MirrorAgent;
