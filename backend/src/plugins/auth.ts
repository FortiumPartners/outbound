import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { verifySessionToken } from '@fortium/identity-client';
import type { SessionPayload } from '@fortium/identity-client';
import { config } from '../lib/config.js';

export interface AuthUser {
  fortiumUserId: string;
  email: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

const AUTH_TOKEN_COOKIE = 'auth_token';

export const sessionConfig = {
  jwtSecret: config.JWT_SECRET,
  issuer: 'outbound-api',
};

function extractToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  const cookies = request.cookies as Record<string, string> | undefined;
  if (cookies?.[AUTH_TOKEN_COOKIE]) {
    const result = request.unsignCookie(cookies[AUTH_TOKEN_COOKIE]);
    if (result.valid && result.value) {
      return result.value;
    }
  }

  return null;
}

function isValidScoutApiKey(token: string): boolean {
  return !!config.SCOUT_API_KEY && token === config.SCOUT_API_KEY;
}

async function resolveUser(token: string): Promise<AuthUser | null> {
  const session = await verifySessionToken(token, sessionConfig);
  if (!session) return null;

  return {
    fortiumUserId: session.fortiumUserId,
    email: session.email,
    name: ((session as { name?: string }).name) || session.email,
  };
}

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

  // Check scout API key first (server-to-server)
  if (isValidScoutApiKey(token)) {
    request.user = {
      fortiumUserId: 'scout-service',
      email: 'scout@fortiumpartners.com',
      name: 'Scout Service',
    };
    return;
  }

  const user = await resolveUser(token);

  if (!user) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
      statusCode: 401,
    });
  }

  request.user = user;
}

export async function authenticateOptional(
  request: FastifyRequest,
): Promise<void> {
  const token = extractToken(request);
  if (!token) return;

  const user = await resolveUser(token);
  if (user) {
    request.user = user;
  }
}

async function authPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('authenticate', authenticate);
}

export default fp(authPlugin, {
  name: 'auth-plugin',
  fastify: '4.x',
});

export { authenticate };
