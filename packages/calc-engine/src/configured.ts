// 配置驱动的算价：把「计算方式 + 填的数字」翻译成表达式并求值
// 用户不写公式，公式由这里生成，永不出现在界面上。

import type {
  ConfigCalcLine,
  ConfigCalcResult,
  QuoteItemDef,
  QuoteItemCalcConfig,
} from '@mqs/shared';
import { evaluateExpression, type Scope } from './expression.js';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** 变量位：优先取参数名，否则取固定数值 */
function pick(varName: string | undefined, fixed: number | undefined, fallback = '0'): string {
  if (varName && varName.trim()) return varName.trim();
  const f = Number(fixed);
  return Number.isFinite(f) ? String(f) : fallback;
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
      return (
        `${dims.join(' * ')} / 1000 * ${Number(c.density) || 1} / 1000 * ` +
        `${pick(c.priceVar, c.priceFixed)}`
      );
    }

    case 'hours':
      return `${Number(c.hours) || 0} * ${Number(c.rate) || 0}`;

    case 'weight':
      return (
        `${pick(c.wVar, undefined, '0')} * ${pick(c.priceVar, c.priceFixed)} * ` +
        `( 1 + ${Number(c.loss) || 0} )`
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
  switch (item.calcType) {
    case 'fixed':
      return `固定金额 ${yuan(c.amount)}`;
    case 'qty': {
      const q = c.src ? c.src : String(Number(c.srcQty) || 0);
      return `${q} × ${Number(c.price) || 0} 元`;
    }
    case 'size': {
      const dims = [c.l, c.w, c.h].filter((x) => x && String(x).trim());
      return `${dims.join(' × ')} → 换算重量 × ${c.priceVar || (Number(c.priceFixed) || 0) + ' 元'}`;
    }
    case 'hours':
      return `${Number(c.hours) || 0} 小时 × ${Number(c.rate) || 0} 元/小时`;
    case 'weight':
      return `${c.wVar || '重量'} × ${c.priceVar || (Number(c.priceFixed) || 0) + ' 元'} × (1 + 损耗 ${Number(c.loss) || 0})`;
    case 'percent':
      return `${c.base || '模具小计'} × ${r2((Number(c.rate) || 0) * 100)}%`;
    case 'manual':
      return '报价时手动填写金额';
    case 'formula':
      return item.expression || '（未填写公式）';
    default:
      return '';
  }
}

/** 把求值器的技术性报错转成人话 */
export function friendlyCalcError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/未定义变量|未赋值/.test(m)) return '用到的数据项不存在了，可能已被删掉，请重新选';
  if (/除数为 0/.test(m)) return '算到「除以 0」了，检查一下填的数字';
  if (/意外结束|缺少右括号|未消费|意外的 token|无法识别/.test(m)) {
    return '公式不完整，请检查计算方式里的填空';
  }
  if (/未知函数/.test(m)) return m + '，目前只支持：最大值、最小值、取整、绝对值、如果';
  return m;
}

export interface ConfiguredOptions {
  profitRate?: number;
  taxRate?: number;
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
  const scope: Scope = {};
  for (const [k, v] of Object.entries(params)) {
    const n = Number(v);
    if (Number.isFinite(n)) scope[k] = n;
  }
  const allowed = new Set<string>(Object.keys(scope));

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
    try {
      const v = evaluateExpression(expression, scope, allowed);
      const rounded = r2(v);
      scope[it.name] = rounded;
      allowed.add(it.name);
      if (it.scope === 'injection') directInjection += rounded;
      else directMold += rounded;
      if (it.category === '材料费') materialTotal += rounded;
      lines[idx] = { ...meta(it), value: rounded, expression, readable: describeItem(it) };
    } catch (e) {
      lines[idx] = {
        ...meta(it),
        value: 0,
        expression,
        readable: describeItem(it),
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
    if (it.scope === 'injection') injection += v;
    else mold += v;
    scope[it.name] = v;
    allowed.add(it.name);
    lines[idx] = {
      ...meta(it),
      value: r2(v),
      expression: `${from} * ${rate}`,
      readable: describeItem(it),
    };
  }

  const profitRate = Number(opts.profitRate) || 0;
  const taxRate = Number(opts.taxRate) || 0;
  const beforeProfit = mold + injection;
  const profit = Math.round(beforeProfit * profitRate);
  const beforeTax = beforeProfit + profit;
  const tax = Math.round(beforeTax * taxRate);

  return {
    lines,
    mold: r2(mold),
    injection: r2(injection),
    profitRate,
    profit,
    taxRate,
    tax,
    total: r2(beforeTax + tax),
  };
}
