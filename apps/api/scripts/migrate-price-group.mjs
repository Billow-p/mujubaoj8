// 「计价单价」移组（幂等，可重复执行）
//
// 背景：产品数据（模具参数 / 注塑参数）里混着「量」和「价」两类参数 ——
// 腔数、模芯长是量；钢材单价、密度、损耗率、机台时薪是价与系数。
// 用户在配置中心填产品数据时，一堆单价混在尺寸中间，容易填错也容易漏填。
//
// 改法：把所有「价 / 系数」类参数的 group 统一改成「计价单价」。
//   - 只改 group 这一个字段（分组标签），不改值、不改 scope、不改 materialCode。
//   - 所有按「参数名」引用它们的公式（如 钢材单价 * 钢材密度 * 体积）完全不受影响 ——
//     公式是按 name 解析的，与 group 无关。
//   - 前端：ConfigCenter 里这些参数从左侧产品数据挪到「要收哪些费用」板块顶部的
//     「计价单价」折叠区；ConfiguredQuote 右侧只读展示。
//
// ⚠️ 判定依据来自预置模板（MOLD_PRESETS）里参数的 group 声明 ——
//    以模板为准回写 group，模板没声明的参数（用户自建）一律不动。

import { PrismaClient } from '@prisma/client';
import { MOLD_PRESETS } from '../dist/services/moldPresets.js';

const prisma = new PrismaClient();

const PRICE_GROUP = '计价单价';

async function main() {
  const moldTypes = await prisma.moldType.findMany({
    select: { id: true, name: true, code: true },
    orderBy: { createdAt: 'asc' },
  });

  let totalChanged = 0;
  let totalSkipped = 0;

  for (const mt of moldTypes) {
    const preset = MOLD_PRESETS.find((p) => p.code === mt.code);
    if (!preset) {
      console.log(`  · ${mt.name}（${mt.code}）：用户自建类型，跳过`);
      continue;
    }

    // 模板里声明的「计价单价」参数 code 集合
    const priceCodes = new Set(
      preset.params.filter((x) => x.group === PRICE_GROUP).map((x) => x.code),
    );
    // 模板里「非计价单价」的 code 集合 —— 用于把误入的参数拉回来（例如上一版跑过又被改坏）
    const nonPriceCodes = new Set(
      preset.params.filter((x) => x.group !== PRICE_GROUP).map((x) => x.code),
    );
    // 按名字兜底：线上存在历史数据 code 为空/重复的情况，用 name 再兜一层
    const priceNames = new Set(
      preset.params.filter((x) => x.group === PRICE_GROUP).map((x) => x.name),
    );
    const presetByName = new Map(preset.params.map((x) => [x.name, x]));

    const params = await prisma.customParameter.findMany({
      where: { moldTypeId: mt.id },
      select: { id: true, code: true, name: true, group: true },
    });

    let changed = 0;
    const details = [];
    const orphans = [];

    for (const row of params) {
      let want = null;
      if (priceCodes.has(row.code) || priceNames.has(row.name)) {
        want = PRICE_GROUP;
      } else if (nonPriceCodes.has(row.code)) {
        // 模板声明它不是价类 —— 若库里被标成「计价单价」，按模板拉回
        if (row.group === PRICE_GROUP) {
          const pre = preset.params.find((x) => x.code === row.code);
          want = pre?.group ?? null;
        }
      } else if (presetByName.has(row.name)) {
        // 名字能对上模板但不是价类：若被标成「计价单价」，按模板拉回
        if (row.group === PRICE_GROUP) want = presetByName.get(row.name).group;
      } else {
        // 模板里没有这个参数 —— 用户自建，不碰；但要列出来让人看见
        orphans.push(`${row.name}（${row.group ?? '空'}）`);
        continue;
      }
      if (!want || want === row.group) continue;

      await prisma.customParameter.update({
        where: { id: row.id },
        data: { group: want },
      });
      changed++;
      details.push(`${row.name}（${row.group ?? '空'} → ${want}）`);
    }

    totalChanged += changed;
    if (changed) {
      console.log(`  ✓ ${mt.name}：「计价单价」${changed} 项`);
      for (const d of details) console.log(`      - ${d}`);
    } else {
      console.log(`  · ${mt.name}：已是最新，无需调整`);
    }
    if (orphans.length) {
      console.log(`  ⚠ ${mt.name}：${orphans.length} 个参数不在预置模板里（用户自建，未改动）`);
      for (const o of orphans.slice(0, 10)) console.log(`      ? ${o}`);
      if (orphans.length > 10) console.log(`      ? …另有 ${orphans.length - 10} 个`);
    }
    totalSkipped += params.length - changed;
  }

  // ---- 复核：打印每个模具类型的分组分布 ----
  console.log('\n分组分布复核：');
  for (const mt of moldTypes) {
    const rows = await prisma.customParameter.findMany({
      where: { moldTypeId: mt.id },
      select: { group: true },
    });
    const dist = {};
    for (const r of rows) {
      const g = r.group ?? '(空)';
      dist[g] = (dist[g] ?? 0) + 1;
    }
    const line = Object.entries(dist)
      .map(([g, n]) => `${g} ${n}`)
      .join(' / ');
    console.log(`  ${mt.name}：${line}`);
  }

  console.log(`\n完成：改分组 ${totalChanged} 项，未动 ${totalSkipped} 项`);
}

main()
  .catch((e) => {
    console.error('❌ 计价单价移组失败：', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
