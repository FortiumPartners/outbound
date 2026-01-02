import { z } from 'zod';

// Common response schemas
export const healthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  service: z.string(),
  timestamp: z.string().datetime(),
  database: z.enum(['connected', 'disconnected']).optional(),
});

export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number(),
});

// Common ID schema
export const idParamSchema = z.object({
  id: z.string().uuid(),
});

// Pagination schema
export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type IdParam = z.infer<typeof idParamSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
