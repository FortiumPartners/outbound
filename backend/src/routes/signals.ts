import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { idParamSchema, paginationSchema } from '../schemas/common.js';
import {
  createSignalSchema,
  updateSignalSchema,
  signalResponseSchema,
  archiveReasonEnum,
  CreateSignal,
  UpdateSignal,
} from '../schemas/signals.js';
import { pushSignalToHubSpot } from '../services/hubspot-push.js';
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

    const signal = await prisma.signal.create({
      data: {
        ...data,
        account: data.accountId ? { connect: { id: data.accountId } } : undefined,
        contact: data.contactId ? { connect: { id: data.contactId } } : undefined,
        accountId: undefined,
        contactId: undefined,
      } as Parameters<typeof prisma.signal.create>[0]['data'],
    });

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
        data: {
          ...data,
          account: data.accountId ? { connect: { id: data.accountId } } : undefined,
          contact: data.contactId ? { connect: { id: data.contactId } } : undefined,
          accountId: undefined,
          contactId: undefined,
        } as Parameters<typeof prisma.signal.update>[0]['data'],
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

  // Push signal to HubSpot
  fastify.post('/:id/push', {
    schema: {
      params: idParamSchema,
      response: {
        200: z.object({
          success: z.boolean(),
          hubspot: z.object({
            dealId: z.string(),
            dealUrl: z.string(),
            companiesCreated: z.number(),
            companyContactsCreated: z.number(),
            peContactsCreated: z.number(),
          }),
        }),
        400: z.object({ error: z.string(), message: z.string(), statusCode: z.number() }),
        404: z.object({ error: z.string(), message: z.string(), statusCode: z.number() }),
        500: z.object({ error: z.string(), message: z.string(), statusCode: z.number() }),
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const signal = await prisma.signal.findUnique({ where: { id } });
    if (!signal) {
      return reply.status(404).send({ error: 'Not Found', message: 'Signal not found', statusCode: 404 });
    }

    if (signal.status === 'pushed') {
      return reply.status(400).send({ error: 'Bad Request', message: 'Signal already pushed to HubSpot', statusCode: 400 });
    }

    if (signal.status === 'archived') {
      return reply.status(400).send({ error: 'Bad Request', message: 'Cannot push archived signal', statusCode: 400 });
    }

    try {
      const result = await pushSignalToHubSpot(signal);

      await prisma.signal.update({
        where: { id },
        data: {
          status: 'pushed',
          hubspotDealId: result.dealId,
          hubspotCompanyIds: result.companyIds,
          hubspotContactIds: result.contactIds,
          pushedAt: new Date(),
          pushError: null,
        },
      });

      return {
        success: true,
        hubspot: {
          dealId: result.dealId,
          dealUrl: result.dealUrl,
          companiesCreated: result.companiesCreated,
          companyContactsCreated: result.companyContactsCreated,
          peContactsCreated: result.peContactsCreated,
        },
      };
    } catch (error) {
      // Store error for retry capability
      await prisma.signal.update({
        where: { id },
        data: {
          status: 'push_failed',
          pushError: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      return reply.status(500).send({
        error: 'Push Failed',
        message: error instanceof Error ? error.message : 'Failed to push to HubSpot',
        statusCode: 500,
      });
    }
  });

  // Archive signal
  fastify.post('/:id/archive', {
    schema: {
      params: idParamSchema,
      body: z.object({
        reason: archiveReasonEnum.optional(),
      }).nullish(),
      response: {
        200: signalResponseSchema,
        404: z.object({ error: z.string(), message: z.string(), statusCode: z.number() }),
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { reason?: string };

    try {
      const signal = await prisma.signal.update({
        where: { id },
        data: {
          status: 'archived',
          archivedAt: new Date(),
          archiveReason: body?.reason || null,
        },
      });

      return {
        ...signal,
        processedAt: signal.processedAt?.toISOString() ?? null,
        pushedAt: signal.pushedAt?.toISOString() ?? null,
        archivedAt: signal.archivedAt?.toISOString() ?? null,
        createdAt: signal.createdAt.toISOString(),
        updatedAt: signal.updatedAt.toISOString(),
      };
    } catch {
      return reply.status(404).send({ error: 'Not Found', message: 'Signal not found', statusCode: 404 });
    }
  });
};
