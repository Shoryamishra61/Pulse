/**
 * PULSE CRM — State Machine Adversarial Tests
 * 
 * These tests prove that our architectural claims about out-of-order
 * event handling are factual, not aspirational.
 * 
 * Scenarios tested:
 * 1. Normal forward progression
 * 2. Out-of-order: "clicked" arriving before "delivered"
 * 3. Duplicate event IDs (idempotency)
 * 4. Terminal state lockout (no transitions from "failed")
 * 5. Double-jump promotion (created → clicked, skipping middle states)
 * 6. Late "delivered" after "converted" (must not regress)
 * 
 * Run: npx tsx src/__tests__/state-machine.test.ts
 */

import {
  evaluateTransition,
  STATE_SEQUENCE,
  TERMINAL_STATES,
  VALID_TRANSITIONS,
} from '../lib/services/state-machine';

// ─── Test Harness ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ ${testName}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n─── ${name} ───`);
  fn();
}

// Helper: evaluateTransition uses (currentState, currentSequence, incomingEvent)
// We need to track state + sequence across transitions
function transition(currentState: string, incomingEvent: string) {
  const currentSeq = STATE_SEQUENCE[currentState] ?? 0;
  return evaluateTransition(currentState, currentSeq, incomingEvent);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Normal Forward Progression', () => {
  const r1 = transition('created', 'enqueued');
  assert(r1.promoted === true, 'created → enqueued promotes');
  assert(r1.toState === 'enqueued', 'new state is enqueued');

  const r2 = transition('enqueued', 'dispatched');
  assert(r2.promoted === true, 'enqueued → dispatched promotes');

  const r3 = transition('dispatched', 'sent_to_channel');
  assert(r3.promoted === true, 'dispatched → sent_to_channel promotes');

  const r4 = transition('sent_to_channel', 'delivered');
  assert(r4.promoted === true, 'sent_to_channel → delivered promotes');

  const r5 = transition('delivered', 'opened');
  assert(r5.promoted === true, 'delivered → opened promotes');

  const r6 = transition('opened', 'clicked');
  assert(r6.promoted === true, 'opened → clicked promotes');

  const r7 = transition('clicked', 'converted');
  assert(r7.promoted === true, 'clicked → converted promotes');
});

describe('Out-of-Order: "clicked" before "delivered"', () => {
  // Network jitter: clicked (seq=6) arrives while state is sent_to_channel (seq=3)
  const r1 = transition('sent_to_channel', 'clicked');
  assert(r1.promoted === true, 'sent_to_channel → clicked promotes (seq 3→6)');
  assert(r1.toState === 'clicked', 'state advances to clicked');

  // Late "delivered" (seq=4) arrives but state is already "clicked" (seq=6)
  const r2 = transition('clicked', 'delivered');
  assert(r2.promoted === false, 'clicked → delivered does NOT promote (seq 6→4 rejected)');
  assert(r2.toState === 'clicked', 'state remains clicked');
});

describe('Out-of-Order: "opened" before "delivered"', () => {
  const r1 = transition('sent_to_channel', 'opened');
  assert(r1.promoted === true, 'sent_to_channel → opened promotes (seq 3→5)');
  
  const r2 = transition('opened', 'delivered');
  assert(r2.promoted === false, 'opened → delivered does NOT regress state (seq 5→4)');
});

describe('Duplicate Events (Idempotency at State Level)', () => {
  const r = transition('delivered', 'delivered');
  assert(r.promoted === false, 'delivered → delivered does NOT promote (same seq)');
  assert(r.toState === 'delivered', 'state unchanged');
});

describe('Terminal State Lockout', () => {
  const r1 = transition('failed', 'delivered');
  assert(r1.promoted === false, 'failed → delivered rejected (terminal state)');
  assert(r1.toState === 'failed', 'state remains failed');

  const r2 = transition('bounced', 'opened');
  assert(r2.promoted === false, 'bounced → opened rejected (terminal state)');

  const r3 = transition('converted', 'clicked');
  assert(r3.promoted === false, 'converted → clicked rejected (terminal state)');

  const r4 = transition('complained', 'converted');
  assert(r4.promoted === false, 'complained → converted rejected (terminal state)');
});

describe('Double-Jump Promotion', () => {
  // created (seq=0) directly to delivered (seq=4) — skipping middle states
  const r = transition('created', 'delivered');
  assert(r.promoted === true, 'created → delivered promotes (seq 0→4, forward jump)');
  assert(r.toState === 'delivered', 'state advances to delivered');
});

describe('Late "delivered" After "converted"', () => {
  const r = transition('converted', 'delivered');
  assert(r.promoted === false, 'converted → delivered does NOT regress (seq 7→4)');
  assert(r.toState === 'converted', 'state remains converted');
});

describe('Extreme: "converted" arriving at "created"', () => {
  // Extremely out-of-order: final state arrives first
  const r = transition('created', 'converted');
  assert(r.promoted === true, 'created → converted promotes (seq 0→7)');
  assert(r.toState === 'converted', 'state jumps to converted');
  
  // Now nothing can change it
  const r2 = transition('converted', 'delivered');
  assert(r2.promoted === false, 'converted → delivered blocked (terminal)');
  const r3 = transition('converted', 'opened');
  assert(r3.promoted === false, 'converted → opened blocked (terminal)');
});

describe('Sequence Number Integrity', () => {
  assert(STATE_SEQUENCE['created'] < STATE_SEQUENCE['enqueued'], 'created < enqueued');
  assert(STATE_SEQUENCE['enqueued'] < STATE_SEQUENCE['dispatched'], 'enqueued < dispatched');
  assert(STATE_SEQUENCE['dispatched'] < STATE_SEQUENCE['sent_to_channel'], 'dispatched < sent_to_channel');
  assert(STATE_SEQUENCE['delivered'] < STATE_SEQUENCE['opened'], 'delivered < opened');
  assert(STATE_SEQUENCE['opened'] < STATE_SEQUENCE['clicked'], 'opened < clicked');
  assert(STATE_SEQUENCE['clicked'] < STATE_SEQUENCE['converted'], 'clicked < converted');
  assert(STATE_SEQUENCE['failed'] === STATE_SEQUENCE['delivered'], 'failed == delivered (terminal branch)');
  assert(STATE_SEQUENCE['bounced'] === STATE_SEQUENCE['delivered'], 'bounced == delivered (terminal branch)');
});

describe('Valid Transitions Table', () => {
  assert(TERMINAL_STATES.has('failed'), 'failed is terminal');
  assert(TERMINAL_STATES.has('bounced'), 'bounced is terminal');
  assert(TERMINAL_STATES.has('converted'), 'converted is terminal');
  assert(TERMINAL_STATES.has('complained'), 'complained is terminal');
  assert(!TERMINAL_STATES.has('delivered'), 'delivered is NOT terminal');
  assert(!TERMINAL_STATES.has('opened'), 'opened is NOT terminal');
  assert(VALID_TRANSITIONS['failed'].length === 0, 'failed has no valid transitions');
  assert(VALID_TRANSITIONS['converted'].length === 0, 'converted has no valid transitions');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'═'.repeat(50)}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n  All state machine invariants verified. ✓\n');
}
