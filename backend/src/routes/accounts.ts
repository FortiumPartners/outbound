import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { idParamSchema, paginationSchema } from '../schemas/common.js';
import {
  createAccountSchema,
  updateAccountSchema,
  accountResponseSchema,
  CreateAccount,
  UpdateAccount,
} from '../schemas/universe.js';
import { z } from 'zod';

export const accountRoutes: FastifyPluginAsync = async (fastify) => {
  // List accounts
  fastify.get('/', {
    schema: {
      querystring: paginationSchema,
      response: {
        200: z.object({
          data: z.array(accountResponseSchema),
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

    const [accounts, total] = await Promise.all([
      prisma.account.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.account.count(),
    ]);

    return {
      data: accounts.map(a => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
      pagination: { page, limit, total },
    };
  });

  // Get account by ID
  fastify.get('/:id', {
    schema: {
      params: idParamSchema,
      response: {
        200: accountResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const account = await prisma.account.findUnique({ where: { id } });

    if (!account) {
      return reply.status(404).send({ error: 'Not Found', message: 'Account not found', statusCode: 404 });
    }

    return {
      ...account,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    };
  });

  // Create account
  fastify.post('/', {
    schema: {
      body: createAccountSchema,
      response: {
        201: accountResponseSchema,
      },
    },
  }, async (request, reply) => {
    const data = request.body as CreateAccount;

    const account = await prisma.account.create({ data });

    return reply.status(201).send({
      ...account,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    });
  });

  // Update account
  fastify.patch('/:id', {
    schema: {
      params: idParamSchema,
      body: updateAccountSchema,
      response: {
        200: accountResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = request.body as UpdateAccount;

    try {
      const account = await prisma.account.update({
        where: { id },
        data,
      });

      return {
        ...account,
        createdAt: account.createdAt.toISOString(),
        updatedAt: account.updatedAt.toISOString(),
      };
    } catch {
      return reply.status(404).send({ error: 'Not Found', message: 'Account not found', statusCode: 404 });
    }
  });

  // Delete account
  fastify.delete('/:id', {
    schema: {
      params: idParamSchema,
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await prisma.account.delete({ where: { id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: 'Not Found', message: 'Account not found', statusCode: 404 });
    }
  });
};
