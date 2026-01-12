/**
 * HubSpot Push Service
 *
 * Pushes enriched signals to HubSpot by creating:
 * - Portfolio company (target company hiring)
 * - PE firm(s) (investors from signal)
 * - Company contacts (buyers at target company)
 * - PE contacts (influencers at PE firms)
 * - Deal with all associations
 * - Recommendation note on deal
 *
 * Uses idempotent find-or-create for all objects to prevent duplicates.
 */

import { Signal } from '@prisma/client';
import { getHubSpotClient } from './hubspot-client.js';

// ============================================================================
// Types
// ============================================================================

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

interface SignalContact {
  name: string;
  title: string;
}

interface SignalPEContact {
  name: string;
  title: string;
  organization: string;
}

interface SignalPayload {
  companyName?: string;
  company?: string;
  jobTitle?: string;
  metro?: string;
  peContacts?: SignalPEContact[];
  contacts?: SignalContact[];
  postedDate?: string;
  sourceUrl?: string;
  url?: string;
}

interface RecommendationData {
  summary?: string;
  connections?: Array<{ type: string; description: string }>;
  contactRecommendations?: Array<{ name: string; title: string; reason: string }>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Safely splits a full name into first and last name parts.
 * Handles single names, multiple middle names, and edge cases.
 */
function splitName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return { firstName: 'Unknown', lastName: 'Unknown' };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    // Single name: use as both first and last
    return { firstName: parts[0], lastName: parts[0] };
  }

  // Multiple parts: first word is firstName, rest is lastName
  const [firstName, ...lastParts] = parts;
  return { firstName, lastName: lastParts.join(' ') };
}

/**
 * Constructs the HubSpot deal URL.
 * Requires HUBSPOT_PORTAL_ID environment variable.
 */
function buildDealUrl(dealId: string): string {
  const portalId = process.env.HUBSPOT_PORTAL_ID || '';
  if (!portalId) {
    // Return a generic URL format if portal ID is not configured
    return `https://app.hubspot.com/contacts/PORTAL_ID/record/0-3/${dealId}`;
  }
  return `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}`;
}

// ============================================================================
// Main Push Function
// ============================================================================

/**
 * Pushes a signal to HubSpot, creating all necessary CRM objects.
 *
 * Creates:
 * 1. Portfolio company (the target company that's hiring)
 * 2. PE firm(s) (from PE contacts' organizations)
 * 3. Company contacts (buyers) associated with portfolio company
 * 4. PE contacts (influencers) associated with their PE firms
 * 5. Deal associated with all companies and contacts
 * 6. Note on deal with recommendation summary
 *
 * All objects use find-or-create for idempotency.
 *
 * @param signal - The Signal record from database
 * @returns PushResult with created object counts and IDs
 * @throws Error if signal is missing required data or HubSpot API fails
 */
export async function pushSignalToHubSpot(signal: Signal): Promise<PushResult> {
  const client = getHubSpotClient();
  const payload = signal.rawPayload as SignalPayload | null;

  // Validate required fields
  const companyName = payload?.companyName || payload?.company;
  if (!companyName) {
    throw new Error('Signal missing company name in rawPayload');
  }

  // Track created objects
  const companyIds: string[] = [];
  const contactIds: string[] = [];
  let companiesCreated = 0;
  let companyContactsCreated = 0;
  let peContactsCreated = 0;

  // -------------------------------------------------------------------------
  // 1. Find/create portfolio company (the target company)
  // -------------------------------------------------------------------------
  const portfolioCompany = await client.findOrCreateCompany(companyName, {
    p_e: 'yes',
    private_equity_relationship: 'Portfolio Company',
    type: 'PROSPECT',
  });
  companyIds.push(portfolioCompany.id);
  if (portfolioCompany.created) companiesCreated++;

  // -------------------------------------------------------------------------
  // 2. Find/create PE firm(s) from PE contacts
  // -------------------------------------------------------------------------
  const peFirms = new Map<string, string>(); // org name -> company ID

  for (const peContact of payload?.peContacts || []) {
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

  // -------------------------------------------------------------------------
  // 3. Find/create company contacts (buyers at target company)
  // -------------------------------------------------------------------------
  for (const contact of payload?.contacts || []) {
    const { firstName, lastName } = splitName(contact.name);

    const result = await client.findOrCreateContact(firstName, lastName, {
      jobtitle: contact.title || '',
    });
    contactIds.push(result.id);
    if (result.created) companyContactsCreated++;

    // Associate contact with portfolio company
    await client.associateContactToCompany(result.id, portfolioCompany.id);
  }

  // -------------------------------------------------------------------------
  // 4. Find/create PE contacts (influencers at PE firms)
  // -------------------------------------------------------------------------
  for (const peContact of payload?.peContacts || []) {
    const { firstName, lastName } = splitName(peContact.name);

    const result = await client.findOrCreateContact(firstName, lastName, {
      jobtitle: peContact.title || '',
    });
    contactIds.push(result.id);
    if (result.created) peContactsCreated++;

    // Associate contact with their PE firm
    const peFirmId = peFirms.get(peContact.organization);
    if (peFirmId) {
      await client.associateContactToCompany(result.id, peFirmId);
    }
  }

  // -------------------------------------------------------------------------
  // 5. Create deal
  // -------------------------------------------------------------------------
  const jobTitle = payload?.jobTitle || signal.summary || 'Opportunity';
  const dealName = `${companyName} - ${jobTitle}`;

  const dealId = await client.createDeal(dealName, {
    source_details: 'Lead5 Scout',
    signal_id: signal.id,
    dealstage: 'appointmentscheduled', // Default to first stage
  });

  // -------------------------------------------------------------------------
  // 6. Associate deal with all companies
  // -------------------------------------------------------------------------
  for (const companyId of companyIds) {
    await client.associateDealToCompany(dealId, companyId);
  }

  // -------------------------------------------------------------------------
  // 7. Associate deal with all contacts
  // -------------------------------------------------------------------------
  for (const contactId of contactIds) {
    await client.associateDealToContact(dealId, contactId);
  }

  // -------------------------------------------------------------------------
  // 8. Add recommendation note if available
  // -------------------------------------------------------------------------
  if (signal.recommendation) {
    const rec = signal.recommendation as RecommendationData;
    if (rec.summary) {
      const noteContent = buildNoteContent(rec, signal);
      await client.createDealNote(dealId, noteContent);
    }
  }

  return {
    success: true,
    dealId,
    dealUrl: buildDealUrl(dealId),
    companiesCreated,
    companyContactsCreated,
    peContactsCreated,
    companyIds,
    contactIds,
  };
}

/**
 * Builds formatted note content from recommendation data.
 */
function buildNoteContent(rec: RecommendationData, signal: Signal): string {
  const payload = signal.rawPayload as SignalPayload | null;
  const lines: string[] = [];

  // Header
  lines.push('=== SIGNAL ANALYSIS ===');
  lines.push('');

  // Summary
  if (rec.summary) {
    lines.push('STRATEGIC RECOMMENDATION:');
    lines.push(rec.summary);
    lines.push('');
  }

  // Connections
  if (rec.connections && rec.connections.length > 0) {
    lines.push('WHY WE CAN WIN:');
    for (const conn of rec.connections) {
      lines.push(`- ${conn.type}: ${conn.description}`);
    }
    lines.push('');
  }

  // Contact recommendations
  if (rec.contactRecommendations && rec.contactRecommendations.length > 0) {
    lines.push('CONTACT APPROACH:');
    for (const contact of rec.contactRecommendations) {
      lines.push(`- ${contact.name} (${contact.title}): ${contact.reason}`);
    }
    lines.push('');
  }

  // Source
  const sourceUrl = payload?.sourceUrl || payload?.url || signal.sourceUrl;
  if (sourceUrl) {
    lines.push(`SOURCE: ${sourceUrl}`);
  }

  // Metadata
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Signal ID: ${signal.id}`);

  return lines.join('\n');
}
