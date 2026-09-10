// 配置驱动算价 — 单元测试
import type { QuoteItemDef } from '@mqs/shared';
import {
  buildItemExpression,
  describeItem,
  calculateConfigured,
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
  '模芯长 * 模芯宽 * 模芯高 / 1000 * 7.85 / 1000 * 钢材单价',
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

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
