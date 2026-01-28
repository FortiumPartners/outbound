# StateScoop Scout

Monitors StateScoop.com's RSS feed for executive leadership changes in state and local government technology.

## What It Finds

- CIO/CTO/CISO appointments (new hires, promotions)
- Resignations and retirements
- Interim/acting appointments
- State technology leadership restructuring

## Why These Matter

- State CIO changes = new decision-maker, fresh budget cycle
- Government tech leadership transition = consulting opportunity
- Public sector moves are high-signal, low-noise events

## Quick Start

### Local Development

```bash
cd scouts/statescoop-scout

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -e ".[dev]"

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Run the scout
python3 -m src.main
```

### Docker

```bash
docker build -t statescoop-scout .
docker run --env-file .env statescoop-scout
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OUTBOUND_API_URL` | `http://localhost:8004` | Outbound API base URL |
| `OUTBOUND_API_KEY` | (optional) | API key for authentication |
| `ANTHROPIC_API_KEY` | (required) | Anthropic API key for entity extraction |
| `DRY_RUN` | `false` | Skip actual signal creation |
| `LOG_LEVEL` | `INFO` | Logging verbosity |
| `LOOKBACK_DAYS` | `7` | How far back to check articles |
| `FETCH_FULL_ARTICLE` | `true` | Fetch full article text |
| `RATE_LIMIT_MS` | `1000` | Delay between HTTP requests |

## How It Works

1. **Fetch RSS Feed** - Downloads StateScoop's RSS feed
2. **Filter Articles** - Matches executive keywords (CIO, CTO, CISO) + move keywords (appoint, resign, retire)
3. **Fetch Full Article** - Gets complete article text for better extraction
4. **Extract Entities** - Uses Claude Haiku to extract structured data (person, title, organization, move type)
5. **Check Deduplication** - Skips if signal already exists
6. **Create Signal** - POSTs to Outbound API

## Signal Format

```json
{
  "type": "executive_move",
  "source": "statescoop",
  "sourceId": "statescoop:article:https://statescoop.com/...",
  "sourceUrl": "https://statescoop.com/...",
  "severity": "high",
  "confidence": 0.85,
  "rawPayload": {
    "articleTitle": "Delaware CIO Greg Lane resigns",
    "personName": "Greg Lane",
    "newTitle": null,
    "organization": "Delaware",
    "organizationType": "state",
    "moveType": "resigned",
    "previousRole": "Chief Information Officer",
    "additionalContext": "Lane served since June 2023"
  }
}
```

## Severity Levels

| Move Type | Severity | Reason |
|-----------|----------|--------|
| resigned/retired | high | Immediate gap to fill |
| interim/acting | high | Temporary need, urgent timeline |
| appointed | medium | New decision-maker |
| promoted | low | Internal move |

## Scheduled Runs

Recommended: **Every 6 hours** (StateScoop updates frequently)

Options:
- Cron: `0 */6 * * * /path/to/run-scout.sh`
- Railway scheduled job
- GitHub Actions scheduled workflow

## Testing

```bash
# Run tests
pytest

# Run with verbose output
pytest -v

# Run in dry-run mode
DRY_RUN=true python3 -m src.main
```

## Project Structure

```
statescoop-scout/
├── src/
│   ├── __init__.py
│   ├── main.py            # Entry point
│   ├── config.py          # Pydantic settings
│   ├── models.py          # Data models
│   ├── rss_fetcher.py     # RSS feed parsing
│   ├── article_parser.py  # Full article extraction
│   ├── entity_extractor.py # Claude API extraction
│   └── outbound_client.py # Outbound API client
├── tests/
│   └── __init__.py
├── pyproject.toml
├── Dockerfile
├── .env.example
├── README.md
└── SPEC.md
```

## See Also

- [SPEC.md](./SPEC.md) - Full specification document
- [Lead5 Scout](../lead5-scout/) - TypeScript scout for job postings
