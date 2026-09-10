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
      return `${dims.join(' × ')} → 换算重量 × ${c.priceVar || (Number(c.priceFixed) || 0) + ' 元'}${tail}`;
    }
    case 'hours':
      return `${Number(c.hours) || 0} 小时 × ${Number(c.rate) || 0} 元/小时${tail}`;
    case 'weight':
      return `${c.wVar || '重量'} × ${c.priceVar || (Number(c.priceFixed) || 0) + ' 元'} × (1 + 损耗 ${Number(c.loss) || 0})${tail}`;
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

export interface ConfiguredOptions {
  profitRate?: number;
  taxRate?: number;
  /** 「注塑数量」的参数名。不指定时按常用名自动查找 */
  injectionQtyVar?: string;
}

/** 按件计价用的数量参数，按优先级自动查找 */
const QTY_VAR_CANDIDATES = ['注塑数量', '本次数量', '生产数量', '订单数量', '首单数量'];

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
  const scope: Scope = {};
  for (const [k, v] of Object.entries(params)) {
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
