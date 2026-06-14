import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { campaigns, segments } from '@/lib/db/schema';
import { eq, lte, and } from 'drizzle-orm';
import { dispatchCampaign, type DispatchRequest } from '@/lib/services/campaign-dispatch';
import { getCustomerData } from '@/lib/services/customer-store';
import { compileAndEvaluatePredicate } from '@/lib/services/predicate-compiler';

// To be hit by Vercel Cron or a similar tool
// e.g. GET /api/cron/campaign-dispatch
export async function GET(request: NextRequest) {
  // Validate basic authorization (in production, use a secure secret)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET || 'pulse-cron-secret-2026';
  
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized cron trigger' }, { status: 401 });
  }

  try {
    if (!db) {
      return NextResponse.json({
        success: true,
        message: 'Running in demo mode. The in-memory CampaignScheduler handles dispatch.',
      });
    }

    // Find all scheduled campaigns where scheduledAt <= NOW
    const now = new Date();
    const dueCampaigns = await db.select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.status, 'scheduled'),
          lte(campaigns.scheduledAt, now)
        )
      );

    if (dueCampaigns.length === 0) {
      return NextResponse.json({ success: true, message: 'No campaigns due for dispatch.' });
    }

    const { customers } = getCustomerData();
    let dispatchedCount = 0;

    for (const campaign of dueCampaigns) {
      if (!campaign.segmentId) continue;

      // Move campaign to dispatching
      await db.update(campaigns)
        .set({ status: 'dispatching', updatedAt: new Date() })
        .where(eq(campaigns.id, campaign.id));

      // Fetch the target segment
      const segmentResult = await db.select().from(segments).where(eq(segments.id, campaign.segmentId)).limit(1);
      if (!segmentResult.length) continue;

      const segment = segmentResult[0];

      // Re-evaluate the segment against current customers
      const matchingCustomers = compileAndEvaluatePredicate(segment.definition as any, customers);

      // We use the first variant (or default fallback)
      const variant = campaign.messageVariants?.[0] || { body: 'Hello' };
      const channel = campaign.channels?.[0] || 'email';

      const dispatchRequest: DispatchRequest = {
        campaignId: campaign.id,
        campaignName: campaign.name,
        channel: channel,
        recipients: matchingCustomers.map(c => ({
          customerId: c.id,
          email: c.email,
          name: c.name || undefined,
          phone: c.phone || undefined,
          totalSpend: c.total_spend,
          orderCount: c.order_count,
          avgOrderValue: c.avg_order_value,
          lastOrderDate: c.last_order_date?.toISOString(),
          properties: c.properties as any,
        })),
        messageContent: {
          subject: variant.subject || undefined,
          body: variant.body,
        },
      };

      // Dispatch asynchronously so the cron request doesn't timeout
      dispatchCampaign(dispatchRequest).then(async (result) => {
        // Upon complete dispatch, mark campaign as active (or completed)
        if (db) {
           await db.update(campaigns)
             .set({ 
               status: 'completed', 
               updatedAt: new Date(),
               sentCount: result.dispatched,
               failedCount: result.failed,
             })
             .where(eq(campaigns.id, campaign.id));
        }
      }).catch(console.error);

      dispatchedCount++;
    }

    return NextResponse.json({
      success: true,
      dispatched_campaigns: dispatchedCount,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[CRON] Campaign Dispatch failed:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
