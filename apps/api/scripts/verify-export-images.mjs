/*
 * 报价单导出「件图」端到端验证（无浏览器、无数据库）。
 *
 * 背景：用户报「我上传了图片，导出的确没有图片」。需要把导出链路的
 * 「件图 → exceljs media → xlsx 内嵌 png」这一段单独卡死，避免再回归。
 *
 * 覆盖：
 *   1) 3 种快照结构（project 多件 / 配置驱动单实例 / 老 11 项）都能把图写出来；
 *   2) WEBP / BMP 这类 exceljs 不认的格式 → 不再静默跳过，给出中文原因；
 *   3) 图片文件在磁盘上但扩展名不在老白名单内（中文原名）→ 仍能导出；
 *   4) 磁盘上文件不存在 → 给出「请重新上传」提示，而不是无声无息。
 *
 * 运行：node apps/api/scripts/verify-export-images.mjs
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'mqs-verify');

const ExcelJS = require('exceljs');

// excel.ts / quoteModel.ts 是 ESM+TS，走 esbuild 产物
const { buildQuoteExcel } = require(path.join(CACHE, 'excel.cjs'));
const { toExcelModel } = require(path.join(CACHE, 'quoteModel.cjs'));

const checks = [];
const check = (label, fn) => {
  try {
    fn();
    checks.push(['OK', label]);
  } catch (e) {
    checks.push(['FAIL', `${label} → ${e.message}`]);
  }
};

// ---------------------------------------------------------------- 造图
/** 1x1 红点 PNG（67 字节，合法 PNG，exceljs 认） */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

// 件图必须落在 uploadRoot() 真正指向的目录里。
// uploadRoot() 依赖 process.cwd()，所以本脚本要从 apps/api 目录启动
// （verify-third-phase.mjs 已经这样做了）。这里显式校验，跑错目录直接报清楚。
const { uploadRoot } = require(path.join(CACHE, 'uploadRoot.cjs'));
const UPLOAD_DIR = uploadRoot();
if (path.basename(UPLOAD_DIR) !== 'uploads' || path.basename(path.dirname(UPLOAD_DIR)) !== 'api') {
  console.error(
    `\n❌ 必须在 apps/api 目录下运行本脚本（当前 uploadRoot=${UPLOAD_DIR}）。\n` +
      `   正确做法：cd apps/api && node ../scripts/... 或由 verify-third-phase.mjs 调用。`,
  );
  process.exit(1);
}
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const created = [];
function place(name, buf) {
  const p = path.join(UPLOAD_DIR, name);
  fs.writeFileSync(p, buf);
  created.push(p);
  return `/uploads/${name}`;
}

// 干净收尾
process.on('exit', () => {
  for (const p of created) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
});

// ---------------------------------------------------------------- 断言工具
async function mediaCount(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  return wb.model.media?.length ?? 0;
}

async function sheetNames(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  return wb.worksheets.map((w) => w.name);
}

/**
 * 从 xlsx 里解出 `xl/media/<file>` 条目（绕过 exceljs，直接看 zip 内容）。
 *
 * zip 里每个条目都以 local file header（PK\x03\x04）开头，紧跟文件名。
 * 注意要跳过**目录条目**（名字以 / 结尾，exceljs 会写一条 `xl/media/`），
 * 否则「图片张数」会永远多算 1 张。
 */
async function mediaEntries(buffer) {
  const buf = buffer;
  const names = [];
  const sig = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  let i = 0;
  while ((i = buf.indexOf(sig, i)) !== -1) {
    const nameLen = buf.readUInt16LE(i + 26);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
    if (name.startsWith('xl/media/') && !name.endsWith('/')) names.push(name);
    i += 4;
  }
  return names;
}

// ---------------------------------------------------------------- 数据
const PNG_URL = place('a'.repeat(20) + '.png', PNG_1PX);
const CJK_PNG_URL = place('微信图片_20260917.png', PNG_1PX); // 中文原名，老白名单会拒
// 真 WEBP：RIFF....WEBP。exceljs 只认 png/jpeg/gif，这张必须被挡在 Excel 之外
const WEBP_URL = place(
  'b'.repeat(20) + '.webp',
  Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0x00, 0x00, 0x00]), Buffer.from('WEBPVP8 '), Buffer.alloc(32)]),
);
const GONE_URL = '/uploads/' + 'c'.repeat(20) + '.png'; // 磁盘上不存在

const baseQuote = {
  quoteNo: 'BJ-TEST-0001',
  createdAt: new Date('2026-09-17T00:00:00Z'),
  expiresAt: null,
  customer: { name: '测试客户', contactName: '张三', phone: '13800000000', email: null, address: null },
  createdBy: { name: '吴老师' },
};

const baseSummary = {
  mold: 1000,
  injection: 500,
  profitRate: 0.1,
  profit: 150,
  taxRate: 0.13,
  tax: 214.5,
  total: 1864.5,
};

const baseTerms = [{ enabled: true, text: '报价有效期 30 天' }];
const baseLines = [{ scope: 'mold', name: '模架费', readable: '1 × 1000', value: 1000, unitPrice: 1000, qty: 1 }];

function projectVersion(params) {
  return {
    paramsJson: { kind: 'project', productName: '测试产品', molds: params.molds, parts: params.parts },
    calcResultJson: {
      kind: 'project',
      moldResults: [{ name: '模具 1', subtotal: 1000, lines: [{ name: '模架费', value: 1000 }] }],
      partResults: [{ name: '注塑件 1', qty: 5000, total: 500, lines: [{ name: '材料费', value: 500 }] }],
      moldSubtotal: 1000,
      injectionSubtotal: 500,
      total: 1864.5,
      profitRate: 0.1,
      profit: 150,
      taxRate: 0.13,
      tax: 214.5,
    },
    businessTermsJson: baseTerms,
  };
}

(async () => {
  console.log('报价单导出「件图」端到端验证');
  console.log('='.repeat(64));

  // ---------------- 1) project 结构：模具 + 注塑件都挂图 ----------------
  {
    const v = projectVersion({
      molds: [{ name: '模具 1', params: { 模芯长: 500, 模芯宽: 400, 模芯高: 150, 腔数: 2 }, image: { url: PNG_URL } }],
      parts: [{ name: '注塑件 1', qty: 5000, params: { 单件重量: 0.18, 原料单价: 12 }, image: { url: PNG_URL } }],
    });
    const model = toExcelModel(baseQuote, v);
    const { buffer, imageWarnings } = await buildQuoteExcel(model);
    const media = await mediaEntries(buffer);

    check('project：模具件图进了 Excel（xl/media/image1.png）', () => {
      if (!media.includes('xl/media/image1.png')) throw new Error(`media=${media.join(',') || '空'}`);
    });
    check('project：注塑件件图进了 Excel（共 2 张 media）', () => {
      if (media.length !== 2) throw new Error(`期望 2 张，实际 ${media.length}：${media.join(',')}`);
    });
    check('project：无件图告警', () => {
      if (imageWarnings.length) throw new Error(imageWarnings.join('；'));
    });
    check('project：件图行文字含「模芯 500×400×150 · 2 穴」', async () => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
      const ws = wb.getWorksheet('报价单');
      let found = '';
      ws.eachRow((row) => {
        const t = String(row.getCell(2).value ?? '');
        if (t.includes('模芯 500×400×150') && t.includes('2 穴')) found = t;
      });
      if (!found) throw new Error('没找到件图说明行');
    });
  }

  // ---------------- 2) 兼容：图挂在 calcResults 那一层（老数据） ----------------
  {
    const v = projectVersion({
      molds: [{ name: '模具 1', params: { 腔数: 1 } }], // 入参没图
      parts: [{ name: '注塑件 1', qty: 100, params: {} }],
    });
    // 图被挪进结果层
    v.calcResultJson.moldResults[0].image = { url: PNG_URL };
    v.calcResultJson.partResults[0].image = { url: PNG_URL };
    const model = toExcelModel(baseQuote, v);
    const { buffer } = await buildQuoteExcel(model);
    const media = await mediaEntries(buffer);
    check('兼容：图挂 result 层也能导出（2 张 media）', () => {
      if (media.length !== 2) throw new Error(`实际 ${media.length} 张`);
    });
  }

  // ---------------- 3) 配置驱动单实例：整单件图 ----------------
  {
    const v = {
      paramsJson: { productName: '单件产品', values: { singleWeightKg: 0.2 }, parameters: [], image: { url: PNG_URL } },
      calcResultJson: {
        lines: [...baseLines, { scope: 'injection', name: '材料费', value: 500, unitPrice: 0.1, qty: 5000 }],
        mold: 1000,
        injection: 500,
        total: 1864.5,
        injectionQty: 5000,
        unitCost: 0.1,
      },
      businessTermsJson: baseTerms,
    };
    const model = toExcelModel(baseQuote, v);
    const { buffer } = await buildQuoteExcel(model);
    const media = await mediaEntries(buffer);
    check('配置驱动单实例：整单件图能导出（1 张 media）', () => {
      if (media.length !== 1) throw new Error(`实际 ${media.length} 张`);
    });
  }

  // ---------------- 4) 老 11 项结构：整单件图 ----------------
  {
    const v = {
      paramsJson: { productName: '老结构产品', image: { url: PNG_URL }, firstOrderQty: 1000 },
      calcResultJson: {
        moldFeeItems: { designFee: { value: 2000, formula: '固定' } },
        injectionItems: { material: { value: 3, formula: '料价×重量' } },
        summary: { moldIncVat: 2000, injectionIncVat: 3000, grandTotalIncVat: 5000 },
      },
      businessTermsJson: baseTerms,
    };
    const model = toExcelModel(baseQuote, v);
    const { buffer } = await buildQuoteExcel(model);
    const media = await mediaEntries(buffer);
    check('老 11 项结构：整单件图能导出（1 张 media）', () => {
      if (media.length !== 1) throw new Error(`实际 ${media.length} 张`);
    });
  }

  // ---------------- 5) 中文原文件名（老白名单会拒，现在必须放行） ----------------
  {
    const v = projectVersion({
      molds: [{ name: '模具 1', params: {}, image: { url: CJK_PNG_URL } }],
      parts: [],
    });
    const model = toExcelModel(baseQuote, v);
    const { buffer, imageWarnings } = await buildQuoteExcel(model);
    const media = await mediaEntries(buffer);
    check('中文原文件名：不再被扩展名白名单误杀', () => {
      if (media.length !== 1) throw new Error(`实际 ${media.length} 张，告警：${imageWarnings.join('；')}`);
    });
  }

  // ---------------- 6) WEBP：不静默跳过，给出中文原因 ----------------
  {
    const v = projectVersion({
      molds: [{ name: '模具 1', params: {}, image: { url: WEBP_URL } }],
      parts: [],
    });
    const model = toExcelModel(baseQuote, v);
    const { buffer, imageWarnings } = await buildQuoteExcel(model);
    const media = await mediaEntries(buffer);
    check('WEBP：不进 Excel（exceljs 认不了）', () => {
      if (media.length !== 0) throw new Error(`不该出现 media，实际 ${media.length} 张`);
    });
    check('WEBP：给出中文告警而不是静默吞掉', () => {
      if (!imageWarnings.length) throw new Error('没有任何告警 —— 又回到静默失败了');
      if (!/WEBP/.test(imageWarnings.join(''))) throw new Error(`告警没说明原因：${imageWarnings.join('；')}`);
    });
    check('WEBP：单据本身照常导出（不会因为图坏了就导不出来）', () => {
      if (!buffer.length) throw new Error('buffer 为空');
    });
  }

  // ---------------- 7) 磁盘文件丢了：给出「重新上传」提示 ----------------
  {
    const v = projectVersion({
      molds: [{ name: '模具 1', params: {}, image: { url: GONE_URL } }],
      parts: [],
    });
    const model = toExcelModel(baseQuote, v);
    const { imageWarnings } = await buildQuoteExcel(model);
    check('文件丢失：提示「请重新上传」', () => {
      if (!imageWarnings.some((w) => /重新上传/.test(w))) {
        throw new Error(`告警不对：${imageWarnings.join('；') || '（空）'}`);
      }
    });
  }

  // ---------------- 8) 基础结构回归 ----------------
  {
    const v = projectVersion({ molds: [{ name: '模具 1', params: {}, image: null }], parts: [] });
    const model = toExcelModel(baseQuote, v);
    const { buffer } = await buildQuoteExcel(model);
    const names = await sheetNames(buffer);
    check('两个 Sheet 都在（报价单 / 计算明细）', () => {
      if (names.join(',') !== '报价单,计算明细') throw new Error(`实际：${names.join(',')}`);
    });
    check('报价单为有效 xlsx（PK 魔数）', () => {
      if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error('不是 zip/xlsx');
    });
    check('含税总价换算的中文大写出现', async () => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
      const ws = wb.getWorksheet('报价单');
      let hit = '';
      ws.eachRow((row) => {
        const t = String(row.getCell(1).value ?? '');
        if (t.startsWith('大写金额：')) hit = t;
      });
      if (!hit) throw new Error('没找到大写金额行');
    });
  }

  // ---------------- 汇总 ----------------
  console.log('\n断言明细：');
  for (const [st, label] of checks) console.log(`  ${st === 'OK' ? '✓' : '✗'} ${label}`);
  const failed = checks.filter((c) => c[0] === 'FAIL');
  if (failed.length) {
    console.error(`\n❌ ${failed.length} 项失败`);
    process.exit(1);
  }
  console.log(`\n✅ 导出件图验证通过（${checks.length}/${checks.length}）`);
})().catch((e) => {
  console.error('\n❌ 运行异常：', e);
  process.exit(1);
});
