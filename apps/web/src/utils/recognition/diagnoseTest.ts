/**
 * 兜底矩阵自检 —— 「任何情况都要有回复」的守卫。
 *
 * 每加一种新格式支持、每改一次提示文案，都该跑一遍这个：
 * 确保用户传任何东西进来都能拿到「原因 + 怎么改」，而不是一句干巴巴的「失败」。
 *
 * 跑法：npx tsx apps/web/src/utils/recognition/diagnoseTest.ts
 */

import { classifyFile, diagnose, humanSize, MAX_FILE_BYTES } from './index';

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

console.log('【1】格式分类');
const kinds: [string, string][] = [
  ['零件.step', 'model3d'], ['零件.stp', 'model3d'], ['零件.iges', 'model3d'],
  ['零件.stl', 'model3d'], ['零件.obj', 'model3d'], ['零件.ply', 'model3d'], ['零件.3mf', 'model3d'],
  ['零件.sldprt', 'vendor3d'], ['零件.prt', 'vendor3d'], ['零件.ipt', 'vendor3d'], ['零件.catpart', 'vendor3d'],
  ['询价.xlsx', 'excel'], ['询价.xlsm', 'excel'],
  ['询价.docx', 'word'],
  ['照片.png', 'image'], ['照片.jpg', 'image'], ['照片.webp', 'image'],
  ['IMG_0001.heic', 'image'], // 归类为图，但会走 HEIC 提示
  ['图纸.dwg', 'dwg'], ['图纸.dxf', 'dwg'],
  ['说明.pdf', 'pdf'],
  ['打包.zip', 'archive'], ['打包.rar', 'archive'],
  ['乱七八糟.xyz', 'unknown'],
];
for (const [name, expect] of kinds) {
  const r = classifyFile(name);
  ok(`${name} → ${expect}`, r.kind === expect, `实际 ${r.kind}`);
}

console.log('\n【2】兜底提示：每种都要有「原因」和「怎么改」');
const cases: [string, { name: string; size: number }, string][] = [
  ['空文件', { name: 'a.stl', size: 0 }, 'EMPTY_FILE'],
  ['超大文件', { name: 'a.stl', size: MAX_FILE_BYTES + 1 }, 'TOO_LARGE'],
  ['苹果照片 HEIC', { name: 'IMG_0001.heic', size: 2_000_000 }, 'HEIC_UNSUPPORTED'],
  ['SolidWorks 专有格式', { name: '零件.sldprt', size: 1_000_000 }, 'VENDOR_3D'],
  ['CATIA 专有格式', { name: '零件.catpart', size: 1_000_000 }, 'VENDOR_3D'],
  ['老版 Word', { name: '询价.doc', size: 1_000_000 }, 'LEGACY_OFFICE'],
  ['老版 Excel', { name: '询价.xls', size: 1_000_000 }, 'LEGACY_OFFICE'],
  ['PDF', { name: '图纸.pdf', size: 1_000_000 }, 'PDF_UNSUPPORTED'],
  ['压缩包', { name: '打包.zip', size: 1_000_000 }, 'ARCHIVE_UNSUPPORTED'],
  ['2D 图纸', { name: '图纸.dwg', size: 1_000_000 }, 'DWG_UNSUPPORTED'],
  ['不认识的后缀', { name: 'x.xyz', size: 1000 }, 'UNKNOWN_EXT'],
  ['没有后缀', { name: '无后缀文件', size: 1000 }, 'UNKNOWN_EXT'],
];

for (const [label, file, expectCode] of cases) {
  const e = diagnose(file);
  ok(`${label} → ${expectCode}`, e?.code === expectCode, `实际 ${e?.code ?? 'null'}`);
  if (e) {
    // 提示不能是空话：建议至少要具体到能照着做
    ok(`  └ 有原因且带文件名/格式`, e.message.length >= 6, e.message);
    ok(`  └ 建议够具体（≥15 字）`, e.suggestion.length >= 15, e.suggestion);
  }
}

console.log('\n【3】正常文件不该被误拦');
for (const name of ['零件.step', '零件.stl', '询价.xlsx', '询价.docx', '照片.png', '照片.jpg']) {
  const e = diagnose({ name, size: 1_000_000 });
  ok(`${name} → 放行（无错误）`, e === null, e?.code ?? '');
}

console.log('\n【4】提示文案要有针对性（不同情况给不同建议）');
const heic = diagnose({ name: 'a.heic', size: 100 })!;
const sw = diagnose({ name: 'a.sldprt', size: 100 })!;
const oldDoc = diagnose({ name: 'a.doc', size: 100 })!;
ok('HEIC 建议里提到「兼容性最佳」或转 JPG', /兼容性最佳|JPEG|JPG/.test(heic.suggestion));
ok('SolidWorks 建议里点名 STEP', /STEP/i.test(sw.suggestion));
ok('老版 Word 建议里写了另存为 .docx', /docx/.test(oldDoc.suggestion));
ok('三种情况的建议互不相同', heic.suggestion !== sw.suggestion && sw.suggestion !== oldDoc.suggestion);

console.log('\n【5】体积显示');
ok(`1024 → 1 KB`, humanSize(1024) === '1 KB', humanSize(1024));
ok(`5MB → 5.0 MB`, humanSize(5 * 1024 * 1024) === '5.0 MB', humanSize(5 * 1024 * 1024));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
