// 配置体检：扫描所有模具类型，找出「摆在报价页上、但改了不影响价格」的参数。
//
// 用途：报价页出现「填了数字价格不动」时，先用它定位是哪一类问题。
// 运行：在 apps/api 目录下  node scripts/check-config-refs.mjs [moldTypeId]
//
// 判定口径：某个参数「被引用」= 至少有一个启用的费用项在 calcConfig / 表达式中用到它。
// 注意两类需要人工判断的例外（脚本会单独标注）：
//   1) 数量类参数（注塑数量/压铸数量/成型数量/硫化数量…）：虽然费用项不引用，
//      但引擎按名字注入每件的数量，属于「间接生效」。
//   2) 表达式里的函数名（最大值/最小值…）会被当作标识符扫出来，属误报。

import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { QTY_VAR_CANDIDATES } from '@mqs/shared';

// ---- 加载 .env（与其它脚本一致，不依赖 dotenv 包）----
const envPath = path.resolve('.env');
const env = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;

const FUNC_WORDS = new Set([
  '最大值', '最小值', '绝对值', '四舍五入', '取整', '向上取整', '向下取整', '如果',
  'max', 'min', 'abs', 'round', 'floor', 'ceil', 'if',
]);

const prisma = new PrismaClient();
const onlyId = process.argv[2];

const types = await prisma.moldType.findMany({
  where: onlyId ? { id: onlyId } : {},
  orderBy: { createdAt: 'asc' },
});

let problemTotal = 0;

for (const t of types) {
  const params = await prisma.customParameter.findMany({
    where: { moldTypeId: t.id },
    orderBy: { sortOrder: 'asc' },
  });
  const items = await prisma.quoteItem.findMany({
    where: { moldTypeId: t.id },
    orderBy: { sortOrder: 'asc' },
  });

  const referenced = new Map();
  const addRef = (pn, itemName) => {
    if (!pn || FUNC_WORDS.has(pn)) return;
    if (!referenced.has(pn)) referenced.set(pn, []);
    referenced.get(pn).push(itemName);
  };

  for (const it of items) {
    if (it.enabled === false) continue;
    const c = it.calcConfig ?? {};
    if (it.calcType === 'size') {
      addRef(c.l, it.name); addRef(c.w, it.name); addRef(c.h, it.name);
      addRef(c.densityVar, it.name); addRef(c.priceVar, it.name); addRef(c.lossVar, it.name);
    } else if (it.calcType === 'weight') {
      addRef(c.wVar, it.name); addRef(c.priceVar, it.name); addRef(c.lossVar, it.name);
    } else if (it.calcType === 'qty') {
      addRef(c.src, it.name);
    } else if (it.calcType === 'formula' && it.expression) {
      for (const tk of String(it.expression).match(/[\u4e00-\u9fa5][\u4e00-\u9fa5A-Za-z0-9_]*/g) ?? []) {
        addRef(tk, it.name);
      }
    }
  }

  const dead = params.filter((p) => {
    const r = referenced.get(p.name);
    return !r || !r.length;
  });

  const qtyDead = dead.filter((p) => QTY_VAR_CANDIDATES.includes(p.name));
  const realDead = dead.filter((p) => !QTY_VAR_CANDIDATES.includes(p.name));

  const missing = [...referenced.keys()].filter((pn) => !params.some((p) => p.name === pn));

  console.log('='.repeat(72));
  console.log(`${t.name}  code=${t.code}  company=${t.companyId}`);
  console.log(`参数 ${params.length} 个 | 费用项 ${items.length} 个 | 改了不影响价格的参数 ${realDead.length} 个`);

  if (realDead.length) {
    problemTotal += realDead.length;
    console.log('\n  ✗ 空转参数（报价页上能填，但计算不用它）：');
    for (const p of realDead) {
      console.log(`      ${p.name}  [scope=${p.scope}]  code=${p.code}  unit=${p.unit || '-'}  默认=${p.defaultValue}`);
    }
  }
  if (qtyDead.length) {
    console.log('\n  ~ 数量类参数（间接生效：引擎按名字注入每件的数量，不建议删）：');
    console.log('      ' + qtyDead.map((p) => p.name).join('、'));
  }
  if (missing.length) {
    console.log('\n  ⚠ 费用项引用了、但参数表里不存在的变量（该项会算成 0 或报错）：');
    console.log('      ' + missing.join('、'));
  }
  console.log('');
}

console.log('='.repeat(72));
console.log(`合计发现 ${problemTotal} 个空转参数。`);
console.log('提示：若参数是被「材料库带入」覆盖（选了牌号就锁死），脚本无法察觉，需人工核对报价页交互。');

await prisma.$disconnect();
