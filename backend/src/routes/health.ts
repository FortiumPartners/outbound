import { FastifyPluginAsync } from 'fastify';
import { healthResponseSchema, HealthResponse } from '../schemas/common.js';
import { prisma } from '../lib/prisma.js';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  // Basic health check
  fastify.get('/health', {
    schema: {
      response: {
        200: healthResponseSchema,
      },
    },
  }, async (): Promise<HealthResponse> => {
    return {
      status: 'healthy',
      service: 'outbound-api',
      timestamp: new Date().toISOString(),
    };
  });

  // Health check with database
  fastify.get('/health/db', {
    schema: {
      response: {
        200: healthResponseSchema,
      },
    },
  }, async (): Promise<HealthResponse> => {
    let dbStatus: 'connected' | 'disconnected' = 'disconnected';

    try {
      await prisma.$queryRaw`SELECT 1`;
      dbStatus = 'connected';
    } catch (error) {
      fastify.log.error(error, 'Database health check failed');
    }

    return {
      status: dbStatus === 'connected' ? 'healthy' : 'degraded',
      service: 'outbound-api',
      timestamp: new Date().toISOString(),
      database: dbStatus,
    };
  });
};
