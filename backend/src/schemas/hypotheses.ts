import { z } from 'zod';

export const noveltyTagEnum = z.enum(['high', 'medium', 'low']);
export const complianceRiskEnum = z.enum(['low', 'medium', 'high']);
export const hypothesisStatusEnum = z.enum(['draft', 'pending_review', 'approved', 'rejected', 'executed']);
export const generationMethodEnum = z.enum(['manual', 'ai_generated', 'rule_based']);
export const channelEnum = z.enum(['email', 'linkedin', 'phone', 'in_person', 'other']);

// Extended generation method to include strategic analysis
export const extendedGenerationMethodEnum = z.enum(['manual', 'ai_generated', 'rule_based', 'strategic_analysis']);

export const createHypothesisSchema = z.object({
  signalId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  title: z.string().min(1),
  summary: z.string().optional(),
  conversationOpener: z.string().optional(),
  noveltyTag: noveltyTagEnum.optional(),
  complianceRisk: complianceRiskEnum.default('low'),
  recommendedMessenger: z.string().optional(),
  channel: channelEnum.optional(),
  generationMethod: extendedGenerationMethodEnum.default('manual'),
  generationModelId: z.string().optional(),
  generationPromptHash: z.string().optional(),
  score: z.number().min(0).max(100).optional(), // 0-100 for strategic recommendations
  // Strategic Recommendation fields
  hubspotDealId: z.string().optional(),
  hubspotNoteId: z.string().optional(),
  connections: z.array(z.any()).optional(), // Array of Connection objects
  contactRecommendations: z.array(z.any()).optional(), // Array of ContactRecommendation objects
  recommendationSummary: z.string().optional(),
  status: hypothesisStatusEnum.optional(),
});

export const updateHypothesisSchema = createHypothesisSchema.partial();

export const approveHypothesisSchema = z.object({
  approvedBy: z.string().min(1),
});

export const rejectHypothesisSchema = z.object({
  rejectionReason: z.string().min(1),
});

export const hypothesisResponseSchema = z.object({
  id: z.string().uuid(),
  signalId: z.string().nullable(),
  accountId: z.string().nullable(),
  contactId: z.string().nullable(),
  title: z.string(),
  summary: z.string().nullable(),
  conversationOpener: z.string().nullable(),
  noveltyTag: z.string().nullable(),
  complianceRisk: z.string(),
  recommendedMessenger: z.string().nullable(),
  channel: z.string().nullable(),
  generationMethod: z.string(),
  generationModelId: z.string().nullable(),
  generationPromptHash: z.string().nullable(),
  status: z.string(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().datetime().nullable(),
  rejectionReason: z.string().nullable(),
  score: z.number().nullable(),
  // Strategic Recommendation fields
  hubspotDealId: z.string().nullable(),
  hubspotNoteId: z.string().nullable(),
  connections: z.any().nullable(),
  contactRecommendations: z.any().nullable(),
  recommendationSummary: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CreateHypothesis = z.infer<typeof createHypothesisSchema>;
export type UpdateHypothesis = z.infer<typeof updateHypothesisSchema>;
export type ApproveHypothesis = z.infer<typeof approveHypothesisSchema>;
export type RejectHypothesis = z.infer<typeof rejectHypothesisSchema>;
export type HypothesisResponse = z.infer<typeof hypothesisResponseSchema>;
