import type { Signal } from '@prisma/client';
import type { OpportunityContext, PEContact } from './types.js';

/**
 * Signal payload structure from Lead5 scout and other sources.
 * Fields may be named differently depending on the source.
 */
interface SignalPayload {
  companyName?: string;
  company?: string;
  jobTitle?: string;
  metro?: string;
  peContacts?: Array<{ name: string; title: string; organization: string }>;
  contacts?: Array<{ name: string; title: string }>;
  postedDate?: string;
  sourceUrl?: string;
  url?: string;
  companyMetadata?: {
    industry?: string;
    ownership?: string;
  };
}

/**
 * Converts a Signal into an OpportunityContext for the recommendation engine.
 *
 * Extracts relevant fields from signal.rawPayload, handling multiple field name
 * variations (e.g., companyName vs company) and missing/null data gracefully.
 *
 * @param signal - The Signal record from the database
 * @returns OpportunityContext ready for the recommendation engine
 * @throws Error if signal has no rawPayload
 */
export function buildOpportunityContext(signal: Signal): OpportunityContext {
  const payload = signal.rawPayload as SignalPayload | null;

  if (!payload) {
    throw new Error('Signal has no rawPayload');
  }

  // Extract company name with fallback to 'company' field
  const companyName = payload.companyName || payload.company || 'Unknown Company';

  // Extract PE contacts array, defaulting to empty array if missing
  const peContacts: PEContact[] = (payload.peContacts || []).map((c) => ({
    name: c.name,
    title: c.title,
    organization: c.organization,
  }));

  // Derive unique PE firms from PE contacts' organizations
  const peFirms = [
    ...new Set(
      peContacts
        .map((c) => c.organization)
        .filter((org): org is string => Boolean(org))
    ),
  ];

  // Extract metro, defaulting to empty string
  const metro = payload.metro || '';

  // Extract source URL with multiple fallbacks
  const sourceUrl = payload.sourceUrl || payload.url || signal.sourceUrl || '';

  // Extract posted date with fallback to signal creation date
  const postedDate =
    payload.postedDate || signal.createdAt.toISOString().split('T')[0];

  // Extract job title with fallback to signal summary
  const jobTitle = payload.jobTitle || signal.summary || 'Unknown Position';

  // Extract company metadata if available
  const industry = payload.companyMetadata?.industry;
  const ownership = payload.companyMetadata?.ownership;

  return {
    signalId: signal.id,
    company: {
      name: companyName,
      metro,
      ...(industry && { industry }),
      ...(ownership && { ownership }),
    },
    jobTitle,
    peContacts,
    peFirms,
    sourceUrl,
    postedDate,
  };
}
