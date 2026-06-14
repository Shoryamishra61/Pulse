/**
 * PULSE CRM — Campaign Dispatch API
 * 
 * POST: Initiates campaign dispatch to Channel Service
 * GET: Retrieves campaign stats (real-time via state store)
 * 
 * This endpoint orchestrates the full dispatch flow:
 * 1. Accept campaign configuration (segment, channel, message content)
 * 2. Resolve segment membership to get recipient list
 * 3. Trigger async dispatch via background workers
 * 4. Return dispatch acknowledgment immediately
 * 
 * The actual HTTP calls to the Channel Service happen in the
 * campaign-dispatch service's background workers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { dispatchCampaign, DispatchRequest } from '@/lib/services/campaign-dispatch';
import { webhookProcessor } from '@/lib/services/webhook-processor';
import { getCustomerData } from '@/lib/services/customer-store';
import { revenueAttribution } from '@/lib/services/revenue-attribution';
import { validateBody, validateQuery, campaignSchema, campaignFilterSchema } from '@/lib/middleware/validation';
import { apiRateLimiter, checkRateLimit } from '@/lib/middleware/rate-limiter';
import type { SyntheticCustomer } from '@/lib/services/seed-data';
import type { PredicateNode } from '@/lib/services/predicate-compiler';
import { v4 as uuidv4 } from 'uuid';

interface CampaignPostBody {
  campaignName?: string;
  name?: string;
  segmentName?: string;
  channel?: string;
  messageContent?: { subject?: string; body?: string };
  audienceSize?: number;
  recipientCount?: number;
  segmentCriteria?: PredicateNode;
}

export function normalizeCampaignRequest(body: CampaignPostBody) {
  const {
    campaignName,
    name: legacyName,
    segmentName,
    channel = 'email',
    messageContent,
    audienceSize,
    recipientCount,
  } = body;
  const name = campaignName || legacyName;
  const resolvedRecipientCount = Math.max(1, Math.min(audienceSize || recipientCount || 20, 500));

  return {
    name,
    segmentName: segmentName || 'All Customers',
    channel,
    messageContent,
    recipientCount: resolvedRecipientCount,
    isValid: Boolean(name && messageContent?.body),
  };
}

type CampaignStoreItem = {
  id: string;
  name: string;
  segmentName: string;
  channel: string;
  status: string;
  recipientCount: number;
  messageContent: { subject?: string; body: string };
  createdAt: string;
  dispatchResult?: Record<string, unknown>;
};

const globalStore = globalThis as unknown as {
  _campaignStore?: Map<string, CampaignStoreItem>;
};

if (!globalStore._campaignStore) {
  globalStore._campaignStore = new Map<string, CampaignStoreItem>();
  
  // Seed some realistic data
  const seedCampaigns: CampaignStoreItem[] = [
    {
      id: 'cmp-101',
      name: 'Diwali VIP Offer',
      segmentName: 'Champions',
      channel: 'whatsapp',
      status: 'active',
      recipientCount: 1250,
      messageContent: { body: 'Hey {{first_name}}, your {{loyalty_tier}} Diwali early access starts tonight. We picked {{preferred_category}} offers for you in {{city}}. Use VIP20.' },
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'cmp-102',
      name: 'Cart Recovery W23',
      segmentName: 'Abandoned Cart (48h)',
      channel: 'sms',
      status: 'active',
      recipientCount: 312,
      messageContent: { body: '{{first_name}}, your {{preferred_category}} picks are still waiting. Complete checkout today and get 10% off.' },
      createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'cmp-103',
      name: 'New Arrivals Digest',
      segmentName: 'Active Buyers',
      channel: 'email',
      status: 'completed',
      recipientCount: 4500,
      messageContent: { subject: 'Fresh picks for {{first_name}}', body: 'Hi {{first_name}}, based on your {{preferred_category}} purchases and {{loyalty_tier}} tier, here are new arrivals selected for you.' },
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    }
  ];
  
  seedCampaigns.forEach(c => globalStore._campaignStore!.set(c.id, c));
}

const campaignStore = globalStore._campaignStore;

export async function POST(request: NextRequest) {
  // Rate limiting
  const rateLimitResponse = checkRateLimit(request, apiRateLimiter);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // Validate campaign creation request
    const validation = await validateBody(request, campaignSchema);
    if (!validation.success) {
      return validation.response;
    }

    const body = validation.data as unknown as CampaignPostBody;
    const normalized = normalizeCampaignRequest(body);

    if (!normalized.isValid || !normalized.name || !normalized.messageContent?.body) {
      return NextResponse.json(
        { error: 'Missing required fields: campaignName, messageContent.body' },
        { status: 400 }
      );
    }

    const campaignId = uuidv4();

    // Resolve segment membership from the compiled audience predicate.
    // Fallback keeps the demo sendable when a campaign is launched without a saved segment.
    const candidatePool = getCustomerData();
    const matchedCustomers = body.segmentCriteria
      ? candidatePool.filter((customer) => evaluatePredicate(customer, body.segmentCriteria!))
      : candidatePool;
    const allCustomers = matchedCustomers.slice(0, normalized.recipientCount);
    const recipients = allCustomers.map(c => ({
      customerId: c.id,
      email: c.email,
      phone: c.phone,
      name: c.name,
      totalSpend: c.totalSpend,
      orderCount: c.orderCount,
      avgOrderValue: c.avgOrderValue,
      lastOrderDate: c.lastOrderDate.toISOString(),
      properties: c.properties,
    }));

    // Store campaign metadata
    campaignStore.set(campaignId, {
      id: campaignId,
      name: normalized.name,
      segmentName: normalized.segmentName,
      channel: normalized.channel,
      status: 'dispatching',
      recipientCount: recipients.length,
      messageContent: { subject: normalized.messageContent.subject, body: normalized.messageContent.body },
      createdAt: new Date().toISOString(),
    });

    // Trigger async dispatch (non-blocking)
    const dispatchRequest: DispatchRequest = {
      campaignId,
      campaignName: normalized.name,
      channel: normalized.channel,
      recipients,
      messageContent: { subject: normalized.messageContent.subject, body: normalized.messageContent.body },
    };

    // Fire-and-forget: dispatch happens in background
    dispatchCampaign(dispatchRequest).then(result => {
      const campaign = campaignStore.get(campaignId);
      if (campaign) {
        campaign.status = 'active';
        campaign.dispatchResult = {
          dispatched: result.dispatched,
          failed: result.failed,
        };
      }
    });

    return NextResponse.json({
      status: 'dispatching',
      campaignId,
      name: normalized.name,
      channel: normalized.channel,
      recipientCount: recipients.length,
      initialStats: webhookProcessor.getCampaignStats(campaignId),
      message: `Campaign "${normalized.name}" is being dispatched to ${recipients.length} recipients via ${normalized.channel}`,
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create campaign', details: (error as Error).message },
      { status: 500 }
    );
  }
}

function evaluatePredicate(customer: SyntheticCustomer, node: PredicateNode): boolean {
  switch (node.type) {
    case 'and':
      return node.conditions.length === 0 || node.conditions.every((condition) => evaluatePredicate(customer, condition));
    case 'or':
      return node.conditions.some((condition) => evaluatePredicate(customer, condition));
    case 'not':
      return !evaluatePredicate(customer, node.condition);
    case 'field':
      return compareValues(getFieldValue(customer, node.field), node.op, node.value);
  }
}

function getFieldValue(customer: SyntheticCustomer, field: string): unknown {
  const props = customer.properties as Record<string, unknown>;
  const fieldMap: Record<string, () => unknown> = {
    total_spend: () => customer.totalSpend,
    order_count: () => customer.orderCount,
    last_order_date: () => customer.lastOrderDate,
    avg_order_value: () => customer.avgOrderValue,
    email: () => customer.email,
    name: () => customer.name,
    city: () => props.city,
    segment: () => props.segment,
    loyalty_tier: () => props.loyaltyTier,
    preferred_channel: () => props.preferredChannel,
    platform: () => props.platform,
    age_group: () => props.ageGroup,
    gender: () => props.gender,
    referral_source: () => props.referralSource,
    preferred_categories: () => props.preferredCategories,
    has_app: () => props.hasApp,
    accepts_marketing: () => props.acceptsMarketing,
    cart_abandoned: () => props.cartAbandoned,
  };

  return fieldMap[field]?.() ?? null;
}

function compareValues(actual: unknown, op: string, expected: unknown): boolean {
  if (actual === null || actual === undefined) return false;

  switch (op) {
    case '=':
      return actual === expected;
    case '!=':
      return actual !== expected;
    case '>':
      return (actual as number) > (expected as number);
    case '>=':
      return (actual as number) >= (expected as number);
    case '<':
      if (actual instanceof Date && typeof expected === 'number') {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - expected);
        return actual < cutoff;
      }
      return (actual as number) < (expected as number);
    case '<=':
      return (actual as number) <= (expected as number);
    case 'IN':
      return Array.isArray(expected) && expected.includes(actual as never);
    case 'CONTAINS':
      return Array.isArray(actual) && actual.includes(expected as never);
    default:
      return false;
  }
}

export async function GET(request: NextRequest) {
  // Rate limiting
  const rateLimitResponse = checkRateLimit(request, apiRateLimiter);
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  
  // Validate query parameters if filtering
  if (searchParams.toString() && !searchParams.get('campaignId')) {
    const validation = validateQuery(searchParams, campaignFilterSchema);
    if (!validation.success) {
      return validation.response;
    }
  }
  
  const campaignId = searchParams.get('campaignId');

  if (campaignId) {
    const campaign = campaignStore.get(campaignId);
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const stats = webhookProcessor.getCampaignStats(campaignId);
    const attribution = revenueAttribution.getCampaignAttributions().find((item) => item.campaignId === campaignId);
    return NextResponse.json({
      ...campaign,
      stats,
      attribution: attribution
        ? {
            orders: attribution.totalOrders,
            revenue: attribution.totalRevenue,
            roi: `${attribution.roi}x`,
            avgOrderValue: attribution.avgOrderValue,
          }
        : null,
    });
  }

  // Return all campaigns
  const campaigns = Array.from(campaignStore.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return NextResponse.json({ campaigns });
}
