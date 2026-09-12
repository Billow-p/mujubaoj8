// 配置驱动的算价：把「计算方式 + 填的数字」翻译成表达式并求值
// 用户不写公式，公式由这里生成，永不出现在界面上。

import type {
  ConfigCalcLine,
  ConfigCalcResult,
  QuoteItemDef,
  QuoteItemCalcConfig,
  QuoteProjectInput,
  QuoteProjectResult,
  QuoteProjectMoldResult,
  QuoteProjectPartResult,
} from '@mqs/shared';
import { QTY_VAR_CANDIDATES } from '@mqs/shared';
import { evaluateExpression, type Scope } from './expression.js';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** 变量位：优先取参数名，否则取固定数值 */
function pick(varName: string | undefined, fixed: number | undefined, fallback = '0'): string {
  if (varName && varName.trim()) return varName.trim();
  const f = Number(fixed);
  return Number.isFinite(f) ? String(f) : fallback;
}

/** 固定损耗位：优先取参数名，否则取固定数值（0/缺失 → 0） */
function pickLoss(varName: string | undefined, fixed: number | undefined): string {
  if (varName && varName.trim()) return varName.trim();
  const f = Number(fixed);
  return Number.isFinite(f) ? String(f) : '0';
}

/** 损耗的中文读法：优先显示参数名，否则显示固定数值；都没有则返回空 */
function lossText(c: QuoteItemCalcConfig): string {
  if (c.lossVar && c.lossVar.trim()) return `损耗 ${c.lossVar.trim()}`;
  const f = Number(c.loss);
  if (Number.isFinite(f) && f !== 0) return `损耗 ${f}`;
  return '';
}

/**
 * 变量缺省回填 —— 保证「没选材料库材料时，结果与老公式完全一致」。
 *
 * 计算项里如果声明了 densityVar / lossVar / priceVar / wVar，
 * 但该参数在这次计算中根本没传（例如材料库还没接线的模具类型），
 * 就用 calcConfig 里的固定值（density / loss / priceFixed）补上。
 * 这样切换为「变量」写法不会改变任何旧配置的算价结果。
 */
export function normalizeItemVars(
  items: QuoteItemDef[],
  params: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...params };
  const put = (key: string | undefined, value: unknown) => {
    if (!key || !key.trim()) return;
    if (out[key] != null && Number.isFinite(Number(out[key]))) return;
    const n = Number(value);
    if (Number.isFinite(n)) out[key] = n;
  };
  for (const it of items) {
    const c: QuoteItemCalcConfig = it.calcConfig ?? {};
    // 注意：只要声明了 *Var，就必须保证该变量一定有值，
    // 否则表达式里会出现未知变量 → 整项算成 0。
    // 所以这里的兜底是「必有」的：密度缺省 1，损耗缺省 0（等价于不算损耗）。
    if (it.calcType === 'size') {
      put(c.densityVar, c.density ?? 1);
      put(c.lossVar, c.loss ?? 0);
      put(c.priceVar, c.priceFixed);
    } else if (it.calcType === 'weight') {
      put(c.lossVar, c.loss ?? 0);
      put(c.priceVar, c.priceFixed);
    }
  }
  return out;
}

/** 由「计算方式 + 配置」生成表达式（中文变量名，求值器原生支持） */
export function buildItemExpression(item: QuoteItemDef): string {
  const c: QuoteItemCalcConfig = item.calcConfig ?? {};
  switch (item.calcType) {
    case 'fixed':
      return String(Number(c.amount) || 0);

    case 'qty':
      return `${pick(c.src, c.srcQty, '1')} * ${Number(c.price) || 0}`;

    case 'size': {
      const dims = [c.l, c.w, c.h].filter((x) => x && String(x).trim()) as string[];
      if (!dims.length) return '0';
      // 长×宽×高(mm³) ÷1000→cm³ ×密度(g/cm³) ÷1000→kg ×单价(元/kg) ×(1+损耗)
      return (
        `${dims.join(' * ')} / 1000 * ${pick(c.densityVar, c.density, '1')} / 1000 * ` +
        `${pick(c.priceVar, c.priceFixed)} * ( 1 + ${pickLoss(c.lossVar, c.loss)} )`
      );
    }

    case 'hours':
      return `${Number(c.hours) || 0} * ${Number(c.rate) || 0}`;

    case 'weight':
      return (
        `${pick(c.wVar, undefined, '0')} * ${pick(c.priceVar, c.priceFixed)} * ` +
        `( 1 + ${pickLoss(c.lossVar, c.loss)} )`
      );

    case 'percent':
    case 'manual':
      return '0';

    case 'formula':
      return (item.expression ?? '').trim() || '0';

    default:
      return '0';
  }
}

/** 计算方式 → 中文读法（给用户看的那一行） */
export function describeItem(item: QuoteItemDef): string {
  const c: QuoteItemCalcConfig = item.calcConfig ?? {};
  const yuan = (n: unknown) => '¥' + Number(n || 0).toLocaleString('zh-CN');
  /** 注塑按件计价：末尾补一句「× 注塑数量」，让用户明白这是单件价 */
  const per = item.perUnit && item.scope === 'injection';
  const tail = per ? '　×　注塑数量' : '';
  switch (item.calcType) {
    case 'fixed':
      return per ? `单件 ${yuan(c.amount)}${tail}` : `固定金额 ${yuan(c.amount)}`;
    case 'qty': {
      const q = c.src ? c.src : String(Number(c.srcQty) || 0);
      return `${q} × ${Number(c.price) || 0} 元`;
    }
    case 'size': {
      const dims = [c.l, c.w, c.h].filter((x) => x && String(x).trim());
      const loss = lossText(c);
      return `${dims.join(' × ')} → 换算重量 × ${c.priceVar || (Number(c.priceFixed) || 0) + ' 元'}${
        loss ? ` × (1 + ${loss})` : ''
      }${tail}`;
    }
    case 'hours':
      return `${Number(c.hours) || 0} 小时 × ${Number(c.rate) || 0} 元/小时${tail}`;
    case 'weight':
      return `${c.wVar || '重量'} × ${c.priceVar || (Number(c.priceFixed) || 0) + ' 元'} × (1 + ${
        lossText(c) || '损耗 0'
      })${tail}`;
    case 'percent':
      return `${c.base || '模具小计'} × ${r2((Number(c.rate) || 0) * 100)}%`;
    case 'manual':
      return per ? '报价时手动填写单件成本' : '报价时手动填写金额';
    case 'formula':
      return beautifyExpression(item.expression) || '（未填写公式）';
    default:
      return '';
  }
}

/** 公式里的符号换成可读形式，给用户看（不影响实际计算） */
function beautifyExpression(expr?: string): string {
  return (expr ?? '')
    .replace(/\*/g, ' × ')
    .replace(/\//g, ' ÷ ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 把求值器的技术性报错转成人话 */
export function friendlyCalcError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (m === NO_QTY) return '缺「注塑数量」，按件计价算不出来。请到配置中心加一个名为「注塑数量」的参数';
  if (/未定义变量|未赋值/.test(m)) return '用到的数据项不存在了，可能已被删掉，请重新选';
  if (/除数为 0/.test(m)) return '算到「除以 0」了，检查一下填的数字';
  if (/意外结束|缺少右括号|未消费|意外的 token|无法识别/.test(m)) {
    return '公式不完整，请检查计算方式里的填空';
  }
  if (/未知函数/.test(m)) return m + '，目前只支持：最大值、最小值、取整、绝对值、如果';
  return m;
}

/** 内部：缺少注塑数量的哨兵错误 */
const NO_QTY = '__NO_INJECTION_QTY__';

/**
 * 价格/密度缺失的中文提醒（非致命）。
 * 场景：「按尺寸算」的钢材费、「按重量算」的材料费，若单价/密度没填
 * （或被填成 0），该项会静默算成 0，用户以为是算错了（幻觉）。
 * 这里明确提示「XXX 未设置，暂按 0 计算——请补充价格」，让用户知道原因。
 */
function priceWarning(it: QuoteItemDef, scope: Scope): string | undefined {
  const c: QuoteItemCalcConfig = it.calcConfig ?? {};
  if (it.calcType === 'size' || it.calcType === 'weight') {
    const pv = c.priceVar as string | undefined;
    if (pv && (scope[pv] == null || !Number.isFinite(Number(scope[pv])) || Number(scope[pv]) === 0)) {
      return `「${pv}」未设置或为空，此项暂按 0 计算——请到材料库/参数补充价格`;
    }
    if (it.calcType === 'size') {
      const dv = c.densityVar as string | undefined;
      if (dv && (scope[dv] == null || !Number.isFinite(Number(scope[dv])) || Number(scope[dv]) === 0)) {
        return `「${dv}」未设置或为空，钢材重量算不出，此项暂按 0 计算——请补充密度`;
      }
    }
  }
  return undefined;
}

export interface ConfiguredOptions {
  profitRate?: number;
  taxRate?: number;
  /** 「注塑数量」的参数名。不指定时按常用名自动查找 */
  injectionQtyVar?: string;
}

export function resolveInjectionQty(
  params: Record<string, number>,
  want?: string,
): { qty: number; varName: string } {
  if (want && Number.isFinite(params[want])) return { qty: Number(params[want]), varName: want };
  for (const k of QTY_VAR_CANDIDATES) {
    if (Number.isFinite(params[k])) return { qty: Number(params[k]), varName: k };
  }
  return { qty: 0, varName: '' };
}

/**
 * 按费用项列表算价。
 * - percent 项基于「前面已累计的模具小计」或「材料费合计」
 * - 每项结果会写回作用域，后面的费用项可以用它的名字引用（计算链）
 */
export function calculateConfigured(
  items: QuoteItemDef[],
  params: Record<string, number>,
  opts: ConfiguredOptions = {},
): ConfigCalcResult {
  // 变量缺省回填：声明了 densityVar/lossVar/priceVar 但没传值的，用 calcConfig 固定值补上。
  // 这一步保证「未选材料库材料」时算价与老配置完全一致。
  const filled = normalizeItemVars(items, params ?? {});
  const scope: Scope = {};
  for (const [k, v] of Object.entries(filled)) {
    const n = Number(v);
    if (Number.isFinite(n)) scope[k] = n;
  }
  const allowed = new Set<string>(Object.keys(scope));

  // 按件计价要用到的「注塑数量」
  const { qty: injectionQty } = resolveInjectionQty(params, opts.injectionQtyVar);

  const sorted = [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const lines: ConfigCalcLine[] = new Array(sorted.length);
  const meta = (it: QuoteItemDef) => ({
    name: it.name,
    category: it.category ?? '自定义',
    scope: it.scope,
    calcType: it.calcType,
  });

  // ---- 第一遍：直接费用项（比例项先挂起） ----
  const percentQueue: { idx: number; it: QuoteItemDef }[] = [];
  let directMold = 0;
  let directInjection = 0;
  let materialTotal = 0;

  sorted.forEach((it, idx) => {
    if (it.enabled === false) {
      lines[idx] = { ...meta(it), value: 0, expression: '', readable: describeItem(it), skipped: true };
      return;
    }
    if (it.calcType === 'manual') {
      lines[idx] = { ...meta(it), value: 0, expression: '', readable: describeItem(it), manual: true };
      return;
    }
    if (it.calcType === 'percent') {
      percentQueue.push({ idx, it });
      return;
    }

    const expression = buildItemExpression(it);
    const isInjection = it.scope === 'injection';
    const perUnit = isInjection && it.perUnit === true;
    try {
      const raw = evaluateExpression(expression, scope, allowed);
      let value = raw;
      let unitPrice: number | undefined;
      let qty: number | undefined;

      if (isInjection) {
        qty = injectionQty;
        if (perUnit) {
          // 按件计价：算出来的就是单件成本，总额 = 单件成本 × 注塑数量
          if (!injectionQty) throw new Error(NO_QTY);
          unitPrice = r2(raw);
          value = raw * injectionQty;
        } else {
          // 直接是总额：反推单件成本，供表格展示
          unitPrice = injectionQty > 0 ? r2(raw / injectionQty) : undefined;
        }
      }

      const rounded = r2(value);
      scope[it.name] = rounded;
      allowed.add(it.name);
      if (isInjection) directInjection += rounded;
      else directMold += rounded;
      if (it.category === '材料费') materialTotal += rounded;
      lines[idx] = {
        ...meta(it),
        value: rounded,
        expression,
        readable: describeItem(it),
        perUnit: perUnit || undefined,
        unitPrice,
        qty,
        warning: priceWarning(it, scope),
      };
    } catch (e) {
      lines[idx] = {
        ...meta(it),
        value: 0,
        expression,
        readable: describeItem(it),
        perUnit: perUnit || undefined,
        qty: isInjection ? injectionQty : undefined,
        error: friendlyCalcError(e),
      };
    }
  });

  // ---- 第二遍：比例项，基数 = 全部直接费用（与它排在哪个位置无关） ----
  let mold = directMold;
  let injection = directInjection;
  for (const { idx, it } of percentQueue) {
    const rate = Number(it.calcConfig?.rate) || 0;
    const baseName = it.calcConfig?.base ?? '模具小计';
    const from =
      baseName === '材料费合计'
        ? materialTotal
        : it.scope === 'injection'
          ? directInjection
          : directMold;
    const v = Math.round(from * rate);
    const isInj = it.scope === 'injection';
    if (isInj) injection += v;
    else mold += v;
    scope[it.name] = v;
    allowed.add(it.name);
    lines[idx] = {
      ...meta(it),
      value: r2(v),
      expression: `${from} * ${rate}`,
      readable: describeItem(it),
      qty: isInj ? injectionQty : undefined,
      unitPrice: isInj && injectionQty > 0 ? r2(v / injectionQty) : undefined,
    };
  }

  const profitRate = Number(opts.profitRate) || 0;
  const taxRate = Number(opts.taxRate) || 0;
  const beforeProfit = mold + injection;
  const profit = Math.round(beforeProfit * profitRate);
  const beforeTax = beforeProfit + profit;
  const tax = Math.round(beforeTax * taxRate);

  // 注塑单件成本合计 = 各注塑项的单件成本之和
  const unitCost = r2(
    lines
      .filter((l) => l && l.scope === 'injection' && !l.skipped && !l.error)
      .reduce((s, l) => s + (Number(l.unitPrice) || 0), 0),
  );

  return {
    lines,
    mold: r2(mold),
    injection: r2(injection),
    profitRate,
    profit,
    taxRate,
    tax,
    total: r2(beforeTax + tax),
    injectionQty: injectionQty || undefined,
    unitCost: unitCost || undefined,
  };
}

// ============================================================
// 多注塑件聚合：一张报价单 = 多套模具（并列）+ 多个注塑件（并列）
// 不动单实例引擎，只在外面套一层聚合。
// ============================================================

const round2 = (n: number) => Math.round(n * 100) / 100;

// 新引擎聚合层：一张报价单装多个可独立算价的对象
export function calculateQuoteProject(input: QuoteProjectInput): QuoteProjectResult {
  const moldItems = (input.items ?? []).filter((it) => (it.scope ?? 'mold') === 'mold');
  const partItems = (input.items ?? []).filter((it) => it.scope === 'injection');
  const profitRate = Number(input.common?.profitRate) || 0;
  const taxRate = Number(input.common?.taxRate) || 0;
  const qtyVarName = (input.common?.qtyVarName || '注塑数量').trim();
  const commonParams = input.common?.params ?? {};

  // 手动项转固定金额参与计算（与单实例路由一致）
  const withManual = (
    items: QuoteItemDef[],
    manuals?: Record<string, number>,
  ): QuoteItemDef[] =>
    items.map((it) => {
      if (it.calcType === 'manual' && manuals && manuals[it.name] != null) {
        return { ...it, calcType: 'fixed', calcConfig: { amount: manuals[it.name] } };
      }
      return it;
    });

  const moldResults: QuoteProjectMoldResult[] = (input.molds ?? []).map((m) => {
    const params: Record<string, number> = { ...commonParams, ...(m.params ?? {}) };
    const res = calculateConfigured(withManual(moldItems, m.manualAmounts), params, {
      profitRate,
      taxRate,
    });
    return {
      code: m.code,
      name: m.name,
      materialCode: m.materialCode,
      materialName: m.materialName,
      subtotal: round2(res.mold),
      lines: res.lines,
    };
  });

  const partResults: QuoteProjectPartResult[] = (input.parts ?? []).map((p) => {
    const params: Record<string, number> = { ...commonParams, ...(p.params ?? {}) };
    // 把本件数量注入到数量参数，per-unit 乘法才能拿到正确数量
    params[qtyVarName] = Number(p.qty) || 0;
    const res = calculateConfigured(withManual(partItems, p.manualAmounts), params, {
      profitRate,
      taxRate,
      injectionQtyVar: qtyVarName,
    });
    const unitCost = round2(res.unitCost ?? 0);
    const qty = Number(p.qty) || 0;
    return {
      code: p.code,
      name: p.name,
      materialCode: p.materialCode,
      qty,
      unitCost,
      total: round2(unitCost * qty),
      lines: res.lines,
    };
  });

  const moldSubtotal = round2(moldResults.reduce((s, m) => s + m.subtotal, 0));
  const injectionSubtotal = round2(partResults.reduce((s, p) => s + p.total, 0));
  const subtotal = round2(moldSubtotal + injectionSubtotal);
  const profit = Math.round(subtotal * profitRate);
  const tax = Math.round((subtotal + profit) * taxRate);
  const total = subtotal + profit + tax;

  return {
    kind: 'project',
    moldResults,
    partResults,
    moldSubtotal,
    injectionSubtotal,
    subtotal,
    profitRate,
    profit,
    taxRate,
    tax,
    total,
  };
}
