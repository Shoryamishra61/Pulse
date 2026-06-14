# Video Walkthrough Transcript
## For pasting into the Google Form submission field

---

**[INTRO — 0:00–0:30]**

Hi, I'm Shorya. This is Pulse — an AI-native Mini CRM I built for the Xeno Engineering Assignment. Most CRMs are built to help brands send more messages. Pulse is built on a fundamentally different thesis: it helps brands earn the right to communicate with their customers. Every outbound message is a withdrawal from a finite "Relationship Capital" ledger, and the system actively guards against depleting it. Let me show you how it works.

**[DATA INGESTION — 0:30–1:00]**

The system ingests customer profiles and order histories through a Hybrid Relational plus JSONB architecture using Drizzle ORM. I generate 300 realistic synthetic shopper profiles — Indian names, real cities like Mumbai, Delhi, and Bangalore, with statistically distributed spending patterns, loyalty tiers, and behavioral segments like "champion," "at-risk," and "dormant." Each customer has typed columns for core fields like total spend and order count, plus a flexible JSONB properties column with a GIN index for fast querying on fields like city, platform, preferred channel, and cart abandonment status.

**[AI SEGMENTATION — 1:00–2:15]**

Here's the core technical innovation. I'll type: "Find VIP customers from Mumbai who haven't bought in 30 days." Watch what happens. The system doesn't write raw SQL. Instead, my intent flows through a multi-stage compilation pipeline.

First, the Planning Agent deconstructs my sentence into a JSON Predicate Tree — a structured intermediate representation with typed fields, operators, and values. Then, a Self-Correction Layer checks for hallucinated field names. If I had said "purchase_value" instead of "total_spend," the validation layer catches it, maps it to the canonical schema name, and transparently reports the correction in the UI. Finally, the Predicate Compiler — a pure function — compiles the tree into parameterized SQL. The key insight is that SQL injection is eliminated by construction. There is no code path where user input reaches the database without parameterization.

The result: 23 customers matched. I can see the parameterized SQL, the predicate tree, the audience preview, and the total potential revenue for this cohort — all from a single sentence.

**[CAMPAIGN ORCHESTRATION — 2:15–3:30]**

Now I'll ask the AI to orchestrate a full campaign: "Send a WhatsApp campaign to at-risk customers who spent over 3000 rupees." The system does three things simultaneously. It segments the audience using the same Predicate Compiler pipeline. It recommends WhatsApp as the channel — not because I asked for it, but because 68% of the matched audience has WhatsApp listed as their preferred channel in their profile data. And it drafts personalized message copy using template tokens like first name, city, loyalty tier, and preferred category.

Before anything sends, the Pre-Launch Review panel slides in. This is the Relationship Capital scoring system. It calculates a fatigue penalty based on how many campaigns I've sent in the last 24 hours, a volume penalty based on audience size, and a channel fit bonus. If the score drops too low, the system would actively warn me against sending. This is the philosophical inversion — the CRM protecting customer trust rather than maximizing send volume.

I click "Launch Campaign," and the dispatch begins.

**[CHANNEL SERVICE & WEBHOOKS — 3:30–4:30]**

The Channel Service is a completely separate Express.js process running on port 3001. It simulates real-world messaging providers with a Token Bucket rate limiter, probabilistic delivery outcomes — 97% delivery, 55% read rate, 15% click rate, 2.3% conversion — and realistic latency injection between 500 milliseconds and 3 seconds.

Every webhook callback is signed with HMAC-SHA256. On the CRM side, the webhook endpoint follows an Accept-then-Queue pattern: it verifies the signature using constant-time comparison to prevent timing attacks, validates the payload with Zod, checks for duplicate events via idempotency keys, enqueues for async processing, and returns 200 OK in under 50 milliseconds.

The Monotonic State Machine handles out-of-order events. If a "read" event arrives before "delivered" — which happens in real networks due to jitter — the state machine accepts the read event and retroactively infers that delivery must have occurred. Status can only move forward; a delayed "sent" event can never overwrite a "clicked" event.

**[ANALYTICS & INSIGHTS — 4:30–5:15]**

The SignalLine component visualizes the real-time event stream — you can see dispatches and callbacks flowing as they happen. The campaign autopsy breaks down performance by state: how many delivered, opened, read, clicked, and converted.

The proactive insight cards are AI-generated narratives, not raw charts. Instead of showing a bar graph and asking the marketer to interpret it, the system says: "Your WhatsApp read rates are 3 times higher than email for this audience segment. Shift budget here." Each insight includes the reasoning, affected metrics, and a suggested next action.

**[TRADEOFFS & CLOSING — 5:15–5:50]**

Quick note on tradeoffs. I chose an in-memory data store for zero-config Vercel deployment, but the full Drizzle schema is production-ready — just set a DATABASE_URL. I chose local pattern-matching AI over an external LLM API to demonstrate the architecture — structured outputs feeding a safe compiler — rather than outsourcing intelligence to an API key. The Predicate Compiler is LLM-agnostic; swap in GPT-4 or Claude for the Planning Agent and the compilation pipeline remains identical. And I chose a single intent-to-outcome canvas over multi-page navigation because the assignment tests for AI-native design, not traditional SaaS form wizards.

Thank you for reviewing. The code, the live demo, and this video are all publicly accessible.
