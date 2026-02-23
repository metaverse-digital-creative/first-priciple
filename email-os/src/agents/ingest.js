/**
 * Ingest Agent — Fetches and normalizes email from Gmail
 * 
 * Responsibilities:
 * - Connect to Gmail API
 * - Fetch new/unread messages
 * - Normalize into standard format
 * - Persist to PostgreSQL via Drizzle ORM
 * - Publish email.fetched events on the Insight Bus
 */

import bus from '../bus.js';
import GmailClient from '../gmail/client.js';
import { db, isDbAvailable } from '../db/db.js';
import { emails } from '../db/schema.js';

class IngestAgent {
    constructor(authClient, config = {}) {
        this.client = new GmailClient(authClient);
        this.batchSize = config.batchSize || 50;
        this.processed = new Set(); // Fallback when DB unavailable
    }

    /**
     * Fetch and publish new emails
     * @param {object} options - { query, maxResults }
     * @returns {Array} Fetched email objects
     */
    async run(options = {}) {
        const query = options.query || 'is:inbox is:unread';
        const maxResults = options.maxResults || this.batchSize;

        bus.publish('ingest', 'ingest.started', { query, maxResults });

        try {
            const messages = await this.client.fetchMessages({ query, maxResults });
            const newMessages = [];

            for (const msg of messages) {
                if (this.processed.has(msg.id)) continue;

                // Persist to DB
                if (isDbAvailable()) {
                    try {
                        await db.insert(emails).values({
                            id: msg.id,
                            threadId: msg.threadId || '',
                            fromEmail: msg.from?.email || null,
                            fromName: msg.from?.name || null,
                            subject: msg.subject || null,
                            snippet: msg.snippet || null,
                            labels: msg.labelIds || [],
                            isImportant: msg.isImportant || false,
                            isStarred: msg.isStarred || false,
                            inReplyTo: msg.inReplyTo || null,
                            receivedAt: msg.date ? new Date(msg.date) : new Date(),
                        }).onConflictDoNothing();
                    } catch (err) {
                        console.warn(`   ⚠️  DB insert failed for ${msg.id}: ${err.message}`);
                    }
                }

                this.processed.add(msg.id);
                newMessages.push(msg);

                bus.publish('ingest', 'email.fetched', { email: msg, isNew: true });
            }

            bus.publish('ingest', 'ingest.complete', {
                total: messages.length,
                new: newMessages.length,
                skipped: messages.length - newMessages.length
            });

            return newMessages;
        } catch (err) {
            bus.publish('ingest', 'ingest.error', { error: err.message });
            throw err;
        }
    }

    async fetchThread(threadId) {
        const thread = await this.client.getThread(threadId);
        bus.publish('ingest', 'thread.fetched', { threadId, messageCount: thread.length });
        return thread;
    }

    async fetchFullMessage(messageId) {
        const message = await this.client.getFullMessage(messageId);
        bus.publish('ingest', 'email.body_fetched', { messageId });
        return message;
    }

    reset() {
        this.processed.clear();
    }
}

export { IngestAgent };
export default IngestAgent;
