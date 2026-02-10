import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Fortium Identity (OIDC)
  IDENTITY_ISSUER: z.string().url().default('http://localhost:3099/oidc'),
  IDENTITY_CLIENT_ID: z.string().default('outbound-api'),
  IDENTITY_CLIENT_SECRET: z.string(),
  IDENTITY_CALLBACK_URL: z.string().url(),

  // JWT (for Outbound sessions)
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('24h'),

  // Cookie signing
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters'),

  // Frontend URL (for redirects after auth)
  FRONTEND_URL: z.string().default('http://localhost:3006'),

  // Scout API key (server-to-server auth for scouts)
  SCOUT_API_KEY: z.string().min(32).optional(),

  // Test auth
  ENABLE_TEST_AUTH: z.string().transform(v => v === 'true').default('false'),
  TEST_AUTH_KEY: z.string().min(32).optional(),
});

export type Env = z.infer<typeof envSchema>;

export const config = envSchema.parse(process.env);
