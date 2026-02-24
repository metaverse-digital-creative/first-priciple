/**
 * Suggest Agent — Response and Action Suggestions
 */

import bus from '../bus.js';
import { db, isDbAvailable } from '../db/db.js';
import { suggestions as suggestionsTable } from '../db/schema.js';
import { desc } from 'drizzle-orm';
import type { Email, Classification, Seed, Action, Suggestion, AgentConfig } from '../types.js';

interface ResponseDraft {
    type: string;
    template: string;
    editable: boolean;
}

class SuggestAgent {
    private maxSuggestions: number;
    private suggestions: Suggestion[] = [];

    constructor(config: AgentConfig = {}) {
        this.maxSuggestions = config.maxSuggestions || 3;
    }

    async suggest(email: Email, classification: Classification, seed: Seed | null = null): Promise<Suggestion> {
        const actions = this.generateActions(email, classification, seed);
        const responseDraft = this.draftResponse(email, classification);

        const suggestion: Suggestion = {
            emailId: email.id,
            threadId: email.threadId,
            zone: classification.zone,
            actions: actions.slice(0, this.maxSuggestions),
            responseDraft,
            priority: this.calculatePriority(classification, seed),
            timestamp: new Date().toISOString()
        };

        this.suggestions.push(suggestion);

        if (isDbAvailable() && db) {
            db.insert(suggestionsTable).values({
                emailId: email.id,
                threadId: email.threadId,
                zone: classification.zone,
                actions: suggestion.actions,
                responseDraft: suggestion.responseDraft as Record<string, unknown> | null,
                priority: suggestion.priority,
            }).catch(err => console.warn(`   ⚠️  DB suggest insert: ${(err as Error).message}`));
        }

        bus.publish('suggest', 'suggestion.created', {
            emailId: email.id, zone: classification.zone,
            actionCount: actions.length, hasDraft: !!responseDraft
        });

        return suggestion;
    }

    generateActions(email: Email, classification: Classification, seed: Seed | null): Action[] {
        const actions: Action[] = [];

        if (classification.zone === 'red') {
            actions.push({ type: 'respond', label: '💬 Reply now', urgency: 'immediate', reason: 'Red zone — needs response within 2h' });
        }
        if (classification.zone === 'yellow') {
            actions.push({ type: 'schedule', label: '📅 Schedule response', urgency: 'today', reason: 'Yellow zone — handle today' });
        }
        if (classification.zone === 'green') {
            actions.push({ type: 'batch', label: '📦 Add to weekly batch', urgency: 'week', reason: 'Green zone — batch process' });
        }

        if (seed) {
            switch (seed.type) {
                case 'opportunity': actions.push({ type: 'research', label: '🔍 Research sender', reason: 'Opportunity detected' }); break;
                case 'decision-needed': actions.push({ type: 'decide', label: '⚡ Make decision', reason: 'Decision clock is ticking' }); break;
                case 'relationship-build': actions.push({ type: 'connect', label: '🤝 Deepen connection', reason: 'Frequent contact' }); break;
            }
        }

        if (email.inReplyTo) actions.push({ type: 'review-thread', label: '🧵 Review full thread', reason: 'Part of ongoing conversation' });
        if (!email.isStarred && classification.zone !== 'green') actions.push({ type: 'star', label: '⭐ Star for follow-up', reason: 'Worth tracking' });

        return actions;
    }

    draftResponse(email: Email, classification: Classification): ResponseDraft | null {
        if (classification.zone === 'green') return null;
        const senderName = email.from?.name || email.from?.email?.split('@')[0] || 'there';
        const subject = email.subject || '';

        if (classification.signals?.some(s => s.type === 'urgency' && s.level === 'high')) {
            return { type: 'urgent-reply', template: `Hi ${senderName},\n\nThank you for flagging this. I'll look into it right away.\n\nBest,`, editable: true };
        }
        if (email.inReplyTo) {
            return { type: 'thread-continue', template: `Hi ${senderName},\n\nThanks for the follow-up. [Your response here]\n\nBest,`, editable: true };
        }
        return { type: 'standard', template: `Hi ${senderName},\n\nThank you for your email regarding "${subject}". [Your response here]\n\nBest,`, editable: true };
    }

    calculatePriority(classification: Classification, seed: Seed | null): number {
        let priority = classification.score || 50;
        if (seed?.type === 'decision-needed') priority += 20;
        if (seed?.type === 'opportunity') priority += 15;
        if (seed?.escalated) priority += 25;
        return Math.min(100, priority);
    }

    async getAll(): Promise<Suggestion[]> {
        if (isDbAvailable() && db) {
            try {
                return await db.select().from(suggestionsTable).orderBy(desc(suggestionsTable.priority)) as unknown as Suggestion[];
            } catch { /* fallback */ }
        }
        return this.suggestions.sort((a, b) => b.priority - a.priority);
    }

    getLog(): Suggestion[] { return this.suggestions; }
}

export { SuggestAgent };
export default SuggestAgent;
