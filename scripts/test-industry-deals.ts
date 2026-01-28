/**
 * Test script to verify industry deals (U.S. Anesthesia Partners / Julian Sparkes) appear
 */

import { getRecommendationEngine } from '../backend/src/services/recommendation-engine.js';
import type { OpportunityContext } from '../backend/src/services/types.js';

async function main() {
  const context: OpportunityContext = {
    signalId: '160df6f8-67ed-418f-ac81-b101e3cfda86',
    company: {
      name: 'North American Partners In Anesthesia',
      metro: 'Melville, NY',
    },
    jobTitle: 'Chief Information Officer (CIO)',
    peContacts: [{
      name: 'John Smith',
      title: 'Partner',
      organization: 'Leonard Green & Partners'
    }],
    peFirms: ['Leonard Green & Partners'],
    sourceUrl: 'https://test.com',
    postedDate: '2025-01-01',
  };

  console.log('Testing recommendation for:', context.company.name);
  console.log('Expecting to find: U.S. Anesthesia Partners and Julian Sparkes\n');

  const engine = getRecommendationEngine();
  const rec = await engine.generateRecommendation(context);

  console.log('=== CHECKING FOR INDUSTRY DEALS ===\n');

  // Check if the summary mentions U.S. Anesthesia Partners or Julian Sparkes
  const hasAnesthesia = rec.summary.includes('U.S. Anesthesia') || rec.summary.includes('Anesthesia Partners');
  const hasJulian = rec.summary.includes('Julian') || rec.summary.includes('Sparkes');

  if (hasAnesthesia) {
    console.log('✅ SUCCESS: U.S. Anesthesia Partners found in summary!');
  } else {
    console.log('❌ U.S. Anesthesia Partners NOT found in summary');
  }

  if (hasJulian) {
    console.log('✅ SUCCESS: Julian Sparkes found in summary!');
  } else {
    console.log('❌ Julian Sparkes NOT found in summary');
  }

  // Print relevant section
  const industryMatch = rec.summary.match(/<h3>RELATED INDUSTRY EXPERIENCE<\/h3>[\s\S]*?(?=<h3>|<hr|$)/);
  if (industryMatch) {
    console.log('\n=== RELATED INDUSTRY EXPERIENCE SECTION ===');
    // Strip HTML and clean whitespace for readability
    const cleanText = industryMatch[0]
      .replace(/<br\/?>/g, '\n')
      .replace(/<li>/g, '\n• ')
      .replace(/<\/li>/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    console.log(cleanText);
  } else {
    console.log('\n❌ No RELATED INDUSTRY EXPERIENCE section found in summary');
  }

  // Print summary on success
  if (hasAnesthesia && hasJulian) {
    console.log('\n=== TEST PASSED ===');
  } else {
    console.log('\n=== FULL SUMMARY (for debugging) ===');
    console.log(rec.summary);
  }
}

main().catch(console.error);
