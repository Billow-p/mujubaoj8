// 计算逻辑全量审计（在服务器上跑）
//
// 思路：**不看引擎代码**，按业务公式独立重算每一项，再与引擎输出逐行比对。
// 任何一处不一致都会 FAIL —— 用来回答「总合计到底有没有算错」。
//
// 覆盖场景：
//   S1 不填任何新增项（运输区域=省内 0）
//   S2 运输区域 = 省外 1
//   S3 运输区域 = 偏远 2
//   S4 模架/热流道/EDM/线切割/抛光 全填 + 4 个手填项
//   S5 用材料库（模具 NAK80 / 注塑 PA）+ 运输附加费 + 注射手填项
//   S6 换机台参数（时薪 180 / 周期 45 / 腔数 4 / 数量 12000）

import { PrismaClient } from '@prisma/client';
import { calculateQuoteProject } from '@mqs/calc-engine';

const prisma = new PrismaClient();
const COMPANY = 'default-company';
let fail = 0;
const r2 = (n) => Math.round(n * 100) / 100;
const near = (a, b, eps = 0.02) => Math.abs(Number(a) - Number(b)) <= eps;

const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${extra ? ' :: ' + extra : ''}`);
  if (!ok) fail++;
};

async function main() {
  const mt = await prisma.moldType.findFirst({
    where: { companyId: COMPANY, code: 'injection' },
    select: { id: true },
  });
  const parameters = await prisma.customParameter.findMany({
    where: { moldTypeId: mt.id, enabled: true },
    orderBy: { sortOrder: 'asc' },
  });
  const items = await prisma.quoteItem.findMany({
    where: { moldTypeId: mt.id },
    orderBy: { sortOrder: 'asc' },
  });

  const defs = items.map((it, i) => ({
    name: it.name,
    category: it.category,
    scope: (it.scope ?? 'mold'),
    calcType: it.calcType,
    calcConfig: it.calcConfig ?? {},
    expression: it.expression ?? undefined,
    enabled: it.enabled,
    sortOrder: i,
    perUnit: (it.scope ?? 'mold') === 'injection' && it.perUnit === true,
    unit: it.unit ?? undefined,
  }));

  const defaultsFor = (scope) => {
    const out = {};
    for (const p of parameters) {
      if ((p.scope ?? 'common') !== scope) continue;
      const n = Number(p.defaultValue);
      if (Number.isFinite(n)) out[p.name] = n;
    }
    return out;
  };

  /** 按业务公式独立重算每一项（与引擎实现无关） */
  function expected(common, moldParams, partParams, moldManuals, partManuals, qty) {
    const M = { ...common, ...moldParams };
    const P = { ...common, ...partParams, 注塑数量: qty };
    const g = (src, k, d = 0) => (src && src[k] != null && Number.isFinite(Number(src[k])) ? Number(src[k]) : d);

    const mold = {};
    mold['模芯钢材费'] = (g(M, '模芯长') * g(M, '模芯宽') * g(M, '模芯高')) / 1000 * g(M, '钢材密度', 7.85) / 1000 * g(M, '钢材单价') * (1 + g(M, '钢材损耗率'));
    mold['CNC 加工费'] = 96 * 400;
    mold['设计费'] = 6000;
    mold['试模费'] = g(M, '腔数') * 2500;
    mold['运输费'] = Math.max(g(M, '模具重量'), (g(M, '运输箱长') * g(M, '运输箱宽') * g(M, '运输箱高')) / 6000) * g(M, '运费单价') * g(M, '运输区域');
    mold['模架费'] = g(M, '模架规格');
    mold['热流道费'] = g(M, '热流道点数') * 8000;
    mold['EDM放电费'] = g(M, 'EDM工时') * 220;
    mold['线切割费'] = g(M, '线切割长度') * 8;
    mold['抛光省模费'] = g(M, '抛光工时') * 120;
    for (const n of ['标准件费', '滑块斜顶镶件', '热处理费', '表面处理费', '运输附加费']) {
      mold[n] = g(moldManuals, n);
    }

    const inj = {};
    inj['产品材料费'] = g(P, '单件重量') * g(P, '原料单价') * (1 + g(P, '原料损耗率'));
    inj['机台费'] = (g(P, '机台时薪') * g(P, '成型周期')) / 3600 / g(P, '腔数');
    inj['包装费'] = 0.05;
    for (const n of ['后加工费', '模具分摊费']) inj[n] = g(partManuals, n);

    return { mold, inj };
  }

  const scenarios = [
    { name: 'S1 全默认（省内免运费）', zone: 0, mold: {}, part: {}, mm: {}, pm: {}, qty: 5000, common: {} },
    { name: 'S2 运输区域=省外 1', zone: 1, mold: {}, part: {}, mm: {}, pm: {}, qty: 5000, common: {} },
    { name: 'S3 运输区域=偏远 2', zone: 2, mold: {}, part: {}, mm: {}, pm: {}, qty: 5000, common: {} },
    {
      name: 'S4 模具项全填 + 4 个手填',
      zone: 1,
      mold: { 模架规格: 8600, 热流道点数: 2, EDM工时: 10, 线切割长度: 100, 抛光工时: 5 },
      part: {},
      mm: { 标准件费: 3000, 滑块斜顶镶件: 5000, 热处理费: 2000, 表面处理费: 1500 },
      pm: {},
      qty: 5000,
      common: {},
    },
    {
      name: 'S5 运输附加费 + 注射手填',
      zone: 1,
      mold: { 运输附加费: 300 },
      part: {},
      mm: { 运输附加费: 300 },
      pm: { 后加工费: 0.2, 模具分摊费: 0.5 },
      qty: 5000,
      common: {},
    },
    {
      name: 'S6 机台参数变化',
      zone: 1,
      mold: {},
      part: { 机台时薪: 180, 成型周期: 45 },
      mm: {},
      pm: {},
      qty: 12000,
      common: { 腔数: 4 },
    },
  ];

  for (const s of scenarios) {
    console.log(`\n=== ${s.name} ===`);
    const common = {
      ...defaultsFor('common'),
      运输区域: s.zone,
      ...Object.fromEntries(Object.entries(s.common).map(([k, v]) => [k, Number(v)])),
    };
    const moldParams = { ...defaultsFor('mold'), ...s.mold };
    const partParams = { ...defaultsFor('injection'), ...s.part };

    const res = calculateQuoteProject({
      items: defs,
      common: { profitRate: 0.1, taxRate: 0.13, params: common },
      molds: [{ name: '模具1', params: moldParams, manualAmounts: s.mm }],
      parts: [{ name: '件1', qty: s.qty, params: partParams, manualAmounts: s.pm }],
    });

    const exp = expected(common, moldParams, partParams, s.mm, s.pm, s.qty);
    const moldRes = res.moldResults[0];
    const partRes = res.partResults[0];

    let checked = 0;
    for (const [name, want] of Object.entries(exp.mold)) {
      const got = moldRes.lines.find((l) => l.name === name);
      const ok = got && near(got.value, r2(want));
      if (!ok) check(`${name}`, false, `引擎=${got?.value} 期望=${r2(want)}`);
      else checked++;
    }
    for (const [name, want] of Object.entries(exp.inj)) {
      const got = partRes.lines.find((l) => l.name === name);
      const ok = got && near(got.value, r2(want * s.qty));
      if (!ok) check(`${name}`, false, `引擎=${got?.value} 期望=${r2(want * s.qty)}`);
      else checked++;
    }
    check(`全部 ${checked} 项逐行一致`, checked >= 15, `matched=${checked}`);

    // 汇总：小计 / 利润 / 税 / 总价
    const moldSum = r2(moldRes.lines.reduce((s2, l) => s2 + (l.value ?? 0), 0));
    const injSum = r2(partRes.lines.reduce((s2, l) => s2 + (l.value ?? 0), 0));
    check('模具合计 = 各项之和', near(res.moldSubtotal, moldSum), `${res.moldSubtotal} vs ${moldSum}`);
    check('注塑合计 = 各项之和', near(res.injectionSubtotal, injSum), `${res.injectionSubtotal} vs ${injSum}`);
    const subtotal = r2(res.moldSubtotal + res.injectionSubtotal);
    check('不含税小计 = 模具 + 注塑', near(res.subtotal, subtotal), `${res.subtotal} vs ${subtotal}`);
    const profit = Math.round(subtotal * 0.1);
    check('利润 = 小计 × 10%', near(res.profit, profit), `${res.profit} vs ${profit}`);
    const tax = Math.round((subtotal + profit) * 0.13);
    check('税额 = (小计+利润) × 13%', near(res.tax, tax), `${res.tax} vs ${tax}`);
    check('含税总价 = 三者相加', near(res.total, subtotal + profit + tax), `${res.total} vs ${subtotal + profit + tax}`);

    // 抽查关键金额，防止「凑巧相等」
    check('抽查：运输费符合 重量×单价×系数', near(line(moldRes, '运输费'), r2(exp.mold['运输费'])), `=${line(moldRes, '运输费')} 期望 ${r2(exp.mold['运输费'])}`);
    check('抽查：钢材费', near(line(moldRes, '模芯钢材费'), r2(exp.mold['模芯钢材费'])), `=${line(moldRes, '模芯钢材费')}`);
    check('抽查：材料费单件', near(line(partRes, '产品材料费')?.unitPrice, r2(exp.inj['产品材料费'])), `=${line(partRes, '产品材料费')?.unitPrice}`);
  }

  // ---- 专项：运输区域 0/1/2 的金额必须严格成 0 : 1 : 2 ----
  console.log('\n=== 专项：运输区域系数 0/1/2 ===');
  const zoneTotals = [];
  for (const z of [0, 1, 2]) {
    const res = calculateQuoteProject({
      items: defs,
      common: { profitRate: 0, taxRate: 0, params: { ...defaultsFor('common'), 运输区域: z } },
      molds: [{ name: 'M', params: defaultsFor('mold') }],
      parts: [{ name: 'P', qty: 5000, params: defaultsFor('injection') }],
    });
    zoneTotals.push(line(res.moldResults[0], '运输费'));
  }
  check('省内(0) 运输费 = 0', near(zoneTotals[0], 0), `=${zoneTotals[0]}`);
  check('省外(1) 运输费 = 重量×单价', near(zoneTotals[1], 800 * 1.2), `=${zoneTotals[1]}`);
  check('偏远(2) 运输费 = 省外的 2 倍', near(zoneTotals[2], zoneTotals[1] * 2), `${zoneTotals[2]} vs ${zoneTotals[1] * 2}`);

  console.log(fail === 0 ? '\nALL_PASS' : `\nFAILED=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

function line(result, name) {
  return result?.lines?.find((l) => l.name === name)?.value;
}

main()
  .catch((e) => {
    console.error('ERR', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
