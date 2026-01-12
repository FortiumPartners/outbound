import { prisma } from '../lib/prisma.js';
import { getRecommendationEngine } from './recommendation-engine.js';
import { buildOpportunityContext } from './signal-enrichment.js';
import type { Prisma } from '@prisma/client';

/**
 * Enriches a signal with recommendation data.
 * Called asynchronously after signal creation.
 *
 * This worker:
 * 1. Fetches the signal by ID
 * 2. Validates it's still in 'pending' status (skip if already processed)
 * 3. Builds an OpportunityContext from the signal payload
 * 4. Generates a strategic recommendation using the recommendation engine
 * 5. Updates the signal with status='ready' and stores the recommendation
 *
 * Errors are logged but not thrown - the signal remains in 'pending' status
 * for manual retry if enrichment fails.
 */
export async function enrichSignal(signalId: string): Promise<void> {
  try {
    const signal = await prisma.signal.findUnique({ where: { id: signalId } });
    if (!signal) {
      console.error(`[enrichment-worker] Signal ${signalId} not found for enrichment`);
      return;
    }

    if (signal.status !== 'pending') {
      console.log(`[enrichment-worker] Signal ${signalId} already processed (status: ${signal.status})`);
      return;
    }

    console.log(`[enrichment-worker] Starting enrichment for signal ${signalId}...`);

    const engine = getRecommendationEngine();
    const context = buildOpportunityContext(signal);
    const recommendation = await engine.generateRecommendation(context);

    // Convert recommendation to a plain JSON-serializable object
    // The StrategicRecommendation has Date objects that need serialization
    const recommendationJson = JSON.parse(
      JSON.stringify(recommendation)
    ) as Prisma.InputJsonValue;

    await prisma.signal.update({
      where: { id: signalId },
      data: {
        status: 'ready',
        recommendation: recommendationJson,
      },
    });

    console.log(`[enrichment-worker] Signal ${signalId} enriched successfully`);
  } catch (error) {
    console.error(`[enrichment-worker] Enrichment failed for signal ${signalId}:`, error);
    // Leave as pending - can retry later
  }
}
