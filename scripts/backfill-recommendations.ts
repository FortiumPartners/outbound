/**
 * Backfill strategic recommendations for existing HubSpot deals
 *
 * Finds deals created by Lead5 Scout that don't have recommendations yet,
 * matches them to signals, and generates recommendations.
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

interface PEContact {
  name: string;
  title: string;
  organization: string;
  email?: string;
  linkedIn?: string;
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

async function fetchSignals(): Promise<Signal[]> {
  const response = await fetch(`${OUTBOUND_API_URL}/api/v1/signals?limit=100`);
  if (!response.ok) {
    throw new Error(`Failed to fetch signals: ${response.status}`);
  }
  const data = await response.json();
  return data.data || [];
}

async function fetchHypotheses(): Promise<Hypothesis[]> {
  const response = await fetch(`${OUTBOUND_API_URL}/api/v1/hypotheses?limit=100`);
  if (!response.ok) {
    throw new Error(`Failed to fetch hypotheses: ${response.status}`);
  }
  const data = await response.json();
  return data.data || [];
}

async function fetchLead5Deals(): Promise<HubSpotDeal[]> {
  // Search for deals created by Lead5 Scout
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
  // Deal names are "Company Name - Job Title"
  const parts = dealName.split(' - ');
  return parts[0].trim();
}

function findSignalForDeal(deal: HubSpotDeal, signals: Signal[]): Signal | null {
  const companyName = extractCompanyName(deal.properties.dealname);

  // Find matching signal by company name
  for (const signal of signals) {
    if (signal.rawPayload?.companyName?.toLowerCase() === companyName.toLowerCase()) {
      return signal;
    }
  }

  // Try partial match
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

  // Build opportunity context from signal
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
    console.log(`    👥 Contacts: ${recommendation.contactRecommendations.length}`);

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
        console.log(`    📝 Posted note: ${note.id}`);
      } catch (noteError) {
        console.warn(`    ⚠️  Failed to create note:`, noteError);
      }
    }

    // Store recommendation in Outbound via API (as a hypothesis)
    try {
      await storeRecommendationAsHypothesis(signal.id, dealId, recommendation);
    } catch (storeError) {
      console.warn(`    ⚠️  Failed to store hypothesis:`, storeError);
    }

    return recommendation;
  } catch (error) {
    console.error(`    ❌ Failed:`, error);
    return null;
  }
}

async function storeRecommendationAsHypothesis(
  signalId: string,
  dealId: string,
  recommendation: StrategicRecommendation
): Promise<void> {
  const topContact = recommendation.contactRecommendations[0];

  const hypothesis = {
    signalId,
    title: `Strategic path to ${recommendation.companyName}`,
    summary: recommendation.summary.substring(0, 500),
    conversationOpener: topContact?.conversationOpener,
    score: recommendation.overallScore,
    generationMethod: 'strategic_analysis',
    channel: topContact?.channel || 'linkedin',
    status: 'pending_review',
    hubspotDealId: dealId,
    hubspotNoteId: recommendation.hubspotNoteId,
    connections: recommendation.connections,
    contactRecommendations: recommendation.contactRecommendations,
    recommendationSummary: recommendation.summary,
  };

  const response = await fetch(`${OUTBOUND_API_URL}/api/v1/hypotheses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(hypothesis),
  });

  if (!response.ok) {
    throw new Error(`Failed to store hypothesis: ${response.status}`);
  }

  console.log(`    💡 Stored hypothesis`);
}

async function main() {
  console.log('=== Backfilling Recommendations for Existing Deals ===');
  console.log(`Outbound API: ${OUTBOUND_API_URL}`);
  console.log(`Dry Run: ${DRY_RUN}`);
  console.log(`Max Results: ${MAX_RESULTS}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  // Fetch all data
  console.log('Fetching data...');
  const [signals, hypotheses, deals] = await Promise.all([
    fetchSignals(),
    fetchHypotheses(),
    fetchLead5Deals(),
  ]);

  console.log(`  Signals: ${signals.length}`);
  console.log(`  Hypotheses: ${hypotheses.length}`);
  console.log(`  Lead5 Deals: ${deals.length}\n`);

  // Find deals that already have hypotheses (by hubspotDealId)
  const dealsWithHypotheses = new Set(
    hypotheses
      .filter(h => h.hubspotDealId)
      .map(h => h.hubspotDealId)
  );

  console.log(`Deals with existing recommendations: ${dealsWithHypotheses.size}`);

  // Find deals needing recommendations
  const dealsNeedingRecs = deals.filter(d => !dealsWithHypotheses.has(d.id));
  console.log(`Deals needing recommendations: ${dealsNeedingRecs.length}\n`);

  if (dealsNeedingRecs.length === 0) {
    console.log('All deals have recommendations!');
    return;
  }

  // Process deals (up to MAX_RESULTS)
  const toProcess = dealsNeedingRecs.slice(0, MAX_RESULTS);
  console.log(`Processing ${toProcess.length} deals...\n`);

  let processed = 0;
  let matched = 0;
  let generated = 0;
  let failed = 0;

  for (const deal of toProcess) {
    const companyName = extractCompanyName(deal.properties.dealname);
    console.log(`[${processed + 1}/${toProcess.length}] ${companyName}`);
    console.log(`  Deal: ${deal.id} - ${deal.properties.dealname}`);

    // Find matching signal
    const signal = findSignalForDeal(deal, signals);
    if (!signal) {
      console.log(`  ⚠️  No matching signal found`);
      processed++;
      continue;
    }

    matched++;
    console.log(`  ✓ Matched signal: ${signal.id}`);
    console.log(`  PE Contacts: ${signal.rawPayload.peContacts?.length || 0}`);

    // Generate recommendation
    console.log(`  🎯 Generating recommendation...`);
    const recommendation = await generateAndPostRecommendation(signal, deal.id);

    if (recommendation) {
      generated++;
    } else {
      failed++;
    }

    processed++;
    console.log('');

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('=== Backfill Complete ===');
  console.log(`Processed: ${processed}`);
  console.log(`Matched to signals: ${matched}`);
  console.log(`Recommendations generated: ${generated}`);
  console.log(`Failed: ${failed}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes were made. Set DRY_RUN=false to apply.');
  }
}

main().catch(console.error);
