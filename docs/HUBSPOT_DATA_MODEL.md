# HubSpot Data Model for Lead5 Signals

## Overview

This document defines the proper HubSpot data model and integration flow for Lead5 job posting signals.

## Current State (BROKEN)

### What Lead5 Scout Extracts
| Field | Status | Example |
|-------|--------|---------|
| `companyName` | Working | "North American Partners In Anesthesia" |
| `jobTitle` | Working | "CIO Open at NAPA" |
| `metro` | Working | "New York City" |
| `peContacts[]` | Working | 5 PE firm contacts (Partners, Principals) |
| `contacts[]` | **BROKEN - null** | Should have CEO, CFO, Head of HR, etc. |

### Current Problems
1. **Missing Company Contacts** - Scout extraction code (lines 789-836) uses generic CSS selectors that don't match Lead5's DOM
2. **Incomplete Associations** - Deals only linked to PE contacts, not company executives
3. **No Path-In Strategy** - Without company contacts, we can't develop multi-contact approach strategies

## Target Data Model

### HubSpot Objects Per Lead5 Signal

```
┌─────────────────────────────────────────────────────────────────┐
│                           DEAL                                   │
│  "CIO Open at NAPA"                                              │
│  source_details: "Lead5 Scout"                                   │
│  strategic_recommendation: [note with analysis]                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ deal-to-company (typeId: 341)
                              │
        ┌─────────────────────┴─────────────────────┐
        │                                           │
        ▼                                           ▼
┌───────────────────────┐                 ┌───────────────────────┐
│  COMPANY (Portfolio)  │                 │  COMPANY (PE Firm)    │
│  "NAPA"               │                 │  "Leonard Green"      │
│  p_e: yes             │◄────────────────│  p_e: yes             │
│  pe_relationship:     │  parent (14)    │  pe_relationship:     │
│    "Portfolio Company"│                 │    "Private Equity    │
└───────────────────────┘                 │     Firm"             │
        │                                 └───────────────────────┘
        │ contact-to-company (typeId: 1)            │
        │                                           │ contact-to-company (1)
        ▼                                           ▼
┌───────────────────────┐                 ┌───────────────────────┐
│  CONTACTS (Company)   │                 │  CONTACTS (PE Firm)   │
│  • CEO                │                 │  • Partner 1          │
│  • CFO                │                 │  • Partner 2          │
│  • Head of HR         │                 │  • Principal          │
│  • CTO (departed)     │                 │  • Managing Director  │
└───────────────────────┘                 └───────────────────────┘
        │                                           │
        └───────────────┬───────────────────────────┘
                        │ deal-to-contact (typeId: 3)
                        ▼
                   ┌─────────┐
                   │  DEAL   │
                   └─────────┘
```

### Object Details

#### 1. Deal
| Property | Source | Example |
|----------|--------|---------|
| `dealname` | signal.jobTitle + company | "CIO Open at NAPA" |
| `source_details` | constant | "Lead5 Scout" |
| `dealstage` | constant | (pipeline-dependent) |
| `signal_id` | signal.id | "uuid-123" |

#### 2. Portfolio Company
| Property | Source | Example |
|----------|--------|---------|
| `name` | signal.companyName | "North American Partners In Anesthesia" |
| `p_e` | constant | "yes" |
| `private_equity_relationship` | constant | "Portfolio Company" |
| `type` | constant | "PROSPECT" |

#### 3. PE Firm(s)
| Property | Source | Example |
|----------|--------|---------|
| `name` | signal.peContacts[].organization | "Leonard Green & Partners" |
| `p_e` | constant | "yes" |
| `private_equity_relationship` | constant | "Private Equity Firm" |
| `type` | constant | "PROSPECT" |

#### 4. Company Contacts (FROM PORTFOLIO COMPANY)
| Property | Source | Example |
|----------|--------|---------|
| `firstname` | signal.contacts[].name (split) | "John" |
| `lastname` | signal.contacts[].name (split) | "Smith" |
| `jobtitle` | signal.contacts[].title | "Chief Executive Officer" |
| `email` | signal.contacts[].email (if available) | "jsmith@napa.com" |
| `contact_type` | constant | "company_executive" |

#### 5. PE Contacts (FROM PE FIRM)
| Property | Source | Example |
|----------|--------|---------|
| `firstname` | signal.peContacts[].name (split) | "Andrew" |
| `lastname` | signal.peContacts[].name (split) | "Lee" |
| `jobtitle` | signal.peContacts[].title | "Partner" |
| `pe_contact_role` | mapped from title | "partner" |
| `contact_type` | constant | "pe_investor" |

### Association Types

| From | To | Type ID | Label |
|------|-----|---------|-------|
| Contact | Company | 1 | Contact to Company (primary) |
| Deal | Company | 341 | Deal to Company |
| Deal | Contact | 3 | Deal to Contact |
| Company (child) | Company (parent) | 14 | Parent Company |

## Order of Operations

The correct sequence is critical for proper associations:

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 1: CREATE COMPANIES                                        │
│                                                                  │
│ 1. Find/Create Portfolio Company                                 │
│    - Search by name (exact match)                                │
│    - Create if not found                                         │
│    - Set p_e=yes, pe_relationship="Portfolio Company"            │
│                                                                  │
│ 2. Find/Create PE Firm(s)                                        │
│    - Search by name (exact match)                                │
│    - Create if not found                                         │
│    - Set p_e=yes, pe_relationship="Private Equity Firm"          │
│                                                                  │
│ 3. Link PE Firm as Parent of Portfolio Company                   │
│    - Association typeId: 14 (parent company)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 2: CREATE CONTACTS                                         │
│                                                                  │
│ 4. Find/Create Portfolio Company Contacts                        │
│    - Search by firstname+lastname                                │
│    - Create if not found                                         │
│    - Associate with Portfolio Company (typeId: 1)                │
│                                                                  │
│ 5. Find/Create PE Contacts                                       │
│    - Search by firstname+lastname                                │
│    - Create if not found                                         │
│    - Associate with PE Firm (typeId: 1)                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 3: CREATE DEAL                                             │
│                                                                  │
│ 6. Find/Create Deal                                              │
│    - Search by dealname (exact match)                            │
│    - Create if not found                                         │
│                                                                  │
│ 7. Associate Deal with Companies                                 │
│    - Portfolio Company (typeId: 341)                             │
│    - PE Firm(s) (typeId: 341)                                    │
│                                                                  │
│ 8. Associate Deal with Contacts                                  │
│    - ALL Portfolio Company contacts (typeId: 3)                  │
│    - ALL PE contacts (typeId: 3)                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 4: GENERATE RECOMMENDATION                                 │
│                                                                  │
│ 9. Run Recommendation Engine                                     │
│    - Find PE relationships in past deals                         │
│    - Find industry matches                                       │
│    - Find available partners                                     │
│                                                                  │
│ 10. Post Recommendation as Note on Deal                          │
│     - Full analysis with path-in strategy                        │
│     - Multiple contact approach suggestions                      │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Step 1: Fix Lead5 Scout Company Contact Extraction

The scout has `CompanyContact` interface defined but extraction at lines 789-836 is not working. Need to:

1. Analyze Lead5 DOM structure for company contacts section
2. Update CSS selectors to match actual Lead5 layout
3. Extract: name, title, email (if visible), phone (if visible)

**File:** `scouts/lead5-scout/src/main.ts`
**Function:** `extractDetailPageData()` - company contacts section

### Step 2: Update Signal Schema

Add `contacts` to signal payload properly:

```typescript
interface Signal {
  rawPayload: {
    companyName: string;
    jobTitle: string;
    metro: string;
    // Existing
    peContacts?: PEContact[];
    // NEW - Company contacts
    contacts?: CompanyContact[];  // CEO, CFO, HR, etc.
  };
}
```

### Step 3: Update Backfill Script

Add company contact processing:

1. After creating portfolio company
2. Loop through `signal.rawPayload.contacts`
3. Find/create each contact
4. Associate with portfolio company
5. Associate with deal

**File:** `scripts/backfill-recommendations.ts`
**New function:** `findOrCreateCompanyContact(contact, portfolioCompanyId)`

### Step 4: Clean Up Existing Data

1. Identify deals with broken/incomplete data
2. Delete malformed contacts
3. Re-run backfill with corrected logic

## Data Quality Checklist

For each processed signal, verify:

- [ ] Portfolio Company created/found with correct PE fields
- [ ] PE Firm(s) created/found with correct PE fields
- [ ] PE Firm linked as parent of Portfolio Company
- [ ] ALL company contacts created (CEO, CFO, HR, etc.)
- [ ] ALL PE contacts created (Partners, Principals, etc.)
- [ ] Company contacts associated with Portfolio Company
- [ ] PE contacts associated with PE Firm
- [ ] Deal associated with BOTH companies
- [ ] Deal associated with ALL contacts
- [ ] Recommendation note posted with full analysis

## API Reference

### HubSpot Association Type IDs

| Type | From → To | ID |
|------|-----------|-----|
| Contact to Company | Contact → Company | 1 |
| Deal to Contact | Deal → Contact | 3 |
| Deal to Company | Deal → Company | 341 |
| Parent Company | Child → Parent | 14 |

### HubSpot API Endpoints

| Operation | Endpoint | Method |
|-----------|----------|--------|
| Search Companies | `/crm/v3/objects/companies/search` | POST |
| Create Company | `/crm/v3/objects/companies` | POST |
| Search Contacts | `/crm/v3/objects/contacts/search` | POST |
| Create Contact | `/crm/v3/objects/contacts` | POST |
| Search Deals | `/crm/v3/objects/deals/search` | POST |
| Create Deal | `/crm/v3/objects/deals` | POST |
| Associate (v4) | `/crm/v4/objects/{from}/{fromId}/associations/{to}/{toId}` | PUT |
| Create Note | `/crm/v3/objects/notes` | POST |

## Verification Queries

### Check Deal Has Both Companies
```bash
curl -s "https://api.hubapi.com/crm/v4/objects/deals/{dealId}/associations/companies" \
  -H "Authorization: Bearer $TOKEN" | jq '.results | length'
# Should return 2 (portfolio + PE firm)
```

### Check Deal Has All Contacts
```bash
curl -s "https://api.hubapi.com/crm/v4/objects/deals/{dealId}/associations/contacts" \
  -H "Authorization: Bearer $TOKEN" | jq '.results | length'
# Should return company contacts + PE contacts
```
