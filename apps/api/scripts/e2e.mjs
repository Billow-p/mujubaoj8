// V1.0 端到端回归测试（本地嵌入式 PostgreSQL）
// 一键运行：node apps/api/scripts/e2e.mjs
// 会自建种子数据、启动 API、跑完全部用例后关闭 API

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, '..');

// ---------- 加载 .env ----------
const envPath = path.join(apiDir, '.env');
const fileEnv = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) fileEnv[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
Object.assign(process.env, fileEnv);
const PORT = Number(fileEnv.PORT || 4799);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  \u2717 ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function req(method, p, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(BASE + p, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* 保持文本 */
  }
  return { status: resp.status, data };
}

const BASE_INPUT = {
  customerName: 'E2E测试客户',
  productName: 'E2E产品',
  material: 'ABS',
  steel: 'P20',
  complexity: 'medium',
  singleWeightKg: 0.18,
  cavityCount: 2,
  cycleTimeS: 45,
  efficiencyFactor: 0.8,
  firstOrderQty: 300000,
  machineRatePerHour: 130,
  materialLossRate: 0.05,
  vatRate: 0.13,
  managementRate: 0.15,
  coreLengthMm: 500,
  coreWidthMm: 400,
  coreHeightMm: 150,
  steelDensity: 7.85,
  steelUnitPrice: 25,
  machineTonnageT: 160,
  postProcessType: '去飞边/装箱',
};

async function seedDatabase() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  // 按外键依赖顺序清理
  await prisma.quoteAdjustment.deleteMany({});
  await prisma.quoteVersion.deleteMany({});
  await prisma.quoteLog.deleteMany({});
  await prisma.quoteEmailLog.deleteMany({});
  await prisma.quoteShare.deleteMany({});
  await prisma.emailVerification.deleteMany({});
  await prisma.quote.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.customFormula.deleteMany({});
  await prisma.customParameter.deleteMany({});
  await prisma.materialPrice.deleteMany({});
  await prisma.material.deleteMany({});
  await prisma.quoteTemplate.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.company.deleteMany({});

  const company = await prisma.company.create({ data: { name: 'E2E测试企业' } });
  await prisma.user.create({
    data: {
      companyId: company.id,
      email: 'quoter@mqs.local',
      passwordHash: bcrypt.hashSync('password123', 10),
      name: '测试报价员',
      role: 'quoter',
      emailVerified: true,
    },
  });
  const company2 = await prisma.company.create({ data: { name: '隔离企业' } });
  await prisma.user.create({
    data: {
      companyId: company2.id,
      email: 'other@mqs.local',
      passwordHash: bcrypt.hashSync('password123', 10),
      name: '隔离企业用户',
      role: 'admin',
      emailVerified: true,
    },
  });
  await prisma.$disconnect();
}

async function waitForApi(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  console.log('\n========== 模具注塑报价系统 V1.0 端到端回归测试 ==========');

  console.log('\n[准备] 初始化种子数据');
  await seedDatabase();
  console.log('  \u2713 已创建测试企业与用户');

  console.log('\n[准备] 启动 API 服务');
  const api = spawn(process.execPath, ['dist/index.js'], {
    cwd: apiDir,
    env: { ...process.env, ...fileEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.on('data', (d) => process.stdout.write(`  [api] ${d}`));
  api.stderr.on('data', (d) => process.stderr.write(`  [api:err] ${d}`));

  const up = await waitForApi();
  check('API 启动并可访问 /health', up);
  if (!up) {
    api.kill();
    process.exit(1);
  }

  try {
    // ---------- 1 登录与鉴权 ----------
    console.log('\n[1] 登录与鉴权（PRD 2.2）');
    const login = await req('POST', '/api/auth/login', {
      email: 'quoter@mqs.local',
      password: 'password123',
    });
    check('登录成功返回 token', login.status === 200 && !!login.data?.token);
    const token = login.data?.token;
    if (!token) throw new Error('无法获取 token');
    const noAuth = await req('GET', '/api/materials');
    check('未带 token 被拒绝', noAuth.status === 401 || noAuth.status === 403);
    const badPwd = await req('POST', '/api/auth/login', {
      email: 'quoter@mqs.local',
      password: 'wrong-password',
    });
    check('错误密码被拒绝', badPwd.status === 401 || badPwd.status === 400);

    // ---------- 2 材料中心 ----------
    console.log('\n[2] 材料中心（P5 材料 / P6 价格版本 / PRD 3.7）');
    const seed = await req('POST', '/api/materials/seed-preset', {}, token);
    check('初始化预置材料', seed.status === 200 && seed.data.created > 0, `新增 ${seed.data.created} 个`);
    const mats = await req('GET', '/api/materials', undefined, token);
    check('材料列表可读', mats.status === 200 && mats.data.length > 0, `${mats.data.length} 条`);
    const abs = mats.data.find((m) => m.code === 'ABS');
    check('预置材料含 ABS', !!abs, abs ? `单价 ¥${abs.currentPrice}` : '');

    const customMat = await req('POST', '/api/materials', {
      code: 'E2E_PC',
      name: '自制PC料',
      category: '塑料原料',
      unit: 'kg',
      currentPrice: 30,
      lossRate: 0.04,
    }, token);
    check('新增自定义材料', customMat.status === 200 && !!customMat.data.id);

    await req('PATCH', `/api/materials/${customMat.data.id}`, { currentPrice: 33 }, token);
    const prices = await req('GET', `/api/materials/${customMat.data.id}/prices`, undefined, token);
    check('改价生成新价格版本（PRD 3.7）', prices.status === 200 && prices.data.length === 2, `版本数 ${prices.data.length}`);

    const dupMat = await req('POST', '/api/materials', { code: 'E2E_PC', name: '重复' }, token);
    check('材料编码重复被拦截', dupMat.status === 400);

    // ---------- 3 参数中心 ----------
    console.log('\n[3] 参数中心（P4 / PRD 3.3）');
    const pCreate = await req('POST', '/api/parameters', {
      code: 'hotRunnerPoints',
      name: '热流道点数',
      type: 'int',
      unit: '点',
      defaultValue: '8',
      group: '模具参数',
    }, token);
    check('新增自定义参数', pCreate.status === 200 && !!pCreate.data.id);
    const pDup = await req('POST', '/api/parameters', { code: 'hotRunnerPoints', name: '重复编码' }, token);
    check('参数编码重复被拦截', pDup.status === 400);
    const pBad = await req('POST', '/api/parameters', { code: '2bad', name: '非法编码' }, token);
    check('非法编码被拦截', pBad.status === 400, `status=${pBad.status} ${JSON.stringify(pBad.data).slice(0, 100)}`);
    const pList = await req('GET', '/api/parameters?enabled=true', undefined, token);
    check('参数列表可读', pList.status === 200 && pList.data.length >= 1, `${pList.data.length} 条`);

    // ---------- 4 报价项中心 ----------
    console.log('\n[4] 报价项中心（P3/P7/P8/P9 · 公式·条件·测试发布）');
    const vars = await req('GET', '/api/formulas/variables', undefined, token);
    check('变量清单可读', vars.status === 200 && vars.data.builtin.length > 0, `内置 ${vars.data.builtin.length} 个`);
    check('自定义参数进入变量清单', (vars.data.customParameters ?? []).some((p) => p.key === 'hotRunnerPoints'));

    const t1 = await req('POST', '/api/formulas/test', { expression: 'cavityCount * 800 + 5000' }, token);
    check('公式测试返回计算过程（PRD 4.6）', t1.status === 200 && t1.data.value === 6600, `2*800+5000=${t1.data.value}`);
    const t2 = await req('POST', '/api/formulas/test', {
      expression: '12000',
      condition: 'cavityCount >= 4 && firstOrderQty > 100000',
      variables: { cavityCount: 4 },
    }, token);
    check('条件公式 AND 求值（PRD 4.2）', t2.status === 200 && t2.data.conditionValue === 1);
    const t3 = await req('POST', '/api/formulas/test', {
      expression: '12000',
      condition: 'cavityCount >= 4 && firstOrderQty > 1000000',
      variables: { firstOrderQty: 500000 },
    }, token);
    check('条件不满足时条件值为 0', t3.status === 200 && t3.data.conditionValue === 0);
    const tOr = await req('POST', '/api/formulas/test', {
      expression: 'if(cavityCount == 1 || cavityCount == 2, 100, 0)',
    }, token);
    check('OR 逻辑求值', tOr.status === 200 && tOr.data.value === 100);
    const t4 = await req('POST', '/api/formulas/test', { expression: 'undefinedVar * 2' }, token);
    check('未知变量被拦截（PRD 4.7）', t4.status === 400);
    const t5 = await req('POST', '/api/formulas/test', { expression: 'eval(1+1)' }, token);
    check('危险函数被拦截（PRD 4.7）', t5.status === 400);

    const it1 = await req('POST', '/api/formulas', {
      code: 'heatRunnerFee',
      name: '热流道费',
      scope: 'mold',
      category: '热流道',
      expression: 'hotRunnerPoints * 1500',
    }, token);
    check('新建报价项默认未启用', it1.status === 200 && it1.data.enabled === false);
    const enableBefore = await req('POST', `/api/formulas/${it1.data.id}/enable`, {}, token);
    check('未测试不允许启用（PRD 4.5）', enableBefore.status === 400);
    const testIt = await req('POST', `/api/formulas/${it1.data.id}/test`, {}, token);
    check('报价项测试通过', testIt.status === 200 && testIt.data.ok, `值 ${testIt.data.value}`);
    const enableAfter = await req('POST', `/api/formulas/${it1.data.id}/enable`, {}, token);
    check('测试通过后可启用', enableAfter.status === 200 && enableAfter.data.enabled === true);

    const it2 = await req('POST', '/api/formulas', {
      code: 'bigOrderFee',
      name: '大单附加',
      scope: 'mold',
      expression: 'firstOrderQty * 0.01',
      condition: 'firstOrderQty > 200000',
    }, token);
    await req('POST', `/api/formulas/${it2.data.id}/test`, {}, token);
    await req('POST', `/api/formulas/${it2.data.id}/enable`, {}, token);

    await req('PATCH', `/api/formulas/${it1.data.id}`, { expression: 'hotRunnerPoints * 1800' }, token);
    const afterEdit = await req('GET', '/api/formulas', undefined, token);
    const it1Row = afterEdit.data.find((f) => f.id === it1.data.id);
    check('改公式后自动停用并复位测试', it1Row?.enabled === false && it1Row?.tested === false);
    await req('POST', `/api/formulas/${it1.data.id}/test`, {}, token);
    await req('POST', `/api/formulas/${it1.data.id}/enable`, {}, token);

    // ---------- 5 报价业务 ----------
    console.log('\n[5] 报价业务（P11 新建报价 / P13 版本冻结）');
    const baseline = await req('POST', '/api/calc/quote', { input: BASE_INPUT }, token);
    check('基础计算可用', baseline.status === 200, `含税 ¥${baseline.data?.summary?.grandTotalIncVat}`);

    const q1 = await req('POST', '/api/quotes', {
      customerName: 'E2E测试客户',
      input: { ...BASE_INPUT, customParams: { hotRunnerPoints: 8 } },
    }, token);
    check('创建报价单', q1.status === 200 && !!q1.data.id, q1.data?.quoteNo);
    const qid = q1.data?.id;

    const detail = await req('GET', `/api/quotes/${qid}`, undefined, token);
    const v0 = detail.data?.versions?.[0];
    const customMold = v0?.calcResultJson?.customFormulas?.mold ?? [];
    check('启用的自定义报价项自动参与计算', customMold.length >= 2, customMold.map((c) => `${c.name}=${c.value}`).join(', '));
    check('报价项公式用到自定义参数', customMold.some((c) => c.name === '热流道费' && c.value === 14400), `热流道费=${customMold.find((c) => c.name === '热流道费')?.value}`);
    check('报价项随版本冻结（PRD 5.9）', Array.isArray(v0?.paramsJson?.customFormulas) && v0.paramsJson.customFormulas.length >= 2);
    check('计算结果高于基础值', v0?.calcResultJson?.summary?.grandTotalIncVat > baseline.data?.summary?.grandTotalIncVat);

    // ---------- 6 人工调整与状态 ----------
    console.log('\n[6] 人工调整与状态流转（P12 / PRD 5.6、5.8）');
    const adj = await req('POST', `/api/quotes/${qid}/adjust`, {
      field: 'grandTotalIncVat',
      adjustedValue: 1500000,
      reason: '老客户让利',
    }, token);
    check('人工调整留痕', adj.status === 200 && adj.data.systemValue > 0, `系统值 ${adj.data.systemValue}`);
    const adjList = await req('GET', `/api/quotes/${qid}/adjustments`, undefined, token);
    check('调整记录可查', adjList.status === 200 && adjList.data.length === 1);
    const st1 = await req('PATCH', `/api/quotes/${qid}/status`, { status: 'confirmed' }, token);
    check('状态流转为已成交', st1.status === 200);
    const st2 = await req('PATCH', `/api/quotes/${qid}/status`, { status: 'void' }, token);
    check('状态流转为已作废', st2.status === 200);
    await req('PATCH', `/api/quotes/${qid}/status`, { status: 'draft' }, token);

    // ---------- 7 客户与历史 ----------
    console.log('\n[7] 客户与历史报价（P14 / PRD 6.1-6.3）');
    const dup = await req('POST', `/api/quotes/${qid}/duplicate`, {}, token);
    check('复制报价生成新单', dup.status === 200 && dup.data.id !== qid, dup.data?.quoteNo);
    const oldStill = await req('GET', `/api/quotes/${qid}`, undefined, token);
    check('原报价未被改动（PRD 6.3）', oldStill.status === 200 && oldStill.data.status === 'draft');

    const custList = await req('GET', '/api/customers', undefined, token);
    check('客户列表可读', custList.status === 200 && custList.data.length > 0, `${custList.data.length} 个客户`);
    const cust = custList.data.find((c) => c.name === 'E2E测试客户');
    check('客户带报价统计', cust && cust.stats.totalQuotes >= 2, `报价数 ${cust?.stats.totalQuotes}`);
    check('客户最近报价金额有值', cust && cust.stats.lastAmount > 0, `¥${cust?.stats.lastAmount}`);
    const custQuotes = await req('GET', `/api/customers/${cust.id}/quotes`, undefined, token);
    check('客户历史报价可查', custQuotes.status === 200 && custQuotes.data.length >= 2, `${custQuotes.data.length} 条`);
    const search = await req('GET', '/api/customers?keyword=E2E', undefined, token);
    check('客户搜索可用', search.status === 200 && search.data.length >= 1);

    // ---------- 8 Excel 导出 ----------
    console.log('\n[8] Excel 导出（P15）');
    const exp = await fetch(`${BASE}/api/quotes/${qid}/export-excel`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const buf = Buffer.from(await exp.arrayBuffer());
    check('导出返回 xlsx', exp.status === 200 && buf.length > 3000, `${buf.length} 字节`);
    check('xlsx 文件头合法', buf.slice(0, 2).toString() === 'PK');

    // ---------- 9 报价模板 ----------
    console.log('\n[9] 报价模板（P10）');
    const tpl = await req('POST', '/api/templates', {
      name: 'E2E标准模板',
      itemCodes: ['heatRunnerFee', 'bigOrderFee'],
      isDefault: true,
    }, token);
    check('创建报价模板', tpl.status === 200 && !!tpl.data.id);
    const tplList = await req('GET', '/api/templates', undefined, token);
    check('模板列表可读', tplList.status === 200 && tplList.data.length >= 1);

    // ---------- 10 数据隔离 ----------
    console.log('\n[10] 企业数据隔离（PRD 2.4）');
    const other = await req('POST', '/api/auth/login', {
      email: 'other@mqs.local',
      password: 'password123',
    });
    check('第二个企业可登录', other.status === 200 && !!other.data?.token);
    const otok = other.data?.token;
    const isoMats = await req('GET', '/api/materials', undefined, otok);
    check('看不到其它企业材料', isoMats.status === 200 && isoMats.data.length === 0, `${isoMats.data.length} 条`);
    const isoQuotes = await req('GET', '/api/quotes', undefined, otok);
    check('看不到其它企业报价', isoQuotes.status === 200 && isoQuotes.data.length === 0);
    const isoItems = await req('GET', '/api/formulas', undefined, otok);
    check('看不到其它企业报价项', isoItems.status === 200 && isoItems.data.length === 0);
    const crossGet = await req('GET', `/api/quotes/${qid}`, undefined, otok);
    check('无法跨企业读取报价单详情', crossGet.status === 404);
  } catch (e) {
    fail++;
    failures.push('测试执行异常: ' + e.message);
    console.log('\n执行异常：', e.message);
  } finally {
    api.kill();
  }

  console.log('\n========== 结果 ==========');
  console.log(`${pass} 通过 / ${fail} 失败`);
  if (fail > 0) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(fail === 0 ? 0 : 1);
}

main();
