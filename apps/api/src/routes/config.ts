// 配置中心 API — 模具类型 + 按类型整体读写配置 + 试算
// 设计：前端在一个页面里完成「参数 → 费用项 → 算价」，所以提供整体读写接口

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { calculateConfigured } from '@mqs/calc-engine';
import type { QuoteItemDef } from '@mqs/shared';
import { MOLD_PRESETS } from '../services/moldPresets.js';

const CALC_TYPES = ['fixed', 'qty', 'size', 'hours', 'weight', 'percent', 'manual', 'formula'] as const;

/** options 在库里是 String（JSON），对外统一给数组 */
function parseOptions(raw: string | null | undefined): { label: string; value: number }[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const ItemSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(50),
  category: z.string().max(30).optional(),
  scope: z.enum(['mold', 'injection']).optional(),
  calcType: z.enum(CALC_TYPES),
  calcConfig: z.record(z.any()).nullable().optional(),
  expression: z.string().max(1000).nullable().optional(),
  perUnit: z.boolean().optional(),
  unit: z.string().max(20).nullable().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  note: z.string().max(200).nullable().optional(),
});

const ParamSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(1).max(40).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, '编码需以字母开头，仅含字母数字下划线'),
  name: z.string().min(1).max(40),
  unit: z.string().max(10).nullable().optional(),
  defaultValue: z.union([z.string(), z.number()]).nullable().optional(),
  group: z.string().max(20).optional(),
  scope: z.enum(['mold', 'injection', 'common']).optional(),
  type: z.string().max(20).optional(),
  options: z
    .array(z.object({ label: z.string().max(40), value: z.number() }))
    .max(30)
    .nullable()
    .optional(),
  enabled: z.boolean().optional(),
});

const MatSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(50),
  category: z.string().max(30).optional(),
  subCategory: z.string().max(30).nullable().optional(),
  unit: z.string().max(10).optional(),
  density: z.number().nullable().optional(),
  lossRate: z.number().min(0).max(1).optional(),
  currentPrice: z.number().min(0).optional(),
});

const TermSchema = z.object({
  id: z.string().optional(),
  text: z.string().min(1).max(500),
  enabled: z.boolean().optional(),
});

const SaveSchema = z.object({
  parameters: z.array(ParamSchema).max(200).optional(),
  materials: z.array(MatSchema).max(200).optional(),
  terms: z.array(TermSchema).max(100).optional(),
  items: z.array(ItemSchema).max(200).optional(),
  profitRate: z.number().min(0).max(1).optional(),
  taxRate: z.number().min(0).max(1).optional(),
});

export async function configRoutes(app: FastifyInstance) {
  // ---------------- 模具类型 ----------------
  app.get('/api/mold-types', { preHandler: [app.authenticate] }, async (req) => {
    const { companyId } = req.user as any;
    const list = await prisma.moldType.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { items: true, parameters: true, materials: true, terms: true } } },
    });
    return list.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      sortOrder: m.sortOrder,
      enabled: m.enabled,
      isPreset: m.isPreset,
      profitRate: m.profitRate,
      taxRate: m.taxRate,
      counts: m._count,
    }));
  });

  // 一键初始化三套预置类型（已存在的同名类型跳过）
  app.post('/api/mold-types/init-preset', { preHandler: [app.authenticate] }, async (req) => {
    const { companyId } = req.user as any;
    let created = 0;
    for (const [idx, p] of MOLD_PRESETS.entries()) {
      const exists = await prisma.moldType.findFirst({ where: { companyId, code: p.code } });
      if (exists) continue;
      await createPresetMoldType(companyId, p, idx);
      created += 1;
    }
    return { ok: true, created, total: MOLD_PRESETS.length };
  });

  // 新建（可选从现有类型复制）
  app.post('/api/mold-types', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const body = z
      .object({ name: z.string().min(1).max(40), code: z.string().max(40).optional(), copyFromId: z.string().optional() })
      .parse(req.body);

    const code = body.code?.trim() || `custom_${Date.now()}`;
    const dup = await prisma.moldType.findFirst({ where: { companyId, code } });
    if (dup) return reply.code(400).send({ error: `编码「${code}」已存在` });

    const max = await prisma.moldType.aggregate({ where: { companyId }, _max: { sortOrder: true } });
    const moldType = await prisma.moldType.create({
      data: {
        companyId,
        code,
        name: body.name,
        sortOrder: (max._max.sortOrder ?? 0) + 1,
        profitRate: 0.1,
        taxRate: 0.13,
      },
    });

    if (body.copyFromId) {
      await copyConfig(companyId, body.copyFromId, moldType.id);
    } else {
      // 默认给一套最小可用配置，避免空白页。
      // 注意：这里不放「管理费」—— 业务方明确要求它不进预置，需要时由用户自己加。
      await prisma.customParameter.createMany({
        data: [
          { companyId, moldTypeId: moldType.id, code: 'cavityCount', name: '腔数', unit: '穴', defaultValue: '1', group: '产品', sortOrder: 0 },
          // 通用数量参数，按件计价要用；引擎会按
          // 注塑数量 / 压铸数量 / 成型数量 / 订单数量 自动查找
          { companyId, moldTypeId: moldType.id, code: 'orderQty', name: '订单数量', unit: '件', defaultValue: '5000', group: '商务', sortOrder: 1 },
        ],
      });
    }
    return moldType;
  });

  app.patch('/api/mold-types/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const body = z
      .object({
        name: z.string().min(1).max(40).optional(),
        sortOrder: z.number().int().optional(),
        enabled: z.boolean().optional(),
        profitRate: z.number().min(0).max(1).optional(),
        taxRate: z.number().min(0).max(1).optional(),
      })
      .parse(req.body);
    const mt = await prisma.moldType.findFirst({ where: { id, companyId } });
    if (!mt) return reply.code(404).send({ error: '模具类型不存在' });
    return prisma.moldType.update({ where: { id }, data: body });
  });

  app.delete('/api/mold-types/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const mt = await prisma.moldType.findFirst({ where: { id, companyId } });
    if (!mt) return reply.code(404).send({ error: '模具类型不存在' });
    const total = await prisma.moldType.count({ where: { companyId } });
    if (total <= 1) return reply.code(400).send({ error: '至少要保留一个模具类型' });
    await prisma.moldType.delete({ where: { id } }); // 级联删除其下配置
    return { ok: true };
  });

  // ---------------- 配置读写（整体） ----------------
  app.get('/api/config/:moldTypeId', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { moldTypeId } = req.params as any;
    const moldType = await prisma.moldType.findFirst({ where: { id: moldTypeId, companyId } });
    if (!moldType) return reply.code(404).send({ error: '模具类型不存在' });

    // 材料不在这里返回 —— 材料是全局库，请用 GET /api/materials（材料中心）
    const [parameters, terms, items] = await Promise.all([
      prisma.customParameter.findMany({ where: { companyId, moldTypeId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      prisma.businessTerm.findMany({ where: { companyId, moldTypeId }, orderBy: { sortOrder: 'asc' } }),
      prisma.quoteItem.findMany({ where: { companyId, moldTypeId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    return {
      moldType,
      parameters: parameters.map((p) => ({ ...p, options: parseOptions(p.options) })),
      terms,
      items,
    };
  });

  app.put('/api/config/:moldTypeId', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { moldTypeId } = req.params as any;
    const moldType = await prisma.moldType.findFirst({ where: { id: moldTypeId, companyId } });
    if (!moldType) return reply.code(404).send({ error: '模具类型不存在' });

    const body = SaveSchema.parse(req.body);

    await prisma.$transaction(async (tx) => {
      // 参数
      if (body.parameters) {
        const ids = body.parameters.map((p) => p.id).filter(Boolean) as string[];
        await tx.customParameter.deleteMany({ where: { companyId, moldTypeId, id: { notIn: ids } } });
        for (const [i, p] of body.parameters.entries()) {
          const data: any = {
            code: p.code,
            name: p.name,
            unit: p.unit ?? null,
            defaultValue: p.defaultValue == null ? null : String(p.defaultValue),
            group: p.group ?? '通用',
            scope: p.scope ?? 'common',
            type: p.type ?? 'decimal',
            options: p.options && p.options.length ? JSON.stringify(p.options) : null,
            sortOrder: i,
            enabled: p.enabled !== false,
          };
          if (p.id) await tx.customParameter.update({ where: { id: p.id }, data });
          else await tx.customParameter.create({ data: { ...data, companyId, moldTypeId } });
        }
      }
      // 材料：**刻意不再处理** —— 材料统一由「材料中心」（全局库，moldTypeId = null）维护。
      // 这里以前会按传入列表增删改「模具类型专属副本」，导致同一材料存在两份价格，
      // 改了一份另一份不生效。保留 body.materials 的解析兼容，但**忽略其内容**，
      // 顺便也防止老客户端把材料整批删掉。
      // 条款
      if (body.terms) {
        const ids = body.terms.map((t) => t.id).filter(Boolean) as string[];
        await tx.businessTerm.deleteMany({ where: { companyId, moldTypeId, id: { notIn: ids } } });
        for (const [i, t] of body.terms.entries()) {
          const data: any = { text: t.text, enabled: t.enabled !== false, sortOrder: i };
          if (t.id) await tx.businessTerm.update({ where: { id: t.id }, data });
          else await tx.businessTerm.create({ data: { ...data, companyId, moldTypeId } });
        }
      }
      // 费用项
      if (body.items) {
        const ids = body.items.map((x) => x.id).filter(Boolean) as string[];
        await tx.quoteItem.deleteMany({ where: { companyId, moldTypeId, id: { notIn: ids } } });
        for (const [i, it] of body.items.entries()) {
          const data: any = {
            name: it.name,
            category: it.category ?? '自定义',
            scope: it.scope ?? 'mold',
            calcType: it.calcType,
            calcConfig: it.calcConfig ?? undefined,
            expression: it.expression ?? null,
            perUnit: it.perUnit === true,
            unit: it.unit ?? null,
            enabled: it.enabled !== false,
            sortOrder: i,
            note: it.note ?? null,
          };
          if (it.id) await tx.quoteItem.update({ where: { id: it.id }, data });
          else await tx.quoteItem.create({ data: { ...data, companyId, moldTypeId } });
        }
      }
      // 费率
      if (body.profitRate !== undefined || body.taxRate !== undefined) {
        await tx.moldType.update({
          where: { id: moldTypeId },
          data: {
            ...(body.profitRate !== undefined ? { profitRate: body.profitRate } : {}),
            ...(body.taxRate !== undefined ? { taxRate: body.taxRate } : {}),
          },
        });
      }
    });

    return { ok: true };
  });

  // ---------------- 试算 ----------------
  app.post('/api/config/:moldTypeId/calc', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { moldTypeId } = req.params as any;
    const body = z.object({ params: z.record(z.number()).optional() }).parse(req.body ?? {});

    const moldType = await prisma.moldType.findFirst({ where: { id: moldTypeId, companyId } });
    if (!moldType) return reply.code(404).send({ error: '模具类型不存在' });

    const [parameters, items] = await Promise.all([
      prisma.customParameter.findMany({ where: { companyId, moldTypeId, enabled: true } }),
      prisma.quoteItem.findMany({ where: { companyId, moldTypeId }, orderBy: { sortOrder: 'asc' } }),
    ]);

    // 参数名 → 数值（表达式里用的是中文名）
    const params: Record<string, number> = {};
    for (const p of parameters) {
      const n = Number(p.defaultValue);
      if (Number.isFinite(n)) params[p.name] = n;
    }
    Object.assign(params, body.params ?? {});

    const defs: QuoteItemDef[] = items.map((it, i) => ({
      id: it.id,
      name: it.name,
      category: it.category,
      scope: (it.scope as 'mold' | 'injection') ?? 'mold',
      calcType: it.calcType as any,
      calcConfig: (it.calcConfig ?? {}) as any,
      expression: it.expression ?? undefined,
      enabled: it.enabled,
      sortOrder: i,
      perUnit: it.scope === 'injection' && it.perUnit === true,
      unit: it.unit ?? undefined,
      note: it.note ?? undefined,
    }));

    const result = calculateConfigured(defs, params, {
      profitRate: moldType.profitRate,
      taxRate: moldType.taxRate,
    });
    return { ...result, params };
  });
}

/** 用预置模板创建一整套模具类型配置 */
async function createPresetMoldType(companyId: string, p: (typeof MOLD_PRESETS)[number], sortOrder: number) {
  const moldType = await prisma.moldType.create({
    data: {
      companyId,
      code: p.code,
      name: p.name,
      sortOrder,
      isPreset: true,
      profitRate: p.profitRate,
      taxRate: p.taxRate,
    },
  });
  await prisma.customParameter.createMany({
    data: p.params.map((x, i) => ({
      companyId,
      moldTypeId: moldType.id,
      code: x.code,
      name: x.name,
      unit: x.unit,
      defaultValue: String(x.value),
      group: x.group,
      scope: x.scope ?? 'common',
      type: x.type ?? 'decimal',
      options: x.options ? JSON.stringify(x.options) : null,
      sortOrder: i,
    })),
  });
  // 不再为新模具类型复制一份「专属材料」——材料统一在材料中心（全局库）维护。
  // 全局库由「材料中心 → 初始化预置材料」负责，这里只建参数/条款/费用项。
  await prisma.businessTerm.createMany({
    data: p.terms.map((t, i) => ({ companyId, moldTypeId: moldType.id, text: t, sortOrder: i })),
  });
  await prisma.quoteItem.createMany({
    data: p.items.map((it, i) => ({
      companyId,
      moldTypeId: moldType.id,
      name: it.name,
      category: it.category,
      scope: it.scope,
      calcType: it.calcType,
      calcConfig: it.calcConfig as any,
      expression: it.expression ?? null,
      perUnit: it.perUnit === true,
      sortOrder: i,
    })),
  });
  return moldType;
}

/** 复制一套配置到新类型 */
async function copyConfig(companyId: string, fromId: string, toId: string) {
  // 材料不参与复制：材料是全局库，不属于某个模具类型
  const [params, terms, items] = await Promise.all([
    prisma.customParameter.findMany({ where: { companyId, moldTypeId: fromId } }),
    prisma.businessTerm.findMany({ where: { companyId, moldTypeId: fromId } }),
    prisma.quoteItem.findMany({ where: { companyId, moldTypeId: fromId } }),
  ]);
  if (params.length) {
    await prisma.customParameter.createMany({
      data: params.map((x, i) => ({
        companyId, moldTypeId: toId, code: x.code, name: x.name, type: x.type,
        unit: x.unit, defaultValue: x.defaultValue, group: x.group, scope: x.scope, options: x.options,
        sortOrder: i, enabled: x.enabled,
      })),
    });
  }
  if (terms.length) {
    await prisma.businessTerm.createMany({
      data: terms.map((t, i) => ({ companyId, moldTypeId: toId, text: t.text, enabled: t.enabled, sortOrder: i })),
    });
  }
  if (items.length) {
    await prisma.quoteItem.createMany({
      data: items.map((it, i) => ({
        companyId, moldTypeId: toId, name: it.name, category: it.category, scope: it.scope,
        calcType: it.calcType, calcConfig: it.calcConfig as any, expression: it.expression,
        perUnit: it.perUnit, enabled: it.enabled, sortOrder: i, unit: it.unit, note: it.note,
      })),
    });
  }
}
