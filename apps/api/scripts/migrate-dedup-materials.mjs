/**
 * 材料库重复 code 清理（幂等，可重复执行）
 *
 * 背景：
 *   主账号（default-company）材料库里，早期导数据跑过两遍，留下了 9 条
 *   重复记录 —— 同一 code 有两条，其中一条是导入脚本重跑产生的僵尸。
 *   这批重复的 id 都以 cmtv7nk 开头，且 MaterialPrice 引用数为 0；
 *   真正在用的那条 id 以 cmtvdz 开头，带着价格历史。
 *
 * 策略（保守，只删「确认零引用」的）：
 *   同一 companyId + code 下若有多条，保留「有 MaterialPrice 引用」的那条，
 *   其余仅在**零引用**时才删 —— 且必须确认同类里存在一条可保留项。
 *
 * 引用关系（决定清理安全性的关键）：
 *   - CustomParameter.materialCode  → 按 code 字符串绑定（不认 id），删记录不影响取价
 *   - MaterialPrice.materialId      → 按 id 外键绑定，绝不能删有价格历史的那条
 *   - MaterialOverride              → 按 (companyId, key) 绑定，**不挂 materialId**，无需处理
 *
 * 安全保护：
 *   DELETE 自带 NOT EXISTS 子查询，即使脚本逻辑被改坏，
 *   也不会删掉任何一条有价格历史的记录。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DUP_CODES = ['718H', 'ABS', 'ADC12', 'H13', 'P20', 'PC', 'PP', 'ZAMAK3'];

async function main() {
  console.log('==> 材料库重复 code 清理');

  // ---------- 1. 体检 ----------
  const byCompany = await prisma.material.groupBy({
    by: ['companyId'],
    _count: { _all: true },
  });
  console.log('清理前，各公司材料数：');
  for (const r of byCompany) {
    const uniq = await prisma.$queryRawUnsafe(
      'SELECT count(DISTINCT "code")::int AS n FROM "Material" WHERE "companyId" = $1',
      r.companyId,
    );
    console.log(`  ${r.companyId}: ${r._count._all} 条 / ${uniq[0].n} 个唯一 code`);
  }

  // ---------- 2. 逐个 code 处理 ----------
  let deleted = 0;
  let skipped = 0;
  for (const code of DUP_CODES) {
    const rows = await prisma.material.findMany({
      where: { code },
      select: { id: true, companyId: true, name: true },
      orderBy: { id: 'asc' },
    });

    // 同 code 可能属于多家公司，必须按公司分别处理，绝不跨租户合并
    const byCo = new Map();
    for (const r of rows) {
      if (!byCo.has(r.companyId)) byCo.set(r.companyId, []);
      byCo.get(r.companyId).push(r);
    }

    for (const [companyId, list] of byCo) {
      if (list.length <= 1) continue;

      // 先算出每条的价格引用数，决定谁留谁走
      const withRef = [];
      for (const r of list) {
        const priceRows = await prisma.materialPrice.count({ where: { materialId: r.id } });
        withRef.push({ ...r, priceRows });
      }
      const keepable = withRef.filter((x) => x.priceRows > 0);
      const droppable = withRef.filter((x) => x.priceRows === 0);

      if (keepable.length === 0) {
        // 整组都没价格历史 —— 保守起见不动，人工再看
        console.log(`  ⚠ ${code} [${companyId}]：${list.length} 条全部零引用，跳过待人工确认`);
        skipped += list.length;
        continue;
      }

      for (const r of droppable) {
        const n = await prisma.$executeRawUnsafe(
          `DELETE FROM "Material" m
            WHERE m.id = $1
              AND NOT EXISTS (SELECT 1 FROM "MaterialPrice" mp WHERE mp."materialId" = m.id)
              AND EXISTS (SELECT 1 FROM "Material" other
                           WHERE other."companyId" = m."companyId"
                             AND other.code = m.code
                             AND other.id <> m.id
                             AND EXISTS (SELECT 1 FROM "MaterialPrice" mp2
                                          WHERE mp2."materialId" = other.id))`,
          r.id,
        );
        if (n > 0) {
          deleted += n;
          console.log(`  删除重复 ${code} [${companyId}] id=${r.id}`);
        } else {
          skipped += 1;
          console.log(`  ⚠ 跳过 ${code} id=${r.id}（未满足删除条件）`);
        }
      }
      console.log(`  ${code} [${companyId}]：保留 ${keepable.length} 条（带价格），删除 ${droppable.length} 条`);
    }
  }

  console.log(`==> 共删除 ${deleted} 条，跳过 ${skipped} 条`);

  // ---------- 3. 复核 ----------
  const remain = await prisma.$queryRawUnsafe(
    'SELECT "companyId", code, count(*)::int AS n FROM "Material" GROUP BY 1,2 HAVING count(*) > 1 ORDER BY 2',
  );
  console.log('剩余同公司内重复 code：' + (remain.length === 0 ? '无 ✅' : JSON.stringify(remain)));

  const total = await prisma.material.count();
  console.log(`全库材料总数：${total}`);
}

main()
  .catch((e) => {
    console.error('清理失败：', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
