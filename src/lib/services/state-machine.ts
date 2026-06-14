/**
 * PULSE CRM — Unidirectional Communication State Machine
 * 
 * This is the core defense against out-of-order webhook events.
 * 
 * Architecture Decision: MONOTONIC STATE PROMOTION
 * 
 * Each message state maps to a sequence integer. When a webhook event arrives:
 * 1. Look up the incoming event's sequence number
 * 2. Compare against the message's current sequence number
 * 3. If incoming > current → PROMOTE state (update status + sequence)
 * 4. If incoming <= current → ACCEPT event (log it) but DON'T change state
 * 
 * This ensures that if "clicked" (seq=6) arrives before "delivered" (seq=4),
 * the state correctly advances to "clicked". When "delivered" arrives later,
 * it is recorded in the event log but doesn't regress the state.
 * 
 * Reference: "Resolving Out-of-Order Events" — Unidirectional State Machine pattern
 */

// ─── State Sequence Mapping ─────────────────────────────────────────────────
// Integer values define the "advancement" level of each state.
// State can only move to a HIGHER integer (monotonic promotion).

export const STATE_SEQUENCE: Record<string, number> = {
  created: 0,
  enqueued: 1,
  dispatched: 2,
  sent_to_channel: 3,
  delivered: 4,
  failed: 4,             // Terminal branch — same level as delivered
  bounced: 4,            // Terminal branch — same level as delivered
  opened: 5,
  read: 5,
  complained: 5,         // Terminal branch — same level as opened
  clicked: 6,
  converted: 7,
  permanently_failed: 8, // DLQ terminal state — highest to prevent further changes
};

// ─── Terminal States ─────────────────────────────────────────────────────────
// No further transitions allowed from these states

export const TERMINAL_STATES = new Set([
  'failed',
  'bounced',
  'converted',
  'complained',
  'permanently_failed',
]);

// ─── Valid Transition Table ──────────────────────────────────────────────────
// Defines which state transitions are semantically valid.
// Even if the sequence check passes, the transition must be in this table.

export const VALID_TRANSITIONS: Record<string, string[]> = {
  created:           ['enqueued', 'failed'],
  enqueued:          ['dispatched', 'failed'],
  dispatched:        ['sent_to_channel', 'failed'],
  sent_to_channel:   ['delivered', 'failed', 'bounced'],
  delivered:         ['opened', 'read', 'clicked', 'converted', 'complained'],
  opened:            ['clicked', 'converted', 'complained'],
  read:              ['clicked', 'converted', 'complained'],
  clicked:           ['converted', 'complained'],
  // Terminal states have no valid transitions
  failed:            [],
  bounced:           [],
  converted:         [],
  complained:        [],
  permanently_failed:[],
};

function hasValidForwardPath(fromState: string, toState: string, visited = new Set<string>()): boolean {
  if (fromState === toState) return true;
  if (visited.has(fromState)) return false;
  visited.add(fromState);

  const nextStates = VALID_TRANSITIONS[fromState] || [];
  return nextStates.some((nextState) => hasValidForwardPath(nextState, toState, visited));
}

// ─── Transition Result ───────────────────────────────────────────────────────

export interface TransitionResult {
  /** Whether the state was actually changed */
  promoted: boolean;
  /** The previous state */
  fromState: string;
  /** The new state (or current if not promoted) */
  toState: string;
  /** The previous sequence number */
  fromSequence: number;
  /** The new sequence number */
  toSequence: number;
  /** Whether the event was accepted (always true if valid) */
  accepted: boolean;
  /** Reason if not promoted */
  reason?: string;
  /** Whether this was an out-of-order event that was accepted but didn't change state */
  outOfOrder: boolean;
}

// ─── State Machine ───────────────────────────────────────────────────────────

/**
 * Evaluates whether a state transition should occur.
 * 
 * This function is PURE — it has no side effects and doesn't touch the database.
 * The caller is responsible for applying the transition atomically.
 * 
 * @param currentState - The message's current state
 * @param currentSequence - The message's current sequence number
 * @param incomingEvent - The webhook event type (e.g., "delivered", "clicked")
 * @returns TransitionResult describing what should happen
 */
export function evaluateTransition(
  currentState: string,
  currentSequence: number,
  incomingEvent: string,
): TransitionResult {
  const incomingSequence = STATE_SEQUENCE[incomingEvent];

  // Unknown event type
  if (incomingSequence === undefined) {
    return {
      promoted: false,
      fromState: currentState,
      toState: currentState,
      fromSequence: currentSequence,
      toSequence: currentSequence,
      accepted: false,
      reason: `Unknown event type: ${incomingEvent}`,
      outOfOrder: false,
    };
  }

  // Already in terminal state — accept event for audit but don't change
  if (TERMINAL_STATES.has(currentState)) {
    return {
      promoted: false,
      fromState: currentState,
      toState: currentState,
      fromSequence: currentSequence,
      toSequence: currentSequence,
      accepted: true,
      reason: `Already in terminal state: ${currentState}`,
      outOfOrder: false,
    };
  }

  // MONOTONIC PROMOTION CHECK
  // If incoming sequence > current sequence → promote
  if (incomingSequence > currentSequence) {
    if (!hasValidForwardPath(currentState, incomingEvent)) {
      return {
        promoted: false,
        fromState: currentState,
        toState: currentState,
        fromSequence: currentSequence,
        toSequence: currentSequence,
        accepted: false,
        reason: `Invalid transition: ${currentState} → ${incomingEvent}`,
        outOfOrder: false,
      };
    }

    return {
      promoted: true,
      fromState: currentState,
      toState: incomingEvent,
      fromSequence: currentSequence,
      toSequence: incomingSequence,
      accepted: true,
      outOfOrder: false,
    };
  }

  // Incoming sequence <= current sequence → out-of-order event
  // Accept it (for the event log) but DON'T change state
  return {
    promoted: false,
    fromState: currentState,
    toState: currentState,
    fromSequence: currentSequence,
    toSequence: currentSequence,
    accepted: true,
    reason: `Out-of-order event: ${incomingEvent} (seq=${incomingSequence}) arrived after ${currentState} (seq=${currentSequence})`,
    outOfOrder: true,
  };
}

/**
 * Maps a webhook event type to the canonical state name.
 * Channel services may use different event names — this normalizes them.
 */
export function normalizeEventType(rawEventType: string): string {
  const mapping: Record<string, string> = {
    // Standard names
    delivered: 'delivered',
    opened: 'opened',
    clicked: 'clicked',
    converted: 'converted',
    failed: 'failed',
    bounced: 'bounced',
    complained: 'complained',

    // Common variations from different providers
    read: 'read',
    open: 'opened',
    click: 'clicked',
    bounce: 'bounced',
    complaint: 'complained',
    spam: 'complained',
    unsubscribe: 'complained',
    hard_bounce: 'bounced',
    soft_bounce: 'failed',
    deferred: 'failed',
    dropped: 'failed',
    rejected: 'failed',
    conversion: 'converted',
    purchase: 'converted',
  };

  return mapping[rawEventType.toLowerCase()] || rawEventType.toLowerCase();
}

/**
 * Gets the timestamp field name for a given state.
 * Used to update the canonical log line timestamps.
 */
export function getTimestampField(state: string): string | null {
  const mapping: Record<string, string> = {
    enqueued: 'enqueuedAt',
    dispatched: 'dispatchedAt',
    sent_to_channel: 'sentAt',
    delivered: 'deliveredAt',
    opened: 'openedAt',
    read: 'readAt',
    clicked: 'clickedAt',
    converted: 'convertedAt',
    failed: 'failedAt',
    bounced: 'bouncedAt',
  };

  return mapping[state] || null;
}
