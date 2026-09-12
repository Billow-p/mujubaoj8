// 客户库路由

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { calcTotal } from '../services/quoteTotal.js';
import { buildCustomersExcel } from '../services/customersExcel.js';
import { QTY_VAR_CANDIDATES } from '@mqs/shared';

/** 从报价单参数里取「数量」—— 各模具类型叫法不同，与计算引擎共用同一份候选列表 */
function pickQty(vals: any, params: any): number {
  for (const n of QTY_VAR_CANDIDATES) {
    const v = vals?.[n];
    if (v !== undefined && v !== null && v !== '') return Number(v) || 0;
  }
  return Number(params?.firstOrderQty) || 0;
}

const CreateCustomerSchema = z.object({
  code: z.string().max(30).optional(),
  name: z.string().min(1),
  contactName: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  industry: z.string().optional(),
  size: z.string().optional(),
  notes: z.string().optional(),
});

export async function customerRoutes(app: FastifyInstance) {
  // 一键导出全部客户数据（Sheet1 报价明细 + Sheet2 客户汇总）
  // 注意要挂在 :id 路由之前，避免 "export-all" 被当成 id
  app.get('/api/customers/export-all', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const buf = await buildCustomersExcel(companyId);
    const today = new Date();
    const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(`客户数据_${stamp}.xlsx`)}"`)
      .send(buf);
  });

  // 列表（含报价统计，PRD 6.1 / 6.2）
  app.get('/api/customers', { preHandler: [app.authenticate] }, async (req) => {
    const { companyId } = req.user as any;
    const q = req.query as any;
    const where: any = { companyId };
    if (q.keyword) {
      where.OR = [
        { name: { contains: q.keyword, mode: 'insensitive' } },
        { code: { contains: q.keyword, mode: 'insensitive' } },
        { contactName: { contains: q.keyword, mode: 'insensitive' } },
        { phone: { contains: q.keyword, mode: 'insensitive' } },
      ];
    }
    const customers = await prisma.customer.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { quotes: true } },
        quotes: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            quoteNo: true,
            status: true,
            createdAt: true,
            versions: {
              orderBy: { versionNo: 'desc' },
              take: 1,
              select: { calcResultJson: true },
            },
          },
        },
      },
    });

    // 成交数单独统计
    const confirmedGroups = await prisma.quote.groupBy({
      by: ['customerId'],
      where: { companyId, status: 'confirmed', customerId: { not: null } },
      _count: { _all: true },
    });
    const confirmedMap = new Map(
      confirmedGroups.map((g: any) => [g.customerId, g._count._all]),
    );

    return customers.map((c: any) => {
      const last = c.quotes[0];
      return {
        id: c.id,
        code: c.code,
        name: c.name,
        contactName: c.contactName,
        email: c.email,
        phone: c.phone,
        address: c.address,
        industry: c.industry,
        size: c.size,
        notes: c.notes,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        stats: {
          totalQuotes: c._count.quotes,
          confirmedCount: confirmedMap.get(c.id) ?? 0,
          lastQuoteAt: last?.createdAt ?? null,
          lastQuoteNo: last?.quoteNo ?? null,
          lastQuoteId: last?.id ?? null,
          lastAmount: last?.versions?.[0] ? calcTotal(last.versions[0].calcResultJson) || null : null,
        },
      };
    });
  });

  // 客户的历史报价（PRD 6.2）
  app.get('/api/customers/:id/quotes', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const customer = await prisma.customer.findFirst({ where: { id, companyId } });
    if (!customer) return reply.code(404).send({ error: '客户不存在' });

    const quotes = await prisma.quote.findMany({
      where: { customerId: id, companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        versions: {
          orderBy: { versionNo: 'desc' },
          take: 1,
          select: { versionNo: true, calcResultJson: true, paramsJson: true },
        },
      },
    });

    return quotes.map((q: any) => {
      const v = q.versions[0];
      const params = (v?.paramsJson ?? {}) as any;
      const vals = (params.values ?? {}) as any;
      return {
        id: q.id,
        quoteNo: q.quoteNo,
        status: q.status,
        createdAt: q.createdAt,
        sentAt: q.sentAt,
        confirmedAt: q.confirmedAt,
        expiresAt: q.expiresAt,
        versionNo: v?.versionNo ?? 1,
        productName: params.productName ?? '',
        material: params.material ?? '',
        // 数量参数各类型叫法不同（注塑数量 / 压铸数量 / 成型数量 / 订单数量），按候选名取
        firstOrderQty: pickQty(vals, params),
        grandTotalIncVat: calcTotal(v?.calcResultJson),
      };
    });
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
    const grandTotals = quotes.map((q: any) => calcTotal(q.versions[0]?.calcResultJson));
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
