/**
 * HubSpot Client Service
 *
 * Provides methods for querying HubSpot CRM data:
 * - Deals (closed-won history, PE relationships)
 * - Companies (PE firms, portfolio companies)
 * - Contacts (decision-makers)
 * - Associations (relationships between objects)
 *
 * Also provides CREATE methods for syncing signals to HubSpot:
 * - findOrCreateCompany: idempotent company creation
 * - findOrCreateContact: idempotent contact creation
 * - createDeal: deal creation
 * - association methods for linking objects
 */

import { HubSpotDeal, HubSpotCompany, HubSpotContact, HubSpotAssociation, SimilarDeal } from './types.js';

const HUBSPOT_API_BASE = 'https://api.hubapi.com';

// ============================================================================
// Rate Limiting
// ============================================================================

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

interface HubSpotSearchResponse<T> {
  total: number;
  results: T[];
  paging?: {
    next?: {
      after: string;
    };
  };
}

// v3 API response
interface HubSpotAssociationsResponseV3 {
  results: Array<{
    id: string;
    type: string;
  }>;
}

// v4 API response (used by getDealContacts, getDealCompanies)
interface HubSpotAssociationsResponseV4 {
  results: Array<{
    toObjectId: number;
    associationTypes: Array<{
      category: string;
      typeId: number;
      label: string | null;
    }>;
  }>;
}

export class HubSpotClient {
  private accessToken: string;

  constructor(accessToken?: string) {
    this.accessToken = accessToken || process.env.HUBSPOT_ACCESS_TOKEN || '';
    if (!this.accessToken) {
      throw new Error('HUBSPOT_ACCESS_TOKEN is required');
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${HUBSPOT_API_BASE}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HubSpot API error ${response.status}: ${error}`);
    }

    return response.json();
  }

  // ============================================================================
  // Deal Operations
  // ============================================================================

  /**
   * Search for closed-won deals, optionally filtered by company name or practice
   */
  async searchClosedWonDeals(filters?: {
    companyName?: string;
    practice?: string;
    limit?: number;
  }): Promise<HubSpotDeal[]> {
    const filterGroups: any[] = [
      {
        filters: [
          { propertyName: 'dealstage', operator: 'EQ', value: 'closedwon' }
        ]
      }
    ];

    // Add optional filters
    if (filters?.companyName) {
      filterGroups[0].filters.push({
        propertyName: 'dealname',
        operator: 'CONTAINS_TOKEN',
        value: filters.companyName
      });
    }

    if (filters?.practice) {
      filterGroups[0].filters.push({
        propertyName: 'practice',
        operator: 'EQ',
        value: filters.practice
      });
    }

    const response = await this.request<HubSpotSearchResponse<HubSpotDeal>>(
      '/crm/v3/objects/deals/search',
      {
        method: 'POST',
        body: JSON.stringify({
          filterGroups,
          properties: ['dealname', 'dealstage', 'practice', 'amount', 'closedate', 'hubspot_owner_id'],
          limit: filters?.limit || 100,
        }),
      }
    );

    return response.results;
  }

  /**
   * Get a specific deal by ID
   */
  async getDeal(dealId: string): Promise<HubSpotDeal> {
    return this.request<HubSpotDeal>(
      `/crm/v3/objects/deals/${dealId}?properties=dealname,dealstage,practice,amount,closedate,hubspot_owner_id`
    );
  }

  /**
   * Search for similar closed-won deals by practice area.
   * Returns deals with associated company information for framing qualifications.
   */
  async searchSimilarDeals(params: {
    practice: string;
    monthsBack?: number;
  }): Promise<SimilarDeal[]> {
    const monthsBack = params.monthsBack ?? 12;
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack);
    const cutoffTimestamp = cutoffDate.getTime();

    // Build filter groups - closedwon + closedate within range
    // Note: HubSpot filters within a group are AND'd together
    const filters: any[] = [
      { propertyName: 'dealstage', operator: 'EQ', value: 'closedwon' },
      { propertyName: 'closedate', operator: 'GTE', value: cutoffTimestamp.toString() },
    ];

    // Add practice filter if the field exists and has a value
    // We'll filter in memory if the API doesn't support the field
    const filterWithPractice = [
      ...filters,
      { propertyName: 'practice', operator: 'EQ', value: params.practice },
    ];

    let response: HubSpotSearchResponse<HubSpotDeal>;

    try {
      // First try with practice filter
      response = await this.request<HubSpotSearchResponse<HubSpotDeal>>(
        '/crm/v3/objects/deals/search',
        {
          method: 'POST',
          body: JSON.stringify({
            filterGroups: [{ filters: filterWithPractice }],
            properties: ['dealname', 'dealstage', 'practice', 'closedate', 'amount'],
            sorts: [{ propertyName: 'closedate', direction: 'DESCENDING' }],
            limit: 50,
          }),
        }
      );
    } catch (error) {
      // If practice field doesn't exist, search without it and filter in memory
      response = await this.request<HubSpotSearchResponse<HubSpotDeal>>(
        '/crm/v3/objects/deals/search',
        {
          method: 'POST',
          body: JSON.stringify({
            filterGroups: [{ filters }],
            properties: ['dealname', 'dealstage', 'practice', 'closedate', 'amount'],
            sorts: [{ propertyName: 'closedate', direction: 'DESCENDING' }],
            limit: 100,
          }),
        }
      );
    }

    // Filter by practice in memory if needed (case-insensitive partial match)
    const practiceUpper = params.practice.toUpperCase();
    const filteredDeals = response.results.filter(deal => {
      const dealPractice = deal.properties.practice?.toUpperCase() || '';
      return dealPractice.includes(practiceUpper) || practiceUpper.includes(dealPractice);
    });

    // Fetch associated company names for each deal
    const similarDeals: SimilarDeal[] = [];

    for (const deal of filteredDeals.slice(0, 20)) {
      try {
        const companyAssociations = await this.getDealCompanies(deal.id);
        let companyName = 'Unknown Company';
        let peFirm: string | undefined;

        // Fetch company details for each association
        for (const assoc of companyAssociations.slice(0, 3)) {
          try {
            const company = await this.getCompany(assoc.id);
            if (company.properties.private_equity_relationship === 'Private Equity Firm') {
              peFirm = company.properties.name;
            } else if (companyName === 'Unknown Company') {
              companyName = company.properties.name;
            }
          } catch {
            // Skip companies we can't fetch
          }
        }

        similarDeals.push({
          dealId: deal.id,
          dealName: deal.properties.dealname,
          companyName,
          practice: deal.properties.practice || params.practice,
          closeDate: deal.properties.closedate || '',
          peFirm,
        });
      } catch {
        // Skip deals with association errors
        similarDeals.push({
          dealId: deal.id,
          dealName: deal.properties.dealname,
          companyName: 'Unknown Company',
          practice: deal.properties.practice || params.practice,
          closeDate: deal.properties.closedate || '',
        });
      }
    }

    return similarDeals;
  }

  /**
   * Search for closed-won deals by keyword in deal name.
   * Also returns contacts associated with each deal.
   * Useful for finding industry-related past work (e.g., "anesthesia").
   */
  async searchDealsByKeyword(keyword: string): Promise<Array<SimilarDeal & { contacts: Array<{ name: string; title?: string }> }>> {
    const response = await this.request<HubSpotSearchResponse<HubSpotDeal>>(
      '/crm/v3/objects/deals/search',
      {
        method: 'POST',
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                { propertyName: 'dealstage', operator: 'EQ', value: 'closedwon' },
                { propertyName: 'dealname', operator: 'CONTAINS_TOKEN', value: keyword },
              ],
            },
          ],
          properties: ['dealname', 'dealstage', 'practice', 'closedate', 'amount'],
          sorts: [{ propertyName: 'closedate', direction: 'DESCENDING' }],
          limit: 10,
        }),
      }
    );

    const results: Array<SimilarDeal & { contacts: Array<{ name: string; title?: string }> }> = [];

    for (const deal of response.results.slice(0, 5)) {
      try {
        // Get contacts associated with this deal
        const contactAssociations = await this.getDealContacts(deal.id);
        const contacts: Array<{ name: string; title?: string }> = [];

        for (const assoc of contactAssociations.slice(0, 5)) {
          try {
            const contact = await this.getContact(assoc.id);
            const name = [contact.properties.firstname, contact.properties.lastname].filter(Boolean).join(' ');
            contacts.push({
              name: name || 'Unknown',
              title: contact.properties.jobtitle,
            });
          } catch {
            // Skip contacts we can't fetch
          }
        }

        // Get company info
        const companyAssociations = await this.getDealCompanies(deal.id);
        let companyName = 'Unknown Company';
        let peFirm: string | undefined;

        for (const assoc of companyAssociations.slice(0, 3)) {
          try {
            const company = await this.getCompany(assoc.id);
            if (company.properties.private_equity_relationship === 'Private Equity Firm') {
              peFirm = company.properties.name;
            } else if (companyName === 'Unknown Company') {
              companyName = company.properties.name;
            }
          } catch {
            // Skip companies we can't fetch
          }
        }

        results.push({
          dealId: deal.id,
          dealName: deal.properties.dealname,
          companyName,
          practice: deal.properties.practice || '',
          closeDate: deal.properties.closedate || '',
          peFirm,
          contacts,
        });
      } catch {
        // Skip deals with errors
      }
    }

    return results;
  }

  // ============================================================================
  // Company Operations
  // ============================================================================

  /**
   * Search for PE firms in HubSpot
   */
  async searchPEFirms(limit?: number): Promise<HubSpotCompany[]> {
    const response = await this.request<HubSpotSearchResponse<HubSpotCompany>>(
      '/crm/v3/objects/companies/search',
      {
        method: 'POST',
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'private_equity_relationship',
                  operator: 'EQ',
                  value: 'Private Equity Firm'
                }
              ]
            }
          ],
          properties: ['name', 'private_equity_relationship', 'domain', 'industry'],
          limit: limit || 200,
        }),
      }
    );

    return response.results;
  }

  /**
   * Search for companies by name
   */
  async searchCompanies(name: string, limit?: number): Promise<HubSpotCompany[]> {
    const response = await this.request<HubSpotSearchResponse<HubSpotCompany>>(
      '/crm/v3/objects/companies/search',
      {
        method: 'POST',
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'name',
                  operator: 'CONTAINS_TOKEN',
                  value: name
                }
              ]
            }
          ],
          properties: ['name', 'private_equity_relationship', 'domain', 'industry'],
          limit: limit || 50,
        }),
      }
    );

    return response.results;
  }

  /**
   * Get a specific company by ID
   */
  async getCompany(companyId: string): Promise<HubSpotCompany> {
    return this.request<HubSpotCompany>(
      `/crm/v3/objects/companies/${companyId}?properties=name,private_equity_relationship,domain,industry`
    );
  }

  // ============================================================================
  // Contact Operations
  // ============================================================================

  /**
   * Search for contacts with PE roles
   */
  async searchPEContacts(peFirmName?: string, limit?: number): Promise<HubSpotContact[]> {
    const filters: any[] = [
      {
        propertyName: 'pe_contact_role',
        operator: 'HAS_PROPERTY'
      }
    ];

    // If PE firm name provided, search for it in company association
    // Note: This is a simplified search - may need to use associations for accuracy

    const response = await this.request<HubSpotSearchResponse<HubSpotContact>>(
      '/crm/v3/objects/contacts/search',
      {
        method: 'POST',
        body: JSON.stringify({
          filterGroups: [{ filters }],
          properties: ['firstname', 'lastname', 'email', 'jobtitle', 'pe_contact_role'],
          limit: limit || 100,
        }),
      }
    );

    return response.results;
  }

  /**
   * Get a specific contact by ID
   */
  async getContact(contactId: string): Promise<HubSpotContact> {
    return this.request<HubSpotContact>(
      `/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,email,jobtitle,pe_contact_role`
    );
  }

  // ============================================================================
  // Association Operations
  // ============================================================================

  /**
   * Get deals associated with a company
   */
  async getCompanyDeals(companyId: string): Promise<HubSpotAssociation[]> {
    const response = await this.request<HubSpotAssociationsResponseV4>(
      `/crm/v4/objects/companies/${companyId}/associations/deals`
    );
    // Map v4 response (toObjectId) to HubSpotAssociation format (id)
    return response.results.map(r => ({
      id: String(r.toObjectId),
      type: r.associationTypes[0]?.category || 'unknown',
    }));
  }

  /**
   * Get contacts associated with a company
   */
  async getCompanyContacts(companyId: string): Promise<HubSpotAssociation[]> {
    const response = await this.request<HubSpotAssociationsResponseV4>(
      `/crm/v4/objects/companies/${companyId}/associations/contacts`
    );
    // Map v4 response (toObjectId) to HubSpotAssociation format (id)
    return response.results.map(r => ({
      id: String(r.toObjectId),
      type: r.associationTypes[0]?.category || 'unknown',
    }));
  }

  /**
   * Get full contact details for all contacts associated with a company
   */
  async getCompanyContactDetails(companyId: string): Promise<HubSpotContact[]> {
    const associations = await this.getCompanyContacts(companyId);
    const contacts: HubSpotContact[] = [];

    for (const assoc of associations.slice(0, 10)) { // Limit to 10 contacts
      try {
        const contact = await this.getContact(assoc.id);
        contacts.push(contact);
      } catch {
        // Skip contacts we can't fetch
      }
    }

    return contacts;
  }

  /**
   * Get companies associated with a deal
   */
  async getDealCompanies(dealId: string): Promise<HubSpotAssociation[]> {
    const response = await this.request<HubSpotAssociationsResponseV4>(
      `/crm/v4/objects/deals/${dealId}/associations/companies`
    );
    // Map v4 response (toObjectId) to HubSpotAssociation format (id)
    return response.results.map(r => ({
      id: String(r.toObjectId),
      type: r.associationTypes[0]?.category || 'unknown',
    }));
  }

  /**
   * Get contacts associated with a deal
   */
  async getDealContacts(dealId: string): Promise<HubSpotAssociation[]> {
    const response = await this.request<HubSpotAssociationsResponseV4>(
      `/crm/v4/objects/deals/${dealId}/associations/contacts`
    );
    // Map v4 response (toObjectId) to HubSpotAssociation format (id)
    return response.results.map(r => ({
      id: String(r.toObjectId),
      type: r.associationTypes[0]?.category || 'unknown',
    }));
  }

  // ============================================================================
  // Engagement/Note Operations
  // ============================================================================

  /**
   * Create a note on a deal with strategic recommendation
   */
  async createDealNote(dealId: string, content: string): Promise<{ id: string }> {
    // First create the note
    const note = await this.request<{ id: string }>(
      '/crm/v3/objects/notes',
      {
        method: 'POST',
        body: JSON.stringify({
          properties: {
            hs_note_body: content,
            hs_timestamp: new Date().toISOString(),
          },
        }),
      }
    );

    // Then associate it with the deal
    await this.request(
      `/crm/v4/objects/notes/${note.id}/associations/deals/${dealId}`,
      {
        method: 'PUT',
        body: JSON.stringify([
          {
            associationCategory: 'HUBSPOT_DEFINED',
            associationTypeId: 214, // Note to Deal association type
          },
        ]),
      }
    );

    return note;
  }

  // ============================================================================
  // CREATE Operations (for Signal Push)
  // ============================================================================

  /**
   * Find an existing company by name or create a new one.
   * Uses case-insensitive exact match for deduplication.
   */
  async findOrCreateCompany(
    name: string,
    properties: Record<string, string> = {}
  ): Promise<{ id: string; created: boolean }> {
    // First, try to find existing by name
    const existing = await this.searchCompanies(name, 1);
    if (existing.length > 0 && existing[0].properties.name?.toLowerCase() === name.toLowerCase()) {
      return { id: existing[0].id, created: false };
    }

    // Create new company
    const response = await rateLimitedRequest(() =>
      fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/companies`, {
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
      const error = await response.text();
      throw new Error(`Failed to create company: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return { id: data.id, created: true };
  }

  /**
   * Find an existing contact by first/last name or create a new one.
   * Uses exact match on both names for deduplication.
   */
  async findOrCreateContact(
    firstName: string,
    lastName: string,
    properties: Record<string, string> = {}
  ): Promise<{ id: string; created: boolean }> {
    // Search by first and last name
    const searchResponse = await rateLimitedRequest(() =>
      fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts/search`, {
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

    // Create new contact
    const response = await rateLimitedRequest(() =>
      fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts`, {
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
      const error = await response.text();
      throw new Error(`Failed to create contact: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return { id: data.id, created: true };
  }

  /**
   * Create a new deal in HubSpot.
   * Returns the deal ID.
   */
  async createDeal(
    name: string,
    properties: Record<string, string> = {}
  ): Promise<string> {
    const response = await rateLimitedRequest(() =>
      fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/deals`, {
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
      const error = await response.text();
      throw new Error(`Failed to create deal: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.id;
  }

  /**
   * Associate a deal with a company.
   * Uses HubSpot v4 associations API.
   */
  async associateDealToCompany(dealId: string, companyId: string): Promise<void> {
    const response = await rateLimitedRequest(() =>
      fetch(`${HUBSPOT_API_BASE}/crm/v4/objects/deals/${dealId}/associations/companies/${companyId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 341 } // Deal to Company
        ]),
      })
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to associate deal to company: ${response.status} - ${error}`);
    }
  }

  /**
   * Associate a deal with a contact.
   * Uses HubSpot v4 associations API.
   */
  async associateDealToContact(dealId: string, contactId: string): Promise<void> {
    const response = await rateLimitedRequest(() =>
      fetch(`${HUBSPOT_API_BASE}/crm/v4/objects/deals/${dealId}/associations/contacts/${contactId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 } // Deal to Contact
        ]),
      })
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to associate deal to contact: ${response.status} - ${error}`);
    }
  }

  /**
   * Associate a contact with a company.
   * Uses HubSpot v4 associations API.
   */
  async associateContactToCompany(contactId: string, companyId: string): Promise<void> {
    const response = await rateLimitedRequest(() =>
      fetch(`${HUBSPOT_API_BASE}/crm/v4/objects/contacts/${contactId}/associations/companies/${companyId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 } // Contact to Company
        ]),
      })
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to associate contact to company: ${response.status} - ${error}`);
    }
  }

  // ============================================================================
  // Aggregate Queries for Recommendation Engine
  // ============================================================================

  /**
   * Find all closed-won deals with a specific PE firm
   * Returns deals where the associated company has PE relationship
   */
  async findDealsWithPEFirm(peFirmName: string): Promise<HubSpotDeal[]> {
    // First find the PE firm company
    const companies = await this.searchCompanies(peFirmName);
    const peFirm = companies.find(
      c => c.properties.private_equity_relationship === 'Private Equity Firm'
    );

    if (!peFirm) {
      return [];
    }

    // Get deals associated with this PE firm
    const dealAssociations = await this.getCompanyDeals(peFirm.id);

    // Fetch full deal details
    const deals: HubSpotDeal[] = [];
    for (const assoc of dealAssociations) {
      try {
        const deal = await this.getDeal(assoc.id);
        if (deal.properties.dealstage === 'closedwon') {
          deals.push(deal);
        }
      } catch (e) {
        // Skip deals that can't be fetched
      }
    }

    return deals;
  }

  /**
   * Check if a company name exists as a past client (has closed-won deals)
   */
  async isPastClient(companyName: string): Promise<{
    isPastClient: boolean;
    deals: HubSpotDeal[];
  }> {
    const companies = await this.searchCompanies(companyName);

    for (const company of companies) {
      const dealAssociations = await this.getCompanyDeals(company.id);
      const closedWonDeals: HubSpotDeal[] = [];

      for (const assoc of dealAssociations) {
        try {
          const deal = await this.getDeal(assoc.id);
          if (deal.properties.dealstage === 'closedwon') {
            closedWonDeals.push(deal);
          }
        } catch (e) {
          // Skip
        }
      }

      if (closedWonDeals.length > 0) {
        return { isPastClient: true, deals: closedWonDeals };
      }
    }

    return { isPastClient: false, deals: [] };
  }

  /**
   * Get PE firm statistics for the recommendation engine
   */
  async getPEFirmStats(): Promise<{
    totalPEFirms: number;
    totalClosedWonDeals: number;
    peFirms: Array<{ name: string; id: string }>;
  }> {
    const [peFirms, deals] = await Promise.all([
      this.searchPEFirms(250),
      this.searchClosedWonDeals({ limit: 1 }), // Just get total
    ]);

    // Get total from a search with limit 1
    const dealsResponse = await this.request<HubSpotSearchResponse<HubSpotDeal>>(
      '/crm/v3/objects/deals/search',
      {
        method: 'POST',
        body: JSON.stringify({
          filterGroups: [
            { filters: [{ propertyName: 'dealstage', operator: 'EQ', value: 'closedwon' }] }
          ],
          properties: ['dealname'],
          limit: 1,
        }),
      }
    );

    return {
      totalPEFirms: peFirms.length,
      totalClosedWonDeals: dealsResponse.total,
      peFirms: peFirms.map(f => ({ name: f.properties.name, id: f.id })),
    };
  }
}

// Singleton instance
let hubspotClient: HubSpotClient | null = null;

export function getHubSpotClient(): HubSpotClient {
  if (!hubspotClient) {
    hubspotClient = new HubSpotClient();
  }
  return hubspotClient;
}
