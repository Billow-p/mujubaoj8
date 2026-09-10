// 计算引擎测试 — 用 Excel 原示例的数据作为基准
// Excel 案例: B7=0.18, B11=12, E11=0.05, B12=130, E9=45, B8=2, B10=0.8, E10=300000
//             B14=500, E14=400, B15=150, E15=7.85, B16=25, E16=0.15, E12=0.13

import { calculateQuote, compareOptimalCavity, validateQuoteInput } from '../src/index';
import type { QuoteInput } from '@mqs/shared';

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

// 测试 extras（附加项）
console.log('\n===== 附加项 extras =====');
const rExtras = calculateQuote({
  input: {
    ...baseInput,
    extras: {
      moldExtras: [
        { id: '1', name: '包装木箱', amount: 1500 },
        { id: '2', name: '运输费', amount: 800, note: '省外' },
      ],
      injectionExtras: [
        { id: '3', name: '二次喷涂', amount: 0.5, note: '每件+0.5元' },
      ],
    },
  },
});
const baseSubtotal = r.summary.grandTotalIncVat;
const newSubtotal = rExtras.summary.grandTotalIncVat;
const diff = newSubtotal - baseSubtotal;
// 规则：附加项与自定义报价项属于成本，与管理费/利润一并加成后再计税
//   模具侧：(附加项合计 × (1 + 管理费率)) × (1 + 税率)
//   注塑侧：单件附加 × 数量 × (1 + 税率)
const mgmt = 1 + baseInput.managementRate;
const vat = 1 + baseInput.vatRate;
const expectedDiff = (1500 + 800) * mgmt * vat + 0.5 * 300000 * vat;
console.log(`  基础含税: ¥${baseSubtotal}`);
console.log(`  加 extras 后: ¥${newSubtotal}（差值 ¥${diff}）`);
console.log(`  期望差值: ¥${expectedDiff.toFixed(0)} → ${Math.abs(diff - expectedDiff) < 5 ? '✓' : '✗'}`);
console.log(`  moldExtrasTotal = ¥${rExtras.summary.moldExtrasTotal}（期望 2300） → ${rExtras.summary.moldExtrasTotal === 2300 ? '✓' : '✗'}`);
console.log(`  injectionExtrasUnit = ¥${rExtras.summary.injectionExtrasUnit}（期望 0.5） → ${rExtras.summary.injectionExtrasUnit === 0.5 ? '✓' : '✗'}`);
console.log(`  extras.moldExtras.length = ${rExtras.extras?.moldExtras.length}（期望 2） → ${rExtras.extras?.moldExtras.length === 2 ? '✓' : '✗'}`);
console.log(`  extras.injectionExtras.length = ${rExtras.extras?.injectionExtras.length}（期望 1） → ${rExtras.extras?.injectionExtras.length === 1 ? '✓' : '✗'}`);

// 测试参数中心 customFormulas
console.log('\n===== 参数中心 customFormulas =====');
const rCustom = calculateQuote({
  input: baseInput,
  customFormulas: [
    {
      name: '热流道费',
      scope: 'mold',
      expression: 'cavityCount * 1500 + 3000',
      enabled: true,
      sortOrder: 0,
      note: '每腔 1500 + 基础 3000',
    },
    {
      name: '特殊工艺系数',
      scope: 'mold',
      expression: 'designFee * 0.5',
      enabled: true,
      sortOrder: 1,
    },
    {
      name: '精密装配费',
      scope: 'injection',
      expression: 'round(machining * 1.2, 2)',
      enabled: true,
      sortOrder: 2,
    },
  ],
});
const expectedHeatRunner = 2 * 1500 + 3000; // 6000
const expectedSpecial = 6000 * 0.5; // 3000（designFee 是 6000）
const expectedAssembly = Math.round(1.02 * 1.2 * 100) / 100; // 1.22
console.log(`  热流道费 = ¥${rCustom.customFormulas?.mold[0]?.value}（期望 ${expectedHeatRunner}） → ${rCustom.customFormulas?.mold[0]?.value === expectedHeatRunner ? '✓' : '✗'}`);
console.log(`  特殊工艺系数 = ¥${rCustom.customFormulas?.mold[1]?.value}（期望 ${expectedSpecial}） → ${rCustom.customFormulas?.mold[1]?.value === expectedSpecial ? '✓' : '✗'}`);
console.log(`  精密装配费 = ¥${rCustom.customFormulas?.injection[0]?.value}（期望 ${expectedAssembly}） → ${rCustom.customFormulas?.injection[0]?.value === expectedAssembly ? '✓' : '✗'}`);
// 验证 moldCustom 影响 moldSubtotal
const expectedMoldSubtotal = 158088 + expectedHeatRunner + expectedSpecial; // 158088 = 11项模具费基础小计
console.log(`  moldSubtotal 含 custom = ¥${rCustom.summary.moldSubtotal}（期望 ${expectedMoldSubtotal}） → ${rCustom.summary.moldSubtotal === expectedMoldSubtotal ? '✓' : '✗'}`);
console.log(`  unitCostExVat 含 custom = ¥${rCustom.summary.unitCostExVat}（期望 ${(4.15 + expectedAssembly).toFixed(2)}） → ${Math.abs(rCustom.summary.unitCostExVat - (4.15 + expectedAssembly)) < 0.02 ? '✓' : '✗'}`);

// 公式错误容错：单个公式失败不应阻塞整单
console.log('\n===== customFormulas 错误容错 =====');
const rCustom2 = calculateQuote({
  input: baseInput,
  customFormulas: [
    { name: '正确公式', scope: 'mold', expression: 'cavityCount * 100', enabled: true, sortOrder: 0 },
    { name: '错误公式', scope: 'mold', expression: 'undefinedVar * 2', enabled: true, sortOrder: 1 },
  ],
});
const correctVal = rCustom2.customFormulas?.mold[0]?.value;
const errVal = rCustom2.customFormulas?.mold[1]?.value;
console.log(`  正确公式结果 = ¥${correctVal}（期望 200） → ${correctVal === 200 ? '✓' : '✗'}`);
console.log(`  错误公式结果 = ¥${errVal}（期望 0，不阻塞） → ${errVal === 0 ? '✓' : '✗'}`);
