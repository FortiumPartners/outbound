/**
 * Sync Outbound signals to HubSpot deals
 *
 * Creates HubSpot deals for unprocessed job_posting signals.
 * Run: npx tsx scripts/sync-to-hubspot.ts
 */

import 'dotenv/config';

const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const OUTBOUND_API_URL = process.env.OUTBOUND_API_URL || 'http://localhost:8004';

if (!HUBSPOT_ACCESS_TOKEN) {
  console.error('HUBSPOT_ACCESS_TOKEN not set');
  process.exit(1);
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
  };
  summary: string;
}

interface HubSpotDeal {
  id: string;
  properties: {
    dealname: string;
    dealstage: string;
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

async function markSignalProcessed(signalId: string): Promise<void> {
  const response = await fetch(`${OUTBOUND_API_URL}/api/v1/signals/${signalId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ processedAt: new Date().toISOString() }),
  });
  if (!response.ok) {
    console.warn(`Failed to mark signal ${signalId} as processed`);
  }
}

async function createHubSpotDeal(signal: Signal): Promise<HubSpotDeal | null> {
  const { companyName, jobTitle, metro, postedDate, description } = signal.rawPayload;

  // Build deal name
  const dealName = `${companyName} - ${jobTitle.replace(/vacancy at .+/i, '').replace(/at .+/i, '').trim()}`;

  // Create deal in HubSpot
  const response = await fetch('https://api.hubapi.com/crm/v3/objects/deals', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        dealname: dealName,
        dealstage: 'appointmentscheduled', // First stage in Sales Pipeline
        pipeline: 'default',
        description: `${description}\n\nSource: Lead5 Scout\nLocation: ${metro}\nPosted: ${postedDate}`,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Failed to create HubSpot deal for ${companyName}:`, error);
    return null;
  }

  return response.json();
}

async function findExistingDeal(companyName: string): Promise<HubSpotDeal | null> {
  // Search for existing deal with similar name
  const response = await fetch('https://api.hubapi.com/crm/v3/objects/deals/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [{
        filters: [{
          propertyName: 'dealname',
          operator: 'CONTAINS_TOKEN',
          value: companyName.split(' ')[0], // First word of company name
        }],
      }],
      properties: ['dealname', 'dealstage'],
      limit: 5,
    }),
  });

  if (!response.ok) return null;

  const data = await response.json();
  const results = data.results || [];

  // Find exact or close match
  for (const deal of results) {
    const dealName = deal.properties?.dealname?.toLowerCase() || '';
    if (dealName.includes(companyName.toLowerCase())) {
      return deal;
    }
  }

  return null;
}

async function main() {
  console.log('=== Syncing Signals to HubSpot ===');
  console.log(`Outbound API: ${OUTBOUND_API_URL}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  // Fetch unprocessed signals
  const signals = await fetchSignals();
  const jobPostings = signals.filter(s => s.type === 'job_posting' && !s.processedAt);

  console.log(`Found ${signals.length} total signals`);
  console.log(`Found ${jobPostings.length} unprocessed job posting signals\n`);

  if (jobPostings.length === 0) {
    console.log('No signals to sync.');
    return;
  }

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const signal of jobPostings) {
    const { companyName, jobTitle } = signal.rawPayload;
    console.log(`Processing: ${companyName} - ${jobTitle}`);

    try {
      // Check for existing deal
      const existing = await findExistingDeal(companyName);
      if (existing) {
        console.log(`  ⏭️  Deal already exists: ${existing.properties.dealname}`);
        await markSignalProcessed(signal.id);
        skipped++;
        continue;
      }

      // Create new deal
      const deal = await createHubSpotDeal(signal);
      if (deal) {
        console.log(`  ✅ Created deal: ${deal.id}`);
        await markSignalProcessed(signal.id);
        created++;
      } else {
        errors++;
      }
    } catch (error) {
      console.error(`  ❌ Error:`, error);
      errors++;
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n=== Sync Complete ===');
  console.log(`Created: ${created}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
}

main().catch(console.error);
