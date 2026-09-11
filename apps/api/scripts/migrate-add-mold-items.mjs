// 回填：给已有配置补上主流模具成本项（幂等，按名称去重，可重复执行）
//
// 新增原则（用户确认）：**默认全部为 0 / 不选，不填就不计钱**，
// 这样不会改变任何已有报价的金额，只有报价时主动填了才会算进去。
//
// - 模具侧：模架费（按规格选）、热流道费、EDM 放电费、线切割费、抛光省模费
//           + 手填项：标准件费、滑块斜顶镶件、热处理费、表面处理费
// - 注塑侧：机台费（时薪 × 周期 ÷ 3600 ÷ 腔数）、后加工费、模具分摊费
//           并把原来固定 0.3 元/件的「注塑加工费」删掉（由机台费取代，避免重复计）
// - 参数：模架规格（下拉）、热流道点数、EDM 工时、线切割长度、抛光工时、
//         机台时薪、成型周期；「腔数」作用域改 common（机台费要用它）

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MOLD_ITEMS = [
  { name: '模架费', category: '模架', scope: 'mold', calcType: 'qty', calcConfig: { src: '模架规格', price: 1 } },
  { name: '热流道费', category: '热流道', scope: 'mold', calcType: 'qty', calcConfig: { src: '热流道点数', price: 8000 } },
  { name: 'EDM放电费', category: 'CNC', scope: 'mold', calcType: 'qty', calcConfig: { src: 'EDM工时', price: 220 } },
  { name: '线切割费', category: 'CNC', scope: 'mold', calcType: 'qty', calcConfig: { src: '线切割长度', price: 8 } },
  { name: '抛光省模费', category: '表面处理', scope: 'mold', calcType: 'qty', calcConfig: { src: '抛光工时', price: 120 } },
  { name: '标准件费', category: '标准件', scope: 'mold', calcType: 'manual', calcConfig: {} },
  { name: '滑块斜顶镶件', category: '自定义', scope: 'mold', calcType: 'manual', calcConfig: {} },
  { name: '热处理费', category: '热处理', scope: 'mold', calcType: 'manual', calcConfig: {} },
  { name: '表面处理费', category: '表面处理', scope: 'mold', calcType: 'manual', calcConfig: {} },
];

const INJ_ITEMS = [
  {
    name: '机台费',
    category: '注塑加工',
    scope: 'injection',
    calcType: 'formula',
    perUnit: true,
    calcConfig: {},
    expression: '机台时薪 * 成型周期 / 3600 / 腔数',
  },
  { name: '后加工费', category: '后加工', scope: 'injection', calcType: 'manual', perUnit: true, calcConfig: {} },
  { name: '模具分摊费', category: '模具分摊', scope: 'injection', calcType: 'manual', perUnit: true, calcConfig: {} },
];

const MOLD_BASE_OPTIONS = [
  { label: '不另计模架费', value: 0 },
  { label: '3030 标准模架', value: 3500 },
  { label: '3035 标准模架', value: 4200 },
  { label: '3535 标准模架', value: 5600 },
  { label: '3540 标准模架', value: 6500 },
  { label: '4040 标准模架', value: 8600 },
  { label: '4050 标准模架', value: 9800 },
  { label: '4550 标准模架', value: 12500 },
  { label: '5050 标准模架', value: 15600 },
];

const NEW_PARAMS = [
  {
    code: 'moldBaseSpec',
    name: '模架规格',
    scope: 'mold',
    type: 'select',
    defaultValue: '0',
    unit: null,
    group: '模具',
    options: JSON.stringify(MOLD_BASE_OPTIONS),
    remark: '按规格自动带出模架价；选「不另计模架费」则为 0',
  },
  { code: 'hotRunnerPoints', name: '热流道点数', scope: 'mold', type: 'decimal', defaultValue: '0', unit: '点', group: '模具' },
  { code: 'edmHours', name: 'EDM工时', scope: 'mold', type: 'decimal', defaultValue: '0', unit: '小时', group: '模具' },
  { code: 'wireCutLength', name: '线切割长度', scope: 'mold', type: 'decimal', defaultValue: '0', unit: 'mm', group: '模具' },
  { code: 'polishHours', name: '抛光工时', scope: 'mold', type: 'decimal', defaultValue: '0', unit: '小时', group: '模具' },
  { code: 'machineHourlyRate', name: '机台时薪', scope: 'injection', type: 'decimal', defaultValue: '130', unit: '元/小时', group: '注塑' },
  { code: 'cycleTime', name: '成型周期', scope: 'injection', type: 'decimal', defaultValue: '30', unit: '秒', group: '注塑' },
];

/** 名称比对用：忽略空格，避免「EDM 放电费」和「EDM放电费」被当成两项重复添加 */
const norm = (s) => String(s ?? '').replace(/\s+/g, '');

/**
 * 参数名里带空格会让公式求值器把 `EDM 工时` 拆成两个标识符，导致该项算成 0。
 * 这里统一去掉参数名里的空格，并同步修正费用项里对它的引用（calcConfig / expression）。
 */
async function normalizeParamNames(moldTypeId) {
  const params = await prisma.customParameter.findMany({ where: { moldTypeId } });
  const renames = [];
  for (const p of params) {
    const fixed = String(p.name ?? '').replace(/\s+/g, '');
    if (!fixed || fixed === p.name) continue;
    const dup = params.find((x) => x.id !== p.id && x.name === fixed);
    if (dup) continue;
    await prisma.customParameter.update({ where: { id: p.id }, data: { name: fixed } });
    renames.push({ from: p.name, to: fixed });
  }
  if (renames.length === 0) return 0;

  const items = await prisma.quoteItem.findMany({ where: { moldTypeId } });
  for (const it of items) {
    const raw = it.calcConfig;
    const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : null;
    let expr = typeof it.expression === 'string' ? it.expression : null;
    let changed = false;

    if (c) {
      for (const k of ['l', 'w', 'h', 'src', 'base', 'wVar', 'priceVar', 'densityVar', 'lossVar']) {
        if (typeof c[k] !== 'string') continue;
        const next = c[k].replace(/\s+/g, '');
        if (next !== c[k]) {
          c[k] = next;
          changed = true;
        }
      }
    }
    if (expr) {
      let next = expr;
      for (const r of renames) next = next.split(r.from).join(r.to);
      if (next !== expr) {
        expr = next;
        changed = true;
      }
    }
    if (changed) {
      await prisma.quoteItem.update({
        where: { id: it.id },
        data: { ...(c ? { calcConfig: c } : {}), ...(expr != null ? { expression: expr } : {}) },
      });
    }
  }
  return renames.length;
}

async function main() {
  const moldTypes = await prisma.moldType.findMany({
    select: { id: true, name: true, code: true, companyId: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const mt of moldTypes) {
    // 所有类型都要跑：参数名带空格是通用隐患
    const renamed = await normalizeParamNames(mt.id);
    // 只在注塑类模具上补（压铸/双色等模板语义不同，避免混乱）
    if (mt.code !== 'injection') {
      console.log(`- ${mt.name}：非注塑模具，跳过（参数名去空格 ${renamed}）`);
      continue;
    }

    const items = await prisma.quoteItem.findMany({ where: { moldTypeId: mt.id } });
    const params = await prisma.customParameter.findMany({ where: { moldTypeId: mt.id } });

    // ---- 去重：忽略空格后同名的费用项只保留最早的一条（重复会导致金额被算两遍） ----
    const seen = new Map();
    const dupes = [];
    for (const it of [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
      const k = norm(it.name);
      if (seen.has(k)) dupes.push(it);
      else seen.set(k, it);
    }
    for (const d of dupes) await prisma.quoteItem.delete({ where: { id: d.id } });
    if (dupes.length) {
      console.log(`- ${mt.name}：清理重复费用项 ${dupes.map((d) => d.name).join(' / ')}`);
    }
    const keptItems = [...seen.values()];

    const itemNames = new Set(keptItems.map((i) => norm(i.name)));
    const paramNames = new Set(params.map((p) => p.name));

    let maxItemOrder = items.reduce((m, i) => Math.max(m, i.sortOrder ?? 0), 0);
    let maxParamOrder = params.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), 0);

    // ---- 费用项 ----
    let addedItems = 0;
    for (const it of [...MOLD_ITEMS, ...INJ_ITEMS]) {
      if (itemNames.has(norm(it.name))) continue;
      maxItemOrder += 1;
      await prisma.quoteItem.create({
        data: {
          companyId: mt.companyId,
          moldTypeId: mt.id,
          name: it.name,
          category: it.category,
          scope: it.scope,
          calcType: it.calcType,
          calcConfig: it.calcConfig ?? {},
          expression: it.expression ?? null,
          perUnit: it.perUnit === true,
          enabled: true,
          sortOrder: maxItemOrder,
        },
      });
      addedItems += 1;
      itemNames.add(norm(it.name));
    }

    // ---- 参数 ----
    let addedParams = 0;
    for (const p of NEW_PARAMS) {
      if (paramNames.has(p.name)) continue;
      maxParamOrder += 1;
      await prisma.customParameter.create({
        data: {
          companyId: mt.companyId,
          moldTypeId: mt.id,
          code: p.code,
          name: p.name,
          type: p.type,
          unit: p.unit,
          defaultValue: p.defaultValue,
          group: p.group,
          scope: p.scope,
          options: p.options ?? null,
          remark: p.remark ?? null,
          sortOrder: maxParamOrder,
          enabled: true,
        },
      });
      addedParams += 1;
      paramNames.add(p.name);
    }

    // ---- 腔数：mold → common（机台费要用；模具计算仍拿得到，因为公共参数会并入） ----
    let cavityMoved = 0;
    const cavity = params.find((p) => p.name === '腔数' && (p.scope ?? 'common') !== 'common');
    if (cavity) {
      await prisma.customParameter.update({ where: { id: cavity.id }, data: { scope: 'common' } });
      cavityMoved = 1;
    }

    // ---- 删掉被机台费取代的固定加工费（避免与机台费重复计） ----
    let removed = 0;
    if (itemNames.has('机台费')) {
      const legacy = items.find((i) => i.name === '注塑加工费' && i.calcType === 'fixed');
      if (legacy) {
        await prisma.quoteItem.delete({ where: { id: legacy.id } });
        removed = 1;
      }
    }

    console.log(
      `- ${mt.name}：新增费用项 ${addedItems} 项、参数 ${addedParams} 个、腔数改公共 ${cavityMoved}、删除旧注塑加工费 ${removed}、参数名去空格 ${renamed}`,
    );
  }

  console.log('\n完成');
}

main()
  .catch((e) => {
    console.error('回填失败：', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
