/**
 * Ingest Agent — Fetches and normalizes email from Gmail
 */

import bus from '../bus.js';
import GmailClient from '../gmail/client.js';
import { db, isDbAvailable } from '../db/db.js';
import { emails } from '../db/schema.js';
import type { Email, AgentConfig } from '../types.js';
import type { OAuth2Client } from 'google-auth-library';

class IngestAgent {
    private client: GmailClient;
    private batchSize: number;
    private processed: Set<string> = new Set();

    constructor(authClient: OAuth2Client, config: AgentConfig = {}) {
        this.client = new GmailClient(authClient);
        this.batchSize = config.batchSize || 50;
    }

    async run(options: { query?: string; maxResults?: number } = {}): Promise<Email[]> {
        const query = options.query || 'is:inbox is:unread';
        const maxResults = options.maxResults || this.batchSize;

        bus.publish('ingest', 'ingest.started', { query, maxResults });

        try {
            const messages = await this.client.fetchMessages({ query, maxResults });
            const newMessages: Email[] = [];

            for (const msg of messages) {
                if (this.processed.has(msg.id)) continue;

                if (isDbAvailable() && db) {
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
                        console.warn(`   ⚠️  DB insert failed for ${msg.id}: ${(err as Error).message}`);
                    }
                }

                this.processed.add(msg.id);
                newMessages.push(msg);
                bus.publish('ingest', 'email.fetched', { email: msg, isNew: true });
            }

            bus.publish('ingest', 'ingest.complete', {
                total: messages.length, new: newMessages.length,
                skipped: messages.length - newMessages.length
            });

            return newMessages;
        } catch (err) {
            bus.publish('ingest', 'ingest.error', { error: (err as Error).message });
            throw err;
        }
    }

    async fetchThread(threadId: string): Promise<Email[]> {
        const thread = await this.client.getThread(threadId);
        bus.publish('ingest', 'thread.fetched', { threadId, messageCount: thread.length });
        return thread;
    }

    async fetchFullMessage(messageId: string): Promise<Email> {
        const message = await this.client.getFullMessage(messageId);
        bus.publish('ingest', 'email.body_fetched', { messageId });
        return message;
    }

    reset(): void {
        this.processed.clear();
    }
}

export { IngestAgent };
export default IngestAgent;
