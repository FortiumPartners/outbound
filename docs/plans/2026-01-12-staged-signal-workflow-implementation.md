# Staged Signal Workflow - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Enable signals to be reviewed in Outbound before being pushed to HubSpot, with auto-enrichment and a quality gate workflow.

**Architecture:** Add status tracking to signals, auto-generate recommendations on arrival, provide push/archive actions that sync to HubSpot when approved.

**Tech Stack:** Fastify + Prisma (backend), React + TanStack Query (frontend), existing recommendation engine and HubSpot client.

**Design Doc:** `docs/plans/2026-01-12-staged-signal-workflow-design.md`

---

## Task 1: Update Signal Schema

**Files:**
- Modify: `backend/prisma/schema.prisma` (Signal model, lines 119-152)

**Step 1: Add new fields to Signal model**

Add these fields after line 140 (`hypothesisCount`):

```prisma
  // Staged workflow state
  status            String    @default("pending") // pending, ready, pushed, archived
  recommendation    Json?     // Stored recommendation from engine

  // HubSpot sync tracking
  hubspotDealId     String?   @map("hubspot_deal_id")
  hubspotCompanyIds Json?     @map("hubspot_company_ids")   // Array of company IDs
  hubspotContactIds Json?     @map("hubspot_contact_ids")   // Array of contact IDs
  pushedAt          DateTime? @map("pushed_at")

  // Archive tracking
  archivedAt        DateTime? @map("archived_at")
  archiveReason     String?   @map("archive_reason")
```

**Step 2: Push schema to database**

Run: `docker compose exec api npx prisma db push`

Expected: Schema updated successfully

**Step 3: Generate Prisma client**

Run: `docker compose exec api npx prisma generate`

Expected: Prisma client regenerated

**Step 4: Commit**

```bash
git add backend/prisma/schema.prisma
git commit -m "feat(schema): add staged workflow fields to Signal model"
```

---

## Task 2: Update Signal Schemas (Zod)

**Files:**
- Modify: `backend/src/schemas/signals.ts`

**Step 1: Read current schema file**

Read the file to understand current structure.

**Step 2: Add status enum and new fields to schemas**

Add status enum:
```typescript
export const signalStatusEnum = z.enum(['pending', 'ready', 'pushed', 'archived']);
```

Update `signalResponseSchema` to include new fields:
```typescript
  status: signalStatusEnum,
  recommendation: z.unknown().nullable(),
  hubspotDealId: z.string().nullable(),
  hubspotCompanyIds: z.array(z.string()).nullable(),
  hubspotContactIds: z.array(z.string()).nullable(),
  pushedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  archiveReason: z.string().nullable(),
```

**Step 3: Commit**

```bash
git add backend/src/schemas/signals.ts
git commit -m "feat(schemas): add staged workflow fields to signal schemas"
```

---

## Task 3: Add Push Endpoint

**Files:**
- Modify: `backend/src/routes/signals.ts`

**Step 1: Add push endpoint after delete endpoint (after line 176)**

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

    // TODO: Implement HubSpot push logic in Task 5
    // For now, return mock response
    const result = {
      success: true,
      hubspot: {
        dealId: 'mock-deal-id',
        dealUrl: 'https://app.hubspot.com/deals/mock',
        companiesCreated: 2,
        companyContactsCreated: 3,
        peContactsCreated: 5,
      },
    };

    await prisma.signal.update({
      where: { id },
      data: {
        status: 'pushed',
        hubspotDealId: result.hubspot.dealId,
        pushedAt: new Date(),
      },
    });

    return result;
  });
```

**Step 2: Test endpoint manually**

Run: `curl -X POST http://localhost:8004/api/v1/signals/{signal-id}/push`

Expected: Returns mock success response

**Step 3: Commit**

```bash
git add backend/src/routes/signals.ts
git commit -m "feat(api): add push signal endpoint (mock implementation)"
```

---

## Task 4: Add Archive Endpoint

**Files:**
- Modify: `backend/src/routes/signals.ts`

**Step 1: Add archive endpoint after push endpoint**

```typescript
  // Archive signal
  fastify.post('/:id/archive', {
    schema: {
      params: idParamSchema,
      body: z.object({
        reason: z.string().optional(),
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

**Step 2: Test endpoint manually**

Run: `curl -X POST http://localhost:8004/api/v1/signals/{signal-id}/archive -H "Content-Type: application/json" -d '{"reason":"Not relevant"}'`

Expected: Returns updated signal with archived status

**Step 3: Commit**

```bash
git add backend/src/routes/signals.ts
git commit -m "feat(api): add archive signal endpoint"
```

---

## Task 5: Add Status Filter to List Endpoint

**Files:**
- Modify: `backend/src/routes/signals.ts`

**Step 1: Add status and source filters to list query**

Update the querystring schema (around line 18) to include:
```typescript
status: z.enum(['pending', 'ready', 'pushed', 'archived']).optional(),
source: z.string().optional(),
```

Update the where clause to filter by status and source.

**Step 2: Update response mapping to include new fields**

Update the response mapping (around line 62) to include:
```typescript
status: s.status,
recommendation: s.recommendation,
hubspotDealId: s.hubspotDealId,
pushedAt: s.pushedAt?.toISOString() ?? null,
archivedAt: s.archivedAt?.toISOString() ?? null,
archiveReason: s.archiveReason,
```

**Step 3: Test filters**

Run: `curl "http://localhost:8004/api/v1/signals?status=ready"`

Expected: Returns only signals with status=ready

**Step 4: Commit**

```bash
git add backend/src/routes/signals.ts
git commit -m "feat(api): add status and source filters to signals list"
```

---

## Task 6: Implement HubSpot Push Service

**Files:**
- Create: `backend/src/services/hubspot-push.ts`
- Modify: `backend/src/routes/signals.ts` (replace mock with real implementation)

**Step 1: Create HubSpot push service**

Create `backend/src/services/hubspot-push.ts` with function:
```typescript
export interface PushResult {
  success: boolean;
  hubspot: {
    dealId: string;
    dealUrl: string;
    companiesCreated: number;
    companyContactsCreated: number;
    peContactsCreated: number;
    companyIds: string[];
    contactIds: string[];
  };
}

export async function pushSignalToHubSpot(signal: Signal): Promise<PushResult>
```

This function should:
1. Extract company name, PE firms, contacts from signal.rawPayload
2. Find/create portfolio company
3. Find/create PE firm(s)
4. Find/create company contacts (if present)
5. Find/create PE contacts
6. Create deal with proper associations
7. Return IDs of everything created

Use existing `hubspot-client.ts` functions as reference.

**Step 2: Wire up to push endpoint**

Update the push endpoint to call the real service instead of mock.

**Step 3: Test with real signal**

Create a test signal and push it, verify in HubSpot.

**Step 4: Commit**

```bash
git add backend/src/services/hubspot-push.ts backend/src/routes/signals.ts
git commit -m "feat(hubspot): implement real push service"
```

---

## Task 7: Auto-Enrich Signals on Creation

**Files:**
- Modify: `backend/src/routes/signals.ts` (POST / endpoint)

**Step 1: Add auto-enrichment to signal creation**

After creating the signal, call the recommendation engine and update the signal:

```typescript
// After signal creation, trigger enrichment
const enrichedSignal = await enrichSignalWithRecommendation(signal);
```

Create helper function:
```typescript
async function enrichSignalWithRecommendation(signal: Signal): Promise<Signal> {
  try {
    const engine = getRecommendationEngine();
    const context = buildOpportunityContext(signal);
    const recommendation = await engine.generateRecommendation(context);

    return prisma.signal.update({
      where: { id: signal.id },
      data: {
        status: 'ready',
        recommendation: recommendation as unknown as Prisma.JsonValue,
      },
    });
  } catch (error) {
    // If enrichment fails, leave as pending
    console.error('Enrichment failed:', error);
    return signal;
  }
}
```

**Step 2: Test by creating a new signal**

Run scout or manually POST a signal, verify it gets enriched.

**Step 3: Commit**

```bash
git add backend/src/routes/signals.ts
git commit -m "feat(api): auto-enrich signals with recommendation on creation"
```

---

## Task 8: Redesign SignalsPage - Card Component

**Files:**
- Modify: `frontend/src/App.tsx` (SignalsPage component, lines 255-324)

**Step 1: Create SignalCard component with collapsed/expanded states**

Replace the current simple card with an expandable card that shows:
- Collapsed: status dot, title, metro, PE firm, summary chips, "View Analysis" button
- Expanded: full recommendation with company contacts, PE contacts, available partners, suggested approach, push/archive buttons

**Step 2: Add expand/collapse state management**

Use React useState to track which card is expanded.

**Step 3: Style with Tailwind to match design mockups**

Follow the design from the design doc.

**Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(ui): redesign signal cards with expandable analysis"
```

---

## Task 9: Add Status Filter Tabs to SignalsPage

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: Add filter tabs above signal list**

Create tabs for Ready, Pushed, Archived with counts.

**Step 2: Add source and date filter dropdowns**

Add filter controls that update the API query.

**Step 3: Wire up filters to API query**

Update the useQuery to include status, source, date filters.

**Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(ui): add status filter tabs and filters to signals page"
```

---

## Task 10: Add Push/Archive Actions with Modals

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: Add Push button that calls POST /signals/:id/push**

Show loading state while pushing.

**Step 2: Add success modal showing what was created**

Display: deal name, companies created, contacts created, link to HubSpot.

**Step 3: Add Archive button with optional reason dropdown**

Show dropdown with reasons: Not relevant, Already have relationship, Too small, Not PE-backed, Other.

**Step 4: Handle state updates after push/archive**

Invalidate query cache to refresh list, or optimistically update.

**Step 5: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(ui): add push and archive actions with modals"
```

---

## Task 11: End-to-End Testing

**Files:**
- No new files, manual testing

**Step 1: Run Lead5 scout to get fresh signals**

```bash
cd scouts/lead5-scout && npx tsx src/main.ts
```

Verify signals arrive with status=ready and have recommendation.

**Step 2: Test push flow in UI**

Open http://localhost:3006/signals, expand a signal, click Push, verify modal shows, verify HubSpot has the deal.

**Step 3: Test archive flow in UI**

Click Archive on a signal, select reason, verify it moves to Archived tab.

**Step 4: Test filters**

Switch between Ready/Pushed/Archived tabs, verify correct signals show.

**Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "fix: address issues from e2e testing"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Update Signal schema with new fields |
| 2 | Update Zod schemas |
| 3 | Add push endpoint (mock) |
| 4 | Add archive endpoint |
| 5 | Add status/source filters to list |
| 6 | Implement real HubSpot push |
| 7 | Auto-enrich signals on creation |
| 8 | Redesign SignalCard component |
| 9 | Add filter tabs to SignalsPage |
| 10 | Add push/archive actions with modals |
| 11 | End-to-end testing |
