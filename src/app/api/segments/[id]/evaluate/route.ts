/**
 * PULSE CRM — Segment Re-evaluation API
 * 
 * POST: Force re-evaluation of segment membership
 * 
 * Reference: PRD FR-08 - Re-evaluate segment after data changes
 */

import { NextRequest, NextResponse } from 'next/server';
import { segmentStore } from '@/lib/services/segment-store';
import { compileAndEvaluatePredicate } from '@/lib/services/predicate-compiler';
import { getCustomerData } from '@/lib/services/customer-store';
import { apiRateLimiter, checkRateLimit } from '@/lib/middleware/rate-limiter';

/**
 * POST /api/segments/:id/evaluate
 * Re-evaluate segment membership with current customer data
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // Rate limiting
  const rateLimitResponse = checkRateLimit(request, apiRateLimiter);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await context.params;
    const segment = segmentStore.getSegment(id);

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

    const previousCount = segment.member_count;

    // Re-evaluate with current customer data
    const { customers } = getCustomerData();
    const matchingCustomers = compileAndEvaluatePredicate(segment.predicate, customers);
    const newCount = matchingCustomers.length;

    // Update segment with new count
    const updated = segmentStore.reevaluateSegment(id, newCount);

    return NextResponse.json({
      success: true,
      data: {
        segment: updated,
        previous_count: previousCount,
        new_count: newCount,
        change: newCount - previousCount,
        percentage_change: previousCount > 0 
          ? ((newCount - previousCount) / previousCount * 100).toFixed(1) + '%'
          : 'N/A',
      },
    });
  } catch (error) {
    console.error('[Segment Evaluate API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Failed to re-evaluate segment',
        },
      },
      { status: 500 }
    );
  }
}
