/**
 * PULSE CRM — Database Schema (Drizzle ORM)
 * 
 * Architecture Decisions:
 * 
 * 1. HYBRID RELATIONAL + DOCUMENT SCHEMA:
 *    Strict relational columns for identifiers (IDs, emails).
 *    JSONB column for dynamic shopper properties that change rapidly.
 *    GIN index on JSONB for fast querying of dynamic attributes.
 *    Reference: Inverted Index structures powering search engines.
 * 
 * 2. UNIDIRECTIONAL STATE MACHINE:
 *    Each communication state maps to an integer (Draft=0, Delivered=3, Clicked=5).
 *    The database enforces that state can only move FORWARD (monotonic promotion).
 *    This prevents out-of-order webhook events from corrupting analytics.
 *    Reference: "Resolving Out-of-Order Events" pattern.
 * 
 * 3. IMMUTABLE EVENT LOG:
 *    All webhook events are appended to communication_events (never updated).
 *    State is derived from the event log, not stored directly.
 *    This is the event-sourcing pattern for audit trails and replay.
 * 
 * 4. CANONICAL LOG LINES:
 *    Each message has a single, wide canonical log entry that captures
 *    the entire lifecycle. Reference: Stripe's structured logging approach.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  boolean,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const campaignStatusEnum = pgEnum('campaign_status', [
  'draft',
  'scheduled',
  'dispatching',
  'active',
  'completed',
  'paused',
  'cancelled',
]);

export const channelEnum = pgEnum('channel_type', [
  'email',
  'sms',
  'whatsapp',
  'rcs',
]);

export const conversationRoleEnum = pgEnum('conversation_role', [
  'agent',
  'user',
  'system',
]);

export const conversationTypeEnum = pgEnum('conversation_type', [
  'insight',
  'campaign',
  'segment',
  'general',
]);

// ─── State Machine Integer Mappings ──────────────────────────────────────────
// Used for monotonic promotion: state can only move to a HIGHER integer.
// This is the core defense against out-of-order webhook events.

export const MESSAGE_STATE_SEQUENCE: Record<string, number> = {
  created: 0,
  enqueued: 1,
  dispatched: 2,
  sent_to_channel: 3,
  delivered: 4,
  failed: 4,        // Same level as delivered (terminal branch)
  bounced: 4,       // Same level as delivered (terminal branch)
  opened: 5,
  clicked: 6,
  converted: 7,
  complained: 5,    // Same level as opened (terminal branch)
  permanently_failed: 8, // DLQ terminal state
};

// ─── Core Entities ───────────────────────────────────────────────────────────

/**
 * Customers table — Hybrid Relational + Document Schema
 * 
 * Strict columns for identifiers and computed RFM fields.
 * JSONB 'properties' column for dynamic shopper attributes.
 * GIN index on properties for fast attribute-based segmentation.
 */
export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  name: text('name'),

  // Pre-computed RFM fields for instant segment filtering
  totalSpend: numeric('total_spend', { precision: 12, scale: 2 }).default('0'),
  orderCount: integer('order_count').default(0),
  lastOrderDate: timestamp('last_order_date', { withTimezone: true }),
  avgOrderValue: numeric('avg_order_value', { precision: 10, scale: 2 }).default('0'),

  // Dynamic properties — JSONB with GIN index
  // Stores rapidly changing shopper attributes without schema migrations
  properties: jsonb('properties').$type<Record<string, unknown>>().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  // GIN index for fast JSONB querying of dynamic properties
  // Reference: Inverted Index structures for search-engine-like querying
  index('idx_customers_properties_gin').using('gin', table.properties),
  index('idx_customers_total_spend').on(table.totalSpend),
  index('idx_customers_last_order').on(table.lastOrderDate),
  index('idx_customers_order_count').on(table.orderCount),
]);

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: text('order_id').notNull().unique(),
  customerEmail: text('customer_email').notNull().references(() => customers.email),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  orderDate: timestamp('order_date', { withTimezone: true }).notNull(),
  items: jsonb('items').$type<Array<{ name: string; quantity: number; price: number }>>().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_orders_customer').on(table.customerEmail),
  index('idx_orders_date').on(table.orderDate),
]);

// ─── Segments ────────────────────────────────────────────────────────────────

export const segments = pgTable('segments', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),

  // Segment definition as structured rules
  // { rules: [{ field: "total_spend", op: "gt", value: 500 }], logic: "AND" }
  definition: jsonb('definition').$type<{
    rules: Array<{ field: string; op: string; value: string | number }>;
    logic: 'AND' | 'OR';
  }>().notNull(),

  // AI provenance — tracks how the segment was created
  nlQuery: text('nl_query'),          // The natural language query that generated this
  aiReasoning: text('ai_reasoning'),  // Why the AI suggested this segment
  isAutoGenerated: boolean('is_auto_generated').default(false),
  memberCount: integer('member_count'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const segmentMembers = pgTable('segment_members', {
  segmentId: uuid('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.segmentId, table.customerId] }),
]);

// ─── Campaigns ───────────────────────────────────────────────────────────────

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  segmentId: uuid('segment_id').references(() => segments.id),
  status: campaignStatusEnum('status').notNull().default('draft'),
  channels: text('channels').array().notNull().default(sql`ARRAY['email']::text[]`),

  // Message content with A/B variants
  messageVariants: jsonb('message_variants').$type<Array<{
    subject?: string;
    body: string;
    channel: string;
  }>>().notNull().default([]),

  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),

  // AI provenance
  aiReasoning: text('ai_reasoning'),
  conversationThreadId: uuid('conversation_thread_id'),

  // Aggregate metrics (denormalized for fast reads)
  totalMessages: integer('total_messages').default(0),
  sentCount: integer('sent_count').default(0),
  deliveredCount: integer('delivered_count').default(0),
  openedCount: integer('opened_count').default(0),
  clickedCount: integer('clicked_count').default(0),
  convertedCount: integer('converted_count').default(0),
  failedCount: integer('failed_count').default(0),
  bouncedCount: integer('bounced_count').default(0),
  attributedRevenue: numeric('attributed_revenue', { precision: 14, scale: 2 }).default('0'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_campaigns_status').on(table.status),
  index('idx_campaigns_segment').on(table.segmentId),
]);

// ─── Messages (Communication States) ────────────────────────────────────────
// Each row represents a single message sent to a single customer as part of a campaign.
// The `stateSequence` field enables the Unidirectional State Machine pattern.

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  channel: channelEnum('channel').notNull(),

  // Current state (text for readability)
  status: text('status').notNull().default('created'),

  // STATE SEQUENCE INTEGER — The core of the Unidirectional State Machine
  // This integer can only increase, never decrease.
  // Incoming events with a lower sequence are accepted but don't change state.
  // Reference: "Resolving Out-of-Order Events" pattern
  stateSequence: integer('state_sequence').notNull().default(0),

  providerMessageId: text('provider_message_id'),
  content: jsonb('content').$type<{ subject?: string; body: string }>().notNull(),
  variantIndex: integer('variant_index').default(0),
  retryCount: integer('retry_count').default(0),
  lastError: text('last_error'),

  // Canonical log line timestamps — Stripe's structured logging pattern
  // One wide row captures the entire message lifecycle
  enqueuedAt: timestamp('enqueued_at', { withTimezone: true }),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  clickedAt: timestamp('clicked_at', { withTimezone: true }),
  convertedAt: timestamp('converted_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  bouncedAt: timestamp('bounced_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_messages_campaign').on(table.campaignId),
  index('idx_messages_customer').on(table.customerId),
  index('idx_messages_status').on(table.status),
  index('idx_messages_state_seq').on(table.stateSequence),
  index('idx_messages_provider').on(table.providerMessageId),
]);

// ─── Communication Events (Immutable Event Log) ─────────────────────────────
// Append-only log of every state change event.
// Source of truth for audit trails and analytics replay.

export const communicationEvents = pgTable('communication_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').notNull().references(() => messages.id),
  eventType: text('event_type').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  stateSequence: integer('state_sequence').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  source: text('source').notNull().default('system'), // system, webhook, user, ai
  traceId: text('trace_id'),
  processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_comm_events_message').on(table.messageId, table.createdAt),
  index('idx_comm_events_type').on(table.eventType),
]);

// ─── Webhook Deduplication ───────────────────────────────────────────────────
// Stores processed webhook event IDs for idempotency checking.
// Reference: "Designing Idempotent API Endpoints for Payments at Stripe"

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerEventId: text('provider_event_id').notNull().unique(),
  messageId: uuid('message_id').references(() => messages.id),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('idx_webhook_events_provider').on(table.providerEventId),
]);

// ─── Attribution ─────────────────────────────────────────────────────────────

export const attributions = pgTable('attributions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id),
  messageId: uuid('message_id').notNull().references(() => messages.id),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  attributedRevenue: numeric('attributed_revenue', { precision: 12, scale: 2 }).notNull(),
  attributionModel: text('attribution_model').notNull().default('last_touch'),
  touchpointCount: integer('touchpoint_count').notNull().default(1),
  touchpointHistory: jsonb('touchpoint_history').$type<Array<Record<string, unknown>>>().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_attributions_campaign').on(table.campaignId),
  index('idx_attributions_customer').on(table.customerId),
]);

// ─── Conversation Threads ────────────────────────────────────────────────────

export const conversationThreads = pgTable('conversation_threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: conversationTypeEnum('type').notNull(),
  referenceId: uuid('reference_id'), // campaign_id, segment_id, etc.
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const conversationMessages = pgTable('conversation_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id').notNull().references(() => conversationThreads.id),
  role: conversationRoleEnum('role').notNull(),
  content: text('content').notNull(),
  structuredData: jsonb('structured_data').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_conv_messages_thread').on(table.threadId, table.createdAt),
]);

// ─── Relations ───────────────────────────────────────────────────────────────

export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
  messages: many(messages),
  segmentMemberships: many(segmentMembers),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  customer: one(customers, {
    fields: [orders.customerEmail],
    references: [customers.email],
  }),
}));

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  segment: one(segments, {
    fields: [campaigns.segmentId],
    references: [segments.id],
  }),
  messages: many(messages),
  attributions: many(attributions),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  campaign: one(campaigns, {
    fields: [messages.campaignId],
    references: [campaigns.id],
  }),
  customer: one(customers, {
    fields: [messages.customerId],
    references: [customers.id],
  }),
  events: many(communicationEvents),
}));

export const communicationEventsRelations = relations(communicationEvents, ({ one }) => ({
  message: one(messages, {
    fields: [communicationEvents.messageId],
    references: [messages.id],
  }),
}));

export const segmentMembersRelations = relations(segmentMembers, ({ one }) => ({
  segment: one(segments, {
    fields: [segmentMembers.segmentId],
    references: [segments.id],
  }),
  customer: one(customers, {
    fields: [segmentMembers.customerId],
    references: [customers.id],
  }),
}));
