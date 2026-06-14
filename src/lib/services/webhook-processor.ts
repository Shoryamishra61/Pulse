/**
 * PULSE CRM — Webhook Processor Service
 * 
 * Implements three critical patterns:
 * 
 * 1. ACCEPT-THEN-QUEUE (Thundering Herd Prevention):
 *    The webhook endpoint validates the payload, drops it into an
 *    in-memory queue, and returns 200 OK immediately (<50ms).
 *    No business logic runs in the HTTP handler.
 *    Reference: "Thundering Herd Problem" prevention
 * 
 * 2. IDEMPOTENCY KEYS (Stripe Pattern):
 *    Every webhook event has a unique Event ID. Before processing,
 *    we check if this ID has been seen before.
 *    If duplicate → drop silently. If new → process.
 *    Reference: "Designing Idempotent API Endpoints for Payments at Stripe"
 * 
 * 3. MONOTONIC STATE PROMOTION:
 *    Uses the Unidirectional State Machine to handle out-of-order events.
 *    State only advances forward. Late events are logged but don't regress state.
 */

import {
  evaluateTransition,
  normalizeEventType,
  getTimestampField,
  STATE_SEQUENCE,
  type TransitionResult,
} from './state-machine';
import { revenueAttribution } from './revenue-attribution';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WebhookPayload {
  eventId: string;
  messageId: string;
  campaignId: string;
  eventType: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface ProcessingResult {
  accepted: boolean;
  duplicate: boolean;
  promoted: boolean;
  outOfOrder: boolean;
  messageId: string;
  eventType: string;
  fromState?: string;
  toState?: string;
  reason?: string;
}

// ─── In-Memory Idempotency Cache ─────────────────────────────────────────────
// In production, this would be Redis with TTL=72 hours.
// Using in-memory Map for demo portability (no Redis dependency required).

class IdempotencyCache {
  private cache: Map<string, number> = new Map();
  private readonly maxSize: number = 100000;
  private readonly ttlMs: number = 72 * 60 * 60 * 1000; // 72 hours

  /**
   * Check if an event ID has been processed before.
   * Returns true if this is a DUPLICATE (should be dropped).
   */
  isDuplicate(eventId: string): boolean {
    const existing = this.cache.get(eventId);
    if (existing && Date.now() - existing < this.ttlMs) {
      return true;
    }
    return false;
  }

  /**
   * Mark an event ID as processed.
   */
  markProcessed(eventId: string): void {
    // Evict oldest entries if cache is too large
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(eventId, Date.now());
  }

  getSize(): number {
    return this.cache.size;
  }
}

// ─── In-Memory Event Queue ───────────────────────────────────────────────────
// In production, this would be BullMQ backed by Redis.
// Using an in-memory queue for demo portability.

type QueueHandler = (payload: WebhookPayload) => Promise<void>;

class EventQueue {
  private queue: WebhookPayload[] = [];
  private processing: boolean = false;
  private handler: QueueHandler | null = null;
  private concurrency: number = 5;
  private activeJobs: number = 0;

  setHandler(handler: QueueHandler): void {
    this.handler = handler;
  }

  enqueue(payload: WebhookPayload): void {
    this.queue.push(payload);
    this.processNext();
  }

  private async processNext(): Promise<void> {
    if (!this.handler || this.activeJobs >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const payload = this.queue.shift();
    if (!payload) return;

    this.activeJobs++;
    try {
      await this.handler(payload);
    } catch (err) {
      console.error(`[QUEUE] Error processing event ${payload.eventId}:`, err);
      // Re-queue with delay (simplified retry)
      setTimeout(() => {
        this.queue.push(payload);
        this.processNext();
      }, 2000);
    } finally {
      this.activeJobs--;
      this.processNext();
    }
  }

  getStatus() {
    return {
      pending: this.queue.length,
      active: this.activeJobs,
    };
  }
}

// ─── Message State Store ─────────────────────────────────────────────────────
// In production, this reads/writes to PostgreSQL.
// Using in-memory store for demo portability.

export interface MessageState {
  id: string;
  campaignId: string;
  campaignName?: string;
  customerId?: string;
  customerEmail?: string;
  channel?: string;
  status: string;
  stateSequence: number;
  providerMessageId?: string;
  enqueuedAt?: string;
  dispatchedAt?: string;
  sentAt?: string;
  deliveredAt?: string;
  openedAt?: string;
  readAt?: string;
  clickedAt?: string;
  convertedAt?: string;
  failedAt?: string;
  bouncedAt?: string;
  createdAt?: string;
}

class MessageStateStore {
  private states: Map<string, MessageState> = new Map();
  private events: Array<{
    messageId: string;
    eventType: string;
    fromState: string;
    toState: string;
    stateSequence: number;
    payload: Record<string, unknown>;
    timestamp: string;
    promoted: boolean;
  }> = [];

  // Listeners for real-time UI updates (SSE)
  private listeners: Set<(event: ProcessingResult & { campaignId: string }) => void> = new Set();

  getState(messageId: string): MessageState | undefined {
    return this.states.get(messageId);
  }

  setState(messageId: string, state: MessageState): void {
    this.states.set(messageId, state);
  }

  initializeMessage(message: {
    id: string;
    campaignId: string;
    campaignName?: string;
    customerId?: string;
    customerEmail?: string;
    channel?: string;
    status?: string;
    stateSequence?: number;
  }): void {
    this.states.set(message.id, {
      id: message.id,
      campaignId: message.campaignId,
      campaignName: message.campaignName,
      customerId: message.customerId,
      customerEmail: message.customerEmail,
      channel: message.channel,
      status: message.status || 'created',
      stateSequence: message.stateSequence || 0,
      createdAt: new Date().toISOString(),
    });
  }

  appendEvent(event: {
    messageId: string;
    eventType: string;
    fromState: string;
    toState: string;
    stateSequence: number;
    payload: Record<string, unknown>;
    promoted: boolean;
  }): void {
    this.events.push({
      ...event,
      timestamp: new Date().toISOString(),
    });
  }

  getEventsForMessage(messageId: string) {
    return this.events.filter(e => e.messageId === messageId);
  }

  getEventsForCampaign(campaignId: string) {
    const messageIds = new Set<string>();
    for (const [, state] of this.states) {
      if (state.campaignId === campaignId) {
        messageIds.add(state.id);
      }
    }
    return this.events.filter(e => messageIds.has(e.messageId));
  }

  getCampaignStats(campaignId: string) {
    const stats = {
      total: 0,
      created: 0,
      enqueued: 0,
      dispatched: 0,
      sent_to_channel: 0,
      delivered: 0,
      opened: 0,
      read: 0,
      clicked: 0,
      converted: 0,
      failed: 0,
      bounced: 0,
      complained: 0,
    };

    for (const [, state] of this.states) {
      if (state.campaignId === campaignId) {
        stats.total++;
        const status = state.status as keyof typeof stats;
        if (status in stats) {
          (stats[status] as number)++;
        }
      }
    }

    return stats;
  }

  // SSE listener management
  addListener(listener: (event: ProcessingResult & { campaignId: string }) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyListeners(event: ProcessingResult & { campaignId: string }): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[SSE] Listener error:', err);
      }
    }
  }

  getAllMessages(): MessageState[] {
    return Array.from(this.states.values());
  }
}

// ─── Webhook Processor ──────────────────────────────────────────────────────

export class WebhookProcessor {
  private idempotencyCache: IdempotencyCache;
  private eventQueue: EventQueue;
  public messageStore: MessageStateStore;

  constructor() {
    this.idempotencyCache = new IdempotencyCache();
    this.eventQueue = new EventQueue();
    this.messageStore = new MessageStateStore();

    // Set up the queue handler
    this.eventQueue.setHandler(this.processEvent.bind(this));
  }

  /**
   * ACCEPT-THEN-QUEUE: The lightweight webhook receipt handler.
   * Called directly from the HTTP endpoint.
   * Must complete in <50ms.
   */
  acceptWebhook(payload: WebhookPayload): { accepted: boolean; reason?: string } {
    // Step 1: Basic validation (fast)
    if (!payload.eventId || !payload.messageId || !payload.eventType) {
      return { accepted: false, reason: 'Missing required fields' };
    }

    // Step 2: Idempotency check (O(1) lookup)
    if (this.idempotencyCache.isDuplicate(payload.eventId)) {
      return { accepted: true, reason: 'Duplicate event — already processed' };
    }

    // Step 3: Mark before enqueue so duplicate retries cannot race into the queue.
    this.idempotencyCache.markProcessed(payload.eventId);

    // Step 4: Enqueue for async processing (non-blocking)
    this.eventQueue.enqueue(payload);

    return { accepted: true };
  }

  /**
   * PROCESS EVENT: The actual business logic, run asynchronously by the queue worker.
   * This is where the state machine evaluation happens.
   */
  private async processEvent(payload: WebhookPayload): Promise<void> {
    // Normalize the event type (different providers use different names)
    const normalizedType = normalizeEventType(payload.eventType);
    const sequence = STATE_SEQUENCE[normalizedType];

    if (sequence === undefined) {
      console.warn(`[WEBHOOK] Unknown event type: ${payload.eventType} (normalized: ${normalizedType})`);
      return;
    }

    // Get current message state
    let messageState = this.messageStore.getState(payload.messageId);

    // If message doesn't exist yet, initialize it
    if (!messageState) {
      this.messageStore.initializeMessage({
        id: payload.messageId,
        campaignId: payload.campaignId,
        status: 'created',
        stateSequence: 0,
      });
      messageState = this.messageStore.getState(payload.messageId)!;
    }

    // EVALUATE TRANSITION using the Unidirectional State Machine
    const result = evaluateTransition(
      messageState.status,
      messageState.stateSequence,
      normalizedType,
    );

    // Always record the event in the immutable log (even if out-of-order)
    this.messageStore.appendEvent({
      messageId: payload.messageId,
      eventType: normalizedType,
      fromState: result.fromState,
      toState: result.toState,
      stateSequence: sequence,
      payload: payload.metadata || {},
      promoted: result.promoted,
    });

    // If promoted, update the message state
    if (result.promoted) {
      const timestampField = getTimestampField(normalizedType);
      const updates: Partial<MessageState> = {
        status: result.toState,
        stateSequence: result.toSequence,
      };

      if (timestampField) {
        (updates as Record<string, string>)[timestampField] = payload.timestamp;
      }

      this.messageStore.setState(payload.messageId, {
        ...messageState,
        ...updates,
      });

      const updatedState = this.messageStore.getState(payload.messageId);
      if (normalizedType === 'delivered' && updatedState?.customerId && updatedState.customerEmail) {
        revenueAttribution.recordDelivery({
          messageId: payload.messageId,
          campaignId: payload.campaignId,
          campaignName: updatedState.campaignName || `Campaign ${payload.campaignId.slice(0, 8)}`,
          customerId: updatedState.customerId,
          customerEmail: updatedState.customerEmail,
          channel: updatedState.channel || 'email',
          deliveredAt: payload.timestamp,
        });
      }

      if (normalizedType === 'converted' && updatedState?.customerId && updatedState.customerEmail) {
        const orderId = typeof payload.metadata?.orderId === 'string' ? payload.metadata.orderId : undefined;
        const amount = typeof payload.metadata?.amount === 'number' ? payload.metadata.amount : undefined;
        if (orderId && amount) {
          revenueAttribution.attributeOrder({
            orderId,
            amount,
            customerId: updatedState.customerId,
            customerEmail: updatedState.customerEmail,
            orderDate: payload.timestamp,
          });
        }
      }

      console.log(
        `[STATE] ${payload.messageId}: ${result.fromState}(${result.fromSequence}) → ${result.toState}(${result.toSequence})`
      );
    } else if (result.outOfOrder) {
      // Update the timestamp even for out-of-order events
      const timestampField = getTimestampField(normalizedType);
      if (timestampField) {
        const currentState = this.messageStore.getState(payload.messageId)!;
        (currentState as unknown as Record<string, string>)[timestampField] = payload.timestamp;
        this.messageStore.setState(payload.messageId, currentState);
      }

      console.log(
        `[OOO] ${payload.messageId}: Out-of-order ${normalizedType}(${sequence}) — current is ${result.fromState}(${result.fromSequence})`
      );
    }

    // Notify SSE listeners for real-time UI updates
    this.messageStore.notifyListeners({
      accepted: result.accepted,
      duplicate: false,
      promoted: result.promoted,
      outOfOrder: result.outOfOrder,
      messageId: payload.messageId,
      eventType: normalizedType,
      fromState: result.fromState,
      toState: result.toState,
      reason: result.reason,
      campaignId: payload.campaignId,
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  getStatus() {
    return {
      queue: this.eventQueue.getStatus(),
      idempotencyCache: this.idempotencyCache.getSize(),
      totalMessages: this.messageStore.getAllMessages().length,
    };
  }

  getMessageState(messageId: string) {
    return this.messageStore.getState(messageId);
  }

  getCampaignStats(campaignId: string) {
    return this.messageStore.getCampaignStats(campaignId);
  }

  getMessageEvents(messageId: string) {
    return this.messageStore.getEventsForMessage(messageId);
  }

  getCampaignEvents(campaignId: string) {
    return this.messageStore.getEventsForCampaign(campaignId);
  }

  getCustomerMessages(customerId: string) {
    return this.messageStore.getAllMessages().filter((message) => message.customerId === customerId);
  }

  addSSEListener(listener: (event: ProcessingResult & { campaignId: string }) => void): () => void {
    return this.messageStore.addListener(listener);
  }

  initializeMessage(message: {
    id: string;
    campaignId: string;
    campaignName?: string;
    customerId?: string;
    customerEmail?: string;
    channel?: string;
  }) {
    this.messageStore.initializeMessage(message);
  }

  /**
   * Promote a message through the state machine (e.g. after channel accept).
   */
  promoteMessageState(
    messageId: string,
    targetState: string,
    extra: Partial<MessageState> = {},
  ): TransitionResult | null {
    const messageState = this.messageStore.getState(messageId);
    if (!messageState) return null;

    const result = evaluateTransition(
      messageState.status,
      messageState.stateSequence,
      targetState,
    );

    if (!result.promoted) return result;

    const timestampField = getTimestampField(targetState);
    const updates: Partial<MessageState> = {
      status: result.toState,
      stateSequence: result.toSequence,
      ...extra,
    };

    if (timestampField) {
      (updates as Record<string, string>)[timestampField] = new Date().toISOString();
    }

    this.messageStore.setState(messageId, { ...messageState, ...updates });
    return result;
  }
}

// Persist across Next.js dev hot reloads and route module boundaries.
declare global {
  // eslint-disable-next-line no-var
  var _pulseWebhookProcessor: WebhookProcessor | undefined;
}

function getWebhookProcessor(): WebhookProcessor {
  if (!globalThis._pulseWebhookProcessor) {
    globalThis._pulseWebhookProcessor = new WebhookProcessor();
  }
  return globalThis._pulseWebhookProcessor;
}

export const webhookProcessor = getWebhookProcessor();
