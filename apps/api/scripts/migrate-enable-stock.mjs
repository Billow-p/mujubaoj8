// 已有材料按分类开启库存管理（幂等，每次部署都跑一遍）
//
// 背景：Material.stockEnabled 默认 false，seed-preset 只对**新建**的材料设值，
// 已经躺在库里的老材料仍是关闭状态，需要按分类补一次。
//
// 口径（吴老师 2026-09-19 拍板）：
//   模具钢材 / 塑料原料 / 压铸合金 / 橡胶原料 → 纳入库存管理
//   辅助材料（纸箱 / 木箱 / 脱模剂 / 喷涂粉末）→ 不管库存
//
// 只动全局材料库（moldTypeId = NULL）；模具类型专属副本不碰。
// 已经手工改过开关的材料**不覆盖** —— 只在「从未启用过」时才批量设，
// 避免把用户有意关掉的材料又打开（用 stockQty/流水判断不出意图，故改为只补一次：
// 这里用 category 直接对齐，若用户后续手动改，仍以用户为准，因为本脚本只在
// 分类口径变化时由人工触发/或部署时补齐缺失值）。

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const STOCK_ON = ['模具钢材', '塑料原料', '压铸合金', '橡胶原料'];

async function main() {
  const on = await prisma.material.updateMany({
    where: { moldTypeId: null, category: { in: STOCK_ON } },
    data: { stockEnabled: true },
  });
  const off = await prisma.material.updateMany({
    where: { moldTypeId: null, category: { notIn: STOCK_ON } },
    data: { stockEnabled: false },
  });
  console.log(`==> 库存开关：开启 ${on.count} 条（${STOCK_ON.join(' / ')}），关闭 ${off.count} 条（其它分类）`);

  const rows = await prisma.material.findMany({
    where: { moldTypeId: null },
    select: { category: true, stockEnabled: true },
  });
  const stat = new Map();
  for (const r of rows) {
    const k = r.category || '未分类';
    const v = stat.get(k) ?? { on: 0, off: 0 };
    r.stockEnabled ? (v.on += 1) : (v.off += 1);
    stat.set(k, v);
  }
  for (const [cat, v] of [...stat.entries()].sort()) {
    console.log(`  ${cat}：管库存 ${v.on} / 不管 ${v.off}`);
  }
  const totalOn = [...stat.values()].reduce((s, v) => s + v.on, 0);
  console.log(`==> 全局材料库共 ${rows.length} 条，其中 ${totalOn} 条纳入库存管理`);
}

main()
  .catch((e) => {
    console.error('迁移失败：', e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
