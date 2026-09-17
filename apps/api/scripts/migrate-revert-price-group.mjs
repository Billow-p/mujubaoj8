// 撤销「计价单价」移组（幂等，可重复执行）
//
// 背景：上一版把价/系数类参数的 group 统一改成了「计价单价」，
// 现按业务决定撤销 —— 参数回归原分组（材料 / 注塑 / 压铸 / 硫化 / 运输 / 模具），
// 产品数据里照旧能看到它们。
//
// 做法：以预置模板（MOLD_PRESETS）为准回写 group。
//   - 模板里 group 不是「计价单价」的参数，若库里是「计价单价」→ 改回模板声明的分组
//   - 模板里没有的参数（用户自建）→ 不动，只打印出来
//   - 幂等：再跑一次不会有任何改动

import { PrismaClient } from '@prisma/client';
import { MOLD_PRESETS } from '../dist/services/moldPresets.js';

const prisma = new PrismaClient();
const PRICE_GROUP = '计价单价';

async function main() {
  const moldTypes = await prisma.moldType.findMany({
    select: { id: true, name: true, code: true, companyId: true },
    orderBy: { createdAt: 'asc' },
  });

  let totalChanged = 0;

  for (const mt of moldTypes) {
    const preset = MOLD_PRESETS.find((p) => p.code === mt.code);
    if (!preset) {
      console.log(`  · ${mt.name}（${mt.code}）：不在预置模板里，跳过`);
      continue;
    }

    // 模板里「非计价单价」参数的 code → 原分组
    const byCode = new Map(
      preset.params.filter((x) => x.group !== PRICE_GROUP).map((x) => [x.code, x.group]),
    );
    const byName = new Map(
      preset.params.filter((x) => x.group !== PRICE_GROUP).map((x) => [x.name, x.group]),
    );

    const params = await prisma.customParameter.findMany({
      where: { moldTypeId: mt.id, group: PRICE_GROUP },
      select: { id: true, code: true, name: true, group: true },
    });

    let changed = 0;
    for (const row of params) {
      const want = byCode.get(row.code) ?? byName.get(row.name);
      if (!want) continue; // 模板里没有 → 用户自建，不动
      await prisma.customParameter.update({ where: { id: row.id }, data: { group: want } });
      changed++;
      console.log(`      - ${mt.name} / ${row.name}：计价单价 → ${want}`);
    }

    totalChanged += changed;
    if (!changed) console.log(`  · ${mt.name}：无「计价单价」参数，无需还原`);
  }

  // 复核：确认全库不再有「计价单价」
  const left = await prisma.customParameter.count({ where: { group: PRICE_GROUP } });
  console.log(`\n还原 ${totalChanged} 项；全库仍标记为「计价单价」的参数：${left} 个`);

  // 打印各模具类型分组分布
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
    console.log(`  ${mt.name}：${Object.entries(dist).map(([g, n]) => `${g} ${n}`).join(' / ')}`);
  }
}

main()
  .catch((e) => {
    console.error('❌ 撤销计价单价移组失败：', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
