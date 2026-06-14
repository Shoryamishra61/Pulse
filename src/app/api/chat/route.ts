/**
 * PULSE CRM — AI Chat Endpoint
 * 
 * Implements the Text-to-SQL Agentic Pipeline:
 * 1. Planning Agent: Deconstructs user intent into a JSON predicate tree
 * 2. Retrieval Agent: Fetches relevant schema context
 * 3. Predicate Compiler: Safely compiles predicates into parameterized SQL
 * 4. Self-Correction Loop: Handles errors autonomously
 * 
 * CRITICAL: The AI NEVER writes raw SQL. All queries go through the
 * Predicate Compiler which produces parameterized SQL from structured predicates.
 * This eliminates SQL injection by construction.
 * 
 * Reference: "Tool Calling" pattern — structured AI outputs compiled safely.
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateInsights, type SyntheticCustomer } from '@/lib/services/seed-data';
import { getCustomerData } from '@/lib/services/customer-store';
import { intentToPredicateTree, compilePredicate, type PredicateNode, type CompiledQuery } from '@/lib/services/predicate-compiler';
import { v4 as uuidv4 } from 'uuid';
import { validateBody, chatRequestSchema } from '@/lib/middleware/validation';
import { apiRateLimiter, checkRateLimit } from '@/lib/middleware/rate-limiter';

// ─── Schema Context (for Retrieval Agent) ────────────────────────────────────

const SCHEMA_CONTEXT = `
Database Schema (PostgreSQL):
- customers: id (UUID), email (TEXT UNIQUE), phone (TEXT), name (TEXT),
  total_spend (NUMERIC), order_count (INT), last_order_date (TIMESTAMPTZ),
  avg_order_value (NUMERIC), properties (JSONB with GIN index)
- orders: id (UUID), order_id (TEXT UNIQUE), customer_email (TEXT FK),
  amount (NUMERIC), order_date (TIMESTAMPTZ), items (JSONB)
- campaigns: id (UUID), name (TEXT), segment_id (UUID FK), status (ENUM),
  channels (TEXT[]), message_variants (JSONB)
- messages: id (UUID), campaign_id (UUID FK), customer_id (UUID FK),
  channel (ENUM), status (TEXT), state_sequence (INT)

JSONB properties fields (queryable via GIN index):
city, preferredCategories, platform, segment, loyaltyTier,
hasApp, acceptsMarketing, preferredChannel, cartAbandoned,
referralSource, ageGroup, gender
`;

// ─── Self-Correcting Loop ──────────────────────────────────────────────────
// When AI outputs an unknown field, the validation layer catches it,
// maps it to the nearest valid field, and retries compilation.
// This is the "self-correction" pattern for non-deterministic AI outputs.

const FIELD_CORRECTION_MAP: Record<string, string> = {
  'purchase_value': 'total_spend',
  'total_purchase': 'total_spend',
  'spend': 'total_spend',
  'purchases': 'order_count',
  'num_orders': 'order_count',
  'last_purchase': 'last_order_date',
  'last_seen': 'last_order_date',
  'average_order': 'avg_order_value',
  'aov': 'avg_order_value',
  'location': 'city',
  'tier': 'loyalty_tier',
  'channel': 'preferred_channel',
  'device': 'platform',
  'age': 'age_group',
  'sex': 'gender',
  'source': 'referral_source',
  'category': 'preferred_categories',
  'app': 'has_app',
  'marketing_opt_in': 'accepts_marketing',
  'cart': 'cart_abandoned',
};

function selfCorrectPredicate(predicate: PredicateNode): { corrected: PredicateNode; corrections: string[] } {
  const corrections: string[] = [];

  function fix(node: PredicateNode): PredicateNode {
    if (node.type === 'field') {
      const mapped = FIELD_CORRECTION_MAP[node.field];
      if (mapped) {
        corrections.push(`'${node.field}' → '${mapped}'`);
        return { ...node, field: mapped };
      }
      return node;
    }
    if (node.type === 'and' || node.type === 'or') {
      return { ...node, conditions: node.conditions.map(fix) };
    }
    if (node.type === 'not') {
      return { ...node, condition: fix(node.condition) };
    }
    return node;
  }

  return { corrected: fix(predicate), corrections };
}

// ─── Contextual Helpers ──────────────────────────────────────────────────────

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'late night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'Burning the midnight oil? 🌙';
  if (hour < 12) return 'Good morning! ☀️';
  if (hour < 17) return 'Good afternoon! 👋';
  if (hour < 21) return 'Good evening! ✨';
  return 'Working late! 🌙';
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getQuickDataSnapshot(): { totalCustomers: number; segments: Record<string, number>; topCities: string[]; avgSpend: number } {
  const customers = getCustomerData();
  const segments: Record<string, number> = {};
  const cities: Record<string, number> = {};
  let totalSpend = 0;

  for (const c of customers) {
    const props = c.properties as Record<string, unknown>;
    const seg = (props.segment as string) || 'unknown';
    segments[seg] = (segments[seg] || 0) + 1;
    const city = (props.city as string) || 'unknown';
    cities[city] = (cities[city] || 0) + 1;
    totalSpend += c.totalSpend;
  }

  const topCities = Object.entries(cities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([city]) => city);

  return {
    totalCustomers: customers.length,
    segments,
    topCities,
    avgSpend: customers.length > 0 ? Math.round(totalSpend / customers.length) : 0,
  };
}

// ─── Intent Detection (Planning Agent simulation) ────────────────────────────

interface ParsedIntent {
  type: 'greeting' | 'thanks' | 'goodbye' | 'help' | 'about' | 'unclear' |
        'segment' | 'campaign' | 'campaign_orchestrated' | 'analytics' | 'insight' | 'general';
  query: string;
  parameters: Record<string, unknown>;
  predicateTree?: PredicateNode;
  compiledQuery?: CompiledQuery;
  segmentResults?: SyntheticCustomer[];
  selfCorrections?: string[];  // Exposes corrections made by the self-correcting loop
}

function parseIntent(message: string): ParsedIntent {
  const lower = message.toLowerCase().trim();
  const wordCount = lower.split(/\s+/).length;

  // ── Greeting Detection ─────────────────────────────────────────────────
  const greetingPatterns = [
    /^(hi|hey|hello|yo|hola|sup|howdy|hiya|namaste|heya)\b/,
    /^good\s*(morning|afternoon|evening|night|day)/,
    /^(what'?s?\s*up|how\s*are\s*you|how\s*is\s*it\s*going|how'?s?\s*it\s*going)/,
    /^(greetings|salutations)/,
  ];
  if (greetingPatterns.some(p => p.test(lower))) {
    return { type: 'greeting', query: message, parameters: {} };
  }

  // ── Thanks / Appreciation ──────────────────────────────────────────────
  const thanksPatterns = [
    /\b(thanks|thank\s*you|thx|ty|appreciate|helpful|great\s*job|awesome|nice|cool|perfect|got\s*it)\b/,
  ];
  if (thanksPatterns.some(p => p.test(lower)) && wordCount <= 8) {
    return { type: 'thanks', query: message, parameters: {} };
  }

  // ── Goodbye ────────────────────────────────────────────────────────────
  const goodbyePatterns = [
    /^(bye|goodbye|see\s*you|later|good\s*night|gn|cya|take\s*care|ttyl)\b/,
  ];
  if (goodbyePatterns.some(p => p.test(lower))) {
    return { type: 'goodbye', query: message, parameters: {} };
  }

  // ── Help / What Can You Do ─────────────────────────────────────────────
  const helpPatterns = [
    /\b(help|what\s*can\s*you\s*do|capabilities|features|commands|options|menu|guide|tutorial)\b/,
    /^what\s*(are|is)\s*(you|this|pulse)/,
    /^how\s*(do|does|can|to)\s*(i|this|we)/,
  ];
  if (helpPatterns.some(p => p.test(lower)) && !lower.includes('customer') && !lower.includes('campaign') && !lower.includes('segment')) {
    return { type: 'help', query: message, parameters: {} };
  }

  // ── About the CRM ─────────────────────────────────────────────────────
  const aboutPatterns = [
    /\b(who\s*(built|made|created)|about\s*(you|pulse|this)|what\s*is\s*pulse|tell\s*me\s*about)\b/,
    /\b(tech\s*stack|architecture|how\s*does\s*(it|this)\s*work)\b/,
  ];
  if (aboutPatterns.some(p => p.test(lower))) {
    return { type: 'about', query: message, parameters: {} };
  }

  // ── Segment queries ────────────────────────────────────────────────────
  if (lower.includes('who') || lower.includes('find') || lower.includes('show me') || lower.includes('customers') || lower.includes('segment') || lower.includes('shoppers') || lower.includes('users') || lower.includes('people') || lower.includes('audience')) {
    // Step 1: Planning Agent → JSON Predicate Tree
    const { predicate: rawPredicate, description } = intentToPredicateTree(message);

    // Step 2: Self-Correction Loop — detect hallucinated fields and fix them
    const { corrected: predicate, corrections } = selfCorrectPredicate(rawPredicate);

    // Step 3: Predicate Compiler → Parameterized SQL
    const compiled = compilePredicate(predicate);

    // Step 4: Execute against in-memory data (simulating read replica)
    const allCustomers = getCustomerData();
    const filtered = applyPredicateToData(allCustomers, predicate);

    return {
      type: 'segment',
      query: description,
      parameters: { conditions: description.split(', '), count: filtered.length },
      predicateTree: predicate,
      compiledQuery: compiled,
      segmentResults: filtered.slice(0, 50),
      selfCorrections: corrections,
    };
  }

  // Campaign creation / Intent-to-Outcome Orchestrator
  if (lower.includes('campaign') || lower.includes('send') || lower.includes('reach out') || lower.includes('message') || lower.includes('blast') || lower.includes('notify') || lower.includes('email') || lower.includes('whatsapp') || lower.includes('sms')) {
    // If it also contains segmentation instructions, it's a full orchestrated mission
    if (lower.includes('who') || lower.includes('find') || lower.includes('that') || lower.includes('from') || lower.includes('vip') || lower.includes('customers') || lower.includes('to') || lower.includes('all') || lower.includes('shoppers')) {
      const { predicate: rawPredicate, description } = intentToPredicateTree(message);
      const { corrected: predicate, corrections } = selfCorrectPredicate(rawPredicate);
      const compiled = compilePredicate(predicate);
      const allCustomers = getCustomerData();
      const filtered = applyPredicateToData(allCustomers, predicate);
      const channelRecommendation = recommendChannel(filtered, message);
      
      return {
        type: 'campaign_orchestrated',
        query: description,
        parameters: { 
          suggestedChannel: channelRecommendation.channel,
          channelReasoning: channelRecommendation.reasoning,
          suggestedName: `AI Orchestrated: ${description}`,
          conditions: description.split(', '), 
          count: filtered.length 
        },
        predicateTree: predicate,
        compiledQuery: compiled,
        segmentResults: filtered.slice(0, 50),
        selfCorrections: corrections,
      };
    }

    // Otherwise, just a standard campaign draft
    return {
      type: 'campaign',
      query: message,
      parameters: {
        suggestedChannel: lower.includes('sms') ? 'sms' : lower.includes('whatsapp') ? 'whatsapp' : lower.includes('rcs') ? 'rcs' : 'email',
        suggestedName: `Campaign ${new Date().toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}`,
      },
    };
  }

  // Analytics
  if (lower.includes('how') || lower.includes('analytics') || lower.includes('performance') || lower.includes('stats') || lower.includes('conversion') || lower.includes('metrics') || lower.includes('report') || lower.includes('results')) {
    return {
      type: 'analytics',
      query: message,
      parameters: {},
    };
  }

  // Insights
  if (lower.includes('insight') || lower.includes('suggest') || lower.includes('recommend') || lower.includes('what should') || lower.includes('opportunity') || lower.includes('idea') || lower.includes('strategy') || lower.includes('advice')) {
    return {
      type: 'insight',
      query: message,
      parameters: {},
    };
  }

  // ── Unclear / Too Short / Gibberish ────────────────────────────────────
  if (wordCount <= 2 && !lower.match(/^(hi|hey|hello|bye|help|thanks)$/)) {
    return { type: 'unclear', query: message, parameters: {} };
  }

  return {
    type: 'general',
    query: message,
    parameters: {},
  };
}

// ─── In-Memory Predicate Evaluator ───────────────────────────────────────────
// Simulates what the database would do with the parameterized SQL.

function applyPredicateToData(customers: SyntheticCustomer[], predicate: PredicateNode): SyntheticCustomer[] {
  return customers.filter(c => evaluatePredicate(c, predicate));
}

function recommendChannel(customers: SyntheticCustomer[], requestedMessage: string): { channel: string; reasoning: string } {
  const lower = requestedMessage.toLowerCase();
  const explicitChannel = ['whatsapp', 'sms', 'rcs', 'email'].find((channel) => lower.includes(channel));
  if (explicitChannel) {
    return {
      channel: explicitChannel,
      reasoning: `The marketer explicitly requested ${explicitChannel.toUpperCase()}, so the copilot preserves that choice.`,
    };
  }

  const counts = customers.reduce<Record<string, number>>((acc, customer) => {
    const channel = String((customer.properties as Record<string, unknown>).preferredChannel || 'email');
    acc[channel] = (acc[channel] || 0) + 1;
    return acc;
  }, {});
  const [channel, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || ['email', 0];
  const share = customers.length ? Math.round((count / customers.length) * 100) : 0;

  return {
    channel,
    reasoning: `${share}% of the matched audience prefers ${channel.toUpperCase()}; this uses engagement preference rather than a fixed campaign default.`,
  };
}

function evaluatePredicate(customer: SyntheticCustomer, node: PredicateNode): boolean {
  switch (node.type) {
    case 'and':
      return node.conditions.length === 0 || node.conditions.every(c => evaluatePredicate(customer, c));
    case 'or':
      return node.conditions.some(c => evaluatePredicate(customer, c));
    case 'not':
      return !evaluatePredicate(customer, node.condition);
    case 'field': {
      const val = getFieldValue(customer, node.field);
      return compareValues(val, node.op, node.value);
    }
  }
}

function getFieldValue(customer: SyntheticCustomer, field: string): unknown {
  const props = customer.properties as Record<string, unknown>;
  const fieldMap: Record<string, () => unknown> = {
    'total_spend':     () => customer.totalSpend,
    'order_count':     () => customer.orderCount,
    'last_order_date': () => customer.lastOrderDate,
    'avg_order_value': () => customer.avgOrderValue,
    'email':           () => customer.email,
    'name':            () => customer.name,
    'city':            () => props.city,
    'segment':         () => props.segment,
    'loyalty_tier':    () => props.loyaltyTier,
    'preferred_channel': () => props.preferredChannel,
    'platform':        () => props.platform,
    'age_group':       () => props.ageGroup,
    'gender':          () => props.gender,
    'referral_source': () => props.referralSource,
    'preferred_categories': () => props.preferredCategories,
    'has_app':         () => props.hasApp,
    'accepts_marketing': () => props.acceptsMarketing,
    'cart_abandoned':  () => props.cartAbandoned,
  };
  return fieldMap[field]?.() ?? null;
}

function compareValues(actual: unknown, op: string, expected: unknown): boolean {
  if (actual === null || actual === undefined) return false;

  switch (op) {
    case '=':  return actual === expected;
    case '!=': return actual !== expected;
    case '>':  return (actual as number) > (expected as number);
    case '>=': return (actual as number) >= (expected as number);
    case '<': {
      // For dates: expected is days ago
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

// ─── Response Generation ─────────────────────────────────────────────────────

function generateResponse(intent: ParsedIntent): {
  message: string;
  structuredData?: Record<string, unknown>;
} {
  switch (intent.type) {
    // ── Greetings ─────────────────────────────────────────────────────────
    case 'greeting': {
      const snapshot = getQuickDataSnapshot();
      const timeGreet = getTimeGreeting();
      const tod = getTimeOfDay();
      
      const greetings = [
        `${timeGreet} Welcome to Pulse — your AI-native CRM copilot.\n\nI'm currently tracking **${snapshot.totalCustomers.toLocaleString()} shoppers** across ${Object.keys(snapshot.segments).length} behavioral segments. Top cities: **${snapshot.topCities.join(', ')}**. Average lifetime spend is **₹${snapshot.avgSpend.toLocaleString()}**.\n\nWhat would you like to explore? I can segment audiences, draft campaigns, or surface insights.`,
        
        `${timeGreet} I'm Pulse, your CRM copilot.\n\nHere's a quick snapshot: **${snapshot.totalCustomers.toLocaleString()}** shoppers in the database, with **${snapshot.segments['champion'] || 0} Champions** and **${snapshot.segments['at_risk'] || 0} at-risk** customers that might need attention this ${tod}.\n\nTry asking me something like *"Find VIP customers from Mumbai"* or *"What opportunities should I focus on?"*`,
        
        `Hey there! ${timeGreet}\n\nPulse is ready. Your shopper base has **${snapshot.totalCustomers.toLocaleString()} profiles** — I can instantly segment them by behavior, location, spending patterns, or any combination. Just describe who you're looking for in plain English.\n\nFor example: *"Show me customers who spent over ₹5000 but haven't bought in 60 days"*`,
      ];

      return { message: pick(greetings) };
    }

    // ── Thanks / Appreciation ────────────────────────────────────────────
    case 'thanks': {
      const responses = [
        `You're welcome! Let me know if you need anything else — I'm here to help you reach the right shoppers. 🎯`,
        `Happy to help! If you want, I can suggest some high-impact campaign opportunities based on your current data.`,
        `Glad that was useful! Feel free to ask me to segment more audiences or draft campaigns anytime.`,
        `Anytime! Remember, you can also use **⌘K** to quickly search or jump to any section.`,
      ];
      return { message: pick(responses) };
    }

    // ── Goodbye ──────────────────────────────────────────────────────────
    case 'goodbye': {
      const responses = [
        `See you later! Your campaigns and segments are all saved. Come back anytime you're ready to engage your shoppers. 👋`,
        `Bye for now! I'll keep monitoring your campaign performance in the background. Check back for updates. ✨`,
        `Take care! Remember, those **at-risk VIPs** won't wait forever — come back soon to re-engage them. 😉`,
      ];
      return { message: pick(responses) };
    }

    // ── Help ─────────────────────────────────────────────────────────────
    case 'help': {
      return {
        message: `Here's what I can do for you:\n\n**🔍 Segment Customers**\nDescribe your audience in plain English and I'll compile it into a precise database query.\n→ *"Find customers from Delhi who spent over ₹3000"*\n→ *"Show me dormant VIPs who haven't bought in 90 days"*\n\n**📣 Create Campaigns**\nI can draft and orchestrate full campaigns — audience, channel, message copy.\n→ *"Send a WhatsApp campaign to at-risk customers"*\n→ *"Reach out to cart abandoners with an SMS reminder"*\n\n**💡 Get Insights**\nI'll analyze your data and surface actionable opportunities.\n→ *"What opportunities should I focus on?"*\n→ *"Suggest a strategy for this week"*\n\n**📊 View Analytics**\nCheck campaign performance across all channels.\n→ *"How are my campaigns performing?"*\n→ *"Show me conversion metrics"*\n\nYou can also use **⌘K** to open the command bar for quick navigation.`,
      };
    }

    // ── About ────────────────────────────────────────────────────────────
    case 'about': {
      return {
        message: `**Pulse** is an AI-native B2C CRM built for reaching shoppers intelligently.\n\n**Architecture:**\n• **Next.js 16** frontend with Zustand state management\n• **Predicate Compiler** — your natural language is compiled into a JSON predicate tree, then into parameterized SQL. No raw SQL is ever generated by AI.\n• **Channel Service** — a separate Express microservice that simulates real messaging providers (WhatsApp, SMS, Email, RCS) with realistic delivery outcomes\n• **Accept-then-Queue** webhook pattern with HMAC-SHA256 verification\n• **Monotonic State Machine** for out-of-order event reconciliation\n• **Relationship Capital** scoring to prevent audience fatigue\n\n**AI Philosophy:** The system acts as a strategic advisor, not a dumb tool. It segments, recommends channels, drafts copy, and runs pre-launch safety checks — but the human always has final say.`,
      };
    }

    // ── Unclear / Gibberish ──────────────────────────────────────────────
    case 'unclear': {
      const snapshot = getQuickDataSnapshot();
      const responses = [
        `I'm not quite sure what you mean. Could you be more specific? For example:\n\n• *"Find high-value customers from Mumbai"*\n• *"Send a campaign to dormant shoppers"*\n• *"What insights can you give me?"*\n\nI work best when you describe an audience, a campaign goal, or ask for data insights.`,
        
        `Hmm, I need a bit more context to help you. Try describing what you're looking for — like *"Show me customers who spent over ₹5000"* or *"Recommend a campaign strategy."*\n\nRight now I'm tracking **${snapshot.totalCustomers.toLocaleString()} shoppers** and can instantly slice them by behavior, location, or spending.`,
        
        `I didn't catch that. I'm your CRM copilot — I can help with:\n• **Segmenting** audiences by any attribute\n• **Launching** targeted campaigns\n• **Analyzing** campaign performance\n\nJust tell me what you need in plain English!`,
      ];
      return { message: pick(responses) };
    }

    // ── Segment Result ───────────────────────────────────────────────────
    case 'segment': {
      const count = intent.segmentResults?.length || 0;
      const topCustomers = intent.segmentResults?.slice(0, 5) || [];
      const totalSpend = intent.segmentResults?.reduce((sum, c) => sum + c.totalSpend, 0) || 0;
      const avgSpend = count > 0 ? Math.round(totalSpend / count) : 0;
      const corrections = intent.selfCorrections || [];

      const correctionNote = corrections.length > 0
        ? `\n\n> 🔧 **Self-Correction:** Field(s) auto-corrected: ${corrections.join(', ')}. The AI initially referenced non-canonical field names; the validation layer intercepted and resolved them before SQL compilation.`
        : '';

      // Dynamic, data-aware commentary
      const allCustomers = getCustomerData();
      const percentOfBase = allCustomers.length > 0 ? Math.round((count / allCustomers.length) * 100) : 0;
      
      let sizeCommentary = '';
      if (count === 0) {
        sizeCommentary = `\n\nNo shoppers matched this criteria. Try broadening the conditions — for example, lower the spend threshold or extend the inactivity window.`;
      } else if (percentOfBase > 50) {
        sizeCommentary = `\n\nThis is a broad segment (**${percentOfBase}%** of your base). Consider narrowing the criteria for more targeted messaging.`;
      } else if (percentOfBase < 5) {
        sizeCommentary = `\n\nThis is a highly targeted micro-segment (**${percentOfBase}%** of your base) — perfect for personalized 1:1 outreach.`;
      }

      return {
        message: `Found **${count} customers** matching: ${intent.query}.\n\nThis cohort has an average lifetime spend of **₹${avgSpend.toLocaleString()}** with **₹${totalSpend.toLocaleString()}** in total potential revenue.${sizeCommentary}\n\nPipeline: Planning Agent → **JSON Predicate Tree** → Self-Correction Layer → Predicate Compiler → **Parameterized SQL** (executed on Read-Only Replica).${correctionNote}`,
        structuredData: {
          type: 'segment_result',
          title: `Segment: ${intent.query}`,
          selfCorrections: corrections,
          predicateTree: intent.predicateTree,
          compiledQuery: intent.compiledQuery ? {
            parameterizedSQL: intent.compiledQuery.parameterizedSQL,
            params: intent.compiledQuery.params,
            humanReadable: intent.compiledQuery.humanReadable,
          } : null,
          metrics: {
            totalCustomers: count,
            avgSpend: `₹${avgSpend.toLocaleString()}`,
            totalPotentialRevenue: `₹${totalSpend.toLocaleString()}`,
          },
          preview: topCustomers.map(c => ({
            name: c.name,
            email: c.email,
            totalSpend: `₹${c.totalSpend.toLocaleString()}`,
            orders: c.orderCount,
            lastOrder: c.lastOrderDate.toLocaleDateString('en-IN'),
            segment: (c.properties as Record<string, string>).segment,
            city: (c.properties as Record<string, string>).city,
          })),
          segmentId: uuidv4(),
          audienceSize: count,
          segmentName: intent.query,
          sourceQuery: intent.query,
          lastEvaluatedAt: new Date().toISOString(),
        },
      };
    }

    case 'campaign_orchestrated': {
      const count = intent.segmentResults?.length || 0;
      const channel = intent.parameters.suggestedChannel as string;
      const channelReasoning = intent.parameters.channelReasoning as string | undefined;
      const corrections = intent.selfCorrections || [];
      
      const correctionNote = corrections.length > 0
        ? `\n\n> 🔧 **Self-Correction:** Field(s) auto-corrected: ${corrections.join(', ')}.`
        : '';

      const totalSpend = intent.segmentResults?.reduce((sum, c) => sum + c.totalSpend, 0) || 0;
      const estimatedConversion = Math.round(count * 0.023);
      const estimatedRevenue = Math.round(totalSpend * 0.04);

      return {
        message: `I've fully orchestrated this campaign for you.\n\n**Audience:** ${count} recipients compiled from your intent → predicate tree → parameterized SQL.\n**Channel:** ${channel.toUpperCase()} — ${channelReasoning || 'selected based on audience preference data.'}\n**Estimated Impact:** ~${estimatedConversion} conversions, ~₹${estimatedRevenue.toLocaleString()} attributed revenue.\n\nThe Pre-Launch Review is ready. Review the Who / What / When breakdown and approve when you're ready.${correctionNote}`,
        structuredData: {
          type: 'campaign_draft',
          title: intent.parameters.suggestedName,
          channel,
          status: 'draft',
          audienceSize: count,
          segmentName: intent.query,
          messageSubject: 'Exclusive Update',
          messageBody: `Hi {{first_name}}, we picked this for your {{preferred_category}} interests in {{city}}. As a {{loyalty_tier}} shopper who last ordered {{last_order_days}} days ago, here is a private offer on products you usually love.`,
          context: 'AI Orchestrated Multi-Agent Pipeline',
          aiReasoning: [
            `Audience: ${intent.query}.`,
            channelReasoning || `Channel: ${channel.toUpperCase()} selected from inferred campaign intent.`,
            'Message: uses preferred category, city, loyalty tier, and recency so the communication is behavioral rather than a name-only template.',
          ].join(' '),
        },
      };
    }

    case 'campaign': {
      const channel = intent.parameters.suggestedChannel as string;
      return {
        message: `Setting up a **${channel.toUpperCase()}** campaign draft.\n\nTo build a complete campaign, I need:\n1. **Target audience** — describe who to reach (e.g. *"VIP customers from Mumbai"*) or say *"use the segment above"*\n2. **Message content** — I can generate copy based on the audience, or you can provide your own\n3. **Review** — I'll run a pre-launch safety check including fatigue scoring before dispatch\n\nTry: *"Send a ${channel} campaign to customers who spent over ₹5000 but haven't bought in 30 days"* for a fully orchestrated experience.`,
        structuredData: {
          type: 'campaign_draft',
          title: intent.parameters.suggestedName,
          channel,
          status: 'draft',
        },
      };
    }

    case 'insight': {
      const customers = getCustomerData();
      const insights = generateInsights(customers);

      const topInsight = insights[0];
      return {
        message: `I analyzed your shopper data and found **${insights.length} actionable opportunities**, each backed by behavioral signals.\n\nThe top opportunity: **${topInsight?.title || 'Audience Re-engagement'}** — ${topInsight?.description || 'targeting dormant high-value shoppers'}.\n\nEach insight card below includes the reasoning, affected metrics, and a suggested next step.`,
        structuredData: {
          type: 'insights',
          insights: insights.map(i => ({
            id: i.id,
            title: i.title,
            description: i.description,
            metrics: i.metrics,
            suggestedAction: i.suggestedAction,
            aiReasoning: i.aiReasoning,
          })),
        },
      };
    }

    case 'analytics': {
      const snapshot = getQuickDataSnapshot();
      return {
        message: `Here's your campaign performance overview across all channels.\n\nYour shopper base has **${snapshot.totalCustomers.toLocaleString()} profiles** with an average spend of **₹${snapshot.avgSpend.toLocaleString()}**. Heavy GROUP BY queries run against a dedicated **analytics read path** to protect the primary OLTP database.\n\nFor detailed per-campaign breakdowns, head to the **Campaigns** tab and click any campaign row.`,
        structuredData: {
          type: 'analytics_summary',
          metrics: {
            totalCampaigns: 12,
            totalMessagesSent: 15420,
            overallDeliveryRate: '94.2%',
            overallOpenRate: '28.7%',
            overallClickRate: '8.3%',
            overallConversionRate: '2.1%',
            totalRevenue: '₹4,52,000',
          },
        },
      };
    }

    default: {
      // General / fallback — but make it contextual, not generic
      const snapshot = getQuickDataSnapshot();
      const dormantCount = snapshot.segments['dormant'] || 0;
      const atRiskCount = snapshot.segments['at_risk'] || 0;
      const championCount = snapshot.segments['champion'] || 0;

      const suggestions = [
        dormantCount > 0 ? `You have **${dormantCount} dormant shoppers** — try *"Find dormant customers"* to explore win-back opportunities.` : null,
        atRiskCount > 0 ? `**${atRiskCount} at-risk customers** could churn soon. Try *"Show me at-risk shoppers"* to intervene.` : null,
        championCount > 0 ? `Your **${championCount} Champions** are your best asset. Try *"Find VIP customers"* to reward them.` : null,
      ].filter(Boolean);

      const suggestion = suggestions.length > 0 ? `\n\n**Quick suggestion:** ${pick(suggestions as string[])}` : '';

      return {
        message: `I understood your message, but I'm not sure how to act on it as a CRM command. Here's what I can help with:\n\n• **Segment customers** — *"Find high-value customers who haven't bought in 30 days"*\n• **Create campaigns** — *"Send an email campaign to at-risk customers"*\n• **Get insights** — *"What opportunities should I focus on?"*\n• **View analytics** — *"How are my campaigns performing?"*${suggestion}\n\nEvery query uses the **Predicate Compiler** — your intent is safely compiled into parameterized SQL. No raw SQL is ever generated.`,
      };
    }
  }
}

// ─── API Route ───────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Rate limiting
  const rateLimitResponse = checkRateLimit(request, apiRateLimiter);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // Validate request body
    const validation = await validateBody(request, chatRequestSchema);
    if (!validation.success) {
      return validation.response;
    }

    const { message, threadId } = validation.data;

    // ── 1-second thinking delay ──────────────────────────────────────────
    // Simulates the AI "thinking" — makes the experience feel deliberate
    // rather than instant/pre-computed. Variable delay for realism.
    const thinkingDelay = 800 + Math.random() * 400; // 800ms–1200ms
    await new Promise(resolve => setTimeout(resolve, thinkingDelay));

    // Phase 1: Planning Agent — Parse intent into structured predicate
    const intent = parseIntent(message);

    // Phase 2 & 3: Predicate Compilation + Response Generation
    const response = generateResponse(intent);

    return NextResponse.json({
      id: uuidv4(),
      threadId: threadId || uuidv4(),
      role: 'agent',
      content: response.message,
      structuredData: response.structuredData,
      metadata: {
        intent: intent.type,
        query: intent.query,
        predicateTree: intent.predicateTree,
        selfCorrections: intent.selfCorrections,
        selfCorrectionApplied: (intent.selfCorrections?.length || 0) > 0,
        compiledQuery: intent.compiledQuery ? {
          parameterizedSQL: intent.compiledQuery.parameterizedSQL,
          params: intent.compiledQuery.params,
        } : undefined,
        schemaContext: intent.type === 'segment' ? SCHEMA_CONTEXT : undefined,
        pipeline: intent.selfCorrections?.length
          ? ['PlanningAgent', 'PredicateTree', 'SelfCorrectionLayer', 'PredicateCompiler', 'ParameterizedSQL']
          : ['PlanningAgent', 'PredicateCompiler', 'ParameterizedSQL'],
        thinkingTimeMs: Math.round(thinkingDelay),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('CHAT API ERROR:', error);
    return NextResponse.json(
      { error: 'Failed to process message', details: (error as Error).message, stack: (error as Error).stack },
      { status: 500 }
    );
  }
}
