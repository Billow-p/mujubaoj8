// 一次性迁移：让每个模具类型「有且仅有一个」数量参数
//
// 背景：
//   1) 注塑类型原本同时有「首单数量」(300000) 和「注塑数量」(5000)，语义重复；
//   2) 压铸/双色类型原本只有一个通用的「首单数量」，删掉后就没有数量参数了，
//      按件计价的费用项会直接算不出来。
//
// 目标：每个类型保留/补上一个符合自身语境的数量参数
//   注塑 → 注塑数量 / 压铸 → 压铸数量 / 双色 → 成型数量 / 其他 → 订单数量
// 计算引擎按同一份候选列表查找（见 shared 的 QTY_VAR_CANDIDATES）。
//
// 安全：任何被费用项或公式显式引用的数量参数都不会被删除，而是跳过并告警。
//
// 用法：node apps/api/scripts/migrate-merge-qty-param.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, '..');

for (const line of fs.readFileSync(path.join(apiDir, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const prisma = new PrismaClient();

/** 数量参数候选名，按优先级（与 shared 的 QTY_VAR_CANDIDATES 保持一致） */
const QTY_NAMES = ['注塑数量', '压铸数量', '成型数量', '订单数量', '本次数量', '生产数量', '首单数量'];

/** 各类模具类型默认补哪个数量参数 */
const DEFAULT_BY_TYPE = {
  injection: { code: 'injectionQty', name: '注塑数量', value: '5000' },
  diecasting: { code: 'castingQty', name: '压铸数量', value: '50000' },
  two_shot: { code: 'moldingQty', name: '成型数量', value: '120000' },
};
const FALLBACK = { code: 'orderQty', name: '订单数量', value: '5000' };

async function main() {
  const types = await prisma.moldType.findMany({ orderBy: { sortOrder: 'asc' } });
  let added = 0;
  let removed = 0;
  let kept = 0;
  let skipped = 0;

  for (const t of types) {
    const params = await prisma.customParameter.findMany({
      where: { moldTypeId: t.id },
      orderBy: { sortOrder: 'asc' },
    });
    const qtyParams = params.filter((p) => QTY_NAMES.includes(p.name));

    const items = await prisma.quoteItem.findMany({ where: { moldTypeId: t.id } });
    const isReferenced = (name) =>
      items.some(
        (it) =>
          (it.expression || '').includes(name) ||
          JSON.stringify(it.calcConfig || {}).includes(name),
      );

    // 情况一：没有数量参数 → 补一个
    if (qtyParams.length === 0) {
      const d = DEFAULT_BY_TYPE[t.code] ?? FALLBACK;
      const maxSort = params.reduce((m, p) => Math.max(m, p.sortOrder), -1);
      await prisma.customParameter.create({
        data: {
          companyId: t.companyId,
          moldTypeId: t.id,
          code: d.code,
          name: d.name,
          unit: '件',
          defaultValue: d.value,
          group: '商务',
          sortOrder: maxSort + 1,
        },
      });
      console.log(`  「${t.name}」补上数量参数「${d.name}」（原数量参数缺失，按件计价会算不出来）`);
      added += 1;
      continue;
    }

    // 情况二：多于一个 → 保留优先级最高的，删除其余
    if (qtyParams.length > 1) {
      const sorted = [...qtyParams].sort((a, b) => QTY_NAMES.indexOf(a.name) - QTY_NAMES.indexOf(b.name));
      const keep = sorted[0];
      let didRemove = false;

      for (const p of sorted.slice(1)) {
        if (isReferenced(p.name)) {
          console.log(`  ⚠️ 「${t.name}」的「${p.name}」仍被费用项引用，保留不删`);
          skipped += 1;
          continue;
        }
        await prisma.customParameter.delete({ where: { id: p.id } });
        console.log(`  「${t.name}」删除重复的数量参数「${p.name}」，保留「${keep.name}」`);
        removed += 1;
        didRemove = true;
      }
      if (!didRemove) kept += 1;
      continue;
    }

    kept += 1;
  }

  console.log(
    `\n完成：补充 ${added} 个、删除重复 ${removed} 个、保持原样 ${kept} 个、因被引用跳过 ${skipped} 个`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
