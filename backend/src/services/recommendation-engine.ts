/**
 * Strategic Recommendation Engine
 *
 * Analyzes opportunities and generates strategic recommendations
 * for the best path to getting conversations with decision-makers.
 *
 * Uses:
 * - HubSpot: PE relationships, closed-won deals, company history
 * - PartnerConnect: Partner availability, work experience
 * - Claude AI: Personalized conversation openers
 */

import Anthropic from '@anthropic-ai/sdk';
import { getHubSpotClient } from './hubspot-client.js';
import { getPartnerConnectClient } from './partnerconnect-client.js';
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
  SCORING_WEIGHTS,
} from './types.js';

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

    // Step 1: Discover connections
    const connections = await this.discoverConnections(context);

    // Step 2: Score and prioritize contacts
    const contactRecommendations = await this.prioritizeContacts(context, connections);

    // Step 3: Calculate overall score
    const overallScore = this.calculateOverallScore(connections, contactRecommendations);

    // Step 4: Generate summary
    const summary = this.generateSummary(context, connections, contactRecommendations);

    // Step 5: Generate Claude conversation openers for top contacts
    if (this.anthropic && contactRecommendations.length > 0) {
      await this.generateConversationOpeners(context, connections, contactRecommendations);
    }

    return {
      opportunityId: context.signalId,
      companyName: context.company.name,
      jobTitle: context.jobTitle,
      connections,
      overallScore,
      contactRecommendations,
      summary,
      generatedAt: new Date(),
      generationMethod: 'strategic_analysis',
    };
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

    // 4. Check for industry matches
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
      // Check if company is in PartnerConnect as a client
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

      // NOTE: Metro/location match removed - Fortium prioritizes ability/experience, not location
    } catch (e) {
      console.warn('Failed to check PartnerConnect:', e);
    }

    return connections;
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
   * Generate human-readable summary
   */
  private generateSummary(
    context: OpportunityContext,
    connections: Connection[],
    contacts: ContactRecommendation[]
  ): string {
    const lines: string[] = [];
    const overallScore = this.calculateOverallScore(connections, contacts);

    // Header with key info
    lines.push(`🎯 STRATEGIC PATH TO ${context.company.name.toUpperCase()}`);
    lines.push(`Position: ${context.jobTitle} | Metro: ${context.company.metro || 'Unknown'}`);
    lines.push(`Overall Score: ${overallScore}/100`);
    lines.push('─'.repeat(50));
    lines.push('');

    // Quick summary
    const strongConnections = connections.filter(c => c.strength === 'strong');
    if (strongConnections.length > 0) {
      lines.push(`✅ STRONG POSITION: We have ${strongConnections.length} strong connection(s) to this opportunity.`);
    } else if (connections.length > 0) {
      lines.push(`⚡ MODERATE POSITION: We have ${connections.length} connection(s) but no direct relationship.`);
    } else {
      lines.push(`⚠️ COLD OUTREACH: No existing connections found. Consider territory-based approach.`);
    }
    lines.push('');

    // PE Firms section
    if (context.peFirms.length > 0) {
      lines.push('📊 PE INVESTORS');
      lines.push(`   ${context.peFirms.join(', ')}`);
      lines.push('');
    }

    // Connections with context
    if (connections.length > 0) {
      lines.push('🔗 CONNECTIONS');
      for (const conn of connections.slice(0, 4)) {
        const icon = conn.strength === 'strong' ? '●' : conn.strength === 'medium' ? '◐' : '○';
        const typeLabel = this.formatConnectionType(conn.type);
        lines.push(`   ${icon} ${typeLabel}: ${conn.evidence}`);
      }
      lines.push('');
    }

    // Recommended contacts with actionable info
    if (contacts.length > 0) {
      lines.push('👥 RECOMMENDED CONTACTS');
      lines.push('');
      for (const rec of contacts.slice(0, 3)) {
        const c = rec.contact;
        lines.push(`   [${rec.priority}] ${c.name}`);
        lines.push(`       ${c.title} @ ${c.organization || 'PE Firm'}`);
        lines.push(`       Approach: ${this.formatApproach(rec.approach)} via ${rec.channel}`);
        if (rec.conversationOpener) {
          // Show full opener, wrapped if needed
          lines.push(`       Message: "${rec.conversationOpener}"`);
        }
        lines.push('');
      }
    }

    // Next steps
    lines.push('📝 NEXT STEPS');
    if (contacts.length > 0 && contacts[0].approach === 'pe_intro') {
      lines.push(`   1. Research ${contacts[0].contact.organization} recent activity`);
      lines.push(`   2. Connect with ${contacts[0].contact.name} on LinkedIn`);
      lines.push(`   3. Reference our PE portfolio experience in opener`);
    } else if (contacts.length > 0) {
      lines.push(`   1. Connect with ${contacts[0].contact.name} on LinkedIn`);
      lines.push(`   2. Send personalized message using opener above`);
      lines.push(`   3. Follow up in 3-5 business days if no response`);
    } else {
      lines.push('   1. Research company leadership on LinkedIn');
      lines.push('   2. Identify warm intro paths via team network');
      lines.push('   3. Consider territory-based direct outreach');
    }
    lines.push('');

    // Footer
    lines.push('─'.repeat(50));
    lines.push(`Generated by Lead5 Scout | ${new Date().toLocaleDateString()}`);

    return lines.join('\n');
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
      metro_match: 'Metro Match',
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
