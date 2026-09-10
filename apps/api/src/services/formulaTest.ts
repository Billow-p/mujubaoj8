// 公式可用变量清单 + 测试求值器
// 对应 PRD 4.3 计算字段 / 4.5 公式测试 / 4.6 计算透明

import { evaluateExpression, normalizeExpression } from '@mqs/calc-engine';

export interface VariableDef {
  key: string;
  label: string;
  unit?: string;
  group: string;
  sample: number;
}

// 内置变量：直接来自报价输入
export const INPUT_VARIABLES: VariableDef[] = [
  { key: 'singleWeightKg', label: '单件重量', unit: 'kg', group: '产品', sample: 0.18 },
  { key: 'cavityCount', label: '腔数', unit: '穴', group: '产品', sample: 2 },
  { key: 'coreLengthMm', label: '模芯长', unit: 'mm', group: '产品', sample: 500 },
  { key: 'coreWidthMm', label: '模芯宽', unit: 'mm', group: '产品', sample: 400 },
  { key: 'coreHeightMm', label: '模芯高', unit: 'mm', group: '产品', sample: 150 },
  { key: 'machineTonnageT', label: '机台吨位', unit: 'T', group: '产品', sample: 160 },
  { key: 'cycleTimeS', label: '成型周期', unit: '秒', group: '注塑工艺', sample: 45 },
  { key: 'efficiencyFactor', label: '效率系数', group: '注塑工艺', sample: 0.8 },
  { key: 'firstOrderQty', label: '首单数量', unit: '件', group: '注塑工艺', sample: 300000 },
  { key: 'machineRatePerHour', label: '机台费率', unit: '元/小时', group: '注塑工艺', sample: 130 },
  { key: 'materialLossRate', label: '材料损耗率', group: '注塑工艺', sample: 0.05 },
  { key: 'steelDensity', label: '钢材密度', unit: 'g/cm³', group: '材料', sample: 7.85 },
  { key: 'steelUnitPrice', label: '钢材单价', unit: '元/kg', group: '材料', sample: 25 },
  { key: 'vatRate', label: '税率', group: '商务', sample: 0.13 },
  { key: 'managementRate', label: '管理费率', group: '商务', sample: 0.15 },
];

// 内置变量：引擎算出的模具费分项（可被后续公式引用，形成计算链）
export const MOLD_VARIABLES: VariableDef[] = [
  { key: 'coreSteel', label: '模芯钢材费', unit: '元', group: '模具费分项', sample: 5888 },
  { key: 'designFee', label: '设计费', unit: '元', group: '模具费分项', sample: 6000 },
  { key: 'moldBase', label: '模架费', unit: '元', group: '模具费分项', sample: 42000 },
  { key: 'standardParts', label: '标准件费', unit: '元', group: '模具费分项', sample: 16000 },
  { key: 'cncMachining', label: 'CNC加工费', unit: '元', group: '模具费分项', sample: 38400 },
  { key: 'edm', label: 'EDM放电费', unit: '元', group: '模具费分项', sample: 19800 },
  { key: 'wireCutting', label: '线切割费', unit: '元', group: '模具费分项', sample: 6000 },
  { key: 'polishing', label: '抛光费', unit: '元', group: '模具费分项', sample: 6000 },
  { key: 'trialMold', label: '试模费', unit: '元', group: '模具费分项', sample: 5000 },
  { key: 'surfaceTreatment', label: '表面处理费', unit: '元', group: '模具费分项', sample: 10000 },
  { key: 'packagingShipping', label: '包装运输费', unit: '元', group: '模具费分项', sample: 3000 },
];

// 内置变量：注塑单件分项
export const INJECTION_VARIABLES: VariableDef[] = [
  { key: 'material', label: '材料费', unit: '元/件', group: '注塑单件分项', sample: 2.27 },
  { key: 'machining', label: '加工费', unit: '元/件', group: '注塑单件分项', sample: 1.02 },
  { key: 'postProcess', label: '后加工费', unit: '元/件', group: '注塑单件分项', sample: 0.15 },
  { key: 'packaging', label: '包装费', unit: '元/件', group: '注塑单件分项', sample: 0.1 },
  { key: 'moldAmortization', label: '模具分摊', unit: '元/件', group: '注塑单件分项', sample: 0.61 },
];

export const BUILTIN_VARIABLES: VariableDef[] = [
  ...INPUT_VARIABLES,
  ...MOLD_VARIABLES,
  ...INJECTION_VARIABLES,
];

// 构造测试作用域：内置默认值 + 企业自定义参数 + 其它报价项 + 调用方覆盖
export function buildScope(extra?: Record<string, number>): Record<string, number> {
  const scope: Record<string, number> = {};
  for (const v of BUILTIN_VARIABLES) scope[v.key] = v.sample;
  if (extra) {
    for (const [k, val] of Object.entries(extra)) {
      if (typeof val === 'number' && Number.isFinite(val)) scope[k] = val;
    }
  }
  return scope;
}

export function buildAllowed(extraKeys: string[] = []): Set<string> {
  return new Set<string>([...BUILTIN_VARIABLES.map((v) => v.key), ...extraKeys]);
}

// 把表达式里的变量名替换成实际数值，用于「计算过程」展示（PRD 4.6）
export function describeExpression(
  expr: string,
  scope: Record<string, number>,
): string {
  let out = normalizeExpression(expr);
  const keys = Object.keys(scope).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    out = out.replace(re, String(scope[k]));
  }
  return out;
}

export interface TestResult {
  ok: boolean;
  value: number;
  expression: string;
  substituted?: string;
  condition?: string;
  conditionValue?: number;
  conditionSubstituted?: string;
  error?: string;
}

// 公式测试：返回计算结果 + 计算过程（PRD 4.5 / 4.6）
export function testFormula(
  expression: string,
  condition: string | null | undefined,
  extraVars: Record<string, number> = {},
  extraKeys: string[] = [],
): TestResult {
  const scope = buildScope(extraVars);
  const allowed = buildAllowed([...extraKeys, ...Object.keys(extraVars)]);
  const result: TestResult = {
    ok: false,
    value: 0,
    expression,
  };

  try {
    // 先测条件
    if (condition && condition.trim()) {
      result.condition = condition;
      const cv = evaluateExpression(condition, scope, allowed);
      result.conditionValue = cv;
      result.conditionSubstituted = describeExpression(condition, scope);
    }

    const v = evaluateExpression(expression, scope, allowed);
    result.value = Math.round(v * 100) / 100;
    result.substituted = describeExpression(expression, scope);
    result.ok = true;
    return result;
  } catch (e: any) {
    result.error = e?.message ?? String(e);
    return result;
  }
}
