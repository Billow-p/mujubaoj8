/*
 * 三期 Excel 列映射 —— 数据端到端验证（无浏览器）。
 *
 * 覆盖路径：模板 .xlsx → 后端 importQuoteExcel（列映射）→ 前端 applyImportedParams（落状态）
 * 断言最终「报价页状态」的形状与取值，等价于用户在「智能识别 → 参数表导入」点确认后的结果。
 *
 * 运行：node verify-third-phase.mjs（仓库根目录，会先打包再跑），
 * 或先手动把两个 TS 用 esbuild 打成 CJS 放到 node_modules/.cache/mqs-verify/ 再直接 node 本文件。
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'mqs-verify');
const { importQuoteExcel } = require(path.join(CACHE, 'excelImport.cjs'));
const { applyImportedParams } = require(path.join(CACHE, 'importParams.cjs'));

const TEMPLATE_DIR = path.join(ROOT, 'apps', 'web', 'public', 'templates');
/** 随包交付、给用户下载的那份模板 */
const SHIPPED_TEMPLATE = path.join(TEMPLATE_DIR, '报价参数导入模板.xlsx');
/**
 * 本脚本自己用来跑断言的那份。
 * 故意不直接写「交付版」—— exceljs 每次生成的 xlsx 字节都不同（zip 条目带当前时间），
 * 若每次验证都覆盖，git 会一直显示模板被改。要更新交付版请显式跑：
 *   MQS_WRITE_TEMPLATE=1 node apps/api/scripts/verifyParamsE2E.cjs
 */
const TEST_TEMPLATE = path.join(ROOT, 'node_modules', '.cache', 'mqs-verify', 'verify-template.xlsx');
const TEMPLATE_PATH = TEST_TEMPLATE;

const MOLD_HEADERS = ['模具编号','模具名称','前模钢材','后模钢材','钢材编码','模芯长(mm)','模芯宽(mm)','模芯高(mm)','腔数','热流道点数','EDM工时(h)','线切割长度(mm)','抛光工时(h)','滑块斜顶数量','模具寿命(万模)','双色模系数','模具重量(kg)'];
const MOLD_ROW = ['M001','外壳模具','NAK80','S136','P20',500,400,150,2,4,96,1200,40,2,30,0,800];
const INJ_HEADERS = ['件编号','件名称','材料编码','单件重量(kg)','注塑数量','机台时薪(元/h)','成型周期(s)','原料损耗率'];
const INJ_ROW = ['P001','外壳上盖','ABS',0.18,5000,130,30,0.05];
const COMMON_HEADERS = ['运输箱长(cm)','运输箱宽(cm)','运输箱高(cm)','运费单价(元/kg)','运输区域','利润率','税率'];
const COMMON_ROW = [120,100,80,1.2,0,0.1,0.13];
const OTHER_HEADERS = ['费用名称','金额(元)','备注'];
const OTHER_ROW = ['运输附加费',500,'偏远地区加收'];

/** 模拟配置中心返回的参数定义（scope 决定骨架） */
const CFG = {
  parameters: [
    { name: 'cavityCount', scope: 'mold', defaultValue: 1 },
    { name: 'coreLengthMm', scope: 'mold', defaultValue: 0 },
    { name: 'coreWidthMm', scope: 'mold', defaultValue: 0 },
    { name: 'coreHeightMm', scope: 'mold', defaultValue: 0 },
    { name: 'frontMoldSteel', scope: 'mold', defaultValue: '' },
    { name: 'rearMoldSteel', scope: 'mold', defaultValue: '' },
    { name: 'hotRunnerPoints', scope: 'mold', defaultValue: 0 },
    { name: 'edmHours', scope: 'mold', defaultValue: 0 },
    { name: 'wireCutLength', scope: 'mold', defaultValue: 0 },
    { name: 'polishHours', scope: 'mold', defaultValue: 0 },
    { name: 'slideCount', scope: 'mold', defaultValue: 0 },
    { name: 'moldLife', scope: 'mold', defaultValue: 20 },
    { name: 'twoColorCoef', scope: 'mold', defaultValue: 0 },
    { name: 'moldWeightKg', scope: 'mold', defaultValue: 0 },
    { name: 'moldBaseAmount', scope: 'mold', defaultValue: 99999 },           // Excel 无 → 保留默认
    { name: 'disabledThing', scope: 'mold', enabled: false, defaultValue: 1 }, // 禁用 → 不进骨架
    { name: 'singleWeightKg', scope: 'injection', defaultValue: 0 },
    { name: 'machineHourlyRate', scope: 'injection', defaultValue: 80 },
    { name: 'cycleTime', scope: 'injection', defaultValue: 25 },
    { name: 'materialLossRate', scope: 'injection', defaultValue: 0.03 },
    { name: '注塑数量', scope: 'injection', defaultValue: 1000 },             // 数量项 → 跳过
    { name: 'partExtraField', scope: 'injection', defaultValue: 'keepme' },   // 保留默认
    { name: 'packLengthCm', scope: 'common', defaultValue: 0 },
    { name: 'packWidthCm', scope: 'common', defaultValue: 0 },
    { name: 'packHeightCm', scope: 'common', defaultValue: 0 },
    { name: 'freightRate', scope: 'common', defaultValue: 0 },
    { name: 'freightZone', scope: 'common', defaultValue: 0 },
    { name: 'unusedCommon', scope: 'common', defaultValue: 'keep' },
  ],
};

async function buildTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = '模具注塑报价系统';
  // 固定时间戳：让产物可重现（否则每次生成 core.xml 时间都不同，git 一直显示模板被改动）
  wb.created = new Date('2026-01-01T00:00:00Z');
  wb.modified = new Date('2026-01-01T00:00:00Z');
  const info = wb.addWorksheet('说明');
  info.columns = [{ width: 100 }];
  [
    '报价参数导入模板（三期 · Excel 列映射）',
    '',
    '用法：按下面 4 个 Sheet 填数据，上传到「智能识别 → 参数表导入」即可一键生成报价参数。',
    '· 模具清单：每行一套模具（前/后模钢材、模芯长宽高、腔数、热流道、滑块斜顶、寿命…）',
    '· 注塑件清单：每行一个注塑件（材料、单件重量、数量、机台时薪、周期、损耗率…）',
    '· 公共参数：整单一份（运输箱长/宽/高、运费单价、运输区域）',
    '· 其他费用：每行一条自由费用（名称 + 金额 + 备注）',
    '',
    '列名会自动识别（支持「模芯长 / 模芯长度 / CoreLength」等多种写法）；钢材/材料可填编码或中文名。',
    '比例类参数请填小数：5% 写 0.05（写「5%」也能识别，但写「5」会被当成 500% 并给出提示）。',
    '利润率 / 税率即使填了也以「配置中心」为准，本表不会覆盖。',
    '识别不到的列会提示你人工确认，不会悄悄丢数据。',
  ].forEach((t, i) => { const c = info.getCell(i + 1, 1); c.value = t; c.font = i === 0 ? { size: 13, bold: true } : { size: 11 }; });
  const mold = wb.addWorksheet('模具清单'); mold.addRow(MOLD_HEADERS); mold.addRow(MOLD_ROW);
  const inj = wb.addWorksheet('注塑件清单'); inj.addRow(INJ_HEADERS); inj.addRow(INJ_ROW);
  const common = wb.addWorksheet('公共参数'); common.addRow(COMMON_HEADERS); common.addRow(COMMON_ROW);
  const other = wb.addWorksheet('其他费用'); other.addRow(OTHER_HEADERS); other.addRow(OTHER_ROW);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const checks = [];
const check = (label, fn) => {
  try { fn(); checks.push(['OK', label]); }
  catch (e) { checks.push(['FAIL', `${label} → ${e.message}`]); }
};

(async () => {
  fs.mkdirSync(path.dirname(TEST_TEMPLATE), { recursive: true });
  fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
  const tplBuf = await buildTemplate();
  fs.writeFileSync(TEST_TEMPLATE, tplBuf);

  // 交付版：只在「还没有」或「显式要求更新」时才落盘（避免每次验证都动到版本库）
  const writeShipped = process.env.MQS_WRITE_TEMPLATE === '1' || !fs.existsSync(SHIPPED_TEMPLATE);
  if (writeShipped) {
    fs.writeFileSync(SHIPPED_TEMPLATE, tplBuf);
    console.log(`交付模板已写入：${SHIPPED_TEMPLATE}（${tplBuf.length} 字节）`);
  } else {
    console.log(`交付模板保持不动（要更新请加 MQS_WRITE_TEMPLATE=1）：${SHIPPED_TEMPLATE}`);
  }
  console.log(`本次断言用模板：${TEST_TEMPLATE}（${tplBuf.length} 字节）`);

  // ---- 第一段：后端列映射 ----
  const ab = tplBuf.buffer.slice(tplBuf.byteOffset, tplBuf.byteOffset + tplBuf.byteLength);
  const res = await importQuoteExcel(ab, '报价参数导入模板.xlsx');
  console.log(`\n[后端] 模具 ${res.molds.length} · 注塑件 ${res.parts.length} · 其他费用 ${res.extras.otherExtras.length} · 命中 ${res.matched.length} 列 · 未匹配 ${res.unmatched.length} · 告警 ${res.warnings.length}`);
  if (res.unmatched.length) console.log('  未匹配列：', JSON.stringify(res.unmatched));

  // ---- 第二段：前端适配（真实 utils/importParams） ----
  const r = applyImportedParams(res, CFG, '注塑数量', 1000);
  console.log(`[前端] 落状态 → 模具 ${r.counts.molds} / 注塑件 ${r.counts.parts} / 其他费用 ${r.counts.otherExtras}`);

  const M = r.molds[0] || {};
  const P = r.parts[0] || {};

  check('后端：35 列全命中、0 未匹配', () => {
    assert.strictEqual(res.matched.length, 35);
    assert.strictEqual(res.unmatched.length, 0);
    assert.strictEqual(res.warnings.length, 0);
  });
  check('模具：数量/编号/名称/材料编码/uid', () => {
    assert.strictEqual(r.molds.length, 1);
    assert.strictEqual(M.code, 'M001');
    assert.strictEqual(M.name, '外壳模具');
    assert.strictEqual(M.materialCode, 'P20');
    assert.ok(M.uid && typeof M.uid === 'string', 'uid 未生成');
    assert.strictEqual(M.image, null);
  });
  check('模具参数：Excel 值覆盖骨架默认', () => {
    assert.strictEqual(M.params.cavityCount, 2);
    assert.strictEqual(M.params.coreLengthMm, 500);
    assert.strictEqual(M.params.coreWidthMm, 400);
    assert.strictEqual(M.params.coreHeightMm, 150);
    assert.strictEqual(M.params.frontMoldSteel, 'NAK80');
    assert.strictEqual(M.params.rearMoldSteel, 'S136');
    assert.strictEqual(M.params.hotRunnerPoints, 4);
    assert.strictEqual(M.params.edmHours, 96);
    assert.strictEqual(M.params.wireCutLength, 1200);
    assert.strictEqual(M.params.polishHours, 40);
    assert.strictEqual(M.params.slideCount, 2);
    assert.strictEqual(M.params.moldLife, 30);
    assert.strictEqual(M.params.twoColorCoef, 0);
    assert.strictEqual(M.params.moldWeightKg, 800);
  });
  check('模具参数：骨架默认值与禁用项处理', () => {
    assert.strictEqual(M.params.moldBaseAmount, 99999, 'Excel 未提供的参数应保留骨架默认');
    assert.ok(!('disabledThing' in M.params), 'enabled:false 的参数不应进骨架');
  });
  check('注塑件：编号/名称/材料/qty', () => {
    assert.strictEqual(r.parts.length, 1);
    assert.strictEqual(P.code, 'P001');
    assert.strictEqual(P.name, '外壳上盖');
    assert.strictEqual(P.materialCode, 'ABS');
    assert.strictEqual(P.qty, 5000);
  });
  check('注塑件参数：值覆盖 + 数量项跳过 + 默认保留', () => {
    assert.strictEqual(P.params.singleWeightKg, 0.18);
    assert.strictEqual(P.params.machineHourlyRate, 130);
    assert.strictEqual(P.params.cycleTime, 30);
    assert.strictEqual(P.params.materialLossRate, 0.05);
    assert.ok(!('注塑数量' in P.params), '数量项不应作为参数重复出现');
    assert.strictEqual(P.params.partExtraField, 'keepme', 'Excel 未提供的参数应保留骨架默认');
  });
  check('公共参数：运输箱/运费映射 + 默认保留', () => {
    assert.strictEqual(r.commonParams.packLengthCm, 120);
    assert.strictEqual(r.commonParams.packWidthCm, 100);
    assert.strictEqual(r.commonParams.packHeightCm, 80);
    assert.strictEqual(r.commonParams.freightRate, 1.2);
    assert.strictEqual(r.commonParams.freightZone, 0);
    assert.strictEqual(r.commonParams.unusedCommon, 'keep');
  });
  check('其他费用：整条映射为 ExtraItem', () => {
    assert.strictEqual(r.otherExtras.length, 1);
    assert.strictEqual(r.otherExtras[0].id, 'ext_1');
    assert.strictEqual(r.otherExtras[0].name, '运输附加费');
    assert.strictEqual(r.otherExtras[0].amount, 500);
    assert.strictEqual(r.otherExtras[0].note, '偏远地区加收');
  });

  console.log('\n断言明细：');
  for (const [st, label] of checks) console.log(`  ${st === 'OK' ? '✓' : '✗'} ${label}`);
  const failed = checks.filter((c) => c[0] === 'FAIL');
  if (failed.length) { console.error(`\n❌ ${failed.length} 项失败`); process.exit(1); }
  console.log(`\n✅ 数据端到端通过（${checks.length}/${checks.length}）：模板 → 后端列映射 → 前端落状态`);
})().catch((e) => { console.error('\n❌ 运行异常：', e); process.exit(1); });
