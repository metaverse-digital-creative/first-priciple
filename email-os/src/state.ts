/**
 * State Machine — Resilient flow control with graceful fallback
 *
 * Pattern: state-machine-resilience (keynote-studio → email-os)
 * States: IDLE → SYNCING → PROCESSING → SUGGESTING → COMPLETE → ERROR
 */

import bus from './bus.js';

export enum State {
    IDLE = 'IDLE',
    SYNCING = 'SYNCING',
    PROCESSING = 'PROCESSING',
    SUGGESTING = 'SUGGESTING',
    COMPLETE = 'COMPLETE',
    ERROR = 'ERROR'
}

interface TransitionRecord {
    from: State;
    to: State;
    timestamp: string;
    meta: Record<string, unknown>;
}

const TRANSITIONS: Record<State, State[]> = {
    [State.IDLE]: [State.SYNCING],
    [State.SYNCING]: [State.PROCESSING, State.ERROR],
    [State.PROCESSING]: [State.SUGGESTING, State.ERROR],
    [State.SUGGESTING]: [State.COMPLETE, State.ERROR],
    [State.COMPLETE]: [State.IDLE],
    [State.ERROR]: [State.IDLE]
};

class StateMachine {
    state: State = State.IDLE;
    history: TransitionRecord[] = [];
    errorCount: number = 0;
    lastError: string | null = null;
    private startTime: number | null = null;

    transition(newState: State, meta: Record<string, unknown> = {}): boolean {
        const allowed = TRANSITIONS[this.state];

        if (!allowed || !allowed.includes(newState)) {
            console.warn(`⚠️  Invalid transition: ${this.state} → ${newState}`);
            bus.publish('state', 'state.invalid_transition', {
                from: this.state, to: newState, meta
            });
            return false;
        }

        const prev = this.state;
        this.state = newState;

        this.history.push({
            from: prev, to: newState,
            timestamp: new Date().toISOString(), meta
        });

        if (newState === State.SYNCING) this.startTime = Date.now();
        if (newState === State.ERROR) {
            this.errorCount++;
            this.lastError = (meta.error as string) || 'Unknown error';
        }

        bus.publish('state', 'state.transition', {
            from: prev, to: newState, meta, errorCount: this.errorCount
        });

        return true;
    }

    elapsed(): number {
        if (!this.startTime) return 0;
        return Date.now() - this.startTime;
    }

    is(state: State): boolean {
        return this.state === state;
    }

    reset(): void {
        const prev = this.state;
        this.state = State.IDLE;
        this.startTime = null;
        bus.publish('state', 'state.reset', { from: prev });
    }

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

export { StateMachine, TRANSITIONS, stateMachine };
export default stateMachine;
