/**
 * Email-OS Database Schema — Drizzle ORM + PostgreSQL
 * 
 * 7 tables covering all agent data:
 *   emails, classifications, seeds, suggestions, threads, insights, reviews
 * 
 * Pattern: Each agent reads/writes through drizzle queries.
 * JSON file storage is replaced entirely.
 */

import {
    pgTable, text, integer, real, boolean, timestamp, jsonb,
    serial, varchar, index, uniqueIndex
} from 'drizzle-orm/pg-core';

// ===========================
// 1. Emails (Ingest Agent)
// ===========================
export const emails = pgTable('emails', {
    id: text('id').primaryKey(),                           // Gmail message ID
    threadId: text('thread_id').notNull(),
    fromEmail: text('from_email'),
    fromName: text('from_name'),
    subject: text('subject'),
    snippet: text('snippet'),
    body: text('body'),
    labels: jsonb('labels').$type(),                       // string[]
    isImportant: boolean('is_important').default(false),
    isStarred: boolean('is_starred').default(false),
    inReplyTo: text('in_reply_to'),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow(),
}, (table) => [
    index('idx_emails_thread').on(table.threadId),
    index('idx_emails_received').on(table.receivedAt),
]);

// ===========================
// 2. Classifications (Classify Agent)
// ===========================
export const classifications = pgTable('classifications', {
    id: serial('id').primaryKey(),
    emailId: text('email_id').notNull().references(() => emails.id),
    threadId: text('thread_id'),
    zone: varchar('zone', { length: 10 }).notNull(),       // 'red' | 'yellow' | 'green'
    score: integer('score').notNull(),                      // 0-100
    confidence: real('confidence').notNull(),               // 0.0-1.0
    method: varchar('method', { length: 20 }).notNull(),    // 'keyword' | 'llm' | 'fallback'
    signals: jsonb('signals').$type(),                      // Signal[]
    reasoning: text('reasoning'),
    classifiedAt: timestamp('classified_at', { withTimezone: true }).defaultNow(),
}, (table) => [
    index('idx_classifications_email').on(table.emailId),
    index('idx_classifications_zone').on(table.zone),
]);

// ===========================
// 3. Seeds (Seed Agent)
// ===========================
export const seeds = pgTable('seeds', {
    id: text('id').primaryKey(),                            // e.g. 's1', 's2'
    emailId: text('email_id').references(() => emails.id),
    threadId: text('thread_id'),
    type: varchar('type', { length: 30 }).notNull(),        // 'decision-needed' | 'opportunity' | 'follow-up' | 'relationship-build'
    zone: varchar('zone', { length: 10 }).notNull(),
    score: integer('score'),
    status: varchar('status', { length: 20 }).notNull().default('planted'),  // 'planted' | 'harvested' | 'expired'
    shelfLife: varchar('shelf_life', { length: 10 }),       // '2h' | '1d' | '7d'
    escalated: boolean('escalated').default(false),
    sourceFrom: text('source_from'),                        // sender email
    sourceSubject: text('source_subject'),
    notes: text('notes'),
    outcome: jsonb('outcome').$type(),                      // { action, result, notes }
    plantedAt: timestamp('planted_at', { withTimezone: true }).defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    harvestedAt: timestamp('harvested_at', { withTimezone: true }),
}, (table) => [
    index('idx_seeds_status').on(table.status),
    index('idx_seeds_zone').on(table.zone),
    index('idx_seeds_expires').on(table.expiresAt),
]);

// ===========================
// 4. Suggestions (Suggest Agent)
// ===========================
export const suggestions = pgTable('suggestions', {
    id: serial('id').primaryKey(),
    emailId: text('email_id').notNull().references(() => emails.id),
    threadId: text('thread_id'),
    zone: varchar('zone', { length: 10 }).notNull(),
    actions: jsonb('actions').$type(),                      // Action[]
    responseDraft: jsonb('response_draft').$type(),         // { type, template, editable }
    priority: integer('priority').notNull().default(50),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
    index('idx_suggestions_email').on(table.emailId),
    index('idx_suggestions_priority').on(table.priority),
]);

// ===========================
// 5. Threads (Insight Agent)
// ===========================
export const threads = pgTable('threads', {
    threadId: text('thread_id').primaryKey(),
    subject: text('subject'),
    participantCount: integer('participant_count').default(0),
    messageCount: integer('message_count').default(0),
    velocity: real('velocity').default(0),                  // messages/day
    temperature: real('temperature').default(0),            // 0-100 engagement heat
    trajectory: varchar('trajectory', { length: 20 }),      // 'heating' | 'cooling' | 'steady' | 'new'
    zonesSeen: jsonb('zones_seen').$type(),                 // string[]
    participants: jsonb('participants').$type(),             // string[]
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    firstMessageAt: timestamp('first_message_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
    index('idx_threads_temperature').on(table.temperature),
    index('idx_threads_trajectory').on(table.trajectory),
]);

// ===========================
// 6. Insights (Insight Agent)
// ===========================
export const insights = pgTable('insights', {
    id: serial('id').primaryKey(),
    threadId: text('thread_id').references(() => threads.threadId),
    type: varchar('type', { length: 30 }).notNull(),        // 'velocity-spike' | 'temperature-change' | 'dormant-revival' | 'zone-escalation' | 'multi-party'
    message: text('message').notNull(),
    severity: varchar('severity', { length: 10 }).default('info'),  // 'info' | 'warning' | 'critical'
    data: jsonb('data').$type(),                            // extra context
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
    index('idx_insights_thread').on(table.threadId),
    index('idx_insights_type').on(table.type),
]);

// ===========================
// 7. Reviews (Mirror Agent)
// ===========================
export const reviews = pgTable('reviews', {
    id: serial('id').primaryKey(),
    agent: varchar('agent', { length: 20 }).notNull(),      // 'classify' | 'seed'
    cycleNumber: integer('cycle_number'),
    sampleSize: integer('sample_size'),
    scores: jsonb('scores').$type(),                        // agent-specific scores
    feedback: jsonb('feedback').$type(),                    // { type, message, actionable }[]
    evolution: jsonb('evolution').$type(),                  // evolution results if triggered
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
    index('idx_reviews_agent').on(table.agent),
]);
