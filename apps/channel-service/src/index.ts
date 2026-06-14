/**
 * PULSE Channel Service — Stubbed Message Provider
 * 
 * This is a separate, independent service that simulates a real-world
 * messaging provider (like Twilio, SendGrid, or WhatsApp Business API).
 * 
 * Architecture Decisions:
 * 1. SEPARATE PROCESS: Models real-world service boundary between CRM and channel provider
 * 2. TOKEN BUCKET RATE LIMITER: Simulates telecom API limits (Stripe rate limiter pattern)
 * 3. PROBABILISTIC EVENT SIMULATION: Generates realistic delivery outcomes
 * 4. ASYNC CALLBACKS: Calls back to CRM webhook endpoint after simulated delay
 * 
 * Reference: "Inside Stripe's Rate Limiter Architecture"
 */

import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createHmac } from 'crypto';

// ─── Configuration ───────────────────────────────────────────────────────────

const PORT = process.env.CHANNEL_PORT || 3001;
const CRM_PORT = process.env.CRM_PORT || process.env.PORT || '3000';
const CRM_WEBHOOK_URL =
  process.env.CRM_WEBHOOK_URL || `http://localhost:${CRM_PORT}/api/webhook/channel-service`;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'pulse-webhook-secret-v1';

// ─── Token Bucket Rate Limiter ───────────────────────────────────────────────
// Reference: "Inside Stripe's Rate Limiter Architecture"
// Prevents the CRM from overwhelming the channel service during campaign dispatch

class TokenBucketRateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second
  private lastRefill: number;

  constructor(maxTokens: number = 100, refillRate: number = 50) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  getStatus() {
    this.refill();
    return {
      remaining: Math.floor(this.tokens),
      limit: this.maxTokens,
      resetMs: Math.ceil((this.maxTokens - this.tokens) / this.refillRate * 1000),
    };
  }
}

// ─── Event Probability Model ─────────────────────────────────────────────────
// Simulates real-world delivery outcomes with realistic distributions

interface ChannelProfile {
  openRate: number;
  clickRate: number;
  complaintRate: number;
  minLatencyMs: number;
  maxLatencyMs: number;
}

const CHANNEL_PROFILES: Record<string, ChannelProfile> = {
  email: {
    openRate: 0.25,
    clickRate: 0.08,
    complaintRate: 0.002,
    minLatencyMs: 500,
    maxLatencyMs: 3000,
  },
  sms: {
    openRate: 0.90,
    clickRate: 0.15,
    complaintRate: 0.001,
    minLatencyMs: 500,
    maxLatencyMs: 3000,
  },
  whatsapp: {
    openRate: 0.80,
    clickRate: 0.20,
    complaintRate: 0.003,
    minLatencyMs: 500,
    maxLatencyMs: 3000,
  },
  rcs: {
    openRate: 0.68,
    clickRate: 0.18,
    complaintRate: 0.003,
    minLatencyMs: 500,
    maxLatencyMs: 3000,
  },
};

const DELIVERY_OUTCOMES = {
  delivered: 0.95,
  failed: 0.02,
  delayed: 0.03,
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface SendRequest {
  messageId: string;
  campaignId: string;
  customerId: string;
  recipient?: {
    customerId: string;
    name?: string;
    email?: string;
    phone?: string;
  };
  channel: string;
  content: {
    subject?: string;
    body: string;
    personalization?: Record<string, unknown>;
  };
  callbackUrl?: string;
}

interface WebhookEvent {
  eventId: string;
  messageId: string;
  campaignId: string;
  eventType: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

// ─── In-flight Message Tracker ───────────────────────────────────────────────

const inFlightMessages = new Map<string, SendRequest>();
const rateLimiter = new TokenBucketRateLimiter(100, 50);

// ─── Helper Functions ────────────────────────────────────────────────────────

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shouldOccur(probability: number): boolean {
  return Math.random() < probability;
}

async function sendWebhookCallback(event: WebhookEvent, callbackUrl: string): Promise<void> {
  try {
    const body = JSON.stringify(event);
    // HMAC-SHA256 signature for webhook verification
    // CRM validates this to prevent spoofed callbacks
    const signature = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Channel-Signature': `sha256=${signature}`,
        'X-Channel-Event-Id': event.eventId,
      },
      body,
    });

    if (!response.ok) {
      // Retry with exponential backoff (simplified for demo)
      console.log(`[CALLBACK] Retry needed for ${event.messageId}: ${response.status}`);
      setTimeout(() => sendWebhookCallback(event, callbackUrl), 2000);
    } else {
      console.log(`[CALLBACK] ✓ ${event.eventType} for ${event.messageId}`);
    }
  } catch (err) {
    console.error(`[CALLBACK] ✗ Failed for ${event.messageId}:`, (err as Error).message);
    // Retry after delay
    setTimeout(() => sendWebhookCallback(event, callbackUrl), 3000);
  }
}

/**
 * Simulate the message lifecycle asynchronously.
 * Generates a chain of events with realistic timing and probabilities.
 * 
 * Event chain: sent → delivered/bounced → opened → clicked → converted
 * Each step has a probability gate and a random delay.
 */
async function simulateMessageLifecycle(request: SendRequest): Promise<void> {
  const profile = CHANNEL_PROFILES[request.channel] || CHANNEL_PROFILES.email;
  const callbackUrl = request.callbackUrl || CRM_WEBHOOK_URL;

  const sendEvent = (eventType: string, metadata: Record<string, unknown> = {}): void => {
    const event: WebhookEvent = {
      eventId: uuidv4(),
      messageId: request.messageId,
      campaignId: request.campaignId,
      eventType,
      timestamp: new Date().toISOString(),
      metadata,
    };
    // Fire-and-forget callback (non-blocking)
    sendWebhookCallback(event, callbackUrl);
  };

  // Step 1: Delivery attempt (after provider latency). The first outcome follows
  // the competition rubric exactly: 95% delivered, 2% failed, 3% delayed.
  await new Promise(resolve => setTimeout(resolve, randomDelay(profile.minLatencyMs, profile.maxLatencyMs)));

  const outcomeRoll = Math.random();
  if (outcomeRoll < DELIVERY_OUTCOMES.failed) {
    sendEvent('failed', { reason: 'provider_error', errorCode: 'TEMPORARY_FAILURE', outcome: 'failed' });
    inFlightMessages.delete(request.messageId);
    return;
  }

  const wasDelayed = outcomeRoll < DELIVERY_OUTCOMES.failed + DELIVERY_OUTCOMES.delayed;
  if (wasDelayed) {
    await new Promise(resolve => setTimeout(resolve, randomDelay(500, 3000)));
  }

  sendEvent('delivered', { provider: 'channel-service-stub', outcome: wasDelayed ? 'delayed_then_delivered' : 'delivered' });

  // Step 2: Open/read (after user delay)
  if (shouldOccur(profile.openRate)) {
    await new Promise(resolve => setTimeout(resolve, randomDelay(500, 3000)));
    sendEvent(request.channel === 'whatsapp' || request.channel === 'rcs' ? 'read' : 'opened', {
      userAgent: 'simulated-client/1.0',
      personalization: request.content.personalization,
    });

    // Step 3: Click (after read delay)
    if (shouldOccur(profile.clickRate / profile.openRate)) {
      await new Promise(resolve => setTimeout(resolve, randomDelay(500, 3000)));
      sendEvent('clicked', {
        url: 'https://example.com/offer',
        position: 'cta_primary',
        personalization: request.content.personalization,
      });

      // Step 4: Conversion (small probability after click)
      if (shouldOccur(0.15)) {
        await new Promise(resolve => setTimeout(resolve, randomDelay(500, 3000)));
        sendEvent('converted', {
          orderId: uuidv4(),
          amount: Math.floor(Math.random() * 5000 + 500),
          currency: 'INR',
        });
      }
    }
  }

  // Rare: complaint after delivery
  if (shouldOccur(profile.complaintRate)) {
    await new Promise(resolve => setTimeout(resolve, randomDelay(500, 3000)));
    sendEvent('complained', { reason: 'marked_as_spam' });
  }

  inFlightMessages.delete(request.messageId);
}

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Root endpoint
app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'PULSE Channel Service Stub is running. Use /health to check status.' });
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'channel-service-stub',
    inFlight: inFlightMessages.size,
    rateLimit: rateLimiter.getStatus(),
  });
});

/**
 * POST /send — Accept a message for delivery
 * 
 * Returns 202 Accepted immediately with a provider message ID.
 * The actual delivery simulation happens asynchronously.
 * Rate limited via Token Bucket to simulate real telecom limits.
 */
app.post('/send', (req: Request, res: Response) => {
  // Rate limit check (Token Bucket pattern)
  if (!rateLimiter.tryConsume()) {
    const status = rateLimiter.getStatus();
    res.status(429).json({
      error: 'rate_limit_exceeded',
      message: 'Too many requests. Please retry after delay.',
      retryAfterMs: status.resetMs,
      limit: status.limit,
      remaining: status.remaining,
    });
    return;
  }

  const body = req.body as SendRequest;

  // Validate required fields
  if (!body.messageId || !body.campaignId || !body.customerId || !body.channel) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required fields: messageId, campaignId, customerId, channel',
    });
    return;
  }

  // Check for supported channel
  if (!CHANNEL_PROFILES[body.channel]) {
    res.status(400).json({
      error: 'unsupported_channel',
      message: `Channel '${body.channel}' is not supported. Use: ${Object.keys(CHANNEL_PROFILES).join(', ')}`,
    });
    return;
  }

  const providerMessageId = `ch_${uuidv4().replace(/-/g, '').slice(0, 20)}`;

  // Track in-flight message
  inFlightMessages.set(body.messageId, body);

  // Start async lifecycle simulation (non-blocking)
  simulateMessageLifecycle(body);

  // Return 202 Accepted immediately (Accept-then-Process pattern)
  console.log(`[SEND] Accepted ${body.channel} message ${body.messageId} for campaign ${body.campaignId}`);

  res.status(202).json({
    status: 'accepted',
    providerMessageId,
    messageId: body.messageId,
    estimatedDeliveryMs: CHANNEL_PROFILES[body.channel].maxLatencyMs,
  });
});

// Status check for a specific message
app.get('/status/:messageId', (req: Request, res: Response) => {
  const message = inFlightMessages.get(req.params.messageId as string);
  if (message) {
    res.json({ status: 'in_flight', messageId: req.params.messageId });
  } else {
    res.json({ status: 'completed_or_unknown', messageId: req.params.messageId });
  }
});

// ─── Start Server ────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║  PULSE Channel Service (Stubbed Provider)            ║
║  Port: ${PORT}                                          ║
║  Callback URL: ${CRM_WEBHOOK_URL}                    ║
║  Rate Limit: 100 tokens, 50/sec refill               ║
╚══════════════════════════════════════════════════════╝
  `);
});

export default app;
