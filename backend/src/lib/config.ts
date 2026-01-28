import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Auth configuration (Fortium Identity integration)
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  OIDC_ISSUER: z.string().url().default('http://localhost:3099/oidc'),
  OIDC_CLIENT_ID: z.string().default('outbound-api'),
  ENABLE_TEST_AUTH: z.string().transform(v => v === 'true').default('false'),
  TEST_AUTH_KEY: z.string().min(32).optional(),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters'),
});

export type Env = z.infer<typeof envSchema>;

export const config = envSchema.parse(process.env);
