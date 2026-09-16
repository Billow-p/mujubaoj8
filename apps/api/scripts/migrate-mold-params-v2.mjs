// 补齐模具预置参数 v2（幂等，可重复执行）
//
// 背景：注塑模具参照「好成本 注塑模具 ED V3.0」补齐了四项能力，并调整了参数分区。
// 已有企业库里不会自动出现这些内容，需要跑一次本脚本。
//
// 做四件事（全部是「只补不改」，绝不覆盖用户已改过的值）：
//   1) 补参数：预置里有、库里没有的参数（前模钢材 / 后模钢材 / 滑块斜顶数量 / 模具寿命 / 双色模系数）
//   2) 同步作用域：按预置声明把参数在「公共 / 模具 / 注塑件」之间搬家
//      （腔数、钢材单价、钢材密度、钢材损耗率 从公共挪到模具）
//   3) 补费用项：滑块斜顶费 / 模具寿命加价 / 双色模加价
//   4) 给已有费用项补 priceVars（模芯钢材费 → 前模/后模加权，金额中性）

import { PrismaClient } from '@prisma/client';
import { MOLD_PRESETS } from '../dist/services/moldPresets.js';

const prisma = new PrismaClient();

async function main() {
  const moldTypes = await prisma.moldType.findMany({
    select: { id: true, name: true, code: true, companyId: true },
    orderBy: { createdAt: 'asc' },
  });

  let totalParams = 0;
  let totalMoved = 0;
  let totalItems = 0;
  let totalVars = 0;

  for (const mt of moldTypes) {
    const preset = MOLD_PRESETS.find((p) => p.code === mt.code);
    if (!preset) continue; // 用户自建类型不动

    const [params, items] = await Promise.all([
      prisma.customParameter.findMany({
        where: { moldTypeId: mt.id },
        select: { id: true, code: true, scope: true },
      }),
      prisma.quoteItem.findMany({
        where: { moldTypeId: mt.id },
        select: { id: true, name: true, calcConfig: true },
      }),
    ]);

    const paramByCode = new Map(params.map((p) => [p.code, p]));
    const itemByName = new Map(items.map((i) => [i.name, i]));
    const maxParamOrder = params.length;

    // ---- 1) 补缺失参数 ----
    const missingParams = preset.params.filter((x) => !paramByCode.has(x.code));
    if (missingParams.length) {
      await prisma.customParameter.createMany({
        data: missingParams.map((x, i) => ({
          companyId: mt.companyId,
          moldTypeId: mt.id,
          code: x.code,
          name: x.name,
          unit: x.unit,
          defaultValue: x.materialCode ? '' : String(x.value),
          group: x.group,
          scope: x.scope ?? 'common',
          type: x.type ?? 'decimal',
          materialCode: x.materialCode ?? null,
          options: x.options ? JSON.stringify(x.options) : null,
          sortOrder: maxParamOrder + i,
        })),
      });
    }

    // ---- 2) 同步作用域 ----
    let moved = 0;
    for (const row of params) {
      const pre = preset.params.find((x) => x.code === row.code);
      const want = pre?.scope;
      if (!want || want === row.scope) continue;
      await prisma.customParameter.update({ where: { id: row.id }, data: { scope: want } });
      moved++;
    }

    // ---- 3) 补缺失费用项 ----
    const missingItems = preset.items.filter((x) => !itemByName.has(x.name));
    if (missingItems.length) {
      const maxItemOrder = items.reduce((m, i) => Math.max(m, i.sortOrder ?? 0), 0);
      await prisma.quoteItem.createMany({
        data: missingItems.map((it, i) => ({
          companyId: mt.companyId,
          moldTypeId: mt.id,
          name: it.name,
          category: it.category,
          scope: it.scope,
          calcType: it.calcType,
          calcConfig: it.calcConfig ?? {},
          expression: it.expression ?? null,
          perUnit: it.perUnit === true,
          sortOrder: maxItemOrder + 1 + i,
        })),
      });
    }

    // ---- 4) 给已有费用项补多价来源（金额中性：参数为 0 时回落到钢材单价） ----
    let varsFixed = 0;
    for (const it of preset.items) {
      const priceVars = it.calcConfig?.priceVars;
      if (!priceVars?.length) continue;
      const row = itemByName.get(it.name);
      if (!row) continue;
      const cfg = row.calcConfig ?? {};
      if (Array.isArray(cfg.priceVars) && cfg.priceVars.length) continue; // 已升级过
      await prisma.quoteItem.update({
        where: { id: row.id },
        data: {
          calcConfig: {
            ...cfg,
            priceVars,
            priceWeights: it.calcConfig?.priceWeights ?? [],
          },
        },
      });
      varsFixed++;
    }

    totalParams += missingParams.length;
    totalMoved += moved;
    totalItems += missingItems.length;
    totalVars += varsFixed;
    console.log(
      `- ${mt.name}：新增参数 ${missingParams.length}，搬作用域 ${moved}，新增费用项 ${missingItems.length}，补 priceVars ${varsFixed}`,
    );
  }

  console.log(
    `\n完成：共新增参数 ${totalParams} 个、作用域调整 ${totalMoved} 个、新增费用项 ${totalItems} 个、补 priceVars ${totalVars} 个`,
  );
}

main()
  .catch((e) => {
    console.error('补齐失败：', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
