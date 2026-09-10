// 材料中心 — 企业材料库 + 价格版本 + 阶梯价
// 对应 PRD：P5 材料中心 / P6 价格规则 / 3.7 价格版本

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

// PRD 3.5 预置材料（单价为行业参考值，企业可改）
const PRESET_MATERIALS: {
  code: string;
  name: string;
  category: string;
  unit: string;
  density?: number;
  lossRate: number;
  price: number;
  remark?: string;
}[] = [
  { code: 'ABS', name: 'ABS', category: '塑料原料', unit: 'kg', density: 1.05, lossRate: 0.05, price: 12 },
  { code: 'PP', name: 'PP', category: '塑料原料', unit: 'kg', density: 0.9, lossRate: 0.05, price: 9.5 },
  { code: 'PC', name: 'PC', category: '塑料原料', unit: 'kg', density: 1.2, lossRate: 0.05, price: 26 },
  { code: 'PA', name: 'PA（尼龙）', category: '塑料原料', unit: 'kg', density: 1.14, lossRate: 0.06, price: 28 },
  { code: 'POM', name: 'POM', category: '塑料原料', unit: 'kg', density: 1.41, lossRate: 0.05, price: 18 },
  { code: 'PMMA', name: 'PMMA（亚克力）', category: '塑料原料', unit: 'kg', density: 1.18, lossRate: 0.06, price: 20 },
  { code: 'PVC', name: 'PVC', category: '塑料原料', unit: 'kg', density: 1.4, lossRate: 0.05, price: 8 },
  { code: 'TPU', name: 'TPU', category: '塑料原料', unit: 'kg', density: 1.2, lossRate: 0.06, price: 35 },
  { code: 'PBT', name: 'PBT', category: '塑料原料', unit: 'kg', density: 1.31, lossRate: 0.05, price: 22 },
  { code: 'PPS', name: 'PPS', category: '塑料原料', unit: 'kg', density: 1.35, lossRate: 0.06, price: 65 },
  { code: 'PE', name: 'PE', category: '塑料原料', unit: 'kg', density: 0.95, lossRate: 0.05, price: 9 },
  // 常用模具钢材
  { code: 'P20', name: 'P20 预硬钢', category: '模具钢材', unit: 'kg', density: 7.85, lossRate: 0.1, price: 25 },
  { code: '718H', name: '718H 预硬钢', category: '模具钢材', unit: 'kg', density: 7.85, lossRate: 0.1, price: 32 },
  { code: 'S136', name: 'S136 镜面钢', category: '模具钢材', unit: 'kg', density: 7.85, lossRate: 0.12, price: 55 },
  { code: 'NAK80', name: 'NAK80 镜面钢', category: '模具钢材', unit: 'kg', density: 7.85, lossRate: 0.12, price: 60 },
  { code: 'H13', name: 'H13 热作钢', category: '模具钢材', unit: 'kg', density: 7.85, lossRate: 0.12, price: 45 },
];

const MaterialSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(50),
  category: z.string().max(30).optional(),
  unit: z.string().max(10).optional(),
  density: z.number().nonnegative().optional(),
  lossRate: z.number().min(0).max(1).optional(),
  currentPrice: z.number().nonnegative().optional(),
  currency: z.string().max(10).optional(),
  priceRule: z.enum(['fixed', 'tiered']).optional(),
  priceTiers: z
    .array(z.object({ minQty: z.number(), maxQty: z.number().nullable(), price: z.number() }))
    .optional(),
  remark: z.string().max(200).optional(),
  enabled: z.boolean().optional(),
});

const UpdateSchema = MaterialSchema.partial();

// 按数量取阶梯价
export function resolvePrice(
  material: { currentPrice: number; priceRule: string; priceTiers?: string | null },
  qty?: number,
): number {
  if (material.priceRule === 'tiered' && material.priceTiers && qty != null) {
    try {
      const tiers = JSON.parse(material.priceTiers) as {
        minQty: number;
        maxQty: number | null;
        price: number;
      }[];
      for (const t of tiers) {
        if (qty >= t.minQty && (t.maxQty == null || qty <= t.maxQty)) return t.price;
      }
    } catch {
      /* 解析失败回落固定价 */
    }
  }
  return material.currentPrice;
}

export async function materialRoutes(app: FastifyInstance) {
  // 列表
  app.get('/api/materials', { preHandler: [app.authenticate] }, async (req) => {
    const { companyId } = req.user as any;
    return prisma.material.findMany({
      where: { companyId },
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
    });
  });

  // 初始化预置材料（只补不存在的，不覆盖企业已改价格）
  app.post('/api/materials/seed-preset', { preHandler: [app.authenticate] }, async (req) => {
    const { companyId } = req.user as any;
    const existing = await prisma.material.findMany({
      where: { companyId },
      select: { code: true },
    });
    const have = new Set(existing.map((m) => m.code));
    let created = 0;
    for (const m of PRESET_MATERIALS) {
      if (have.has(m.code)) continue;
      await prisma.material.create({
        data: {
          companyId,
          code: m.code,
          name: m.name,
          category: m.category,
          unit: m.unit,
          density: m.density,
          lossRate: m.lossRate,
          currentPrice: m.price,
          priceRule: 'fixed',
          isPreset: true,
          enabled: true,
          remark: m.remark,
          prices: { create: [{ version: 1, price: m.price, note: '预置初始价' }] },
        },
      });
      created += 1;
    }
    return { ok: true, created, total: PRESET_MATERIALS.length };
  });

  // 新建自定义材料
  app.post('/api/materials', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const body = MaterialSchema.parse(req.body);
    const dup = await prisma.material.findFirst({ where: { companyId, code: body.code } });
    if (dup) return reply.code(400).send({ error: `材料编码「${body.code}」已存在` });

    const price = body.currentPrice ?? 0;
    return prisma.material.create({
      data: {
        ...body,
        priceTiers: body.priceTiers ? JSON.stringify(body.priceTiers) : null,
        companyId,
        isPreset: false,
        prices: { create: [{ version: 1, price, note: '新建初始价' }] },
      },
    });
  });

  // 更新基础信息
  app.patch('/api/materials/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const body = UpdateSchema.parse(req.body);
    const m = await prisma.material.findFirst({ where: { id, companyId } });
    if (!m) return reply.code(404).send({ error: '材料不存在' });

    const data: any = { ...body };
    if (body.priceTiers) data.priceTiers = JSON.stringify(body.priceTiers);
    if (body.currentPrice !== undefined && body.currentPrice !== m.currentPrice) {
      // 改价 → 生成新价格版本（PRD 3.7）
      const last = await prisma.materialPrice.findFirst({
        where: { materialId: id },
        orderBy: { version: 'desc' },
      });
      await prisma.materialPrice.create({
        data: {
          materialId: id,
          version: (last?.version ?? 0) + 1,
          price: body.currentPrice,
          note: '价格调整',
        },
      });
    }
    return prisma.material.update({ where: { id }, data });
  });

  // 价格历史
  app.get('/api/materials/:id/prices', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const m = await prisma.material.findFirst({ where: { id, companyId } });
    if (!m) return reply.code(404).send({ error: '材料不存在' });
    return prisma.materialPrice.findMany({
      where: { materialId: id },
      orderBy: { version: 'desc' },
    });
  });

  // 删除（仅允许删企业自建材料）
  app.delete('/api/materials/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const m = await prisma.material.findFirst({ where: { id, companyId } });
    if (!m) return reply.code(404).send({ error: '材料不存在' });
    if (m.isPreset) return reply.code(400).send({ error: '预置材料不允许删除，可停用' });
    await prisma.material.delete({ where: { id } });
    return { ok: true };
  });
}
