// 一次性迁移：为已有的「配置中心参数」补齐作用域 scope
//
// 背景：多注塑件报价需要区分参数是「模具专属 / 注塑件专属 / 整单共享」，
//       新加的 CustomParameter.scope 列由 prisma db push 默认填 'common'。
//       但要让老客户也能用「纯注塑 20 件」「开模+注塑」这类场景，
//       需要把 单件重量 / 注塑数量 等改成 injection、模芯长/腔数 等改成 mold。
//
// 安全：只改 scope，不动数值；按参数名启发式判定，已是具体 scope 的不动；
//       纯 common 的共享参数（钢材单价、运费…）保持 common。
//
// 用法：node apps/api/scripts/migrate-add-param-scope.mjs
// 注意：本文件为纯 JS（无 TS 注解），直接用 node 运行即可。

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

/** 参数名 → 作用域（优先级从高到低匹配，命中第一个） */
const RULES = [
  // 注塑件专属
  { test: /(单件重量|单重|产品重量|件重|净重量|原料单价|材料单价|原料价格|材料价格|注塑数量|压铸数量|成型数量|订单数量|本次数量|生产数量|首单数量|成型量)/, scope: 'injection' },
  // 模具专属
  { test: /(模芯长|模芯宽|模芯高|模芯尺寸|腔数|模具重量|模具尺寸|模架|型腔|热流道点数|浇口|顶针|滑块|镶件|投影面积|平均壁厚|压铸机吨位|模具寿命|型腔数|穴数)/, scope: 'mold' },
  // 其余（钢材单价、钢材密度、运费、运输箱、损耗…）保持 common
];

function decideScope(name, current) {
  if (current && current !== 'common') return null; // 已明确，不动
  for (const r of RULES) {
    if (r.test.test(name)) return r.scope;
  }
  return null; // 不命中 → 保持 common
}

async function main() {
  const params = await prisma.customParameter.findMany();
  let mold = 0;
  let injection = 0;
  let unchanged = 0;

  for (const p of params) {
    const next = decideScope(p.name, p.scope ?? 'common');
    if (!next) {
      unchanged += 1;
      continue;
    }
    await prisma.customParameter.update({ where: { id: p.id }, data: { scope: next } });
    if (next === 'mold') mold += 1;
    else injection += 1;
  }

  console.log(`完成：标记为模具专属 ${mold} 个、注塑件专属 ${injection} 个、保持原样 ${unchanged} 个`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
