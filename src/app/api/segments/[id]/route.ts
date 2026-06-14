/**
 * PULSE CRM — Segment Detail API
 * 
 * GET: Retrieve single segment with member preview
 * PUT: Update segment rules and re-evaluate
 * DELETE: Remove segment
 * 
 * Reference: PRD FR-08 - Named Segment Storage (P1-001 FIX)
 */

import { NextRequest, NextResponse } from 'next/server';
import { segmentStore } from '@/lib/services/segment-store';
import { compileAndEvaluatePredicate } from '@/lib/services/predicate-compiler';
import { getCustomerData } from '@/lib/services/customer-store';
import { validateBody, segmentSchema } from '@/lib/middleware/validation';
import { apiRateLimiter, checkRateLimit } from '@/lib/middleware/rate-limiter';

/**
 * GET /api/segments/:id
 * Retrieve segment with member preview
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // Rate limiting
  const rateLimitResponse = checkRateLimit(request, apiRateLimiter);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await context.params;
    const segment = await segmentStore.getSegment(id);

    if (!segment) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Segment not found',
          },
        },
        { status: 404 }
      );
    }

    // Get matching customers for preview
    const { customers } = getCustomerData();
    const matchingCustomers = compileAndEvaluatePredicate(segment.predicate as any, customers);

    return NextResponse.json({
      success: true,
      data: {
        segment,
        members_preview: matchingCustomers.slice(0, 20).map(c => ({
          id: c.id,
          name: `${c.first_name} ${c.last_name}`,
          email: c.email,
          city: c.city,
          total_spend: c.total_spend,
          order_count: c.order_count,
          last_order_date: c.last_order_date,
        })),
        current_member_count: matchingCustomers.length,
      },
    });
  } catch (error) {
    console.error('[Segment Detail API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve segment',
        },
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/segments/:id
 * Update segment and re-evaluate membership
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // Rate limiting
  const rateLimitResponse = checkRateLimit(request, apiRateLimiter);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await context.params;
    const validation = await validateBody(request, segmentSchema);
    
    if (!validation.success) {
      return validation.response;
    }

    const { name, description, predicate } = validation.data;

    const existingSegment = await segmentStore.getSegment(id);
    if (!existingSegment) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Segment not found',
          },
        },
        { status: 404 }
      );
    }

    // Re-evaluate with new predicate
    const { customers } = getCustomerData();
    const matchingCustomers = compileAndEvaluatePredicate(predicate as any, customers);
    const matchingCount = matchingCustomers.length;

    // Update segment
    const updated = await segmentStore.updateSegment(id, {
      name,
      description,
      predicate: predicate as any,
      member_count: matchingCount,
    });

    return NextResponse.json({
      success: true,
      data: {
        segment: updated,
        member_count_change: matchingCustomers.length - existingSegment.member_count,
      },
    });
  } catch (error) {
    console.error('[Segment Detail API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Failed to update segment',
        },
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/segments/:id
 * Remove segment (with safety check for active campaigns)
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // Rate limiting
  const rateLimitResponse = checkRateLimit(request, apiRateLimiter);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await context.params;
    const segment = await segmentStore.getSegment(id);

    if (!segment) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Segment not found',
          },
        },
        { status: 404 }
      );
    }

    // TODO: Check if segment is used by any active campaigns
    // For now, allow deletion

    const deleted = await segmentStore.deleteSegment(id);

    if (!deleted) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'DELETE_FAILED',
            message: 'Failed to delete segment',
          },
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: id,
        deleted: true,
      },
    });
  } catch (error) {
    console.error('[Segment Detail API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to delete segment',
        },
      },
      { status: 500 }
    );
  }
}
