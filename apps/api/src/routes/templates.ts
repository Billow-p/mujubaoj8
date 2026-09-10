// 报价模板 — 选择报价项组成模板
// 对应 PRD P10

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

const TemplateSchema = z.object({
  name: z.string().min(1).max(40),
  description: z.string().max(200).optional(),
  itemCodes: z.array(z.string().max(40)).default([]),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

const UpdateSchema = TemplateSchema.partial();

export async function templateRoutes(app: FastifyInstance) {
  app.get('/api/templates', { preHandler: [app.authenticate] }, async (req) => {
    const { companyId } = req.user as any;
    return prisma.quoteTemplate.findMany({
      where: { companyId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  });

  app.post('/api/templates', { preHandler: [app.authenticate] }, async (req) => {
    const { companyId } = req.user as any;
    const body = TemplateSchema.parse(req.body);
    const created = await prisma.quoteTemplate.create({
      data: {
        ...body,
        itemCodes: JSON.stringify(body.itemCodes),
        companyId,
      },
    });
    if (body.isDefault) {
      await prisma.quoteTemplate.updateMany({
        where: { companyId, id: { not: created.id } },
        data: { isDefault: false },
      });
    }
    return created;
  });

  app.patch('/api/templates/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const body = UpdateSchema.parse(req.body);
    const t = await prisma.quoteTemplate.findFirst({ where: { id, companyId } });
    if (!t) return reply.code(404).send({ error: '模板不存在' });
    const data: any = { ...body };
    if (body.itemCodes) data.itemCodes = JSON.stringify(body.itemCodes);
    const updated = await prisma.quoteTemplate.update({ where: { id }, data });
    if (body.isDefault) {
      await prisma.quoteTemplate.updateMany({
        where: { companyId, id: { not: id } },
        data: { isDefault: false },
      });
    }
    return updated;
  });

  app.delete('/api/templates/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const t = await prisma.quoteTemplate.findFirst({ where: { id, companyId } });
    if (!t) return reply.code(404).send({ error: '模板不存在' });
    await prisma.quoteTemplate.delete({ where: { id } });
    return { ok: true };
  });
}
