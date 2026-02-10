import { z } from 'zod';

export const signalStatusEnum = z.enum(['pending', 'ready', 'pushed', 'push_failed', 'archived']);
export type SignalStatus = z.infer<typeof signalStatusEnum>;

export const archiveReasonEnum = z.enum([
  'not_relevant',
  'already_have_relationship',
  'company_too_small',
  'not_pe_backed',
  'other'
]);
export type ArchiveReason = z.infer<typeof archiveReasonEnum>;

export const signalTypeEnum = z.enum([
  'job_posting',
  'job_change',
  'funding',
  'news',
  'social_activity',
  'intent',
  'company_news',
  'product_launch',
  'leadership_change',
  'acquisition',
  'expansion',
  'executive_move',
  'scout_status',
  'other',
]);

export const severityEnum = z.enum(['low', 'medium', 'high', 'critical']);

export const createSignalSchema = z.object({
  accountId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  type: signalTypeEnum,
  severity: severityEnum.default('medium'),
  confidence: z.number().min(0).max(1).default(0.5),
  source: z.string().min(1),
  sourceId: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  rawPayload: z.record(z.unknown()).optional(),
  summary: z.string().optional(),
});

export const updateSignalSchema = createSignalSchema.partial();

export const signalResponseSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().nullable(),
  contactId: z.string().nullable(),
  type: z.string(),
  severity: z.string(),
  confidence: z.number(),
  source: z.string(),
  sourceId: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  rawPayload: z.unknown().nullable(),
  summary: z.string().nullable(),
  processedAt: z.string().datetime().nullable(),
  hypothesisCount: z.number(),
  // Staged workflow fields
  status: signalStatusEnum,
  recommendation: z.unknown().nullable(),
  // HubSpot sync tracking
  hubspotDealId: z.string().nullable(),
  hubspotCompanyIds: z.array(z.string()).nullable(),
  hubspotContactIds: z.array(z.string()).nullable(),
  pushedAt: z.string().datetime().nullable(),
  pushError: z.string().nullable(),
  // Archive tracking
  archivedAt: z.string().datetime().nullable(),
  archiveReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CreateSignal = z.infer<typeof createSignalSchema>;
export type UpdateSignal = z.infer<typeof updateSignalSchema>;
export type SignalResponse = z.infer<typeof signalResponseSchema>;
