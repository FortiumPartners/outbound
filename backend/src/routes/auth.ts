/**
 * Outbound Authentication Routes
 *
 * Uses @fortium/identity-client-fastify plugin for OIDC.
 * Confidential client with PKCE, server-side token exchange.
 */

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../lib/config.js';
import { identityPlugin } from '@fortium/identity-client/fastify';
import { createSessionToken } from '@fortium/identity-client';
import type { FortiumClaims, SessionPayload } from '@fortium/identity-client';
import { sessionConfig } from '../plugins/auth.js';

const AUTH_TOKEN_COOKIE = 'auth_token';

// Test login request schema
const testLoginSchema = z.object({
  email: z.string().email(),
  displayName: z.string().optional(),
  fortiumUserId: z.string().uuid().optional(),
});

const ALLOWED_TEST_DOMAINS = [
  'test.fortium.local',
  'test.example.com',
  'playwright.test',
  'e2e.test',
  'fortiumpartners.com',
];

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(identityPlugin, {
    issuer: config.IDENTITY_ISSUER,
    clientId: config.IDENTITY_CLIENT_ID,
    clientSecret: config.IDENTITY_CLIENT_SECRET,
    callbackUrl: config.IDENTITY_CALLBACK_URL,
    frontendUrl: config.FRONTEND_URL,
    jwtSecret: config.JWT_SECRET,
    sessionIssuer: 'outbound-api',
    sessionExpiresIn: config.JWT_EXPIRES_IN,
    postLoginPath: '',
    postLogoutPath: '/login',

    authorize: async (claims: FortiumClaims) => {
      const name = claims.name || claims.email;
      return { name };
    },

    getMe: async (session: SessionPayload) => ({
      authenticated: true,
      user: {
        fortiumUserId: session.fortiumUserId,
        email: session.email,
        name: (session as { name?: string }).name,
      },
    }),
  });

  /**
   * POST /auth/test-login
   */
  fastify.post('/test-login', {
    schema: { body: testLoginSchema },
  }, async (request, reply) => {
    if (config.NODE_ENV === 'production') {
      return reply.status(404).send({ error: 'Not found' });
    }
    if (!config.ENABLE_TEST_AUTH) {
      return reply.status(404).send({ error: 'Not found' });
    }

    const testKey = request.headers['x-test-key'];
    if (!config.TEST_AUTH_KEY || testKey !== config.TEST_AUTH_KEY) {
      return reply.status(401).send({ error: 'Invalid test key' });
    }

    const body = request.body as z.infer<typeof testLoginSchema>;
    const emailDomain = body.email.split('@')[1]?.toLowerCase();
    if (!ALLOWED_TEST_DOMAINS.includes(emailDomain)) {
      return reply.status(400).send({ error: 'Email domain not allowed' });
    }

    const fortiumUserId = body.fortiumUserId || `test-${Date.now()}`;
    const email = body.email.toLowerCase();
    const name = body.displayName || `Test User (${email})`;

    const token = await createSessionToken(
      { fortiumUserId, email, name },
      sessionConfig
    );

    reply.setCookie(AUTH_TOKEN_COOKIE, token, {
      path: '/',
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      signed: true,
      sameSite: 'lax',
      maxAge: 86400,
    });

    fastify.log.info(
      { fortiumUserId, email, testLogin: true },
      'TEST LOGIN: Session established',
    );

    return {
      success: true as const,
      user: { fortiumUserId, email, name },
      token,
      message: 'Test login successful. Session cookie has been set.',
    };
  });
};
