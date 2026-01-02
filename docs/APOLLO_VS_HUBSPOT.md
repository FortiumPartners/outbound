# Apollo vs HubSpot: Platform Roles

> Decision: Use Apollo for outbound sequences, HubSpot for deal/pipeline management
> Last Updated: 2025-12-29

## The Decision

| Function | Platform | Rationale |
|----------|----------|-----------|
| **Outbound email sequences** | Apollo | Purpose-built for cold outreach, deliverability, sequences |
| **LinkedIn automation** | Apollo | Integrated multi-channel |
| **Contact enrichment** | Apollo | Already using, data quality |
| **Lead/Deal registration** | HubSpot | CRM of record, pipeline visibility |
| **Marketing automation** | HubSpot | Nurture, newsletters, inbound |
| **Client management** | PartnerConnect | Engagement tracking |

---

## Why Apollo for Outbound Sequences

### Apollo Strengths

1. **Deliverability infrastructure**
   - Domain warming
   - Reputation monitoring
   - Bounce handling
   - Spam score analysis

2. **Sequence capabilities**
   - Multi-step, multi-channel (email + LinkedIn)
   - Conditional branching
   - A/B testing
   - Personalization variables

3. **Data integration**
   - Contact database + enrichment
   - We already have Apollo API integrated in linkedin-workspace
   - Single source for contact data + outreach

4. **Cold outreach optimized**
   - Not marketing email (different deliverability rules)
   - Sales-focused templates
   - Meeting booking integration

### HubSpot Limitations for Cold Outreach

1. **Marketing email reputation**
   - HubSpot email designed for opted-in lists
   - Cold outreach can damage sender reputation
   - Less sophisticated deliverability for cold email

2. **Sequence limitations**
   - Less flexible than Apollo for sales sequences
   - No native LinkedIn integration
   - Better for marketing automation than sales prospecting

---

## Why HubSpot for Deal Management

### HubSpot Strengths

1. **CRM of record**
   - Pipeline visibility for leadership
   - Deal stages, forecasting
   - Activity logging

2. **Marketing integration**
   - Inbound lead capture
   - Nurture campaigns (for warm leads)
   - Website tracking

3. **Reporting**
   - Revenue attribution
   - Sales analytics
   - Custom dashboards

4. **Existing investment**
   - Already in use at Fortium
   - Team familiarity
   - Integrations in place

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           OUTBOUND FLOW                                  │
└─────────────────────────────────────────────────────────────────────────┘

                    PROSPECTING                    QUALIFICATION
                    ──────────────                 ──────────────
                          │                              │
     ┌────────────────────┼──────────────────────────────┼───────────────┐
     │                    ▼                              ▼               │
     │  ┌─────────────────────────────────────────────────────────────┐ │
     │  │                        OUTBOUND                              │ │
     │  │                                                              │ │
     │  │   Signal → Hypothesis → Approved                            │ │
     │  │                              │                               │ │
     │  └──────────────────────────────┼───────────────────────────────┘ │
     │                                 │                                 │
     │                                 ▼                                 │
     │  ┌─────────────────────────────────────────────────────────────┐ │
     │  │                        APOLLO                                │ │
     │  │                                                              │ │
     │  │   • Send via fortiumpartners.co                             │ │
     │  │   • Execute sequence (email + LinkedIn)                      │ │
     │  │   • Track opens, replies, meetings                          │ │
     │  │                              │                               │ │
     │  └──────────────────────────────┼───────────────────────────────┘ │
     │                                 │                                 │
     └─────────────────────────────────┼─────────────────────────────────┘
                                       │
                                       │ Reply / Meeting Booked
                                       ▼
     ┌─────────────────────────────────────────────────────────────────┐
     │                                                                 │
     │                         DEAL STAGE                              │
     │                         ──────────                              │
     │                              │                                  │
     │  ┌───────────────────────────┼─────────────────────────────┐   │
     │  │                           ▼                              │   │
     │  │                      HUBSPOT                             │   │
     │  │                                                          │   │
     │  │   • Create/update Contact                                │   │
     │  │   • Create Deal                                          │   │
     │  │   • Track pipeline stage                                 │   │
     │  │   • Log activities                                       │   │
     │  │                           │                              │   │
     │  └───────────────────────────┼──────────────────────────────┘   │
     │                              │                                  │
     └──────────────────────────────┼──────────────────────────────────┘
                                    │
                                    │ Deal Won
                                    ▼
     ┌─────────────────────────────────────────────────────────────────┐
     │                      PARTNERCONNECT                             │
     │                                                                 │
     │   • Create Client                                               │
     │   • Create Engagement                                           │
     │   • Assign Managing Partner                                     │
     └─────────────────────────────────────────────────────────────────┘
```

---

## Handoff Points

### Apollo → HubSpot

**Trigger:** Reply received OR meeting booked

**What transfers:**
- Contact record (if not exists)
- Company record (if not exists)
- Create Deal with stage "Qualified Lead"
- Activity: "Outbound sequence response"
- Custom properties:
  - `outbound_signal_type`
  - `outbound_hypothesis_id`
  - `outbound_sequence_name`
  - `apollo_contact_id`

### HubSpot → PartnerConnect

**Trigger:** Deal stage = "Closed Won"

**What transfers:**
- Client record
- Engagement record
- Primary contact(s)
- Deal value, scope notes

---

## Apollo Sending Setup

### Domain: fortiumpartners.co

**Why separate domain:**
- Protects primary fortiumpartners.com reputation
- Cold outreach risk isolated
- Can warm independently
- Clear separation of marketing vs sales

### Required DNS Records

```
# SPF - Allow Apollo to send
TXT  @  "v=spf1 include:_spf.apollo.io ~all"

# DKIM - Apollo will provide
CNAME  apollo._domainkey  [get from Apollo settings]

# DMARC - Monitoring mode initially
TXT  _dmarc  "v=DMARC1; p=none; rua=mailto:dmarc@fortiumpartners.co"

# Custom tracking domain (recommended)
CNAME  email-track  custom.apollo.io
```

### Warmup Strategy

1. **Week 1-2:** 10-20 emails/day, internal + known contacts
2. **Week 3-4:** 30-50 emails/day, low-risk prospects
3. **Week 5-6:** 75-100 emails/day, ramp to target volume
4. **Ongoing:** Monitor bounce rate, spam reports, deliverability

---

## HubSpot Integration Points

### Create Deal from Apollo Response

```javascript
// When Apollo reports a reply/meeting
async function createHubSpotDeal(apolloEvent, outboundData) {
  // 1. Ensure contact exists
  const contact = await hubspot.contacts.createOrUpdate({
    email: apolloEvent.contact.email,
    properties: {
      firstname: apolloEvent.contact.first_name,
      lastname: apolloEvent.contact.last_name,
      jobtitle: apolloEvent.contact.title,
      apollo_contact_id: apolloEvent.contact.id,
      outbound_source: 'true'
    }
  });

  // 2. Ensure company exists
  const company = await hubspot.companies.createOrUpdate({
    domain: apolloEvent.contact.company_domain,
    properties: {
      name: apolloEvent.contact.company,
      apollo_company_id: apolloEvent.contact.company_id
    }
  });

  // 3. Create deal
  const deal = await hubspot.deals.create({
    properties: {
      dealname: `${apolloEvent.contact.company} - Outbound`,
      dealstage: 'qualifiedlead',
      pipeline: 'default',
      outbound_signal_type: outboundData.signalType,
      outbound_hypothesis_id: outboundData.hypothesisId,
      outbound_sequence: apolloEvent.sequence_name
    },
    associations: [
      { to: contact.id, type: 'deal_to_contact' },
      { to: company.id, type: 'deal_to_company' }
    ]
  });

  return deal;
}
```

---

## Summary

| Stage | Platform | Reason |
|-------|----------|--------|
| Prospecting | Outbound + Apollo | Signal-driven, cold outreach optimized |
| Qualification | HubSpot | CRM, pipeline tracking |
| Deal Management | HubSpot | Forecasting, reporting |
| Client Onboarding | PartnerConnect | Engagement management |

**Apollo has everything we need for pre-deal outbound.** We register in HubSpot when we have a qualified opportunity (reply, meeting).
