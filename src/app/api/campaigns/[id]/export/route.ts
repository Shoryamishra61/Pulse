/**
 * PULSE CRM — Campaign Export API
 * 
 * GET /api/campaigns/:id/export — Export campaign data as CSV
 * 
 * Returns CSV with all campaign messages including:
 * - Customer details
 * - Message status
 * - Timestamps
 * - Attribution data
 * 
 * Reference: GAP-007 Extension (CSV Export)
 */

import { NextRequest, NextResponse } from 'next/server';
import { webhookProcessor } from '@/lib/services/webhook-processor';
import { getCustomerData } from '@/lib/services/customer-store';
import { apiRateLimiter, checkRateLimit } from '@/lib/middleware/rate-limiter';

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatTimestamp(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString();
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // Rate limiting
  const rateLimitResponse = checkRateLimit(request, apiRateLimiter);
  if (rateLimitResponse) return rateLimitResponse;

  const { id: campaignId } = await context.params;

  // Validate campaign ID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(campaignId)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid campaign ID format',
        },
      },
      { status: 400 }
    );
  }

  try {
    // Get campaign messages/events
    const messages = webhookProcessor.getCampaignEvents(campaignId);

    if (!messages || messages.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NO_DATA',
            message: 'No messages found for this campaign',
          },
        },
        { status: 404 }
      );
    }

    // Get customer data for enrichment
    const customers = getCustomerData();
    const customerMap = new Map(customers.map(c => [c.id, c]));

    // CSV Headers
    const headers = [
      'Message ID',
      'Customer ID',
      'Customer Name',
      'Customer Email',
      'Customer Phone',
      'Customer City',
      'Customer Segment',
      'Customer Total Spend',
      'Customer Order Count',
      'Channel',
      'Message Status',
      'Message Text',
      'Created At',
      'Queued At',
      'Sent At',
      'Delivered At',
      'Opened At',
      'Clicked At',
      'Failed At',
      'Failure Reason',
      'Attributed Order ID',
      'Attributed Revenue',
    ];

    // Build CSV rows
    const rows: string[][] = [headers];

    for (const message of messages) {
      const customer = customerMap.get(message.customerId);
      const props = customer?.properties as Record<string, string> | undefined;

      rows.push([
        message.id,
        message.customerId,
        customer?.name || '',
        customer?.email || '',
        customer?.phone || '',
        props?.city || '',
        props?.segment || '',
        customer?.totalSpend.toString() || '',
        customer?.orderCount.toString() || '',
        message.channel || '',
        message.status || '',
        message.messageRendered || '',
        formatTimestamp(message.createdAt),
        formatTimestamp(message.queuedAt),
        formatTimestamp(message.sentAt),
        formatTimestamp(message.deliveredAt),
        formatTimestamp(message.openedAt || message.readAt),
        formatTimestamp(message.clickedAt),
        formatTimestamp(message.failedAt),
        message.failureReason || '',
        message.attributionOrderId || '',
        message.attributionRevenue?.toString() || '',
      ]);
    }

    // Generate CSV content
    const csvContent = rows
      .map(row => row.map(escapeCSV).join(','))
      .join('\n');

    // Generate filename
    const campaignName = messages[0]?.campaignName || 'campaign';
    const sanitizedName = campaignName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${sanitizedName}_${timestamp}.csv`;

    // Return CSV with proper headers
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
        'X-Total-Records': messages.length.toString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'EXPORT_FAILED',
          message: 'Failed to export campaign data',
          details: (error as Error).message,
        },
      },
      { status: 500 }
    );
  }
}
