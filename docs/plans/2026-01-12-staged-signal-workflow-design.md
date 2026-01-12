# Staged Signal Workflow Design

> Signals accumulate in Outbound for review before being pushed to HubSpot
> Date: 2026-01-12

## Problem

Currently, signals from scouts go directly to HubSpot, creating clutter before anyone can review them. This results in:
- Low-quality signals polluting the CRM
- No opportunity to enrich or research before entry
- No quality gate for what becomes an "official" opportunity

## Solution

A staged workflow where signals are enriched and reviewed in Outbound before being selectively pushed to HubSpot.

```
Scout → Outbound API → Auto-enrich → Review Queue → Push/Archive
```

## Design Decisions

| Question | Decision |
|----------|----------|
| Primary goal | **Quality gate** - filter out low-value signals |
| Rejected signals | **Archive** - hidden but not deleted |
| Review data needed | **Full context** - PE match, partner availability, similar deals |
| Enrichment timing | **Immediately on arrival** - auto-generate recommendation |
| Actions available | **Push/Archive only** (expand later) |
| HubSpot objects created | **Full model** - deal + companies + contacts, with deduplication |
| Sync tracking | **Track IDs only** - store what was created |
| Recommendation display | **Expandable detail** - click to reveal analysis |
| Page layout | **Single list** - most recent first |
| Filters | **Status + source + date** |
| Push feedback | **Summary modal** - show what was created with HubSpot link |
| Archive reason | **Optional dropdown** |

## Signal States

| State | Meaning |
|-------|---------|
| `pending` | Just arrived, enrichment in progress |
| `ready` | Enriched with recommendation, awaiting review |
| `pushed` | Approved and synced to HubSpot |
| `archived` | Dismissed, hidden from main view |

### State Transitions

```
Scout creates signal → pending
Enrichment completes → ready
User clicks "Push to HubSpot" → pushed
User clicks "Archive" → archived
```

## Database Schema Changes

Add to Signal model:

```prisma
model Signal {
  // ... existing fields ...

  // New fields for staged workflow
  status            String    @default("pending")  // pending, ready, pushed, archived
  recommendation    Json?     // stored recommendation from engine

  // HubSpot sync tracking
  hubspotDealId     String?
  hubspotCompanyIds Json?     // array of company IDs created/linked
  hubspotContactIds Json?     // array of contact IDs created/linked
  pushedAt          DateTime?

  // Archive tracking
  archivedAt        DateTime?
  archiveReason     String?   // optional reason for archiving
}
```

## UI Design

### Signal Card (Collapsed)

```
┌─────────────────────────────────────────────────────────────────────┐
│  ● ready                                                    Jan 11  │
│                                                                     │
│  CIO Open at North American Partners In Anesthesia                  │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                  │
│  📍 New York City  •  Leonard Green & Partners                      │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  ⚡ PE MATCH: 2 closed deals with Leonard Green              │   │
│  │  👤 PARTNERS: 3 CIOs available                               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│                           [View Analysis ▼]                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Signal Card (Expanded)

```
┌─────────────────────────────────────────────────────────────────────┐
│  ● ready                                                    Jan 11  │
│                                                                     │
│  CIO Open at North American Partners In Anesthesia                  │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                  │
│  📍 New York City  •  Healthcare  •  PE-backed (Leonard Green)      │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  WHY WE CAN WIN                                                     │
│  • PE relationship: Placed CFO at Leonard Green portfolio co        │
│  • Industry match: U.S. Anesthesia Partners CIO (Julian Sparkes)    │
│                                                                     │
│  ═══════════════════════════════════════════════════════════════    │
│                                                                     │
│  COMPANY CONTACTS (Buyers)          PE CONTACTS (Influencers)       │
│  ─────────────────────────          ─────────────────────────       │
│  Steve Kraus · CFO                  Andrew Lee · Partner            │
│  JoAnna Nicholson · CLO             John Baumer · Senior Partner    │
│  Kristine Meade · CHRO              Alyse Wagner · Partner          │
│                                     + 2 more                        │
│                                                                     │
│  ═══════════════════════════════════════════════════════════════    │
│                                                                     │
│  AVAILABLE PARTNERS                                                 │
│  Brad Wheeler (CIO) · 40% available · healthcare experience         │
│  Maria Santos (CIO) · 60% available · worked with LGP before        │
│                                                                     │
│  SUGGESTED APPROACH                                                 │
│  Direct: Reach CFO (Steve Kraus) - peer conversation about CIO gap  │
│  PE path: Brad Wheeler → Andrew Lee → internal referral             │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐                        │
│  │   ✓ Push to HS   │  │    ✗ Archive     │                        │
│  └──────────────────┘  └──────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Signals Page Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  SIGNALS                                                            │
│                                                                     │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    [Ready ▼]      │
│  │ Ready (12)  │ │ Pushed (45) │ │ Archived (8)│    [Lead5  ▼]     │
│  └─────────────┘ └─────────────┘ └─────────────┘    [All dates ▼]  │
│     ↑ active                                                        │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  [Signal Card 1 - collapsed]                                        │
│  [Signal Card 2 - expanded with analysis]                           │
│  [Signal Card 3 - collapsed]                                        │
│  ...                                                                │
└─────────────────────────────────────────────────────────────────────┘
```

### Push Success Modal

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  ✓ Pushed to HubSpot                               │
│                                                     │
│  Created:                                           │
│  • 1 Deal: "CIO Open at NAPA"                      │
│  • 2 Companies: NAPA, Leonard Green & Partners     │
│  • 3 Company contacts (buyers)                     │
│  • 5 PE contacts (influencers)                     │
│                                                     │
│  [View in HubSpot ↗]          [Done]               │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Archive Dropdown

```
┌─────────────────────────────────────┐
│  Archive this signal?               │
│                                     │
│  Reason (optional):                 │
│  ┌───────────────────────────────┐  │
│  │ Select reason...           ▼ │  │
│  ├───────────────────────────────┤  │
│  │ Not relevant to our practice │  │
│  │ Already have relationship    │  │
│  │ Company too small            │  │
│  │ Not PE-backed                │  │
│  │ Other                        │  │
│  └───────────────────────────────┘  │
│                                     │
│  [Cancel]              [Archive]    │
└─────────────────────────────────────┘
```

## API Changes

### New Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /api/v1/signals/:id/push` | POST | Push signal to HubSpot |
| `POST /api/v1/signals/:id/archive` | POST | Archive signal with optional reason |

### Push Response

```json
{
  "success": true,
  "hubspot": {
    "dealId": "123456",
    "dealUrl": "https://app.hubspot.com/deals/...",
    "companiesCreated": 2,
    "companyContactsCreated": 3,
    "peContactsCreated": 5
  }
}
```

## Implementation Order

1. **Database**: Add new fields to Signal model
2. **Backend**:
   - Update signal ingestion to set status=pending
   - Add auto-enrichment on signal creation (call recommendation engine)
   - Add push endpoint (uses existing HubSpot integration)
   - Add archive endpoint
3. **Frontend**:
   - Redesign SignalsPage with new card layout
   - Add expandable analysis panel
   - Add status filter tabs
   - Add push/archive actions with modals

## Future Enhancements (Not in Scope)

- Edit signal data before pushing
- Add/remove contacts manually
- Assign signals to team members
- Auto-push rules by source or criteria
- Bidirectional HubSpot sync
