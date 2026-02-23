/**
 * Ingest Agent — Fetches and normalizes email from Gmail
 * 
 * Responsibilities:
 * - Connect to Gmail API
 * - Fetch new/unread messages
 * - Normalize into standard format
 * - Publish email.fetched events on the Insight Bus
 */

import bus from '../bus.js';
import GmailClient from '../gmail/client.js';

class IngestAgent {
    constructor(authClient, config = {}) {
        this.client = new GmailClient(authClient);
        this.batchSize = config.batchSize || 50;
        this.processed = new Set(); // Track already-processed message IDs
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
            const newMessages = messages.filter(m => !this.processed.has(m.id));

            for (const msg of newMessages) {
                this.processed.add(msg.id);
                bus.publish('ingest', 'email.fetched', {
                    email: msg,
                    isNew: true
                });
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

    /**
     * Fetch a full thread for deep analysis
     * @param {string} threadId
     */
    async fetchThread(threadId) {
        const thread = await this.client.getThread(threadId);
        bus.publish('ingest', 'thread.fetched', { threadId, messageCount: thread.length });
        return thread;
    }

    /**
     * Fetch full body of a specific message
     * @param {string} messageId
     */
    async fetchFullMessage(messageId) {
        const message = await this.client.getFullMessage(messageId);
        bus.publish('ingest', 'email.body_fetched', { messageId });
        return message;
    }

    /**
     * Clear processed cache (for re-processing)
     */
    reset() {
        this.processed.clear();
    }
}

export { IngestAgent };
export default IngestAgent;
