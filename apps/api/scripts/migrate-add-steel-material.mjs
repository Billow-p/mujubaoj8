// 回填：让「材料库」真正驱动算价（方案 A）
//
// 做两件事（幂等，可重复执行）：
//   1) size（按尺寸算 / 钢材）费用项：补 densityVar / lossVar
//      → 选了材料库钢材就按牌号的密度与损耗率走
//   2) weight（按重量算 / 注塑材料）费用项：补 lossVar
//      → 选了材料库塑料就按牌号的损耗率走
//   3) 补参数：「钢材损耗率」（common，默认 0）、「原料损耗率」（injection，默认 0.05）
//
// ⚠️ 默认值刻意与「旧固定值」保持一致，保证**没选材料的老报价算法完全不变**：
//    - 钢材损耗率 0（旧公式没有损耗项）
//    - 原料损耗率 0.05（旧 weight 项写死 loss: 0.05）
//    想给钢材统一加损耗，把报价页公共参数里的「钢材损耗率」改成 0.1 即可。
//
// ⚠️ 刻意不新增「钢材密度」参数：压铸模具的 density 是 2.7（自定义近似值），
//    新增公共参数会把它顶成 7.85，静默放大近 3 倍。靠 calcConfig 里的 density 兜底更安全。

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DENSITY_VAR = '钢材密度';
const STEEL_LOSS_VAR = '钢材损耗率';
const MATERIAL_LOSS_VAR = '原料损耗率';

/** 给某模具类型的 calcType 项补变量；返回改动条数 */
async function patchItems(moldTypeId, calcType, patch) {
  const items = await prisma.quoteItem.findMany({ where: { moldTypeId, calcType } });
  let changed = 0;
  for (const it of items) {
    const raw = it.calcConfig;
    const cfg = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    const before = JSON.stringify(cfg);
    patch(cfg);
    if (JSON.stringify(cfg) !== before) {
      await prisma.quoteItem.update({ where: { id: it.id }, data: { calcConfig: cfg } });
      changed++;
    }
  }
  return { changed, total: items.length };
}

/** 补参数（已存在则跳过）；返回 1 / 0 */
async function ensureParam(moldTypeId, companyId, { code, name, scope, defaultValue, remark }) {
  const hit = await prisma.customParameter.findFirst({
    where: { moldTypeId, name },
    select: { id: true },
  });
  if (hit) return 0;
  const max = await prisma.customParameter.aggregate({
    where: { moldTypeId },
    _max: { sortOrder: true },
  });
  await prisma.customParameter.create({
    data: {
      companyId,
      moldTypeId,
      code,
      name,
      type: 'decimal',
      unit: null,
      defaultValue,
      group: '材料',
      scope,
      sortOrder: (max._max.sortOrder ?? 0) + 1,
      enabled: true,
      remark,
    },
  });
  return 1;
}

async function main() {
  const moldTypes = await prisma.moldType.findMany({
    select: { id: true, name: true, companyId: true },
    orderBy: { createdAt: 'asc' },
  });

  let itemPatched = 0;
  let paramAdded = 0;

  for (const mt of moldTypes) {
    const size = await patchItems(mt.id, 'size', (cfg) => {
      if (!cfg.densityVar) cfg.densityVar = DENSITY_VAR;
      if (!cfg.lossVar) cfg.lossVar = STEEL_LOSS_VAR;
    });
    const weight = await patchItems(mt.id, 'weight', (cfg) => {
      if (!cfg.lossVar) cfg.lossVar = MATERIAL_LOSS_VAR;
    });

    let added = 0;
    if (size.total > 0) {
      added += await ensureParam(mt.id, mt.companyId, {
        code: 'steelLossRate',
        name: STEEL_LOSS_VAR,
        scope: 'common',
        defaultValue: '0',
        remark: '钢材损耗率：选了材料库钢材时按该牌号的损耗率；未选则用这里的值（0=不计损耗）',
      });
    }
    if (weight.total > 0) {
      added += await ensureParam(mt.id, mt.companyId, {
        code: 'materialLossRate',
        name: MATERIAL_LOSS_VAR,
        scope: 'injection',
        defaultValue: '0.05',
        remark: '原料损耗率：选了材料库材料时按该牌号的损耗率；未选则用这里的值',
      });
    }

    itemPatched += size.changed + weight.changed;
    paramAdded += added;
    console.log(
      `- ${mt.name}：size 项 ${size.changed}/${size.total}、weight 项 ${weight.changed}/${weight.total}，新增参数 ${added}`,
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
