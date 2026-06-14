/**
 * PULSE CRM — Revenue Attribution Service
 * 
 * Architecture Decision: MATHEMATICAL DATA ATTRIBUTION
 * 
 * When an order is ingested, the system must mathematically map it
 * back to the campaign communication that caused it.
 * 
 * Model: Last-Touch Attribution with 7-Day Lookback Window
 * 
 * Logic:
 * 1. When an order arrives for customer X:
 *    - Look back 7 days for any campaign message delivered to X
 *    - If found → attribute the order revenue to that campaign
 *    - If multiple → attribute to the MOST RECENT (last-touch)
 * 2. Store attribution link: order_id → message_id → campaign_id
 * 3. Aggregate: campaign → total attributed orders → total revenue → ROI
 * 
 * Trade-off: Last-Touch is standard for D2C messaging. At scale,
 * multi-touch position-based attribution would be more accurate
 * (e.g., 40% first-touch, 20% middle, 40% last-touch).
 * 
 * Reference: Google Analytics attribution models
 */

import { v4 as uuidv4 } from 'uuid';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AttributionRecord {
  id: string;
  orderId: string;
  orderAmount: number;
  customerId: string;
  customerEmail: string;
  messageId: string;
  campaignId: string;
  campaignName: string;
  channel: string;
  touchTimestamp: string;    // When the campaign message was delivered
  orderTimestamp: string;    // When the order was placed
  lookbackDays: number;     // How many days between touch and conversion
  model: 'last_touch';
  attributedAt: string;
}

export interface CampaignAttribution {
  campaignId: string;
  campaignName: string;
  channel: string;
  totalOrders: number;
  totalRevenue: number;
  avgOrderValue: number;
  roi: number;              // Revenue / Cost (estimated)
  attributions: AttributionRecord[];
}

// ─── In-Memory Store ─────────────────────────────────────────────────────────
// In production: PostgreSQL `revenue_attributions` table

interface DeliveredMessage {
  messageId: string;
  campaignId: string;
  campaignName: string;
  customerId: string;
  customerEmail: string;
  channel: string;
  deliveredAt: string;
}

class RevenueAttributionService {
  private attributions: Map<string, AttributionRecord> = new Map();
  private deliveredMessages: DeliveredMessage[] = [];
  private campaignCosts: Map<string, number> = new Map();

  private readonly LOOKBACK_WINDOW_DAYS = 7;

  /**
   * Record a message delivery (called when webhook reports "delivered")
   */
  recordDelivery(msg: DeliveredMessage): void {
    this.deliveredMessages.push(msg);

    // Estimate campaign cost (₹0.50 per message as baseline)
    const current = this.campaignCosts.get(msg.campaignId) || 0;
    this.campaignCosts.set(msg.campaignId, current + 0.5);
  }

  /**
   * Attribute an order to a campaign using Last-Touch 7-Day Lookback
   * Returns the attribution record if found, null if no touch in window
   */
  attributeOrder(order: {
    orderId: string;
    amount: number;
    customerId: string;
    customerEmail: string;
    orderDate: string;
  }): AttributionRecord | null {
    const orderTime = new Date(order.orderDate).getTime();
    const windowStart = orderTime - this.LOOKBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    // Find all messages delivered to this customer within the lookback window
    const touches = this.deliveredMessages.filter(msg => {
      const deliveryTime = new Date(msg.deliveredAt).getTime();
      return (
        (msg.customerId === order.customerId || msg.customerEmail === order.customerEmail) &&
        deliveryTime >= windowStart &&
        deliveryTime <= orderTime
      );
    });

    if (touches.length === 0) return null;

    // Last-Touch: pick the most recent delivery
    const lastTouch = touches.sort(
      (a, b) => new Date(b.deliveredAt).getTime() - new Date(a.deliveredAt).getTime()
    )[0];

    const lookbackDays = Math.round(
      (orderTime - new Date(lastTouch.deliveredAt).getTime()) / (24 * 60 * 60 * 1000)
    );

    const record: AttributionRecord = {
      id: uuidv4(),
      orderId: order.orderId,
      orderAmount: order.amount,
      customerId: order.customerId,
      customerEmail: order.customerEmail,
      messageId: lastTouch.messageId,
      campaignId: lastTouch.campaignId,
      campaignName: lastTouch.campaignName,
      channel: lastTouch.channel,
      touchTimestamp: lastTouch.deliveredAt,
      orderTimestamp: order.orderDate,
      lookbackDays,
      model: 'last_touch',
      attributedAt: new Date().toISOString(),
    };

    this.attributions.set(record.id, record);
    return record;
  }

  /**
   * Get attribution summary per campaign
   */
  getCampaignAttributions(): CampaignAttribution[] {
    const campaignMap = new Map<string, CampaignAttribution>();

    for (const attr of this.attributions.values()) {
      let campaign = campaignMap.get(attr.campaignId);
      if (!campaign) {
        campaign = {
          campaignId: attr.campaignId,
          campaignName: attr.campaignName,
          channel: attr.channel,
          totalOrders: 0,
          totalRevenue: 0,
          avgOrderValue: 0,
          roi: 0,
          attributions: [],
        };
        campaignMap.set(attr.campaignId, campaign);
      }

      campaign.totalOrders += 1;
      campaign.totalRevenue += attr.orderAmount;
      campaign.attributions.push(attr);
    }

    // Calculate averages and ROI
    for (const campaign of campaignMap.values()) {
      campaign.avgOrderValue = Math.round(campaign.totalRevenue / campaign.totalOrders);
      const cost = this.campaignCosts.get(campaign.campaignId) || 1;
      campaign.roi = Math.round((campaign.totalRevenue / cost) * 10) / 10;
    }

    return Array.from(campaignMap.values())
      .sort((a, b) => b.totalRevenue - a.totalRevenue);
  }

  /**
   * Get all attributions
   */
  getAllAttributions(): AttributionRecord[] {
    return Array.from(this.attributions.values());
  }

  /**
   * Get summary stats
   */
  getSummary(): {
    totalAttributedOrders: number;
    totalAttributedRevenue: number;
    avgLookbackDays: number;
    model: string;
    lookbackWindow: string;
  } {
    const records = Array.from(this.attributions.values());
    const totalRevenue = records.reduce((sum, r) => sum + r.orderAmount, 0);
    const avgDays = records.length > 0
      ? Math.round(records.reduce((sum, r) => sum + r.lookbackDays, 0) / records.length)
      : 0;

    return {
      totalAttributedOrders: records.length,
      totalAttributedRevenue: totalRevenue,
      avgLookbackDays: avgDays,
      model: 'Last-Touch',
      lookbackWindow: `${this.LOOKBACK_WINDOW_DAYS} days`,
    };
  }
}

// Persist across Next.js dev hot reloads and route module boundaries.
declare global {
  // eslint-disable-next-line no-var
  var _pulseRevenueAttribution: RevenueAttributionService | undefined;
}

function getRevenueAttributionService(): RevenueAttributionService {
  if (!globalThis._pulseRevenueAttribution) {
    globalThis._pulseRevenueAttribution = new RevenueAttributionService();
    seedDemoAttributions(globalThis._pulseRevenueAttribution);
  }
  return globalThis._pulseRevenueAttribution;
}

export const revenueAttribution = getRevenueAttributionService();

// ─── Seed Demo Data ──────────────────────────────────────────────────────────
// Pre-populate with realistic attribution data for the demo

function seedDemoAttributions(service: RevenueAttributionService) {
  const campaigns = [
    { id: 'camp-diwali', name: 'Diwali VIP Offer', channel: 'whatsapp' },
    { id: 'camp-cart', name: 'Cart Recovery W23', channel: 'email' },
    { id: 'camp-arrivals', name: 'New Arrivals', channel: 'email' },
  ];

  // Simulate delivered messages
  for (const campaign of campaigns) {
    const msgCount = campaign.id === 'camp-diwali' ? 2340 : campaign.id === 'camp-cart' ? 847 : 420;
    for (let i = 0; i < Math.min(msgCount, 200); i++) {
      service.recordDelivery({
        messageId: `msg-${campaign.id}-${i}`,
        campaignId: campaign.id,
        campaignName: campaign.name,
        customerId: `cust-${i}`,
        customerEmail: `customer${i}@example.com`,
        channel: campaign.channel,
        deliveredAt: new Date(Date.now() - Math.random() * 5 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }
  }

  // Simulate orders attributed to campaigns
  const attributionData = [
    { campaignId: 'camp-diwali', orders: 68, avgAmount: 7647 },
    { campaignId: 'camp-cart', orders: 34, avgAmount: 5294 },
    { campaignId: 'camp-arrivals', orders: 12, avgAmount: 5000 },
  ];

  for (const data of attributionData) {
    for (let i = 0; i < data.orders; i++) {
      const amount = data.avgAmount + (Math.random() - 0.5) * 2000;
      service.attributeOrder({
        orderId: `order-${data.campaignId}-${i}`,
        amount: Math.round(amount),
        customerId: `cust-${i}`,
        customerEmail: `customer${i}@example.com`,
        orderDate: new Date(Date.now() - Math.random() * 3 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }
  }
}
