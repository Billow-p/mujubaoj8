// 计算引擎测试 — 用 Excel 原示例的数据作为基准
// Excel 案例: B7=0.18, B11=12, E11=0.05, B12=130, E9=45, B8=2, B10=0.8, E10=300000
//             B14=500, E14=400, B15=150, E15=7.85, B16=25, E16=0.15, E12=0.13

import { calculateQuote, compareOptimalCavity, validateQuoteInput } from '../src/index.ts';
import type { QuoteInput } from '../../shared/src/index.ts';

const baseInput: QuoteInput = {
  customerName: '美的电器股份有限公司',
  productName: '家电塑胶外壳',
  material: 'ABS',
  steel: 'P20',
  complexity: 'medium',
  singleWeightKg: 0.18,
  cavityCount: 2,
  cycleTimeS: 45,
  efficiencyFactor: 0.80,
  firstOrderQty: 300000,
  machineRatePerHour: 130,
  materialLossRate: 0.05,
  vatRate: 0.13,
  managementRate: 0.15,
  coreLengthMm: 500,
  coreWidthMm: 400,
  coreHeightMm: 150,
  steelDensity: 7.85,
  steelUnitPrice: 25,
  postProcessType: '去飞边/装箱',
};

const r = calculateQuote({ input: baseInput });

console.log('===== 模具费 11 项 =====');
Object.entries(r.moldFeeItems).forEach(([k, v]) => {
  console.log(`  ${k.padEnd(20)} = ¥${v.value.toString().padStart(8)}  | ${v.formula}`);
});
console.log(`  ${'小计'.padEnd(20)} = ¥${r.summary.moldSubtotal.toString().padStart(8)}`);
console.log(`  ${'管理费+利润'.padEnd(20)} = ¥${r.summary.moldManagementFee.toString().padStart(8)}`);
console.log(`  ${'模具合计(不含税)'.padEnd(20)} = ¥${r.summary.moldTotalExVat.toString().padStart(8)}`);

console.log('\n===== 注塑 5 项 =====');
Object.entries(r.injectionItems).forEach(([k, v]) => {
  console.log(`  ${k.padEnd(20)} = ¥${v.value.toString().padStart(8)}/件  | ${v.formula}`);
});
console.log(`  ${'单件成本'.padEnd(20)} = ¥${r.summary.unitCostExVat.toString().padStart(8)}/件`);

console.log('\n===== 含税汇总 =====');
console.log(`  模具费含税     = ¥${r.summary.moldIncVat}`);
console.log(`  注塑费含税     = ¥${r.summary.injectionIncVat}`);
console.log(`  含税总计       = ¥${r.summary.grandTotalIncVat}`);

// 验证关键公式
console.log('\n===== 关键公式验证 =====');
// 1. 材料费: 0.18 × 12 × 1.05 = 2.268
const expectedMaterial = 0.18 * 12 * 1.05;
const actualMaterial = r.injectionItems.material.value;
console.log(`  材料费: 期望 ≈ ${expectedMaterial.toFixed(2)}, 实际 = ${actualMaterial} → ${Math.abs(expectedMaterial - actualMaterial) < 0.02 ? '✓' : '✗'}`);

// 2. 加工费: 130 / ((3600/45) × 2 × 0.8) = 130 / 128 = 1.0156
const expectedMachining = 130 / ((3600 / 45) * 2 * 0.8);
const actualMachining = r.injectionItems.machining.value;
console.log(`  加工费: 期望 ≈ ${expectedMachining.toFixed(4)}, 实际 = ${actualMachining} → ${Math.abs(expectedMachining - actualMachining) < 0.02 ? '✓' : '✗'}`);

// 3. 模芯钢料: 500×400×150/1000 × 7.85 × 25 / 1000 = 5887.5
const expectedCoreSteel = (500 * 400 * 150 / 1000) * 7.85 * 25 / 1000;
const actualCoreSteel = r.moldFeeItems.coreSteel.value;
console.log(`  模芯钢料: 期望 ≈ ${expectedCoreSteel.toFixed(2)}, 实际 = ${actualCoreSteel} → ${Math.abs(expectedCoreSteel - actualCoreSteel) < 1 ? '✓' : '✗'}`);

// 测试 cavity 对比
console.log('\n===== 最优腔数对比 =====');
const compare = compareOptimalCavity(baseInput);
compare.forEach((c) => {
  console.log(`  ${c.cavityCount}腔: 模具 ¥${c.moldTotalExVat} | 单件 ¥${c.unitCost} | 总成本 ¥${c.grandTotal}`);
});

const cheapest = compare.reduce((a, b) => (a.grandTotal < b.grandTotal ? a : b));
console.log(`  → 最优腔数: ${cheapest.cavityCount}腔 (总成本 ¥${cheapest.grandTotal})`);

// 测试校验
console.log('\n===== 校验 =====');
const errs1 = validateQuoteInput(baseInput);
console.log(`  完整输入: ${errs1.length === 0 ? '✓ 通过' : '✗ ' + errs1.length + ' 个错误'}`);
const errs2 = validateQuoteInput({ ...baseInput, singleWeightKg: 0 });
console.log(`  重量为 0: ${errs2.length === 1 ? '✓ 检出' : '✗ 未检出'}`);
