/**
 * State Machine — Resilient flow control with graceful fallback
 * 
 * Pattern: state-machine-resilience (keynote-studio → email-os)
 * Rule: Never let a failure break the entire flow. Always have a
 *       degraded-but-functional path.
 * 
 * States: IDLE → SYNCING → PROCESSING → SUGGESTING → COMPLETE → ERROR
 */

import bus from './bus.js';

const STATES = {
    IDLE: 'IDLE',
    SYNCING: 'SYNCING',
    PROCESSING: 'PROCESSING',
    SUGGESTING: 'SUGGESTING',
    COMPLETE: 'COMPLETE',
    ERROR: 'ERROR'
};

const TRANSITIONS = {
    [STATES.IDLE]: [STATES.SYNCING],
    [STATES.SYNCING]: [STATES.PROCESSING, STATES.ERROR],
    [STATES.PROCESSING]: [STATES.SUGGESTING, STATES.ERROR],
    [STATES.SUGGESTING]: [STATES.COMPLETE, STATES.ERROR],
    [STATES.COMPLETE]: [STATES.IDLE],
    [STATES.ERROR]: [STATES.IDLE]  // Always recoverable
};

class StateMachine {
    constructor() {
        this.state = STATES.IDLE;
        this.history = [];
        this.errorCount = 0;
        this.lastError = null;
        this.startTime = null;
    }

    /**
     * Transition to a new state
     * @param {string} newState - Target state
     * @param {object} meta - Optional metadata about the transition
     * @returns {boolean} Whether transition succeeded
     */
    transition(newState, meta = {}) {
        const allowed = TRANSITIONS[this.state];

        if (!allowed || !allowed.includes(newState)) {
            console.warn(`⚠️  Invalid transition: ${this.state} → ${newState}`);
            bus.publish('state', 'state.invalid_transition', {
                from: this.state,
                to: newState,
                meta
            });
            return false;
        }

        const prev = this.state;
        this.state = newState;

        this.history.push({
            from: prev,
            to: newState,
            timestamp: new Date().toISOString(),
            meta
        });

        // Track timing
        if (newState === STATES.SYNCING) {
            this.startTime = Date.now();
        }

        // Track errors
        if (newState === STATES.ERROR) {
            this.errorCount++;
            this.lastError = meta.error || 'Unknown error';
        }

        bus.publish('state', 'state.transition', {
            from: prev,
            to: newState,
            meta,
            errorCount: this.errorCount
        });

        return true;
    }

    /**
     * Get elapsed time since sync started
     */
    elapsed() {
        if (!this.startTime) return 0;
        return Date.now() - this.startTime;
    }

    /**
     * Check if in a specific state
     */
    is(state) {
        return this.state === state;
    }

    /**
     * Force reset to IDLE (emergency recovery)
     */
    reset() {
        const prev = this.state;
        this.state = STATES.IDLE;
        this.startTime = null;
        bus.publish('state', 'state.reset', { from: prev });
    }

    /**
     * Get state summary
     */
    summary() {
        return {
            current: this.state,
            errorCount: this.errorCount,
            lastError: this.lastError,
            elapsedMs: this.elapsed(),
            transitionCount: this.history.length
        };
    }
}

const stateMachine = new StateMachine();

export { StateMachine, STATES, TRANSITIONS, stateMachine };
export default stateMachine;
