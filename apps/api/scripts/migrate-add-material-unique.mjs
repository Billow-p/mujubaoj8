// 给「全局材料库」补一个唯一索引，防止编码重复（幂等）
//
// 背景：Material 上的 @@unique([companyId, moldTypeId, code]) 在 moldTypeId 为 NULL 时
// **不生效** —— PostgreSQL 认为 NULL 互不相等，所以全局材料（moldTypeId = NULL）
// 可以插入两条同 code 的记录。Prisma schema 无法表达「部分唯一索引」，
// 因此这里用原生 SQL 建，并且放在 `prisma db push` **之后**执行
// （db push 可能清掉 schema 里没声明的索引，所以每次部署都要重建一次）。
//
// 有重复数据时不会强行建索引（会失败），改为打印出来让人工处理。

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const INDEX_NAME = 'Material_global_code_uniq';

async function main() {
  const dups = await prisma.$queryRaw`
    SELECT "companyId", code, count(*)::int AS n
    FROM "Material"
    WHERE "moldTypeId" IS NULL
    GROUP BY "companyId", code
    HAVING count(*) > 1
  `;

  if (dups.length > 0) {
    console.log('⚠️  全局材料库存在重复编码，已跳过建索引（请先人工合并）：');
    for (const d of dups) console.log(`   - ${d.companyId} / ${d.code} × ${d.n}`);
    return;
  }

  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX_NAME}"
     ON "Material" ("companyId", code)
     WHERE "moldTypeId" IS NULL`,
  );
  console.log(`✓ 已确保唯一索引 ${INDEX_NAME}（全局材料库 companyId + code）`);
}

main()
  .catch((e) => {
    // 建索引失败不该阻断部署
    console.error('⚠️  唯一索引创建失败（不影响功能）：', e && e.message);
  })
  .finally(() => prisma.$disconnect());
