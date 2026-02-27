import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { config } from './lib/config.js';
import { logger } from './lib/logger.js';
import authPlugin, { authenticate } from './plugins/auth.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { accountRoutes } from './routes/accounts.js';
import { contactRoutes } from './routes/contacts.js';
import { signalRoutes } from './routes/signals.js';
import { hypothesesRoutes } from './routes/hypotheses.js';

const fastify = Fastify({
  logger: logger as unknown as import('fastify').FastifyBaseLogger,
}).withTypeProvider<ZodTypeProvider>();

// Set up Zod validation
fastify.setValidatorCompiler(validatorCompiler);
fastify.setSerializerCompiler(serializerCompiler);

async function main() {
  // CORS - allow credentials for cookies
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  // Cookie support for session tokens
  await fastify.register(cookie, {
    secret: config.COOKIE_SECRET,
    parseOptions: {},
  });

  // Auth plugin - adds authenticate decorator
  await fastify.register(authPlugin);

  // Swagger/OpenAPI
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Fortium Outbound API',
        description: 'Virtual BDR System - Universe, Signals, Hypotheses, Plays',
        version: '0.1.0',
      },
      servers: [{ url: `http://localhost:${config.PORT}` }],
      tags: [
        { name: 'Health', description: 'Health check endpoints' },
        { name: 'Auth', description: 'Authentication endpoints' },
        { name: 'Accounts', description: 'Account management (Universe)' },
        { name: 'Contacts', description: 'Contact management (Universe)' },
        { name: 'Signals', description: 'Signal ingestion and management' },
        { name: 'Hypotheses', description: 'Hypothesis generation and approval workflow' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT token from Identity service or test-login',
          },
        },
      },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
  });

  // Public routes (no auth required)
  await fastify.register(healthRoutes);
  await fastify.register(authRoutes, { prefix: '/auth' });

  // Protected routes (auth required)
  // Wrap all /api/v1/* routes in a context with authentication preHandler
  await fastify.register(async (protectedContext) => {
    // Apply authentication to all routes in this context
    protectedContext.addHook('preHandler', authenticate);

    // Register protected route handlers
    await protectedContext.register(accountRoutes, { prefix: '/accounts' });
    await protectedContext.register(contactRoutes, { prefix: '/contacts' });
    await protectedContext.register(signalRoutes, { prefix: '/signals' });
    await protectedContext.register(hypothesesRoutes, { prefix: '/hypotheses' });
  }, { prefix: '/api/v1' });

  // Start server
  try {
    await fastify.listen({ port: config.PORT, host: config.HOST });
    fastify.log.info(`Server running at http://${config.HOST}:${config.PORT}`);
    fastify.log.info(`API docs at http://${config.HOST}:${config.PORT}/docs`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
