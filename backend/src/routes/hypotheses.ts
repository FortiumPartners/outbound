import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { idParamSchema, paginationSchema } from '../schemas/common.js';
import {
  createHypothesisSchema,
  updateHypothesisSchema,
  approveHypothesisSchema,
  rejectHypothesisSchema,
  hypothesisResponseSchema,
  CreateHypothesis,
  UpdateHypothesis,
  ApproveHypothesis,
  RejectHypothesis,
} from '../schemas/hypotheses.js';
import { z } from 'zod';

const formatHypothesis = (h: {
  id: string;
  signalId: string | null;
  accountId: string | null;
  contactId: string | null;
  title: string;
  summary: string | null;
  conversationOpener: string | null;
  noveltyTag: string | null;
  complianceRisk: string;
  recommendedMessenger: string | null;
  channel: string | null;
  generationMethod: string;
  generationModelId: string | null;
  generationPromptHash: string | null;
  status: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectionReason: string | null;
  score: number | null;
  hubspotDealId: string | null;
  hubspotNoteId: string | null;
  connections: unknown | null;
  contactRecommendations: unknown | null;
  recommendationSummary: string | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  ...h,
  approvedAt: h.approvedAt?.toISOString() ?? null,
  createdAt: h.createdAt.toISOString(),
  updatedAt: h.updatedAt.toISOString(),
});

export const hypothesesRoutes: FastifyPluginAsync = async (fastify) => {
  // List hypotheses
  fastify.get('/', {
    schema: {
      querystring: paginationSchema.extend({
        accountId: z.string().uuid().optional(),
        contactId: z.string().uuid().optional(),
        signalId: z.string().uuid().optional(),
        status: z.string().optional(),
        complianceRisk: z.string().optional(),
      }),
      response: {
        200: z.object({
          data: z.array(hypothesisResponseSchema),
          pagination: z.object({
            page: z.number(),
            limit: z.number(),
            total: z.number(),
          }),
        }),
      },
    },
  }, async (request) => {
    const { page, limit, accountId, contactId, signalId, status, complianceRisk } = request.query as {
      page: number;
      limit: number;
      accountId?: string;
      contactId?: string;
      signalId?: string;
      status?: string;
      complianceRisk?: string;
    };
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (accountId) where.accountId = accountId;
    if (contactId) where.contactId = contactId;
    if (signalId) where.signalId = signalId;
    if (status) where.status = status;
    if (complianceRisk) where.complianceRisk = complianceRisk;

    const [hypotheses, total] = await Promise.all([
      prisma.hypothesis.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.hypothesis.count({ where }),
    ]);

    return {
      data: hypotheses.map(formatHypothesis),
      pagination: { page, limit, total },
    };
  });

  // Get pending review queue
  fastify.get('/queue', {
    schema: {
      querystring: paginationSchema,
      response: {
        200: z.object({
          data: z.array(hypothesisResponseSchema),
          pagination: z.object({
            page: z.number(),
            limit: z.number(),
            total: z.number(),
          }),
        }),
      },
    },
  }, async (request) => {
    const { page, limit } = request.query as { page: number; limit: number };
    const skip = (page - 1) * limit;

    const where = { status: 'pending_review' };

    const [hypotheses, total] = await Promise.all([
      prisma.hypothesis.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' }, // FIFO
      }),
      prisma.hypothesis.count({ where }),
    ]);

    return {
      data: hypotheses.map(formatHypothesis),
      pagination: { page, limit, total },
    };
  });

  // Get hypothesis by ID
  fastify.get('/:id', {
    schema: {
      params: idParamSchema,
      response: {
        200: hypothesisResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const hypothesis = await prisma.hypothesis.findUnique({ where: { id } });

    if (!hypothesis) {
      return reply.status(404).send({ error: 'Not Found', message: 'Hypothesis not found', statusCode: 404 });
    }

    return formatHypothesis(hypothesis);
  });

  // Create hypothesis
  fastify.post('/', {
    schema: {
      body: createHypothesisSchema,
      response: {
        201: hypothesisResponseSchema,
      },
    },
  }, async (request, reply) => {
    const data = request.body as CreateHypothesis;

    const hypothesis = await prisma.hypothesis.create({ data });

    return reply.status(201).send(formatHypothesis(hypothesis));
  });

  // Update hypothesis
  fastify.patch('/:id', {
    schema: {
      params: idParamSchema,
      body: updateHypothesisSchema,
      response: {
        200: hypothesisResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = request.body as UpdateHypothesis;

    try {
      const hypothesis = await prisma.hypothesis.update({
        where: { id },
        data,
      });

      return formatHypothesis(hypothesis);
    } catch {
      return reply.status(404).send({ error: 'Not Found', message: 'Hypothesis not found', statusCode: 404 });
    }
  });

  // Submit for review
  fastify.post('/:id/submit', {
    schema: {
      params: idParamSchema,
      response: {
        200: hypothesisResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const hypothesis = await prisma.hypothesis.update({
        where: { id },
        data: { status: 'pending_review' },
      });

      return formatHypothesis(hypothesis);
    } catch {
      return reply.status(404).send({ error: 'Not Found', message: 'Hypothesis not found', statusCode: 404 });
    }
  });

  // Approve hypothesis
  fastify.post('/:id/approve', {
    schema: {
      params: idParamSchema,
      body: approveHypothesisSchema,
      response: {
        200: hypothesisResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { approvedBy } = request.body as ApproveHypothesis;

    try {
      const hypothesis = await prisma.hypothesis.update({
        where: { id },
        data: {
          status: 'approved',
          approvedBy,
          approvedAt: new Date(),
        },
      });

      return formatHypothesis(hypothesis);
    } catch {
      return reply.status(404).send({ error: 'Not Found', message: 'Hypothesis not found', statusCode: 404 });
    }
  });

  // Reject hypothesis
  fastify.post('/:id/reject', {
    schema: {
      params: idParamSchema,
      body: rejectHypothesisSchema,
      response: {
        200: hypothesisResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rejectionReason } = request.body as RejectHypothesis;

    try {
      const hypothesis = await prisma.hypothesis.update({
        where: { id },
        data: {
          status: 'rejected',
          rejectionReason,
        },
      });

      return formatHypothesis(hypothesis);
    } catch {
      return reply.status(404).send({ error: 'Not Found', message: 'Hypothesis not found', statusCode: 404 });
    }
  });

  // Delete hypothesis
  fastify.delete('/:id', {
    schema: {
      params: idParamSchema,
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await prisma.hypothesis.delete({ where: { id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: 'Not Found', message: 'Hypothesis not found', statusCode: 404 });
    }
  });
};
