# Fortium Outbound - Virtual BDR System

> Always-on virtual BDR (vBDR) that manages target universe, detects signals, generates hypotheses, and tracks plays
> Last Updated: 2025-12-27

## Project Overview

Fortium Outbound is an "always-on" virtual BDR system with five core modules:

1. **Universe** - Target accounts and contacts with segmentation
2. **Signals** - Event detection and intelligence gathering
3. **Hypotheses** - Conversation starters and action recommendations
4. **Plays** - Executed actions and outcome tracking
5. **Scoreboard** - Learning and performance metrics

## Non-Negotiable Principles

- **Audit Trail**: Every action traceable back to signals and data
- **Human-in-the-Loop**: System proposes, humans approve
- **No "Creepy" Behavior**: Track sources/methods, compliance controls
- **Per-Segment Rules**: Different rules for PE vs operating companies vs clients
- **Approval Gates**: High-risk actions require explicit approval

## Technology Stack

### Backend
- **Runtime**: Node.js 20 (Alpine)
- **Framework**: Fastify with TypeScript
- **Validation**: Zod schemas (contract-first)
- **ORM**: Prisma with PostgreSQL
- **Logging**: Pino with pino-pretty (dev)
- **API Docs**: Swagger/OpenAPI via @fastify/swagger

### Frontend
- **Framework**: React 18 with TypeScript
- **Build**: Vite
- **Styling**: Tailwind CSS (shadcn/ui compatible)
- **State**: TanStack Query
- **Routing**: React Router

### Infrastructure
- **Database**: PostgreSQL 16 (Alpine)
- **Containers**: Docker Compose

## Port Allocation

| Service   | Internal | External |
|-----------|----------|----------|
| Database  | 5432     | 5435     |
| API       | 8000     | 8004     |
| Frontend  | 3000     | 3006     |

## Quick Start

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Stop services
docker compose down
```

## Development URLs

- **Frontend**: http://localhost:3006
- **API**: http://localhost:8004
- **API Docs**: http://localhost:8004/docs
- **Health Check**: http://localhost:8004/health

## Key Files

```
outbound/
├── backend/
│   ├── src/
│   │   ├── index.ts          # Fastify entry point
│   │   ├── lib/
│   │   │   ├── config.ts     # Zod-validated env config
│   │   │   └── prisma.ts     # Prisma client singleton
│   │   ├── routes/
│   │   │   ├── health.ts     # Health check routes
│   │   │   ├── accounts.ts   # Account CRUD
│   │   │   ├── contacts.ts   # Contact CRUD
│   │   │   ├── signals.ts    # Signal ingestion
│   │   │   └── hypotheses.ts # Hypothesis workflow
│   │   └── schemas/
│   │       ├── common.ts     # Shared Zod schemas
│   │       ├── universe.ts   # Account/Contact schemas
│   │       ├── signals.ts    # Signal schemas
│   │       └── hypotheses.ts # Hypothesis schemas
│   ├── prisma/
│   │   └── schema.prisma     # Database schema
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── main.tsx          # React entry point
│   │   ├── App.tsx           # Routes and layout
│   │   └── index.css         # Tailwind + CSS variables
│   └── Dockerfile
├── scouts/                    # Signal-finding agents (Claude Agent SDK)
│   └── lead5-scout/          # First Scout - scrapes Lead5 for job postings
│       ├── SPEC.md           # Scout specification
│       └── src/              # Python agent code
└── docker-compose.yml
```

## Database Schema

### Universe Models
- `Account` - Target companies (name, domain, industry, etc.)
- `Contact` - People at accounts (name, email, title, etc.)
- `Segment` - Groupings (PE, portfolio, existing_client, etc.)
- `AccountSegment` / `ContactSegment` - M:M relationships

### Signal Model
- `Signal` - Detected events (type, severity, confidence, source, raw_payload)

### Hypothesis Model
- `Hypothesis` - Action recommendations with approval workflow
  - Status: draft → pending_review → approved/rejected → executed
  - Tracks: novelty, compliance_risk, generation_method

### Play Model
- `Play` - Executed actions with outcome tracking

### Audit Model
- `AuditLog` - Full change history for compliance

## API Endpoints

### Universe
- `GET/POST /api/v1/accounts` - List/Create accounts
- `GET/PATCH/DELETE /api/v1/accounts/:id` - Account operations
- `GET/POST /api/v1/contacts` - List/Create contacts
- `GET/PATCH/DELETE /api/v1/contacts/:id` - Contact operations

### Signals
- `GET/POST /api/v1/signals` - List/Ingest signals
- `GET/PATCH/DELETE /api/v1/signals/:id` - Signal operations

### Hypotheses
- `GET/POST /api/v1/hypotheses` - List/Create hypotheses
- `GET /api/v1/hypotheses/queue` - Review queue (pending_review)
- `POST /api/v1/hypotheses/:id/submit` - Submit for review
- `POST /api/v1/hypotheses/:id/approve` - Approve hypothesis
- `POST /api/v1/hypotheses/:id/reject` - Reject with reason

## Database Commands

```bash
# Generate client (after schema changes)
docker compose exec api npx prisma generate

# Push schema to database
docker compose exec api npx prisma db push

# Create migration
docker compose exec api npx prisma migrate dev --name <name>

# Open Prisma Studio
docker compose exec api npx prisma studio
```

## Common Issues & Fixes

### Prisma OpenSSL Error on Alpine
**Fixed**: Dockerfile includes `RUN apk add --no-cache openssl` and schema includes:
```prisma
binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
```

### Health Check Failing
**Fixed**: Using Node.js-based health checks instead of wget (not in Alpine)

### npm ci Requires package-lock.json
**Fixed**: Dockerfiles use `npm install` instead of `npm ci`

## Compliance Controls

### Signal Source Tracking
Every signal records:
- `source` - Where it came from (linkedin, news_api, manual, etc.)
- `sourceId` - External ID for deduplication
- `sourceUrl` - Original URL if applicable
- `rawPayload` - Original data for audit

### Hypothesis Generation Tracking
Every hypothesis records:
- `generationMethod` - manual, ai_generated, rule_based
- `generationModelId` - Which model (if AI)
- `generationPromptHash` - Hash of prompt used

### Approval Workflow
- Hypotheses start as `draft`
- Submit moves to `pending_review`
- Approver can `approve` or `reject` (with reason)
- High-risk actions (gifts, likeness, aggressive monitoring) require approval

## Strategy Documents

- **`docs/PE_OUTBOUND_STRATEGY.md`** - PE buyer messaging based on PitchBook Q4 2025 analysis. Core thesis: PE needs execution capacity, not capital. Contains 7 key messages, master narrative, and objection handling.

## Related Projects

- **Atlas** (localhost:8003/3005): People & Organization service - source of truth for identity
- **LxP** (localhost:8002/3004): Leadership Execution Platform - operator console
- **linkedin-workspace** (localhost:8000/3003): LinkedIn intelligence services
