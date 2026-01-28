# Website Traffic Scout

> Monitor website visits to detect prospective client interest signals
> Status: **PROPOSED** (not yet implemented)
> Created: 2026-01-14

## Overview

The Website Traffic Scout monitors website visits from HubSpot and Leadfeeder on a daily basis to identify companies showing interest in Fortium's services. It enriches interesting visitors with company and contact data, then generates signals for BDR follow-up.

## Data Sources

| Source | What It Provides | API |
|--------|-----------------|-----|
| **HubSpot** | Website visits, page views, known contacts | HubSpot Analytics API |
| **Leadfeeder** | Anonymous company identification, visit patterns | Leadfeeder API |
| **Clearbit/Apollo** | Company enrichment, contact discovery | Enrichment APIs |

## Core Logic

### 1. Daily Visit Collection

```
┌─────────────────┐     ┌─────────────────┐
│    HubSpot      │     │   Leadfeeder    │
│  Website Visits │     │  Company Visits │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
         ┌─────────────────────┐
         │  Dedupe & Merge     │
         │  (by domain/company)│
         └──────────┬──────────┘
                    ▼
         ┌─────────────────────┐
         │  Visitor Classifier │
         └──────────┬──────────┘
                    │
      ┌─────────────┼─────────────┐
      ▼             ▼             ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Prospect │  │  Vendor  │  │Candidate │
│  Client  │  │ (filter) │  │ (future) │
└────┬─────┘  └──────────┘  └──────────┘
     │
     ▼
┌─────────────────────┐
│  Enrich & Create    │
│  Signal in Outbound │
└─────────────────────┘
```

### 2. Visitor Classification

The key challenge is distinguishing visitor intent:

#### Prospective Clients (TARGET)
- Companies in target segments (PE portfolio, mid-market, etc.)
- Visiting service pages (Interim CFO, CTO Services, etc.)
- Multiple visits or multiple pages
- Not in existing "vendor" list
- Not showing candidate behavior

#### Vendors (FILTER OUT)
Maintain a vendor list for common false positives:
- Recruiting agencies
- Software vendors
- Marketing agencies
- Consultants pitching services

**Signals:**
- Known vendor domain (salesforce.com, hubspot.com, etc.)
- Visiting careers/about pages primarily
- Single-page bounces to homepage

#### Candidates (FUTURE - Holy Grail)
People looking for roles, not services:
- Visiting careers page
- Visiting "Join Our Network" or partner pages
- Individual (not company) browsing pattern
- Time of day patterns (lunch, evenings = job seekers)

**This is hard because:**
- A CTO visiting might be a prospect OR a candidate
- Same company domain could be both
- Need to look at page path patterns

### 3. Interest Scoring

Score visits to prioritize signal generation:

| Factor | Points | Notes |
|--------|--------|-------|
| Multiple visits (3+ days) | +30 | Sustained interest |
| Multiple pages per visit | +20 | Deep engagement |
| Service page views | +25 | Specific interest |
| Case study views | +20 | Evaluating fit |
| Contact/pricing pages | +30 | High intent |
| Known contact in HubSpot | +15 | Existing relationship |
| PE-backed company | +10 | Target segment |
| Careers page only | -50 | Likely candidate |
| Known vendor domain | -100 | Filter out |

**Threshold:** Score >= 50 to generate signal

### 4. Company Enrichment

For companies passing the threshold:

1. **Check HubSpot** - Do we already have this company?
2. **Enrich with Clearbit/Apollo** - Get industry, size, funding, contacts
3. **Identify contacts** - Find decision makers (CEO, CFO, CTO, etc.)
4. **Check PE backing** - Is this a PE portfolio company?

### 5. Signal Generation

Create signal in Outbound with:

```json
{
  "type": "website_interest",
  "source": "website-traffic-scout",
  "companyName": "Acme Corp",
  "companyDomain": "acme.com",
  "rawPayload": {
    "visitCount": 5,
    "pagesViewed": ["services/interim-cfo", "case-studies", "contact"],
    "firstVisit": "2026-01-10",
    "lastVisit": "2026-01-14",
    "sources": ["hubspot", "leadfeeder"],
    "interestScore": 75
  },
  "analysis": {
    "summary": "Acme Corp (PE-backed, healthcare) visited CFO services 5 times this week",
    "pagesOfInterest": ["Interim CFO", "Healthcare Case Study"],
    "possibleIntent": "Evaluating interim CFO for portfolio company"
  }
}
```

## Vendor Exclusion List

Maintain in database or config:

```yaml
vendor_domains:
  # CRM/Marketing
  - salesforce.com
  - hubspot.com
  - marketo.com
  - pardot.com

  # Recruiting
  - linkedin.com
  - indeed.com
  - glassdoor.com
  - ziprecruiter.com

  # Software Vendors
  - google.com
  - microsoft.com
  - amazon.com
  - aws.amazon.com

  # Consultants/Agencies
  - accenture.com
  - deloitte.com
  - mckinsey.com

  # Known service providers (add as discovered)
  - ...
```

## Candidate vs Client Detection (Future)

This is the "holy grail" - distinguishing a CTO browsing as a potential client vs. browsing as a potential candidate.

### Possible Signals

| Signal | Suggests Client | Suggests Candidate |
|--------|----------------|-------------------|
| Pages viewed | Service pages, case studies | Careers, "Join Network" |
| Time of day | Business hours | Lunch, evenings, weekends |
| Device | Desktop | Mobile |
| Referrer | Google search for "interim CTO" | LinkedIn, job boards |
| Session depth | Multiple pages, return visits | Quick bounce |
| Company context | PE-backed, in transition | Stable company |

### Implementation Approach

1. **Phase 1**: Binary filter - careers page viewers = candidate, exclude
2. **Phase 2**: ML classifier trained on known outcomes
3. **Phase 3**: Integration with candidate pipeline (hand off to recruiting)

## Run Schedule

- **Frequency**: Daily at 6:00 AM
- **Lookback**: Previous 24 hours
- **Batch size**: Process all visits, generate signals for qualifying companies

## Dependencies

- HubSpot API access (website analytics)
- Leadfeeder API access
- Clearbit or Apollo for enrichment
- Outbound API for signal creation

## Success Metrics

| Metric | Target |
|--------|--------|
| Signals generated per week | 10-20 |
| Signal-to-conversation rate | 5%+ |
| False positive rate (vendors/candidates) | <20% |
| Companies enriched successfully | 80%+ |

## Open Questions

1. **Leadfeeder access** - Do we have API credentials?
2. **Enrichment provider** - Clearbit vs Apollo vs both?
3. **HubSpot analytics** - Which tracking is enabled on fortiumpartners.com?
4. **Candidate handling** - Route to recruiting or just filter out?
5. **Visit threshold** - Minimum visits before considering?

## Related Scouts

- **Lead5 Scout** - Detects job postings (complementary signal)
- **News Scout** (proposed) - Detects company news/events
- **PE Portfolio Scout** (proposed) - Monitors PE portfolio changes
