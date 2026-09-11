// 回填：让「模具钢材」可以从材料库选（方案 A）
//
// 做两件事（幂等，可重复执行）：
//   1) 给每个模具类型的 size（按尺寸算）费用项补上 densityVar / lossVar，
//      让密度和损耗率支持「选了材料库钢材就按牌号走」。
//   2) 补一个公共参数「钢材损耗率」，默认 0。
//
// ⚠️ 关键：默认值取 0，是为了让**没有选钢材的老报价算法完全不变**。
//    想统一带损耗，把报价页公共参数里的「钢材损耗率」改成 0.1 即可。
//
// ⚠️ 刻意不新增「钢材密度」参数：压铸模具的 density 是 2.7（自定义近似值），
//    新增公共参数会把它顶成 7.85，静默放大近 3 倍。靠 calcConfig 里的 density 兜底更安全。

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DENSITY_VAR = '钢材密度';
const LOSS_VAR = '钢材损耗率';

async function main() {
  const moldTypes = await prisma.moldType.findMany({
    select: { id: true, name: true, companyId: true },
    orderBy: { createdAt: 'asc' },
  });

  let itemPatched = 0;
  let paramAdded = 0;

  for (const mt of moldTypes) {
    const sizeItems = await prisma.quoteItem.findMany({
      where: { moldTypeId: mt.id, calcType: 'size' },
    });

    if (sizeItems.length === 0) {
      console.log(`- ${mt.name}：无「按尺寸算」费用项，跳过`);
      continue;
    }

    let patched = 0;
    for (const it of sizeItems) {
      const raw = it.calcConfig;
      const cfg = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
      let changed = false;
      if (!cfg.densityVar) {
        cfg.densityVar = DENSITY_VAR;
        changed = true;
      }
      if (!cfg.lossVar) {
        cfg.lossVar = LOSS_VAR;
        changed = true;
      }
      if (changed) {
        await prisma.quoteItem.update({ where: { id: it.id }, data: { calcConfig: cfg } });
        patched++;
        itemPatched++;
      }
    }

    const hasLoss = await prisma.customParameter.findFirst({
      where: { moldTypeId: mt.id, name: LOSS_VAR },
      select: { id: true },
    });
    let added = 0;
    if (!hasLoss) {
      const max = await prisma.customParameter.aggregate({
        where: { moldTypeId: mt.id },
        _max: { sortOrder: true },
      });
      await prisma.customParameter.create({
        data: {
          companyId: mt.companyId,
          moldTypeId: mt.id,
          code: 'steelLossRate',
          name: LOSS_VAR,
          type: 'decimal',
          unit: null,
          defaultValue: '0',
          group: '材料',
          scope: 'common',
          sortOrder: (max._max.sortOrder ?? 0) + 1,
          enabled: true,
          remark: '钢材损耗率：选了材料库钢材时按该牌号的损耗率；未选则用这里的值',
        },
      });
      added = 1;
      paramAdded++;
    }

    console.log(
      `- ${mt.name}：费用项补变量 ${patched}/${sizeItems.length}，新增「${LOSS_VAR}」参数 ${added}`,
    );
  }

  console.log(`\n完成：费用项更新 ${itemPatched} 条，参数新增 ${paramAdded} 条`);
}

main()
  .catch((e) => {
    console.error('回填失败：', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
