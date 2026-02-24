/**
 * Insight Bus — Event-Driven Agent Coordination Layer
 *
 * Pattern: Every agent publishes events. Any agent can subscribe.
 * The bus is the nervous system. Agents are organs.
 */

import type { BusEvent, BusHandler } from './types.js';

interface BusMessage extends BusEvent {
    id: number;
}

class InsightBus {
    private events: BusMessage[] = [];
    private subscribers: Map<string, BusHandler[]> = new Map();
    private counter: number = 0;
    private maxHistory: number = 1000;

    /**
     * Publish an event to the bus
     */
    publish<T = unknown>(agent: string, type: string, data: T): BusMessage {
        const event: BusMessage = {
            id: ++this.counter,
            agent,
            type,
            data,
            timestamp: new Date().toISOString()
        };

        this.events.push(event);
        if (this.events.length > this.maxHistory) {
            this.events = this.events.slice(-this.maxHistory);
        }

        // Notify subscribers
        const handlers = this.subscribers.get(type) || [];
        const wildcardHandlers = this.subscribers.get('*') || [];

        for (const handler of [...handlers, ...wildcardHandlers]) {
            try {
                handler(event);
            } catch (err) {
                console.error(`Bus handler error [${type}]:`, err);
            }
        }

        return event;
    }

    /**
     * Subscribe to events by type
     */
    subscribe(type: string, handler: BusHandler): () => void {
        if (!this.subscribers.has(type)) {
            this.subscribers.set(type, []);
        }
        this.subscribers.get(type)!.push(handler);

        // Return unsubscribe function
        return () => {
            const handlers = this.subscribers.get(type);
            if (handlers) {
                const idx = handlers.indexOf(handler);
                if (idx !== -1) handlers.splice(idx, 1);
            }
        };
    }

    /**
     * Get recent events, optionally filtered
     */
    getRecent(options: { agent?: string; type?: string; limit?: number } = {}): BusMessage[] {
        let filtered = this.events;
        if (options.agent) filtered = filtered.filter(e => e.agent === options.agent);
        if (options.type) filtered = filtered.filter(e => e.type === options.type);
        return filtered.slice(-(options.limit || 50));
    }

    /**
     * Get all events for a specific agent
     */
    getAgentEvents(agent: string): BusMessage[] {
        return this.events.filter(e => e.agent === agent);
    }

    /**
     * Clear all events
     */
    clear(): void {
        this.events = [];
        this.counter = 0;
    }

    /**
     * Get bus stats
     */
    getStats(): { totalEvents: number; subscriberCount: number; agents: string[] } {
        const agents = [...new Set(this.events.map(e => e.agent))];
        let subscriberCount = 0;
        for (const handlers of this.subscribers.values()) {
            subscriberCount += handlers.length;
        }
        return { totalEvents: this.events.length, subscriberCount, agents };
    }
}

const bus = new InsightBus();
export { InsightBus };
export default bus;
