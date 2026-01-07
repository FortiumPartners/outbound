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

// Territory-based owner assignment
// Fallback to Precious Tumolto for triage if territory can't be determined
const OWNER_IDS = {
  stephenLavin: '601003945',    // Midwest
  richardHarris: '10675373',    // Mid-Atlantic/New England/South Atlantic
  gregPascuzzi: '19061677',     // South Central West
  bradWheeler: '18427319',      // West
  helmutOehring: '1154290984',  // Pacific NW/Mountain West
  andrewHalford: '248862339',   // Canada
  katieButtry: '206139696',     // UK/International
  preciousTumolto: '1654341068', // Fallback/Triage
};

// Metro to state mapping (common metros from Lead5)
const METRO_TO_STATE: Record<string, string> = {
  // Midwest (Stephen Lavin)
  'Chicago': 'IL', 'Indianapolis': 'IN', 'Detroit': 'MI', 'Minneapolis': 'MN',
  'Columbus': 'OH', 'Cleveland': 'OH', 'Cincinnati': 'OH', 'Milwaukee': 'WI',
  'St. Louis': 'MO', 'Kansas City': 'MO',
  // Mid-Atlantic/New England/South Atlantic (Richard Harris)
  'New York': 'NY', 'New York City': 'NY', 'NYC': 'NY', 'Boston': 'MA',
  'Philadelphia': 'PA', 'Washington': 'DC', 'Washington D.C.': 'DC', 'DC': 'DC',
  'Baltimore': 'MD', 'Richmond': 'VA', 'Charlotte': 'NC', 'Raleigh': 'NC',
  'Atlanta': 'GA', 'Miami': 'FL', 'Tampa': 'FL', 'Orlando': 'FL', 'Jacksonville': 'FL',
  'Nashville': 'TN', 'Birmingham': 'AL', 'Hartford': 'CT', 'Providence': 'RI',
  // South Central West (Greg Pascuzzi)
  'Dallas': 'TX', 'Houston': 'TX', 'Austin': 'TX', 'San Antonio': 'TX', 'Fort Worth': 'TX',
  'Oklahoma City': 'OK', 'Tulsa': 'OK', 'New Orleans': 'LA', 'Little Rock': 'AR',
  // West (Brad Wheeler)
  'Los Angeles': 'CA', 'San Francisco': 'CA', 'San Diego': 'CA', 'San Jose': 'CA',
  'Phoenix': 'AZ', 'Las Vegas': 'NV', 'Albuquerque': 'NM', 'Honolulu': 'HI',
  // Pacific NW/Mountain West (Helmut Oehring)
  'Seattle': 'WA', 'Portland': 'OR', 'Denver': 'CO', 'Salt Lake City': 'UT',
  'Boise': 'ID', 'Spokane': 'WA',
  // Canada (Andrew Halford)
  'Toronto': 'CA-ON', 'Vancouver': 'CA-BC', 'Montreal': 'CA-QC', 'Calgary': 'CA-AB',
  // UK (Katie Buttry)
  'London': 'UK', 'Manchester': 'UK', 'Edinburgh': 'UK',
};

// State to owner mapping
const STATE_TO_OWNER: Record<string, string> = {
  // Midwest - Stephen Lavin
  'IA': OWNER_IDS.stephenLavin, 'IN': OWNER_IDS.stephenLavin, 'IL': OWNER_IDS.stephenLavin,
  'MO': OWNER_IDS.stephenLavin, 'KY': OWNER_IDS.stephenLavin, 'SD': OWNER_IDS.stephenLavin,
  'OH': OWNER_IDS.stephenLavin, 'MN': OWNER_IDS.stephenLavin, 'ND': OWNER_IDS.stephenLavin,
  'WI': OWNER_IDS.stephenLavin, 'MI': OWNER_IDS.stephenLavin, 'NE': OWNER_IDS.stephenLavin,
  // Mid-Atlantic/New England/South Atlantic - Richard Harris
  'VT': OWNER_IDS.richardHarris, 'NC': OWNER_IDS.richardHarris, 'NY': OWNER_IDS.richardHarris,
  'RI': OWNER_IDS.richardHarris, 'ME': OWNER_IDS.richardHarris, 'TN': OWNER_IDS.richardHarris,
  'FL': OWNER_IDS.richardHarris, 'DE': OWNER_IDS.richardHarris, 'AL': OWNER_IDS.richardHarris,
  'NJ': OWNER_IDS.richardHarris, 'SC': OWNER_IDS.richardHarris, 'PA': OWNER_IDS.richardHarris,
  'WV': OWNER_IDS.richardHarris, 'MS': OWNER_IDS.richardHarris, 'MA': OWNER_IDS.richardHarris,
  'CT': OWNER_IDS.richardHarris, 'NH': OWNER_IDS.richardHarris, 'GA': OWNER_IDS.richardHarris,
  'DC': OWNER_IDS.richardHarris, 'VA': OWNER_IDS.richardHarris, 'MD': OWNER_IDS.richardHarris,
  // South Central West - Greg Pascuzzi
  'TX': OWNER_IDS.gregPascuzzi, 'OK': OWNER_IDS.gregPascuzzi, 'LA': OWNER_IDS.gregPascuzzi,
  'KS': OWNER_IDS.gregPascuzzi, 'AR': OWNER_IDS.gregPascuzzi,
  // West - Brad Wheeler
  'NM': OWNER_IDS.bradWheeler, 'HI': OWNER_IDS.bradWheeler, 'AK': OWNER_IDS.bradWheeler,
  'CA': OWNER_IDS.bradWheeler, 'AZ': OWNER_IDS.bradWheeler, 'NV': OWNER_IDS.bradWheeler,
  // Pacific NW/Mountain West - Helmut Oehring
  'OR': OWNER_IDS.helmutOehring, 'MT': OWNER_IDS.helmutOehring, 'WY': OWNER_IDS.helmutOehring,
  'CO': OWNER_IDS.helmutOehring, 'WA': OWNER_IDS.helmutOehring, 'UT': OWNER_IDS.helmutOehring,
  'ID': OWNER_IDS.helmutOehring,
  // Canada - Andrew Halford
  'CA-ON': OWNER_IDS.andrewHalford, 'CA-BC': OWNER_IDS.andrewHalford,
  'CA-QC': OWNER_IDS.andrewHalford, 'CA-AB': OWNER_IDS.andrewHalford,
  // UK/International - Katie Buttry
  'UK': OWNER_IDS.katieButtry,
};

function getOwnerByMetro(metro: string): string {
  // Try exact match first
  const state = METRO_TO_STATE[metro];
  if (state && STATE_TO_OWNER[state]) {
    return STATE_TO_OWNER[state];
  }

  // Try partial match (metro might include state)
  for (const [metroName, stateCode] of Object.entries(METRO_TO_STATE)) {
    if (metro.toLowerCase().includes(metroName.toLowerCase())) {
      if (STATE_TO_OWNER[stateCode]) {
        return STATE_TO_OWNER[stateCode];
      }
    }
  }

  // Fallback to Precious for triage
  return OWNER_IDS.preciousTumolto;
}

function detectPractice(jobTitle: string): 'CIO' | 'CTO' | 'CISO' | null {
  const title = jobTitle.toLowerCase();
  if (title.includes('ciso') || title.includes('security officer')) return 'CISO';
  if (title.includes('cto') || title.includes('technology officer')) return 'CTO';
  if (title.includes('cio') || title.includes('information officer')) return 'CIO';
  return null;
}

async function createHubSpotDeal(signal: Signal): Promise<HubSpotDeal | null> {
  const { companyName, jobTitle, metro, postedDate, description } = signal.rawPayload;

  // Build deal name - clean up the title
  const cleanTitle = jobTitle
    .replace(/vacancy at .+/i, '')
    .replace(/at .+/i, '')
    .trim();
  const dealName = `${companyName} - ${cleanTitle || 'Executive Opportunity'}`;

  // Detect practice area from job title
  const practice = detectPractice(jobTitle);

  // Get owner by territory (metro -> state -> owner)
  const ownerId = getOwnerByMetro(metro);

  // Create deal in HubSpot with all required fields
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
        dealtype: 'newbusiness',
        hubspot_owner_id: ownerId,
        practice: practice,
        service_category: 'Interim', // Executive vacancies are typically interim
        source: 'BD', // Business Development (Lead5 is a BD tool)
        source_details: 'Lead5 Scout',
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
