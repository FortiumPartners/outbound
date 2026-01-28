/**
 * Strategic Recommendation Engine
 *
 * Analyzes opportunities and generates strategic recommendations
 * for the best path to getting conversations with decision-makers.
 *
 * Uses:
 * - HubSpot: PE relationships, closed-won deals, company history
 * - PartnerConnect: Partner availability, work experience, functional matching
 * - Claude AI: Personalized conversation openers
 */

import Anthropic from '@anthropic-ai/sdk';
import { getHubSpotClient } from './hubspot-client.js';
import { getPartnerConnectClient, normalizeRoleCode } from './partnerconnect-client.js';
import {
  OpportunityContext,
  Connection,
  ConnectionType,
  ConnectionStrength,
  ContactRecommendation,
  StrategicRecommendation,
  ApproachType,
  Channel,
  PEContact,
  SimilarDeal,
  EngagementType,
  CompanyContact,
  SCORING_WEIGHTS,
} from './types.js';

// Extended SimilarDeal with contacts for industry matches
interface IndustryDeal extends SimilarDeal {
  contacts: Array<{ name: string; title?: string }>;
  matchedKeyword?: string;
}

export class RecommendationEngine {
  private hubspot = getHubSpotClient();
  private partnerConnect: ReturnType<typeof getPartnerConnectClient> | null = null;
  private anthropic: Anthropic | null = null;

  constructor() {
    // PartnerConnect requires credentials - init lazily
    try {
      this.partnerConnect = getPartnerConnectClient();
    } catch (e) {
      console.warn('PartnerConnect not configured, skipping partner matching');
    }

    // Anthropic for conversation openers
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic();
    }
  }

  /**
   * Generate a strategic recommendation for an opportunity
   */
  async generateRecommendation(context: OpportunityContext): Promise<StrategicRecommendation> {
    console.log(`Generating recommendation for ${context.company.name}...`);

    // Step 1: Normalize the role from job title
    const functionalRole = normalizeRoleCode(context.jobTitle);
    if (functionalRole) {
      context.functionalRole = functionalRole;
    }

    // Step 2: Determine engagement type based on company profile
    const engagementType = this.determineEngagementType(context);
    context.engagementType = engagementType;

    // Step 3: Discover connections
    const connections = await this.discoverConnections(context);

    // Step 4: Get similar deals for framing (HubSpot data, not partner matching)
    const similarDeals = await this.getSimilarDeals(context);

    // Step 5: Get industry-related deals from HubSpot (e.g., anesthesia)
    const industryDeals = await this.getIndustryDeals(context);

    // Step 6: Get existing company contacts from HubSpot
    const companyContacts = await this.getCompanyContacts(context.company.name);

    // Step 7: Score and prioritize contacts
    const contactRecommendations = await this.prioritizeContacts(context, connections);

    // Step 8: Calculate overall score
    const overallScore = this.calculateOverallScore(connections, contactRecommendations);

    // Step 9: Generate summary (partner matching handled by Piper)
    const summary = this.generateSummary(context, connections, contactRecommendations, similarDeals, companyContacts, industryDeals);

    // Step 10: Generate Claude conversation openers for top contacts
    if (this.anthropic && contactRecommendations.length > 0) {
      await this.generateConversationOpeners(context, connections, contactRecommendations);
    }

    return {
      opportunityId: context.signalId,
      companyName: context.company.name,
      jobTitle: context.jobTitle,
      connections,
      overallScore,
      engagementType,
      availablePartners: [], // Partner matching handled by Piper
      similarDeals,
      companyContacts,
      contactRecommendations,
      summary,
      generatedAt: new Date(),
      generationMethod: 'strategic_analysis',
    };
  }

  /**
   * Determine the likely engagement type based on company profile
   */
  private determineEngagementType(context: OpportunityContext): EngagementType {
    const isPEBacked = context.peFirms.length > 0 || context.company.ownership === 'PE-backed';
    const jobTitleLower = context.jobTitle.toLowerCase();

    // If PE-backed and looking for C-suite, likely interim-to-perm
    // PE firms often want to test talent before committing
    if (isPEBacked) {
      const isCLevel = /\b(cto|cfo|cio|ciso|coo|chief)\b/i.test(jobTitleLower);
      if (isCLevel) {
        return 'interim_to_perm';
      }
      // VP level at PE-backed - often pure interim for specific projects
      return 'interim';
    }

    // Non-PE companies often benefit from fractional for ongoing support
    const isVPLevel = /\b(vp|vice president|director)\b/i.test(jobTitleLower);
    if (isVPLevel) {
      return 'fractional';
    }

    // Default to project for specific initiatives
    return 'project';
  }

  /**
   * Get similar closed-won deals for framing qualifications
   */
  private async getSimilarDeals(context: OpportunityContext): Promise<SimilarDeal[]> {
    const practice = this.mapRoleToPractice(context.functionalRole || context.jobTitle);
    if (!practice) {
      return [];
    }

    try {
      return await this.hubspot.searchSimilarDeals({ practice, monthsBack: 12 });
    } catch (e) {
      console.warn('Failed to get similar deals:', e);
      return [];
    }
  }

  /**
   * Get industry-related deals from HubSpot based on company name keywords.
   * Returns deals with contacts (e.g., "U.S. Anesthesia Partners" with "Julian Sparkes").
   */
  private async getIndustryDeals(context: OpportunityContext): Promise<IndustryDeal[]> {
    const keywords = this.extractIndustryKeywords(context.company.name);
    if (keywords.length === 0) {
      return [];
    }

    const allDeals: IndustryDeal[] = [];
    const seenDealIds = new Set<string>();

    for (const keyword of keywords) {
      try {
        const deals = await this.hubspot.searchDealsByKeyword(keyword);

        for (const deal of deals) {
          // Skip if already seen or if it's the same company
          if (seenDealIds.has(deal.dealId)) continue;
          if (deal.companyName.toLowerCase() === context.company.name.toLowerCase()) continue;

          seenDealIds.add(deal.dealId);
          allDeals.push({
            ...deal,
            matchedKeyword: keyword,
          });
        }
      } catch (e) {
        console.warn(`Failed to search HubSpot deals for keyword "${keyword}":`, e);
      }
    }

    return allDeals;
  }

  /**
   * Get existing contacts at the target company from HubSpot
   */
  private async getCompanyContacts(companyName: string): Promise<CompanyContact[]> {
    try {
      // First find the company in HubSpot
      const companies = await this.hubspot.searchCompanies(companyName, 1);
      if (companies.length === 0) {
        return [];
      }

      const company = companies[0];
      const contacts = await this.hubspot.getCompanyContactDetails(company.id);

      return contacts.map(c => ({
        id: c.id,
        name: [c.properties.firstname, c.properties.lastname].filter(Boolean).join(' ') || 'Unknown',
        title: c.properties.jobtitle,
        email: c.properties.email,
        company: companyName,
      }));
    } catch (e) {
      console.warn(`Failed to get company contacts for ${companyName}:`, e);
      return [];
    }
  }

  /**
   * Map a role/job title to a practice area for deal searching
   */
  private mapRoleToPractice(roleOrTitle: string): string | null {
    const input = roleOrTitle.toUpperCase();

    // Direct role code mappings
    if (input === 'CTO' || input.includes('TECHNOLOGY') || input.includes('TECH')) {
      return 'Technology';
    }
    if (input === 'CFO' || input.includes('FINANCIAL') || input.includes('FINANCE')) {
      return 'Finance';
    }
    if (input === 'CIO' || input.includes('INFORMATION OFFICER')) {
      return 'Technology'; // CIO often falls under Technology practice
    }
    if (input === 'CISO' || input.includes('SECURITY')) {
      return 'Security';
    }
    if (input === 'COO' || input.includes('OPERATING') || input.includes('OPERATIONS')) {
      return 'Operations';
    }
    if (input.includes('ENGINEERING')) {
      return 'Technology';
    }

    return null;
  }

  /**
   * Discover all connections for an opportunity
   */
  private async discoverConnections(context: OpportunityContext): Promise<Connection[]> {
    const connections: Connection[] = [];

    // 1. Check PE relationships
    for (const peFirm of context.peFirms) {
      const peConnections = await this.checkPERelationship(peFirm);
      connections.push(...peConnections);
    }

    // 2. Check if company is a past client
    const pastClientConnection = await this.checkPastClient(context.company.name);
    if (pastClientConnection) {
      connections.push(pastClientConnection);
    }

    // 3. Check PartnerConnect for partner experience (if available)
    if (this.partnerConnect) {
      const partnerConnections = await this.checkPartnerExperience(context);
      connections.push(...partnerConnections);
    }

    // 4. Check for similar deals (same practice area)
    const similarDealConnection = await this.checkSimilarDeals(context);
    if (similarDealConnection) {
      connections.push(similarDealConnection);
    }

    // 5. Check for industry matches
    if (context.company.industry) {
      const industryConnection = await this.checkIndustryMatch(context.company.industry);
      if (industryConnection) {
        connections.push(industryConnection);
      }
    }

    // Sort by score descending
    connections.sort((a, b) => b.score - a.score);

    return connections;
  }

  /**
   * Check for similar closed-won deals in the same practice area
   */
  private async checkSimilarDeals(context: OpportunityContext): Promise<Connection | null> {
    const practice = this.mapRoleToPractice(context.functionalRole || context.jobTitle);
    if (!practice) {
      return null;
    }

    try {
      const deals = await this.hubspot.searchSimilarDeals({ practice, monthsBack: 12 });

      if (deals.length === 0) {
        return null;
      }

      // Stronger connection if we have PE firm overlap
      const peFirmsLower = context.peFirms.map(f => f.toLowerCase());
      const peOverlap = deals.filter(d => d.peFirm && peFirmsLower.includes(d.peFirm.toLowerCase()));

      const strength: ConnectionStrength = peOverlap.length > 0 ? 'strong' : deals.length >= 3 ? 'medium' : 'weak';
      const score = peOverlap.length > 0
        ? SCORING_WEIGHTS.connection.similar_deal + 10
        : SCORING_WEIGHTS.connection.similar_deal;

      return {
        type: 'similar_deal',
        strength,
        via: practice,
        evidence: `${deals.length} ${practice} placements in past 12mo${peOverlap.length > 0 ? ` (${peOverlap.length} with same PE)` : ''}`,
        score,
        metadata: {
          dealId: deals[0].dealId,
        },
      };
    } catch (e) {
      console.warn('Failed to check similar deals:', e);
      return null;
    }
  }

  /**
   * Check for PE relationship (same PE firm as past deals)
   */
  private async checkPERelationship(peFirmName: string): Promise<Connection[]> {
    const connections: Connection[] = [];

    try {
      const deals = await this.hubspot.findDealsWithPEFirm(peFirmName);

      if (deals.length > 0) {
        // Strong relationship if we have multiple closed-won deals
        const strength: ConnectionStrength = deals.length >= 3 ? 'strong' : 'medium';
        const score = strength === 'strong'
          ? SCORING_WEIGHTS.connection.pe_relationship_strong
          : SCORING_WEIGHTS.connection.pe_relationship_medium;

        connections.push({
          type: 'pe_relationship',
          strength,
          via: peFirmName,
          evidence: `${deals.length} closed-won deal(s) with ${peFirmName} portfolio companies`,
          score,
          metadata: {
            peFirmId: peFirmName,
          },
        });
      }
    } catch (e) {
      console.warn(`Failed to check PE relationship for ${peFirmName}:`, e);
    }

    return connections;
  }

  /**
   * Check if company is a past client
   */
  private async checkPastClient(companyName: string): Promise<Connection | null> {
    try {
      const result = await this.hubspot.isPastClient(companyName);

      if (result.isPastClient && result.deals.length > 0) {
        return {
          type: 'past_client',
          strength: 'strong',
          via: companyName,
          evidence: `${result.deals.length} previous engagement(s) with ${companyName}`,
          score: SCORING_WEIGHTS.connection.past_client,
          metadata: {
            dealId: result.deals[0].id,
          },
        };
      }
    } catch (e) {
      console.warn(`Failed to check past client status for ${companyName}:`, e);
    }

    return null;
  }

  /**
   * Check PartnerConnect for partner experience at company or similar
   */
  private async checkPartnerExperience(context: OpportunityContext): Promise<Connection[]> {
    const connections: Connection[] = [];

    if (!this.partnerConnect) return connections;

    try {
      // Check if company is in PartnerConnect as a client (exact match)
      const pcResult = await this.partnerConnect.isPastClient(context.company.name);

      if (pcResult.isPastClient) {
        connections.push({
          type: 'partner_experience',
          strength: 'strong',
          via: context.company.name,
          evidence: `Partner has worked at ${context.company.name}`,
          score: SCORING_WEIGHTS.connection.partner_experience,
          metadata: {
            companyId: pcResult.client?.uid,
          },
        });
      }

      // Also search by industry keywords extracted from company name
      const industryKeywords = this.extractIndustryKeywords(context.company.name);
      if (industryKeywords.length > 0) {
        const industryMatches = await this.partnerConnect.findPastWorkByIndustry(industryKeywords);

        // Filter out exact company match (already handled above)
        const newMatches = industryMatches.filter(
          m => m.client.displayName?.toLowerCase() !== context.company.name.toLowerCase()
        );

        if (newMatches.length > 0) {
          const matchedClients = newMatches.map(m => m.client.displayName).slice(0, 3);
          const matchedKeyword = industryKeywords.find(k =>
            matchedClients.some(c => c?.toLowerCase().includes(k.toLowerCase()))
          ) || industryKeywords[0];

          connections.push({
            type: 'industry_match',
            strength: newMatches.length >= 2 ? 'medium' : 'weak',
            via: matchedKeyword,
            evidence: `Past work with similar companies: ${matchedClients.join(', ')}`,
            score: SCORING_WEIGHTS.connection.industry_match + (newMatches.length >= 2 ? 5 : 0),
            metadata: {
              companyId: newMatches[0].client.uid,
            },
          });
        }
      }

      // NOTE: Metro/location match removed - Fortium prioritizes ability/experience, not location
    } catch (e) {
      console.warn('Failed to check PartnerConnect:', e);
    }

    return connections;
  }

  /**
   * Extract industry keywords from a company name.
   * These keywords are used to find similar past clients in PartnerConnect.
   *
   * Examples:
   *   "North American Partners in Anesthesia" → ["anesthesia", "anesthesiology"]
   *   "Healthcare Services Inc" → ["healthcare"]
   *   "TechCorp Software" → ["software", "tech"]
   */
  private extractIndustryKeywords(companyName: string): string[] {
    const keywords: string[] = [];
    const nameLower = companyName.toLowerCase();

    // Industry keyword patterns with related terms
    const industryPatterns: { pattern: RegExp; keywords: string[] }[] = [
      { pattern: /anesthe/i, keywords: ['anesthesia', 'anesthesiology'] },
      { pattern: /health/i, keywords: ['healthcare', 'health'] },
      { pattern: /medical/i, keywords: ['medical', 'healthcare'] },
      { pattern: /pharma/i, keywords: ['pharmaceutical', 'pharma'] },
      { pattern: /biotech/i, keywords: ['biotech', 'biotechnology'] },
      { pattern: /software/i, keywords: ['software', 'tech'] },
      { pattern: /fintech/i, keywords: ['fintech', 'financial'] },
      { pattern: /insur/i, keywords: ['insurance'] },
      { pattern: /manufact/i, keywords: ['manufacturing'] },
      { pattern: /logist/i, keywords: ['logistics', 'supply chain'] },
      { pattern: /retail/i, keywords: ['retail'] },
      { pattern: /energy/i, keywords: ['energy'] },
      { pattern: /construc/i, keywords: ['construction'] },
      { pattern: /real\s*estate/i, keywords: ['real estate'] },
      { pattern: /hospit/i, keywords: ['hospitality', 'hospital'] },
      { pattern: /educati/i, keywords: ['education'] },
      { pattern: /media/i, keywords: ['media'] },
      { pattern: /telecom/i, keywords: ['telecom', 'telecommunications'] },
      { pattern: /automo/i, keywords: ['automotive'] },
      { pattern: /aero/i, keywords: ['aerospace'] },
      { pattern: /defense/i, keywords: ['defense'] },
      { pattern: /cyber/i, keywords: ['cybersecurity', 'cyber'] },
    ];

    for (const { pattern, keywords: relatedKeywords } of industryPatterns) {
      if (pattern.test(nameLower)) {
        keywords.push(...relatedKeywords);
      }
    }

    // Remove duplicates
    return [...new Set(keywords)];
  }

  /**
   * Check for industry match with past wins
   */
  private async checkIndustryMatch(industry: string): Promise<Connection | null> {
    try {
      const deals = await this.hubspot.searchClosedWonDeals({ practice: industry, limit: 5 });

      if (deals.length > 0) {
        return {
          type: 'industry_match',
          strength: 'weak',
          via: industry,
          evidence: `${deals.length} closed-won deal(s) in ${industry} industry`,
          score: SCORING_WEIGHTS.connection.industry_match,
        };
      }
    } catch (e) {
      console.warn(`Failed to check industry match for ${industry}:`, e);
    }

    return null;
  }

  /**
   * Prioritize and score contacts for outreach
   */
  private async prioritizeContacts(
    context: OpportunityContext,
    connections: Connection[]
  ): Promise<ContactRecommendation[]> {
    const recommendations: ContactRecommendation[] = [];

    // Get the strongest PE connection if any
    const peConnection = connections.find(c => c.type === 'pe_relationship');

    // Score each PE contact from the signal
    for (const peContact of context.peContacts) {
      const roleScore = this.getRoleScore(peContact.title);
      const connectionScore = peConnection ? peConnection.score : 0;

      // Determine approach based on connections
      const approach = this.determineApproach(peContact, connections);

      // Calculate total score
      const totalScore = Math.min(100, roleScore + connectionScore);

      recommendations.push({
        contact: {
          name: peContact.name,
          title: peContact.title,
          organization: peContact.organization,
          email: peContact.email,
          linkedIn: peContact.linkedIn,
        },
        priority: totalScore >= 60 ? 1 : totalScore >= 40 ? 2 : 3,
        score: totalScore,
        approach,
        channel: peContact.linkedIn ? 'linkedin' : 'email',
        justification: this.generateContactJustification(peContact, connections),
      });
    }

    // Sort by score descending
    recommendations.sort((a, b) => b.score - a.score);

    // Assign priority based on ranking
    recommendations.forEach((r, i) => {
      r.priority = (i < 2 ? 1 : i < 5 ? 2 : 3) as 1 | 2 | 3;
    });

    return recommendations;
  }

  /**
   * Get score for a role/title
   */
  private getRoleScore(title: string): number {
    const titleLower = title.toLowerCase();

    if (titleLower.includes('managing partner')) return SCORING_WEIGHTS.role.managing_partner;
    if (titleLower.includes('operating partner')) return SCORING_WEIGHTS.role.operating_partner;
    if (titleLower.includes('senior partner')) return SCORING_WEIGHTS.role.senior_partner;
    if (titleLower.includes('partner')) return SCORING_WEIGHTS.role.partner;
    if (titleLower.includes('principal')) return SCORING_WEIGHTS.role.principal;
    if (titleLower.includes('managing director')) return SCORING_WEIGHTS.role.managing_director;
    if (titleLower.includes('vice president') || titleLower.includes('vp')) return SCORING_WEIGHTS.role.vice_president;
    if (titleLower.includes('director')) return SCORING_WEIGHTS.role.director;
    if (titleLower.includes('ceo') || titleLower.includes('chief executive')) return SCORING_WEIGHTS.role.ceo;
    if (titleLower.includes('cfo') || titleLower.includes('chief financial')) return SCORING_WEIGHTS.role.cfo;
    if (titleLower.includes('cto') || titleLower.includes('chief technology')) return SCORING_WEIGHTS.role.cto;
    if (titleLower.includes('cio') || titleLower.includes('chief information')) return SCORING_WEIGHTS.role.cio;
    if (titleLower.includes('ciso') || titleLower.includes('chief information security')) return SCORING_WEIGHTS.role.ciso;

    return SCORING_WEIGHTS.role.default;
  }

  /**
   * Determine the best approach for a contact
   */
  private determineApproach(contact: PEContact, connections: Connection[]): ApproachType {
    // PE intro if we have PE relationship
    const peConnection = connections.find(c => c.type === 'pe_relationship');
    if (peConnection && contact.organization.includes(peConnection.via)) {
      return 'pe_intro';
    }

    // Partner referral if we have partner experience
    const partnerConnection = connections.find(c => c.type === 'partner_experience');
    if (partnerConnection) {
      return 'partner_referral';
    }

    // Warm intro if we have past client, similar deal, or partner experience
    const warmConnection = connections.find(c =>
      c.type === 'past_client' || c.type === 'similar_deal' || c.type === 'partner_experience'
    );
    if (warmConnection) {
      return 'warm_intro';
    }

    // Default to direct outreach
    return 'direct_outreach';
  }

  /**
   * Generate justification for contacting someone
   */
  private generateContactJustification(contact: PEContact, connections: Connection[]): string {
    const peConnection = connections.find(c => c.type === 'pe_relationship');

    if (peConnection) {
      return `${contact.name} is at ${contact.organization}. We have ${peConnection.evidence}.`;
    }

    const pastClient = connections.find(c => c.type === 'past_client');
    if (pastClient) {
      return `${contact.name} - We have prior relationship: ${pastClient.evidence}.`;
    }

    return `${contact.name} (${contact.title}) at ${contact.organization} - key decision maker.`;
  }

  /**
   * Calculate overall success probability
   */
  private calculateOverallScore(
    connections: Connection[],
    contacts: ContactRecommendation[]
  ): number {
    // Base score from connections
    const connectionScore = connections.reduce((sum, c) => sum + c.score, 0);

    // Top contact score
    const topContactScore = contacts.length > 0 ? contacts[0].score : 0;

    // Weighted combination
    const overall = Math.min(100, (connectionScore * 0.6) + (topContactScore * 0.4));

    return Math.round(overall);
  }

  /**
   * Generate human-readable summary with HTML format for HubSpot
   * Note: Partner matching (which partners to recommend) is handled by Piper
   */
  private generateSummary(
    context: OpportunityContext,
    connections: Connection[],
    contacts: ContactRecommendation[],
    similarDeals: SimilarDeal[],
    companyContacts: CompanyContact[] = [],
    industryDeals: IndustryDeal[] = []
  ): string {
    const parts: string[] = [];
    const role = context.functionalRole || context.jobTitle;

    // Header
    parts.push(`<h2>${role.toUpperCase()} OPPORTUNITY: ${context.company.name.toUpperCase()}</h2>`);

    // Company info
    const industryPart = context.company.industry || 'Unknown industry';
    const pePart = context.peFirms.length > 0
      ? `PE-backed (${context.peFirms.join(', ')})`
      : context.company.ownership || 'Unknown ownership';
    parts.push(`<p><strong>Company:</strong> ${industryPart} | ${pePart}</p>`);

    // Engagement type
    const engagementLabels: Record<EngagementType, string> = {
      interim: 'Interim',
      fractional: 'Fractional',
      interim_to_perm: 'Interim-to-Perm',
      project: 'Project-Based',
    };
    parts.push(`<p><strong>Engagement Type:</strong> Likely ${engagementLabels[context.engagementType || 'project']}</p>`);

    // WHY WE CAN WIN section
    parts.push('<h3>WHY WE CAN WIN</h3>');
    parts.push('<ul>');

    // PE Portfolio Match
    const peConnection = connections.find(c => c.type === 'pe_relationship');
    if (peConnection && context.peFirms.length > 0) {
      parts.push(`<li><strong>PE Portfolio Match:</strong> ${peConnection.evidence}</li>`);
    }

    // Similar Wins
    if (similarDeals.length > 0) {
      const practice = this.mapRoleToPractice(role) || role;
      parts.push(`<li><strong>Similar Wins:</strong> ${similarDeals.length} ${practice} placements in past 12mo</li>`);
    }

    // Past client
    const pastClientConnection = connections.find(c => c.type === 'past_client');
    if (pastClientConnection) {
      parts.push(`<li><strong>Past Client:</strong> ${pastClientConnection.evidence}</li>`);
    }

    // Partner experience
    const partnerExpConnection = connections.find(c => c.type === 'partner_experience');
    if (partnerExpConnection) {
      parts.push(`<li><strong>Partner Experience:</strong> ${partnerExpConnection.evidence}</li>`);
    }

    // If no connections, note cold outreach
    if (connections.length === 0) {
      parts.push('<li><em>No existing connections - cold outreach required</em></li>');
    }

    parts.push('</ul>');

    // PE CONTACTS TO APPROACH section
    if (contacts.length > 0) {
      parts.push('<h3>PE CONTACTS TO APPROACH</h3>');
      parts.push('<ol>');
      for (const rec of contacts.slice(0, 3)) {
        const c = rec.contact;
        parts.push(`<li><strong>${c.name}</strong> (${c.title} @ ${c.organization})<br/>`);
        parts.push(`<em>Approach:</em> ${this.formatApproach(rec.approach)}</li>`);
      }
      parts.push('</ol>');
    }

    // COMPANY CONTACTS section (existing contacts at the target company)
    if (companyContacts.length > 0) {
      parts.push('<h3>COMPANY CONTACTS</h3>');
      parts.push('<ol>');
      for (const contact of companyContacts.slice(0, 5)) {
        const titlePart = contact.title ? ` - ${contact.title}` : '';
        const emailPart = contact.email ? ` (${contact.email})` : '';
        parts.push(`<li><strong>${contact.name}</strong>${titlePart}${emailPart}</li>`);
      }
      parts.push('</ol>');
    }

    // RELATED INDUSTRY EXPERIENCE section (past deals in similar industry)
    if (industryDeals.length > 0) {
      parts.push('<h3>RELATED INDUSTRY EXPERIENCE</h3>');
      parts.push('<p><em>Past closed-won deals in related industries:</em></p>');
      parts.push('<ul>');
      for (const deal of industryDeals.slice(0, 5)) {
        const practicePart = deal.practice ? ` (${deal.practice})` : '';
        const peFirmPart = deal.peFirm ? ` - PE: ${deal.peFirm}` : '';
        parts.push(`<li><strong>${deal.dealName}</strong>${practicePart}${peFirmPart}`);

        // Show contacts on this deal (key for Julian Sparkes use case)
        if (deal.contacts && deal.contacts.length > 0) {
          const contactList = deal.contacts
            .slice(0, 3)
            .map(c => {
              const titlePart = c.title ? ` (${c.title})` : '';
              return `${c.name}${titlePart}`;
            })
            .join(', ');
          parts.push(`<br/><em>Key contacts: ${contactList}</em>`);
        }
        parts.push('</li>');
      }
      parts.push('</ul>');
    }

    // ROCK SOLID OFFER section
    parts.push('<h3>ROCK SOLID OFFER</h3>');
    const offer = this.generateRockSolidOffer(context, connections, similarDeals);
    parts.push(`<blockquote>"${offer}"</blockquote>`);

    // Footer
    parts.push('<hr/>');
    parts.push(`<p><em>Generated by Lead5 Scout | ${new Date().toLocaleDateString()}</em></p>`);

    return parts.join('\n');
  }

  /**
   * Generate a compelling "rock solid offer" for the MP to use
   */
  private generateRockSolidOffer(
    context: OpportunityContext,
    connections: Connection[],
    similarDeals: SimilarDeal[]
  ): string {
    const role = context.functionalRole || context.jobTitle;
    const company = context.company.name;

    // Build the offer based on our strongest assets
    const parts: string[] = [];

    // Start with the need
    parts.push(`We understand ${company} is looking for ${role} leadership.`);

    // Add our strongest proof point
    const peConnection = connections.find(c => c.type === 'pe_relationship');
    if (peConnection && context.peFirms.length > 0) {
      parts.push(`We've successfully placed executives at multiple ${context.peFirms[0]} portfolio companies.`);
    } else if (similarDeals.length > 0) {
      const practice = this.mapRoleToPractice(role) || role;
      parts.push(`We've completed ${similarDeals.length} similar ${practice} placements in the past year.`);
    }

    // Generic availability statement (Piper handles specific partner matching)
    parts.push(`We have experienced ${role}s in our network ready to engage.`);

    // Close with engagement type framing
    const engagementType = context.engagementType || 'interim';
    if (engagementType === 'interim_to_perm') {
      parts.push('Our interim-to-perm model lets you evaluate fit before committing.');
    } else if (engagementType === 'fractional') {
      parts.push('Our fractional model provides senior leadership at a fraction of full-time cost.');
    }

    return parts.join(' ');
  }

  /**
   * Format connection type for display
   */
  private formatConnectionType(type: ConnectionType): string {
    const labels: Record<ConnectionType, string> = {
      pe_relationship: 'PE Portfolio Match',
      past_client: 'Past Client',
      partner_experience: 'Partner Experience',
      similar_deal: 'Similar Deal',
      pe_portfolio: 'PE Portfolio Company',
      industry_match: 'Industry Match',
      functional_match: 'Functional Fit',
    };
    return labels[type] || type;
  }

  /**
   * Format approach type for display
   */
  private formatApproach(approach: ApproachType): string {
    const labels: Record<ApproachType, string> = {
      pe_intro: 'PE Introduction',
      partner_referral: 'Partner Referral',
      warm_intro: 'Warm Introduction',
      direct_outreach: 'Direct Outreach',
    };
    return labels[approach] || approach;
  }

  /**
   * Generate personalized conversation openers using Claude
   */
  private async generateConversationOpeners(
    context: OpportunityContext,
    connections: Connection[],
    contacts: ContactRecommendation[]
  ): Promise<void> {
    if (!this.anthropic) return;

    // Only generate for top 3 contacts
    const topContacts = contacts.slice(0, 3);

    for (const contact of topContacts) {
      try {
        const opener = await this.generateOpener(context, connections, contact);
        contact.conversationOpener = opener;
      } catch (e) {
        console.warn(`Failed to generate opener for ${contact.contact.name}:`, e);
      }
    }
  }

  /**
   * Generate a single conversation opener
   */
  private async generateOpener(
    context: OpportunityContext,
    connections: Connection[],
    contact: ContactRecommendation
  ): Promise<string> {
    if (!this.anthropic) return '';

    const prompt = `You are helping a business development representative craft a personalized LinkedIn message opener.

Target Contact:
- Name: ${contact.contact.name}
- Title: ${contact.contact.title}
- Organization: ${contact.contact.organization}

Opportunity Context:
- Company: ${context.company.name}
- Position: ${context.jobTitle}
- Metro: ${context.company.metro}

Our Connections:
${connections.map(c => `- ${c.type}: ${c.evidence}`).join('\n')}

Recommended Approach: ${contact.approach}

Write a brief (2-3 sentence), personalized LinkedIn message opener that:
1. References a specific connection or mutual interest
2. Is professional but warm
3. Hints at value we can provide
4. Ends with a soft ask or question

Do NOT use generic templates. Make it specific to this contact and our connections.`;

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type === 'text') {
      return content.text.trim();
    }

    return '';
  }
}

// Singleton instance
let recommendationEngine: RecommendationEngine | null = null;

export function getRecommendationEngine(): RecommendationEngine {
  if (!recommendationEngine) {
    recommendationEngine = new RecommendationEngine();
  }
  return recommendationEngine;
}
