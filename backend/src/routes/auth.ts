import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../lib/config.js';
import { createSessionToken, AuthUser, authenticateOptional } from '../plugins/auth.js';

// Test login request schema
const testLoginSchema = z.object({
  email: z.string().email(),
  displayName: z.string().optional(),
  fortiumUserId: z.string().uuid().optional(),
});

// Test login response schema
const testLoginResponseSchema = z.object({
  success: z.literal(true),
  user: z.object({
    fortiumUserId: z.string(),
    email: z.string(),
    name: z.string(),
  }),
  token: z.string(),
  message: z.string(),
});

// Me response schema
const meResponseSchema = z.object({
  authenticated: z.boolean(),
  user: z.object({
    fortiumUserId: z.string(),
    email: z.string(),
    name: z.string(),
  }).nullable(),
});

// Allowed test email domains
const ALLOWED_TEST_DOMAINS = [
  'test.fortium.local',
  'test.example.com',
  'playwright.test',
  'e2e.test',
  'fortiumpartners.com', // Allow real domain in dev for testing
];

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /auth/test-login
   * Test login endpoint for E2E testing and automation (Playwright, Claude, etc.)
   *
   * SECURITY: This endpoint is protected by multiple layers:
   * 1. Disabled in production (NODE_ENV check)
   * 2. Requires ENABLE_TEST_AUTH=true env var
   * 3. Requires X-Test-Key header matching TEST_AUTH_KEY env var
   * 4. Only allows whitelisted test email domains
   * 5. All test logins are audit logged
   */
  fastify.post('/test-login', {
    schema: {
      body: testLoginSchema,
      response: {
        200: testLoginResponseSchema,
      },
    },
  }, async (request, reply) => {
    const startTime = Date.now();

    // Layer 1: Never in production
    if (config.NODE_ENV === 'production') {
      fastify.log.warn('Test login attempted in production - blocked');
      return reply.status(404).send({ error: 'Not found' });
    }

    // Layer 2: Must be explicitly enabled
    if (!config.ENABLE_TEST_AUTH) {
      fastify.log.warn('Test login attempted but ENABLE_TEST_AUTH not enabled');
      return reply.status(404).send({ error: 'Not found' });
    }

    // Layer 3: Require test API key
    const testKey = request.headers['x-test-key'];
    const expectedKey = config.TEST_AUTH_KEY;

    if (!expectedKey || testKey !== expectedKey) {
      fastify.log.warn('Test login attempted with invalid or missing X-Test-Key');
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid test key',
        statusCode: 401,
      });
    }

    const body = request.body as z.infer<typeof testLoginSchema>;
    const { email, displayName, fortiumUserId } = body;

    // Layer 4: Only allow test email domains
    const emailDomain = email.split('@')[1]?.toLowerCase();
    if (!ALLOWED_TEST_DOMAINS.includes(emailDomain)) {
      fastify.log.warn({ email, domain: emailDomain }, 'Test login with non-whitelisted domain');
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Email domain not allowed for test login',
        allowedDomains: ALLOWED_TEST_DOMAINS,
        statusCode: 400,
      });
    }

    // Create user object
    const user: AuthUser = {
      fortiumUserId: fortiumUserId || `test-${Date.now()}`,
      email: email.toLowerCase(),
      name: displayName || `Test User (${email})`,
    };

    // Generate session token
    const token = await createSessionToken(user, '8h');

    // Set session cookie (signed, httpOnly)
    reply.setCookie('outbound_session', token, {
      path: '/',
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      signed: true,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60, // 8 hours in seconds
    });

    // Layer 5: Audit log
    fastify.log.info(
      {
        fortiumUserId: user.fortiumUserId,
        email: user.email,
        testLogin: true,
        source: request.headers['user-agent'] || 'unknown',
        duration: Date.now() - startTime,
      },
      'TEST LOGIN: User session established via test endpoint',
    );

    return {
      success: true as const,
      user: {
        fortiumUserId: user.fortiumUserId,
        email: user.email,
        name: user.name,
      },
      token,
      message: 'Test login successful. Session cookie has been set.',
    };
  });

  /**
   * GET /auth/me
   * Get current authenticated user
   */
  fastify.get('/me', {
    schema: {
      response: {
        200: meResponseSchema,
      },
    },
    preHandler: authenticateOptional,
  }, async (request) => {
    if (request.user) {
      return {
        authenticated: true,
        user: {
          fortiumUserId: request.user.fortiumUserId,
          email: request.user.email,
          name: request.user.name,
        },
      };
    }

    return {
      authenticated: false,
      user: null,
    };
  });

  /**
   * POST /auth/logout
   * Clear session and logout
   */
  fastify.post('/logout', {
    preHandler: authenticateOptional,
  }, async (request, reply) => {
    // Clear session cookie
    reply.clearCookie('outbound_session', {
      path: '/',
    });

    if (request.user) {
      fastify.log.info(
        { fortiumUserId: request.user.fortiumUserId, email: request.user.email },
        'User logged out',
      );
    }

    return { success: true, message: 'Logged out successfully' };
  });
};
