# Fortium Outbound - Product Vision

> "From signal to signed engagement, autonomously."
> Last Updated: 2026-01-02

## The End State

Outbound is not just an AI SDR. It's **autonomous deal origination** - a system that can:

1. **Find** a prospect (Universe + Signals)
2. **Match** company needs to Fortium executives via Piper (CIO/CTO/CISO → or refer to CFO/CMO/GC/etc.)
3. **Initiate** a proposal
4. **Negotiate** the agreement
5. **Create** a client/engagement in PartnerConnect
6. **Handoff** to the matched executive to start delivery

The human Managing Partners step in where they add value: domain expertise, relationship building, complex negotiations, and delivery. Not data entry, not prospecting, not scheduling.

---

## Why This Works for Fortium

### Our Advantages

| Factor | Implication for AI |
|--------|-------------------|
| **US-focused** | CAN-SPAM (opt-out) vs GDPR (opt-in) - simpler compliance |
| **B2B Executive Services** | High-value, consultative - worth the AI investment per deal |
| **Known Service Catalog** | Piper matching is constrained to our offerings |
| **Expert Network (Managing Partners)** | Clear handoff targets with domain expertise |
| **PartnerConnect Exists** | Backend system for engagement management ready |

### What We're NOT Building

- Generic AI SDR for mass outreach
- Spray-and-pray email automation
- Replacement for Managing Partner relationships
- Cold calling robot

### What We ARE Building

- **Intelligence layer** that surfaces the right opportunities at the right time
- **Matching engine** that connects company needs to Fortium capabilities
- **Proposal automation** that drafts based on templates + context
- **Negotiation support** with guardrails and escalation
- **Seamless handoff** to humans who close and deliver

---

## Fortium Ecosystem

Outbound doesn't work alone. It's the orchestrator in a larger ecosystem:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FORTIUM ECOSYSTEM                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                         │
│  │ Lead5 Scout │  │LinkedIn Scout│  │ News Scout  │   ... more scouts      │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                         │
│         │                │                │                                 │
│         └────────────────┼────────────────┘                                 │
│                          ↓                                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         OUTBOUND                                      │  │
│  │                    "The Orchestrator"                                 │  │
│  │                                                                       │  │
│  │  • Receives signals from Scouts                                       │  │
│  │  • Dedupes, enriches, scores, SWARMS opportunities                   │  │
│  │  • Creates/updates HubSpot leads & deals                             │  │
│  │  • Posts activities to HubSpot timeline                              │  │
│  │  • Generates hypotheses for human review                             │  │
│  └──────────────────────────────┬───────────────────────────────────────┘  │
│                                 ↓                                           │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         HUBSPOT                                       │  │
│  │                    "The Human Interface"                              │  │
│  │                                                                       │  │
│  │  • Human owns leads/deals                                            │  │
│  │  • Sees activities posted by Outbound                                │  │
│  │  • Takes action, closes deals                                        │  │
│  │  • Outbound watches outcomes, learns                                 │  │
│  └──────────────────────────────┬───────────────────────────────────────┘  │
│                                 ↓                                           │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    FORTIUM PIPELINE                                   │  │
│  │                    "The Observer"                                     │  │
│  │                                                                       │  │
│  │  • Watches HubSpot pipeline                                          │  │
│  │  • Sees Outbound's activities                                        │  │
│  │  • Provides insights, forecasts, attribution                         │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Terminology

| Term | Definition |
|------|------------|
| **Scout** | An autonomous agent that finds signals from a specific source (Lead5 Scout, LinkedIn Scout, etc.) |
| **Signal** | A detected event indicating potential opportunity (job posting, funding, job change, etc.) |
| **Swarm** | Multiple signals on the same account = hot opportunity, escalate priority |
| **Hypothesis** | A proposed action based on signals, awaiting human approval |
| **Play** | An executed action (email sent, call made, meeting booked) |

### Responsibilities

| System | Role | Owns |
|--------|------|------|
| **Scouts** | Find signals | Signal discovery, source-specific logic |
| **Outbound** | Orchestrate | Signal processing, HubSpot sync, hypothesis generation |
| **HubSpot** | Human workflow | Lead/deal ownership, activity timeline, closing |
| **Pipeline** | Observe & learn | Analytics, forecasting, attribution |

---

## The Full Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OUTBOUND PIPELINE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐             │
│  │ UNIVERSE │───▶│ SIGNALS  │───▶│HYPOTHESES│───▶│  PLAYS   │             │
│  │          │    │          │    │          │    │          │             │
│  │ Accounts │    │ Job change│   │ Outreach │    │ Email    │             │
│  │ Contacts │    │ Funding   │    │ ideas    │    │ LinkedIn │             │
│  │ Segments │    │ News      │    │ Matches  │    │ Call     │             │
│  └──────────┘    │ Intent    │    └──────────┘    └────┬─────┘             │
│                  │ Job posts │                          │                   │
│                  └──────────┘                          │                   │
│                                                        ▼                   │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                        ENGAGEMENT FUNNEL                             │  │
│  ├─────────────────────────────────────────────────────────────────────┤  │
│  │                                                                      │  │
│  │  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐      │  │
│  │  │ CONTACT  │───▶│ MEETING  │───▶│ PROPOSAL │───▶│ CONTRACT │      │  │
│  │  │  MADE    │    │ BOOKED   │    │  SENT    │    │  SIGNED  │      │  │
│  │  └──────────┘    └────┬─────┘    └──────────┘    └────┬─────┘      │  │
│  │                       │                               │             │  │
│  │                       ▼                               ▼             │  │
│  │              ┌─────────────────┐            ┌─────────────────┐    │  │
│  │              │  PIPER MATCH    │            │ PARTNERCONNECT  │    │  │
│  │              │                 │            │                 │    │  │
│  │              │ Company Need ──▶│            │ Create Client   │    │  │
│  │              │ Executive Match │            │ Create Engage.  │    │  │
│  │              │ (CIO/CTO/CISO)  │            │ Assign Partner  │    │  │
│  │              └─────────────────┘            └─────────────────┘    │  │
│  │                                                                      │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│                              ┌──────────────┐                              │
│                              │  SCOREBOARD  │                              │
│                              │              │                              │
│                              │ Metrics      │                              │
│                              │ Learning     │                              │
│                              │ Attribution  │                              │
│                              └──────────────┘                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Scouts & Signal Sources

**Scouts** are autonomous agents that find signals from specific sources. Each Scout is a containerized process that scrapes/queries a source and POSTs signals to Outbound.

### Signal Types

| Signal Type | What It Indicates | Example |
|-------------|-------------------|---------|
| **Job change** | Person moved roles - warm reintroduction opportunity | CFO promoted to CEO |
| **Job posting** | Company has a gap we can fill | Posting for interim CIO |
| **Funding** | Capital to spend, growth mode | Series B announcement |
| **M&A activity** | Integration needs, leadership gaps | Acquisition announced |
| **Leadership change** | New decision makers, fresh perspective | New CEO appointed |
| **News mention** | Company in motion, topical hook | Expansion announcement |
| **Intent signal** | Active research/interest | Website visits, content downloads |

### Planned Scouts

| Scout | Source | Signal Types | Status |
|-------|--------|-------------|--------|
| **Lead5 Scout** | Lead5.com | Job postings, executive hiring | 🚧 First Scout - in development |
| **LinkedIn Scout** | LinkedIn (PhantomBuster) | Job changes, promotions, new hires | Planned |
| **News Scout** | NewsAPI, Google Alerts | Funding, M&A, leadership changes | Planned |
| **Crunchbase Scout** | Crunchbase API | Funding rounds, company data | Planned |
| **Intent Scout** | Bombora, G2, etc. | Website visits, content engagement | Future |

### Lead5 Scout (First Scout)

Lead5 has exceptional data quality for executive hiring signals but no public API. This is our first Scout, built to learn the Claude Agent SDK.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│  Lead5 Scout (Docker container)                             │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Python Agent (Claude Agent SDK)                      │   │
│  │                                                      │   │
│  │ Tools:                                               │   │
│  │ • Playwright browser (navigate, scrape)              │   │
│  │ • Outbound API client (POST signals)                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Triggered: Daily cron or manual                            │
│  Runtime: ~5-10 minutes per run                             │
│  Output: Signals POSTed to Outbound /api/v1/signals        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**What the Scout does:**
1. Login to Lead5 (credentials from env vars)
2. Search for job postings matching our criteria (CIO, CISO, CTO, interim, fractional)
3. Extract company info, job details, contact info
4. Deduplicate against already-seen postings
5. POST new signals to Outbound API
6. Exit (container dies, will run again tomorrow)

---

## Human Touchpoints

### Where AI Leads

| Stage | AI Capability | Human Override |
|-------|--------------|----------------|
| Universe building | Automated enrichment, deduplication | Manual additions, corrections |
| Signal detection | 24/7 monitoring, scoring | Priority overrides |
| Hypothesis generation | AI-drafted outreach | Review queue for high-risk |
| Initial outreach | Automated email/LinkedIn | Escalation on objections |
| Meeting booking | Calendar integration | Complex scheduling |

### Where Humans Lead (AI Supports)

| Stage | Human Capability | AI Support |
|-------|-----------------|------------|
| Discovery call | Relationship building, needs assessment | Call prep, company research |
| Piper matching | Final executive selection | Suggested matches with rationale |
| Proposal creation | Deal structuring, pricing | Template population, similar deals |
| Negotiation | Complex terms, relationship leverage | Redline tracking, guardrails |
| Contract execution | Authority, judgment | Document generation |
| Engagement kickoff | Introduction, context transfer | Handoff package |

### Escalation Triggers (AI → Human)

1. **Objection detected** - Sentiment analysis flags pushback
2. **High-value account** - Above threshold, Managing Partner involvement required
3. **Complex request** - Outside standard service offerings
4. **Compliance flag** - Potential conflict, regulatory concern
5. **Negotiation impasse** - AI can't resolve within guardrails
6. **Executive request** - Prospect asks to speak with a human

---

## Integration Points

### Piper (Executive Matching)

```
Outbound sends:
- Company profile (industry, size, challenges)
- Signal context (what triggered outreach)
- Stated/inferred needs
- Contact titles/roles

Piper returns:
- Matched Managing Partner(s)
- Match confidence score
- Rationale
- Alternative matches (CFO work, CMO work, etc.)
```

### PartnerConnect (Engagement Management)

```
Outbound sends (on contract signature):
- Client record (company, contacts)
- Engagement record (scope, terms, dates)
- Matched Managing Partner assignment
- Deal context (signals, conversations, proposal)

PartnerConnect returns:
- Client ID
- Engagement ID
- Onboarding checklist status
```

### Atlas (People & Organizations)

```
Outbound queries:
- Canonical company/person records
- Relationship history
- Prior engagements

Outbound writes:
- New companies discovered
- New contacts discovered
- Relationship updates
```

---

## Phased Rollout

### Phase 1: Foundation (Current - Sprint 0-1)
- [x] Universe CRUD (Accounts, Contacts, Segments)
- [x] Signal ingestion model
- [x] Hypothesis workflow with approval
- [x] Audit trail
- [ ] Consent/compliance fields

### Phase 2: Intelligence (Sprint 2-3)
- [ ] **Lead5 Scout** - First Scout, learn Claude Agent SDK
- [ ] HubSpot sync - Outbound creates/updates leads & deals
- [ ] Scoring model with feedback loop
- [ ] Signal decay/freshness
- [ ] Speed-to-lead SLAs
- [ ] LinkedIn Scout (PhantomBuster-based)
- [ ] News Scout (NewsAPI, Google Alerts)

### Phase 3: Matching (Sprint 4-5)
- [ ] Piper integration for executive matching
- [ ] Company needs classification
- [ ] Service catalog mapping

### Phase 4: Proposals (Sprint 6-7)
- [ ] Proposal templates
- [ ] Dynamic proposal generation
- [ ] Pricing rules engine
- [ ] E-signature integration

### Phase 5: Negotiation (Sprint 8-9)
- [ ] Redline tracking
- [ ] Guardrails (terms, pricing floors)
- [ ] Escalation workflows
- [ ] Counter-proposal generation

### Phase 6: Handoff (Sprint 10+)
- [ ] PartnerConnect integration
- [ ] Client/engagement creation
- [ ] Handoff package generation
- [ ] Managing Partner notification

---

## Success Metrics

### Leading Indicators
- Signals detected per week
- Hypotheses generated per signal
- Outreach response rate
- Meeting book rate

### Lagging Indicators
- Proposals sent
- Contracts signed
- Revenue attributed to Outbound-originated deals
- Time from signal to signed contract

### Efficiency Metrics
- Human hours per closed deal (target: declining)
- AI-to-human escalation rate (target: declining over time)
- Cost per qualified meeting

---

## Guardrails & Principles

### Never Autonomous
- Contract signature (human authority required)
- Pricing below floor (requires approval)
- Non-standard terms (requires legal review)
- Gifts/tickets/entertainment (compliance approval)

### Always Transparent
- AI-generated content labeled internally
- Full audit trail on every action
- Source attribution on all signals
- Human override always available

### Market-Appropriate
- US-focused compliance (CAN-SPAM baseline)
- B2B executive norms (professional, not spammy)
- Industry-appropriate cadence (not aggressive)
- Segment-specific rules (PE vs operating co vs client)

---

## The North Star

> **One day, Outbound detects a signal, matches a company to a Managing Partner via Piper, initiates outreach, books a meeting, generates a proposal, supports negotiation, creates the client in PartnerConnect, and the Managing Partner's first touchpoint is the kickoff call.**

The AI does the work. The humans do the relationships.
