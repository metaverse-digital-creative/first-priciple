/**
 * Email-OS — Shared Type Definitions
 *
 * All interfaces used across agents, bus, and scripts.
 * JSON-first approach: types match JSON file structure.
 */

// ═══════════════════════════════════════
// Email
// ═══════════════════════════════════════

export interface EmailAddress {
    email: string;
    name: string;
}

export interface Email {
    id: string;
    threadId: string;
    from?: EmailAddress;
    subject?: string;
    snippet?: string;
    body?: string;
    labelIds?: string[];
    labels?: string[];
    isImportant?: boolean;
    isStarred?: boolean;
    inReplyTo?: string;
    date?: string;
}

// ═══════════════════════════════════════
// Classification
// ═══════════════════════════════════════

export type Zone = 'red' | 'yellow' | 'green';
export type ClassifyMethod = 'keyword' | 'llm' | 'fallback';

export interface Signal {
    type: string;
    level?: string;
    keyword?: string;
    weight?: number;
    source?: string;
}

export interface Classification {
    emailId: string;
    threadId?: string;
    zone: Zone;
    score: number;
    confidence: number;
    signals: Signal[];
    reasoning: string;
    method: ClassifyMethod;
    timestamp: string;
}

export interface ClassifiedEmail {
    email: Email;
    classification: Classification;
}

export interface ClassifyResults {
    red: ClassifiedEmail[];
    yellow: ClassifiedEmail[];
    green: ClassifiedEmail[];
}

// ═══════════════════════════════════════
// Seed
// ═══════════════════════════════════════

export type SeedType = 'decision-needed' | 'opportunity' | 'follow-up' | 'relationship-build';
export type SeedStatus = 'planted' | 'harvested' | 'expired';

export interface SeedOutcome {
    action?: string;
    result?: string;
    notes?: string;
}

export interface Seed {
    id: string;
    type: SeedType;
    status: SeedStatus;
    emailId: string;
    threadId?: string;
    sourceFrom: string;
    sourceSubject: string;
    zone: Zone;
    score?: number;
    shelfLife: string;
    plantedAt: string;
    expiresAt: string;
    escalated: boolean;
    harvestedAt?: string | null;
    outcome?: SeedOutcome | null;
    notes?: string;
}

export interface SeedStats {
    total: number;
    active: number;
    harvested: number;
    escalated: number;
    byType: Record<string, number>;
}

// ═══════════════════════════════════════
// Suggestion
// ═══════════════════════════════════════

export interface Action {
    type: string;
    label: string;
    urgency?: string;
    reason: string;
}

export interface ResponseDraft {
    type: string;
    template: string;
    editable: boolean;
}

export interface Suggestion {
    emailId: string;
    threadId?: string;
    zone: Zone;
    actions: Action[];
    responseDraft: ResponseDraft | null;
    priority: number;
    timestamp: string;
}

// ═══════════════════════════════════════
// Thread / Insight
// ═══════════════════════════════════════

export type Trajectory = 'heating' | 'cooling' | 'steady' | 'new';
export type InsightType = 'velocity-spike' | 'hot-thread' | 'multi-party' | 'temperature-change' | 'dormant-revival' | 'zone-escalation';
export type Severity = 'info' | 'warning' | 'critical';

export interface ThreadMessage {
    id: string;
    from?: string;
    zone: Zone;
    date: string;
}

export interface Thread {
    threadId: string;
    subject: string;
    participants: Set<string> | string[];
    messages: ThreadMessage[];
    zones: Zone[];
    participantCount: number;
    messageCount: number;
    velocity: number;
    temperature: number;
    trajectory: Trajectory;
    firstMessageAt: string;
    lastMessageAt: string;
}

export interface Insight {
    threadId: string;
    type: InsightType | string;
    message: string;
    severity: Severity;
    data?: Record<string, unknown>;
    createdAt: string;
}

// ═══════════════════════════════════════
// Mirror / Review
// ═══════════════════════════════════════

export interface Feedback {
    type: string;
    message: string;
    actionable: boolean;
}

export interface Evolution {
    cycle: number;
    timestamp: string;
    feedbackPatterns: Record<string, number>;
    recommendations: Array<{
        priority: string;
        message: string;
        actionable?: boolean;
    }>;
}

export interface Review {
    agent: string;
    cycleNumber?: number;
    sampleSize?: number;
    timestamp: string;
    scores: Record<string, unknown>;
    feedback: Feedback[];
    evolution?: Evolution | null;
}

export interface ReviewHistory {
    reviews: Review[];
    evolutions: Evolution[];
    totalCycles: number;
}

// ═══════════════════════════════════════
// Bus
// ═══════════════════════════════════════

export interface BusEvent<T = unknown> {
    agent: string;
    type: string;
    data: T;
    timestamp: string;
}

export type BusHandler<T = unknown> = (event: BusEvent<T>) => void;

// ═══════════════════════════════════════
// LLM
// ═══════════════════════════════════════

export interface LLMProvider {
    name: string;
    generate(prompt: string, options?: LLMOptions): Promise<string>;
    classify?(text: string, categories: string[]): Promise<string>;
}

export interface LLMOptions {
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
}

// ═══════════════════════════════════════
// Config
// ═══════════════════════════════════════

export interface AgentConfig {
    confidenceThreshold?: number;
    batchSize?: number;
    maxSuggestions?: number;
    reviewCycle?: number;
}

export interface SeedConfig {
    shelfLife: Record<SeedType, string>;
}

export interface AppConfig {
    gmail: {
        scopes: string[];
        tokenPath: string;
        credentialsPath: string;
    };
    agents: {
        ingest: AgentConfig;
        classify: AgentConfig;
        seed: AgentConfig;
        suggest: AgentConfig;
        insight: AgentConfig;
        mirror: AgentConfig;
    };
    seeds: SeedConfig;
}

// ═══════════════════════════════════════
// Tunnel
// ═══════════════════════════════════════

export interface TunnelResponse {
    reply?: string;
    error?: string;
}

export interface AnalysisCache {
    emails: Email[];
    classified?: ClassifyResults;
    stats?: {
        red: number;
        yellow: number;
        green: number;
        total: number;
    };
}
