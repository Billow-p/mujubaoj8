// 多注塑件聚合层 calculateQuoteProject 单测
// 覆盖：纯注塑多件、开模+注塑、无模具、空清单、手动项、材料费 per-unit

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuoteProject } from '../src/configured.js';
import type { QuoteItemDef } from '@mqs/shared';

// 一个典型的注塑类型费用项集（mold + injection 两种 scope）
function items(): QuoteItemDef[] {
  return [
    // ---- 模具（一次性） ----
    { name: '模芯钢材费', category: '材料费', scope: 'mold', calcType: 'size',
      calcConfig: { l: '模芯长', w: '模芯宽', h: '模芯高', density: 7.85, priceVar: '钢材单价' }, enabled: true },
    { name: '设计费', category: '自定义', scope: 'mold', calcType: 'fixed', calcConfig: { amount: 6000 }, enabled: true },
    { name: '试模费', category: '试模', scope: 'mold', calcType: 'qty', calcConfig: { src: '腔数', price: 2500 }, enabled: true },
    // ---- 注塑（按件） ----
    { name: '产品材料费', category: '注塑材料', scope: 'injection', calcType: 'weight', perUnit: true,
      calcConfig: { wVar: '单件重量', priceVar: '原料单价', loss: 0.05 }, enabled: true },
    { name: '注塑加工费', category: '注塑加工', scope: 'injection', calcType: 'fixed', perUnit: true, calcConfig: { amount: 0.3 }, enabled: true },
  ];
}

// 公共参数：钢材单价、原料单价、模芯尺寸、腔数、数量参数名
const common = {
  profitRate: 0.1,
  taxRate: 0.13,
  qtyVarName: '注塑数量',
  params: {
    钢材单价: 25,
    原料单价: 12,
  },
};

test('纯注塑：20 个不同件，逐件独立算价并汇总', () => {
  const parts = Array.from({ length: 20 }, (_, i) => ({
    code: `P-${String(i + 1).padStart(2, '0')}`,
    name: `件${i + 1}`,
    qty: 1000 + i * 100,
    params: { 单件重量: 0.1 + i * 0.01 }, // 每个件重量不同
  }));

  const r = calculateQuoteProject({ items: items(), common, molds: [], parts });

  // 无模具费
  assert.equal(r.moldSubtotal, 0);
  // 逐件：产品材料费 = 单件重量 × 原料单价 × 1.05；注塑加工费 = 0.3
  // 件1：0.1×12×1.05=1.26 + 0.3 = 1.56 /件；数量 1000 → 1560
  const p1 = r.partResults[0];
  assert.ok(Math.abs(p1.unitCost - 1.56) < 1e-6, `件1 单件成本应为 1.56，实际 ${p1.unitCost}`);
  assert.ok(Math.abs(p1.total - 1560) < 1e-6, `件1 小计应为 1560，实际 ${p1.total}`);

  // 汇总 = 所有件 total 之和（逐件四舍五入，与引擎一致）
  const expSubtotal = parts.reduce((s, p) => {
    const w = 0.1 + (Number(p.code.slice(2)) - 1) * 0.01;
    const uc = Math.round((w * 12 * 1.05 + 0.3) * 100) / 100;
    return s + Math.round(uc * p.qty * 100) / 100;
  }, 0);
  assert.ok(Math.abs(r.injectionSubtotal - expSubtotal) < 1e-6);

  // 利润 = 不含税小计 × 10%；税 = (小计+利润) × 13%
  const subtotal = r.injectionSubtotal;
  assert.equal(r.profit, Math.round(subtotal * 0.1));
  assert.equal(r.tax, Math.round((subtotal + r.profit) * 0.13));
  assert.equal(r.total, subtotal + r.profit + r.tax);
});

test('开模 + 注塑：1 套模具 + N 个件', () => {
  const r = calculateQuoteProject({
    items: items(),
    common,
    molds: [
      { code: 'M-01', name: '控制板模具', params: { 模芯长: 500, 模芯宽: 400, 模芯高: 150, 腔数: 2 } },
    ],
    parts: [
      { code: 'P-01', name: '旋钮', qty: 5000, params: { 单件重量: 0.18 } },
      { code: 'P-02', name: '外壳', qty: 3000, params: { 单件重量: 0.42 } },
    ],
  });

  // 模具费：模芯钢材费 = 500×400×150/1000×7.85/1000×25 = 5887.5；设计费 6000；试模费 腔数2×2500=5000
  const mold = r.moldResults[0];
  assert.ok(Math.abs(mold.subtotal - (5887.5 + 6000 + 5000)) < 1e-6, `模具小计应为 16887.5，实际 ${mold.subtotal}`);

  // 件1：材料 0.18×12×1.05=2.268 → 四舍五入 2.27 + 0.3 = 2.57/件 × 5000 = 12850
  const p1 = r.partResults[0];
  assert.ok(Math.abs(p1.unitCost - 2.57) < 1e-6);
  assert.ok(Math.abs(p1.total - 12850) < 1e-6);

  const subtotal = mold.subtotal + r.partResults[0].total + r.partResults[1].total;
  assert.ok(Math.abs(r.subtotal - subtotal) < 1e-6);
  assert.equal(r.total, r.subtotal + r.profit + r.tax);
});

test('开模 1 套 + 0 件：注塑小计为 0', () => {
  const r = calculateQuoteProject({
    items: items(),
    common,
    molds: [{ code: 'M-01', name: '模具', params: { 模芯长: 500, 模芯宽: 400, 模芯高: 150, 腔数: 2 } }],
    parts: [],
  });
  assert.equal(r.injectionSubtotal, 0);
  assert.equal(r.partResults.length, 0);
  assert.ok(r.moldSubtotal > 0);
});

test('空清单（无模具无件）：总价为 0，不抛错', () => {
  const r = calculateQuoteProject({ items: items(), common, molds: [], parts: [] });
  assert.equal(r.moldSubtotal, 0);
  assert.equal(r.injectionSubtotal, 0);
  assert.equal(r.subtotal, 0);
  assert.equal(r.total, 0);
});

test('手动项：注塑 manual 项金额按 ×数量 计入小计', () => {
  const it = items();
  it.push({ name: '喷涂费', category: '后加工', scope: 'injection', calcType: 'manual', enabled: true });
  const r = calculateQuoteProject({
    items: it,
    common,
    molds: [],
    parts: [{ code: 'P-01', name: '件1', qty: 5000, params: { 单件重量: 0.2 }, manualAmounts: { 喷涂费: 0.5 } }],
  });
  // 喷涂费 0.5/件 × 5000 = 2500 计入注塑小计
  assert.ok(r.injectionSubtotal >= 2500 - 1, `应包含喷涂费 2500，实际 ${r.injectionSubtotal}`);
});

test('老单结构兼容：percent 项（管理费）正确计入模具小计', () => {
  const it = items();
  it.push({ name: '管理费', category: '管理费', scope: 'mold', calcType: 'percent', calcConfig: { rate: 0.15, base: '模具小计' }, enabled: true });
  const r = calculateQuoteProject({
    items: it,
    common,
    molds: [{ code: 'M-01', name: '模具', params: { 模芯长: 500, 模芯宽: 400, 模芯高: 150, 腔数: 2 } }],
    parts: [],
  });
  const base = 5887.5 + 6000 + 5000;
  // 管理费 = base × 15%（按比例项会取整，16887.5 × 0.15 = 2533.125 → 2533）
  assert.ok(Math.abs(r.moldResults[0].subtotal - (base + 2533)) < 1e-6, `模具+管理费应为 ${base + 2533}，实际 ${r.moldResults[0].subtotal}`);
});

// ================================================================
// 贴近后端 /api/quotes/project 路由的真实构建方式：
//   - items 含 mold + injection 两类 scope
//   - common 参数（钢材单价 / 运费单价 / 运输区域…）整单共享
//   - 模具用 mold 作用域参数 + 手动项（设计费）按套填写
//   - 注塑件带材料价（模拟「材料来自材料库」注入 原料单价）+ 各自数量
// 所有期望值手算核对，作为路由计算核心的闭环验证。
// ================================================================
test('端到端场景：2 套模具 + 2 个注塑件（含材料价注入 / 手动项 / 运费公式）', () => {
  const fullItems: QuoteItemDef[] = [
    // ---- 模具（一次性） ----
    { name: '模芯钢材费', category: '材料费', scope: 'mold', calcType: 'size',
      calcConfig: { l: '模芯长', w: '模芯宽', h: '模芯高', density: 7.85, priceVar: '钢材单价' }, enabled: true },
    { name: 'CNC 加工费', category: 'CNC', scope: 'mold', calcType: 'hours', calcConfig: { hours: 96, rate: 400 }, enabled: true },
    { name: '设计费', category: '自定义', scope: 'mold', calcType: 'manual', enabled: true },
    { name: '试模费', category: '试模', scope: 'mold', calcType: 'qty', calcConfig: { src: '腔数', price: 2500 }, enabled: true },
    { name: '运输费', category: '运输', scope: 'mold', calcType: 'formula',
      expression: '最大值 ( 模具重量, 运输箱长 * 运输箱宽 * 运输箱高 / 6000 ) * 运费单价 * 运输区域', enabled: true },
    // ---- 注塑（按件） ----
    { name: '产品材料费', category: '注塑材料', scope: 'injection', calcType: 'weight', perUnit: true,
      calcConfig: { wVar: '单件重量', priceVar: '原料单价', loss: 0.05 }, enabled: true },
    { name: '注塑加工费', category: '注塑加工', scope: 'injection', calcType: 'fixed', perUnit: true, calcConfig: { amount: 0.3 }, enabled: true },
    { name: '包装费', category: '注塑包装', scope: 'injection', calcType: 'fixed', perUnit: true, calcConfig: { amount: 0.05 }, enabled: true },
  ];

  const commonFull = {
    profitRate: 0.1,
    taxRate: 0.13,
    qtyVarName: '注塑数量',
    params: {
      // common 作用域：整单共享
      钢材单价: 25,
      钢材密度: 7.85,
      运输箱长: 120,
      运输箱宽: 100,
      运输箱高: 80,
      运费单价: 1.2,
      运输区域: 0, // 省内免运费
    },
  };

  const molds = [
    { code: 'M-A', name: 'A 模', params: { 模芯长: 500, 模芯宽: 400, 模芯高: 150, 腔数: 2, 模具重量: 800 },
      manualAmounts: { 设计费: 6000 } },
    { code: 'M-B', name: 'B 模', params: { 模芯长: 300, 模芯宽: 200, 模芯高: 100, 腔数: 4, 模具重量: 500 },
      manualAmounts: { 设计费: 8000 } },
  ];

  // 模拟路由把材料库价格注入到 原料单价（= 重量项的 priceVar）
  const materials: Record<string, number> = { ABS: 12, PC: 26 };
  const parts = [
    { code: 'P-1', name: '前盖', materialCode: 'ABS', qty: 5000, params: { 单件重量: 0.18, 原料单价: materials['ABS'] } },
    { code: 'P-2', name: '后盖', materialCode: 'PC', qty: 3000, params: { 单件重量: 0.25, 原料单价: materials['PC'] } },
  ];

  const r = calculateQuoteProject({ items: fullItems, common: commonFull, molds, parts });

  // ---- 模具小计（手算） ----
  // A 模：钢材费 500×400×150/1000×7.85/1000×25=5887.5；CNC 96×400=38400；设计费 manual 6000；试模 2×2500=5000；运输 max(800,160)×1.2×0=0
  assert.ok(Math.abs(r.moldResults[0].subtotal - 55287.5) < 1e-6, `A 模小计应为 55287.5，实际 ${r.moldResults[0].subtotal}`);
  // B 模：钢材费 300×200×100/1000×7.85/1000×25=1177.5；CNC 38400；设计费 manual 8000；试模 4×2500=10000；运输 0
  assert.ok(Math.abs(r.moldResults[1].subtotal - 57577.5) < 1e-6, `B 模小计应为 57577.5，实际 ${r.moldResults[1].subtotal}`);
  assert.equal(r.moldSubtotal, 112865);

  // ---- 注塑件（手算，含逐件四舍五入） ----
  // 前盖：材料 0.18×12×1.05=2.268→2.27 + 0.3 + 0.05 = 2.62/件 ×5000 = 13100
  assert.ok(Math.abs(r.partResults[0].unitCost - 2.62) < 1e-6, `前盖单件成本应为 2.62，实际 ${r.partResults[0].unitCost}`);
  assert.equal(r.partResults[0].total, 13100);
  assert.equal(r.partResults[0].materialCode, 'ABS');
  // 后盖：材料 0.25×26×1.05=6.825→6.83 + 0.3 + 0.05 = 7.18/件 ×3000 = 21540
  assert.ok(Math.abs(r.partResults[1].unitCost - 7.18) < 1e-6, `后盖单件成本应为 7.18，实际 ${r.partResults[1].unitCost}`);
  assert.equal(r.partResults[1].total, 21540);
  assert.equal(r.injectionSubtotal, 34640);

  // ---- 整单汇总 ----
  assert.equal(r.subtotal, 147505);
  assert.equal(r.profit, 14751); // round(147505 × 0.10)
  assert.equal(r.tax, 21093);    // round((147505+14751) × 0.13)
  assert.equal(r.total, 183349);
  assert.equal(r.kind, 'project');

  // 验证 materialCode 透传（前端 / 分享页用）
  assert.deepEqual(r.partResults.map((p) => p.materialCode), ['ABS', 'PC']);
});
