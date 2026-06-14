/**
 * PULSE CRM — Customer Detail API
 * 
 * GET /api/customers/:id — Get detailed customer profile
 * 
 * Returns comprehensive customer data including:
 * - Personal information
 * - Order history with timeline
 * - Campaign engagement history
 * - RFM analysis
 * - AI-powered next action recommendations
 * 
 * Reference: GAP-017 (Customer Profile Detail View)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCustomerData, getOrderData } from '@/lib/services/customer-store';
import { webhookProcessor } from '@/lib/services/webhook-processor';
import { apiRateLimiter, checkRateLimit } from '@/lib/middleware/rate-limiter';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // Rate limiting
  const rateLimitResponse = checkRateLimit(request, apiRateLimiter);
  if (rateLimitResponse) return rateLimitResponse;

  const { id: customerId } = await context.params;

  try {
    // Find customer
    const customers = getCustomerData();
    const customer = customers.find(c => c.id === customerId);

    if (!customer) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Customer not found',
          },
        },
        { status: 404 }
      );
    }

    // Get order history
    const orders = getOrderData().filter(o => o.customerEmail === customer.email);
    const sortedOrders = orders.sort((a, b) => 
      new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime()
    );

    // Get communication history
    const communications = webhookProcessor.getCustomerMessages(customer.id)
      .sort((a, b) => {
        const aDate = new Date(a.sentAt || a.deliveredAt || a.createdAt || 0);
        const bDate = new Date(b.sentAt || b.deliveredAt || b.createdAt || 0);
        return bDate.getTime() - aDate.getTime();
      });

    // Calculate engagement metrics
    const engagementMetrics = {
      totalMessages: communications.length,
      delivered: communications.filter(m => 
        ['delivered', 'opened', 'read', 'clicked', 'converted'].includes(m.status)
      ).length,
      opened: communications.filter(m => 
        ['opened', 'read', 'clicked', 'converted'].includes(m.status)
      ).length,
      clicked: communications.filter(m => 
        ['clicked', 'converted'].includes(m.status)
      ).length,
      converted: communications.filter(m => m.status === 'converted').length,
      deliveryRate: communications.length > 0
        ? Math.round((communications.filter(m => ['delivered', 'opened', 'read', 'clicked', 'converted'].includes(m.status)).length / communications.length) * 100)
        : 0,
      openRate: communications.filter(m => ['delivered', 'opened', 'read', 'clicked', 'converted'].includes(m.status)).length > 0
        ? Math.round((communications.filter(m => ['opened', 'read', 'clicked', 'converted'].includes(m.status)).length / communications.filter(m => ['delivered', 'opened', 'read', 'clicked', 'converted'].includes(m.status)).length) * 100)
        : 0,
      clickRate: communications.filter(m => ['opened', 'read', 'clicked', 'converted'].includes(m.status)).length > 0
        ? Math.round((communications.filter(m => ['clicked', 'converted'].includes(m.status)).length / communications.filter(m => ['opened', 'read', 'clicked', 'converted'].includes(m.status)).length) * 100)
        : 0,
    };

    // Calculate RFM metrics
    const daysSinceLastOrder = customer.lastOrderDate
      ? Math.floor((Date.now() - new Date(customer.lastOrderDate).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const props = customer.properties as Record<string, any>;
    const rfmScore = {
      recency: daysSinceLastOrder !== null && daysSinceLastOrder <= 30 ? 5 :
                daysSinceLastOrder !== null && daysSinceLastOrder <= 60 ? 4 :
                daysSinceLastOrder !== null && daysSinceLastOrder <= 90 ? 3 :
                daysSinceLastOrder !== null && daysSinceLastOrder <= 180 ? 2 : 1,
      frequency: customer.orderCount >= 10 ? 5 :
                 customer.orderCount >= 7 ? 4 :
                 customer.orderCount >= 5 ? 3 :
                 customer.orderCount >= 3 ? 2 : 1,
      monetary: customer.totalSpend >= 50000 ? 5 :
                customer.totalSpend >= 25000 ? 4 :
                customer.totalSpend >= 10000 ? 3 :
                customer.totalSpend >= 5000 ? 2 : 1,
    };
    const rfmTotal = rfmScore.recency + rfmScore.frequency + rfmScore.monetary;

    // Generate AI-powered next action recommendations
    const nextActions: Array<{
      action: string;
      reasoning: string;
      priority: 'high' | 'medium' | 'low';
      channel: string;
    }> = [];

    // Recommendation logic
    if (daysSinceLastOrder !== null && daysSinceLastOrder > 60 && customer.totalSpend > 10000) {
      nextActions.push({
        action: 'Send win-back campaign',
        reasoning: `High-value customer (₹${customer.totalSpend.toLocaleString()}) hasn't ordered in ${daysSinceLastOrder} days. Offer personalized discount on their favorite category: ${props.preferredCategories?.[0] || 'their preferred category'}.`,
        priority: 'high',
        channel: props.preferredChannel || 'whatsapp',
      });
    }

    if (props.cartAbandoned && daysSinceLastOrder !== null && daysSinceLastOrder < 7) {
      nextActions.push({
        action: 'Cart abandonment reminder',
        reasoning: 'Customer has items in cart and ordered recently. Send gentle reminder with time-limited offer.',
        priority: 'high',
        channel: props.preferredChannel || 'email',
      });
    }

    if (customer.orderCount >= 5 && !props.loyaltyTier) {
      nextActions.push({
        action: 'Invite to loyalty program',
        reasoning: `${customer.orderCount} orders completed but not in loyalty program. Highlight exclusive benefits and rewards.`,
        priority: 'medium',
        channel: props.preferredChannel || 'email',
      });
    }

    if (engagementMetrics.delivered > 0 && engagementMetrics.openRate < 20) {
      nextActions.push({
        action: 'Re-engagement campaign',
        reasoning: `Low engagement rate (${engagementMetrics.openRate}% open rate). Try different channel or content strategy.`,
        priority: 'medium',
        channel: props.preferredChannel === 'email' ? 'whatsapp' : 'email',
      });
    }

    if (customer.totalSpend > 30000 && daysSinceLastOrder !== null && daysSinceLastOrder < 30) {
      nextActions.push({
        action: 'VIP early access campaign',
        reasoning: 'High-value active customer. Provide early access to new launches or exclusive sales.',
        priority: 'medium',
        channel: props.preferredChannel || 'whatsapp',
      });
    }

    if (nextActions.length === 0) {
      nextActions.push({
        action: 'Regular newsletter',
        reasoning: 'Customer is engaged. Continue nurturing with regular updates and personalized recommendations.',
        priority: 'low',
        channel: props.preferredChannel || 'email',
      });
    }

    // Build timeline (orders + communications)
    const timeline = [
      ...sortedOrders.map(order => ({
        type: 'order' as const,
        id: order.id,
        date: new Date(order.orderDate).toISOString(),
        title: `Order placed`,
        description: `${order.category} - ₹${order.orderValue.toLocaleString()}`,
        amount: order.orderValue,
        status: order.status,
      })),
      ...communications.map(comm => ({
        type: 'communication' as const,
        id: comm.id,
        date: new Date(comm.sentAt || comm.createdAt || 0).toISOString(),
        title: `${comm.channel} message`,
        description: comm.campaignName || `Campaign ${comm.campaignId.slice(0, 8)}`,
        status: comm.status,
        channel: comm.channel,
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Category analysis
    const categoryStats = sortedOrders.reduce((acc, order) => {
      const cat = order.category;
      if (!acc[cat]) {
        acc[cat] = { count: 0, total: 0 };
      }
      acc[cat].count++;
      acc[cat].total += order.orderValue;
      return acc;
    }, {} as Record<string, { count: number; total: number }>);

    const topCategories = Object.entries(categoryStats)
      .map(([category, stats]) => ({
        category,
        orders: stats.count,
        spend: stats.total,
        avgOrderValue: Math.round(stats.total / stats.count),
      }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 5);

    return NextResponse.json({
      success: true,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        properties: customer.properties,
        totalSpend: customer.totalSpend,
        orderCount: customer.orderCount,
        avgOrderValue: customer.avgOrderValue,
        lastOrderDate: customer.lastOrderDate,
        daysSinceLastOrder,
      },
      rfm: {
        scores: rfmScore,
        total: rfmTotal,
        label: rfmTotal >= 12 ? 'Champion' :
               rfmTotal >= 9 ? 'Loyal' :
               rfmTotal >= 6 ? 'Potential' :
               rfmTotal >= 4 ? 'At Risk' : 'Lost',
      },
      engagement: engagementMetrics,
      categories: topCategories,
      orders: {
        total: sortedOrders.length,
        recent: sortedOrders.slice(0, 10).map(order => ({
          id: order.id,
          orderId: order.orderId,
          date: order.orderDate,
          amount: order.orderValue,
          category: order.category,
          status: order.status,
          items: order.items,
        })),
      },
      communications: {
        total: communications.length,
        recent: communications.slice(0, 10).map(comm => ({
          id: comm.id,
          campaignId: comm.campaignId,
          campaignName: comm.campaignName,
          channel: comm.channel,
          status: comm.status,
          sentAt: comm.sentAt,
          deliveredAt: comm.deliveredAt,
          openedAt: comm.openedAt || comm.readAt,
          clickedAt: comm.clickedAt,
        })),
      },
      timeline: timeline.slice(0, 20),
      nextActions,
      insights: {
        segment: props.segment,
        loyaltyTier: props.loyaltyTier,
        preferredChannel: props.preferredChannel,
        preferredCategories: props.preferredCategories,
        platform: props.platform,
        hasApp: props.hasApp,
        acceptsMarketing: props.acceptsMarketing,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch customer details',
          details: (error as Error).message,
        },
      },
      { status: 500 }
    );
  }
}
