/**
 * Backfill strategic recommendations for existing HubSpot deals
 *
 * For each Lead5 Scout deal:
 * 1. Find/create portfolio company and associate with deal
 * 2. Find/create PE firms and link as parent of portfolio company
 * 3. Find/create PE contacts and link to their PE firms
 * 4. Associate all companies and contacts with the deal
 * 5. Generate and post new recommendation note
 *
 * Run: npx tsx scripts/backfill-recommendations.ts
 */

import 'dotenv/config';
import { getRecommendationEngine } from '../backend/src/services/recommendation-engine.js';
import { getHubSpotClient } from '../backend/src/services/hubspot-client.js';
import { OpportunityContext, StrategicRecommendation } from '../backend/src/services/types.js';

const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const OUTBOUND_API_URL = process.env.OUTBOUND_API_URL || 'http://localhost:8004';
const DRY_RUN = process.env.DRY_RUN !== 'false';
const MAX_RESULTS = parseInt(process.env.MAX_RESULTS || '10', 10);

if (!HUBSPOT_ACCESS_TOKEN) {
  console.error('HUBSPOT_ACCESS_TOKEN not set');
  process.exit(1);
}

// ============================================================================
// Types
// ============================================================================

interface PEContact {
  name: string;
  title: string;
  organization: string;
  email?: string;
  linkedIn?: string;
}

interface CompanyContact {
  name: string;
  title: string;
  email?: string;
  phone?: string;
}

interface Signal {
  id: string;
  type: string;
  source: string;
  sourceId: string;
  processedAt: string | null;
  rawPayload: {
    companyName: string;
    jobTitle: string;
    metro: string;
    postedDate: string;
    description: string;
    url?: string;
    peContacts?: PEContact[];
    contacts?: CompanyContact[];  // Portfolio company contacts (CEO, CFO, HR, etc.)
  };
  summary: string;
}

interface Hypothesis {
  id: string;
  signalId: string | null;
  hubspotDealId: string | null;
  status: string;
}

interface HubSpotDeal {
  id: string;
  properties: {
    dealname: string;
    dealstage: string;
    source_details?: string;
    createdate?: string;
  };
}

interface HubSpotCompany {
  id: string;
  properties: {
    name: string;
    private_equity_relationship?: string;
  };
}

interface HubSpotContact {
  id: string;
  properties: {
    firstname: string;
    lastname: string;
    email?: string;
    pe_contact_role?: string;
  };
}

// ============================================================================
// Helpers
// ============================================================================

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mapTitleToRole(title: string): string | undefined {
  const t = title.toLowerCase();
  if (t.includes('managing partner')) return 'managing_partner';
  if (t.includes('operating partner')) return 'operating_partner';
  if (t.includes('partner')) return 'partner';
  if (t.includes('principal')) return 'principal';
  if (t.includes('managing director')) return 'managing_director';
  if (t.includes('vice president') || t.includes('vp')) return 'vice_president';
  if (t.includes('director')) return 'director';
  if (t.includes('associate')) return 'associate';
  if (t.includes('analyst')) return 'analyst';
  if (t.includes('board')) return 'board_member';
  if (t.includes('advisor')) return 'advisor';
  return undefined;
}

// ============================================================================
// HubSpot Company Operations
// ============================================================================

async function findOrCreatePortfolioCompany(companyName: string): Promise<string | null> {
  // Search for existing company
  const searchResponse = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [{
        filters: [{
          propertyName: 'name',
          operator: 'EQ',
          value: companyName,
        }],
      }],
      properties: ['name', 'private_equity_relationship'],
      limit: 1,
    }),
  });

  if (searchResponse.ok) {
    const data = await searchResponse.json();
    if (data.results && data.results.length > 0) {
      const existing = data.results[0] as HubSpotCompany;
      console.log(`      Found portfolio company: ${existing.properties.name} (${existing.id})`);

      // Update to mark as Portfolio Company with both PE fields
      if (!DRY_RUN) {
        await delay(200);
        await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${existing.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            properties: {
              p_e: 'yes',
              private_equity_relationship: 'Portfolio Company',
            },
          }),
        });
        console.log(`      Updated PE fields on portfolio company`);
      }
      return existing.id;
    }
  }

  if (DRY_RUN) {
    console.log(`      [DRY RUN] Would create portfolio company: ${companyName}`);
    return 'dry-run-company-id';
  }

  await delay(200);

  // Create new portfolio company
  const createResponse = await fetch('https://api.hubapi.com/crm/v3/objects/companies', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        name: companyName,
        p_e: 'yes',
        private_equity_relationship: 'Portfolio Company',
        type: 'PROSPECT',
      },
    }),
  });

  if (!createResponse.ok) {
    const error = await createResponse.text();
    console.error(`      Failed to create portfolio company:`, error);
    return null;
  }

  const newCompany = await createResponse.json() as HubSpotCompany;
  console.log(`      Created portfolio company: ${companyName} (${newCompany.id})`);
  return newCompany.id;
}

async function findOrCreatePEFirm(orgName: string): Promise<string | null> {
  const searchResponse = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [{
        filters: [{
          propertyName: 'name',
          operator: 'EQ',
          value: orgName,
        }],
      }],
      properties: ['name', 'private_equity_relationship', 'private_equity'],
      limit: 1,
    }),
  });

  if (searchResponse.ok) {
    const data = await searchResponse.json();
    if (data.results && data.results.length > 0) {
      const existing = data.results[0] as HubSpotCompany;
      console.log(`      Found PE firm: ${existing.properties.name} (${existing.id})`);

      // Update to ensure both PE fields are set
      if (!DRY_RUN) {
        await delay(200);
        await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${existing.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            properties: {
              p_e: 'yes',
              private_equity_relationship: 'Private Equity Firm',
            },
          }),
        });
        console.log(`      Updated PE fields on PE firm`);
      }
      return existing.id;
    }
  }

  if (DRY_RUN) {
    console.log(`      [DRY RUN] Would create PE firm: ${orgName}`);
    return 'dry-run-pe-firm-id';
  }

  await delay(200);

  const createResponse = await fetch('https://api.hubapi.com/crm/v3/objects/companies', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        name: orgName,
        p_e: 'yes',
        private_equity_relationship: 'Private Equity Firm',
        type: 'PROSPECT',
      },
    }),
  });

  if (!createResponse.ok) {
    const error = await createResponse.text();
    console.error(`      Failed to create PE firm:`, error);
    return null;
  }

  const newCompany = await createResponse.json() as HubSpotCompany;
  console.log(`      Created PE firm: ${orgName} (${newCompany.id})`);
  return newCompany.id;
}

// ============================================================================
// HubSpot Contact Operations
// ============================================================================

async function findOrCreatePEContact(
  contact: PEContact,
  peFirmId: string
): Promise<string | null> {
  const nameParts = contact.name.trim().split(/\s+/);
  const firstname = nameParts[0];
  const lastname = nameParts.slice(1).join(' ') || nameParts[0];

  // Search for existing contact
  let searchFilters: Array<{ propertyName: string; operator: string; value: string }>;

  if (contact.email) {
    searchFilters = [{
      propertyName: 'email',
      operator: 'EQ',
      value: contact.email,
    }];
  } else {
    searchFilters = [
      { propertyName: 'firstname', operator: 'EQ', value: firstname },
      { propertyName: 'lastname', operator: 'EQ', value: lastname },
    ];
  }

  const searchResponse = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [{ filters: searchFilters }],
      properties: ['firstname', 'lastname', 'email', 'pe_contact_role'],
      limit: 1,
    }),
  });

  if (searchResponse.ok) {
    const data = await searchResponse.json();
    if (data.results && data.results.length > 0) {
      const existing = data.results[0] as HubSpotContact;
      console.log(`        Found contact: ${existing.properties.firstname} ${existing.properties.lastname} (${existing.id})`);

      if (!DRY_RUN) {
        // Ensure association with PE firm
        await delay(200);
        await associateContactWithCompany(existing.id, peFirmId);
      }
      return existing.id;
    }
  }

  if (DRY_RUN) {
    console.log(`        [DRY RUN] Would create contact: ${contact.name}`);
    return 'dry-run-contact-id';
  }

  await delay(200);

  // Create new contact
  const contactProperties: Record<string, string | undefined> = {
    firstname,
    lastname,
    pe_contact_role: mapTitleToRole(contact.title),
  };

  const cleanEmail = contact.email?.replace(/play_arrow.*$/i, '').trim();
  if (cleanEmail) {
    contactProperties.email = cleanEmail;
  }

  const cleanProperties = Object.fromEntries(
    Object.entries(contactProperties).filter(([_, v]) => v !== undefined)
  );

  const createResponse = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties: cleanProperties }),
  });

  if (!createResponse.ok) {
    const error = await createResponse.text();
    console.error(`        Failed to create contact:`, error);
    return null;
  }

  const newContact = await createResponse.json() as HubSpotContact;
  console.log(`        Created contact: ${contact.name} (${newContact.id})`);

  // Associate with PE firm
  await delay(200);
  await associateContactWithCompany(newContact.id, peFirmId);

  return newContact.id;
}

async function findOrCreateCompanyContact(
  contact: CompanyContact,
  portfolioCompanyId: string
): Promise<string | null> {
  const nameParts = contact.name.trim().split(/\s+/);
  const firstname = nameParts[0];
  const lastname = nameParts.slice(1).join(' ') || nameParts[0];

  // Search for existing contact
  let searchFilters: Array<{ propertyName: string; operator: string; value: string }>;

  if (contact.email) {
    searchFilters = [{
      propertyName: 'email',
      operator: 'EQ',
      value: contact.email,
    }];
  } else {
    searchFilters = [
      { propertyName: 'firstname', operator: 'EQ', value: firstname },
      { propertyName: 'lastname', operator: 'EQ', value: lastname },
    ];
  }

  const searchResponse = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [{ filters: searchFilters }],
      properties: ['firstname', 'lastname', 'email', 'jobtitle'],
      limit: 1,
    }),
  });

  if (searchResponse.ok) {
    const data = await searchResponse.json();
    if (data.results && data.results.length > 0) {
      const existing = data.results[0] as HubSpotContact;
      console.log(`        Found company contact: ${existing.properties.firstname} ${existing.properties.lastname} (${existing.id})`);

      if (!DRY_RUN) {
        // Ensure association with portfolio company
        await delay(200);
        await associateContactWithCompany(existing.id, portfolioCompanyId);
      }
      return existing.id;
    }
  }

  if (DRY_RUN) {
    console.log(`        [DRY RUN] Would create company contact: ${contact.name}`);
    return 'dry-run-company-contact-id';
  }

  await delay(200);

  // Create new contact
  const contactProperties: Record<string, string | undefined> = {
    firstname,
    lastname,
    jobtitle: contact.title,
    contact_type: 'company_executive',
  };

  const cleanEmail = contact.email?.replace(/play_arrow.*$/i, '').trim();
  if (cleanEmail) {
    contactProperties.email = cleanEmail;
  }

  const cleanProperties = Object.fromEntries(
    Object.entries(contactProperties).filter(([_, v]) => v !== undefined)
  );

  const createResponse = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties: cleanProperties }),
  });

  if (!createResponse.ok) {
    const error = await createResponse.text();
    console.error(`        Failed to create company contact:`, error);
    return null;
  }

  const newContact = await createResponse.json() as HubSpotContact;
  console.log(`        Created company contact: ${contact.name} (${newContact.id})`);

  // Associate with portfolio company
  await delay(200);
  await associateContactWithCompany(newContact.id, portfolioCompanyId);

  return newContact.id;
}

// ============================================================================
// HubSpot Associations
// ============================================================================

async function associateContactWithCompany(contactId: string, companyId: string): Promise<void> {
  if (DRY_RUN) return;

  const response = await fetch(
    `https://api.hubapi.com/crm/v4/objects/contacts/${contactId}/associations/companies/${companyId}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        associationCategory: 'HUBSPOT_DEFINED',
        associationTypeId: 1, // Contact to Company
      }]),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error(`        Failed to associate contact with company:`, error);
  }
}

async function associatePEFirmWithPortfolio(peFirmId: string, portfolioCompanyId: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`      [DRY RUN] Would link PE firm as parent of portfolio company`);
    return;
  }

  // PE firm is parent, portfolio company is child (typeId 14 = parent company)
  const response = await fetch(
    `https://api.hubapi.com/crm/v4/objects/companies/${portfolioCompanyId}/associations/companies/${peFirmId}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        associationCategory: 'HUBSPOT_DEFINED',
        associationTypeId: 14, // Parent company
      }]),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error(`      Failed to link PE firm as parent:`, error);
  } else {
    console.log(`      Linked PE firm as parent of portfolio company`);
  }
}

async function associateDealWithCompany(dealId: string, companyId: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`      [DRY RUN] Would associate deal with company`);
    return;
  }

  const response = await fetch(
    `https://api.hubapi.com/crm/v4/objects/deals/${dealId}/associations/companies/${companyId}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        associationCategory: 'HUBSPOT_DEFINED',
        associationTypeId: 341, // Deal to Company
      }]),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error(`      Failed to associate deal with company:`, error);
  }
}

async function associateDealWithContact(dealId: string, contactId: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`        [DRY RUN] Would associate deal with contact`);
    return;
  }

  const response = await fetch(
    `https://api.hubapi.com/crm/v4/objects/deals/${dealId}/associations/contacts/${contactId}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        associationCategory: 'HUBSPOT_DEFINED',
        associationTypeId: 3, // Deal to Contact
      }]),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error(`        Failed to associate deal with contact:`, error);
  }
}

// ============================================================================
// Main Processing
// ============================================================================

async function processDealCompaniesAndContacts(
  dealId: string,
  companyName: string,
  peContacts: PEContact[],
  companyContacts: CompanyContact[] = []
): Promise<void> {
  console.log(`    🏢 Setting up companies and contacts...`);

  // 1. Find/create portfolio company and associate with deal
  const portfolioCompanyId = await findOrCreatePortfolioCompany(companyName);
  if (portfolioCompanyId && portfolioCompanyId !== 'dry-run-company-id') {
    await delay(200);
    await associateDealWithCompany(dealId, portfolioCompanyId);
    console.log(`      ✓ Deal linked to portfolio company`);
  }

  // 2. Process company contacts (executives at portfolio company: CEO, CFO, HR, etc.)
  if (companyContacts.length > 0 && portfolioCompanyId) {
    console.log(`      Processing ${companyContacts.length} company contacts...`);
    for (const contact of companyContacts) {
      try {
        const contactId = await findOrCreateCompanyContact(contact, portfolioCompanyId);
        if (contactId && contactId !== 'dry-run-company-contact-id') {
          await delay(200);
          await associateDealWithContact(dealId, contactId);
          console.log(`        ✓ Company contact linked to deal`);
        }
      } catch (error) {
        console.error(`        Error creating company contact ${contact.name}:`, error);
      }
      await delay(200);
    }
  } else if (companyContacts.length === 0) {
    console.log(`      No company contacts to process`);
  }

  // 3. Process PE contacts
  if (!peContacts || peContacts.length === 0) {
    console.log(`      No PE contacts to process`);
    return;
  }

  // 4. Group PE contacts by PE firm
  const contactsByOrg = new Map<string, PEContact[]>();
  for (const contact of peContacts) {
    const org = contact.organization || 'Unknown PE Firm';
    const existing = contactsByOrg.get(org) || [];
    existing.push(contact);
    contactsByOrg.set(org, existing);
  }

  // 3. Process each PE firm and its contacts
  for (const [orgName, contacts] of contactsByOrg) {
    console.log(`      Processing PE firm: ${orgName} (${contacts.length} contacts)`);

    // Create PE firm
    const peFirmId = await findOrCreatePEFirm(orgName);
    if (!peFirmId) continue;

    await delay(200);

    // Associate PE firm with deal
    if (peFirmId !== 'dry-run-pe-firm-id') {
      await associateDealWithCompany(dealId, peFirmId);
      console.log(`      ✓ Deal linked to PE firm`);
    }

    // Link PE firm as parent of portfolio company
    if (portfolioCompanyId && portfolioCompanyId !== 'dry-run-company-id' &&
        peFirmId !== 'dry-run-pe-firm-id') {
      await delay(200);
      await associatePEFirmWithPortfolio(peFirmId, portfolioCompanyId);
    }

    // Create contacts and associate with deal
    for (const contact of contacts) {
      try {
        const contactId = await findOrCreatePEContact(contact, peFirmId);
        if (contactId && contactId !== 'dry-run-contact-id') {
          await delay(200);
          await associateDealWithContact(dealId, contactId);
          console.log(`        ✓ Contact linked to deal`);
        }
      } catch (error) {
        console.error(`        Error creating contact ${contact.name}:`, error);
      }
      await delay(200);
    }
  }
}

async function fetchSignals(): Promise<Signal[]> {
  const response = await fetch(`${OUTBOUND_API_URL}/api/v1/signals?limit=100`);
  if (!response.ok) {
    throw new Error(`Failed to fetch signals: ${response.status}`);
  }
  const data = await response.json();
  return data.data || [];
}

async function fetchLead5Deals(): Promise<HubSpotDeal[]> {
  const response = await fetch('https://api.hubapi.com/crm/v3/objects/deals/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [{
        filters: [{
          propertyName: 'source_details',
          operator: 'EQ',
          value: 'Lead5 Scout',
        }],
      }],
      properties: ['dealname', 'dealstage', 'source_details', 'createdate'],
      limit: 100,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch deals: ${error}`);
  }

  const data = await response.json();
  return data.results || [];
}

function extractCompanyName(dealName: string): string {
  const parts = dealName.split(' - ');
  return parts[0].trim();
}

function findSignalForDeal(deal: HubSpotDeal, signals: Signal[]): Signal | null {
  const companyName = extractCompanyName(deal.properties.dealname);

  for (const signal of signals) {
    if (signal.rawPayload?.companyName?.toLowerCase() === companyName.toLowerCase()) {
      return signal;
    }
  }

  for (const signal of signals) {
    const signalCompany = signal.rawPayload?.companyName?.toLowerCase() || '';
    if (signalCompany.includes(companyName.toLowerCase()) ||
        companyName.toLowerCase().includes(signalCompany)) {
      return signal;
    }
  }

  return null;
}

async function generateAndPostRecommendation(
  signal: Signal,
  dealId: string
): Promise<StrategicRecommendation | null> {
  const { companyName, jobTitle, metro, peContacts } = signal.rawPayload;

  const context: OpportunityContext = {
    signalId: signal.id,
    company: {
      name: companyName,
      metro: metro,
    },
    jobTitle,
    peContacts: peContacts || [],
    peFirms: [...new Set(peContacts?.map(c => c.organization).filter(Boolean) || [])],
    sourceUrl: signal.rawPayload.url || '',
    postedDate: signal.rawPayload.postedDate || new Date().toISOString(),
  };

  try {
    const engine = getRecommendationEngine();
    const recommendation = await engine.generateRecommendation(context);

    console.log(`    📊 Score: ${recommendation.overallScore}/100`);
    console.log(`    🔗 Connections: ${recommendation.connections.length}`);
    console.log(`    👥 Available Partners: ${recommendation.availablePartners.length}`);

    if (DRY_RUN) {
      console.log(`    [DRY RUN] Would post note to deal ${dealId}`);
      return recommendation;
    }

    // Post as note on HubSpot deal
    if (recommendation.summary) {
      try {
        const hubspot = getHubSpotClient();
        const note = await hubspot.createDealNote(dealId, recommendation.summary);
        recommendation.hubspotDealId = dealId;
        recommendation.hubspotNoteId = note.id;
        console.log(`    📝 Posted recommendation note: ${note.id}`);
      } catch (noteError) {
        console.warn(`    ⚠️  Failed to create note:`, noteError);
      }
    }

    return recommendation;
  } catch (error) {
    console.error(`    ❌ Recommendation failed:`, error);
    return null;
  }
}

async function main() {
  console.log('=== Backfilling Deals: Companies, Contacts & Recommendations ===');
  console.log(`Outbound API: ${OUTBOUND_API_URL}`);
  console.log(`Dry Run: ${DRY_RUN}`);
  console.log(`Max Results: ${MAX_RESULTS}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  // Fetch all data
  console.log('Fetching data...');
  const [signals, deals] = await Promise.all([
    fetchSignals(),
    fetchLead5Deals(),
  ]);

  console.log(`  Signals: ${signals.length}`);
  console.log(`  Lead5 Deals: ${deals.length}\n`);

  // Process ALL deals (up to MAX_RESULTS)
  const toProcess = deals.slice(0, MAX_RESULTS);
  console.log(`Processing ${toProcess.length} deals...\n`);

  let processed = 0;
  let matched = 0;
  let companiesCreated = 0;
  let contactsCreated = 0;
  let recommendationsGenerated = 0;

  for (const deal of toProcess) {
    const companyName = extractCompanyName(deal.properties.dealname);
    console.log(`\n[${processed + 1}/${toProcess.length}] ${companyName}`);
    console.log(`  Deal: ${deal.id} - ${deal.properties.dealname}`);

    // Find matching signal
    const signal = findSignalForDeal(deal, signals);
    if (!signal) {
      console.log(`  ⚠️  No matching signal found - skipping`);
      processed++;
      continue;
    }

    matched++;
    console.log(`  ✓ Matched signal: ${signal.id}`);
    console.log(`  Company Contacts: ${signal.rawPayload.contacts?.length || 0}`);
    console.log(`  PE Contacts: ${signal.rawPayload.peContacts?.length || 0}`);

    // Process companies and contacts
    try {
      await processDealCompaniesAndContacts(
        deal.id,
        companyName,
        signal.rawPayload.peContacts || [],
        signal.rawPayload.contacts || []  // Portfolio company contacts (CEO, CFO, HR, etc.)
      );
    } catch (error) {
      console.error(`  ❌ Company/contact processing failed:`, error);
    }

    // Generate and post recommendation
    console.log(`  🎯 Generating recommendation...`);
    const recommendation = await generateAndPostRecommendation(signal, deal.id);
    if (recommendation) {
      recommendationsGenerated++;
    }

    processed++;

    // Rate limiting
    await delay(1000);
  }

  console.log('\n=== Backfill Complete ===');
  console.log(`Processed: ${processed}`);
  console.log(`Matched to signals: ${matched}`);
  console.log(`Recommendations generated: ${recommendationsGenerated}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes were made. Set DRY_RUN=false to apply.');
  }
}

main().catch(console.error);
