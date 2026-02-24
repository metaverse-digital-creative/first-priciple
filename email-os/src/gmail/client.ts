/**
 * Gmail API Client — Wrapper for fetching and sending email
 */

import { google, type gmail_v1 } from 'googleapis';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { OAuth2Client } from 'google-auth-library';
import type { Email, EmailAddress } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

interface NormalizedEmail extends Email {
    messageId: string | null;
    references: string | null;
    isUnread: boolean;
    sizeEstimate: number;
    to: EmailAddress;
}

interface FetchOptions {
    query?: string;
    maxResults?: number;
    labelIds?: string[];
}

interface SendOptions {
    to: string;
    subject: string;
    body: string;
    replyTo?: string;
}

class GmailClient {
    private gmail: gmail_v1.Gmail;
    private maxResults: number;

    constructor(authClient: OAuth2Client) {
        this.gmail = google.gmail({ version: 'v1', auth: authClient });
        this.maxResults = config.gmail.maxResults || 50;
    }

    async fetchMessages(options: FetchOptions = {}): Promise<NormalizedEmail[]> {
        const { query = 'is:inbox', maxResults = this.maxResults, labelIds } = options;

        const listParams: gmail_v1.Params$Resource$Users$Messages$List = {
            userId: 'me', q: query, maxResults
        };
        if (labelIds) listParams.labelIds = labelIds;

        const res = await this.gmail.users.messages.list(listParams);
        const messageIds = res.data.messages || [];

        if (messageIds.length === 0) return [];

        const messages: NormalizedEmail[] = [];
        for (let i = 0; i < messageIds.length; i += 10) {
            const batch = messageIds.slice(i, i + 10);
            const details = await Promise.all(
                batch.map(m => this.getMessage(m.id!))
            );
            messages.push(...details.filter((d): d is NormalizedEmail => d !== null));
        }

        return messages;
    }

    async getMessage(messageId: string): Promise<NormalizedEmail | null> {
        try {
            const res = await this.gmail.users.messages.get({
                userId: 'me', id: messageId, format: 'metadata',
                metadataHeaders: ['From', 'To', 'Subject', 'Date', 'Message-ID', 'In-Reply-To', 'References']
            });
            return this.normalize(res.data);
        } catch (err) {
            console.warn(`⚠️  Failed to fetch message ${messageId}: ${(err as Error).message}`);
            return null;
        }
    }

    async getFullMessage(messageId: string): Promise<NormalizedEmail> {
        const res = await this.gmail.users.messages.get({
            userId: 'me', id: messageId, format: 'full'
        });
        const normalized = this.normalize(res.data);
        normalized.body = this.extractBody(res.data.payload);
        return normalized;
    }

    async getThread(threadId: string): Promise<NormalizedEmail[]> {
        const res = await this.gmail.users.threads.get({
            userId: 'me', id: threadId, format: 'metadata',
            metadataHeaders: ['From', 'To', 'Subject', 'Date']
        });
        return (res.data.messages || []).map(m => this.normalize(m));
    }

    async send({ to, subject, body, replyTo }: SendOptions): Promise<gmail_v1.Schema$Message> {
        const headers = [
            `To: ${to}`, `Subject: ${subject}`,
            `Content-Type: text/plain; charset=utf-8`
        ];
        if (replyTo) {
            headers.push(`In-Reply-To: ${replyTo}`, `References: ${replyTo}`);
        }

        const raw = Buffer.from(
            headers.join('\r\n') + '\r\n\r\n' + body
        ).toString('base64url');

        const res = await this.gmail.users.messages.send({
            userId: 'me', requestBody: { raw }
        });

        return res.data;
    }

    normalize(message: gmail_v1.Schema$Message): NormalizedEmail {
        const headers: Record<string, string> = {};
        for (const h of (message.payload?.headers || [])) {
            if (h.name && h.value) headers[h.name.toLowerCase()] = h.value;
        }

        return {
            id: message.id || '',
            threadId: message.threadId || '',
            labelIds: message.labelIds || [],
            snippet: message.snippet || '',
            from: this.parseAddress(headers.from || ''),
            to: this.parseAddress(headers.to || ''),
            subject: headers.subject || '(no subject)',
            date: headers.date ? new Date(headers.date).toISOString() : undefined,
            messageId: headers['message-id'] || null,
            inReplyTo: headers['in-reply-to'] || undefined,
            references: headers.references || null,
            isUnread: (message.labelIds || []).includes('UNREAD'),
            isStarred: (message.labelIds || []).includes('STARRED'),
            isImportant: (message.labelIds || []).includes('IMPORTANT'),
            sizeEstimate: message.sizeEstimate || 0
        };
    }

    parseAddress(address: string): EmailAddress {
        const match = address.match(/^(.+?)\s*<(.+?)>$/);
        if (match) {
            return { name: match[1].replace(/"/g, '').trim(), email: match[2] };
        }
        return { name: '', email: address.trim() };
    }

    extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
        if (!payload) return '';

        if (payload.mimeType === 'text/plain' && payload.body?.data) {
            return Buffer.from(payload.body.data, 'base64').toString('utf8');
        }

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
