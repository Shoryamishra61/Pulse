'use client';

/**
 * PULSE CRM — useSSE Hook
 * 
 * Real-time Server-Sent Events hook for the Dispatch Theater.
 * 
 * Architecture Decision: SSE OVER WEBSOCKETS
 * SSE is chosen over WebSockets because:
 * 1. Unidirectional data flow (server → client only) matches our use case perfectly
 * 2. Automatic reconnection built into the EventSource API
 * 3. Works through HTTP/2 without upgrade negotiation
 * 4. Simpler server implementation — just a streaming response
 * 
 * The hook connects to `/api/events` and dispatches events to the Zustand store,
 * which drives the Dispatch Theater's funnel bars and event stream ticker.
 */

import { useEffect, useRef, useCallback } from 'react';
import { usePulseStore } from '@/lib/store';

interface DispatchStartedEvent {
  campaignName?: string;
  totalRecipients?: number;
  channel?: string;
}

interface WebhookEventData {
  eventId?: string;
  eventType: string;
  messageId?: string;
  timestamp?: string;
  promoted?: boolean;
  toState?: string;
}

interface MessageDispatchedEvent {
  messageId?: string;
  customerId?: string;
  success?: boolean;
  timestamp?: string;
}

export function useSSE(campaignId: string | null) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const { setActiveCampaign, updateCampaignStats, addCampaignEvent } = usePulseStore();

  const connect = useCallback(() => {
    if (!campaignId) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = `/api/events?campaignId=${encodeURIComponent(campaignId)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      console.log(`[SSE] Connected to dispatch stream for campaign ${campaignId}`);
    };

    // Dispatch events → Zustand store
    es.addEventListener('dispatch_started', (e) => {
      const data = JSON.parse(e.data) as DispatchStartedEvent;
      setActiveCampaign({
        id: campaignId,
        name: data.campaignName || 'Campaign',
        channel: data.channel,
        recipientCount: data.totalRecipients || 0,
        stats: {
          total: data.totalRecipients || 0,
          created: data.totalRecipients || 0, enqueued: 0, dispatched: 0, sent_to_channel: 0,
          delivered: 0, opened: 0, read: 0, clicked: 0, converted: 0,
          failed: 0, bounced: 0, complained: 0,
        },
        events: [],
      });
    });

    es.addEventListener('message_dispatched', (e) => {
      const data = JSON.parse(e.data) as MessageDispatchedEvent;
      addCampaignEvent({
        id: data.messageId || crypto.randomUUID(),
        type: data.success ? 'dispatched' : 'failed',
        eventType: data.success ? 'dispatched' : 'failed',
        messageId: data.messageId,
        timestamp: data.timestamp || new Date().toISOString(),
        promoted: true,
      });
      updateCampaignStats(data.success ? 'sent_to_channel' : 'failed');
    });

    es.addEventListener('webhook_event', (e) => {
      const data = JSON.parse(e.data) as WebhookEventData;
      addCampaignEvent({
        id: data.eventId || crypto.randomUUID(),
        type: data.eventType,
        eventType: data.eventType,
        messageId: data.messageId,
        timestamp: data.timestamp || new Date().toISOString(),
        promoted: data.promoted,
      });
      // If promoted, update stats
      if (data.promoted && data.toState) {
        updateCampaignStats(data.toState);
      }
    });

    es.addEventListener('batch_complete', (e) => {
      const data = JSON.parse(e.data) as { batchNumber?: number; totalBatches?: number };
      console.log(`[SSE] Batch ${data.batchNumber}/${data.totalBatches} complete`);
    });

    es.addEventListener('dispatch_complete', (e) => {
      const data = JSON.parse(e.data) as { dispatched?: number; failed?: number };
      console.log(`[SSE] Dispatch complete: ${data.dispatched} sent, ${data.failed} failed`);
    });

    es.onerror = () => {
      console.warn('[SSE] Connection error — will auto-reconnect');
      // EventSource automatically reconnects
    };
  }, [campaignId, setActiveCampaign, updateCampaignStats, addCampaignEvent]);

  // Connect when campaignId changes
  useEffect(() => {
    connect();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [connect]);

  return {
    reconnect: connect,
    disconnect: () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    },
  };
}
