# StateScoop Scout - Specification

> Monitors state and local government technology executive moves via RSS feed.
> Last Updated: 2026-01-16

## Purpose

The StateScoop Scout monitors StateScoop.com's RSS feed for executive leadership changes in state and local government technology. Unlike the Lead5 Scout (which requires browser automation), StateScoop provides a public RSS feed with no authentication required.

## What This Scout Finds

**Target signals:**
- CIO/CTO/CISO appointments (new hires, promotions)
- Resignations and retirements
- Interim/acting appointments
- State technology leadership restructuring

**Why these matter:**
- State CIO changes = new decision-maker, fresh budget cycle
- Government tech leadership transition = consulting opportunity
- Public sector moves are high-signal, low-noise events

## Data Source

### RSS Feed
- **URL:** `https://statescoop.com/feed/`
- **Format:** RSS 2.0 with Dublin Core extensions
- **Authentication:** None required
- **Update Frequency:** Hourly
- **Platform:** WordPress

### Feed Item Fields

| Field | XML Element | Example |
|-------|-------------|---------|
| Title | `<title>` | "Delaware CIO Greg Lane resigns" |
| Link | `<link>` | `https://statescoop.com/delaware-cio-greg-lane-resigns/` |
| Author | `<dc:creator>` | "Keely Quinlan" |
| Date | `<pubDate>` | "Thu, 16 Jan 2026 19:05:37 +0000" |
| Categories | `<category>` | "Personnel", "State", "Technology" |
| Description | `<description>` | Brief excerpt (may contain HTML) |
| GUID | `<guid>` | Permanent URL identifier |
| Post ID | `<post-id>` | WordPress post number (e.g., "123456") |

## Architecture

```
+------------------------------------------------------------------------------+
|  StateScoop Scout (Python)                                                    |
+------------------------------------------------------------------------------+
|                                                                              |
|  +------------------------------------------------------------------------+  |
|  | main.py                                                                 |  |
|  |                                                                         |  |
|  | 1. Load config (Pydantic-validated env vars)                            |  |
|  | 2. Fetch RSS feed via HTTP                                              |  |
|  | 3. Parse XML with feedparser                                            |  |
|  | 4. Filter for executive move articles                                   |  |
|  | 5. For each relevant article:                                           |  |
|  |    a. Fetch full article text                                           |  |
|  |    b. Extract entities via Claude API                                   |  |
|  |    c. Check deduplication                                               |  |
|  |    d. POST signal to Outbound API                                       |  |
|  |                                                                         |  |
|  +------------------------------------------------------------------------+  |
|                                                                              |
|  +------------------------------------------------------------------------+  |
|  | Components                                                              |  |
|  |                                                                         |  |
|  | RSS Fetcher:                                                            |  |
|  | - httpx.get(feed_url) - Fetch RSS XML                                   |  |
|  | - feedparser.parse() - Parse RSS items                                  |  |
|  |                                                                         |  |
|  | Article Classifier:                                                     |  |
|  | - Keyword filter: CIO, CTO, CISO, appoint*, resign*, retire*            |  |
|  | - Category filter: "Personnel" tag                                      |  |
|  |                                                                         |  |
|  | Entity Extractor (Claude API):                                          |  |
|  | - Person name and new title                                             |  |
|  | - Organization (state/agency)                                           |  |
|  | - Move type (appointed, resigned, retired, interim)                     |  |
|  | - Previous role (if mentioned)                                          |  |
|  | - Effective date (if mentioned)                                         |  |
|  |                                                                         |  |
|  | OutboundClient:                                                         |  |
|  | - createSignal(payload) - POST to /api/v1/signals                       |  |
|  | - checkSignalExists(sourceId) - Deduplication                           |  |
|  |                                                                         |  |
|  +------------------------------------------------------------------------+  |
|                                                                              |
+------------------------------------------------------------------------------+
```

## Signal Extraction Flow

### Step 1: Filter Relevant Articles

**Keyword-based filtering (title or categories):**
```python
EXECUTIVE_KEYWORDS = [
    "CIO", "CTO", "CISO", "CDO", "CAO",
    "chief information", "chief technology", "chief security",
    "chief data", "chief analytics"
]

MOVE_KEYWORDS = [
    "appoint", "named", "hired", "joins",
    "resign", "depart", "leave", "exit",
    "retire", "interim", "acting"
]

CATEGORY_FILTER = "Personnel"
```

**Example matches:**
- "Delaware CIO Greg Lane resigns"
- "Texas names chief AI and innovation officer as interim CIO"
- "Pennsylvania digital service director appointed state CIO"
- "Michigan CIO quietly resigns, governor names acting replacement"

### Step 2: Fetch Full Article

The RSS description is truncated. For better entity extraction:
1. Fetch the full article HTML from the `<link>` URL
2. Extract main content (strip nav, ads, sidebar)
3. Use BeautifulSoup or readability-lxml

### Step 3: Extract Entities (Claude API)

**Prompt template:**
```
You are extracting structured data from a news article about government technology leadership.

ARTICLE TITLE: {title}
ARTICLE TEXT: {article_text}

Extract the following fields. If not mentioned, use null.

{
  "person_name": "Full name of the person",
  "new_title": "Their new title/role (or null if leaving)",
  "organization": "State/agency/department name",
  "organization_type": "state | county | city | agency",
  "move_type": "appointed | resigned | retired | interim | acting | promoted",
  "previous_role": "Their previous title if mentioned",
  "effective_date": "ISO date if mentioned, else null",
  "replacement_name": "Name of replacement if mentioned",
  "additional_context": "Brief summary of circumstances"
}

Return ONLY valid JSON.
```

### Step 4: Check Deduplication

**sourceId format:** `statescoop:article:{guid}`

Example: `statescoop:article:https://statescoop.com/delaware-cio-greg-lane-resigns/`

### Step 5: Create Signal

```json
{
  "type": "executive_move",
  "source": "statescoop",
  "sourceId": "statescoop:article:https://statescoop.com/delaware-cio-greg-lane-resigns/",
  "sourceUrl": "https://statescoop.com/delaware-cio-greg-lane-resigns/",
  "severity": "medium",
  "confidence": 0.85,
  "rawPayload": {
    "articleTitle": "Delaware CIO Greg Lane resigns",
    "articleAuthor": "Keely Quinlan",
    "publishedDate": "2026-01-16T19:05:37Z",
    "personName": "Greg Lane",
    "newTitle": null,
    "organization": "Delaware",
    "organizationType": "state",
    "moveType": "resigned",
    "previousRole": "Chief Information Officer",
    "effectiveDate": null,
    "replacementName": null,
    "additionalContext": "Lane served since June 2023"
  }
}
```

## Signal Types by Move

| Move Type | Severity | Action Potential |
|-----------|----------|------------------|
| resigned/retired | high | Immediate gap to fill |
| interim/acting | high | Temporary need, urgent timeline |
| appointed | medium | New decision-maker, relationship building |
| promoted | low | Internal move, existing relationship |

## File Structure

```
scouts/statescoop-scout/
+-- SPEC.md              # This file
+-- README.md            # Quick start guide
+-- Dockerfile           # Container definition
+-- pyproject.toml       # Python dependencies
+-- src/
|   +-- main.py          # Entry point - runs the scout
|   +-- config.py        # Pydantic settings
|   +-- rss_fetcher.py   # RSS feed fetching and parsing
|   +-- article_parser.py # Full article content extraction
|   +-- entity_extractor.py # Claude API entity extraction
|   +-- outbound_client.py  # Outbound API client
|   +-- models.py        # Pydantic models
+-- tests/
|   +-- test_rss_fetcher.py
|   +-- test_entity_extractor.py
+-- .env.example         # Environment template
```

## Dependencies

```toml
[project]
name = "statescoop-scout"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "httpx>=0.27.0",
    "feedparser>=6.0.10",
    "beautifulsoup4>=4.12.0",
    "lxml>=5.0.0",
    "anthropic>=0.40.0",
    "pydantic>=2.5.0",
    "pydantic-settings>=2.1.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "pytest-asyncio>=0.23.0",
    "respx>=0.21.0",
]
```

## Environment Variables

```bash
# Outbound API
OUTBOUND_API_URL=http://localhost:8004
OUTBOUND_API_KEY=***

# Anthropic
ANTHROPIC_API_KEY=***

# Optional
LOG_LEVEL=INFO
DRY_RUN=false           # Set true to skip actual signal creation
LOOKBACK_DAYS=7         # How far back to check articles
FETCH_FULL_ARTICLE=true # Whether to fetch full article text
```

## Running the Scout

### Local Development

```bash
cd scouts/statescoop-scout
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
python3 -m src.main
```

### Docker

```bash
docker build -t statescoop-scout .
docker run --env-file .env statescoop-scout
```

### Scheduled (Production)

Recommended frequency: **Every 6 hours** (StateScoop updates frequently)

Options:
- Cron job: `0 */6 * * * /path/to/run-scout.sh`
- Railway scheduled job
- GitHub Actions scheduled workflow
- AWS Lambda with EventBridge

## Differences from Lead5 Scout

| Aspect | Lead5 Scout | StateScoop Scout |
|--------|-------------|------------------|
| Data Source | Website (scraping) | RSS feed |
| Authentication | Required (email/password) | None |
| Technology | Playwright (browser) | httpx + feedparser |
| Entity Extraction | DOM selectors | Claude API (NLP) |
| Signal Type | job_posting | executive_move |
| Target Sector | Private sector executives | Public sector (government) |
| Complexity | High (browser automation) | Low (HTTP + XML) |

## Error Handling

| Error | Handling |
|-------|----------|
| RSS feed unavailable | Retry 3x with backoff, then alert |
| Article fetch fails | Skip article, log warning |
| Claude API error | Retry with exponential backoff |
| Entity extraction fails | Log raw article, skip signal |
| Outbound API down | Queue signals locally, retry later |

## Success Metrics

| Metric | Target |
|--------|--------|
| Signals found per run | 1-5 |
| Entity extraction accuracy | >90% |
| False positive rate | <5% (validated by spot-check) |
| Run success rate | >99% |
| Runtime | <2 minutes |

## MVP Scope (v0.1)

**In scope:**
- Fetch RSS feed
- Filter by keywords and categories
- Fetch full article content
- Extract entities via Claude API
- POST signals to Outbound
- Basic deduplication by sourceId

**Out of scope (future):**
- Historical backfill (site search/archive)
- EdScoop sister site (education sector)
- FedScoop sister site (federal government)
- State/agency to Account matching in scout (Outbound handles this)
- Contact enrichment (Outbound handles this)

## Related Sources (Future Scouts)

| Source | Sector | Access |
|--------|--------|--------|
| EdScoop | Education technology | RSS feed |
| FedScoop | Federal government | RSS feed |
| GCN | Government technology | RSS feed |
| Government Executive | Federal leadership | RSS feed |
| Route Fifty | State/local policy | RSS feed |

## Open Questions

1. **Article parsing** - Use readability-lxml or simple BeautifulSoup? (Start with BS4)
2. **Claude model** - Use Haiku for cost efficiency or Sonnet for accuracy? (Start with Haiku)
3. **Rate limiting** - Any StateScoop fetch limits? (Assume 1 req/sec to be polite)
4. **Account matching** - How does Outbound match "State of Delaware" to an Account?

## Next Steps

1. [ ] Set up scout project structure
2. [ ] Implement RSS fetcher with feedparser
3. [ ] Implement article content extractor
4. [ ] Implement Claude entity extraction
5. [ ] Implement Outbound API client
6. [ ] Write main orchestration logic
7. [ ] Test locally with DRY_RUN=true
8. [ ] Test with real signal creation
9. [ ] Containerize
10. [ ] Set up scheduled runs (every 6 hours)
