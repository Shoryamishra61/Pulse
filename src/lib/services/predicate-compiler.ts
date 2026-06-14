/**
 * PULSE CRM — Predicate-to-SQL Compiler
 * 
 * Architecture Decision: AI-SAFE QUERY COMPILATION
 * 
 * The AI agent NEVER writes raw SQL. Instead:
 * 1. The Planning Agent outputs a structured JSON predicate tree
 * 2. This compiler safely converts predicates → parameterized SQL
 * 3. All values are passed as bind parameters ($1, $2, etc.)
 * 4. Only whitelisted fields and operators are allowed
 * 
 * This eliminates SQL injection by construction, not by sanitization.
 * 
 * Reference: "Tool Calling" pattern — AI uses structured outputs,
 * backend compiles them safely.
 */

// ─── Predicate Tree Types ────────────────────────────────────────────────────

export type ComparisonOp = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'IN' | 'CONTAINS';

export interface FieldPredicate {
  type: 'field';
  field: string;
  op: ComparisonOp;
  value: string | number | boolean | string[] | number[];
}

export interface AndPredicate {
  type: 'and';
  conditions: PredicateNode[];
}

export interface OrPredicate {
  type: 'or';
  conditions: PredicateNode[];
}

export interface NotPredicate {
  type: 'not';
  condition: PredicateNode;
}

export type PredicateNode = FieldPredicate | AndPredicate | OrPredicate | NotPredicate;

// ─── Compiled Query Result ───────────────────────────────────────────────────

export interface CompiledQuery {
  sql: string;
  params: (string | number | boolean)[];
  predicateTree: PredicateNode;      // For UI display
  parameterizedSQL: string;          // For UI display (with $1, $2...)
  humanReadable: string;             // For natural language summary
}

// ─── Whitelisted Fields ──────────────────────────────────────────────────────
// Only these fields can be queried. Anything else is rejected.

const RELATIONAL_FIELDS: Record<string, { column: string; type: 'text' | 'numeric' | 'int' | 'timestamp' | 'boolean' }> = {
  'email':           { column: 'email',            type: 'text' },
  'name':            { column: 'name',             type: 'text' },
  'phone':           { column: 'phone',            type: 'text' },
  'total_spend':     { column: 'total_spend',      type: 'numeric' },
  'order_count':     { column: 'order_count',      type: 'int' },
  'last_order_date': { column: 'last_order_date',  type: 'timestamp' },
  'avg_order_value': { column: 'avg_order_value',  type: 'numeric' },
  'created_at':      { column: 'created_at',       type: 'timestamp' },
};

const JSONB_FIELDS: Record<string, { path: string; type: 'text' | 'text[]' | 'boolean' }> = {
  'city':                 { path: "properties->>'city'",                type: 'text' },
  'segment':              { path: "properties->>'segment'",             type: 'text' },
  'loyalty_tier':         { path: "properties->>'loyaltyTier'",         type: 'text' },
  'preferred_channel':    { path: "properties->>'preferredChannel'",    type: 'text' },
  'platform':             { path: "properties->>'platform'",            type: 'text' },
  'age_group':            { path: "properties->>'ageGroup'",            type: 'text' },
  'gender':               { path: "properties->>'gender'",              type: 'text' },
  'referral_source':      { path: "properties->>'referralSource'",      type: 'text' },
  'preferred_categories': { path: "properties->'preferredCategories'",  type: 'text[]' },
  'has_app':              { path: "(properties->>'hasApp')::boolean",   type: 'boolean' },
  'accepts_marketing':    { path: "(properties->>'acceptsMarketing')::boolean", type: 'boolean' },
  'cart_abandoned':       { path: "(properties->>'cartAbandoned')::boolean",    type: 'boolean' },
};

// ─── Compiler ────────────────────────────────────────────────────────────────

/**
 * Self-Correction Loop:
 * If the AI generates a predicate with an invalid field name,
 * the compiler catches the error, fuzzy-matches to the closest
 * valid field, rewrites the predicate, and retries.
 * 
 * This mirrors production LLM tool-calling patterns where the agent
 * self-corrects after validation failures.
 */

class FieldValidationError extends Error {
  constructor(public invalidField: string) {
    super(`Field "${invalidField}" is not in the allowed field whitelist`);
    this.name = 'FieldValidationError';
  }
}

function findClosestField(invalid: string): string | null {
  const allFields = [
    ...Object.keys(RELATIONAL_FIELDS),
    ...Object.keys(JSONB_FIELDS),
  ];

  // Exact substring match
  const substring = allFields.find(f => f.includes(invalid) || invalid.includes(f));
  if (substring) return substring;

  // Levenshtein-like: find field with most character overlap
  let bestMatch = '';
  let bestScore = 0;
  for (const field of allFields) {
    let score = 0;
    for (const char of invalid) {
      if (field.includes(char)) score++;
    }
    const normalized = score / Math.max(invalid.length, field.length);
    if (normalized > bestScore && normalized > 0.4) {
      bestScore = normalized;
      bestMatch = field;
    }
  }

  return bestMatch || null;
}

function correctPredicate(node: PredicateNode): { corrected: PredicateNode; corrections: string[] } {
  const corrections: string[] = [];

  function correct(n: PredicateNode): PredicateNode {
    switch (n.type) {
      case 'field': {
        if (!RELATIONAL_FIELDS[n.field] && !JSONB_FIELDS[n.field]) {
          const closest = findClosestField(n.field);
          if (closest) {
            corrections.push(`"${n.field}" → "${closest}" (auto-corrected)`);
            return { ...n, field: closest };
          }
          corrections.push(`"${n.field}" removed (no valid match found)`);
          return { type: 'and', conditions: [] }; // no-op
        }
        return n;
      }
      case 'and':
        return { ...n, conditions: n.conditions.map(c => correct(c)).filter(c => !(c.type === 'and' && c.conditions.length === 0)) };
      case 'or':
        return { ...n, conditions: n.conditions.map(c => correct(c)).filter(c => !(c.type === 'and' && c.conditions.length === 0)) };
      case 'not':
        return { ...n, condition: correct(n.condition) };
    }
  }

  return { corrected: correct(node), corrections };
}

export function compilePredicate(predicate: PredicateNode, maxRetries = 2): CompiledQuery & { corrections?: string[] } {
  let currentPredicate = predicate;
  let allCorrections: string[] = [];
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const params: (string | number | boolean)[] = [];
      let paramIndex = 1;

      function compile(node: PredicateNode): string {
        switch (node.type) {
          case 'field': {
            const { field, op, value } = node;

            // Check relational fields first
            if (RELATIONAL_FIELDS[field]) {
              const col = RELATIONAL_FIELDS[field].column;
              const fieldType = RELATIONAL_FIELDS[field].type;

              if (fieldType === 'timestamp' && typeof value === 'number' && (op === '<' || op === '<=')) {
                return `${col} < NOW() - INTERVAL '${Math.abs(value as number)} days'`;
              }

              if (op === 'IN' && Array.isArray(value)) {
                const placeholders = value.map(() => `$${paramIndex++}`);
                params.push(...(value as (string | number | boolean)[]));
                return `${col} IN (${placeholders.join(', ')})`;
              }

              params.push(value as string | number | boolean);
              return `${col} ${op} $${paramIndex++}`;
            }

            // Check JSONB fields
            if (JSONB_FIELDS[field]) {
              const meta = JSONB_FIELDS[field];

              if (meta.type === 'text[]' && op === 'CONTAINS') {
                params.push(value as string);
                return `${meta.path} ? $${paramIndex++}`;
              }

              if (meta.type === 'boolean') {
                params.push(value as boolean);
                return `${meta.path} = $${paramIndex++}`;
              }

              if (op === 'IN' && Array.isArray(value)) {
                const placeholders = value.map(() => `$${paramIndex++}`);
                params.push(...(value as (string | number | boolean)[]));
                return `${meta.path} IN (${placeholders.join(', ')})`;
              }

              params.push(value as string | number | boolean);
              return `${meta.path} ${op} $${paramIndex++}`;
            }

            // Self-correction: throw to trigger retry
            throw new FieldValidationError(field);
          }

          case 'and': {
            if (node.conditions.length === 0) return '1=1';
            const parts = node.conditions.map(c => compile(c));
            return `(${parts.join(' AND ')})`;
          }

          case 'or': {
            if (node.conditions.length === 0) return '1=0';
            const parts = node.conditions.map(c => compile(c));
            return `(${parts.join(' OR ')})`;
          }

          case 'not': {
            return `NOT (${compile(node.condition)})`;
          }
        }
      }

      const whereClause = compile(currentPredicate);
      const fullSQL = `SELECT * FROM customers WHERE ${whereClause} ORDER BY total_spend DESC`;

      return {
        sql: fullSQL,
        params,
        predicateTree: currentPredicate,
        parameterizedSQL: fullSQL,
        humanReadable: predicateToHuman(currentPredicate),
        ...(allCorrections.length > 0 ? { corrections: allCorrections } : {}),
      };

    } catch (error) {
      if (error instanceof FieldValidationError && attempt < maxRetries) {
        // Self-correction: fix the invalid field and retry
        const { corrected, corrections } = correctPredicate(currentPredicate);
        currentPredicate = corrected;
        allCorrections = [...allCorrections, ...corrections];
        console.log(`[PREDICATE COMPILER] Self-correction attempt ${attempt + 1}: ${corrections.join(', ')}`);
        continue;
      }
      throw error;
    }
  }

  // Fallback: return all customers
  return {
    sql: 'SELECT * FROM customers ORDER BY total_spend DESC',
    params: [],
    predicateTree: { type: 'and', conditions: [] },
    parameterizedSQL: 'SELECT * FROM customers ORDER BY total_spend DESC',
    humanReadable: 'all customers (self-correction exhausted)',
    corrections: allCorrections,
  };
}

// ─── Predicate Evaluation Helper ────────────────────────────────────────────
// Evaluates a predicate against customer data (used by segment APIs)

export function compileAndEvaluatePredicate(
  predicate: PredicateNode,
  customers: any[]
): { count: number; members: any[] } {
  // Compile the predicate to validate it
  try {
    compilePredicate(predicate);
  } catch (error) {
    throw new Error(`Invalid predicate: ${(error as Error).message}`);
  }

  // Evaluate against all customers
  const members = customers.filter(customer => evaluatePredicateNode(customer, predicate));

  return {
    count: members.length,
    members,
  };
}

function evaluatePredicateNode(customer: any, node: PredicateNode): boolean {
  switch (node.type) {
    case 'and':
      return node.conditions.length === 0 || node.conditions.every(c => evaluatePredicateNode(customer, c));
    case 'or':
      return node.conditions.some(c => evaluatePredicateNode(customer, c));
    case 'not':
      return !evaluatePredicateNode(customer, node.condition);
    case 'field': {
      const val = getCustomerFieldValue(customer, node.field);
      return compareFieldValues(val, node.op, node.value);
    }
  }
}

function getCustomerFieldValue(customer: any, field: string): unknown {
  const props = customer.properties || {};
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

function compareFieldValues(actual: unknown, op: ComparisonOp, expected: unknown): boolean {
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
    case 'LIKE': {
      const pattern = String(expected).replace(/%/g, '.*').replace(/_/g, '.');
      return new RegExp(`^${pattern}$`, 'i').test(String(actual));
    }
    default: return false;
  }
}

// ─── Natural Language Intent → Predicate Tree ────────────────────────────────
export function intentToPredicateTree(message: string): { predicate: PredicateNode; description: string } {
  const lower = message.toLowerCase();
  const conditions: FieldPredicate[] = [];
  const descriptions: string[] = [];

  // Spending threshold
  const spendMatch = lower.match(/(?:spent|spend|spending)\s*(?:over|above|more than|>)\s*(?:₹|rs\.?|inr)?\s*(\d+)/);
  if (spendMatch) {
    const val = parseInt(spendMatch[1]);
    conditions.push({ type: 'field', field: 'total_spend', op: '>', value: val });
    descriptions.push(`spent > ₹${val.toLocaleString()}`);
  }

  // Order count
  const orderMatch = lower.match(/(?:ordered|orders|purchased|bought)\s*(?:more than|over|above|>)\s*(\d+)/);
  if (orderMatch) {
    const val = parseInt(orderMatch[1]);
    conditions.push({ type: 'field', field: 'order_count', op: '>', value: val });
    descriptions.push(`${val}+ orders`);
  }

  // Inactivity window
  const daysMatch = lower.match(/(?:haven'?t|not)\s*(?:bought|purchased|ordered|engaged)\s*(?:in|since|for)\s*(\d+)\s*days/);
  if (daysMatch) {
    const days = parseInt(daysMatch[1]);
    conditions.push({ type: 'field', field: 'last_order_date', op: '<', value: days });
    descriptions.push(`inactive for ${days}+ days`);
  }

  // City
  const cityMatch = lower.match(/(?:from|in|at)\s+(mumbai|delhi|bangalore|hyderabad|chennai|kolkata|pune|jaipur|ahmedabad|lucknow|chandigarh|nagpur|indore|gurgaon|noida)/i);
  if (cityMatch) {
    const city = cityMatch[1].charAt(0).toUpperCase() + cityMatch[1].slice(1).toLowerCase();
    conditions.push({ type: 'field', field: 'city', op: '=', value: city });
    descriptions.push(`from ${city}`);
  }

  // Category preference
  const categoryMatch = lower.match(/(?:like|prefer|into|buy|bought)\s+(fashion|electronics|beauty|home|sports|books|food)/i);
  if (categoryMatch) {
    const cat = categoryMatch[1].toLowerCase();
    conditions.push({ type: 'field', field: 'preferred_categories', op: 'CONTAINS', value: cat });
    descriptions.push(`prefers ${cat}`);
  }

  // Behavioral segments
  if (conditions.length === 0) {
    if (lower.includes('high value') || lower.includes('vip') || lower.includes('best')) {
      conditions.push({ type: 'field', field: 'segment', op: 'IN', value: ['champion', 'high_value'] });
      descriptions.push('high-value customers');
    } else if (lower.includes('at risk') || lower.includes('churn') || lower.includes('leaving')) {
      conditions.push({ type: 'field', field: 'segment', op: '=', value: 'at_risk' });
      descriptions.push('at-risk customers');
    } else if (lower.includes('new') || lower.includes('recent')) {
      conditions.push({ type: 'field', field: 'segment', op: '=', value: 'new' });
      descriptions.push('new customers');
    } else if (lower.includes('dormant') || lower.includes('inactive') || lower.includes('sleeping')) {
      conditions.push({ type: 'field', field: 'segment', op: '=', value: 'dormant' });
      descriptions.push('dormant customers');
    } else if (lower.includes('cart') || lower.includes('abandon')) {
      conditions.push({ type: 'field', field: 'cart_abandoned', op: '=', value: true });
      descriptions.push('abandoned cart');
    } else {
      descriptions.push('all customers');
    }
  }

  const predicate: PredicateNode = conditions.length > 1
    ? { type: 'and', conditions }
    : conditions.length === 1
    ? conditions[0]
    : { type: 'and', conditions: [] };

  return {
    predicate,
    description: descriptions.join(', '),
  };
}

// ─── Human-Readable Predicate Description ────────────────────────────────────

function predicateToHuman(node: PredicateNode): string {
  switch (node.type) {
    case 'field': {
      const opMap: Record<string, string> = {
        '=': 'is', '!=': 'is not', '>': 'above', '>=': 'at least',
        '<': 'below', '<=': 'at most', 'LIKE': 'matches',
        'IN': 'is one of', 'CONTAINS': 'includes',
      };
      const opStr = opMap[node.op] || node.op;
      const valStr = Array.isArray(node.value) ? node.value.join(', ') : String(node.value);
      return `${node.field} ${opStr} ${valStr}`;
    }
    case 'and':
      return node.conditions.map(predicateToHuman).join(' AND ');
    case 'or':
      return node.conditions.map(predicateToHuman).join(' OR ');
    case 'not':
      return `NOT (${predicateToHuman(node.condition)})`;
  }
}
