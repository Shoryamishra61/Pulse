/**
 * PULSE CRM — Health Check
 *
 * Aggregates CRM runtime status and channel-service reachability.
 */

import { NextResponse } from 'next/server';
import { webhookProcessor } from '@/lib/services/webhook-processor';
import { getCustomerData, getOrderData } from '@/lib/services/customer-store';

export async function GET() {
  const channelUrl = process.env.CHANNEL_SERVICE_URL || 'http://localhost:3001';
  let channelService: Record<string, unknown> = { status: 'unreachable' };

  try {
    const response = await fetch(`${channelUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      channelService = await response.json() as Record<string, unknown>;
    } else {
      channelService = { status: 'degraded', httpStatus: response.status };
    }
  } catch {
    channelService = { status: 'unreachable', url: channelUrl };
  }

  return NextResponse.json({
    status: 'ok',
    service: 'pulse-crm',
    timestamp: new Date().toISOString(),
    webhookProcessor: webhookProcessor.getStatus(),
    dataset: {
      customers: getCustomerData().length,
      orders: getOrderData().length,
    },
    channelService,
  });
}
