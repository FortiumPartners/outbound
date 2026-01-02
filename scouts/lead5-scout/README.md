# Lead5 Scout

> First Scout for Fortium Outbound - finds executive job postings on Lead5.com

## Overview

Lead5 Scout automates finding executive opportunities:
1. Logs into Lead5.com
2. Searches for CIO/CTO/CISO job postings
3. Extracts opportunity data
4. POSTs signals to the Outbound API

## Prerequisites

- Node.js 20+
- Lead5 account credentials
- Running Outbound API (localhost:8004)

## Quick Start

### 1. Install Dependencies

```bash
cd scouts/lead5-scout

# Install npm packages
npm install

# Install Playwright browsers
npx playwright install chromium
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

Required variables:
- `LEAD5_EMAIL` - Your Lead5 login email
- `LEAD5_PASSWORD` - Your Lead5 password
- `ANTHROPIC_API_KEY` - Your Anthropic API key

### 3. Start Outbound (if not running)

```bash
cd ../..  # Back to outbound root
docker compose up -d
```

### 4. Run the Scout

```bash
# Development (with tsx hot reload)
npm run dev

# Dry run (no signals created)
DRY_RUN=true npm run dev

# Production build and run
npm run build
npm start
```

## Docker Usage

### Build

```bash
docker build -t lead5-scout .
```

### Run

```bash
docker run --env-file .env \
  --network host \
  lead5-scout
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LEAD5_EMAIL` | (required) | Lead5 login email |
| `LEAD5_PASSWORD` | (required) | Lead5 password |
| `ANTHROPIC_API_KEY` | (required) | Anthropic API key |
| `OUTBOUND_API_URL` | `http://localhost:8004` | Outbound API URL |
| `OUTBOUND_API_KEY` | (optional) | Outbound API key |
| `DRY_RUN` | `false` | If true, log signals but don't create |
| `LOG_LEVEL` | `info` | Logging level |
| `MAX_RESULTS` | `50` | Max opportunities per run |
| `RATE_LIMIT_MS` | `2000` | Delay between API calls (ms) |

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  Lead5 Scout                                                │
│                                                             │
│  1. main.ts loads config and launches Playwright            │
│  2. Logs into Lead5 with credentials                        │
│  3. Navigates to executive job search                       │
│  4. Extracts opportunities from search results              │
│  5. For each opportunity:                                   │
│     - Checks if signal already exists (dedup)               │
│     - POSTs new signal to Outbound API                      │
│  6. Reports stats and exits                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Output

Signals created in Outbound look like:

```json
{
  "type": "job_posting",
  "source": "lead5",
  "sourceId": "lead5:opp:abc123",
  "sourceUrl": "https://lead5.com/l5/app/#/l5/app/ArticleDetails/abc123",
  "severity": "medium",
  "confidence": 0.9,
  "rawPayload": {
    "companyName": "Acme Corp",
    "jobTitle": "Chief Technology Officer",
    "metro": "New York City",
    "postedDate": "2026-01-02",
    "description": "CTO Vacancy at Acme Corp..."
  }
}
```

## Scheduling

Run daily at 6am ET for best results:

```bash
# Cron example
0 6 * * * cd /path/to/lead5-scout && npm start >> scout.log 2>&1
```

## Troubleshooting

### "Login failed"
- Verify Lead5 credentials in `.env`
- Try logging in manually at https://lead5.com/users/sign_in

### "No opportunities found"
- Check your Lead5 "My5 Preferences" profile
- The search uses your profile preferences by default
- Check `debug-screenshot.png` for page state

### "Outbound API error"
- Ensure Outbound is running: `docker compose ps`
- Check API health: `curl http://localhost:8004/health`

## Development

### Type check
```bash
npm run typecheck
```

### View debug output
```bash
LOG_LEVEL=debug npm run dev
```

## See Also

- [SPEC.md](./SPEC.md) - Full specification
- [Outbound CLAUDE.md](../../CLAUDE.md) - Project overview
- [Product Vision](../../docs/PRODUCT_VISION.md) - Scouts architecture
