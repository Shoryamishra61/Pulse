/**
 * PULSE CRM — Webhook Receipt Endpoint
 * 
 * Pattern: ACCEPT-THEN-QUEUE
 * 
 * This endpoint is the entry point for ALL webhook callbacks from the
 * Channel Service. It must be incredibly lightweight (<50ms response time).
 * 
 * Flow:
 * 1. Verify HMAC-SHA256 signature (fast, constant-time)
 * 2. Validate payload structure (fast)
 * 3. Drop into processing queue (non-blocking)  
 * 4. Return 200 OK immediately
 * 
 * The actual state machine evaluation and database writes happen
 * asynchronously in the queue worker.
 * 
 * Reference: "Thundering Herd Problem" prevention pattern
 * Reference: "Designing Idempotent API Endpoints for Payments at Stripe"
 */

import { NextRequest, NextResponse } from 'next/server';
import { webhookProcessor } from '@/lib/services/webhook-processor';
import { createHmac, timingSafeEqual } from 'crypto';
import { webhookRateLimiter, getClientIdentifier } from '@/lib/middleware/rate-limiter';
import { webhookEventSchema } from '@/lib/middleware/validation';
import { ZodError } from 'zod';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'pulse-webhook-secret-v1';

/**
 * Verify HMAC-SHA256 webhook signature.
 * Uses constant-time comparison to prevent timing attacks.
 */
function verifySignature(payload: string, signature: string | null): boolean {
  if (!signature) return false;

  // Extract the hex digest from "sha256=<hex>"
  const providedSig = signature.replace('sha256=', '');
  const expectedSig = createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  try {
    return timingSafeEqual(
      Buffer.from(providedSig, 'hex'),
      Buffer.from(expectedSig, 'hex')
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Step 0: Rate limiting check (P0-001 FIX)
    const clientId = getClientIdentifier(request);
    const rateLimitResult = webhookRateLimiter.check(clientId);
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          status: 'rate_limited',
          message: 'Too many webhook events from this IP',
          retryAfterMs: rateLimitResult.retryAfterMs,
          processingTimeMs: Date.now() - startTime,
        },
        { 
          status: 429,
          headers: {
            'Retry-After': Math.ceil((rateLimitResult.retryAfterMs || 60000) / 1000).toString(),
            'X-RateLimit-Limit': '1000',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': new Date(Date.now() + (rateLimitResult.retryAfterMs || 60000)).toISOString(),
          },
        }
      );
    }

    const rawBody = await request.text();
    const signature = request.headers.get('X-Channel-Signature');

    // Step 1: Verify HMAC-SHA256 signature (constant-time)
    if (!verifySignature(rawBody, signature)) {
      return NextResponse.json(
        {
          status: 'rejected',
          reason: 'Invalid webhook signature',
          processingTimeMs: Date.now() - startTime,
        },
        { status: 401 }
      );
    }

    // Step 2: Parse and validate payload (P0-002 FIX)
    let payload;
    try {
      payload = JSON.parse(rawBody);
      payload = webhookEventSchema.parse(payload);
    } catch (error) {
      if (error instanceof ZodError) {
        return NextResponse.json(
          {
            status: 'rejected',
            reason: 'Invalid payload structure',
            details: error.errors.map(e => ({ field: e.path.join('.'), issue: e.message })),
            processingTimeMs: Date.now() - startTime,
          },
          { status: 400 }
        );
      }
      throw error;
    }

    // Step 3: Accept-then-Queue — validate and enqueue, return immediately
    const result = webhookProcessor.acceptWebhook(payload);

    const processingTimeMs = Date.now() - startTime;

    if (result.accepted) {
      return NextResponse.json(
        {
          status: 'accepted',
          processingTimeMs,
          ...(result.reason ? { note: result.reason } : {}),
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        status: 'rejected',
        reason: result.reason,
        processingTimeMs,
      },
      { status: 400 }
    );
  } catch {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Invalid payload',
        processingTimeMs: Date.now() - startTime,
      },
      { status: 400 }
    );
  }
}

// Health check for the webhook endpoint
export async function GET() {
  const status = webhookProcessor.getStatus();
  return NextResponse.json({
    endpoint: '/api/webhook/channel-service',
    pattern: 'Accept-then-Queue',
    security: 'HMAC-SHA256 signature verification',
    ...status,
  });
}
