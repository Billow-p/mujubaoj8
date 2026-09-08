// 客户库路由

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

const CreateCustomerSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  industry: z.string().optional(),
  size: z.string().optional(),
  notes: z.string().optional(),
});

export async function customerRoutes(app: FastifyInstance) {
  // 列表
  app.get('/api/customers', { preHandler: [app.authenticate] }, async (req) => {
    const { companyId } = req.user as any;
    const customers = await prisma.customer.findMany({
      where: { companyId },
      orderBy: { updatedAt: 'desc' },
    });
    return customers;
  });

  // 新建
  app.post('/api/customers', { preHandler: [app.authenticate] }, async (req) => {
    const { companyId } = req.user as any;
    const body = CreateCustomerSchema.parse(req.body);
    return prisma.customer.create({ data: { ...body, companyId } });
  });

  // 详情（含历史统计）
  app.get('/api/customers/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const customer = await prisma.customer.findFirst({ where: { id, companyId } });
    if (!customer) return reply.code(404).send({ error: '客户不存在' });

    const quotes = await prisma.quote.findMany({
      where: { customerId: id, companyId },
      include: {
        versions: {
          orderBy: { versionNo: 'desc' },
          take: 1,
          select: { calcResultJson: true, paramsJson: true, createdAt: true },
        },
      },
    });

    const confirmed = quotes.filter((q: any) => q.status === 'confirmed');
    const grandTotals = quotes.map(
      (q: any) => (q.versions[0]?.calcResultJson as any)?.summary?.grandTotalIncVat || 0,
    );
    const avgGrandTotal =
      grandTotals.length > 0 ? Math.round(grandTotals.reduce((a: number, b: number) => a + b, 0) / grandTotals.length) : 0;

    return {
      ...customer,
      stats: {
        totalQuotes: quotes.length,
        confirmedCount: confirmed.length,
        avgGrandTotal,
        lastQuoteAt: quotes[0]?.createdAt || null,
      },
    };
  });

  // 修改
  app.patch('/api/customers/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const body = CreateCustomerSchema.partial().parse(req.body);
    const c = await prisma.customer.findFirst({ where: { id, companyId } });
    if (!c) return reply.code(404).send({ error: '客户不存在' });
    return prisma.customer.update({ where: { id }, data: body });
  });
}
