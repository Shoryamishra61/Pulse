/**
 * PULSE CRM — Campaign Cancellation API
 * 
 * POST /api/campaigns/:id/cancel — Cancel a scheduled or queued campaign
 * 
 * Cancels campaigns that haven't been fully dispatched yet.
 * Updates campaign status to CANCELLED and removes from scheduler queue.
 * 
 * Reference: GAP-007 (Campaign Cancellation)
 */

import { NextRequest, NextResponse } from 'next/server';
import { campaignScheduler } from '@/lib/services/campaign-scheduler';
import { apiRateLimiter, checkRateLimit } from '@/lib/middleware/rate-limiter';
import { z } from 'zod';

// In-memory campaign store (simulates database)
interface Campaign {
  id: string;
  name: string;
  status: string;
  segmentId?: string;
  channel: string;
  messageTemplate: string;
  scheduledAt?: Date;
  createdAt: Date;
  launchedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  openedCount: number;
  clickedCount: number;
  failedCount: number;
}

// Access global campaign store
declare global {
  var campaignStore: Map<string, Campaign> | undefined;
}

const getCampaignStore = (): Map<string, Campaign> => {
  if (!global.campaignStore) {
    global.campaignStore = new Map();
  }
  return global.campaignStore;
};

export async function POST(
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
    // Get campaign from store
    const campaignStore = getCampaignStore();
    const campaign = campaignStore.get(campaignId);
    
    if (!campaign) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Campaign not found',
          },
        },
        { status: 404 }
      );
    }

    // Check if campaign can be cancelled
    const cancellableStatuses = ['draft', 'scheduled', 'queued'];
    if (!cancellableStatuses.includes(campaign.status)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CANNOT_CANCEL',
            message: `Campaign cannot be cancelled in ${campaign.status} state`,
            current_status: campaign.status,
            allowed_statuses: cancellableStatuses,
          },
        },
        { status: 409 }
      );
    }

    // Parse cancellation reason from body (optional)
    let cancellationReason = 'User requested cancellation';
    try {
      const body = await request.json();
      if (body.reason) {
        const reasonSchema = z.string().min(1).max(500);
        cancellationReason = reasonSchema.parse(body.reason);
      }
    } catch (e) {
      // Body is optional, continue with default reason
    }

    // Cancel scheduled campaign in scheduler
    if (campaign.status === 'scheduled' && campaign.scheduledAt) {
      try {
        campaignScheduler.cancelScheduledCampaign(campaignId);
      } catch (error) {
        // Campaign may not be in scheduler, that's okay
        console.log(`Campaign ${campaignId} not found in scheduler, continuing cancellation`);
      }
    }

    // Update campaign status
    const previousStatus = campaign.status;
    campaign.status = 'cancelled';
    campaign.cancelledAt = new Date();
    campaign.completedAt = new Date();

    // Persist to store
    campaignStore.set(campaignId, campaign);

    return NextResponse.json({
      success: true,
      message: 'Campaign cancelled successfully',
      campaign: {
        id: campaign.id,
        name: campaign.name,
        previous_status: previousStatus,
        current_status: campaign.status,
        cancelled_at: campaign.cancelledAt.toISOString(),
        cancellation_reason: cancellationReason,
        progress_at_cancellation: {
          total_recipients: campaign.totalRecipients,
          sent_count: campaign.sentCount,
          delivered_count: campaign.deliveredCount,
          unsent_count: campaign.totalRecipients - campaign.sentCount,
        },
      },
      next_steps: [
        'The campaign has been marked as cancelled',
        'No further messages will be sent',
        campaign.sentCount > 0
          ? `${campaign.sentCount} messages were already sent before cancellation`
          : 'No messages were sent',
      ],
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to cancel campaign',
          details: (error as Error).message,
        },
      },
      { status: 500 }
    );
  }
}
