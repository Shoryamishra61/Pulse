/**
 * PULSE CRM — Segments API
 * 
 * Manages persistent segment storage and evaluation.
 * 
 * POST: Create new segment with predicate rules
 * GET: List all segments with member counts
 * 
 * Reference: PRD FR-08 - Named Segment Storage & Management (P1-001 FIX)
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateBody, validateQuery, segmentSchema, paginationSchema } from '@/lib/middleware/validation';
import { apiRateLimiter, checkRateLimit } from '@/lib/middleware/rate-limiter';
import { segmentStore, type Segment } from '@/lib/services/segment-store';
import { compileAndEvaluatePredicate } from '@/lib/services/predicate-compiler';
import { getCustomerData } from '@/lib/services/customer-store';

/**
 * GET /api/segments
 * List all saved segments with member counts
 */
export async function GET(request: NextRequest) {
  // Rate limiting
  const rateLimitResponse = checkRateLimit(request, apiRateLimiter);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);
    const validation = validateQuery(searchParams, paginationSchema);
    
    if (!validation.success) {
      return validation.response;
    }

    const { page, limit, sort_by, sort_order } = validation.data;
    const segments = await segmentStore.listSegments();

    // Apply sorting
    let sorted = [...segments];
    if (sort_by === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort_by === 'member_count') {
      sorted.sort((a, b) => b.member_count - a.member_count);
    } else if (sort_by === 'updated_at') {
      sorted.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
    } else {
      // Default: sort by created_at desc
      sorted.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    }

    if (sort_order === 'asc') {
      sorted.reverse();
    }

    // Apply pagination
    const start = (page - 1) * limit;
    const end = start + limit;
    const paginated = sorted.slice(start, end);

    return NextResponse.json({
      success: true,
      data: {
        segments: paginated,
        total: segments.length,
        page,
        limit,
        total_pages: Math.ceil(segments.length / limit),
      },
    });
  } catch (error) {
    console.error('[Segments API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to list segments',
        },
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/segments
 * Create new segment and evaluate membership
 */
export async function POST(request: NextRequest) {
  // Rate limiting
  const rateLimitResponse = checkRateLimit(request, apiRateLimiter);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const validation = await validateBody(request, segmentSchema);
    
    if (!validation.success) {
      return validation.response;
    }

    const { name, description, predicate } = validation.data;

    // Evaluate segment to get member count
    const { customers } = getCustomerData();
    const matchingCustomers = compileAndEvaluatePredicate(predicate as any, customers);

    // Create segment
    const segment = await segmentStore.createSegment({
      name,
      description,
      predicate: predicate as any,
      member_count: matchingCustomers.length,
    });

    return NextResponse.json({
      success: true,
      data: {
        segment,
        members_preview: matchingCustomers.slice(0, 5).map(c => ({
          id: c.id,
          name: `${c.first_name} ${c.last_name}`,
          email: c.email,
          total_spend: c.total_spend,
          order_count: c.order_count,
        })),
      },
    }, { status: 201 });
  } catch (error) {
    console.error('[Segments API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create segment',
        },
      },
      { status: 500 }
    );
  }
}
