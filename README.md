<p align="center">
  <h1 align="center">PULSE</h1>
  <p align="center"><strong>An AI-Native Campaign Intelligence Surface for D2C Brands</strong></p>
  <p align="center">
    <em>Most CRMs optimize for sending. Pulse optimizes for earning the right to communicate.</em>
  </p>
</p>

<p align="center">
  <a href="YOUR_VERCEL_URL_HERE">Live Demo</a> · 
  <a href="YOUR_VIDEO_URL_HERE">Video Walkthrough</a> · 
  <a href="https://github.com/Shoryamishra61/Pulse">GitHub</a> · 
  <a href="#architecture">Architecture</a> · 
  <a href="#tradeoffs">Tradeoffs</a>
</p>

---

## Table of Contents

1. [Product Thesis](#product-thesis)
2. [What This Solves](#what-this-solves)
3. [Architecture Overview](#architecture-overview)
4. [The AI Pipeline — Predicate Compiler](#the-ai-pipeline--predicate-compiler)
5. [The Channel Service — Distributed Callback Loop](#the-channel-service--distributed-callback-loop)
6. [Monotonic State Machine](#monotonic-state-machine)
7. [Relationship Capital Scoring](#relationship-capital-scoring)
8. [How It Meets the Requirements](#how-it-meets-the-requirements)
9. [Explicit Tradeoffs](#explicit-tradeoffs)
10. [What I Chose NOT to Build](#what-i-chose-not-to-build)
11. [Tech Stack](#tech-stack)
12. [Getting Started](#getting-started)
13. [API Reference](#api-reference)
14. [Testing](#testing)
15. [Deployment (Vercel)](#deployment-vercel)

---

## Product Thesis

> **Customer Attention is a finite ledger.** Every outbound message is a withdrawal. Irrelevant, frequent, or tone-deaf blasts erode trust. When trust reaches zero, the customer is gone forever.

Pulse inverts the fundamental premise of marketing CRMs. Instead of maximizing send volume, it models the **cost** of communication via a "Relationship Capital" score and actively advises marketers *against* launching campaigns that will cause audience fatigue.

The interface is a single **intent-to-outcome canvas** — no sidebar navigation, no multi-step form wizards, no dropdown segment builders. The marketer describes their goal in natural language, and the AI compiles it into a full campaign: audience segmentation, channel recommendation, personalized copy, and a pre-launch safety review.

---

## What This Solves

| Traditional CRM Problem | Pulse's Approach |
|---|---|
| Marketers must manually construct segments with dropdown filters | Natural language → JSON Predicate Tree → Parameterized SQL. Zero configuration. |
| AI is bolted on as a "Generate Copy" button | AI is the **core engine**. It plans campaigns, recommends channels, drafts copy, and runs pre-launch safety checks autonomously. |
| Webhook callbacks are processed synchronously, causing timeouts | **Accept-then-Queue** pattern: return `200 OK` in <50ms, process asynchronously via background workers. |
| Out-of-order events corrupt message status | **Monotonic State Machine**: status can only move forward. A delayed `sent` event cannot overwrite a `clicked` event. |
| Dashboards show raw data without interpretation | **Proactive Insights**: AI-generated narrative cards that propose actions rather than report numbers. |

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    PULSE CRM (Next.js 16)                │
│                                                          │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Chat UI   │→ │ Planning     │→ │ Predicate        │  │
│  │  (Canvas)  │  │ Agent        │  │ Compiler         │  │
│  │            │  │ (Intent →    │  │ (JSON → Safe     │  │
│  │  ⌘K Bar   │  │  Predicate   │  │  Parameterized   │  │
│  │  SSE Feed  │  │  Tree)       │  │  SQL)            │  │
│  └────────────┘  └──────────────┘  └──────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │              Campaign Dispatch Queue               │  │
│  │  (Batched sends → Token Bucket Rate Limiting)     │  │
│  └────────────────────┬───────────────────────────────┘  │
│                       │                                  │
│  ┌────────────────────▼───────────────────────────────┐  │
│  │           Webhook Receiver (Accept-then-Queue)     │  │
│  │  HMAC-SHA256 Verify → Zod Validate → Enqueue      │  │
│  │  Idempotency Keys → Dead Letter Queue              │  │
│  └────────────────────┬───────────────────────────────┘  │
│                       │                                  │
│  ┌────────────────────▼───────────────────────────────┐  │
│  │         Monotonic State Machine                    │  │
│  │  created → enqueued → dispatched → sent_to_channel │  │
│  │  → delivered → opened → read → clicked → converted │  │
│  │  (Forward-only. Out-of-order events auto-fill gaps)│  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
                        ▲ Webhooks (HMAC-signed)
                        │
                        ▼
┌──────────────────────────────────────────────────────────┐
│           CHANNEL SERVICE (Express.js, Port 3001)        │
│                                                          │
│  • Separate process (simulates 3rd-party provider)       │
│  • Token Bucket Rate Limiter (50 req/s)                  │
│  • Probabilistic delivery simulation:                    │
│    - 97% delivery, 55% read, 15% click, 2.3% conversion │
│  • Realistic latency injection (500ms–3000ms jitter)     │
│  • Fires async webhooks back to CRM with HMAC signature  │
└──────────────────────────────────────────────────────────┘
```

---

## The AI Pipeline — Predicate Compiler

This is the core technical innovation. The AI **never writes raw SQL**. Instead, user intent flows through a multi-stage compilation pipeline:

```
User: "Find VIP customers from Mumbai who haven't bought in 30 days"
                    │
                    ▼
        ┌───────────────────┐
        │  1. Planning Agent │  Deconstructs intent into structured JSON
        └─────────┬─────────┘
                  │
                  ▼
        ┌───────────────────┐
        │ 2. JSON Predicate  │  { type: "and", conditions: [
        │    Tree             │    { field: "city", op: "=", value: "Mumbai" },
        └─────────┬─────────┘    { field: "segment", op: "=", value: "champion" },
                  │              { field: "last_order_date", op: "<", value: 30 }
                  ▼            ]}
        ┌───────────────────┐
        │ 3. Self-Correction │  Detects hallucinated fields (e.g., "purchase_value")
        │    Layer            │  Maps to canonical names ("total_spend")
        └─────────┬─────────┘  Transparently reports corrections to user
                  │
                  ▼
        ┌───────────────────┐
        │ 4. Predicate       │  Compiles to parameterized SQL:
        │    Compiler         │  SELECT * FROM customers
        └─────────┬─────────┘  WHERE properties->>'city' = $1
                  │            AND properties->>'segment' = $2
                  ▼            AND last_order_date < NOW() - INTERVAL '$3 days'
        ┌───────────────────┐  params: ['Mumbai', 'champion', 30]
        │ 5. Read Replica    │
        │    Execution       │  Executed on read-only path
        └───────────────────┘
```

**Why this matters:** SQL injection is eliminated **by construction**. The AI's output is a JSON tree — a structured, validatable intermediate representation — not a raw string. The Predicate Compiler is a pure function that maps known operators to parameterized query fragments. There is no code path where user input can reach the database without parameterization.

### Self-Correction Loop

When the Planning Agent outputs a field name that doesn't exist in the schema (a common LLM hallucination), the Self-Correction Layer intercepts it:

```typescript
// AI outputs: { field: "purchase_value", op: ">", value: 5000 }
// Self-Correction maps: "purchase_value" → "total_spend"
// UI displays: 🔧 Field auto-corrected: 'purchase_value' → 'total_spend'
```

This is the "Tool Calling" pattern from the research literature — the LLM acts as a structured-output generator, and the compiler acts as a safety layer. The system is designed so that **AI hallucinations degrade gracefully** rather than crash.

---

## The Channel Service — Distributed Callback Loop

The Channel Service (`apps/channel-service`) is a **completely separate Express.js process** running on port 3001. It simulates real-world messaging providers with:

| Feature | Implementation |
|---|---|
| **Rate Limiting** | Token Bucket algorithm (50 tokens/sec, 100 burst capacity) |
| **Latency Simulation** | 500ms–3000ms random jitter per message |
| **Probabilistic Outcomes** | 97% delivery → 55% read → 15% click → 2.3% conversion |
| **Failure Modes** | 3% hard bounce, network timeout simulation |
| **HMAC-SHA256 Signing** | Every webhook callback is cryptographically signed |
| **Async Webhooks** | Callbacks fire independently with realistic timing |

### Webhook Security (CRM Side)

```
Webhook arrives → HMAC-SHA256 verification (constant-time comparison)
               → Zod schema validation
               → Rate limiting (1000 req/min per IP)
               → Idempotency check (dedup by event ID)
               → Enqueue for async processing
               → Return 200 OK (<50ms)
```

The CRM webhook endpoint is designed as an **Accept-then-Queue** architecture. It never processes business logic in the HTTP handler — it validates, enqueues, and returns immediately. This prevents the Thundering Herd problem when thousands of callbacks arrive simultaneously.

---

## Monotonic State Machine

Message lifecycle events can arrive **out of order** due to network jitter. A `read` webhook might arrive before `delivered`. Most CRM implementations naively overwrite the status column, leading to data corruption.

Pulse uses a **Monotonic State Machine** that enforces forward-only transitions:

```
created(0) → enqueued(1) → dispatched(2) → sent_to_channel(3)
→ delivered(4) → opened(5) → read(6) → clicked(7) → converted(8)
```

Each state has a numeric sequence. A transition is only accepted if `new_state_sequence > current_state_sequence`. If a `read` event (6) arrives before `delivered` (4), the state machine:
1. Accepts the `read` event (it advances the sequence)
2. **Retroactively infers** that `delivered` must have occurred (you can't read without delivery)
3. Stores the full event log immutably for audit

This is inspired by the **event-sourcing** pattern used in payment systems (Stripe, Square) where out-of-order reconciliation is a critical requirement.

---

## Relationship Capital Scoring

Before any campaign launches, the **Pre-Launch Review** (Mission Panel) calculates a Relationship Capital score:

```
Score = Consent Baseline (92%)
      - Fatigue Penalty (0-22%, based on campaigns in last 24h)
      - Volume Penalty (3-25%, based on audience size)
      + Channel Fit Bonus (4-8%, based on audience preference data)
      + Relevance Lift (4-12%, based on segment specificity)
```

The score is displayed as a visual gauge. If the score drops below a threshold, the system actively warns the marketer against sending — turning the CRM from a "send machine" into a **trust guardian**.

---

## How It Meets the Requirements

### 1. Data Ingestion ✅
- **Hybrid Relational + JSONB architecture** via Drizzle ORM
- `customers` table with typed columns (email, total_spend, order_count) + flexible `properties` JSONB column with GIN index
- `orders` table with foreign key relationships
- Bulk ingestion via `POST /api/customers` or `npm run seed` for 300 realistic synthetic profiles
- Synthetic data includes realistic Indian names, cities (Mumbai, Delhi, Bangalore, etc.), spending distributions, and behavioral segments

### 2. Segment Shoppers ✅
- Natural language input → JSON Predicate Tree → Parameterized SQL
- Self-correcting field mapping for hallucinated field names
- Supports: `=`, `!=`, `>`, `>=`, `<`, `<=`, `IN`, `CONTAINS` operators
- Boolean composition: `AND`, `OR`, `NOT`
- JSONB property queries: city, segment, loyaltyTier, platform, preferredChannel, etc.

### 3. Send Personalized Communications ✅
- **Two separate services** with async callback loop (as required)
- Channel Service runs independently on port 3001
- Template tokenization: `{{first_name}}`, `{{city}}`, `{{loyalty_tier}}`, `{{preferred_category}}`
- AI recommends optimal channel based on audience preference data (not hardcoded defaults)
- Pre-launch review with Relationship Capital scoring

### 4. Surface Communication Performance ✅
- Real-time SSE (Server-Sent Events) feed for live campaign monitoring
- Monotonic State Machine tracks full lifecycle: created → converted
- Revenue attribution with configurable lookback windows (7-day last-touch)
- Campaign autopsy with per-state breakdown and conversion funnels
- Proactive AI insight cards: "WhatsApp read rates are 3x email — shift budget here"

### 5. AI-Native Architecture ✅
- AI is the **core engine**, not a bolted-on feature
- Multi-agent pipeline: Planning Agent → Self-Correction → Predicate Compiler
- Structured outputs (JSON predicate trees), not raw text generation
- AI recommends channels, drafts personalized copy, scores relationship capital
- Proactive insights surface without user prompting

---

## Explicit Tradeoffs

> *"What you chose to build (and chose not to build) is part of what we're evaluating."*

### 1. In-Memory Data Store vs. PostgreSQL in Production

| Aspect | Current (Demo) | Production |
|---|---|---|
| **Storage** | `globalThis` in-memory store | PostgreSQL with Drizzle ORM |
| **Why** | Zero-config deployment on Vercel. No database provisioning needed for reviewers to test. | Persistent, ACID-compliant, supports concurrent writes |
| **Tradeoff** | Data resets on server restart | Requires `DATABASE_URL` env var |
| **Schema** | Full Drizzle schema defined in `src/lib/db/schema.ts` — ready to `db:push` | Same schema, same queries |

The Drizzle schema and all SQL compilation logic is **production-ready**. The in-memory store is a demo convenience, not a shortcut — the Predicate Compiler generates real parameterized SQL regardless of the storage backend.

### 2. Background Promise.allSettled vs. BullMQ + Redis

| Aspect | Current | At Scale (10M+ events/day) |
|---|---|---|
| **Queue** | `Promise.allSettled` in Next.js API route | BullMQ + Redis with dedicated worker pool |
| **Why** | Avoids deployment complexity for a demo | Guarantees message durability across restarts |
| **Tradeoff** | Messages lost on server crash | Requires Redis infrastructure |
| **DLQ** | In-memory dead-letter queue with exponential backoff | Redis-backed DLQ with configurable retry policies |

### 3. Drizzle ORM vs. Prisma

**Chose Drizzle** because:
- Superior PostgreSQL JSONB querying (GIN index manipulation)
- No Rust-based query engine overhead → faster cold starts in serverless
- SQL-like API maps directly to the Predicate Compiler output
- Smaller bundle size for Vercel deployment

### 4. Single Canvas UI vs. Multi-Page Dashboard

**Chose a single intent-to-outcome canvas** because:
- Eliminates cognitive load — no navigation decisions
- Command bar (⌘K) provides instant access to all sections
- Proactive AI insights replace passive dashboard charts
- Respects reviewer time — one screen to evaluate the entire product

### 5. Local AI (Pattern Matching) vs. External LLM API

**Chose local pattern-matching AI** because:
- Zero API costs, zero latency dependency on external services
- Deterministic, testable, reproducible behavior
- The Predicate Compiler architecture is **LLM-agnostic** — swap in GPT-4/Claude for the Planning Agent and the compilation pipeline remains identical
- Demonstrates the **architecture** (structured outputs → safe compilation) rather than outsourcing intelligence to an API key

---

## What I Chose NOT to Build

| Feature | Why I Cut It |
|---|---|
| **User Authentication** | Not required by the assignment. Would consume time without proving engineering skill. |
| **CSV Upload UI** | The assignment said "use realistic, well-simulated data." A seed script proves backend ingestion; a CSV parser proves nothing about CRM architecture. |
| **Deal Stages / Sales Pipeline** | This is a B2C CRM for D2C brands, not a B2B sales tool. Including pipeline features would demonstrate a misunderstanding of the domain. |
| **Multi-step Form Wizards** | The assignment tests for "AI-native" design. Form wizards are the antithesis of intent-based interaction. |
| **Real-time Collaborative Editing** | Out of scope for a solo-marketer tool. Would add WebSocket complexity without business value. |

---

## Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Framework** | Next.js 16 (App Router, Turbopack) | Full-stack React with API routes, SSR, and serverless deployment |
| **State Management** | Zustand (persisted in sessionStorage) | Minimal boilerplate, no Redux ceremony |
| **ORM** | Drizzle ORM | JSONB-first, serverless-optimized |
| **Database** | PostgreSQL (schema-ready) / In-memory (demo) | ACID compliance, GIN indexes for JSONB |
| **Animation** | Framer Motion | Physics-based spring animations for premium feel |
| **Channel Service** | Express.js (separate process) | Simulates 3rd-party provider independence |
| **Validation** | Zod | Runtime type safety for webhooks and API payloads |
| **IDs** | UUIDv4 | Collision-resistant, no sequential enumeration |
| **Deployment** | Vercel | Zero-config Next.js hosting with edge functions |

---

## Getting Started

### Prerequisites
- Node.js v20+
- (Optional) PostgreSQL database

### 1. Install Dependencies
```bash
cd pulse
npm install

cd apps/channel-service
npm install
cd ../..
```

### 2. Run in Demo Mode (No Database Required)
```bash
# Terminal 1 — CRM Application
npm run dev

# Terminal 2 — Channel Service Stub
npm run channel-service
```

The CRM runs on `http://localhost:3000`, the Channel Service on `http://localhost:3001`.

### 3. Run with PostgreSQL (Optional)
```bash
cp .env.example .env
# Set DATABASE_URL in .env

npm run db:push    # Push Drizzle schema to PostgreSQL
npm run seed       # Ingest 300 synthetic customer profiles
npm run dev
```

### 4. Run Tests
```bash
npm test
```

---

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/chat` | POST | AI chat — intent parsing, segmentation, campaign orchestration |
| `/api/customers` | GET/POST | Customer CRUD with bulk ingestion |
| `/api/customers/[id]` | GET | Single customer detail |
| `/api/segments` | GET/POST | Segment management |
| `/api/segments/[id]` | GET/DELETE | Segment detail/deletion |
| `/api/segments/[id]/evaluate` | POST | Re-evaluate segment membership |
| `/api/segments/overlap` | POST | Segment overlap analysis |
| `/api/campaigns` | GET/POST | Campaign management and dispatch |
| `/api/campaigns/[id]/cancel` | POST | Cancel running campaign |
| `/api/campaigns/[id]/export` | GET | Export campaign results |
| `/api/analytics` | GET | Aggregate performance metrics |
| `/api/events` | GET | SSE stream for real-time campaign monitoring |
| `/api/webhook/channel-service` | POST/GET | Webhook receiver (HMAC-verified) / Health check |
| `/api/cron/campaign-dispatch` | POST | Trigger campaign batch processing |
| `/api/health` | GET | System health check |

---

## Testing

The test suite validates the three most critical subsystems:

```bash
npm test
```

| Test File | What It Validates |
|---|---|
| `state-machine.test.ts` | Monotonic state transitions, out-of-order event handling, idempotency |
| `api-contract.test.ts` | API endpoint contracts, Zod validation, error responses |
| `webhook-lifecycle.test.ts` | Full webhook lifecycle, HMAC verification, dead-letter queue behavior |

---

## Deployment (Vercel)

This project is optimized for **zero-config Vercel deployment**:

```bash
# From the pulse/ directory
npx vercel --prod
```

**Important Notes:**
- The CRM deploys to Vercel in **demo mode** (in-memory data). Set `DATABASE_URL` in Vercel environment variables for persistent storage.
- The Channel Service (`apps/channel-service`) is a separate Express process. For the demo, the CRM simulates campaign dispatch internally. For full webhook loop testing, run the Channel Service locally or deploy it separately (e.g., Railway, Render).

---

## Repository Structure

```
pulse/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── api/
│   │   │   ├── chat/route.ts         # AI chat endpoint (Predicate Compiler)
│   │   │   ├── customers/route.ts    # Customer CRUD
│   │   │   ├── segments/route.ts     # Segment management
│   │   │   ├── campaigns/route.ts    # Campaign dispatch
│   │   │   ├── analytics/route.ts    # Performance metrics
│   │   │   ├── events/route.ts       # SSE real-time feed
│   │   │   ├── webhook/              # Webhook receiver
│   │   │   └── health/route.ts       # Health check
│   │   ├── page.tsx                  # Main canvas (intent-to-outcome)
│   │   ├── campaigns/page.tsx        # Campaign management
│   │   ├── customers/page.tsx        # Customer explorer
│   │   └── segments/page.tsx         # Segment explorer
│   ├── components/
│   │   ├── AppLayout.tsx             # Shell with ⌘K command bar
│   │   ├── CommandBar.tsx            # Keyboard-first navigation
│   │   ├── IntelligencePanel.tsx     # AI insights panel
│   │   ├── MissionPanel.tsx          # Pre-launch review (Relationship Capital)
│   │   ├── SignalLine.tsx            # Real-time event visualization
│   │   └── Cards.tsx                 # Insight and metric cards
│   ├── lib/
│   │   ├── services/
│   │   │   ├── predicate-compiler.ts # JSON → Parameterized SQL compiler
│   │   │   ├── state-machine.ts      # Monotonic state machine
│   │   │   ├── campaign-dispatch.ts  # Batched campaign execution
│   │   │   ├── webhook-processor.ts  # Accept-then-queue webhook handler
│   │   │   ├── revenue-attribution.ts# Last-touch attribution engine
│   │   │   ├── seed-data.ts          # Synthetic data generator
│   │   │   └── customer-store.ts     # Shared data layer
│   │   ├── db/
│   │   │   ├── schema.ts             # Drizzle ORM schema (production-ready)
│   │   │   └── index.ts              # Database connection manager
│   │   ├── middleware/
│   │   │   ├── validation.ts         # Zod schemas for all endpoints
│   │   │   └── rate-limiter.ts       # Token bucket rate limiter
│   │   ├── store.ts                  # Zustand global state
│   │   └── chat.ts                   # Client-side chat service
│   └── hooks/
│       └── useSSE.ts                 # Server-Sent Events hook
├── apps/
│   └── channel-service/              # Separate Express.js service
│       └── src/index.ts              # Channel simulator with HMAC webhooks
├── drizzle.config.ts                 # Drizzle Kit configuration
└── package.json
```

---

## License

Built for the Xeno Engineering Internship Assignment 2026.

> *"The platform will prove that respecting the customer's attention is actually the most profitable mathematical strategy a brand can deploy."*
