/**
 * PULSE CRM — Input Validation Middleware
 * 
 * Centralized Zod-based validation for all API endpoints.
 * Pattern: Schema-first validation with detailed error reporting.
 * 
 * Reference: SRS §12.2 - Input Validation Specification (P0-002 FIX)
 */

import { z, ZodSchema, ZodError } from 'zod';
import { NextResponse } from 'next/server';

/**
 * Validation error response format
 */
interface ValidationErrorResponse {
  success: false;
  error: {
    code: 'VALIDATION_ERROR';
    message: string;
    details: Array<{
      field: string;
      issue: string;
      received?: unknown;
    }>;
  };
}

/**
 * Format Zod errors into user-friendly structure
 */
function formatZodError(error: ZodError): ValidationErrorResponse {
  const issues = error.issues || error.errors || [];
  return {
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: issues[0]?.message || 'Validation failed',
      details: issues.map((err) => ({
        field: err.path.join('.'),
        issue: err.message,
        received: err.code === 'invalid_type' ? (err as any).received : undefined,
      })),
    },
  };
}

/**
 * Validate request body against Zod schema
 */
export async function validateBody<T>(
  request: Request,
  schema: ZodSchema<T>
): Promise<{ success: true; data: T } | { success: false; response: NextResponse }> {
  try {
    const body = await request.json();
    const validated = schema.parse(body);
    return { success: true, data: validated };
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        success: false,
        response: NextResponse.json(formatZodError(error), { status: 400 }),
      };
    }
    if (error instanceof SyntaxError) {
      return {
        success: false,
        response: NextResponse.json(
          {
            success: false,
            error: {
              code: 'INVALID_JSON',
              message: 'Request body must be valid JSON',
              details: [],
            },
          },
          { status: 400 }
        ),
      };
    }
    throw error;
  }
}

/**
 * Validate query parameters against Zod schema
 */
export function validateQuery<T>(
  searchParams: URLSearchParams,
  schema: ZodSchema<T>
): { success: true; data: T } | { success: false; response: NextResponse } {
  try {
    const params = Object.fromEntries(searchParams.entries());
    const validated = schema.parse(params);
    return { success: true, data: validated };
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        success: false,
        response: NextResponse.json(formatZodError(error), { status: 400 }),
      };
    }
    throw error;
  }
}

// =============================================================================
// COMMON VALIDATION SCHEMAS
// =============================================================================

/**
 * Customer creation/update schema
 */
export const customerSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  city: z.string().optional(),
  gender: z.enum(['male', 'female', 'other', 'unspecified']).optional(),
  tags: z.array(z.string()).optional(),
  properties: z.record(z.unknown()).optional(),
});

/**
 * Order creation schema
 */
export const orderSchema = z.object({
  customer_email: z.string().email(),
  order_value: z.number().positive('Order value must be positive'),
  currency: z.string().default('INR'),
  category: z.string().min(1, 'Category is required'),
  sku: z.string().optional(),
  order_date: z.string().datetime().or(z.date()),
  status: z.string().default('completed'),
  items: z.array(z.record(z.unknown())).optional(),
});

/**
 * Customer and Order Bulk Ingestion Schema
 */
export const ingestionSchema = z.object({
  customers: z.array(z.record(z.unknown())).optional(),
  orders: z.array(z.record(z.unknown())).optional(),
});

/**
 * Campaign creation schema
 */
export const campaignSchema = z.object({
  campaignName: z.string().optional(),
  name: z.string().optional(),
  segmentName: z.string().optional(),
  segmentCriteria: z.record(z.unknown()).nullable().optional(),
  audienceSize: z.number().optional(),
  recipientCount: z.number().optional(),
  channel: z.enum(['email', 'sms', 'whatsapp', 'rcs']).default('email'),
  messageContent: z.object({
    subject: z.string().optional(),
    body: z.string().min(1, 'Message body is required').max(5000),
  }).optional(),
});

/**
 * Webhook event schema
 */
export const webhookEventSchema = z.object({
  message_id: z.string().uuid('Invalid message ID format'),
  event_type: z.enum(['delivered', 'opened', 'clicked', 'converted', 'failed', 'bounced', 'complained']),
  timestamp: z.string().datetime(),
  channel: z.enum(['email', 'sms', 'whatsapp', 'rcs']),
  metadata: z.object({
    failure_reason: z.enum(['invalid_number', 'carrier_reject', 'opt_out', 'timeout', 'channel_error', 'unknown']).optional(),
    user_agent: z.string().optional(),
    ip_address: z.string().optional(),
  }).optional(),
});

/**
 * Pagination query schema
 */
export const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100)).default('25'),
  sort_by: z.string().optional(),
  sort_order: z.enum(['asc', 'desc']).optional(),
});

/**
 * Customer filter query schema
 */
export const customerFilterSchema = paginationSchema.extend({
  search: z.string().optional(),
  city: z.string().optional(),
  tag: z.string().optional(),
  min_orders: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative()).optional(),
  min_spend: z.string().regex(/^\d+(\.\d+)?$/).transform(Number).pipe(z.number().nonnegative()).optional(),
  segment: z.string().optional(),
  id: z.string().uuid().optional(), // Allow ID queries
});

/**
 * Campaign filter query schema
 */
export const campaignFilterSchema = paginationSchema.extend({
  status: z.enum(['draft', 'scheduled', 'queued', 'dispatching', 'active', 'completed', 'paused', 'cancelled']).optional(),
  channel: z.enum(['email', 'sms', 'whatsapp', 'rcs']).optional(),
});

/**
 * Segment creation schema
 */
export const segmentSchema = z.object({
  name: z.string().min(1, 'Segment name is required').max(200),
  description: z.string().max(1000).optional(),
  predicate: z.record(z.unknown()),
});

/**
 * Analytics query schema
 */
export const analyticsQuerySchema = z.object({
  view: z.enum(['full', 'summary', 'campaigns', 'cohorts']).default('full'),
  campaign_id: z.string().uuid().optional(),
  from_date: z.string().datetime().optional(),
  to_date: z.string().datetime().optional(),
});

/**
 * Chat request schema
 */
export const chatRequestSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(5000, 'Message too long'),
  threadId: z.string().uuid().nullable().optional(),
  context: z.record(z.unknown()).optional(),
});
