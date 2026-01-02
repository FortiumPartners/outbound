import { z } from 'zod';

// Account schemas
export const createAccountSchema = z.object({
  name: z.string().min(1),
  domain: z.string().optional(),
  linkedinUrl: z.string().url().optional(),
  industry: z.string().optional(),
  employeeCount: z.number().int().positive().optional(),
  revenue: z.string().optional(),
  dedupeKey: z.string().optional(),
});

export const updateAccountSchema = createAccountSchema.partial();

export const accountResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  domain: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  industry: z.string().nullable(),
  employeeCount: z.number().nullable(),
  revenue: z.string().nullable(),
  dedupeKey: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// Contact schemas
export const createContactSchema = z.object({
  accountId: z.string().uuid().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional(),
  linkedinUrl: z.string().url().optional(),
  title: z.string().optional(),
  dedupeKey: z.string().optional(),
});

export const updateContactSchema = createContactSchema.partial();

export const contactResponseSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  title: z.string().nullable(),
  dedupeKey: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// Segment schemas
export const segmentTypeEnum = z.enum(['pe', 'portfolio', 'existing_client', 'past_client', 'net_new', 'custom']);

export const createSegmentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: segmentTypeEnum.default('custom'),
  rules: z.record(z.unknown()).optional(),
});

export const updateSegmentSchema = createSegmentSchema.partial();

export const segmentResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.string(),
  rules: z.unknown().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CreateAccount = z.infer<typeof createAccountSchema>;
export type UpdateAccount = z.infer<typeof updateAccountSchema>;
export type AccountResponse = z.infer<typeof accountResponseSchema>;

export type CreateContact = z.infer<typeof createContactSchema>;
export type UpdateContact = z.infer<typeof updateContactSchema>;
export type ContactResponse = z.infer<typeof contactResponseSchema>;

export type CreateSegment = z.infer<typeof createSegmentSchema>;
export type UpdateSegment = z.infer<typeof updateSegmentSchema>;
export type SegmentResponse = z.infer<typeof segmentResponseSchema>;
