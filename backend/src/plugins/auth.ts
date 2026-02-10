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
 * Create a session token for local use
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

  const user = await verifySessionToken(token);

  if (!user) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
      statusCode: 401,
    });
  }

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
    return;
  }

  const user = await verifySessionToken(token);

  if (user) {
    request.user = user;
  }
}

/**
 * Auth plugin for Fastify
 */
async function authPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('authenticate', authenticate);
}

export default fp(authPlugin, {
  name: 'auth-plugin',
  fastify: '4.x',
});

export { authenticate, authenticateOptional };
