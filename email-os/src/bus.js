/**
 * Insight Bus — Event-driven coordination layer for all agents
 * 
 * Pattern: insight-bus (franchise-os → email-os)
 * Rule: When multiple agents need to coordinate, use a shared event bus
 *       with standard message format. Never let agents call each other directly.
 * 
 * Message format: { source, event, payload, timestamp }
 */

import { EventEmitter } from 'node:events';

class InsightBus extends EventEmitter {
    constructor(config = {}) {
        super();
        this.retainEvents = config.retainEvents || 1000;
        this.eventLog = [];
        this.stats = {
            totalEvents: 0,
            bySource: {},
            byEvent: {}
        };
    }

    /**
     * Publish an event on the bus
     * @param {string} source - Agent name (ingest, classify, seed, suggest, insight, mirror)
     * @param {string} event - Event type (email.fetched, email.classified, seed.planted, etc.)
     * @param {object} payload - Event data
     */
    publish(source, event, payload = {}) {
        const message = {
            source,
            event,
            payload,
            timestamp: new Date().toISOString()
        };

        // Track stats
        this.stats.totalEvents++;
        this.stats.bySource[source] = (this.stats.bySource[source] || 0) + 1;
        this.stats.byEvent[event] = (this.stats.byEvent[event] || 0) + 1;

        // Retain log (ring buffer)
        this.eventLog.push(message);
        if (this.eventLog.length > this.retainEvents) {
            this.eventLog.shift();
        }

        // Emit to subscribers
        this.emit(event, message);
        this.emit('*', message); // Wildcard subscribers

        return message;
    }

    /**
     * Subscribe to a specific event
     * @param {string} event - Event to listen for (or '*' for all)
     * @param {function} handler - Callback receiving the message
     */
    subscribe(event, handler) {
        this.on(event, handler);
        return () => this.off(event, handler); // Return unsubscribe function
    }

    /**
     * Get recent events, optionally filtered
     * @param {object} filter - { source, event, limit }
     */
    getRecent(filter = {}) {
        let events = [...this.eventLog];

        if (filter.source) {
            events = events.filter(e => e.source === filter.source);
        }
        if (filter.event) {
            events = events.filter(e => e.event === filter.event);
        }

        const limit = filter.limit || 20;
        return events.slice(-limit);
    }

    /**
     * Get bus statistics
     */
    getStats() {
        return {
            ...this.stats,
            logSize: this.eventLog.length,
            oldestEvent: this.eventLog[0]?.timestamp || null,
            newestEvent: this.eventLog[this.eventLog.length - 1]?.timestamp || null
        };
    }

    /**
     * Reset the bus (for testing)
     */
    reset() {
        this.eventLog = [];
        this.stats = { totalEvents: 0, bySource: {}, byEvent: {} };
        this.removeAllListeners();
    }
}

// Singleton bus instance — all agents share one bus
const bus = new InsightBus();

export { InsightBus, bus };
export default bus;
