# Lead5 Scout - Specification

> First Scout for Fortium Outbound. Built to learn Claude Agent SDK.
> Last Updated: 2026-01-02

## Purpose

The Lead5 Scout finds executive job postings on Lead5.com and reports them to Outbound as signals. Lead5 has excellent data quality for interim/fractional executive roles but no public API, so we use browser automation.

## What This Scout Finds

**Target job postings:**
- Interim CIO, CISO, CTO, CFO
- Fractional executives
- VP/Director level tech leadership
- "Looking for" posts (companies seeking help)

**Why these matter:**
- Company posting for interim CIO = they have a gap Fortium can fill
- High-value signal with clear action path

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Lead5 Scout (TypeScript)                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ main.ts                                                              │   │
│  │                                                                      │   │
│  │ 1. Load config (Zod-validated env vars)                              │   │
│  │ 2. Launch Playwright browser                                         │   │
│  │ 3. Login to Lead5                                                    │   │
│  │ 4. Navigate to executive search                                      │   │
│  │ 5. Extract opportunities from DOM                                    │   │
│  │ 6. POST signals to Outbound API                                      │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Components                                                           │   │
│  │                                                                      │   │
│  │ Playwright:                                                          │   │
│  │ • page.goto(url) - Navigate                                          │   │
│  │ • page.fill(selector, value) - Fill forms                            │   │
│  │ • page.click(selector) - Click elements                              │   │
│  │ • page.locator(...).textContent() - Extract text                     │   │
│  │ • page.screenshot() - Debug snapshots                                │   │
│  │                                                                      │   │
│  │ OutboundClient:                                                      │   │
│  │ • createSignal(payload) - POST to /api/v1/signals                    │   │
│  │ • checkSignalExists(sourceId) - Deduplication                        │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Scout Behavior

### Input (Prompt to Claude)

```
You are the Lead5 Scout. Your job is to find executive job postings on Lead5.com.

CREDENTIALS:
- URL: https://lead5.com (or whatever the actual URL is)
- Username: {from env}
- Password: {from env}

SEARCH CRITERIA:
- Job titles: CIO, CISO, CTO, CFO, VP Technology, VP Engineering
- Keywords: interim, fractional, temporary, contract
- Geography: United States
- Posted: Last 7 days

FOR EACH POSTING FOUND:
1. Extract: company name, job title, location, posted date, description, contact info
2. Check if we've already seen this posting (call check_existing with the posting URL)
3. If new, call create_signal with the extracted data

STOP when you've processed all matching postings from the last 7 days.
```

### Output (Signals to Outbound)

```json
{
  "type": "job_posting",
  "source": "lead5",
  "sourceId": "lead5:posting:12345",
  "sourceUrl": "https://lead5.com/posting/12345",
  "severity": "medium",
  "confidence": 0.9,
  "rawPayload": {
    "companyName": "Acme Corp",
    "jobTitle": "Interim CIO",
    "location": "San Francisco, CA",
    "postedDate": "2026-01-01",
    "description": "Looking for experienced technology leader...",
    "contactName": "Jane Smith",
    "contactEmail": "jane@acme.com",
    "contactTitle": "CEO"
  }
}
```

## File Structure

```
scouts/lead5-scout/
├── SPEC.md              # This file
├── README.md            # Quick start guide
├── Dockerfile           # Container definition
├── package.json         # Node.js dependencies
├── tsconfig.json        # TypeScript config
├── src/
│   ├── main.ts          # Entry point - runs the scout
│   ├── config.ts        # Zod-validated environment config
│   └── outbound-client.ts # Outbound API client
├── dist/                # Compiled JavaScript (git-ignored)
└── .env.example         # Environment template
```

## Environment Variables

```bash
# Lead5 credentials
LEAD5_URL=https://lead5.com
LEAD5_USERNAME=user@fortium.com
LEAD5_PASSWORD=***

# Outbound API
OUTBOUND_API_URL=http://localhost:8004
OUTBOUND_API_KEY=***

# Anthropic
ANTHROPIC_API_KEY=***

# Optional
LOG_LEVEL=INFO
DRY_RUN=false  # Set true to skip actual signal creation
```

## Running the Scout

### Local Development

```bash
cd scouts/lead5-scout
npm install
npx playwright install chromium
npm run dev
```

### Docker

```bash
docker build -t lead5-scout .
docker run --env-file .env lead5-scout
```

### Scheduled (Production)

Options:
- Cron job on a server
- Railway scheduled job
- GitHub Actions scheduled workflow
- AWS Lambda with EventBridge

Recommended frequency: **Daily at 6am ET** (before work day starts)

## Error Handling

| Error | Handling |
|-------|----------|
| Lead5 login fails | Retry 3x, then alert (Slack/email) |
| Lead5 blocks/CAPTCHAs | Stop, alert human |
| Outbound API down | Queue signals locally, retry later |
| Claude API error | Retry with exponential backoff |
| Rate limit | Slow down, respect limits |

## Success Metrics

| Metric | Target |
|--------|--------|
| Signals found per run | 5-20 |
| False positive rate | <10% (manual review) |
| Run success rate | >95% |
| Runtime | <10 minutes |

## MVP Scope (v0.1)

**In scope:**
- Login to Lead5
- Search with basic criteria
- Extract posting data
- POST to Outbound signals endpoint
- Basic deduplication by sourceId

**Out of scope (future):**
- Account matching (Outbound does this)
- Contact enrichment (Outbound does this)
- Multi-page pagination (start with first page only)
- Advanced search filters
- Retry/resume on failure

## Lead5 Site Structure (Discovered 2026-01-02)

### Authentication
- **Login URL:** `https://lead5.com/users/sign_in`
- **Method:** Email/password form submission
- **Post-login redirect:** `/business/dashboard` (business side) or `/l5/app/` (executive side)

### Executive Job Search
- **Search URL:** `https://lead5.com/l5/app/#/l5/app/Search/1`
- **Built-in searches:**
  - My5 Jobs (matches your profile preferences)
  - My5 Network
  - My5 Companies
  - Latest Executive Moves
  - PE Firms / PE Deals
- **Filters:** Function, Industry, Region, Market-Cap, Ownership
- **Date range:** Configurable (default: Last 120 Days)

### Opportunity Listing Data
Each search result contains:
```
- Title (e.g., "CTO Vacancy at RapidRatings")
- Company name
- Type: "POTENTIAL OPPORTUNITY"
- Metro/Location
- Posted date
- Summary/Description
- Optional: "Member contributed" badge
```

### Opportunity Detail Page
URL pattern: `https://lead5.com/l5/app/#/l5/app/ArticleDetails/{id}?ArticleType=8`

Contains:
```
- Full company profile
- Job function, Industry, Market-Cap, Ownership
- Detailed description
- Company Contacts (with titles: CFO, HR, Recruiter, etc.)
- Recent Executive Moves at company
- Related Opportunities
```

### Scout Workflow
```
1. Navigate to /users/sign_in
2. Fill email + password, submit
3. Navigate to /l5/app/#/l5/app/Search/1
4. Click "My5 Jobs" (or apply custom filters)
5. For each listing in results:
   a. Extract: title, company, metro, posted date, description
   b. Optionally click into detail page for company contacts
   c. Check if already in Outbound (by sourceId)
   d. If new, POST to Outbound /api/v1/signals
6. Handle pagination if needed
7. Exit
```

## Open Questions

1. ~~**Lead5 account** - Do we have credentials? What tier?~~ ✅ Have credentials, works
2. **Rate limits** - How aggressive can we scrape? (Start conservative: 2-3 sec between pages)
3. **Search filters** - Use "My5 Jobs" or build custom search?
4. **Account matching** - How does Outbound match company names to existing accounts?
5. **Detail pages** - Scrape company contacts or just listing data?

## Next Steps

1. [x] Get Lead5 credentials ✅
2. [x] Explore Lead5 UI, document structure ✅
3. [ ] Set up scout project structure (Dockerfile, requirements.txt, src/)
4. [ ] Implement Playwright browser automation
5. [ ] Implement Outbound API client tool
6. [ ] Write main agent prompt
7. [ ] Test locally with dry run (DRY_RUN=true)
8. [ ] Test with real signal creation
9. [ ] Containerize
10. [ ] Set up scheduled runs (daily 6am ET)
