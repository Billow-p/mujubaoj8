// 材料库存（ERP）—— 出入库流水 + 余额 + 报价成交自动扣料
//
// 三条铁律：
//   1. 余额只是快照，真值以 StockLedger 逐笔为准，可随时重算对账
//   2. 同来源单号对同一材料只记一笔（唯一索引 [materialId, refType, refId] 兜底）
//   3. 库存不足只预警不拦截（吴老师 2026-09-19 定的口径）

import { prisma } from '../db.js';

export type StockDirection = 'in' | 'out' | 'adjust';

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * 从一个参数对象里按多个别名取值 —— 参数名可能是中文（配置中心自定义），
 * 也可能是旧流程的英文 code，两种都认。
 */
function pick(params: any, aliases: string[]): number | undefined {
  for (const a of aliases) {
    const v = params?.[a];
    if (v != null && Number.isFinite(Number(v)) && Number(v) > 0) return Number(v);
  }
  return undefined;
}

// 参数别名表：中文在前（配置中心默认名），英文 code 兜底
const ALIAS = {
  len: ['模芯长', 'coreLengthMm', '模芯长度', '长', '长度'],
  wid: ['模芯宽', 'coreWidthMm', '宽', '宽度'],
  hgt: ['模芯高', 'coreHeightMm', '厚', '厚度', '高', '高度', '模芯厚'],
  cavity: ['腔数', 'cavityCount', '穴数', '模穴数'],
  weight: ['单件重量', 'singleWeightKg', '单重', '产品重量', '产品单重'],
  qty: ['注塑数量', '数量', 'qty', '件数', '首单数量', '订单数量'],
};

export type ApplyArgs = {
  companyId: string;
  materialId: string;
  direction: StockDirection;
  /** 变动量：in/out 恒为正；adjust 传差额（可正可负） */
  qty: number;
  unitCost?: number | null;
  refType?: string | null;
  refId?: string | null;
  remark?: string | null;
  createdById?: string | null;
};

export type ApplyResult = {
  materialId: string;
  materialName: string;
  unit: string;
  balanceAfter: number;
  safetyStock: number;
  /** 扣到安全线以下（只预警，业务照常走） */
  lowStock: boolean;
};

/**
 * 写一笔流水并同步余额。事务保证两者一致，任一失败整体回滚。
 * 重复写入（同 refType+refId）会撞唯一索引抛 P2002，由调用方决定是忽略还是报错。
 */
export async function applyStockChange(args: ApplyArgs): Promise<ApplyResult> {
  const { companyId, materialId, direction, qty } = args;
  if (!Number.isFinite(qty) || qty === 0) throw new Error('变动数量不能为 0');
  if (direction !== 'adjust' && qty < 0) throw new Error('入库/出库数量必须为正数');

  return prisma.$transaction(async (tx) => {
    const m = await tx.material.findFirst({ where: { id: materialId, companyId } });
    if (!m) throw new Error('材料不存在');

    const delta = direction === 'out' ? -qty : qty;
    const balanceAfter = round4(m.stockQty + delta);

    await tx.material.update({ where: { id: m.id }, data: { stockQty: balanceAfter } });
    await tx.stockLedger.create({
      data: {
        companyId,
        materialId: m.id,
        direction,
        qty: Math.abs(qty),
        balanceAfter,
        unitCost: args.unitCost ?? null,
        refType: args.refType ?? null,
        refId: args.refId ?? null,
        remark: args.remark ?? null,
        createdById: args.createdById ?? null,
      },
    });

    return {
      materialId: m.id,
      materialName: m.name,
      unit: m.unit,
      balanceAfter,
      safetyStock: m.safetyStock,
      lowStock: balanceAfter < m.safetyStock,
    };
  });
}

/** 入库 —— 增加库存 */
export function stockIn(args: Omit<ApplyArgs, 'direction'>) {
  return applyStockChange({ ...args, direction: 'in' });
}

/** 出库 —— 减少库存 */
export function stockOut(args: Omit<ApplyArgs, 'direction'>) {
  return applyStockChange({ ...args, direction: 'out' });
}

/** 盘点 —— 把库存调成实际数，差额（盘盈/盘亏）自动记 adjust 流水 */
export async function stockAdjust(args: {
  companyId: string;
  materialId: string;
  actualQty: number;
  remark?: string | null;
  createdById?: string | null;
}): Promise<ApplyResult> {
  const m = await prisma.material.findFirst({
    where: { id: args.materialId, companyId: args.companyId },
    select: { id: true, stockQty: true },
  });
  if (!m) throw new Error('材料不存在');
  const diff = round4(args.actualQty - m.stockQty);
  if (diff === 0) {
    return {
      materialId: m.id,
      materialName: '',
      unit: '',
      balanceAfter: m.stockQty,
      safetyStock: 0,
      lowStock: false,
    };
  }
  return applyStockChange({
    companyId: args.companyId,
    materialId: args.materialId,
    direction: 'adjust',
    qty: diff,
    refType: 'adjust',
    refId: null,
    remark: args.remark ?? (diff > 0 ? '盘点盘盈' : '盘点盘亏'),
    createdById: args.createdById ?? null,
  });
}

/**
 * 模具钢材用量（毛坯法 / 毛料口径）—— 单位 kg
 *
 * 依据（吴老师 2026-09-19 定的口径）：
 *   深圳某模具厂《模具设计标准》：开钢料时长宽高三方向余量 3-5mm（双边）
 *   东莞凯鼎实测：成品 200×100×50 = 7.85kg，加 5mm 余量毛坯 210×110×60 = 10.86kg，差 38%
 *   行业共识：报价备料按毛坯算，对成品账才按精料算 —— 领出库的是毛坯，所以扣库存必须走毛坯口径
 *
 *   毛坯重量 = (L+2a)(W+2a)(H+2a) × 密度 ÷ 1,000,000
 */
export function moldSteelUsageKg(args: {
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  density?: number | null;
  allowanceMm?: number;
  lossRate?: number;
  cavityCount?: number;
  /** true = 传进来的是单腔尺寸，需 × 腔数；false = 整块模仁（默认） */
  perCavity?: boolean;
  /** 直接指定毛料重量(kg)，有值则优先于体积换算 */
  rawWeightKg?: number | null;
}): number {
  const loss = args.lossRate ?? 0;
  // 直接给了毛料重量就以它为准（采购单上的数最准）
  if (args.rawWeightKg != null && num(args.rawWeightKg) > 0) {
    return round4(num(args.rawWeightKg) * (1 + loss));
  }
  const L = num(args.lengthMm);
  const W = num(args.widthMm);
  const H = num(args.heightMm);
  if (L <= 0 || W <= 0 || H <= 0) return 0;

  const a = args.allowanceMm ?? 5;
  const density = args.density ?? 7.85; // 模具钢默认密度 g/cm³
  const volumeCm3 = ((L + 2 * a) * (W + 2 * a) * (H + 2 * a)) / 1000;
  let kg = (volumeCm3 * density) / 1000;

  if (args.perCavity) kg *= Math.max(1, num(args.cavityCount) || 1);
  return round4(kg * (1 + loss));
}

/** 注塑件用量：件数 × 单件重量 × (1 + 损耗)，单位 kg */
export function injectionUsageKg(args: {
  qty?: number;
  singleWeightKg?: number;
  lossRate?: number;
}): number {
  const q = num(args.qty);
  const w = num(args.singleWeightKg);
  if (q <= 0 || w <= 0) return 0;
  return round4(q * w * (1 + (args.lossRate ?? 0)));
}

/** 从报价参数里解析「这套模具要用多少 kg 钢材」 */
export function usageFromMold(
  mold: any,
  common: any,
  material: { density?: number | null; lossRate?: number; machiningAllowanceMm?: number; perCavity?: boolean; rawWeightKg?: number | null },
): number {
  const p = { ...(common?.params ?? {}), ...(mold?.params ?? {}) };
  return moldSteelUsageKg({
    lengthMm: pick(p, ALIAS.len),
    widthMm: pick(p, ALIAS.wid),
    heightMm: pick(p, ALIAS.hgt),
    cavityCount: pick(p, ALIAS.cavity),
    density: material.density,
    allowanceMm: material.machiningAllowanceMm ?? 5,
    lossRate: material.lossRate ?? 0,
    perCavity: material.perCavity ?? false,
    rawWeightKg: material.rawWeightKg,
  });
}

/** 从报价参数里解析「这个注塑件要用多少 kg 原料」 */
export function usageFromPart(
  part: any,
  common: any,
  material: { lossRate?: number },
): number {
  const p = { ...(common?.params ?? {}), ...(part?.params ?? {}) };
  // 件数优先取 parts[].qty（结构里是显式字段），拿不到再从参数里找
  const qty = num(part?.qty) || pick(p, ALIAS.qty) || 0;
  const w = pick(p, ALIAS.weight) ?? 0;
  return injectionUsageKg({ qty, singleWeightKg: w, lossRate: material.lossRate ?? 0 });
}

export type DeductItem = {
  materialId: string;
  code: string;
  name: string;
  unit: string;
  qty: number;
  balanceAfter: number;
  safetyStock: number;
  lowStock: boolean;
  /** 用量算不出来（缺尺寸/重量参数），本次跳过 */
  skipped?: boolean;
};

/**
 * 报价成交自动扣料。
 *
 * - 按 materialCode 归并后再出库，保证「一张单对一种材料只记一笔流水」
 * - 只扣启用了库存管理（stockEnabled）的材料，辅料不动
 * - 撞唯一索引（P2002）= 这张单已经扣过，静默跳过，绝不重复扣
 * - 库存不足照扣（预警不拦），只在返回里标记 lowStock
 */
export async function deductForQuote(args: {
  companyId: string;
  quoteNo: string;
  paramsJson: any;
  createdById?: string | null;
}): Promise<{ items: DeductItem[]; warnings: string[] }> {
  const pj = args.paramsJson ?? {};
  const common = pj.common ?? {};
  const molds: any[] = Array.isArray(pj.molds) ? pj.molds : [];
  const parts: any[] = Array.isArray(pj.parts) ? pj.parts : [];

  return deductForQuoteInner(args, molds, parts, common);
}

/**
 * 扣料主流程：查材料 → 按编码归并用量 → 逐条出库。
 * 用量计算需要材料属性（密度/损耗/余量），所以必须先查库再算，没法在循环外预估。
 */
async function deductForQuoteInner(
  args: { companyId: string; quoteNo: string; paramsJson: any; createdById?: string | null },
  molds: any[],
  parts: any[],
  common: any,
): Promise<{ items: DeductItem[]; warnings: string[] }> {
  const items: DeductItem[] = [];
  const warnings: string[] = [];
  const codes = new Set<string>();
  for (const m of molds) if (m?.materialCode) codes.add(m.materialCode);
  for (const p of parts) if (p?.materialCode) codes.add(p.materialCode);
  if (codes.size === 0) return { items, warnings };

  // 只取启用库存管理的材料（全局库 moldTypeId = null）
  const materials = await prisma.material.findMany({
    where: { companyId: args.companyId, code: { in: [...codes] } },
  });
  const byCode = new Map(materials.map((m) => [m.code, m]));

  // 归并用量
  const need = new Map<string, number>();
  const bump = (code: string, qty: number) => {
    if (qty > 0) need.set(code, round4((need.get(code) ?? 0) + qty));
  };
  for (const m of molds) {
    const mat = byCode.get(m?.materialCode);
    if (!mat || !mat.stockEnabled) continue;
    bump(mat.code, usageFromMold(m, common ?? {}, mat));
  }
  for (const p of parts) {
    const mat = byCode.get(p?.materialCode);
    if (!mat || !mat.stockEnabled) continue;
    bump(mat.code, usageFromPart(p, common ?? {}, mat));
  }

  for (const [code, qty] of need) {
    const mat = byCode.get(code)!;
    try {
      const r = await stockOut({
        companyId: args.companyId,
        materialId: mat.id,
        qty,
        unitCost: mat.currentPrice,
        refType: 'quote',
        refId: args.quoteNo,
        remark: `报价 ${args.quoteNo} 成交扣料`,
        createdById: args.createdById ?? null,
      });
      items.push({
        materialId: mat.id,
        code: mat.code,
        name: mat.name,
        unit: r.unit,
        qty,
        balanceAfter: r.balanceAfter,
        safetyStock: r.safetyStock,
        lowStock: r.lowStock,
      });
      if (r.lowStock) {
        warnings.push(`${mat.name}（${mat.code}）库存 ${r.balanceAfter}${r.unit} 已低于安全库存 ${r.safetyStock}${r.unit}`);
      }
    } catch (e: any) {
      // P2002 = 这张报价单已经扣过这笔料，静默跳过（幂等）
      if (e?.code === 'P2002') continue;
      warnings.push(`${mat.name}（${mat.code}）扣料失败：${e?.message ?? '未知错误'}`);
    }
  }

  return { items, warnings };
}

/** 查某材料的库存流水 */
export async function listLedger(args: {
  companyId: string;
  materialId: string;
  take?: number;
}) {
  return prisma.stockLedger.findMany({
    where: { companyId: args.companyId, materialId: args.materialId },
    orderBy: { createdAt: 'desc' },
    take: args.take ?? 50,
  });
}

/** 全公司库存流水（台账用） */
export async function listCompanyLedger(args: {
  companyId: string;
  take?: number;
  materialId?: string;
}) {
  return prisma.stockLedger.findMany({
    where: {
      companyId: args.companyId,
      ...(args.materialId ? { materialId: args.materialId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: args.take ?? 100,
  });
}

/** 低库存材料清单（预警用） */
export async function listLowStock(companyId: string) {
  const rows = await prisma.material.findMany({
    where: { companyId, stockEnabled: true, moldTypeId: null },
    select: { id: true, code: true, name: true, unit: true, stockQty: true, safetyStock: true },
  });
  return rows.filter((r) => r.stockQty < r.safetyStock);
}
