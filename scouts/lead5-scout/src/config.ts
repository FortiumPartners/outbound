import { z } from 'zod';

const ConfigSchema = z.object({
  // Lead5 credentials
  lead5Email: z.string().min(1),
  lead5Password: z.string().min(1),

  // Outbound API
  outboundApiUrl: z.string().url().default('http://localhost:8004'),
  outboundApiKey: z.string().optional(),

  // Anthropic (optional - for future AI-enhanced extraction)
  anthropicApiKey: z.string().optional(),

  // Scout behavior
  dryRun: z.boolean().default(false),
  maxResults: z.number().int().positive().default(50),
  rateLimitMs: z.number().int().positive().default(2000),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const raw = {
    lead5Email: process.env.LEAD5_EMAIL,
    lead5Password: process.env.LEAD5_PASSWORD,
    outboundApiUrl: process.env.OUTBOUND_API_URL,
    outboundApiKey: process.env.OUTBOUND_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    dryRun: process.env.DRY_RUN === 'true',
    maxResults: process.env.MAX_RESULTS ? parseInt(process.env.MAX_RESULTS, 10) : undefined,
    rateLimitMs: process.env.RATE_LIMIT_MS ? parseInt(process.env.RATE_LIMIT_MS, 10) : undefined,
    logLevel: process.env.LOG_LEVEL,
  };

  return ConfigSchema.parse(raw);
}
