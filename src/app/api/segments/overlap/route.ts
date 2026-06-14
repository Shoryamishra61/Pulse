/**
 * PULSE CRM — Segment Overlap Analysis API
 * 
 * POST /api/segments/overlap — Analyze overlap between two segments
 * 
 * Returns:
 * - Intersection count
 * - Union count
 * - Overlap percentage
 * - Venn diagram data
 * - Sample customers in intersection
 * 
 * Reference: FR-09 (Segment Overlap Analysis)
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/middleware/validation';
import { apiRateLimiter, checkRateLimit } from '@/lib/middleware/rate-limiter';
import { compilePredicate } from '@/lib/services/predicate-compiler';
import { getCustomerData } from '@/lib/services/customer-store';
import type { SyntheticCustomer } from '@/lib/services/seed-data';
import { z } from 'zod';

const overlapRequestSchema = z.object({
  segment_a: z.object({
    name: z.string().optional(),
    predicate: z.record(z.unknown()),
  }),
  segment_b: z.object({
    name: z.string().optional(),
    predicate: z.record(z.unknown()),
  }),
  sample_size: z.number().int().min(1).max(50).default(10),
});

function evaluatePredicate(customer: SyntheticCustomer, predicate: any): boolean {
  // Implementation matches chat route logic
  const evaluateNode = (node: any): boolean => {
    switch (node.type) {
      case 'and':
        return node.conditions.length === 0 || node.conditions.every(evaluateNode);
      case 'or':
        return node.conditions.some(evaluateNode);
      case 'not':
        return !evaluateNode(node.condition);
      case 'field': {
        const val = getFieldValue(customer, node.field);
        return compareValues(val, node.op, node.value);
      }
      default:
        return false;
    }
  };

  return evaluateNode(predicate);
}

function getFieldValue(customer: SyntheticCustomer, field: string): unknown {
  const props = customer.properties as Record<string, unknown>;
  const fieldMap: Record<string, () => unknown> = {
    'total_spend': () => customer.totalSpend,
    'order_count': () => customer.orderCount,
    'last_order_date': () => customer.lastOrderDate,
    'avg_order_value': () => customer.avgOrderValue,
    'email': () => customer.email,
    'name': () => customer.name,
    'city': () => props.city,
    'segment': () => props.segment,
    'loyalty_tier': () => props.loyaltyTier,
    'preferred_channel': () => props.preferredChannel,
    'platform': () => props.platform,
    'age_group': () => props.ageGroup,
    'gender': () => props.gender,
    'referral_source': () => props.referralSource,
    'preferred_categories': () => props.preferredCategories,
    'has_app': () => props.hasApp,
    'accepts_marketing': () => props.acceptsMarketing,
    'cart_abandoned': () => props.cartAbandoned,
  };
  return fieldMap[field]?.() ?? null;
}

function compareValues(actual: unknown, op: string, expected: unknown): boolean {
  if (actual === null || actual === undefined) return false;

  switch (op) {
    case '=': return actual === expected;
    case '!=': return actual !== expected;
    case '>': return (actual as number) > (expected as number);
    case '>=': return (actual as number) >= (expected as number);
    case '<': {
      if (actual instanceof Date && typeof expected === 'number') {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - expected);
        return actual < cutoff;
      }
      return (actual as number) < (expected as number);
    }
    case '<=': return (actual as number) <= (expected as number);
    case 'IN': return Array.isArray(expected) && expected.includes(actual);
    case 'CONTAINS': return Array.isArray(actual) && actual.includes(expected);
    default: return false;
  }
}

export async function POST(request: NextRequest) {
  // Rate limiting
  const rateLimitResponse = checkRateLimit(request, apiRateLimiter);
  if (rateLimitResponse) return rateLimitResponse;

  // Validate request body
  const validation = await validateBody(request, overlapRequestSchema);
  if (!validation.success) {
    return validation.response;
  }

  const { segment_a, segment_b, sample_size } = validation.data;

  try {
    // Get all customers
    const allCustomers = getCustomerData();

    // Evaluate both segments
    const customersInA = new Set<string>();
    const customersInB = new Set<string>();
    const customersInBoth: SyntheticCustomer[] = [];
    const customersInOnlyA: SyntheticCustomer[] = [];
    const customersInOnlyB: SyntheticCustomer[] = [];

    for (const customer of allCustomers) {
      const inA = evaluatePredicate(customer, segment_a.predicate);
      const inB = evaluatePredicate(customer, segment_b.predicate);

      if (inA) {
        customersInA.add(customer.id);
      }
      if (inB) {
        customersInB.add(customer.id);
      }

      if (inA && inB) {
        customersInBoth.push(customer);
      } else if (inA) {
        customersInOnlyA.push(customer);
      } else if (inB) {
        customersInOnlyB.push(customer);
      }
    }

    // Calculate metrics
    const countA = customersInA.size;
    const countB = customersInB.size;
    const countIntersection = customersInBoth.length;
    const countUnion = countA + countB - countIntersection;
    const overlapPercentage = countUnion > 0 ? Math.round((countIntersection / countUnion) * 100) : 0;
    const jaccardIndex = countUnion > 0 ? (countIntersection / countUnion).toFixed(3) : '0.000';

    // Compile SQL for reference (if predicates are compilable)
    let compiledA, compiledB;
    try {
      compiledA = compilePredicate(segment_a.predicate);
    } catch (e) {
      compiledA = null;
    }
    try {
      compiledB = compilePredicate(segment_b.predicate);
    } catch (e) {
      compiledB = null;
    }

    // Generate insights
    const insights: string[] = [];

    if (overlapPercentage > 80) {
      insights.push('⚠️ High overlap: These segments are nearly identical. Consider consolidating.');
    } else if (overlapPercentage > 50) {
      insights.push('🔶 Moderate overlap: Some audience duplication exists.');
    } else if (overlapPercentage < 10) {
      insights.push('✅ Low overlap: These segments are highly distinct, good for targeted campaigns.');
    }

    if (countIntersection > 0 && countIntersection < 50) {
      insights.push('💡 Small intersection: This is a highly specific niche audience.');
    }

    if (countA > countB * 3) {
      insights.push(`📊 Segment A is ${Math.round(countA / (countB || 1))}x larger than Segment B.`);
    } else if (countB > countA * 3) {
      insights.push(`📊 Segment B is ${Math.round(countB / (countA || 1))}x larger than Segment A.`);
    }

    return NextResponse.json({
      success: true,
      analysis: {
        segment_a: {
          name: segment_a.name || 'Segment A',
          total_count: countA,
          exclusive_count: customersInOnlyA.length,
        },
        segment_b: {
          name: segment_b.name || 'Segment B',
          total_count: countB,
          exclusive_count: customersInOnlyB.length,
        },
        overlap: {
          intersection_count: countIntersection,
          union_count: countUnion,
          overlap_percentage: overlapPercentage,
          jaccard_index: parseFloat(jaccardIndex),
        },
        venn_diagram: {
          only_a: customersInOnlyA.length,
          only_b: customersInOnlyB.length,
          both: countIntersection,
        },
        insights,
      },
      samples: {
        intersection: customersInBoth.slice(0, sample_size).map(c => ({
          id: c.id,
          name: c.name,
          email: c.email,
          total_spend: c.totalSpend,
          segment: (c.properties as Record<string, string>).segment,
          city: (c.properties as Record<string, string>).city,
        })),
        only_a: customersInOnlyA.slice(0, sample_size).map(c => ({
          id: c.id,
          name: c.name,
          email: c.email,
          total_spend: c.totalSpend,
          segment: (c.properties as Record<string, string>).segment,
        })),
        only_b: customersInOnlyB.slice(0, sample_size).map(c => ({
          id: c.id,
          name: c.name,
          email: c.email,
          total_spend: c.totalSpend,
          segment: (c.properties as Record<string, string>).segment,
        })),
      },
      compiled_queries: {
        segment_a: compiledA ? {
          sql: compiledA.parameterizedSQL,
          params: compiledA.params,
        } : null,
        segment_b: compiledB ? {
          sql: compiledB.parameterizedSQL,
          params: compiledB.params,
        } : null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to analyze segment overlap',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
