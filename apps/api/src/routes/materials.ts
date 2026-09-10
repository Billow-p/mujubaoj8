// 材料中心 — 企业材料库 + 价格版本 + 阶梯价
// 对应 PRD：P5 材料中心 / P6 价格规则 / 3.7 价格版本

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

// 预置材料（单价为行业参考值，企业可改）
//
// 分类按行业主流分两级：
//   一级 = 用途场景（模具钢材 / 塑料原料 / 压铸合金 / 辅助材料）
//   二级 = 材质体系（热作模具钢 / 工程塑料 / 铝合金 …）
// 详见 packages/shared 的 MATERIAL_GROUPS / MATERIAL_SUB_CATEGORIES
const PRESET_MATERIALS: {
  code: string;
  name: string;
  category: string; // 一级分类
  subCategory: string; // 二级分类
  unit: string;
  density?: number;
  lossRate: number;
  price: number;
  remark?: string;
}[] = [
  // ---------- 模具钢材 ----------
  // 预硬塑胶模具钢：出厂已预硬，可直接加工，注塑模最常用
  { code: 'P20', name: 'P20 预硬钢', category: '模具钢材', subCategory: '预硬塑胶模具钢', unit: 'kg', density: 7.85, lossRate: 0.1, price: 25 },
  { code: '718H', name: '718H 预硬钢', category: '模具钢材', subCategory: '预硬塑胶模具钢', unit: 'kg', density: 7.85, lossRate: 0.1, price: 32 },
  { code: 'NAK80', name: 'NAK80 镜面预硬钢', category: '模具钢材', subCategory: '预硬塑胶模具钢', unit: 'kg', density: 7.85, lossRate: 0.12, price: 60 },
  // 镜面耐腐蚀钢：透明件、腐蚀性塑料（PVC/阻燃料）
  { code: 'S136', name: 'S136 镜面耐腐蚀钢', category: '模具钢材', subCategory: '镜面耐腐蚀钢', unit: 'kg', density: 7.85, lossRate: 0.12, price: 55 },
  { code: '2316', name: '2316 耐腐蚀钢', category: '模具钢材', subCategory: '镜面耐腐蚀钢', unit: 'kg', density: 7.85, lossRate: 0.12, price: 52 },
  // 热作模具钢：压铸模、需长时间耐高温
  { code: 'H13', name: 'H13 热作钢', category: '模具钢材', subCategory: '热作模具钢', unit: 'kg', density: 7.85, lossRate: 0.12, price: 45 },
  { code: '8407', name: '8407 热作钢', category: '模具钢材', subCategory: '热作模具钢', unit: 'kg', density: 7.85, lossRate: 0.12, price: 78 },
  { code: 'DAC55', name: 'DAC55 热作钢', category: '模具钢材', subCategory: '热作模具钢', unit: 'kg', density: 7.85, lossRate: 0.12, price: 85 },
  // 冷作模具钢：冲压、冷镦
  { code: 'CR12MOV', name: 'Cr12MoV 冷作钢', category: '模具钢材', subCategory: '冷作模具钢', unit: 'kg', density: 7.7, lossRate: 0.1, price: 38 },
  { code: 'SKD11', name: 'SKD11 冷作钢', category: '模具钢材', subCategory: '冷作模具钢', unit: 'kg', density: 7.7, lossRate: 0.1, price: 58 },

  // ---------- 塑料原料 ----------
  // 通用塑料：产量大、价格低，日用品为主
  { code: 'PP', name: 'PP 聚丙烯', category: '塑料原料', subCategory: '通用塑料', unit: 'kg', density: 0.9, lossRate: 0.05, price: 9.5 },
  { code: 'PE', name: 'PE 聚乙烯', category: '塑料原料', subCategory: '通用塑料', unit: 'kg', density: 0.95, lossRate: 0.05, price: 9 },
  { code: 'ABS', name: 'ABS', category: '塑料原料', subCategory: '通用塑料', unit: 'kg', density: 1.05, lossRate: 0.05, price: 12 },
  { code: 'PVC', name: 'PVC 聚氯乙烯', category: '塑料原料', subCategory: '通用塑料', unit: 'kg', density: 1.4, lossRate: 0.05, price: 8 },
  // 工程塑料：力学与耐热性能好，结构件常用
  { code: 'PA', name: 'PA 尼龙', category: '塑料原料', subCategory: '工程塑料', unit: 'kg', density: 1.14, lossRate: 0.06, price: 28 },
  { code: 'PC', name: 'PC 聚碳酸酯', category: '塑料原料', subCategory: '工程塑料', unit: 'kg', density: 1.2, lossRate: 0.05, price: 26 },
  { code: 'POM', name: 'POM 赛钢', category: '塑料原料', subCategory: '工程塑料', unit: 'kg', density: 1.41, lossRate: 0.05, price: 18 },
  { code: 'PBT', name: 'PBT', category: '塑料原料', subCategory: '工程塑料', unit: 'kg', density: 1.31, lossRate: 0.05, price: 22 },
  { code: 'PMMA', name: 'PMMA 亚克力', category: '塑料原料', subCategory: '工程塑料', unit: 'kg', density: 1.18, lossRate: 0.06, price: 20 },
  // 特种工程塑料：耐高温高性能，单价高
  { code: 'PPS', name: 'PPS', category: '塑料原料', subCategory: '特种工程塑料', unit: 'kg', density: 1.35, lossRate: 0.06, price: 65 },
  { code: 'PEEK', name: 'PEEK', category: '塑料原料', subCategory: '特种工程塑料', unit: 'kg', density: 1.3, lossRate: 0.08, price: 480 },
  { code: 'PEI', name: 'PEI 聚醚酰亚胺', category: '塑料原料', subCategory: '特种工程塑料', unit: 'kg', density: 1.27, lossRate: 0.08, price: 180 },
  // 弹性体 / 软胶：双色包胶、手感件
  { code: 'TPE', name: 'TPE 软胶', category: '塑料原料', subCategory: '弹性体软胶', unit: 'kg', density: 1.0, lossRate: 0.06, price: 35 },
  { code: 'TPU', name: 'TPU', category: '塑料原料', subCategory: '弹性体软胶', unit: 'kg', density: 1.2, lossRate: 0.06, price: 35 },
  { code: 'SILICONE', name: '硅胶', category: '塑料原料', subCategory: '弹性体软胶', unit: 'kg', density: 1.15, lossRate: 0.08, price: 45 },

  // ---------- 压铸合金 ----------
  { code: 'ADC12', name: 'ADC12 铝合金', category: '压铸合金', subCategory: '铝合金', unit: 'kg', density: 2.7, lossRate: 0.08, price: 22 },
  { code: 'A380', name: 'A380 铝合金', category: '压铸合金', subCategory: '铝合金', unit: 'kg', density: 2.71, lossRate: 0.08, price: 21 },
  { code: 'A360', name: 'A360 铝合金', category: '压铸合金', subCategory: '铝合金', unit: 'kg', density: 2.63, lossRate: 0.08, price: 23 },
  { code: 'ZAMAK3', name: '锌合金 3#', category: '压铸合金', subCategory: '锌合金', unit: 'kg', density: 6.6, lossRate: 0.08, price: 19 },
  { code: 'ZAMAK5', name: '锌合金 5#', category: '压铸合金', subCategory: '锌合金', unit: 'kg', density: 6.6, lossRate: 0.08, price: 20 },
  { code: 'AZ91D', name: 'AZ91D 镁合金', category: '压铸合金', subCategory: '镁合金', unit: 'kg', density: 1.81, lossRate: 0.1, price: 28 },

  // ---------- 辅助材料 ----------
  { code: 'PAINT', name: '喷涂粉末', category: '辅助材料', subCategory: '表面处理', unit: 'kg', density: 1.5, lossRate: 0.15, price: 35 },
  { code: 'CARTON', name: '纸箱', category: '辅助材料', subCategory: '包装材料', unit: '个', lossRate: 0.02, price: 3 },
  { code: 'WOODBOX', name: '木箱（出口包装）', category: '辅助材料', subCategory: '包装材料', unit: '个', lossRate: 0.02, price: 150 },
  { code: 'RELEASE', name: '脱模剂', category: '辅助材料', subCategory: '模具辅料', unit: 'kg', density: 0.85, lossRate: 0.05, price: 25 },
];

const MaterialSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(50),
  category: z.string().max(30).optional(), // 一级分类
  subCategory: z.string().max(30).nullable().optional(), // 二级分类
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
    // 材料中心维护的是「全局材料库」（moldTypeId = null，所有模具类型共用）。
    // 初始化模具类型时会另外复制一份「类型专属材料」，那属于配置中心的范畴，
    // 不在这里列出 —— 否则同一个 ABS 会出现两条（全局 + 类型），改价也不知道改哪条。
    return prisma.material.findMany({
      where: { companyId, moldTypeId: null },
      orderBy: [{ category: 'asc' }, { subCategory: 'asc' }, { code: 'asc' }],
    });
  });

  // 初始化预置材料（只补不存在的，不覆盖企业已改价格）
  app.post('/api/materials/seed-preset', { preHandler: [app.authenticate] }, async (req) => {
    const { companyId } = req.user as any;
    const existing = await prisma.material.findMany({
      // 只看全局材料。否则模具类型自己的副本（同样是 code=P20）会被误判为
      // "已存在"，导致全局材料库里根本建不出这条记录。
      where: { companyId, moldTypeId: null },
      select: { id: true, code: true, category: true, subCategory: true },
    });
    const byCode = new Map(existing.map((m) => [m.code, m]));
    let created = 0;
    let classified = 0;
    for (const m of PRESET_MATERIALS) {
      const old = byCode.get(m.code);
      if (old) {
        // 老数据（本次分类升级前建的）没有二级分类 —— 只补分类，
        // 绝不动用户改过的价格、损耗率等业务字段
        if (m.subCategory && !old.subCategory) {
          await prisma.material.update({
            where: { id: old.id },
            data: { category: m.category, subCategory: m.subCategory },
          });
          classified += 1;
        }
        continue;
      }
      await prisma.material.create({
        data: {
          companyId,
          code: m.code,
          name: m.name,
          category: m.category,
          subCategory: m.subCategory,
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
    return { ok: true, created, classified, total: PRESET_MATERIALS.length };
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
