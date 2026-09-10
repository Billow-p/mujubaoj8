// 配置驱动报价单 + Excel 导出 端到端测试
// 运行：node apps/api/scripts/e2e-quote-excel.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, '..');

const fileEnv = {};
for (const line of fs.readFileSync(path.join(apiDir, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) fileEnv[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
Object.assign(process.env, fileEnv);
const BASE = `http://127.0.0.1:${Number(fileEnv.PORT || 4799)}`;

let pass = 0, fail = 0;
const failures = [];
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  \u2713 ${name}${extra ? ` — ${extra}` : ''}`); }
  else { fail++; failures.push(name); console.log(`  \u2717 ${name}${extra ? ` — ${extra}` : ''}`); }
};

async function req(method, p, body, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  // 只有真的有 body 时才声明 JSON —— 否则 Fastify 会以
  // "Body cannot be empty when content-type is set to 'application/json'" 拒绝
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const resp = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await resp.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* keep */ }
  return { status: resp.status, data };
}

async function seed() {
  const prisma = new PrismaClient();
  await prisma.$connect();
  // 按外键依赖顺序清理（所有引用 Company 的表都必须先清）
  await prisma.quoteAdjustment.deleteMany({});
  await prisma.quoteVersion.deleteMany({});
  await prisma.quoteLog.deleteMany({});
  await prisma.quoteEmailLog.deleteMany({});
  await prisma.quoteShare.deleteMany({});
  await prisma.quote.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.quoteItem.deleteMany({});
  await prisma.businessTerm.deleteMany({});
  await prisma.materialPrice.deleteMany({});
  await prisma.material.deleteMany({});
  await prisma.customParameter.deleteMany({});
  await prisma.moldType.deleteMany({});
  await prisma.customFormula.deleteMany({});
  await prisma.quoteTemplate.deleteMany({});
  await prisma.materialOverride.deleteMany({});
  await prisma.steelOverride.deleteMany({});
  await prisma.complexityOverride.deleteMany({});
  await prisma.businessTermOverride.deleteMany({});
  await prisma.emailVerification.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.company.deleteMany({});

  const c = await prisma.company.create({ data: { name: '星辉模具制造有限公司' } });
  await prisma.user.create({
    data: { companyId: c.id, email: 'q1@mqs.local', passwordHash: bcrypt.hashSync('password123', 10), name: '张报价', role: 'admin', emailVerified: true },
  });
  await prisma.$disconnect();
}

async function waitApi(ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return true; } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  console.log('\n===== 配置驱动报价单 + Excel 导出 测试 =====');
  await seed();
  const api = spawn(process.execPath, ['dist/index.js'], {
    cwd: apiDir, env: { ...process.env, LOG_LEVEL: 'warn' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stderr.on('data', (d) => process.stderr.write(`  [api:err] ${d}`));
  const up = await waitApi();
  check('API 启动', up);
  if (!up) { api.kill(); process.exit(1); }

  try {
    const login = await req('POST', '/api/auth/login', { email: 'q1@mqs.local', password: 'password123' });
    const token = login.data?.token;
    check('登录成功', !!token);

    // ---------- 准备配置 ----------
    console.log('\n[1] 准备配置');
    await req('POST', '/api/mold-types/init-preset', {}, token);
    const types = await req('GET', '/api/mold-types', undefined, token);
    const inj = types.data.find((t) => t.code === 'injection');
    check('注塑类型就绪', !!inj, inj?.name);

    // 加一个手填项，验证手动金额
    const cfg = await req('GET', `/api/config/${inj.id}`, undefined, token);
    await req('PUT', `/api/config/${inj.id}`, {
      items: [
        ...cfg.data.items.map((it) => ({ id: it.id, name: it.name, category: it.category, scope: it.scope, calcType: it.calcType, calcConfig: it.calcConfig, expression: it.expression, perUnit: it.perUnit, enabled: it.enabled })),
        { name: '差旅费', category: '自定义', scope: 'mold', calcType: 'manual', enabled: true },
      ],
    }, token);
    const cfg2 = await req('GET', `/api/config/${inj.id}`, undefined, token);
    check('手填项已加入', cfg2.data.items.some((x) => x.name === '差旅费'));
    check(
      '按件计价标记在保存后保留',
      cfg2.data.items.filter((x) => x.scope === 'injection').every((x) => x.perUnit === true),
    );

    // ---------- 创建报价单 ----------
    console.log('\n[2] 按配置创建报价单');
    const created = await req('POST', '/api/quotes/configured', {
      moldTypeId: inj.id,
      customerName: '顺德电器有限公司',
      productName: '洗衣机控制面板',
      values: {
        腔数: 2, 单件重量: 0.18, 模芯长: 500, 模芯宽: 400, 模芯高: 150,
        钢材单价: 25, 原料单价: 12, 注塑数量: 5000, 首单数量: 300000,
      },
      manualAmounts: { 差旅费: 3500 },
    }, token);
    check('报价单创建成功', created.status === 200 && !!created.data.id, created.data?.quoteNo);
    const qid = created.data?.id;

    const detail = await req('GET', `/api/quotes/${qid}`, undefined, token);
    const ver = detail.data?.versions?.[0];
    const calc = ver?.calcResultJson;
    check('计算结果已存储', !!calc && Array.isArray(calc.lines));
    const lineOf = (n) => calc.lines.find((l) => l.name === n);
    check('模芯钢材费 = 5887.5', lineOf('模芯钢材费')?.value === 5887.5, String(lineOf('模芯钢材费')?.value));
    check('CNC 加工费 = 38400', lineOf('CNC 加工费')?.value === 38400);
    check('试模费 = 5000', lineOf('试模费')?.value === 5000);
    // 运输费 = max(实重 800, 体积重 120×100×80÷6000=160) × 单价 1.2 × 省外 1
    check('运输费 = 960（省外）', lineOf('运输费')?.value === 960, String(lineOf('运输费')?.value));
    check('手填差旅费 = 3500', lineOf('差旅费')?.value === 3500, String(lineOf('差旅费')?.value));
    // 用户要求：管理费不再预置，内部也不参与计算
    check('预置里没有管理费', !lineOf('管理费'));
    const sub = 5887.5 + 38400 + 6000 + 5000 + 960 + 3500;
    check('模具合计 = 各项直接费用之和', calc.mold === sub, `${calc.mold} vs ${sub}`);
    check('含税总价 > 0', calc.total > 0, String(calc.total));
    check('报价单已关联模具类型', detail.data.moldTypeId === inj.id);
    check('参数值已冻结到版本', ver.paramsJson?.values?.['腔数'] === 2);

    // ---------- 注塑费用：按件计价 ----------
    console.log('\n[2.1] 注塑费用：单件成本 × 注塑数量');
    const mat = lineOf('产品材料费');
    const proc = lineOf('注塑加工费');
    const pack = lineOf('包装费');
    check('产品材料费单件成本 2.27 元', mat?.unitPrice === 2.27, String(mat?.unitPrice));
    check('产品材料费金额 2.268 × 5000 = 11340', mat?.value === 11340, String(mat?.value));
    check('注塑加工费 0.3 元/件 × 5000 = 1500', proc?.value === 1500 && proc?.unitPrice === 0.3, String(proc?.value));
    check('包装费 0.05 元/件 × 5000 = 250', pack?.value === 250, String(pack?.value));
    check('按件计价标记已存储', mat?.perUnit === true);
    check('数量回填 5000', mat?.qty === 5000, String(mat?.qty));
    check('注塑单件成本合计 2.62 元', calc.unitCost === 2.62, String(calc.unitCost));
    check('注塑数量 5000', calc.injectionQty === 5000, String(calc.injectionQty));
    check('注塑费用合计 13090', calc.injection === 13090, String(calc.injection));

    const beforeProfit = calc.mold + calc.injection;
    const expProfit = Math.round(beforeProfit * 0.1);
    const expTotal = beforeProfit + expProfit + Math.round((beforeProfit + expProfit) * 0.13);
    check('含税总价 = 模具 + 注塑 + 利润 + 税', Math.abs(calc.total - expTotal) < 0.01, `${calc.total} vs ${expTotal}`);

    // ---------- Excel 导出 ----------
    console.log('\n[3] Excel 导出');
    const resp = await fetch(`${BASE}/api/quotes/${qid}/export-excel`, { headers: { Authorization: `Bearer ${token}` } });
    const buf = Buffer.from(await resp.arrayBuffer());
    check('导出成功', resp.status === 200 && buf.length > 5000, `${buf.length} 字节`);
    check('文件头是 xlsx', buf.slice(0, 2).toString() === 'PK');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);

    // sheet 结构
    check('含「报价单」sheet', !!wb.getWorksheet('报价单'));
    check('含「计算明细」sheet', !!wb.getWorksheet('计算明细'));
    check('共 2 个 sheet', wb.worksheets.length === 2, `${wb.worksheets.length}`);

    const ws = wb.getWorksheet('报价单');

    // 抬头
    const a1 = ws.getCell('A1');
    check('抬头显示公司名', a1.value === '星辉模具制造有限公司', String(a1.value));
    check('抬头有底色', !!a1.fill && a1.fill.fgColor?.argb === 'FF1E40AF');
    check('抬头字色为白', a1.font?.color?.argb === 'FFFFFFFF');
    check('抬头字号 20', a1.font?.size === 20);

    // 收集整表文本便于查找
    const allText = [];
    ws.eachRow((row) => row.eachCell((c) => { if (c.value != null) allText.push(String(c.value)); }));
    const has = (s) => allText.some((t) => t.includes(s));

    check('含单据标题', has('模  具  报  价  单'));
    check('含报价编号', has(created.data.quoteNo));
    check('含客户名称', has('顺德电器有限公司'));
    check('含模具类型', has('注塑模具'));
    check('含产品名称', has('洗衣机控制面板'));
    check('含费用分组-模具费用', has('（一）模具费用'));
    check('含费用明细项', has('模芯钢材费'));
    check('含手填费用项', has('差旅费'));
    check('含运输费', has('运输费'));
    check('运输费写明材积重算法', allText.some((t) => t.includes('最大值') && t.includes('6000')));
    check('报价单里不出现管理费', !allText.some((t) => t.includes('管理费')));
    check('项目信息含运输区域文字', has('广东省外'));
    check('含汇总-含税总价', has('含 税 总 价'));
    check('含大写金额', allText.some((t) => t.startsWith('大写金额：')));
    check('含商务条款', has('商务条款'));
    check('含供方签字栏', has('供方签字'));
    check('含需方签字栏', has('需方签字'));

    // 数值：总价单元格
    let totalCell = null;
    ws.eachRow((row) => row.eachCell((c) => {
      if (String(c.value).includes('含 税 总 价')) totalCell = ws.getCell(c.row, c.col + 1);
    }));
    check('总价金额单元格存在', !!totalCell);
    check('总价金额与计算一致', Math.abs(Number(totalCell?.value) - calc.total) < 0.01, `${totalCell?.value} vs ${calc.total}`);
    check('总价有金额格式', totalCell?.numFmt === '#,##0.00', String(totalCell?.numFmt));
    check('总价字体加粗放大', totalCell?.font?.bold === true && totalCell?.font?.size === 15);
    check('总价行深色底', totalCell?.fill?.fgColor?.argb === 'FF1E3A8A');

    // 明细行：检查有边框、右对齐、金额格式
    let sampleMoneyCell = null;
    ws.eachRow((row) => row.eachCell((c) => {
      if (!sampleMoneyCell && c.numFmt === '#,##0.00' && typeof c.value === 'number' && c.value === 5887.5) {
        sampleMoneyCell = c;
      }
    }));
    check('明细金额单元格存在', !!sampleMoneyCell);
    check('明细金额右对齐', sampleMoneyCell?.alignment?.horizontal === 'right');
    check('明细金额有边框', !!sampleMoneyCell?.border?.top);
    check('明细金额加粗', sampleMoneyCell?.font?.bold === true);

    // 计算说明列有内容
    const hasReadable = allText.some((t) => t.includes('模芯长') && t.includes('钢材单价'));
    check('明细含中文计算说明', hasReadable);

    // 注塑明细行：单价 / 数量 / 金额 三列都要有值
    let matRow = null;
    ws.eachRow((row) => {
      if (String(row.getCell(2).value) === '产品材料费') matRow = row;
    });
    check('找到产品材料费行', !!matRow);
    check('单价列 = 2.27', Math.abs(Number(matRow?.getCell(4).value) - 2.27) < 0.001, String(matRow?.getCell(4).value));
    check('数量列 = 5000', Number(matRow?.getCell(5).value) === 5000, String(matRow?.getCell(5).value));
    check('金额列 = 11340', Number(matRow?.getCell(6).value) === 11340, String(matRow?.getCell(6).value));
    check('单价列有小数格式', matRow?.getCell(4).numFmt === '#,##0.0000', String(matRow?.getCell(4).numFmt));
    check('数量列带「件」单位', matRow?.getCell(5).numFmt === '#,##0" 件"', String(matRow?.getCell(5).numFmt));

    // 模具费行没有单价/数量，应显示「—」而不是空
    let moldRow = null;
    ws.eachRow((row) => {
      if (String(row.getCell(2).value) === '模芯钢材费') moldRow = row;
    });
    check('模具费行单价列显示「—」', moldRow?.getCell(4).value === '—', String(moldRow?.getCell(4).value));

    // 明细 sheet
    const ws2 = wb.getWorksheet('计算明细');
    const text2 = [];
    ws2.eachRow((row) => row.eachCell((c) => { if (c.value != null) text2.push(String(c.value)); }));
    check('明细表含报价编号', text2.some((t) => t.includes(created.data.quoteNo)));
    check('明细表含计算过程', text2.some((t) => t.includes('模芯长')));
    check('明细表含含税总价', text2.some((t) => t.includes('含税总价')));

    // ---------- 大写金额校验 ----------
    console.log('\n[4] 金额大写');
    const { toChineseAmount } = await import('../dist/services/excel.js');
    check('1612285 → 壹佰陆拾壹万贰仟贰佰捌拾伍元整', toChineseAmount(1612285) === '壹佰陆拾壹万贰仟贰佰捌拾伍元整', toChineseAmount(1612285));
    check('100.5 → 壹佰元伍角', toChineseAmount(100.5) === '壹佰元伍角', toChineseAmount(100.5));
    check('0 → 零元整', toChineseAmount(0) === '零元整', toChineseAmount(0));
    check('10000 → 壹万元整', toChineseAmount(10000) === '壹万元整', toChineseAmount(10000));
    // 跨节补「零」：万位与千位之间
    check('100305.5 → 壹拾万零叁佰零伍元伍角', toChineseAmount(100305.5) === '壹拾万零叁佰零伍元伍角', toChineseAmount(100305.5));
    check('10100 → 壹万零壹佰元整', toChineseAmount(10100) === '壹万零壹佰元整', toChineseAmount(10100));
    check('100000 → 壹拾万元整', toChineseAmount(100000) === '壹拾万元整', toChineseAmount(100000));
    check('1000000 → 壹佰万元整', toChineseAmount(1000000) === '壹佰万元整', toChineseAmount(1000000));
    check('本单金额大写正确（玖万零伍佰叁拾柒元伍角）', toChineseAmount(calc.total) === '玖万零伍佰叁拾柒元伍角', toChineseAmount(calc.total));

    // ---------- 广东省内报价单（免运费），另出一份样张做对比 ----------
    console.log('\n[4.1] 广东省内报价单（免运费）');
    const gd = await req('POST', '/api/quotes/configured', {
      moldTypeId: inj.id,
      customerName: '广州本地客户',
      productName: '洗衣机控制面板',
      values: {
        腔数: 2, 单件重量: 0.18, 模芯长: 500, 模芯宽: 400, 模芯高: 150,
        钢材单价: 25, 原料单价: 12, 注塑数量: 5000, 首单数量: 300000,
        模具重量: 800, 运输箱长: 120, 运输箱宽: 100, 运输箱高: 80,
        运费单价: 1.2, 运输区域: 0,
      },
      manualAmounts: { 差旅费: 3500 },
    }, token);
    check('省内报价单创建成功', gd.status === 200 && !!gd.data.id, gd.data?.quoteNo);
    const gdDetail = await req('GET', `/api/quotes/${gd.data.id}`, undefined, token);
    const gdCalc = gdDetail.data?.versions?.[0]?.calcResultJson;
    const gdFr = gdCalc?.lines.find((l) => l.name === '运输费');
    check('省内运输费 = 0（免费）', gdFr?.value === 0, String(gdFr?.value));
    check('省内总价低于省外', gdCalc.total < calc.total, `${gdCalc.total} < ${calc.total}`);

    const gdResp = await fetch(`${BASE}/api/quotes/${gd.data.id}/export-excel`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const gdBuf = Buffer.from(await gdResp.arrayBuffer());
    check('省内 Excel 导出成功', gdResp.status === 200 && gdBuf.length > 5000, `${gdBuf.length} 字节`);
    fs.writeFileSync(path.join(apiDir, '..', '..', 'prototype', 'sample-quote-guangdong.xlsx'), gdBuf);

    // ---------- N. 客户分享页（免登录，凭 token） ----------
    console.log('\n[N] 客户分享链接');
    const sendRes = await req('POST', `/api/quotes/${qid}/send`, { email: 'buyer@example.com', sendEmail: false }, token);
    check('生成分享链接', sendRes.status === 200 && !!sendRes.data.shareToken, sendRes.data?.fullShareUrl);
    check(
      '分享链接指向正式域名（非 IP）',
      /^https:\/\/ycwl\.chat\/share\//.test(sendRes.data.fullShareUrl || ''),
      sendRes.data?.fullShareUrl,
    );

    const st = sendRes.data.shareToken;
    const sv = await req('GET', `/api/share/${st}`);
    check('免登录可打开分享页', sv.status === 200);
    check('返回报价单号', sv.data.quoteNo === created.data.quoteNo, sv.data.quoteNo);
    check('汇总-模具费正确', sv.data.summary?.moldExVat === calc.mold, `${sv.data.summary?.moldExVat} vs ${calc.mold}`);
    check('汇总-注塑费正确', sv.data.summary?.injectionExVat === calc.injection, String(sv.data.summary?.injectionExVat));
    check('汇总-单件成本正确', sv.data.summary?.unitCost === calc.unitCost, String(sv.data.summary?.unitCost));
    check('汇总-注塑数量正确', sv.data.summary?.injectionQty === 5000, String(sv.data.summary?.injectionQty));
    check(
      '汇总-不含税合计 = 模具 + 注塑 + 利润（利润不单独暴露）',
      sv.data.summary?.netExVat === Math.round((calc.mold + calc.injection + calc.profit) * 100) / 100,
      `${sv.data.summary?.netExVat} vs ${calc.mold + calc.injection + calc.profit}`,
    );
    check('汇总-含税总价正确', sv.data.summary?.totalIncVat === calc.total, String(sv.data.summary?.totalIncVat));

    // 脱敏：客户不该看到成本构成与利润
    const svText = JSON.stringify(sv.data);
    check('脱敏-不含分项明细 lines', !('lines' in sv.data) && !svText.includes('calcResultJson'));
    check('脱敏-不含利润字段', !svText.includes('"profit"'));
    check('脱敏-不含逐项费用名', !svText.includes('模芯钢材费') && !svText.includes('CNC'));
    check('脱敏-不含钢材单价等内部参数', !svText.includes('钢材单价'));

    check(
      '含商务条款',
      Array.isArray(sv.data.businessTerms) && sv.data.businessTerms.length > 0,
      `${sv.data.businessTerms?.length} 条`,
    );
    check('含产品规格', Array.isArray(sv.data.specs) && sv.data.specs.length > 0, (sv.data.specs || []).map((x) => x.label).join('、'));
    check('规格含注塑数量', (sv.data.specs || []).some((x) => x.label === '注塑数量'));
    check('规格含产品参数（腔数）', (sv.data.specs || []).some((x) => x.label === '腔数'));
    check('规格不含模具尺寸', !(sv.data.specs || []).some((x) => String(x.label).includes('模芯')));

    // 首次访问留痕（业务侧能看到客户是否打开过）
    const prisma2 = new PrismaClient();
    const viewLog = await prisma2.quoteLog.findFirst({ where: { quoteId: qid, action: 'viewed' } });
    check('首次查看已留痕', !!viewLog, viewLog?.detail);
    const shareRow = await prisma2.quoteShare.findUnique({ where: { shareToken: st } });
    check('记录访问时间', !!shareRow?.accessedAt);

    // 客户确认
    const cf = await req('POST', `/api/share/${st}/confirm`);
    check('客户确认成功', cf.status === 200, `HTTP ${cf.status} ${JSON.stringify(cf.data).slice(0, 140)}`);
    const afterQ = await req('GET', `/api/quotes/${qid}`, undefined, token);
    check('报价单状态变为已成交', afterQ.data.status === 'confirmed', afterQ.data.status);

    // 过期后不再展示金额
    await prisma2.quoteShare.update({
      where: { shareToken: st },
      data: { expiresAt: new Date(Date.now() - 86400000) },
    });
    const svExp = await req('GET', `/api/share/${st}`);
    check('过期仍可打开（给友好提示）', svExp.status === 200 && svExp.data.expired === true);
    check('过期后隐藏金额', svExp.data.summary === null);
    check('过期后仍保留报价单号与条款', !!svExp.data.quoteNo && svExp.data.businessTerms.length > 0);
    await prisma2.$disconnect();

    // 无效 token
    const bad = await req('GET', '/api/share/this-token-does-not-exist');
    check('无效 token → 404', bad.status === 404, String(bad.status));

    // ---------- O. 后台管理（仅 admin） ----------
    console.log('\n[O] 后台管理');
    const ov = await req('GET', '/api/admin/overview', undefined, token);
    check('概览可访问（admin）', ov.status === 200, `HTTP ${ov.status}`);
    check(
      '概览含用户/客户/报价单数',
      typeof ov.data.counts?.users === 'number' &&
        typeof ov.data.counts?.customers === 'number' &&
        typeof ov.data.counts?.quotes === 'number',
      `users=${ov.data.counts?.users} customers=${ov.data.counts?.customers} quotes=${ov.data.counts?.quotes}`,
    );
    check('概览含累计金额', typeof ov.data.amount?.total === 'number', String(ov.data.amount?.total));
    check(
      '概览含报价单状态分布',
      Array.isArray(ov.data.byStatus) && ov.data.byStatus.length > 0,
      (ov.data.byStatus || []).map((x) => `${x.label}:${x.count}`).join(' '),
    );
    check('概览含近 30 天数据', typeof ov.data.recent30?.quotes === 'number' && typeof ov.data.recent30?.users === 'number');

    const us = await req('GET', '/api/admin/users', undefined, token);
    check('用户列表可访问', us.status === 200 && Array.isArray(us.data));
    const me = (us.data || []).find((u) => u.email === 'q1@mqs.local');
    check('列表含当前管理员', !!me && me.role === 'admin');
    check(
      '用户含报价统计',
      typeof me?.stats?.quotes === 'number' && typeof me?.stats?.amount === 'number',
      `quotes=${me?.stats?.quotes} amount=${me?.stats?.amount}`,
    );
    check(
      '用户报价单数与总览一致',
      me?.stats?.quotes === ov.data.counts.quotes,
      `${me?.stats?.quotes} vs ${ov.data.counts.quotes}`,
    );
    check('可见邮箱验证状态与注册时间', typeof me?.emailVerified === 'boolean' && !!me?.createdAt);
    check('敏感字段不外泄（无密码哈希）', !JSON.stringify(us.data).includes('passwordHash'));

    // 非管理员应被拒
    const prisma3 = new PrismaClient();
    const comp3 = await prisma3.company.findFirst();
    await prisma3.user.create({
      data: {
        companyId: comp3.id,
        email: 'quoter2@mqs.local',
        passwordHash: bcrypt.hashSync('password123', 10),
        name: '李报价',
        role: 'quoter',
        emailVerified: true,
      },
    });
    await prisma3.$disconnect();
    const q2 = await req('POST', '/api/auth/login', { email: 'quoter2@mqs.local', password: 'password123' });
    const forbidden = await req('GET', '/api/admin/users', undefined, q2.data.token);
    check('普通报价员访问后台 → 403', forbidden.status === 403, `HTTP ${forbidden.status}`);
    const anon = await req('GET', '/api/admin/overview');
    check('未登录访问后台 → 401', anon.status === 401, `HTTP ${anon.status}`);

    // ---------- P. 材料两级分类 ----------
    console.log('\n[P] 材料两级分类');
    const seedMat = await req('POST', '/api/materials/seed-preset', {}, token);
    check('初始化预置材料', seedMat.status === 200, `新增 ${seedMat.data?.created} / 共 ${seedMat.data?.total}`);
    check('预置材料数量达到 35 种', seedMat.data?.total >= 35, String(seedMat.data?.total));

    const allMats = await req('GET', '/api/materials', undefined, token);
    const matList = allMats.data || [];
    const groups = [...new Set(matList.map((m) => m.category))];
    check(
      '一级分类覆盖四类用途',
      ['模具钢材', '塑料原料', '压铸合金', '辅助材料'].every((g) => groups.includes(g)),
      groups.join('、'),
    );

    const byCode = (c) => matList.find((m) => m.code === c);
    check('P20 → 预硬塑胶模具钢', byCode('P20')?.subCategory === '预硬塑胶模具钢', byCode('P20')?.subCategory);
    check('H13 → 热作模具钢', byCode('H13')?.subCategory === '热作模具钢', byCode('H13')?.subCategory);
    check('S136 → 镜面耐腐蚀钢', byCode('S136')?.subCategory === '镜面耐腐蚀钢', byCode('S136')?.subCategory);
    check('ADC12 → 铝合金', byCode('ADC12')?.subCategory === '铝合金', byCode('ADC12')?.subCategory);
    check('ABS → 通用塑料', byCode('ABS')?.subCategory === '通用塑料', byCode('ABS')?.subCategory);
    check('PA → 工程塑料', byCode('PA')?.subCategory === '工程塑料', byCode('PA')?.subCategory);
    check('PEEK → 特种工程塑料', byCode('PEEK')?.subCategory === '特种工程塑料', byCode('PEEK')?.subCategory);
    check('TPU → 弹性体软胶', byCode('TPU')?.subCategory === '弹性体软胶', byCode('TPU')?.subCategory);
    check('木箱 → 包装材料', byCode('WOODBOX')?.subCategory === '包装材料', byCode('WOODBOX')?.subCategory);

    // 同一分类的材料必须在列表里连续，否则前端分组会出现重复标题
    const seen = new Set();
    let lastCat = null;
    let contiguous = true;
    for (const m of matList) {
      if (m.category !== lastCat) {
        if (seen.has(m.category)) { contiguous = false; break; }
        seen.add(m.category);
        lastCat = m.category;
      }
    }
    check('列表按一级分类聚集（分组标题不会重复）', contiguous);

    // 老数据（升级前建的、没有二级分类）应能被初始化补全分类，且不动价格
    const prisma4 = new PrismaClient();
    const absRow = byCode('ABS');
    await prisma4.material.update({ where: { id: absRow.id }, data: { subCategory: null, currentPrice: 99 } });
    await prisma4.$disconnect();
    const seedAgain = await req('POST', '/api/materials/seed-preset', {}, token);
    check('初始化可为老材料补全二级分类', seedAgain.data.classified >= 1, `补全 ${seedAgain.data.classified} 个`);
    const absAfter = (await req('GET', '/api/materials', undefined, token)).data.find((m) => m.code === 'ABS');
    check('补分类时不动用户改过的价格', Number(absAfter.currentPrice) === 99, String(absAfter.currentPrice));
    check('补分类后二级分类正确', absAfter.subCategory === '通用塑料', absAfter.subCategory);

    const newMat = await req(
      'POST',
      '/api/materials',
      { code: 'TEST-X', name: '测试冷作钢', category: '模具钢材', subCategory: '冷作模具钢', unit: 'kg', currentPrice: 10, lossRate: 0.05 },
      token,
    );
    check('新建材料可带两级分类', newMat.status === 200 && newMat.data.subCategory === '冷作模具钢', newMat.data?.subCategory);
    await req('DELETE', `/api/materials/${newMat.data.id}`, undefined, token);

    // 配置中心里该模具类型的材料也要带二级分类
    const cfgMats = await req('GET', `/api/config/${inj.id}`, undefined, token);
    const cfgAbs = (cfgMats.data?.materials || []).find((m) => m.code === 'ABS');
    check('配置中心材料带二级分类', cfgAbs?.subCategory === '通用塑料', cfgAbs?.subCategory);

    // ---------- Excel 落盘供人工查看 ----------
    const out = path.join(apiDir, '..', '..', 'prototype', 'sample-quote.xlsx');
    fs.writeFileSync(out, buf);
    console.log(`\n  已导出样张：${out}`);
    console.log(`  已导出台内样张：${path.join(apiDir, '..', '..', 'prototype', 'sample-quote-guangdong.xlsx')}`);
  } catch (e) {
    fail++;
    failures.push('执行异常: ' + e.message);
    console.log('\n执行异常：', e.stack);
  } finally {
    api.kill();
  }

  console.log('\n===== 结果 =====');
  console.log(`${pass} 通过 / ${fail} 失败`);
  if (fail) { console.log('失败项：'); failures.forEach((f) => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
}

main();
