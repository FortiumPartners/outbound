import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import * as jose from 'jose';
import { config } from '../lib/config.js';

// User payload attached to request after authentication
export interface AuthUser {
  fortiumUserId: string;
  email: string;
  name: string;
}

// Extend FastifyRequest to include user
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

// JWKS cache for OIDC tokens
let jwksCache: jose.createRemoteJWKSet | null = null;

/**
 * Get JWKS from OIDC provider (cached)
 * Note: Identity serves JWKS at the base URL (without /oidc path)
 * If OIDC_ISSUER is http://localhost:3099/oidc, JWKS is at http://localhost:3099/.well-known/jwks.json
 */
function getJWKS(): ReturnType<typeof jose.createRemoteJWKSet> {
  if (!jwksCache) {
    // Remove /oidc suffix from issuer to get base URL for JWKS
    const baseUrl = config.OIDC_ISSUER.replace(/\/oidc$/, '');
    const jwksUrl = new URL('/.well-known/jwks.json', baseUrl);
    jwksCache = jose.createRemoteJWKSet(jwksUrl);
  }
  return jwksCache;
}

/**
 * Get allowed issuers for OIDC token verification.
 * In development, tokens may be issued with localhost but verified in Docker
 * where host.docker.internal is used, or vice versa.
 */
function getAllowedIssuers(): string[] {
  const issuers = [config.OIDC_ISSUER];

  // In development, accept both localhost and host.docker.internal variants
  if (config.NODE_ENV === 'development') {
    if (config.OIDC_ISSUER.includes('localhost')) {
      issuers.push(config.OIDC_ISSUER.replace('localhost', 'host.docker.internal'));
    } else if (config.OIDC_ISSUER.includes('host.docker.internal')) {
      issuers.push(config.OIDC_ISSUER.replace('host.docker.internal', 'localhost'));
    }
  }

  return issuers;
}

/**
 * Verify OIDC token from Identity service
 */
async function verifyOIDCToken(token: string): Promise<AuthUser | null> {
  try {
    const jwks = getJWKS();
    const allowedIssuers = getAllowedIssuers();

    const { payload } = await jose.jwtVerify(token, jwks, {
      issuer: allowedIssuers,
      audience: config.OIDC_CLIENT_ID,
    });

    if (!payload.sub || !payload.email) {
      return null;
    }

    return {
      fortiumUserId: payload.sub,
      email: payload.email as string,
      name: (payload.name as string) || (payload.email as string),
    };
  } catch (err) {
    // Token verification failed - will fall back to session token
    return null;
  }
}

/**
 * Verify local session token (HS256)
 */
async function verifySessionToken(token: string): Promise<AuthUser | null> {
  try {
    const secret = new TextEncoder().encode(config.JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret, {
      issuer: 'outbound-api',
    });

    if (!payload.sub || !payload.email) {
      return null;
    }

    return {
      fortiumUserId: payload.sub,
      email: payload.email as string,
      name: (payload.name as string) || (payload.email as string),
    };
  } catch {
    return null;
  }
}

/**
 * Create a session token for local use (test login, etc.)
 */
export async function createSessionToken(user: AuthUser, expiresIn = '24h'): Promise<string> {
  const secret = new TextEncoder().encode(config.JWT_SECRET);

  const token = await new jose.SignJWT({
    email: user.email,
    name: user.name,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.fortiumUserId)
    .setIssuer('outbound-api')
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);

  return token;
}

/**
 * Extract token from request (Authorization header or cookie)
 */
function extractToken(request: FastifyRequest): string | null {
  // Check Authorization header first
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Check cookie
  const cookies = request.cookies as Record<string, string> | undefined;
  if (cookies?.['outbound_session']) {
    // Verify signed cookie
    const result = request.unsignCookie(cookies['outbound_session']);
    if (result.valid && result.value) {
      return result.value;
    }
  }

  return null;
}

/**
 * Authentication decorator function (required auth)
 */
async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = extractToken(request);

  if (!token) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Authentication required',
      statusCode: 401,
    });
  }

  // Try OIDC token first (RS256 from Identity service)
  let user = await verifyOIDCToken(token);

  // Fall back to local session token (HS256)
  if (!user) {
    user = await verifySessionToken(token);
  }

  if (!user) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
      statusCode: 401,
    });
  }

  // Attach user to request
  request.user = user;
}

/**
 * Optional authentication - parses token if present but doesn't require it
 */
async function authenticateOptional(
  request: FastifyRequest,
): Promise<void> {
  const token = extractToken(request);

  if (!token) {
    return; // No token is OK for optional auth
  }

  // Try OIDC token first (RS256 from Identity service)
  let user = await verifyOIDCToken(token);

  // Fall back to local session token (HS256)
  if (!user) {
    user = await verifySessionToken(token);
  }

  // Attach user to request if valid
  if (user) {
    request.user = user;
  }
}

/**
 * Auth plugin for Fastify
 * Adds `authenticate` decorator that can be used as preHandler
 */
async function authPlugin(fastify: FastifyInstance): Promise<void> {
  // Decorate fastify with authenticate function
  fastify.decorate('authenticate', authenticate);
}

// Export as Fastify plugin with fp to ensure decorators are shared
export default fp(authPlugin, {
  name: 'auth-plugin',
  fastify: '4.x',
});

// Also export the authenticate functions for use in preHandler hooks
export { authenticate, authenticateOptional };
