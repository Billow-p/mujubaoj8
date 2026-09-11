/**
 * 报价单含税总价 —— 兼容两代数据结构
 *
 * - 配置驱动（新）：calc 顶层有 lines 数组，总价在 calc.total
 * - 老 11 项模型：总价在 calc.summary.grandTotalIncVat
 *
 * 统一放在这里。历史上 quotes.ts（calcTotal）与 customers.ts（quoteTotal）
 * 各写了一份同样逻辑的实现，改一处漏一处会导致列表金额与详情金额对不上。
 */
export function calcTotal(calc: any): number {
  if (!calc) return 0;
  // 多注塑件报价（报价项目）
  if (calc.kind === 'project') return Number(calc.total) || 0;
  // 配置驱动（单实例）
  if (Array.isArray(calc.lines)) return Number(calc.total) || 0;
  // 老 11 项模型
  return Number(calc.summary?.grandTotalIncVat) || 0;
}
