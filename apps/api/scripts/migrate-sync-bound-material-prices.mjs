/**
 * 一次性的历史脏数据修复：绑定材料的价格与材料库现价不一致时对齐（幂等）
 *
 * 背景：
 *   换绑材料的下拉以前只改 materialCode、不改 defaultValue，于是留下
 *   「绑 A360（现价 23）却存 25」这类自相矛盾的数据。前端已修，但库里
 *   存量脏数据要单独刷一遍，否则报价表仍按错误基数算钱。
 *
 * 策略：
 *   只处理「有 materialCode 且能在材料库找到现价」的参数，
 *   把 defaultValue 对齐为材料库现价。找不到现价的（材料被删/未设价）
 *   不动 —— 交给界面显示「待同步（材料库未设价）」。
 *
 * 查找顺序（与 syncPricesFromLibrary 保持一致）：
 *   先全局库（moldTypeId IS NULL），再回退到该模具类型专属记录。
 *   历史遗留里还有 2 条 moldTypeId 非空的材料（TPE-S / ABS-H），
 *   只查全局库会误判成「找不到材料」而跳过。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** 按 code 找材料现价：全局库优先，回退到该模具类型专属记录 */
async function findLibraryPrice(companyId, moldTypeId, code) {
  const global = await prisma.material.findFirst({
    where: { companyId, moldTypeId: null, code },
    select: { currentPrice: true, name: true },
  });
  if (global) return global;
  return prisma.material.findFirst({
    where: { companyId, moldTypeId, code },
    select: { currentPrice: true, name: true },
  });
}

async function main() {
  console.log('==> 修复绑定材料的价格与材料库现价不一致');

  const params = await prisma.customParameter.findMany({
    where: { materialCode: { not: null } },
    select: {
      id: true,
      name: true,
      code: true,
      materialCode: true,
      defaultValue: true,
      companyId: true,
      moldTypeId: true,
    },
  });
  console.log(`绑定类参数共 ${params.length} 条`);

  let fixed = 0;
  let missing = 0;
  for (const p of params) {
    const mc = p.materialCode?.trim();
    if (!mc) continue;

    const mat = await findLibraryPrice(p.companyId, p.moldTypeId, mc);
    if (!mat) {
      console.log(`  跳过 ${p.name}（materialCode=${mc}）：材料库找不到该材料`);
      missing += 1;
      continue;
    }

    const want = String(mat.currentPrice);
    if (p.defaultValue === want) continue;

    await prisma.customParameter.update({
      where: { id: p.id },
      data: { defaultValue: want },
    });
    console.log(
      `  修正 ${p.name}（绑 ${mc} → ${mat.name}）：${p.defaultValue ?? '(空)'} → ${want}`,
    );
    fixed += 1;
  }

  console.log(`==> 修正 ${fixed} 条，跳过（材料库缺价）${missing} 条`);

  // 复核：还有多少条绑定参数价格与库价不符
  const after = await prisma.customParameter.findMany({
    where: { materialCode: { not: null } },
    select: {
      materialCode: true,
      defaultValue: true,
      companyId: true,
      moldTypeId: true,
      name: true,
    },
  });
  let mismatch = 0;
  for (const p of after) {
    const mc = p.materialCode?.trim();
    if (!mc) continue;
    const mat = await findLibraryPrice(p.companyId, p.moldTypeId, mc);
    if (mat && p.defaultValue !== String(mat.currentPrice)) mismatch += 1;
  }
  console.log(`复核：绑定参数中价格仍与材料库不符的 = ${mismatch} 条`);
}

main()
  .catch((e) => {
    console.error('修复失败：', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
