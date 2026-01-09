/**
 * HubSpot Client Service
 *
 * Provides methods for querying HubSpot CRM data:
 * - Deals (closed-won history, PE relationships)
 * - Companies (PE firms, portfolio companies)
 * - Contacts (decision-makers)
 * - Associations (relationships between objects)
 */

import { HubSpotDeal, HubSpotCompany, HubSpotContact, HubSpotAssociation } from './types.js';

const HUBSPOT_API_BASE = 'https://api.hubapi.com';

interface HubSpotSearchResponse<T> {
  total: number;
  results: T[];
  paging?: {
    next?: {
      after: string;
    };
  };
}

interface HubSpotAssociationsResponse {
  results: Array<{
    id: string;
    type: string;
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
    const response = await this.request<HubSpotAssociationsResponse>(
      `/crm/v4/objects/companies/${companyId}/associations/deals`
    );
    return response.results;
  }

  /**
   * Get contacts associated with a company
   */
  async getCompanyContacts(companyId: string): Promise<HubSpotAssociation[]> {
    const response = await this.request<HubSpotAssociationsResponse>(
      `/crm/v4/objects/companies/${companyId}/associations/contacts`
    );
    return response.results;
  }

  /**
   * Get companies associated with a deal
   */
  async getDealCompanies(dealId: string): Promise<HubSpotAssociation[]> {
    const response = await this.request<HubSpotAssociationsResponse>(
      `/crm/v4/objects/deals/${dealId}/associations/companies`
    );
    return response.results;
  }

  /**
   * Get contacts associated with a deal
   */
  async getDealContacts(dealId: string): Promise<HubSpotAssociation[]> {
    const response = await this.request<HubSpotAssociationsResponse>(
      `/crm/v4/objects/deals/${dealId}/associations/contacts`
    );
    return response.results;
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
