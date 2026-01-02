# Sprint 2 Plan: Lead Volume

> Priority: Find MANY more leads per week
> Deferred: Piper integration, PartnerConnect handoff (manual processes work for now)

## Goal

10x the number of qualified leads surfaced to Managing Partners per week.

Current state: Manual prospecting, ad-hoc signal detection
Target state: Automated signal ingestion, prioritized hypothesis queue, multi-channel outreach

---

## Sprint 2 Deliverables

### 1. Signal Ingestion Jobs (P0)

**Goal:** Automated daily signal detection from multiple sources

| Source | Signal Types | Priority |
|--------|-------------|----------|
| LinkedIn (via PhantomBuster) | Job changes, promotions, new hires | P0 |
| News APIs | Funding, acquisitions, leadership changes | P0 |
| Manual entry | Referrals, conference contacts, inbound | P0 |
| Google Alerts | Company mentions, executive mentions | P1 |
| Intent providers | Website visits, content downloads | P2 |

**Schema additions:**
```prisma
model SignalSource {
  id          String   @id @default(uuid())
  name        String   @unique
  type        String   // phantombuster, news_api, manual, google_alerts, intent
  config      Json     // API keys, schedules, filters
  enabled     Boolean  @default(true)
  lastRunAt   DateTime? @map("last_run_at")
  lastRunStatus String? @map("last_run_status")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@map("signal_sources")
}

model SignalJob {
  id          String   @id @default(uuid())
  sourceId    String   @map("source_id")
  status      String   @default("pending") // pending, running, completed, failed
  startedAt   DateTime? @map("started_at")
  completedAt DateTime? @map("completed_at")
  signalsCreated Int   @default(0) @map("signals_created")
  errorMessage String? @map("error_message")

  @@map("signal_jobs")
}
```

**Endpoints:**
- `POST /api/v1/signals/ingest` - Trigger manual ingestion
- `GET /api/v1/signal-sources` - List configured sources
- `POST /api/v1/signal-sources` - Add new source
- `GET /api/v1/signal-jobs` - View job history

---

### 2. Contact Consent & Compliance (P0)

**Goal:** Track opt-out status to avoid legal issues as volume scales

**Schema additions to Contact:**
```prisma
model Contact {
  // ... existing fields ...

  // Compliance
  consentStatus    String   @default("unknown") @map("consent_status") // unknown, opted_in, opted_out, do_not_contact
  consentSource    String?  @map("consent_source") // how consent was obtained
  consentDate      DateTime? @map("consent_date")
  suppressionReason String? @map("suppression_reason")
  lastContactedAt  DateTime? @map("last_contacted_at")
  contactCount     Int      @default(0) @map("contact_count")
}
```

**Endpoints:**
- `POST /api/v1/contacts/:id/opt-out` - Mark contact as opted out
- `GET /api/v1/contacts/suppression-list` - Export do-not-contact list

---

### 3. Signal Scoring & Prioritization (P1)

**Goal:** Surface the best leads first, not just the newest

**Scoring factors:**
- Signal recency (decay over time)
- Signal type weight (job change > news mention)
- Account fit (segment match, size, industry)
- Contact seniority (C-level > VP > Director)
- Signal confidence
- Composite signals (multiple signals on same account = boost)

**Schema additions:**
```prisma
model Signal {
  // ... existing fields ...

  // Scoring
  priorityScore    Float    @default(0) @map("priority_score")
  freshnessScore   Float    @default(1) @map("freshness_score") // decays over time
  expiresAt        DateTime? @map("expires_at")
}

model Account {
  // ... existing fields ...

  // Scoring
  fitScore         Float?   @map("fit_score")
  lastSignalAt     DateTime? @map("last_signal_at")
  signalCount      Int      @default(0) @map("signal_count")
}
```

**Endpoints:**
- `GET /api/v1/signals/prioritized` - Signals sorted by priority score
- `POST /api/v1/signals/recalculate-scores` - Trigger score recalculation

---

### 4. Hypothesis Generation Assist (P1)

**Goal:** Faster hypothesis creation from signals

**Features:**
- Template-based hypothesis generation from signal type
- Auto-populate conversation openers based on signal context
- Suggested messaging based on segment

**Schema additions:**
```prisma
model HypothesisTemplate {
  id              String   @id @default(uuid())
  name            String
  signalType      String   @map("signal_type") // matches signal.type
  segmentId       String?  @map("segment_id")
  titleTemplate   String   @map("title_template")
  summaryTemplate String?  @map("summary_template")
  openerTemplate  String?  @map("opener_template")
  channel         String?

  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("hypothesis_templates")
}
```

**Endpoints:**
- `GET /api/v1/hypothesis-templates` - List templates
- `POST /api/v1/hypothesis-templates` - Create template
- `POST /api/v1/signals/:id/generate-hypothesis` - Generate hypothesis from signal using template

---

### 5. Dashboard Metrics (P1)

**Goal:** Visibility into pipeline health

**Metrics to display:**
- Signals detected this week (by type, by source)
- Hypotheses in queue (by status)
- Accounts with recent signals
- Top priority signals awaiting action
- Conversion: Signal → Hypothesis → Approved → Play

**Endpoints:**
- `GET /api/v1/dashboard/metrics` - Aggregated metrics
- `GET /api/v1/dashboard/pipeline` - Funnel visualization data

---

## Deferred to Sprint 3+

| Feature | Reason |
|---------|--------|
| Multi-channel cadences | Need single-channel working first |
| ML scoring model | Need outcome data to train on |
| Piper integration | Manual matching works |
| PartnerConnect handoff | Manual process works |
| Email infrastructure | Using existing email for now |

---

## Success Criteria

| Metric | Current | Sprint 2 Target |
|--------|---------|-----------------|
| Signals detected/week | ~10 (manual) | 100+ (automated) |
| Hypotheses generated/week | ~5 | 50+ |
| Time to generate hypothesis | Hours | Minutes |
| Leads surfaced to MPs/week | ~3 | 20+ |

---

## Technical Work

### Backend
- [ ] Add SignalSource, SignalJob models
- [ ] Add consent fields to Contact
- [ ] Add scoring fields to Signal, Account
- [ ] Add HypothesisTemplate model
- [ ] Create ingestion job framework
- [ ] Implement PhantomBuster integration (use existing skill)
- [ ] Implement priority scoring algorithm
- [ ] Create dashboard metrics endpoints

### Frontend
- [ ] Signal sources management page
- [ ] Prioritized signal queue view
- [ ] One-click hypothesis generation from signal
- [ ] Dashboard with key metrics
- [ ] Suppression list management

### Jobs/Scheduled Tasks
- [ ] Daily signal ingestion (configurable per source)
- [ ] Hourly score recalculation
- [ ] Daily freshness decay

---

## Integration Notes

### PhantomBuster (linkedin-workspace)
We have PhantomBuster skills and integration in linkedin-workspace. Can reuse:
- Session cookie management
- Rate limiting
- Profile scraping

For Outbound, we need:
- Job change detection on target accounts
- New hire alerts for key titles
- Company news monitoring

### News APIs
Options to evaluate:
- NewsAPI.org (free tier available)
- Bing News Search API
- Google News RSS

---

## Timeline

| Week | Focus |
|------|-------|
| Week 1 | Schema updates, SignalSource model, manual ingestion endpoint |
| Week 2 | PhantomBuster integration, first automated signals |
| Week 3 | Priority scoring, hypothesis templates |
| Week 4 | Dashboard, consent tracking, polish |

---

## Notes

> "Focus on finding MANY more leads per week"
> - Piper integration deferred (manual matching works)
> - PartnerConnect handoff deferred (Operations knows the process)
> - Automate those later once volume justifies it
