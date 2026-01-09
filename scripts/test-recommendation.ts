/**
 * Test the recommendation engine with a single signal
 * Run: npx tsx scripts/test-recommendation.ts
 */

import 'dotenv/config';
import { getRecommendationEngine } from '../backend/src/services/recommendation-engine.js';
import { OpportunityContext } from '../backend/src/services/types.js';

const OUTBOUND_API_URL = process.env.OUTBOUND_API_URL || 'http://localhost:8004';

async function main() {
  console.log('=== Testing Recommendation Engine ===\n');

  // Fetch a signal with PE contacts
  const response = await fetch(`${OUTBOUND_API_URL}/api/v1/signals?limit=50`);
  const data = await response.json();

  const signalWithPE = data.data.find(
    (s: any) => s.rawPayload?.peContacts?.length > 0
  );

  if (!signalWithPE) {
    console.log('No signals with PE contacts found');
    return;
  }

  console.log(`Testing with signal: ${signalWithPE.id}`);
  console.log(`Company: ${signalWithPE.rawPayload.companyName}`);
  console.log(`Job Title: ${signalWithPE.rawPayload.jobTitle}`);
  console.log(`PE Contacts: ${signalWithPE.rawPayload.peContacts?.length || 0}`);
  console.log('');

  // Build context
  const context: OpportunityContext = {
    signalId: signalWithPE.id,
    company: {
      name: signalWithPE.rawPayload.companyName,
      metro: signalWithPE.rawPayload.metro,
    },
    jobTitle: signalWithPE.rawPayload.jobTitle,
    peContacts: signalWithPE.rawPayload.peContacts || [],
    peFirms: [...new Set(signalWithPE.rawPayload.peContacts?.map((c: any) => c.organization).filter(Boolean) || [])],
    sourceUrl: signalWithPE.rawPayload.url || '',
    postedDate: signalWithPE.rawPayload.postedDate || new Date().toISOString(),
  };

  console.log(`PE Firms identified: ${context.peFirms.join(', ') || '(none)'}\n`);

  // Generate recommendation
  console.log('Generating recommendation...\n');

  try {
    const engine = getRecommendationEngine();
    const recommendation = await engine.generateRecommendation(context);

    console.log('=== RECOMMENDATION RESULTS ===\n');
    console.log(`Overall Score: ${recommendation.overallScore}/100`);
    console.log(`Connections Found: ${recommendation.connections.length}`);

    if (recommendation.connections.length > 0) {
      console.log('\nConnections:');
      for (const conn of recommendation.connections) {
        console.log(`  - ${conn.type} (${conn.strength}): ${conn.evidence}`);
      }
    }

    console.log(`\nPrioritized Contacts: ${recommendation.contactRecommendations.length}`);

    if (recommendation.contactRecommendations.length > 0) {
      console.log('\nTop Contacts:');
      for (const contact of recommendation.contactRecommendations.slice(0, 3)) {
        console.log(`  ${contact.priority}. ${contact.contact.name} - ${contact.contact.title}`);
        console.log(`     Org: ${contact.contact.organization}`);
        console.log(`     Approach: ${contact.approach}`);
        console.log(`     Score: ${contact.score}/100`);
        if (contact.conversationOpener) {
          console.log(`     Opener: "${contact.conversationOpener.substring(0, 100)}..."`);
        }
        console.log('');
      }
    }

    console.log('\n=== SUMMARY ===');
    console.log(recommendation.summary);

  } catch (error) {
    console.error('Recommendation failed:', error);
  }
}

main().catch(console.error);
