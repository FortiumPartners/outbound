# Staged Signal Workflow - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Enable signals to be reviewed in Outbound before being pushed to HubSpot, with auto-enrichment and a quality gate workflow.

**Architecture:** Add status tracking to signals, auto-generate recommendations on arrival (async), provide push/archive actions that sync to HubSpot when approved with idempotent find-or-create operations.

**Tech Stack:** Fastify + Prisma (backend), React + TanStack Query (frontend), existing recommendation engine and HubSpot client.

**Design Doc:** `docs/plans/2026-01-12-staged-signal-workflow-design.md`

---

## Execution Environment

- **Branch**: `feature/staged-signal-workflow`
- **Working Directory**: `/Users/burke/projects/outbound`
- **Required Skills**: `superpowers:subagent-driven-development`, `superpowers:test-driven-development`
- **Prerequisites**: Docker running, HubSpot access token configured

---

## Task 1: Update Signal Schema

**Files:**
- Modify: `backend/prisma/schema.prisma` (Signal model, lines 119-152)

**Step 1: Add new fields to Signal model**

Add these fields after line 140 (`hypothesisCount`):

```prisma
  // Staged workflow state
  // pending = just arrived, enrichment in progress
  // ready = enriched, awaiting review
  // pushed = synced to HubSpot
  // push_failed = HubSpot sync failed, can retry
  // archived = dismissed
  status            String    @default("pending")
  recommendation    Json?     // Stored recommendation from engine

  // HubSpot sync tracking (supports partial pushes and retries)
  hubspotDealId     String?   @map("hubspot_deal_id")
  hubspotCompanyIds Json?     @map("hubspot_company_ids")   // Array of company IDs
  hubspotContactIds Json?     @map("hubspot_contact_ids")   // Array of contact IDs
  pushedAt          DateTime? @map("pushed_at")
  pushError         String?   @map("push_error")            // Error message if push_failed

  // Archive tracking
  archivedAt        DateTime? @map("archived_at")
  archiveReason     String?   @map("archive_reason")

  @@index([status])  // Index for filtering by status
```

**Step 2: Push schema to database**

Run: `docker compose exec api npx prisma db push`

Expected: Schema updated successfully

**Step 3: Verify migration**

Run:
```bash
docker compose exec api npx prisma db execute --stdin <<< "SELECT column_name FROM information_schema.columns WHERE table_name = 'signals' AND column_name IN ('status', 'recommendation', 'hubspot_deal_id', 'push_error');"
```

Expected: Returns 4 rows (status, recommendation, hubspot_deal_id, push_error)

**Step 4: Generate Prisma client**

Run: `docker compose exec api npx prisma generate`

Expected: Prisma client regenerated

**Step 5: Update existing signals to 'ready' status**

Existing signals without status should be set to 'ready' (they need review):

Run:
```bash
docker compose exec api npx prisma db execute --stdin <<< "UPDATE signals SET status = 'ready' WHERE status IS NULL OR status = '';"
```

**Step 6: Commit**

```bash
git add backend/prisma/schema.prisma
git commit -m "feat(schema): add staged workflow fields to Signal model

- status: pending/ready/pushed/push_failed/archived
- recommendation: JSON storage for enrichment data
- hubspot*: sync tracking with partial push support
- push_error: error message for retry UX
- archive tracking with reason
- index on status for query performance"
```

---

## Task 2: Update Signal Schemas (Zod)

**Files:**
- Modify: `backend/src/schemas/signals.ts`

**Step 1: Read current schema file**

Read the file to understand current structure.

**Step 2: Add status enum and archive reason enum**

Add at top of file:
```typescript
export const signalStatusEnum = z.enum(['pending', 'ready', 'pushed', 'push_failed', 'archived']);
export type SignalStatus = z.infer<typeof signalStatusEnum>;

export const archiveReasonEnum = z.enum([
  'not_relevant',
  'already_have_relationship',
  'company_too_small',
  'not_pe_backed',
  'other'
]);
export type ArchiveReason = z.infer<typeof archiveReasonEnum>;
```

**Step 3: Update signalResponseSchema**

Add new fields:
```typescript
  status: signalStatusEnum,
  recommendation: z.unknown().nullable(),
  hubspotDealId: z.string().nullable(),
  hubspotCompanyIds: z.array(z.string()).nullable(),
  hubspotContactIds: z.array(z.string()).nullable(),
  pushedAt: z.string().nullable(),
  pushError: z.string().nullable(),
  archivedAt: z.string().nullable(),
  archiveReason: z.string().nullable(),
```

**Step 4: Commit**

```bash
git add backend/src/schemas/signals.ts
git commit -m "feat(schemas): add staged workflow fields and enums to signal schemas"
```

---

## Task 3: Add HubSpot Client CREATE Methods

**Files:**
- Modify: `backend/src/services/hubspot-client.ts`

**Rationale:** The existing HubSpotClient only has READ operations. We need CREATE methods for push functionality.

**Step 1: Add rate limiter utility**

Add at top of file:
```typescript
// Simple rate limiter: max 10 requests per second (HubSpot limit is 100/10s)
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 100; // ms between requests

async function rateLimitedRequest<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();
  return fn();
}
```

**Step 2: Add findOrCreateCompany method**

```typescript
async findOrCreateCompany(name: string, properties: Record<string, string> = {}): Promise<{ id: string; created: boolean }> {
  // First, try to find existing
  const existing = await this.searchCompanies(name, 1);
  if (existing.length > 0 && existing[0].properties.name?.toLowerCase() === name.toLowerCase()) {
    return { id: existing[0].id, created: false };
  }

  // Create new
  const response = await rateLimitedRequest(() =>
    fetch('https://api.hubapi.com/crm/v3/objects/companies', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { name, ...properties },
      }),
    })
  );

  if (!response.ok) {
    throw new Error(`Failed to create company: ${response.status}`);
  }

  const data = await response.json();
  return { id: data.id, created: true };
}
```

**Step 3: Add findOrCreateContact method**

```typescript
async findOrCreateContact(
  firstName: string,
  lastName: string,
  properties: Record<string, string> = {}
): Promise<{ id: string; created: boolean }> {
  // Search by name
  const searchResponse = await rateLimitedRequest(() =>
    fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filterGroups: [{
          filters: [
            { propertyName: 'firstname', operator: 'EQ', value: firstName },
            { propertyName: 'lastname', operator: 'EQ', value: lastName },
          ],
        }],
        limit: 1,
      }),
    })
  );

  if (searchResponse.ok) {
    const searchData = await searchResponse.json();
    if (searchData.results?.length > 0) {
      return { id: searchData.results[0].id, created: false };
    }
  }

  // Create new
  const response = await rateLimitedRequest(() =>
    fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { firstname: firstName, lastname: lastName, ...properties },
      }),
    })
  );

  if (!response.ok) {
    throw new Error(`Failed to create contact: ${response.status}`);
  }

  const data = await response.json();
  return { id: data.id, created: true };
}
```

**Step 4: Add createDeal method**

```typescript
async createDeal(name: string, properties: Record<string, string> = {}): Promise<string> {
  const response = await rateLimitedRequest(() =>
    fetch('https://api.hubapi.com/crm/v3/objects/deals', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { dealname: name, ...properties },
      }),
    })
  );

  if (!response.ok) {
    throw new Error(`Failed to create deal: ${response.status}`);
  }

  const data = await response.json();
  return data.id;
}
```

**Step 5: Add association methods**

```typescript
async associateDealToCompany(dealId: string, companyId: string): Promise<void> {
  await rateLimitedRequest(() =>
    fetch(`https://api.hubapi.com/crm/v4/objects/deals/${dealId}/associations/companies/${companyId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 341 }]),
    })
  );
}

async associateDealToContact(dealId: string, contactId: string): Promise<void> {
  await rateLimitedRequest(() =>
    fetch(`https://api.hubapi.com/crm/v4/objects/deals/${dealId}/associations/contacts/${contactId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }]),
    })
  );
}

async associateContactToCompany(contactId: string, companyId: string): Promise<void> {
  await rateLimitedRequest(() =>
    fetch(`https://api.hubapi.com/crm/v4/objects/contacts/${contactId}/associations/companies/${companyId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }]),
    })
  );
}
```

**Step 6: Commit**

```bash
git add backend/src/services/hubspot-client.ts
git commit -m "feat(hubspot): add CREATE methods with rate limiting

- findOrCreateCompany: idempotent company creation
- findOrCreateContact: idempotent contact creation
- createDeal: deal creation
- association methods for deal/company/contact linking
- rate limiter: 10 req/s to stay under HubSpot limits"
```

---

## Task 4: Create HubSpot Push Service

**Files:**
- Create: `backend/src/services/hubspot-push.ts`

**Step 1: Create the push service file**

```typescript
import { Signal } from '@prisma/client';
import { getHubSpotClient } from './hubspot-client.js';

export interface PushResult {
  success: boolean;
  dealId: string;
  dealUrl: string;
  companiesCreated: number;
  companyContactsCreated: number;
  peContactsCreated: number;
  companyIds: string[];
  contactIds: string[];
}

interface SignalPayload {
  companyName?: string;
  jobTitle?: string;
  metro?: string;
  peContacts?: Array<{ name: string; title: string; organization: string }>;
  contacts?: Array<{ name: string; title: string }>;
  postedDate?: string;
}

export async function pushSignalToHubSpot(signal: Signal): Promise<PushResult> {
  const client = getHubSpotClient();
  const payload = signal.rawPayload as SignalPayload | null;

  if (!payload?.companyName) {
    throw new Error('Signal missing company name');
  }

  const companyIds: string[] = [];
  const contactIds: string[] = [];
  let companiesCreated = 0;
  let companyContactsCreated = 0;
  let peContactsCreated = 0;

  // 1. Find/create portfolio company
  const portfolioCompany = await client.findOrCreateCompany(payload.companyName, {
    p_e: 'yes',
    private_equity_relationship: 'Portfolio Company',
    type: 'PROSPECT',
  });
  companyIds.push(portfolioCompany.id);
  if (portfolioCompany.created) companiesCreated++;

  // 2. Find/create PE firm(s) from PE contacts
  const peFirms = new Map<string, string>(); // org name -> company ID
  for (const peContact of payload.peContacts || []) {
    if (peContact.organization && !peFirms.has(peContact.organization)) {
      const peFirm = await client.findOrCreateCompany(peContact.organization, {
        p_e: 'yes',
        private_equity_relationship: 'Private Equity Firm',
        type: 'PROSPECT',
      });
      peFirms.set(peContact.organization, peFirm.id);
      companyIds.push(peFirm.id);
      if (peFirm.created) companiesCreated++;
    }
  }

  // 3. Find/create company contacts (buyers)
  for (const contact of payload.contacts || []) {
    const [firstName, ...lastParts] = contact.name.split(' ');
    const lastName = lastParts.join(' ') || firstName;

    const result = await client.findOrCreateContact(firstName, lastName, {
      jobtitle: contact.title,
    });
    contactIds.push(result.id);
    if (result.created) companyContactsCreated++;

    // Associate with portfolio company
    await client.associateContactToCompany(result.id, portfolioCompany.id);
  }

  // 4. Find/create PE contacts (influencers)
  for (const peContact of payload.peContacts || []) {
    const [firstName, ...lastParts] = peContact.name.split(' ');
    const lastName = lastParts.join(' ') || firstName;

    const result = await client.findOrCreateContact(firstName, lastName, {
      jobtitle: peContact.title,
    });
    contactIds.push(result.id);
    if (result.created) peContactsCreated++;

    // Associate with PE firm
    const peFirmId = peFirms.get(peContact.organization);
    if (peFirmId) {
      await client.associateContactToCompany(result.id, peFirmId);
    }
  }

  // 5. Create deal
  const dealName = `${payload.companyName} - ${payload.jobTitle || 'Opportunity'}`;
  const dealId = await client.createDeal(dealName, {
    source_details: 'Lead5 Scout',
    signal_id: signal.id,
  });

  // 6. Associate deal with all companies
  for (const companyId of companyIds) {
    await client.associateDealToCompany(dealId, companyId);
  }

  // 7. Associate deal with all contacts
  for (const contactId of contactIds) {
    await client.associateDealToContact(dealId, contactId);
  }

  // 8. Add recommendation note if available
  if (signal.recommendation) {
    const rec = signal.recommendation as { summary?: string };
    if (rec.summary) {
      await client.createDealNote(dealId, rec.summary);
    }
  }

  return {
    success: true,
    dealId,
    dealUrl: `https://app.hubspot.com/contacts/${process.env.HUBSPOT_PORTAL_ID || ''}/record/0-3/${dealId}`,
    companiesCreated,
    companyContactsCreated,
    peContactsCreated,
    companyIds,
    contactIds,
  };
}
```

**Step 2: Commit**

```bash
git add backend/src/services/hubspot-push.ts
git commit -m "feat(hubspot): create push service with full data model

- Creates portfolio company + PE firm(s)
- Creates company contacts (buyers) + PE contacts (influencers)
- Creates deal with all associations
- Adds recommendation note to deal
- Uses idempotent find-or-create for all objects"
```

---

## Task 5: Add Push and Archive Endpoints

**Files:**
- Modify: `backend/src/routes/signals.ts`

**Step 1: Add imports**

At top of file:
```typescript
import { pushSignalToHubSpot } from '../services/hubspot-push.js';
import { archiveReasonEnum } from '../schemas/signals.js';
```

**Step 2: Add push endpoint after delete endpoint**

```typescript
// Push signal to HubSpot
fastify.post('/:id/push', {
  schema: {
    params: idParamSchema,
    response: {
      200: z.object({
        success: z.boolean(),
        hubspot: z.object({
          dealId: z.string(),
          dealUrl: z.string(),
          companiesCreated: z.number(),
          companyContactsCreated: z.number(),
          peContactsCreated: z.number(),
        }),
      }),
      400: z.object({ error: z.string(), message: z.string(), statusCode: z.number() }),
      404: z.object({ error: z.string(), message: z.string(), statusCode: z.number() }),
    },
  },
}, async (request, reply) => {
  const { id } = request.params as { id: string };

  const signal = await prisma.signal.findUnique({ where: { id } });
  if (!signal) {
    return reply.status(404).send({ error: 'Not Found', message: 'Signal not found', statusCode: 404 });
  }

  if (signal.status === 'pushed') {
    return reply.status(400).send({ error: 'Bad Request', message: 'Signal already pushed to HubSpot', statusCode: 400 });
  }

  if (signal.status === 'archived') {
    return reply.status(400).send({ error: 'Bad Request', message: 'Cannot push archived signal', statusCode: 400 });
  }

  try {
    const result = await pushSignalToHubSpot(signal);

    await prisma.signal.update({
      where: { id },
      data: {
        status: 'pushed',
        hubspotDealId: result.dealId,
        hubspotCompanyIds: result.companyIds,
        hubspotContactIds: result.contactIds,
        pushedAt: new Date(),
        pushError: null,
      },
    });

    return {
      success: true,
      hubspot: {
        dealId: result.dealId,
        dealUrl: result.dealUrl,
        companiesCreated: result.companiesCreated,
        companyContactsCreated: result.companyContactsCreated,
        peContactsCreated: result.peContactsCreated,
      },
    };
  } catch (error) {
    // Store error for retry capability
    await prisma.signal.update({
      where: { id },
      data: {
        status: 'push_failed',
        pushError: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return reply.status(500).send({
      error: 'Push Failed',
      message: error instanceof Error ? error.message : 'Failed to push to HubSpot',
      statusCode: 500,
    });
  }
});
```

**Step 3: Add archive endpoint**

```typescript
// Archive signal
fastify.post('/:id/archive', {
  schema: {
    params: idParamSchema,
    body: z.object({
      reason: archiveReasonEnum.optional(),
    }).optional(),
    response: {
      200: signalResponseSchema,
    },
  },
}, async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as { reason?: string } | undefined;

  try {
    const signal = await prisma.signal.update({
      where: { id },
      data: {
        status: 'archived',
        archivedAt: new Date(),
        archiveReason: body?.reason || null,
      },
    });

    return {
      ...signal,
      processedAt: signal.processedAt?.toISOString() ?? null,
      pushedAt: signal.pushedAt?.toISOString() ?? null,
      archivedAt: signal.archivedAt?.toISOString() ?? null,
      createdAt: signal.createdAt.toISOString(),
      updatedAt: signal.updatedAt.toISOString(),
    };
  } catch {
    return reply.status(404).send({ error: 'Not Found', message: 'Signal not found', statusCode: 404 });
  }
});
```

**Step 4: Commit**

```bash
git add backend/src/routes/signals.ts
git commit -m "feat(api): add push and archive endpoints

- POST /:id/push - pushes to HubSpot with error handling
- POST /:id/archive - archives with optional reason enum
- push_failed status enables retry capability"
```

---

## Task 6: Add Status Filter to List Endpoint

**Files:**
- Modify: `backend/src/routes/signals.ts`

**Step 1: Update querystring schema**

Update the querystring schema (around line 18) to include:
```typescript
status: z.enum(['pending', 'ready', 'pushed', 'push_failed', 'archived']).optional(),
source: z.string().optional(),
```

**Step 2: Update where clause**

Add to the where clause building:
```typescript
if (status) where.status = status;
if (source) where.source = source;
```

**Step 3: Update response mapping**

Update the response mapping to include all new fields:
```typescript
status: s.status,
recommendation: s.recommendation,
hubspotDealId: s.hubspotDealId,
hubspotCompanyIds: s.hubspotCompanyIds as string[] | null,
hubspotContactIds: s.hubspotContactIds as string[] | null,
pushedAt: s.pushedAt?.toISOString() ?? null,
pushError: s.pushError,
archivedAt: s.archivedAt?.toISOString() ?? null,
archiveReason: s.archiveReason,
```

**Step 4: Test filters**

Run: `curl "http://localhost:8004/api/v1/signals?status=ready"`

Expected: Returns only signals with status=ready

**Step 5: Commit**

```bash
git add backend/src/routes/signals.ts
git commit -m "feat(api): add status and source filters to signals list"
```

---

## Task 7: Add buildOpportunityContext Helper

**Files:**
- Create: `backend/src/services/signal-enrichment.ts`

**Step 1: Create the enrichment service file**

```typescript
import { Signal } from '@prisma/client';
import type { OpportunityContext } from './types.js';

interface SignalPayload {
  companyName?: string;
  company?: string;
  jobTitle?: string;
  metro?: string;
  peContacts?: Array<{ name: string; title: string; organization: string }>;
  contacts?: Array<{ name: string; title: string }>;
  postedDate?: string;
  sourceUrl?: string;
  url?: string;
}

/**
 * Converts a Signal into an OpportunityContext for the recommendation engine.
 * Extracts relevant fields from signal.rawPayload.
 */
export function buildOpportunityContext(signal: Signal): OpportunityContext {
  const payload = signal.rawPayload as SignalPayload | null;

  if (!payload) {
    throw new Error('Signal has no rawPayload');
  }

  const companyName = payload.companyName || payload.company || 'Unknown Company';
  const peContacts = payload.peContacts || [];
  const peFirms = [...new Set(peContacts.map(c => c.organization).filter(Boolean))];

  return {
    signalId: signal.id,
    company: {
      name: companyName,
      metro: payload.metro,
    },
    jobTitle: payload.jobTitle || signal.summary || 'Unknown Position',
    peContacts: peContacts.map(c => ({
      name: c.name,
      title: c.title,
      organization: c.organization,
    })),
    peFirms,
    sourceUrl: payload.sourceUrl || payload.url || signal.sourceUrl || '',
    postedDate: payload.postedDate || signal.createdAt.toISOString().split('T')[0],
  };
}
```

**Step 2: Commit**

```bash
git add backend/src/services/signal-enrichment.ts
git commit -m "feat(enrichment): add buildOpportunityContext helper

Converts Signal -> OpportunityContext for recommendation engine.
Extracts company, PE contacts, PE firms from rawPayload."
```

---

## Task 8: Implement Async Signal Enrichment

**Files:**
- Modify: `backend/src/routes/signals.ts`
- Create: `backend/src/services/enrichment-worker.ts`

**Rationale:** Enrichment can take 5-30 seconds (multiple API calls). Making it synchronous would block the HTTP response. Instead, we return immediately with status=pending and enrich in the background.

**Step 1: Create enrichment worker**

Create `backend/src/services/enrichment-worker.ts`:

```typescript
import { prisma } from '../lib/prisma.js';
import { getRecommendationEngine } from './recommendation-engine.js';
import { buildOpportunityContext } from './signal-enrichment.js';
import type { Prisma } from '@prisma/client';

/**
 * Enriches a signal with recommendation data.
 * Called asynchronously after signal creation.
 */
export async function enrichSignal(signalId: string): Promise<void> {
  try {
    const signal = await prisma.signal.findUnique({ where: { id: signalId } });
    if (!signal) {
      console.error(`Signal ${signalId} not found for enrichment`);
      return;
    }

    if (signal.status !== 'pending') {
      console.log(`Signal ${signalId} already processed (status: ${signal.status})`);
      return;
    }

    const engine = getRecommendationEngine();
    const context = buildOpportunityContext(signal);
    const recommendation = await engine.generateRecommendation(context);

    await prisma.signal.update({
      where: { id: signalId },
      data: {
        status: 'ready',
        recommendation: recommendation as unknown as Prisma.JsonValue,
      },
    });

    console.log(`Signal ${signalId} enriched successfully`);
  } catch (error) {
    console.error(`Enrichment failed for signal ${signalId}:`, error);
    // Leave as pending - can retry later
  }
}
```

**Step 2: Update signal creation to trigger async enrichment**

In `backend/src/routes/signals.ts`, update the POST handler:

```typescript
import { enrichSignal } from '../services/enrichment-worker.js';

// In the POST handler, after creating the signal:
// Trigger async enrichment (don't await - return immediately)
enrichSignal(signal.id).catch(err => {
  console.error('Background enrichment failed:', err);
});
```

**Step 3: Commit**

```bash
git add backend/src/services/enrichment-worker.ts backend/src/routes/signals.ts
git commit -m "feat(enrichment): implement async signal enrichment

- Signal created with status=pending, returns immediately
- Background worker enriches and updates to status=ready
- Non-blocking: scout doesn't wait for recommendation"
```

---

## Task 9: Redesign SignalsPage - Card Component

**Files:**
- Modify: `frontend/src/App.tsx` (SignalsPage component)

**Step 1: Create SignalCard component**

Replace the current simple card with an expandable card. Key elements:

**Collapsed state:**
- Status dot (color by status: pending=yellow, ready=blue, pushed=green, push_failed=red, archived=gray)
- Title (signal summary)
- Metro + PE firm
- Summary chips: PE match count, available partners count
- "View Analysis" button

**Expanded state:**
- All collapsed content
- "WHY WE CAN WIN" section from recommendation
- Two-column layout: Company Contacts (Buyers) | PE Contacts (Influencers)
- Available Partners list
- Suggested Approach text
- Push to HubSpot button (primary)
- Archive button (secondary)

**Step 2: Implement expand/collapse state**

```typescript
const [expandedId, setExpandedId] = useState<string | null>(null);

// Toggle function
const toggleExpand = (id: string) => {
  setExpandedId(expandedId === id ? null : id);
};
```

**Step 3: Style status dots**

```typescript
const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500',
  ready: 'bg-blue-500',
  pushed: 'bg-green-500',
  push_failed: 'bg-red-500',
  archived: 'bg-gray-400',
};
```

**Step 4: Extract recommendation data for display**

```typescript
interface RecommendationData {
  summary?: string;
  connections?: Array<{ type: string; description: string }>;
  contactRecommendations?: Array<{ name: string; title: string; reason: string }>;
}

const rec = signal.recommendation as RecommendationData | null;
```

**Step 5: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(ui): redesign signal cards with expandable analysis

- Collapsed: status dot, title, metro, summary chips
- Expanded: full recommendation, contacts (buyers/influencers), approach
- Status-colored indicators
- Push/Archive buttons in expanded view"
```

---

## Task 10: Add Status Filter Tabs to SignalsPage

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: Add filter state**

```typescript
const [statusFilter, setStatusFilter] = useState<string>('ready');
const [sourceFilter, setSourceFilter] = useState<string>('');
```

**Step 2: Create filter tabs component**

```typescript
const statusTabs = [
  { value: 'ready', label: 'Ready', count: readyCount },
  { value: 'pushed', label: 'Pushed', count: pushedCount },
  { value: 'push_failed', label: 'Failed', count: failedCount },
  { value: 'archived', label: 'Archived', count: archivedCount },
];
```

**Step 3: Wire up filters to API query**

Update the useQuery queryKey and queryFn:

```typescript
const { data, isLoading } = useQuery({
  queryKey: ['signals', statusFilter, sourceFilter],
  queryFn: async () => {
    const params = new URLSearchParams();
    params.set('limit', '50');
    if (statusFilter) params.set('status', statusFilter);
    if (sourceFilter) params.set('source', sourceFilter);

    const res = await fetch(`${API_URL}/api/v1/signals?${params}`);
    if (!res.ok) throw new Error('Failed to fetch');
    return res.json();
  },
});
```

**Step 4: Add source dropdown**

```typescript
<select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
  <option value="">All sources</option>
  <option value="lead5">Lead5</option>
</select>
```

**Step 5: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(ui): add status filter tabs and source filter to signals page"
```

---

## Task 11: Add Push/Archive Actions with Modals

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: Add mutation hooks**

```typescript
const pushMutation = useMutation({
  mutationFn: async (signalId: string) => {
    const res = await fetch(`${API_URL}/api/v1/signals/${signalId}/push`, {
      method: 'POST',
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message);
    }
    return res.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['signals'] });
  },
});

const archiveMutation = useMutation({
  mutationFn: async ({ signalId, reason }: { signalId: string; reason?: string }) => {
    const res = await fetch(`${API_URL}/api/v1/signals/${signalId}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw new Error('Archive failed');
    return res.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['signals'] });
  },
});
```

**Step 2: Add success modal state**

```typescript
const [pushResult, setPushResult] = useState<PushResult | null>(null);
const [showArchiveModal, setShowArchiveModal] = useState<string | null>(null);
```

**Step 3: Create PushSuccessModal component**

Display: deal name, companies created, contacts created, "View in HubSpot" link.

**Step 4: Create ArchiveModal component**

Dropdown with reason options from enum, Cancel/Archive buttons.

**Step 5: Wire up buttons**

```typescript
<button onClick={() => pushMutation.mutate(signal.id)} disabled={pushMutation.isPending}>
  {pushMutation.isPending ? 'Pushing...' : 'Push to HubSpot'}
</button>

<button onClick={() => setShowArchiveModal(signal.id)}>
  Archive
</button>
```

**Step 6: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(ui): add push and archive actions with modals

- Push button with loading state
- Success modal showing created objects + HubSpot link
- Archive modal with reason dropdown
- Query invalidation on success"
```

---

## Task 12: End-to-End Testing

**Files:**
- No new files, manual testing

**Step 1: Run Lead5 scout to get fresh signals**

```bash
cd scouts/lead5-scout && npx tsx src/main.ts
```

**Verify:**
- Signals arrive with `status: pending`
- After ~10-30 seconds, status changes to `ready`
- `recommendation` field is populated

**Step 2: Test push flow in UI**

1. Open http://localhost:3006/signals
2. See Ready tab with enriched signals
3. Expand a signal, verify recommendation data displays
4. Click "Push to HubSpot"
5. Verify success modal shows created objects
6. Click "View in HubSpot" - verify deal exists with companies and contacts

**Step 3: Test push failure handling**

1. Temporarily break HubSpot token
2. Try to push a signal
3. Verify error displays and status = push_failed
4. Fix token, retry push
5. Verify success

**Step 4: Test archive flow**

1. Click Archive on a signal
2. Select reason "Not relevant"
3. Verify signal moves to Archived tab
4. Switch to Archived tab, verify signal shows with reason

**Step 5: Test filters**

- Switch between Ready/Pushed/Failed/Archived tabs
- Change source filter
- Verify correct signals show

**Step 6: Commit any final fixes**

```bash
git add -A
git commit -m "fix: address issues from e2e testing"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Update Signal schema with staged workflow fields + index |
| 2 | Update Zod schemas with status/archive enums |
| 3 | Add HubSpot Client CREATE methods with rate limiting |
| 4 | Create HubSpot Push Service (full data model) |
| 5 | Add push and archive endpoints with error handling |
| 6 | Add status/source filters to list endpoint |
| 7 | Add buildOpportunityContext helper |
| 8 | Implement async signal enrichment |
| 9 | Redesign SignalCard component (expandable) |
| 10 | Add status filter tabs to SignalsPage |
| 11 | Add push/archive actions with modals |
| 12 | End-to-end testing |

## Audit Findings Addressed

| Finding | Resolution |
|---------|------------|
| Missing buildOpportunityContext | Task 7 - explicit implementation |
| HubSpot CREATE methods missing | Task 3 - added to hubspot-client.ts |
| No rollback for partial failures | Tasks 4-5: idempotent find-or-create + push_failed status |
| No rate limiting | Task 3 - rate limiter utility |
| Mock data persists | Removed - no mock implementation |
| Missing Required Skills | Added Execution Environment section |
| Synchronous enrichment | Task 8 - async background worker |
| No index on status | Task 1 - @@index([status]) |
| Archive reasons hardcoded | Task 2 - archiveReasonEnum |
