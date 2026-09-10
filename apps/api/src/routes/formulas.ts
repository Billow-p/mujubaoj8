// 报价项中心 — 报价项 CRUD + 公式测试 + 发布门禁
// 对应 PRD：P3 报价项 / P7 公式引擎 / P8 条件 / P9 测试发布

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import {
  BUILTIN_VARIABLES,
  testFormula,
} from '../services/formulaTest.js';

const SCOPES = ['mold', 'injection', 'summary'] as const;

const ItemSchema = z.object({
  code: z.string().max(40).optional(),
  name: z.string().min(1).max(40),
  scope: z.enum(SCOPES),
  category: z.string().max(30).optional(),
  unit: z.string().max(20).optional(),
  expression: z.string().min(1).max(500),
  condition: z.string().max(500).optional(),
  sortOrder: z.number().int().optional(),
  note: z.string().max(200).optional(),
});

const UpdateSchema = ItemSchema.partial();

const TestSchema = z.object({
  expression: z.string().min(1).max(500),
  condition: z.string().max(500).optional(),
  variables: z.record(z.number()).optional(), // 测试用的变量值覆盖
});

export async function formulaRoutes(app: FastifyInstance) {
  // ---- 可用变量清单（供公式编辑器下拉提示） ----
  app.get('/api/formulas/variables', { preHandler: [app.authenticate] }, async (req) => {
    const { companyId } = req.user as any;
    const params = await prisma.customParameter.findMany({
      where: { companyId, enabled: true },
      orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
    });
    const items = await prisma.customFormula.findMany({
      where: { companyId },
      select: { name: true, code: true, scope: true },
    });
    return {
      builtin: BUILTIN_VARIABLES,
      customParameters: params.map((p) => ({
        key: p.code,
        label: p.name,
        unit: p.unit,
        group: `自定义参数 · ${p.group}`,
        sample: Number(p.defaultValue ?? 0) || 0,
      })),
      quoteItems: items.map((i) => ({
        key: i.code || i.name,
        label: i.name,
        group: '其它报价项',
        sample: 0,
      })),
    };
  });

  // ---- 公式测试（不保存，PRD 4.5 / 4.6） ----
  app.post('/api/formulas/test', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const body = TestSchema.parse(req.body);

    // 允许引用企业自定义参数 code
    const params = await prisma.customParameter.findMany({
      where: { companyId, enabled: true },
      select: { code: true, defaultValue: true },
    });
    const items = await prisma.customFormula.findMany({
      where: { companyId },
      select: { name: true, code: true },
    });

    const extraKeys = [
      ...params.map((p) => p.code),
      ...items.map((i) => i.code || i.name),
    ];
    const extraVars: Record<string, number> = { ...(body.variables ?? {}) };
    for (const p of params) {
      if (!(p.code in extraVars)) {
        const n = Number(p.defaultValue);
        if (Number.isFinite(n)) extraVars[p.code] = n;
      }
    }

    const result = testFormula(body.expression, body.condition, extraVars, extraKeys);
    if (!result.ok) return reply.code(400).send(result);
    return result;
  });

  // ---- 列表 ----
  app.get('/api/formulas', { preHandler: [app.authenticate] }, async (req) => {
    const { companyId } = req.user as any;
    return prisma.customFormula.findMany({
      where: { companyId },
      orderBy: [{ scope: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  });

  // ---- 新建（默认未启用，需测试通过后启用） ----
  app.post('/api/formulas', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const body = ItemSchema.parse(req.body);
    const existing = await prisma.customFormula.findFirst({
      where: { companyId, scope: body.scope, name: body.name },
    });
    if (existing) {
      return reply.code(400).send({ error: `已存在同名报价项「${body.name}」（scope=${body.scope}）` });
    }
    return prisma.customFormula.create({
      data: {
        ...body,
        companyId,
        enabled: false,
        tested: false,
        version: 1,
      },
    });
  });

  // ---- 更新（改动公式后 tested 复位，必须重测） ----
  app.patch('/api/formulas/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const body = UpdateSchema.parse(req.body);
    const f = await prisma.customFormula.findFirst({ where: { id, companyId } });
    if (!f) return reply.code(404).send({ error: '报价项不存在' });

    const formulaChanged =
      (body.expression !== undefined && body.expression !== f.expression) ||
      (body.condition !== undefined && (body.condition ?? '') !== (f.condition ?? ''));

    return prisma.customFormula.update({
      where: { id },
      data: {
        ...body,
        // 公式/条件变更 → 测试状态复位，未重测不允许保持启用
        ...(formulaChanged ? { tested: false, enabled: false, lastTestResult: null } : {}),
      },
    });
  });

  // ---- 对已有报价项跑测试，并记录结果（PRD 4.5） ----
  app.post('/api/formulas/:id/test', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const body = TestSchema.partial().parse(req.body ?? {});
    const f = await prisma.customFormula.findFirst({ where: { id, companyId } });
    if (!f) return reply.code(404).send({ error: '报价项不存在' });

    const params = await prisma.customParameter.findMany({
      where: { companyId, enabled: true },
      select: { code: true, defaultValue: true },
    });
    const items = await prisma.customFormula.findMany({
      where: { companyId, id: { not: id } },
      select: { name: true, code: true },
    });
    const extraKeys = [
      ...params.map((p) => p.code),
      ...items.map((i) => i.code || i.name),
    ];
    const extraVars: Record<string, number> = { ...(body.variables ?? {}) };
    for (const p of params) {
      if (!(p.code in extraVars)) {
        const n = Number(p.defaultValue);
        if (Number.isFinite(n)) extraVars[p.code] = n;
      }
    }

    const result = testFormula(
      body.expression ?? f.expression,
      body.condition ?? f.condition,
      extraVars,
      extraKeys,
    );

    await prisma.customFormula.update({
      where: { id },
      data: {
        tested: result.ok,
        lastTestAt: new Date(),
        lastTestResult: result.ok
          ? `测试通过，结果 ${result.value}`
          : `测试失败：${result.error}`,
      },
    });

    if (!result.ok) return reply.code(400).send(result);
    return result;
  });

  // ---- 启用（必须通过测试，PRD 4.5：测试失败不得启用） ----
  app.post('/api/formulas/:id/enable', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const f = await prisma.customFormula.findFirst({ where: { id, companyId } });
    if (!f) return reply.code(404).send({ error: '报价项不存在' });
    if (!f.tested) {
      return reply.code(400).send({ error: '请先执行公式测试，测试通过后才能启用' });
    }
    return prisma.customFormula.update({ where: { id }, data: { enabled: true } });
  });

  // ---- 停用 ----
  app.post('/api/formulas/:id/disable', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const f = await prisma.customFormula.findFirst({ where: { id, companyId } });
    if (!f) return reply.code(404).send({ error: '报价项不存在' });
    return prisma.customFormula.update({ where: { id }, data: { enabled: false } });
  });

  // ---- 复制为新版本（PRD 3.7 版本思想） ----
  app.post('/api/formulas/:id/duplicate', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const f = await prisma.customFormula.findFirst({ where: { id, companyId } });
    if (!f) return reply.code(404).send({ error: '报价项不存在' });

    let name = `${f.name} V${f.version + 1}`;
    let n = f.version + 1;
    while (await prisma.customFormula.findFirst({ where: { companyId, scope: f.scope, name } })) {
      n += 1;
      name = `${f.name} V${n}`;
    }
    return prisma.customFormula.create({
      data: {
        companyId,
        code: f.code ? `${f.code}_v${n}` : null,
        name,
        category: f.category,
        scope: f.scope,
        unit: f.unit,
        expression: f.expression,
        condition: f.condition,
        enabled: false,
        tested: false,
        version: n,
        sortOrder: f.sortOrder,
        note: f.note,
      },
    });
  });

  // ---- 删除 ----
  app.delete('/api/formulas/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const f = await prisma.customFormula.findFirst({ where: { id, companyId } });
    if (!f) return reply.code(404).send({ error: '报价项不存在' });
    await prisma.customFormula.delete({ where: { id } });
    return { ok: true };
  });
}
