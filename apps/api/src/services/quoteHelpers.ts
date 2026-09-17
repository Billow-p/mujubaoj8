// 报价单路由的纯辅助函数（从 quotes.ts 拆出来）
//
// quotes.ts 有 1600+ 行，其中 1400 行是 quoteRoutes() 里的路由处理函数。
// 路由拆分牵一发动全身，风险大；先把这些**与路由无关**的纯函数挪出来，
// 文件立刻少 230 行，也让这些「生成单号 / 算分享摘要 / 合并公式」的逻辑能被单独测试。

import { prisma } from '../db.js';
export function genQuoteNo(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `BJ-${date}-${seq}`;
}

export function genShareToken(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

/**
 * 对外可访问的站点地址，用于生成分享链接与邮件里的链接。
 * 来自 PUBLIC_WEB_URL（生产为 https://ycwl.chat），未配置时兜底到正式域名。
 * 统一在这里取，避免各处硬编码导致链接指向不一致。
 */
export function publicWebUrl(): string {
  return (process.env.PUBLIC_WEB_URL || 'https://ycwl.chat').replace(/\/+$/, '');
}

/**
 * 客户分享页的汇总口径：只给汇总数字，不给分项成本，也不给利润。
 *
 * 客户视角的构成 = 模具费 + 注塑费 + 利润 + 税，其中利润不单独列出，
 * 而是并入「不含税合计」——所以看得到总价，看不出成本结构。
 * 兼容两代数据结构（配置驱动 / 老 11 项模型）。
 */
export function shareSummary(calc: any, params: any) {
  if (!calc) return null;

  // 多注塑件报价（报价项目）：模具一次性费 + 注塑按件费，整单统一利润税
  if (calc.kind === 'project') {
    const partResults: any[] = calc.partResults ?? [];
    const totalQty = partResults.reduce((s: number, p: any) => s + (Number(p.qty) || 0), 0);
    const mold = Number(calc.moldSubtotal) || 0;
    const injection = Number(calc.injectionSubtotal) || 0;
    const profit = Number(calc.profit) || 0;
    return {
      moldExVat: mold,
      injectionExVat: injection,
      injectionQty: totalQty,
      unitCost: totalQty ? Math.round((injection / totalQty) * 100) / 100 : 0,
      netExVat: Math.round((mold + injection + profit) * 100) / 100,
      taxRate: Number(calc.taxRate) || 0,
      tax: Number(calc.tax) || 0,
      totalIncVat: Number(calc.total) || 0,
    };
  }

  if (Array.isArray(calc.lines)) {
    const mold = Number(calc.mold) || 0;
    const injection = Number(calc.injection) || 0;
    const profit = Number(calc.profit) || 0;
    return {
      moldExVat: mold,
      injectionExVat: injection,
      injectionQty: Number(calc.injectionQty) || 0,
      unitCost: Number(calc.unitCost) || 0,
      netExVat: Math.round((mold + injection + profit) * 100) / 100,
      taxRate: Number(calc.taxRate) || 0,
      tax: Number(calc.tax) || 0,
      totalIncVat: Number(calc.total) || 0,
    };
  }

  const sm = calc.summary ?? {};
  const net = Number(sm.grandTotalExVat) || 0;
  const tax = Number(sm.grandTotalVat) || 0;
  return {
    moldExVat: Number(sm.moldTotalExVat) || 0,
    injectionExVat: Number(sm.injectionTotalExVat) || 0,
    injectionQty: Number(params?.firstOrderQty) || 0,
    unitCost: Number(sm.unitCostExVat) || 0,
    netExVat: net,
    taxRate: net > 0 ? Number((tax / net).toFixed(4)) : 0,
    tax,
    totalIncVat: Number(sm.grandTotalIncVat) || 0,
  };
}

/**
 * 邮件里要填的金额：兼容三代结构（多注塑件项目 / 配置驱动 / 老 11 项模型）。
 * 统一把 calc 折算成 { 含税总计, 模具费不含税, 单件成本不含税, 数量 }。
 */
export function mailTotals(calc: any): {
  grandTotalIncVat: number;
  moldTotalExVat: number;
  unitCostExVat: number;
  firstOrderQty: number;
} {
  if (!calc) {
    return { grandTotalIncVat: 0, moldTotalExVat: 0, unitCostExVat: 0, firstOrderQty: 0 };
  }
  if (calc.kind === 'project') {
    const partResults: any[] = calc.partResults ?? [];
    const totalQty = partResults.reduce((s: number, p: any) => s + (Number(p.qty) || 0), 0);
    const injection = Number(calc.injectionSubtotal) || 0;
    return {
      grandTotalIncVat: Number(calc.total) || 0,
      moldTotalExVat: Number(calc.moldSubtotal) || 0,
      unitCostExVat: totalQty ? Math.round((injection / totalQty) * 100) / 100 : 0,
      firstOrderQty: totalQty,
    };
  }
  if (Array.isArray(calc.lines)) {
    return {
      grandTotalIncVat: Number(calc.total) || 0,
      moldTotalExVat: Number(calc.mold) || 0,
      unitCostExVat: Number(calc.unitCost) || 0,
      firstOrderQty: Number(calc.injectionQty) || 0,
    };
  }
  const sm = calc.summary ?? {};
  return {
    grandTotalIncVat: Number(sm.grandTotalIncVat) || 0,
    moldTotalExVat: Number(sm.moldTotalExVat) || 0,
    unitCostExVat: Number(sm.unitCostExVat) || 0,
    firstOrderQty: Number(calc.injectionQty) || 0,
  };
}

/**
 * 内部工艺参数（钢材单价、模具尺寸、运输箱尺寸等）——客户不需要看到。
 * 用于老报价单的兜底判断：它们的 paramsJson.parameters 里没有 group 字段。
 */
const INTERNAL_PARAM = /模芯|模具重|运输箱|钢材|原料单价|密度|运费单价|成本/;

/**
 * 分享页展示的产品规格：只给客户关心的（产品参数 + 数量类参数），
 * 不含钢材单价、模具尺寸这类内部工艺参数。
 */
export function shareSpecs(params: any): { label: string; value: string }[] {
  const defs: any[] = params?.parameters ?? [];
  const values = params?.values ?? {};
  const out: { label: string; value: string }[] = [];

  for (const d of defs) {
    const raw = values[d.name];
    if (raw === undefined || raw === null || raw === '') continue;
    const name = String(d.name);
    const keep = d.group
      ? d.group === '产品' || /数量|件数|穴数/.test(name)
      : !INTERNAL_PARAM.test(name); // 老报价单无 group，用关键词兜底
    if (!keep) continue;
    const opt = (d.options ?? []).find((o: any) => Number(o.value) === Number(raw));
    const unit = d.unit && !opt ? ` ${d.unit}` : '';
    out.push({ label: name, value: opt ? String(opt.label) : `${raw}${unit}` });
  }

  return out.slice(0, 8);
}

/** 参数下拉选项存在 String 字段里（JSON），解析失败就当没有 */
export function parseParamOptions(raw: string | null | undefined): { label: string; value: number }[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 报价项目（多注塑件）的分享页「产品规格」来源：
 * 参数定义挂在 params.parameters，但实际值分散在 common.params / 各模具 / 各注塑件，
 * 这里把值合并成 shareSpecs 期望的 { parameters, values } 结构，
 * 否则项目型报价单的客户分享页会拿不到 values，整块「产品规格」消失。
 */
export function projectSpecParams(params: any): any {
  const vals: Record<string, number> = {};
  if (params?.common?.params) Object.assign(vals, params.common.params);
  for (const m of params?.molds ?? []) if (m?.params) Object.assign(vals, m.params);
  for (const p of params?.parts ?? []) if (p?.params) Object.assign(vals, p.params);
  return { ...params, values: vals };
}

/**
 * 由「按尺寸算」的配置 + 已知参数，估算该费用项的材料用量（kg）。
 *
 * 与引擎里 size 的算法保持一致：长×宽×高 /1000 ×密度 /1000，单位 kg。
 * 用途：模具钢材的**阶梯价**要按实际用料量取价，而引擎算价时用量还没出来，
 * 所以这里先算一遍。算不出（缺尺寸/密度）返回 null → 阶梯价回落到基础单价。
 */
export function sizeItemWeightKg(cfg: any, params: Record<string, number>): number | null {
  const keys = [cfg?.l, cfg?.w, cfg?.h].filter((x) => x && String(x).trim()) as string[];
  if (!keys.length) return null;
  let vol = 1;
  for (const k of keys) {
    const v = Number(params[k]);
    if (!Number.isFinite(v)) return null;
    vol *= v;
  }
  const dVar = cfg?.densityVar as string | undefined;
  const density = Number(dVar && params[dVar] != null ? params[dVar] : cfg?.density);
  if (!Number.isFinite(density) || density <= 0) return null;
  return (vol / 1000) * (density / 1000);
}

// 加载企业已启用的报价项（PRD 5.9：报价项自动参与计算并随版本冻结）
export async function loadEnabledFormulas(companyId: string) {
  const items = await prisma.customFormula.findMany({
    where: { companyId, enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return items.map((f) => ({
    name: f.name,
    scope: f.scope as 'mold' | 'injection' | 'summary',
    expression: f.expression,
    condition: f.condition ?? undefined,
    code: f.code ?? undefined,
    category: f.category ?? undefined,
    unit: f.unit ?? undefined,
    version: f.version,
    enabled: true,
    sortOrder: f.sortOrder,
    note: f.note ?? undefined,
  }));
}

// 合并：企业启用项 + 请求方显式传入项（按 name 去重，传入优先）
export function mergeFormulas(
  fromDb: Awaited<ReturnType<typeof loadEnabledFormulas>>,
  fromBody: any[] | undefined,
) {
  if (!fromBody || fromBody.length === 0) return fromDb;
  const names = new Set(fromBody.map((f: any) => f?.name).filter(Boolean));
  return [...fromBody, ...fromDb.filter((f) => !names.has(f.name))];
}
