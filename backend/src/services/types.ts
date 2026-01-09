/**
 * Strategic Recommendation Engine Types
 *
 * These types define the data structures for analyzing opportunities
 * and generating recommendations for the best path to decision-makers.
 */

// ============================================================================
// Input Types (from signals and external sources)
// ============================================================================

export interface PEContact {
  name: string;
  title: string;
  organization: string;
  email?: string;
  linkedIn?: string;
}

export interface SignalRawPayload {
  id: string;
  url: string;
  title: string;
  company: string;
  companyName: string;
  jobTitle: string;
  metro: string;
  description: string;
  fullDescription?: string;
  postedDate: string;
  peContacts: PEContact[];
  companyMetadata?: {
    industry?: string;
    ownership?: string;
  };
}

export interface OpportunityContext {
  signalId: string;
  company: {
    name: string;
    metro: string;
    industry?: string;
    ownership?: string;
  };
  jobTitle: string;
  peContacts: PEContact[];
  peFirms: string[]; // Extracted unique PE firm names
  sourceUrl: string;
  postedDate: string;
}

// ============================================================================
// Connection Types (relationships we discover)
// ============================================================================

export type ConnectionType =
  | 'pe_relationship'      // Same PE firm as a past deal
  | 'past_client'          // Company is a past client
  | 'partner_experience'   // A partner worked at this company
  | 'similar_deal'         // Similar deal closed recently
  | 'pe_portfolio'         // Other portfolio company of same PE
  | 'industry_match'       // Same industry as past wins
  | 'metro_match';         // Partners available in same metro

export type ConnectionStrength = 'strong' | 'medium' | 'weak';

export interface Connection {
  type: ConnectionType;
  strength: ConnectionStrength;
  via: string;           // PE firm name, partner name, deal name, etc.
  evidence: string;      // Human-readable explanation
  score: number;         // 0-100 contribution to overall score
  metadata?: {
    dealId?: string;
    partnerId?: string;
    companyId?: string;
    peFirmId?: string;
  };
}

// ============================================================================
// Contact Recommendation Types
// ============================================================================

export type ApproachType =
  | 'pe_intro'           // Warm intro through PE relationship
  | 'partner_referral'   // Partner who has relationship
  | 'warm_intro'         // Through similar past deal
  | 'direct_outreach';   // Cold outreach

export type Channel = 'email' | 'linkedin' | 'phone' | 'meeting';

export interface ContactRecommendation {
  contact: {
    name: string;
    title: string;
    organization: string;
    email?: string;
    linkedIn?: string;
  };
  priority: 1 | 2 | 3;   // 1 = highest priority
  score: number;         // 0-100 overall score
  approach: ApproachType;
  channel: Channel;
  messenger?: {          // Who should reach out
    name: string;
    role: string;
    reason: string;      // Why this person
  };
  justification: string; // Why this contact/approach
  conversationOpener?: string; // Claude-generated opener
}

// ============================================================================
// Strategic Recommendation (full output)
// ============================================================================

export interface StrategicRecommendation {
  opportunityId: string;
  companyName: string;
  jobTitle: string;

  // Analysis results
  connections: Connection[];
  overallScore: number;  // 0-100 probability of success

  // Prioritized recommendations
  contactRecommendations: ContactRecommendation[];

  // Human-readable summary
  summary: string;

  // Metadata
  generatedAt: Date;
  generationMethod: 'strategic_analysis';
  hubspotDealId?: string;
  hubspotNoteId?: string;
}

// ============================================================================
// HubSpot Types
// ============================================================================

export interface HubSpotDeal {
  id: string;
  properties: {
    dealname: string;
    dealstage: string;
    practice?: string;
    amount?: string;
    closedate?: string;
    hubspot_owner_id?: string;
  };
}

export interface HubSpotCompany {
  id: string;
  properties: {
    name: string;
    private_equity_relationship?: string;
    domain?: string;
    industry?: string;
  };
}

export interface HubSpotContact {
  id: string;
  properties: {
    firstname?: string;
    lastname?: string;
    email?: string;
    jobtitle?: string;
    pe_contact_role?: string;
  };
}

export interface HubSpotAssociation {
  id: string;
  type: string;
}

// ============================================================================
// PartnerConnect Types
// ============================================================================

export interface PartnerConnectClient {
  uid: string;
  displayName: string;
  city?: string;
  state?: string;
  domain?: string;
}

export interface PartnerConnectEngagement {
  uid: string;
  clientUid: string;
  clientDisplayName: string;
  status: string;
  leadershipRoleCode?: string;
  engagementTypeCode?: string;
}

export interface PartnerConnectResource {
  uid: string;
  displayName: string;
  firstName: string;
  lastName: string;
  primaryEmail: string;
  leadershipRoleCode?: string;
  city?: string;
  state?: string;
  homeAreaCode?: string;
  availabilityNext30?: number;
  availabilityNext60?: number;
  availabilityNext90?: number;
}

// ============================================================================
// Scoring Configuration
// ============================================================================

export const SCORING_WEIGHTS = {
  // Connection strength scores
  connection: {
    pe_relationship_strong: 40,
    pe_relationship_medium: 25,
    past_client: 35,
    partner_experience: 30,
    similar_deal: 20,
    pe_portfolio: 25,
    industry_match: 10,
  },

  // Role accessibility scores
  role: {
    managing_partner: 30,
    operating_partner: 28,
    senior_partner: 26,
    partner: 24,
    principal: 20,
    managing_director: 22,
    vice_president: 18,
    director: 15,
    ceo: 28,
    cfo: 22,
    cto: 20,
    cio: 20,
    ciso: 20,
    default: 10,
  },

  // Existing relationship bonus
  existing_relationship: {
    closed_won: 30,
    active_deal: 20,
    engaged: 15,
    in_hubspot: 5,
    none: 0,
  },
} as const;
