/**
 * Mirror Agent — Self-Review and Improvement
 * 
 * Pattern: meta-learning-qa (openclaw → email-os)
 * Don't just check work — track what feedback actually improves outcomes.
 * After 5-10 review cycles, evolve review techniques.
 * 
 * Wisdom Question: "Am I getting better at getting better?"
 */

import bus from '../bus.js';

class MirrorAgent {
    constructor(config = {}) {
        this.reviewCycle = config.reviewCycle || 10;
        this.reviews = [];
        this.evolutionLog = [];
        this.cycleCount = 0;
    }

    /**
     * Review classify agent's work
     * @param {Array} classifications - From ClassifyAgent.getLog()
     * @returns {object} Review with scores and feedback
     */
    reviewClassifications(classifications) {
        const review = {
            agent: 'classify',
            cycleNumber: ++this.cycleCount,
            sampleSize: classifications.length,
            timestamp: new Date().toISOString(),
            scores: {},
            feedback: [],
            evolution: null
        };

        // Score: confidence distribution
        const confidences = classifications.map(c => c.confidence);
        review.scores.avgConfidence = this.avg(confidences);
        review.scores.lowConfidenceRate = confidences.filter(c => c < 0.5).length / confidences.length;

        // Score: zone distribution balance
        const zones = classifications.map(c => c.zone);
        const zoneDist = { red: 0, yellow: 0, green: 0 };
        zones.forEach(z => zoneDist[z]++);
        review.scores.zoneBalance = zoneDist;

        // Feedback: too many low-confidence classifications?
        if (review.scores.lowConfidenceRate > 0.3) {
            review.feedback.push({
                type: 'question',
                message: 'Over 30% of emails have low confidence — do we need more signal sources?',
                actionable: true
            });
        }

        // Feedback: everything is red zone?
        if (zoneDist.red / classifications.length > 0.5) {
            review.feedback.push({
                type: 'question',
                message: 'Over 50% of emails classified as Red Zone — are thresholds too sensitive?',
                actionable: true
            });
        }

        // Feedback: everything is green zone?
        if (zoneDist.green / classifications.length > 0.7) {
            review.feedback.push({
                type: 'question',
                message: 'Over 70% of emails are Green Zone — are we missing important signals?',
                actionable: true
            });
        }

        this.reviews.push(review);

        // Check if we should evolve
        if (this.cycleCount % this.reviewCycle === 0) {
            review.evolution = this.evolve();
        }

        bus.publish('mirror', 'review.completed', {
            agent: 'classify',
            cycle: this.cycleCount,
            avgConfidence: review.scores.avgConfidence,
            feedbackCount: review.feedback.length,
            evolved: !!review.evolution
        });

        return review;
    }

    /**
     * Review seed agent's work
     * @param {object} seedStats - From SeedAgent.getStats()
     * @returns {object} Review
     */
    reviewSeeds(seedStats) {
        const review = {
            agent: 'seed',
            timestamp: new Date().toISOString(),
            scores: {},
            feedback: []
        };

        // Harvest rate
        if (seedStats.total > 0) {
            review.scores.harvestRate = seedStats.harvested / seedStats.total;
        }

        // Escalation rate
        if (seedStats.active > 0) {
            review.scores.escalationRate = seedStats.escalated / seedStats.active;
        }

        // Feedback: too many unharvested seeds?
        if (seedStats.active > 20) {
            review.feedback.push({
                type: 'question',
                message: `${seedStats.active} active seeds — are we planting too many without harvesting?`,
                actionable: true
            });
        }

        // Feedback: high escalation rate?
        if (review.scores.escalationRate > 0.4) {
            review.feedback.push({
                type: 'question',
                message: 'Over 40% of seeds are escalating — are shelf-lives too short?',
                actionable: true
            });
        }

        this.reviews.push(review);

        bus.publish('mirror', 'review.completed', {
            agent: 'seed',
            harvestRate: review.scores.harvestRate,
            feedbackCount: review.feedback.length
        });

        return review;
    }

    /**
     * Meta-learning: analyze patterns in our own feedback
     * Called after every N review cycles
     */
    evolve() {
        const recent = this.reviews.slice(-this.reviewCycle);

        const evolution = {
            cycle: this.cycleCount,
            timestamp: new Date().toISOString(),
            feedbackPatterns: [],
            recommendations: []
        };

        // Analyze what feedback types we give most
        const feedbackTypes = {};
        for (const review of recent) {
            for (const fb of review.feedback || []) {
                feedbackTypes[fb.type] = (feedbackTypes[fb.type] || 0) + 1;
            }
        }
        evolution.feedbackPatterns = feedbackTypes;

        // If we keep giving the same feedback, escalate it
        for (const [type, count] of Object.entries(feedbackTypes)) {
            if (count >= Math.ceil(this.reviewCycle / 2)) {
                evolution.recommendations.push({
                    priority: 'high',
                    message: `Recurring feedback type "${type}" appeared ${count}/${this.reviewCycle} cycles — consider a structural fix, not just flagging`,
                    actionable: true
                });
            }
        }

        // Track confidence trend across reviews
        const classifyReviews = recent.filter(r => r.agent === 'classify');
        if (classifyReviews.length >= 3) {
            const confidences = classifyReviews.map(r => r.scores?.avgConfidence || 0);
            const trend = confidences[confidences.length - 1] - confidences[0];
            if (trend > 0.1) {
                evolution.recommendations.push({
                    priority: 'positive',
                    message: `Classification confidence is improving (+${(trend * 100).toFixed(1)}%) — current approach is working`
                });
            }
            if (trend < -0.1) {
                evolution.recommendations.push({
                    priority: 'warning',
                    message: `Classification confidence is declining (${(trend * 100).toFixed(1)}%) — review signal sources`
                });
            }
        }

        this.evolutionLog.push(evolution);

        bus.publish('mirror', 'evolution.completed', {
            cycle: this.cycleCount,
            recommendations: evolution.recommendations.length
        });

        return evolution;
    }

    /**
     * Get full review history
     */
    getHistory() {
        return {
            reviews: this.reviews,
            evolutions: this.evolutionLog,
            totalCycles: this.cycleCount
        };
    }

    // --- Helpers ---

    avg(arr) {
        if (arr.length === 0) return 0;
        return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
    }
}

export { MirrorAgent };
export default MirrorAgent;
