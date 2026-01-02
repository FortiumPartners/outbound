import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { idParamSchema, paginationSchema } from '../schemas/common.js';
import {
  createSignalSchema,
  updateSignalSchema,
  signalResponseSchema,
  CreateSignal,
  UpdateSignal,
} from '../schemas/signals.js';
import { z } from 'zod';

export const signalRoutes: FastifyPluginAsync = async (fastify) => {
  // List signals
  fastify.get('/', {
    schema: {
      querystring: paginationSchema.extend({
        accountId: z.string().uuid().optional(),
        contactId: z.string().uuid().optional(),
        type: z.string().optional(),
        severity: z.string().optional(),
      }),
      response: {
        200: z.object({
          data: z.array(signalResponseSchema),
          pagination: z.object({
            page: z.number(),
            limit: z.number(),
            total: z.number(),
          }),
        }),
      },
    },
  }, async (request) => {
    const { page, limit, accountId, contactId, type, severity } = request.query as {
      page: number;
      limit: number;
      accountId?: string;
      contactId?: string;
      type?: string;
      severity?: string;
    };
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (accountId) where.accountId = accountId;
    if (contactId) where.contactId = contactId;
    if (type) where.type = type;
    if (severity) where.severity = severity;

    const [signals, total] = await Promise.all([
      prisma.signal.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.signal.count({ where }),
    ]);

    return {
      data: signals.map(s => ({
        ...s,
        processedAt: s.processedAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
      pagination: { page, limit, total },
    };
  });

  // Get signal by ID
  fastify.get('/:id', {
    schema: {
      params: idParamSchema,
      response: {
        200: signalResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const signal = await prisma.signal.findUnique({ where: { id } });

    if (!signal) {
      return reply.status(404).send({ error: 'Not Found', message: 'Signal not found', statusCode: 404 });
    }

    return {
      ...signal,
      processedAt: signal.processedAt?.toISOString() ?? null,
      createdAt: signal.createdAt.toISOString(),
      updatedAt: signal.updatedAt.toISOString(),
    };
  });

  // Create signal (manual ingestion)
  fastify.post('/', {
    schema: {
      body: createSignalSchema,
      response: {
        201: signalResponseSchema,
      },
    },
  }, async (request, reply) => {
    const data = request.body as CreateSignal;

    const signal = await prisma.signal.create({ data });

    return reply.status(201).send({
      ...signal,
      processedAt: signal.processedAt?.toISOString() ?? null,
      createdAt: signal.createdAt.toISOString(),
      updatedAt: signal.updatedAt.toISOString(),
    });
  });

  // Update signal
  fastify.patch('/:id', {
    schema: {
      params: idParamSchema,
      body: updateSignalSchema,
      response: {
        200: signalResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = request.body as UpdateSignal;

    try {
      const signal = await prisma.signal.update({
        where: { id },
        data,
      });

      return {
        ...signal,
        processedAt: signal.processedAt?.toISOString() ?? null,
        createdAt: signal.createdAt.toISOString(),
        updatedAt: signal.updatedAt.toISOString(),
      };
    } catch {
      return reply.status(404).send({ error: 'Not Found', message: 'Signal not found', statusCode: 404 });
    }
  });

  // Delete signal
  fastify.delete('/:id', {
    schema: {
      params: idParamSchema,
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await prisma.signal.delete({ where: { id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: 'Not Found', message: 'Signal not found', statusCode: 404 });
    }
  });
};
