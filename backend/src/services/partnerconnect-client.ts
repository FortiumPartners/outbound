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

/**
 * Normalized role codes used in PartnerConnect
 * These match the LeadershipRoleCode values in the API
 */
export type RoleCode = 'CTO' | 'CFO' | 'CIO' | 'CISO' | 'COO' | 'VP_ENGINEERING' | 'VP_TECHNOLOGY';

/**
 * Raw user response from PartnerConnect API (PascalCase)
 */
interface PCUserResponse {
  Uid: string;
  DisplayName: string;
  FirstName: string;
  LastName: string;
  PrimaryEmail: string;
  LeadershipRoleCode?: string;
  City?: string;
  State?: string;
  HomeAreaCode?: string;
  AvailabilityNext30?: number;
  AvailabilityNext60?: number;
  AvailabilityNext90?: number;
  Active?: boolean;
}

const PC_API_BASE = process.env.PC_API_BASE || 'https://prod-v3.fortiumpartners.io/v3/api';
const PC_AUTH_URL = process.env.PC_AUTH_URL || 'https://prod-fs-fortiumpartners.us.auth0.com/oauth/token';
const PC_AUDIENCE = process.env.PC_AUDIENCE || 'https://prod-v3.fortiumpartners.io';

/**
 * Mapping of job title patterns to normalized role codes
 * Patterns are matched case-insensitively against job titles
 */
const ROLE_MAPPINGS: { patterns: RegExp[]; code: RoleCode }[] = [
  // CTO patterns
  {
    patterns: [
      /\bCTO\b/i,
      /\bChief\s+Technology\s+Officer\b/i,
      /\bChief\s+Tech\s+Officer\b/i,
    ],
    code: 'CTO',
  },
  // CFO patterns
  {
    patterns: [
      /\bCFO\b/i,
      /\bChief\s+Financial\s+Officer\b/i,
      /\bChief\s+Finance\s+Officer\b/i,
    ],
    code: 'CFO',
  },
  // CIO patterns
  {
    patterns: [
      /\bCIO\b/i,
      /\bChief\s+Information\s+Officer\b/i,
      /\bChief\s+Info\s+Officer\b/i,
    ],
    code: 'CIO',
  },
  // CISO patterns
  {
    patterns: [
      /\bCISO\b/i,
      /\bChief\s+Information\s+Security\s+Officer\b/i,
      /\bChief\s+Security\s+Officer\b/i,
    ],
    code: 'CISO',
  },
  // COO patterns
  {
    patterns: [
      /\bCOO\b/i,
      /\bChief\s+Operating\s+Officer\b/i,
      /\bChief\s+Operations\s+Officer\b/i,
    ],
    code: 'COO',
  },
  // VP Engineering patterns
  {
    patterns: [
      /\bVP\s+(?:of\s+)?Engineering\b/i,
      /\bVice\s+President\s+(?:of\s+)?Engineering\b/i,
      /\bVP\s+Eng\b/i,
    ],
    code: 'VP_ENGINEERING',
  },
  // VP Technology patterns
  {
    patterns: [
      /\bVP\s+(?:of\s+)?Technology\b/i,
      /\bVice\s+President\s+(?:of\s+)?Technology\b/i,
      /\bVP\s+Tech\b/i,
    ],
    code: 'VP_TECHNOLOGY',
  },
];

/**
 * Normalize a job title to a standard role code
 *
 * Examples:
 *   "CTO Vacancy" -> "CTO"
 *   "Chief Technology Officer" -> "CTO"
 *   "VP of Engineering" -> "VP_ENGINEERING"
 *   "CFO needed" -> "CFO"
 *
 * @param jobTitle - The job title to normalize
 * @returns The normalized role code or null if no match
 */
export function normalizeRoleCode(jobTitle: string): RoleCode | null {
  if (!jobTitle) return null;

  for (const mapping of ROLE_MAPPINGS) {
    for (const pattern of mapping.patterns) {
      if (pattern.test(jobTitle)) {
        return mapping.code;
      }
    }
  }

  return null;
}

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

  /**
   * Search clients by multiple keywords (industry terms, company type, etc.)
   * Searches in displayName and domain for any matching keyword.
   *
   * @param keywords - Array of keywords to search for (e.g., ['anesthesia', 'healthcare', 'medical'])
   * @returns Clients matching any of the keywords
   */
  async searchClientsByKeywords(keywords: string[]): Promise<PartnerConnectClient[]> {
    const clients = await this.getClients();
    const keywordsLower = keywords.map(k => k.toLowerCase());

    return clients.filter(c => {
      const name = c.displayName?.toLowerCase() || '';
      const domain = c.domain?.toLowerCase() || '';
      const combined = `${name} ${domain}`;

      return keywordsLower.some(keyword => combined.includes(keyword));
    });
  }

  /**
   * Find past work related to an industry or company type.
   * Searches for clients with matching keywords and returns with their engagements.
   *
   * @param keywords - Industry terms to search for (e.g., ['anesthesia', 'anesthesiology'])
   * @returns Matching clients with their engagements
   */
  async findPastWorkByIndustry(keywords: string[]): Promise<{
    client: PartnerConnectClient;
    engagements: PartnerConnectEngagement[];
  }[]> {
    const matchingClients = await this.searchClientsByKeywords(keywords);
    const results: { client: PartnerConnectClient; engagements: PartnerConnectEngagement[] }[] = [];

    for (const client of matchingClients.slice(0, 10)) { // Limit to first 10
      try {
        const engagements = await this.getClientEngagements(client.uid);
        results.push({ client, engagements });
      } catch {
        // Skip clients we can't get engagements for
        results.push({ client, engagements: [] });
      }
    }

    return results;
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
  // User Operations (for availability and role filtering)
  // ============================================================================

  /**
   * Get all active users (partners with availability data)
   * Uses the /users endpoint which has AvailabilityNext30/60/90 fields
   */
  private async getActiveUsers(): Promise<PCUserResponse[]> {
    return this.request<PCUserResponse[]>('/users?active=true');
  }

  /**
   * Transform a PascalCase user response to camelCase PartnerConnectResource
   */
  private transformUserToResource(user: PCUserResponse): PartnerConnectResource {
    return {
      uid: user.Uid,
      displayName: user.DisplayName,
      firstName: user.FirstName,
      lastName: user.LastName,
      primaryEmail: user.PrimaryEmail,
      leadershipRoleCode: user.LeadershipRoleCode,
      city: user.City,
      state: user.State,
      homeAreaCode: user.HomeAreaCode,
      availabilityNext30: user.AvailabilityNext30,
      availabilityNext60: user.AvailabilityNext60,
      availabilityNext90: user.AvailabilityNext90,
    };
  }

  /**
   * Search partners by leadership role code
   *
   * @param roleCode - The role code to filter by (CTO, CFO, CIO, CISO, COO)
   * @returns Array of resources matching the role
   */
  async searchPartnersByRole(roleCode: RoleCode): Promise<PartnerConnectResource[]> {
    const users = await this.getActiveUsers();

    // Filter by leadership role code
    const matchingUsers = users.filter(
      u => u.LeadershipRoleCode?.toUpperCase() === roleCode.toUpperCase()
    );

    return matchingUsers.map(u => this.transformUserToResource(u));
  }

  /**
   * Get available partners by role
   * Filters by role AND availability > 0, sorted by availability descending
   *
   * @param roleCode - The role code to filter by (CTO, CFO, CIO, CISO, COO)
   * @returns Array of available resources matching the role, sorted by availability
   */
  async getAvailablePartnersByRole(roleCode: RoleCode): Promise<PartnerConnectResource[]> {
    const users = await this.getActiveUsers();

    // Filter by role and availability
    const matchingUsers = users.filter(
      u =>
        u.LeadershipRoleCode?.toUpperCase() === roleCode.toUpperCase() &&
        u.AvailabilityNext30 !== undefined &&
        u.AvailabilityNext30 > 0
    );

    // Sort by availability descending (most available first)
    matchingUsers.sort((a, b) => {
      const availA = a.AvailabilityNext30 ?? 0;
      const availB = b.AvailabilityNext30 ?? 0;
      return availB - availA;
    });

    return matchingUsers.map(u => this.transformUserToResource(u));
  }

  // ============================================================================
  // Aggregate Queries for Recommendation Engine
  // ============================================================================

  /**
   * Find partners who have worked at a specific company.
   *
   * TODO: Not implemented - requires resource-engagement mapping.
   * The engagement API returns engagements but doesn't directly link to resources.
   * Would need to query /engagements?resourceUid=X for each resource to build mapping.
   *
   * NOTE: For the recommendation engine, we now use functional matching (getAvailablePartnersByRole)
   * rather than literal company experience matching.
   */
  async findPartnersWithCompanyExperience(_companyName: string): Promise<{
    partner: PartnerConnectResource;
    engagement: PartnerConnectEngagement;
  }[]> {
    // Not implemented - see TODO above
    return [];
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
