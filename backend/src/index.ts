import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { config } from './lib/config.js';
import { healthRoutes } from './routes/health.js';
import { accountRoutes } from './routes/accounts.js';
import { contactRoutes } from './routes/contacts.js';
import { signalRoutes } from './routes/signals.js';
import { hypothesesRoutes } from './routes/hypotheses.js';

const fastify = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    transport:
      config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
}).withTypeProvider<ZodTypeProvider>();

// Set up Zod validation
fastify.setValidatorCompiler(validatorCompiler);
fastify.setSerializerCompiler(serializerCompiler);

async function main() {
  // CORS
  await fastify.register(cors, {
    origin: true,
  });

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
        { name: 'Accounts', description: 'Account management (Universe)' },
        { name: 'Contacts', description: 'Contact management (Universe)' },
        { name: 'Signals', description: 'Signal ingestion and management' },
        { name: 'Hypotheses', description: 'Hypothesis generation and approval workflow' },
      ],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
  });

  // Routes
  await fastify.register(healthRoutes);
  await fastify.register(accountRoutes, { prefix: '/api/v1/accounts' });
  await fastify.register(contactRoutes, { prefix: '/api/v1/contacts' });
  await fastify.register(signalRoutes, { prefix: '/api/v1/signals' });
  await fastify.register(hypothesesRoutes, { prefix: '/api/v1/hypotheses' });

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
