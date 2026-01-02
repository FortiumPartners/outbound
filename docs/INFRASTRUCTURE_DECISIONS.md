# Infrastructure Decisions

> Key technical and platform decisions for Outbound
> Last Updated: 2025-12-29

---

## Email Infrastructure

### Sending Domain
**fortiumpartners.co**

- Dedicated outbound domain (protects primary fortiumpartners.com reputation)
- DNS records needed: SPF, DKIM, DMARC
- Domain warming handled by Apollo

### Email Platform
**Apollo.io**

Why Apollo:
- Built-in contact database + enrichment
- Email sequencing with personalization
- LinkedIn automation integration
- Deliverability management (warmup, reputation)
- Analytics and A/B testing
- CRM sync capabilities

What Apollo handles (we don't build):
- Email sending infrastructure
- Domain warming
- Bounce handling
- Unsubscribe management
- Deliverability monitoring
- Sequence execution

What Outbound handles:
- Signal detection → who to reach out to
- Hypothesis generation → why to reach out
- Contact/Account enrichment → context for personalization
- Outcome tracking → learning loop back to scoring
- Compliance rules → which contacts are safe to contact

---

## Integration Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         OUTBOUND                                 │
│                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                  │
│  │ Universe │───▶│ Signals  │───▶│Hypotheses│                  │
│  │          │    │          │    │          │                  │
│  │ Accounts │    │ Scored & │    │ Approved │                  │
│  │ Contacts │    │ Prioritzd│    │ Ready    │                  │
│  └──────────┘    └──────────┘    └────┬─────┘                  │
│                                       │                         │
│                                       ▼                         │
│                              ┌─────────────────┐               │
│                              │  APOLLO SYNC    │               │
│                              │                 │               │
│                              │ • Push contacts │               │
│                              │ • Add to sequence│              │
│                              │ • Pull outcomes │               │
│                              └────────┬────────┘               │
│                                       │                         │
└───────────────────────────────────────┼─────────────────────────┘
                                        │
                                        ▼
                    ┌───────────────────────────────────┐
                    │            APOLLO.IO              │
                    │                                   │
                    │  • Email sequences                │
                    │  • LinkedIn automation            │
                    │  • Deliverability management      │
                    │  • fortiumpartners.co sending     │
                    │                                   │
                    │  Outcomes:                        │
                    │  • Opened, Clicked, Replied       │
                    │  • Bounced, Unsubscribed          │
                    │  • Meeting booked                 │
                    └───────────────────────────────────┘
```

---

## Apollo Integration Points

### Outbound → Apollo (Push)

**When hypothesis is approved:**
1. Upsert contact in Apollo (with enrichment data)
2. Add contact to appropriate sequence
3. Set personalization variables from hypothesis context

**Data to sync:**
```json
{
  "contact": {
    "email": "jane.doe@acme.com",
    "first_name": "Jane",
    "last_name": "Doe",
    "title": "CTO",
    "company": "Acme Corp",
    "linkedin_url": "https://linkedin.com/in/janedoe"
  },
  "custom_fields": {
    "outbound_contact_id": "uuid",
    "outbound_hypothesis_id": "uuid",
    "signal_type": "job_change",
    "signal_summary": "Promoted to CTO 2 weeks ago",
    "conversation_opener": "Congratulations on the CTO role...",
    "segment": "pe_portfolio"
  },
  "sequence_id": "seq_abc123"
}
```

### Apollo → Outbound (Pull)

**Poll for outcomes (or webhook):**
- Email opened
- Email clicked
- Email replied
- Email bounced
- Unsubscribed
- Meeting booked

**Update Play record:**
```json
{
  "play_id": "uuid",
  "status": "replied",
  "outcome": "positive",
  "apollo_sequence_id": "seq_abc123",
  "apollo_contact_id": "con_xyz789",
  "events": [
    {"type": "sent", "timestamp": "..."},
    {"type": "opened", "timestamp": "..."},
    {"type": "replied", "timestamp": "..."}
  ]
}
```

---

## Schema Additions for Apollo

```prisma
// Apollo integration tracking
model ApolloSync {
  id                String   @id @default(uuid())
  contactId         String   @map("contact_id")
  hypothesisId      String?  @map("hypothesis_id")
  playId            String?  @map("play_id")

  // Apollo references
  apolloContactId   String?  @map("apollo_contact_id")
  apolloSequenceId  String?  @map("apollo_sequence_id")

  // Sync status
  syncStatus        String   @default("pending") // pending, synced, failed
  syncedAt          DateTime? @map("synced_at")
  errorMessage      String?  @map("error_message")

  // Outcome tracking
  lastOutcome       String?  @map("last_outcome")
  lastOutcomeAt     DateTime? @map("last_outcome_at")

  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  @@map("apollo_syncs")
}

// Sequence templates (maps to Apollo sequences)
model OutboundSequence {
  id                String   @id @default(uuid())
  name              String
  description       String?
  apolloSequenceId  String   @map("apollo_sequence_id")

  // Targeting
  segmentId         String?  @map("segment_id")
  signalTypes       String[] @map("signal_types") // which signal types use this sequence

  // Status
  active            Boolean  @default(true)

  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  @@map("outbound_sequences")
}
```

---

## API Endpoints for Apollo Integration

```
# Sync management
POST /api/v1/apollo/sync-contact/:contactId     - Push contact to Apollo
POST /api/v1/apollo/add-to-sequence             - Add contact to sequence
GET  /api/v1/apollo/sync-status/:contactId      - Check sync status

# Outcome ingestion
POST /api/v1/apollo/webhook                     - Receive Apollo webhooks
POST /api/v1/apollo/poll-outcomes               - Manual outcome poll

# Sequence management
GET  /api/v1/sequences                          - List configured sequences
POST /api/v1/sequences                          - Create sequence mapping
```

---

## Apollo API Reference

**Base URL:** `https://api.apollo.io/v1`

**Key endpoints we'll use:**
- `POST /contacts` - Create/update contact
- `POST /contacts/{id}/add_to_sequence` - Add to sequence
- `GET /contacts/{id}` - Get contact with engagement data
- `GET /email_accounts` - List sending accounts
- `GET /sequences` - List sequences

**Authentication:** API key in header `X-Api-Key`

**Rate limits:** 50 requests/minute on base plan

---

## Sequence Strategy

### By Signal Type

| Signal Type | Sequence | Tone |
|-------------|----------|------|
| Job change (promotion) | Congratulations sequence | Warm, celebratory |
| Job change (new role) | Welcome sequence | Helpful, introductory |
| Funding announcement | Growth sequence | Strategic, advisory |
| Leadership change | Transition sequence | Supportive, consultative |
| Expansion/hiring | Scaling sequence | Operational focus |

### By Segment

| Segment | Approach | Cadence |
|---------|----------|---------|
| PE firms | Direct, ROI-focused | Shorter (3-5 touches) |
| Portfolio companies | Operational, hands-on | Medium (5-7 touches) |
| Net new | Educational, trust-building | Longer (7-10 touches) |
| Past clients | Re-engagement, updates | Light (2-3 touches) |

---

## DNS Setup Required

For fortiumpartners.co:

```
# SPF
TXT  @  "v=spf1 include:_spf.apollo.io ~all"

# DKIM (Apollo will provide specific value)
CNAME  apollo._domainkey  [apollo-provided-value]

# DMARC
TXT  _dmarc  "v=DMARC1; p=quarantine; rua=mailto:dmarc@fortiumpartners.co"

# Custom tracking domain (optional)
CNAME  track  [apollo-provided-value]
```

---

## Next Steps

1. [ ] Set up Apollo account (if not already)
2. [ ] Configure fortiumpartners.co in Apollo
3. [ ] Set up DNS records
4. [ ] Create initial sequences in Apollo
5. [ ] Build Apollo sync endpoints in Outbound
6. [ ] Test end-to-end: Signal → Hypothesis → Apollo → Outcome
