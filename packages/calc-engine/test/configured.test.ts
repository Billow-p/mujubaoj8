// 配置驱动算价 — 单元测试
import type { QuoteItemDef } from '@mqs/shared';
import {
  buildItemExpression,
  describeItem,
  calculateConfigured,
  calculateQuoteProject,
  normalizeItemVars,
} from '../src/configured.js';

let pass = 0;
let fail = 0;
const t = (name: string, got: unknown, exp: unknown) => {
  const ok = typeof got === 'number' && typeof exp === 'number'
    ? Math.abs(got - exp) < 0.01
    : JSON.stringify(got) === JSON.stringify(exp);
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  期望 ${JSON.stringify(exp)}，实际 ${JSON.stringify(got)}`}`);
  ok ? pass++ : fail++;
};

const P: Record<string, number> = {
  腔数: 2,
  单件重量: 0.18,
  模芯长: 500,
  模芯宽: 400,
  模芯高: 150,
  首单数量: 300000,
  钢材单价: 25,
  机台费率: 130,
};

console.log('=== 1. 计算方式 → 表达式 ===');
const mk = (calcType: any, calcConfig: any, expression?: string): QuoteItemDef => ({
  name: 'X', scope: 'mold', calcType, calcConfig, expression, enabled: true,
});
t('固定金额', buildItemExpression(mk('fixed', { amount: 6000 })), '6000');
t('数量×单价（参数）', buildItemExpression(mk('qty', { src: '腔数', price: 2500 })), '腔数 * 2500');
t('数量×单价（固定数）', buildItemExpression(mk('qty', { srcQty: 4, price: 100 })), '4 * 100');
t('工时×时薪', buildItemExpression(mk('hours', { hours: 96, rate: 400 })), '96 * 400');
t(
  '按尺寸算材料',
  buildItemExpression(mk('size', { l: '模芯长', w: '模芯宽', h: '模芯高', density: 7.85, priceVar: '钢材单价' })),
  '模芯长 * 模芯宽 * 模芯高 / 1000 * 7.85 / 1000 * 钢材单价 * ( 1 + 0 )',
);
t(
  '按尺寸算材料（密度/损耗走参数）',
  buildItemExpression(
    mk('size', {
      l: '模芯长',
      w: '模芯宽',
      h: '模芯高',
      density: 7.85,
      densityVar: '钢材密度',
      priceVar: '钢材单价',
      lossVar: '钢材损耗率',
    }),
  ),
  '模芯长 * 模芯宽 * 模芯高 / 1000 * 钢材密度 / 1000 * 钢材单价 * ( 1 + 钢材损耗率 )',
);
t(
  '按重量算',
  buildItemExpression(mk('weight', { wVar: '单件重量', priceVar: '钢材单价', loss: 0.05 })),
  '单件重量 * 钢材单价 * ( 1 + 0.05 )',
);
t('高级公式', buildItemExpression(mk('formula', {}, '腔数 * 888')), '腔数 * 888');
t('手填返回 0', buildItemExpression(mk('manual', {})), '0');

console.log('=== 2. 中文读法 ===');
t('固定金额读法', describeItem(mk('fixed', { amount: 6000 })), '固定金额 ¥6,000');
t('数量读法', describeItem(mk('qty', { src: '腔数', price: 2500 })), '腔数 × 2500 元');
t('工时读法', describeItem(mk('hours', { hours: 96, rate: 400 })), '96 小时 × 400 元/小时');
t('比例读法', describeItem(mk('percent', { base: '模具小计', rate: 0.15 })), '模具小计 × 15%');

console.log('=== 3. 整单算价（配置驱动） ===');
const items: QuoteItemDef[] = [
  { name: '模芯钢材费', category: '材料费', scope: 'mold', calcType: 'size', enabled: true, sortOrder: 1,
    calcConfig: { l: '模芯长', w: '模芯宽', h: '模芯高', density: 7.85, priceVar: '钢材单价' } },
  { name: 'CNC 加工费', category: 'CNC', scope: 'mold', calcType: 'hours', enabled: true, sortOrder: 2,
    calcConfig: { hours: 96, rate: 400 } },
  { name: '设计费', category: '自定义', scope: 'mold', calcType: 'fixed', enabled: true, sortOrder: 3,
    calcConfig: { amount: 6000 } },
  { name: '试模费', category: '试模', scope: 'mold', calcType: 'qty', enabled: true, sortOrder: 4,
    calcConfig: { src: '腔数', price: 2500 } },
  { name: '管理费', category: '管理费', scope: 'mold', calcType: 'percent', enabled: true, sortOrder: 5,
    calcConfig: { base: '模具小计', rate: 0.15 } },
];
const r = calculateConfigured(items, P, { profitRate: 0.1, taxRate: 0.13 });
const get = (n: string) => r.lines.find((x) => x.name === n)!;

t('模芯钢材费', get('模芯钢材费').value, 5887.5);
t('CNC 加工费', get('CNC 加工费').value, 38400);
t('设计费', get('设计费').value, 6000);
t('试模费', get('试模费').value, 5000);
const sub = 5887.5 + 38400 + 6000 + 5000;
t('管理费 = 前四项之和 × 15%', get('管理费').value, Math.round(sub * 0.15));
t('模具合计', r.mold, sub + Math.round(sub * 0.15));
const beforeTax = r.mold + Math.round(r.mold * 0.1);
t('利润 = 模具合计 × 10%', r.profit, Math.round(r.mold * 0.1));
t('税额', r.tax, Math.round(beforeTax * 0.13));
t('含税总价', r.total, beforeTax + Math.round(beforeTax * 0.13));
t('错误数为 0', r.lines.filter((l) => l.error).length, 0);

console.log('=== 4. 管理费改成固定金额（用户可手动调整） ===');
const items2 = items.map((x) => (x.name === '管理费'
  ? { ...x, calcType: 'fixed' as const, calcConfig: { amount: 8000 } }
  : x));
const r2 = calculateConfigured(items2, P, { profitRate: 0.1, taxRate: 0.13 });
t('管理费 = 固定 8000', r2.lines.find((x) => x.name === '管理费')!.value, 8000);
t('模具合计随之变化', r2.mold, sub + 8000);

console.log('=== 5. 停用 / 手填 / 坏配置 ===');
const items3: QuoteItemDef[] = [
  ...items.slice(0, 4),
  { name: '差旅费', category: '自定义', scope: 'mold', calcType: 'manual', enabled: true, sortOrder: 5 },
  { name: '运输费', category: '自定义', scope: 'mold', calcType: 'fixed', enabled: false, sortOrder: 6, calcConfig: { amount: 3000 } },
  { name: '坏项', category: '自定义', scope: 'mold', calcType: 'qty', enabled: true, sortOrder: 7, calcConfig: { src: '已删参数', price: 5 } },
];
const r3 = calculateConfigured(items3, P, {});
t('手填项标记', r3.lines.find((x) => x.name === '差旅费')!.manual, true);
t('停用项被跳过', r3.lines.find((x) => x.name === '运输费')!.skipped, true);
t('停用项不计入金额', r3.mold, sub);
t('坏配置有中文报错', !!r3.lines.find((x) => x.name === '坏项')!.error, true);
console.log('        报错文案：' + r3.lines.find((x) => x.name === '坏项')!.error);

console.log('=== 6. 计算链：后面的项引用前面的结果 ===');
const items4: QuoteItemDef[] = [
  { name: '材料费', category: '材料费', scope: 'mold', calcType: 'fixed', enabled: true, sortOrder: 1, calcConfig: { amount: 10000 } },
  { name: '包装费', category: '包装', scope: 'mold', calcType: 'percent', enabled: true, sortOrder: 2, calcConfig: { base: '材料费合计', rate: 0.03 } },
];
const r4 = calculateConfigured(items4, P, {});
t('按材料费合计的 3% 算包装费', r4.lines.find((x) => x.name === '包装费')!.value, 300);

console.log('=== 7. 注塑项单独累计 ===');
const items5: QuoteItemDef[] = [
  { name: '材料费', category: '材料费', scope: 'injection', calcType: 'weight', enabled: true, sortOrder: 1,
    calcConfig: { wVar: '单件重量', priceVar: '钢材单价', loss: 0.05 } },
];
const r5 = calculateConfigured(items5, P, {});
t('单件材料费', r5.lines[0].value, 4.73);
t('注塑合计', r5.injection, 4.73);
t('模具合计为 0', r5.mold, 0);

console.log('=== 8. 按件计价（注塑费的核心算法） ===');
const P2: Record<string, number> = { ...P, 注塑数量: 5000 };
const unitItem = (name: string, amount: number, sortOrder: number): QuoteItemDef => ({
  name, category: '加工费', scope: 'injection', calcType: 'fixed',
  enabled: true, perUnit: true, sortOrder, calcConfig: { amount },
});
const r6 = calculateConfigured([unitItem('注塑加工费', 0.3, 1)], P2, {});
t('单件 0.3 元 × 5000 件 = 1500 元', r6.lines[0].value, 1500);
t('单件成本 = 0.3', r6.lines[0].unitPrice, 0.3);
t('数量回填 = 5000', r6.lines[0].qty, 5000);
t('按件计价标记', r6.lines[0].perUnit, true);
t('注塑合计 = 1500', r6.injection, 1500);
t('单件成本合计 = 0.3', r6.unitCost, 0.3);
t('注塑数量回传到结果', r6.injectionQty, 5000);

console.log('=== 9. 多项注塑费：材料费按重量 + 加工费按件 ===');
const P3: Record<string, number> = { ...P2, 原料单价: 12 };
const items7: QuoteItemDef[] = [
  { name: '产品材料费', category: '材料费', scope: 'injection', calcType: 'weight', enabled: true,
    perUnit: true, sortOrder: 1, calcConfig: { wVar: '单件重量', priceVar: '原料单价', loss: 0.05 } },
  unitItem('注塑加工费', 0.3, 2),
  unitItem('包装费', 0.05, 3),
];
const r7 = calculateConfigured(items7, P3, {});
t('材料费单件成本 0.18kg × 12 × 1.05 = 2.27', r7.lines[0].unitPrice, 2.27);
t('材料费金额 2.268 × 5000', r7.lines[0].value, 11340);
t('加工费金额 1500', r7.lines[1].value, 1500);
t('包装费金额 250', r7.lines[2].value, 250);
t('单件成本合计 2.27+0.30+0.05 = 2.62', r7.unitCost, 2.62);
t('注塑费用合计 13090', r7.injection, 13090);
t('模具合计为 0', r7.mold, 0);

console.log('=== 10. 不带 perUnit 的注塑项按总额处理（向后兼容） ===');
const r8 = calculateConfigured(
  [{ name: '注塑加工费', category: '加工费', scope: 'injection', calcType: 'qty', enabled: true,
     sortOrder: 1, calcConfig: { src: '注塑数量', price: 0.3 } }],
  P2,
  {},
);
t('数量×单价 = 1500（总额）', r8.injection, 1500);
t('反推出单件成本 0.3', r8.lines[0].unitPrice, 0.3);

console.log('=== 11. 缺少数量参数时给出人话报错 ===');
const r9 = calculateConfigured([unitItem('注塑加工费', 0.3, 1)], { 腔数: 2 }, {});
t('报错被捕获', !!r9.lines[0].error, true);
t('注塑合计为 0', r9.injection, 0);
console.log('        报错文案：' + r9.lines[0].error);

console.log('=== 12. 按件计价的中文读法 ===');
t(
  '按件计价读法带「× 注塑数量」',
  describeItem(unitItem('注塑加工费', 0.3, 1)),
  '单件 ¥0.3　×　注塑数量',
);
t(
  '模具项读法不带「× 注塑数量」',
  describeItem({ name: '设计费', scope: 'mold', calcType: 'fixed', enabled: true, calcConfig: { amount: 6000 } }),
  '固定金额 ¥6,000',
);

console.log('=== 13. 模具钢材来自材料库（方案 A） ===');
/** 单件算价快捷方式 */
const one = (cfg: any, p: Record<string, number>) =>
  calculateConfigured(
    [{ name: '模芯钢材费', category: '材料费', scope: 'mold', calcType: 'size', enabled: true, sortOrder: 1, calcConfig: cfg }],
    p,
    {},
  ).mold;

// 235.5kg = 500×400×150/1000×7.85/1000
const Psteel: Record<string, number> = { 模芯长: 500, 模芯宽: 400, 模芯高: 150, 钢材单价: 25 };

t('未选材料：密度写死 7.85、无损耗 → 235.5 × 25 = 5887.5', one({ l: '模芯长', w: '模芯宽', h: '模芯高', density: 7.85, priceVar: '钢材单价' }, Psteel), 5887.5);

const steelVarCfg = {
  l: '模芯长', w: '模芯宽', h: '模芯高',
  density: 7.85, densityVar: '钢材密度',
  priceVar: '钢材单价', lossVar: '钢材损耗率',
};

// 关键回归：声明了 densityVar/lossVar 但参数缺失时，必须回落到 calcConfig 固定值 → 与老配置完全一致
const oldVal = one({ l: '模芯长', w: '模芯宽', h: '模芯高', density: 7.85, priceVar: '钢材单价' }, Psteel);
t('变量缺失自动回填 → 结果与老配置一致', one(steelVarCfg, Psteel), oldVal);

const filled = normalizeItemVars(
  [{ name: '模芯钢材费', scope: 'mold', calcType: 'size', enabled: true, calcConfig: steelVarCfg as any }],
  Psteel,
);
t('normalizeItemVars 补出 钢材密度', filled['钢材密度'], 7.85);
t('normalizeItemVars 把缺失损耗补 0（避免未知变量导致整项归零）', filled['钢材损耗率'], 0);

// 选了材料：NAK80（60 元/kg、7.85、损耗 10%）
const Pnak = { ...Psteel, 钢材单价: 60, 钢材密度: 7.85, 钢材损耗率: 0.1 };
t('选 NAK80：235.5 × 60 × 1.1 = 15543', one(steelVarCfg, Pnak), 15543);

// 选了材料：Cr12MoV（38 元/kg、密度 7.7、损耗 10%）→ 231kg
const Pcr = { ...Psteel, 钢材单价: 38, 钢材密度: 7.7, 钢材损耗率: 0.1 };
t('选 Cr12MoV：231 × 38 × 1.1 = 9655.8（密度随牌号变）', one(steelVarCfg, Pcr), 9655.8);

console.log('=== 14. 压铸模具：加变量声明后旧行为不变 ===');
const dp = { 投影面积: 320, 平均壁厚: 2.5, 合金单价: 22 };
const diecastOld = { l: '投影面积', w: '平均壁厚', h: '', density: 2.7, priceVar: '合金单价' };
const diecastNew = { ...diecastOld, densityVar: '钢材密度', lossVar: '钢材损耗率' };
t('压铸未选钢材密度参数 → 沿用配置里的 2.7，结果不变', one(diecastNew, dp), one(diecastOld, dp));
t('压铸选了钢材（7.85 / 损耗12%）后按新材料算', one(diecastNew, { ...dp, 钢材密度: 7.85, 钢材损耗率: 0.12 }) > one(diecastOld, dp), true);

console.log('=== 15. 一单多模具：各套钢材可不同（模具参数覆盖整单） ===');
const projItems: QuoteItemDef[] = [
  { name: '模芯钢材费', category: '材料费', scope: 'mold', calcType: 'size', enabled: true, sortOrder: 1, calcConfig: steelVarCfg },
];
const pr = calculateQuoteProject({
  items: projItems,
  common: { profitRate: 0, taxRate: 0, params: { 钢材单价: 25, 钢材密度: 7.85, 钢材损耗率: 0.1 } },
  molds: [
    { name: 'A模', params: { 模芯长: 500, 模芯宽: 400, 模芯高: 150 } },
    { name: 'B模', materialCode: 'NAK80', materialName: 'NAK80 镜面预硬钢', params: { 模芯长: 500, 模芯宽: 400, 模芯高: 150, 钢材单价: 60 } },
  ],
  parts: [],
});
t('A 模走整单默认（25 元/kg）', pr.moldResults[0].subtotal, 6476.25);
t('B 模走自己的 NAK80（60 元/kg）', pr.moldResults[1].subtotal, 15543);
t('B 模带出钢材名称', pr.moldResults[1].materialName, 'NAK80 镜面预硬钢');
t('模具小计 = 两者之和', pr.moldSubtotal, 6476.25 + 15543);

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
