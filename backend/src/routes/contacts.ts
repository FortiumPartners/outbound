import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { idParamSchema, paginationSchema } from '../schemas/common.js';
import {
  createContactSchema,
  updateContactSchema,
  contactResponseSchema,
  CreateContact,
  UpdateContact,
} from '../schemas/universe.js';
import { z } from 'zod';

export const contactRoutes: FastifyPluginAsync = async (fastify) => {
  // List contacts
  fastify.get('/', {
    schema: {
      querystring: paginationSchema.extend({
        accountId: z.string().uuid().optional(),
      }),
      response: {
        200: z.object({
          data: z.array(contactResponseSchema),
          pagination: z.object({
            page: z.number(),
            limit: z.number(),
            total: z.number(),
          }),
        }),
      },
    },
  }, async (request) => {
    const { page, limit, accountId } = request.query as { page: number; limit: number; accountId?: string };
    const skip = (page - 1) * limit;

    const where = accountId ? { accountId } : {};

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.contact.count({ where }),
    ]);

    return {
      data: contacts.map(c => ({
        ...c,
        consentDate: c.consentDate?.toISOString() ?? null,
        lastContactedAt: c.lastContactedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
      pagination: { page, limit, total },
    };
  });

  // Get contact by ID
  fastify.get('/:id', {
    schema: {
      params: idParamSchema,
      response: {
        200: contactResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const contact = await prisma.contact.findUnique({ where: { id } });

    if (!contact) {
      return reply.status(404).send({ error: 'Not Found', message: 'Contact not found', statusCode: 404 });
    }

    return {
      ...contact,
      consentDate: contact.consentDate?.toISOString() ?? null,
      lastContactedAt: contact.lastContactedAt?.toISOString() ?? null,
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
    };
  });

  // Create contact
  fastify.post('/', {
    schema: {
      body: createContactSchema,
      response: {
        201: contactResponseSchema,
      },
    },
  }, async (request, reply) => {
    const data = request.body as CreateContact;

    const contact = await prisma.contact.create({ data });

    return reply.status(201).send({
      ...contact,
      consentDate: contact.consentDate?.toISOString() ?? null,
      lastContactedAt: contact.lastContactedAt?.toISOString() ?? null,
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
    });
  });

  // Update contact
  fastify.patch('/:id', {
    schema: {
      params: idParamSchema,
      body: updateContactSchema,
      response: {
        200: contactResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = request.body as UpdateContact;

    try {
      const contact = await prisma.contact.update({
        where: { id },
        data,
      });

      return {
        ...contact,
        consentDate: contact.consentDate?.toISOString() ?? null,
        lastContactedAt: contact.lastContactedAt?.toISOString() ?? null,
        createdAt: contact.createdAt.toISOString(),
        updatedAt: contact.updatedAt.toISOString(),
      };
    } catch {
      return reply.status(404).send({ error: 'Not Found', message: 'Contact not found', statusCode: 404 });
    }
  });

  // Delete contact
  fastify.delete('/:id', {
    schema: {
      params: idParamSchema,
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await prisma.contact.delete({ where: { id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: 'Not Found', message: 'Contact not found', statusCode: 404 });
    }
  });

  // Opt-out a contact
  fastify.post('/:id/opt-out', {
    schema: {
      params: idParamSchema,
      body: z.object({
        reason: z.string().optional(),
      }),
      response: {
        200: contactResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reason } = request.body as { reason?: string };

    try {
      const contact = await prisma.contact.update({
        where: { id },
        data: {
          consentStatus: 'opted_out',
          consentDate: new Date(),
          consentSource: 'manual_opt_out',
          suppressionReason: reason ?? null,
        },
      });

      return {
        ...contact,
        consentDate: contact.consentDate?.toISOString() ?? null,
        lastContactedAt: contact.lastContactedAt?.toISOString() ?? null,
        createdAt: contact.createdAt.toISOString(),
        updatedAt: contact.updatedAt.toISOString(),
      };
    } catch {
      return reply.status(404).send({ error: 'Not Found', message: 'Contact not found', statusCode: 404 });
    }
  });

  // Suppression list - all opted_out and do_not_contact
  fastify.get('/suppression-list', {
    schema: {
      querystring: paginationSchema,
      response: {
        200: z.object({
          data: z.array(contactResponseSchema),
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

    const where = {
      consentStatus: { in: ['opted_out', 'do_not_contact'] },
    };

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.contact.count({ where }),
    ]);

    return {
      data: contacts.map(c => ({
        ...c,
        consentDate: c.consentDate?.toISOString() ?? null,
        lastContactedAt: c.lastContactedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
      pagination: { page, limit, total },
    };
  });
};
