/**
 * Outbound Authentication Routes
 *
 * Uses Fortium Identity OIDC for authentication.
 * Confidential client with PKCE, server-side token exchange.
 */

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../lib/config.js';
import { identityClient, type OIDCState } from '../lib/identity-client.js';
import { createSessionToken, AuthUser, authenticateOptional } from '../plugins/auth.js';

// Cookie names
const OIDC_STATE_COOKIE = 'oidc_state';
const AUTH_TOKEN_COOKIE = 'outbound_session';
const ID_TOKEN_COOKIE = 'outbound_id_token';
const REFRESH_TOKEN_COOKIE = 'outbound_refresh';

// Test login request schema
const testLoginSchema = z.object({
  email: z.string().email(),
  displayName: z.string().optional(),
  fortiumUserId: z.string().uuid().optional(),
});

// Allowed test email domains
const ALLOWED_TEST_DOMAINS = [
  'test.fortium.local',
  'test.example.com',
  'playwright.test',
  'e2e.test',
  'fortiumpartners.com',
];

// Request schemas
const callbackSchema = z.object({
  code: z.string(),
  state: z.string(),
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /auth/login
   * Initiates OIDC login flow - redirects to Fortium Identity
   */
  fastify.get('/login', async (_request, reply) => {
    try {
      const { url, state } = await identityClient.generateAuthorizationUrl(
        config.IDENTITY_CALLBACK_URL
      );

      // Store OIDC state in signed cookie
      reply.setCookie(OIDC_STATE_COOKIE, JSON.stringify(state), {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600, // 10 minutes
        path: '/',
        signed: true,
      });

      fastify.log.info('Redirecting to Identity for authentication');
      reply.redirect(url);
    } catch (error) {
      fastify.log.error({ error }, 'Failed to generate authorization URL');
      reply.redirect(`${config.FRONTEND_URL}/login?error=auth_init_failed`);
    }
  });

  /**
   * GET /auth/callback
   * Handles OIDC callback from Fortium Identity
   */
  fastify.get('/callback', async (request, reply) => {
    try {
      const { code, state } = callbackSchema.parse(request.query);

      // Retrieve and validate OIDC state from cookie
      const stateCookie = request.cookies[OIDC_STATE_COOKIE];
      if (!stateCookie) {
        fastify.log.warn('Missing OIDC state cookie');
        return reply.redirect(`${config.FRONTEND_URL}/login?error=state_missing`);
      }

      const unsigned = request.unsignCookie(stateCookie);
      if (!unsigned.valid || !unsigned.value) {
        fastify.log.warn('Invalid OIDC state cookie signature');
        return reply.redirect(`${config.FRONTEND_URL}/login?error=state_invalid`);
      }

      const oidcState: OIDCState = JSON.parse(unsigned.value);

      if (state !== oidcState.state) {
        fastify.log.warn('OIDC state mismatch');
        return reply.redirect(`${config.FRONTEND_URL}/login?error=state_mismatch`);
      }

      // Clear the state cookie
      reply.clearCookie(OIDC_STATE_COOKIE, { path: '/' });

      // Exchange code for tokens (with client_secret + PKCE)
      const { idToken, refreshToken, claims } = await identityClient.exchangeCode(code, oidcState);

      fastify.log.info(
        { fortiumUserId: claims.fortium_user_id, email: claims.email },
        'OIDC authentication successful'
      );

      // Create Outbound session JWT
      const user: AuthUser = {
        fortiumUserId: claims.fortium_user_id,
        email: claims.email,
        name: claims.name || claims.email,
      };
      const sessionToken = await createSessionToken(user, config.JWT_EXPIRES_IN);

      // Set session cookie (24h)
      reply.setCookie(AUTH_TOKEN_COOKIE, sessionToken, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 86400, // 24 hours
        path: '/',
        signed: true,
      });

      // Store ID token for logout hint (24h)
      reply.setCookie(ID_TOKEN_COOKIE, idToken, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 86400,
        path: '/',
        signed: true,
      });

      // Store refresh token (7-day TTL)
      if (refreshToken) {
        reply.setCookie(REFRESH_TOKEN_COOKIE, refreshToken, {
          httpOnly: true,
          secure: config.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60, // 7 days
          path: '/',
          signed: true,
        });
      }

      // Redirect to frontend
      reply.redirect(config.FRONTEND_URL);
    } catch (error) {
      const err = error as Error;
      fastify.log.error({ message: err.message, name: err.name }, 'OIDC callback error');

      if (error instanceof z.ZodError) {
        return reply.redirect(`${config.FRONTEND_URL}/login?error=invalid_callback`);
      }

      reply.redirect(`${config.FRONTEND_URL}/login?error=callback_failed`);
    }
  });

  /**
   * GET /auth/me
   * Get current authenticated user
   */
  fastify.get('/me', {
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
   * Clears session and returns Identity logout URL
   */
  fastify.post('/logout', {
    preHandler: authenticateOptional,
  }, async (request, reply) => {
    // Get ID token for logout hint
    const idTokenCookie = request.cookies[ID_TOKEN_COOKIE];
    let idToken: string | undefined;
    if (idTokenCookie) {
      const unsigned = request.unsignCookie(idTokenCookie);
      if (unsigned.valid && unsigned.value) {
        idToken = unsigned.value;
      }
    }

    // Clear all auth cookies
    reply.clearCookie(AUTH_TOKEN_COOKIE, { path: '/' });
    reply.clearCookie(ID_TOKEN_COOKIE, { path: '/' });
    reply.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/' });

    if (request.user) {
      fastify.log.info(
        { fortiumUserId: request.user.fortiumUserId, email: request.user.email },
        'User logged out',
      );
    }

    // Return logout URL for frontend to redirect
    const logoutUrl = identityClient.getLogoutUrl(idToken, config.FRONTEND_URL);

    return { success: true, logoutUrl };
  });

  /**
   * GET /auth/logout
   * Clears session and redirects directly to Identity logout
   */
  fastify.get('/logout', async (request, reply) => {
    const idTokenCookie = request.cookies[ID_TOKEN_COOKIE];
    let idToken: string | undefined;
    if (idTokenCookie) {
      const unsigned = request.unsignCookie(idTokenCookie);
      if (unsigned.valid && unsigned.value) {
        idToken = unsigned.value;
      }
    }

    reply.clearCookie(AUTH_TOKEN_COOKIE, { path: '/' });
    reply.clearCookie(ID_TOKEN_COOKIE, { path: '/' });
    reply.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/' });

    const logoutUrl = identityClient.getLogoutUrl(idToken, config.FRONTEND_URL);
    return reply.redirect(logoutUrl);
  });

  /**
   * POST /auth/refresh
   * Exchange refresh token for new tokens
   */
  fastify.post('/refresh', async (request, reply) => {
    const refreshCookie = request.cookies[REFRESH_TOKEN_COOKIE];
    if (!refreshCookie) {
      return reply.status(401).send({ error: 'No refresh token' });
    }

    const unsigned = request.unsignCookie(refreshCookie);
    if (!unsigned.valid || !unsigned.value) {
      reply.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/' });
      return reply.status(401).send({ error: 'Invalid refresh token' });
    }

    try {
      const tokens = await identityClient.refreshToken(unsigned.value);

      // Validate new ID token and create new session
      if (tokens.idToken) {
        const claims = await identityClient.validateIdToken(tokens.idToken);
        const user: AuthUser = {
          fortiumUserId: claims.fortium_user_id,
          email: claims.email,
          name: claims.name || claims.email,
        };
        const sessionToken = await createSessionToken(user, config.JWT_EXPIRES_IN);

        reply.setCookie(AUTH_TOKEN_COOKIE, sessionToken, {
          httpOnly: true,
          secure: config.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 86400,
          path: '/',
          signed: true,
        });

        reply.setCookie(ID_TOKEN_COOKIE, tokens.idToken, {
          httpOnly: true,
          secure: config.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 86400,
          path: '/',
          signed: true,
        });
      }

      if (tokens.refreshToken) {
        reply.setCookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
          httpOnly: true,
          secure: config.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60,
          path: '/',
          signed: true,
        });
      }

      return { success: true };
    } catch (error) {
      fastify.log.error({ error }, 'Token refresh failed');
      reply.clearCookie(AUTH_TOKEN_COOKIE, { path: '/' });
      reply.clearCookie(ID_TOKEN_COOKIE, { path: '/' });
      reply.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/' });
      return reply.status(401).send({ error: 'Token refresh failed' });
    }
  });

  /**
   * POST /auth/test-login
   * Test login for E2E testing
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

    const user: AuthUser = {
      fortiumUserId: body.fortiumUserId || `test-${Date.now()}`,
      email: body.email.toLowerCase(),
      name: body.displayName || `Test User (${body.email})`,
    };

    const token = await createSessionToken(user, config.JWT_EXPIRES_IN);

    reply.setCookie(AUTH_TOKEN_COOKIE, token, {
      path: '/',
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      signed: true,
      sameSite: 'lax',
      maxAge: 86400,
    });

    fastify.log.info(
      { fortiumUserId: user.fortiumUserId, email: user.email, testLogin: true },
      'TEST LOGIN: Session established',
    );

    return {
      success: true as const,
      user: { fortiumUserId: user.fortiumUserId, email: user.email, name: user.name },
      token,
      message: 'Test login successful. Session cookie has been set.',
    };
  });
};
