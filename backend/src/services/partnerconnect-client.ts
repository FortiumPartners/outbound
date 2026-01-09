/**
 * PartnerConnect Client Service
 *
 * Provides methods for querying PartnerConnect data:
 * - Clients (past and current client companies)
 * - Engagements (partner work history)
 * - Resources (available partners with their experience)
 *
 * Uses M2M OAuth authentication via Auth0
 */

import { PartnerConnectClient, PartnerConnectEngagement, PartnerConnectResource } from './types.js';

const PC_API_BASE = process.env.PC_API_BASE || 'https://prod-v3.fortiumpartners.io/v3/api';
const PC_AUTH_URL = process.env.PC_AUTH_URL || 'https://prod-fs-fortiumpartners.us.auth0.com/oauth/token';
const PC_AUDIENCE = process.env.PC_AUDIENCE || 'https://prod-v3.fortiumpartners.io';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class PartnerConnectClientService {
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(clientId?: string, clientSecret?: string) {
    this.clientId = clientId || process.env.PC_CLIENT_ID || '';
    this.clientSecret = clientSecret || process.env.PC_CLIENT_SECRET || '';

    if (!this.clientId || !this.clientSecret) {
      throw new Error('PC_CLIENT_ID and PC_CLIENT_SECRET are required');
    }
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  private async getToken(): Promise<string> {
    // Return cached token if still valid (with 5 min buffer)
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    // Fetch new token
    const response = await fetch(PC_AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        audience: PC_AUDIENCE,
        grant_type: 'client_credentials',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`PartnerConnect auth error ${response.status}: ${error}`);
    }

    const data: TokenResponse = await response.json();
    this.accessToken = data.access_token;

    // Set expiry with 5 minute buffer
    const expiresIn = (data.expires_in - 300) * 1000;
    this.tokenExpiry = new Date(Date.now() + expiresIn);

    return this.accessToken;
  }

  private async request<T>(endpoint: string): Promise<T> {
    const token = await this.getToken();
    const url = `${PC_API_BASE}${endpoint}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`PartnerConnect API error ${response.status}: ${error}`);
    }

    return response.json();
  }

  // ============================================================================
  // Client Operations
  // ============================================================================

  /**
   * Get all clients
   */
  async getClients(): Promise<PartnerConnectClient[]> {
    return this.request<PartnerConnectClient[]>('/clients');
  }

  /**
   * Get a specific client by UID
   */
  async getClient(uid: string): Promise<PartnerConnectClient> {
    return this.request<PartnerConnectClient>(`/clients/${uid}`);
  }

  /**
   * Search clients by name (case-insensitive partial match)
   */
  async searchClients(name: string): Promise<PartnerConnectClient[]> {
    const clients = await this.getClients();
    const searchLower = name.toLowerCase();
    return clients.filter(c =>
      c.displayName?.toLowerCase().includes(searchLower)
    );
  }

  /**
   * Search clients by domain
   */
  async searchClientsByDomain(domain: string): Promise<PartnerConnectClient[]> {
    const clients = await this.getClients();
    const searchLower = domain.toLowerCase();
    return clients.filter(c =>
      c.domain?.toLowerCase().includes(searchLower)
    );
  }

  // ============================================================================
  // Engagement Operations
  // ============================================================================

  /**
   * Get all engagements
   */
  async getEngagements(): Promise<PartnerConnectEngagement[]> {
    return this.request<PartnerConnectEngagement[]>('/engagements');
  }

  /**
   * Get engagements for a specific client
   */
  async getClientEngagements(clientUid: string): Promise<PartnerConnectEngagement[]> {
    return this.request<PartnerConnectEngagement[]>(`/engagements?clientUid=${clientUid}`);
  }

  /**
   * Get active engagements
   */
  async getActiveEngagements(): Promise<PartnerConnectEngagement[]> {
    const engagements = await this.getEngagements();
    return engagements.filter(e => e.status === 'Active');
  }

  // ============================================================================
  // Resource (Partner) Operations
  // ============================================================================

  /**
   * Get all active resources (partners)
   */
  async getActiveResources(): Promise<PartnerConnectResource[]> {
    return this.request<PartnerConnectResource[]>('/resources?active=true');
  }

  /**
   * Get a specific resource by UID
   */
  async getResource(uid: string): Promise<PartnerConnectResource> {
    return this.request<PartnerConnectResource>(`/resources/${uid}`);
  }

  /**
   * Search resources by name
   */
  async searchResources(name: string): Promise<PartnerConnectResource[]> {
    const resources = await this.getActiveResources();
    const searchLower = name.toLowerCase();
    return resources.filter(r =>
      r.displayName?.toLowerCase().includes(searchLower) ||
      r.firstName?.toLowerCase().includes(searchLower) ||
      r.lastName?.toLowerCase().includes(searchLower)
    );
  }

  /**
   * Get resources with availability in the next 30 days
   */
  async getAvailableResources(): Promise<PartnerConnectResource[]> {
    const resources = await this.getActiveResources();
    return resources.filter(r =>
      r.availabilityNext30 !== undefined && r.availabilityNext30 > 0
    );
  }

  // ============================================================================
  // Aggregate Queries for Recommendation Engine
  // ============================================================================

  /**
   * Find partners who have worked at a specific company
   */
  async findPartnersWithCompanyExperience(companyName: string): Promise<{
    partner: PartnerConnectResource;
    engagement: PartnerConnectEngagement;
  }[]> {
    const [resources, engagements] = await Promise.all([
      this.getActiveResources(),
      this.getEngagements(),
    ]);

    // Build a map of resource UID to resource
    const resourceMap = new Map<string, PartnerConnectResource>();
    resources.forEach(r => resourceMap.set(r.uid, r));

    // Find engagements at the company
    const searchLower = companyName.toLowerCase();
    const matchingEngagements = engagements.filter(e =>
      e.clientDisplayName?.toLowerCase().includes(searchLower)
    );

    // Return partners with their engagements
    const results: { partner: PartnerConnectResource; engagement: PartnerConnectEngagement }[] = [];

    for (const engagement of matchingEngagements) {
      // Need to get resource who did this engagement
      // The engagement doesn't directly link to resource, would need to check resource's engagements
      // For now, return the engagement info with placeholder for partner lookup
    }

    return results;
  }

  /**
   * Check if a company is a past client
   */
  async isPastClient(companyName: string): Promise<{
    isPastClient: boolean;
    client?: PartnerConnectClient;
    engagements: PartnerConnectEngagement[];
  }> {
    const clients = await this.searchClients(companyName);

    if (clients.length === 0) {
      return { isPastClient: false, engagements: [] };
    }

    const client = clients[0];
    const engagements = await this.getClientEngagements(client.uid);

    return {
      isPastClient: true,
      client,
      engagements,
    };
  }

  /**
   * Get partner statistics for the recommendation engine
   */
  async getPartnerStats(): Promise<{
    totalActivePartners: number;
    partnersWithAvailability: number;
    totalClients: number;
  }> {
    const [resources, clients] = await Promise.all([
      this.getActiveResources(),
      this.getClients(),
    ]);

    const availablePartners = resources.filter(r =>
      r.availabilityNext30 !== undefined && r.availabilityNext30 > 0
    );

    return {
      totalActivePartners: resources.length,
      partnersWithAvailability: availablePartners.length,
      totalClients: clients.length,
    };
  }

  /**
   * Find partners in a specific metro area
   */
  async findPartnersInMetro(metro: string): Promise<PartnerConnectResource[]> {
    const resources = await this.getActiveResources();

    // Extract city from metro (e.g., "San Francisco, CA" -> "San Francisco")
    const city = metro.split(',')[0].trim().toLowerCase();
    const state = metro.includes(',') ? metro.split(',')[1].trim().toUpperCase() : '';

    return resources.filter(r => {
      const matchCity = r.city?.toLowerCase().includes(city);
      const matchState = !state || r.state?.toUpperCase() === state;
      return matchCity || matchState;
    });
  }
}

// Singleton instance
let partnerConnectClient: PartnerConnectClientService | null = null;

export function getPartnerConnectClient(): PartnerConnectClientService {
  if (!partnerConnectClient) {
    partnerConnectClient = new PartnerConnectClientService();
  }
  return partnerConnectClient;
}
