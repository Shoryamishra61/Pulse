/**
 * PULSE CRM — Server-Sent Events (SSE) Endpoint
 * 
 * Real-time event stream for the Dispatch Theater UI.
 * 
 * This endpoint uses SSE (not WebSocket) because:
 * 1. Unidirectional: Data only flows server → client
 * 2. Auto-reconnect: Built into the EventSource API
 * 3. HTTP/2 compatible: Multiplexed on a single connection
 * 4. No additional infrastructure: Works with standard HTTP
 * 
 * Events streamed:
 * - dispatch_started: Campaign dispatch initiated
 * - message_dispatched: Individual message sent to channel service
 * - batch_complete: Dispatch batch processed
 * - dispatch_complete: All messages dispatched
 * - webhook_event: State change from channel service callback
 */

import { NextRequest } from 'next/server';
import { webhookProcessor } from '@/lib/services/webhook-processor';
import { addDispatchListener } from '@/lib/services/campaign-dispatch';

export const dynamic = 'force-dynamic';

export function formatSSEEvent(eventName: string, data: Record<string, unknown>) {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('campaignId');

  const encoder = new TextEncoder();
  let dispatchCleanup: (() => void) | null = null;
  let webhookCleanup: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      const connectEvent = formatSSEEvent('connected', {
        type: 'connected',
        timestamp: new Date().toISOString(),
        campaignId,
      });
      controller.enqueue(encoder.encode(connectEvent));

      // Listen for dispatch events
      dispatchCleanup = addDispatchListener((event) => {
        if (campaignId && event.campaignId !== campaignId) return;
        try {
          const sseEvent = formatSSEEvent(event.type, {
            type: event.type,
            campaignId: event.campaignId,
            timestamp: new Date().toISOString(),
            ...event.data,
          });
          controller.enqueue(encoder.encode(sseEvent));
        } catch {
          // Stream closed
        }
      });

      // Listen for webhook state changes
      webhookCleanup = webhookProcessor.addSSEListener((event) => {
        if (campaignId && event.campaignId !== campaignId) return;
        try {
          const sseEvent = formatSSEEvent('webhook_event', {
            type: 'webhook_event',
            ...event,
            timestamp: new Date().toISOString(),
          });
          controller.enqueue(encoder.encode(sseEvent));
        } catch {
          // Stream closed
        }
      });

      // Heartbeat every 30 seconds to keep connection alive
      heartbeat = setInterval(() => {
        try {
          const stats = campaignId
            ? webhookProcessor.getCampaignStats(campaignId)
            : null;

          const ping = formatSSEEvent('heartbeat', {
            type: 'heartbeat',
            timestamp: new Date().toISOString(),
            stats,
          });
          controller.enqueue(encoder.encode(ping));
        } catch {
          if (heartbeat) clearInterval(heartbeat);
        }
      }, 30000);

      // Cleanup on stream close
      request.signal.addEventListener('abort', () => {
        if (heartbeat) clearInterval(heartbeat);
        if (dispatchCleanup) dispatchCleanup();
        if (webhookCleanup) webhookCleanup();
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (dispatchCleanup) dispatchCleanup();
      if (webhookCleanup) webhookCleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
