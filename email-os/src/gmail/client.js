/**
 * Gmail API Client — Wrapper for fetching and sending email
 * 
 * Pattern: single-source-of-truth (keynote-studio → email-os)
 * All Gmail operations go through this client. Config drives behavior.
 */

import { google } from 'googleapis';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');

const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

class GmailClient {
    constructor(authClient) {
        this.gmail = google.gmail({ version: 'v1', auth: authClient });
        this.maxResults = config.gmail.maxResults || 50;
    }

    /**
     * Fetch recent messages from inbox
     * @param {object} options - { query, maxResults, labelIds }
     * @returns {Array} Normalized email objects
     */
    async fetchMessages(options = {}) {
        const { query = 'is:inbox', maxResults = this.maxResults, labelIds } = options;

        const listParams = {
            userId: 'me',
            q: query,
            maxResults
        };
        if (labelIds) listParams.labelIds = labelIds;

        const res = await this.gmail.users.messages.list(listParams);
        const messageIds = res.data.messages || [];

        if (messageIds.length === 0) return [];

        // Fetch full message details in parallel (batch of 10)
        const messages = [];
        for (let i = 0; i < messageIds.length; i += 10) {
            const batch = messageIds.slice(i, i + 10);
            const details = await Promise.all(
                batch.map(m => this.getMessage(m.id))
            );
            messages.push(...details.filter(Boolean));
        }

        return messages;
    }

    /**
     * Fetch a single message by ID and normalize it
     * @param {string} messageId 
     * @returns {object} Normalized email object
     */
    async getMessage(messageId) {
        try {
            const res = await this.gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'metadata',
                metadataHeaders: ['From', 'To', 'Subject', 'Date', 'Message-ID', 'In-Reply-To', 'References']
            });

            return this.normalize(res.data);
        } catch (err) {
            console.warn(`⚠️  Failed to fetch message ${messageId}: ${err.message}`);
            return null;
        }
    }

    /**
     * Fetch full message body (for when we need content analysis)
     * @param {string} messageId 
     * @returns {object} Message with body text
     */
    async getFullMessage(messageId) {
        const res = await this.gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full'
        });

        const normalized = this.normalize(res.data);
        normalized.body = this.extractBody(res.data.payload);
        return normalized;
    }

    /**
     * Get thread messages
     * @param {string} threadId
     * @returns {Array} Thread messages in order
     */
    async getThread(threadId) {
        const res = await this.gmail.users.threads.get({
            userId: 'me',
            id: threadId,
            format: 'metadata',
            metadataHeaders: ['From', 'To', 'Subject', 'Date']
        });

        return (res.data.messages || []).map(m => this.normalize(m));
    }

    /**
     * Send an email
     * @param {object} email - { to, subject, body, replyTo }
     */
    async send({ to, subject, body, replyTo }) {
        const headers = [
            `To: ${to}`,
            `Subject: ${subject}`,
            `Content-Type: text/plain; charset=utf-8`
        ];
        if (replyTo) {
            headers.push(`In-Reply-To: ${replyTo}`);
            headers.push(`References: ${replyTo}`);
        }

        const raw = Buffer.from(
            headers.join('\r\n') + '\r\n\r\n' + body
        ).toString('base64url');

        const res = await this.gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw }
        });

        return res.data;
    }

    /**
     * Normalize a Gmail API message into a clean object
     */
    normalize(message) {
        const headers = {};
        for (const h of (message.payload?.headers || [])) {
            headers[h.name.toLowerCase()] = h.value;
        }

        return {
            id: message.id,
            threadId: message.threadId,
            labelIds: message.labelIds || [],
            snippet: message.snippet || '',
            from: this.parseAddress(headers.from || ''),
            to: this.parseAddress(headers.to || ''),
            subject: headers.subject || '(no subject)',
            date: headers.date ? new Date(headers.date).toISOString() : null,
            messageId: headers['message-id'] || null,
            inReplyTo: headers['in-reply-to'] || null,
            references: headers.references || null,
            isUnread: (message.labelIds || []).includes('UNREAD'),
            isStarred: (message.labelIds || []).includes('STARRED'),
            isImportant: (message.labelIds || []).includes('IMPORTANT'),
            sizeEstimate: message.sizeEstimate || 0
        };
    }

    /**
     * Parse an email address string into { name, email }
     */
    parseAddress(address) {
        const match = address.match(/^(.+?)\s*<(.+?)>$/);
        if (match) {
            return { name: match[1].replace(/"/g, '').trim(), email: match[2] };
        }
        return { name: '', email: address.trim() };
    }

    /**
     * Extract plain text body from message payload
     */
    extractBody(payload) {
        if (!payload) return '';

        // Simple text/plain
        if (payload.mimeType === 'text/plain' && payload.body?.data) {
            return Buffer.from(payload.body.data, 'base64').toString('utf8');
        }

        // Multipart — recurse into parts
        if (payload.parts) {
            for (const part of payload.parts) {
                const body = this.extractBody(part);
                if (body) return body;
            }
        }

        return '';
    }
}

export { GmailClient };
export default GmailClient;
