// 参数中心 — 自定义参数 CRUD
// 对应 PRD P4：参数类型、默认值、必填、编码、停用

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

export const PARAM_TYPES = [
  'text',
  'int',
  'decimal',
  'money',
  'percent',
  'select',
  'multiselect',
  'switch',
  'date',
] as const;

const ParamSchema = z.object({
  code: z.string().min(1).max(40).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, '编码需以字母开头，仅含字母数字下划线'),
  name: z.string().min(1).max(40),
  type: z.enum(PARAM_TYPES).optional(),
  unit: z.string().max(10).optional(),
  defaultValue: z.string().max(100).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().max(50)).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  group: z.string().max(20).optional(),
  sortOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
  remark: z.string().max(200).optional(),
});

const UpdateSchema = ParamSchema.partial();

export async function parameterRoutes(app: FastifyInstance) {
  // 列表（可按分组过滤，只返回启用的给报价页用）
  app.get('/api/parameters', { preHandler: [app.authenticate] }, async (req) => {
    const { companyId } = req.user as any;
    const q = req.query as any;
    const where: any = { companyId };
    if (q.group) where.group = q.group;
    if (q.enabled === 'true') where.enabled = true;
    return prisma.customParameter.findMany({
      where,
      orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  });

  app.post('/api/parameters', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const body = ParamSchema.parse(req.body);
    const dup = await prisma.customParameter.findFirst({
      where: { companyId, code: body.code },
    });
    if (dup) return reply.code(400).send({ error: `参数编码「${body.code}」已存在` });
    return prisma.customParameter.create({
      data: {
        ...body,
        options: body.options ? JSON.stringify(body.options) : null,
        companyId,
      },
    });
  });

  app.patch('/api/parameters/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const body = UpdateSchema.parse(req.body);
    const p = await prisma.customParameter.findFirst({ where: { id, companyId } });
    if (!p) return reply.code(404).send({ error: '参数不存在' });
    const data: any = { ...body };
    if (body.options) data.options = JSON.stringify(body.options);
    return prisma.customParameter.update({ where: { id }, data });
  });

  // 停用/启用（不物理删除，避免历史报价引用断裂）
  app.post('/api/parameters/:id/toggle', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const p = await prisma.customParameter.findFirst({ where: { id, companyId } });
    if (!p) return reply.code(404).send({ error: '参数不存在' });
    return prisma.customParameter.update({
      where: { id },
      data: { enabled: !p.enabled },
    });
  });

  app.delete('/api/parameters/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const p = await prisma.customParameter.findFirst({ where: { id, companyId } });
    if (!p) return reply.code(404).send({ error: '参数不存在' });
    await prisma.customParameter.delete({ where: { id } });
    return { ok: true };
  });
}
