/**
 * PULSE CRM — Customer Ingestion API
 * 
 * POST: Ingest customers and orders from external sources
 * GET: Retrieve customer data with filtering
 * 
 * This endpoint handles the hybrid relational+JSONB schema.
 * Static identifiers go into relational columns.
 * Dynamic properties go into the JSONB column with GIN indexing.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  appendCustomerData,
  getCustomerData,
  getOrderData,
  resetCustomerData,
} from '@/lib/services/customer-store';
import type { SyntheticCustomer } from '@/lib/services/seed-data';
import { webhookProcessor } from '@/lib/services/webhook-processor';
import { validateQuery, validateBody, customerFilterSchema, ingestionSchema } from '@/lib/middleware/validation';
import { apiRateLimiter, checkRateLimit } from '@/lib/middleware/rate-limiter';

const customerData = () => getCustomerData();
const orderData = () => getOrderData();

export async function GET(request: NextRequest) {
  // Rate limiting
  const rateLimitResponse = checkRateLimit(request, apiRateLimiter);
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  // Handle single customer detail request
  if (id) {
    // Validate ID is UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { 
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid customer ID format' } 
        },
        { status: 400 }
      );
    }

    const customer = customerData().find(c => c.id === id);
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }
    
    const orders = orderData().filter(o => o.customerEmail === customer.email);
    const communicationHistory = webhookProcessor.getCustomerMessages(customer.id)
      .sort((a, b) => new Date(b.sentAt || b.deliveredAt || b.createdAt || 0).getTime() - new Date(a.sentAt || a.deliveredAt || a.createdAt || 0).getTime())
      .slice(0, 25)
      .map((message) => ({
        messageId: message.id,
        campaignId: message.campaignId,
        campaignName: message.campaignName || `Campaign ${message.campaignId.slice(0, 8)}`,
        channel: message.channel || 'email',
        status: message.status,
        sentAt: message.sentAt,
        deliveredAt: message.deliveredAt,
        openedAt: message.openedAt || message.readAt,
        clickedAt: message.clickedAt,
      }));
    const engagementMetrics = {
      totalMessages: communicationHistory.length,
      delivered: communicationHistory.filter((m) => ['delivered', 'opened', 'read', 'clicked', 'converted'].includes(m.status)).length,
      opened: communicationHistory.filter((m) => ['opened', 'read', 'clicked', 'converted'].includes(m.status)).length,
      clicked: communicationHistory.filter((m) => ['clicked', 'converted'].includes(m.status)).length,
      preferredChannel: customer.properties.preferredChannel,
      lastEngagementAt: communicationHistory.find((m) => m.clickedAt || m.openedAt || m.deliveredAt)?.clickedAt
        || communicationHistory.find((m) => m.clickedAt || m.openedAt || m.deliveredAt)?.openedAt
        || communicationHistory.find((m) => m.clickedAt || m.openedAt || m.deliveredAt)?.deliveredAt
        || null,
    };
    return NextResponse.json({ customer, orders, communicationHistory, engagementMetrics });
  }

  // Validate query parameters
  const validation = validateQuery(searchParams, customerFilterSchema);
  if (!validation.success) {
    return validation.response;
  }

  const { limit, page, segment, city, min_spend } = validation.data;
  const offset = (page - 1) * limit;

  let filtered = [...customerData()];

  // Apply filters (simulates GIN-indexed JSONB queries)
  if (segment) {
    filtered = filtered.filter(c => (c.properties as Record<string, string>).segment === segment);
  }
  if (city) {
    filtered = filtered.filter(c => (c.properties as Record<string, string>).city === city);
  }
  if (min_spend !== undefined) {
    filtered = filtered.filter(c => c.totalSpend >= min_spend);
  }

  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);

  return NextResponse.json({
    customers: paginated,
    pagination: { total, limit, offset, hasMore: offset + limit < total },
  });
}

export async function POST(request: NextRequest) {
  // Rate limiting
  const rateLimitResponse = checkRateLimit(request, apiRateLimiter);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const validation = await validateBody(request, ingestionSchema);
    if (!validation.success) {
      return validation.response;
    }
    const { customers, orders } = validation.data;

    if (customers && Array.isArray(customers) && customers.length > 0) {
      appendCustomerData(customers as SyntheticCustomer[], (orders as any) || []);
    } else if (!customers && !orders) {
      resetCustomerData();
    }

    return NextResponse.json({
      status: 'success',
      customerCount: customerData().length,
      orderCount: orderData().length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Ingestion failed', details: (error as Error).message },
      { status: 500 }
    );
  }
}
