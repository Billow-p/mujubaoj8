// 生产端到端：主流模具成本项（模架费 / 机台费 / 热流道 / EDM …）
//
// 核心校验：**默认全为 0，不填不计钱**；填了才按公式算。
//   A. 不填 → 新增项金额全为 0，模具合计与改造前一致（56247.5）
//   B. 填上 → 模架/热流道/EDM/线切割/抛光 与 4 个手填项 精确计钱
//   C. 机台费公式：时薪 × 周期 ÷ 3600 ÷ 腔数
// 结束后清理全部测试数据。

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const COMPANY = 'default-company';
const base = 'http://127.0.0.1:3000';
const password = 'SmokeTest#2026';
const ts = Date.now();
let fail = 0;

const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${extra ? ' :: ' + extra : ''}`);
  if (!ok) fail++;
};
const near = (a, b, eps = 0.02) => Math.abs(Number(a) - Number(b)) <= eps;

let token = '';
let userId = null;
const customerNames = [];
const quoteIds = [];

async function api(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let j = null;
  try {
    j = await r.json();
  } catch {
    /* 空响应 */
  }
  return { status: r.status, body: j };
}

const lineOf = (result, name) => (result?.lines ?? []).find((l) => l.name === name);

try {
  const moldType = await prisma.moldType.findFirst({
    where: { companyId: COMPANY, code: 'injection' },
    select: { id: true },
  });
  if (!moldType) throw new Error('找不到注塑模具类型');

  const hash = await bcrypt.hash(password, 10);
  const email = `item_e2e_${ts}@example.com`;
  const u = await prisma.user.create({
    data: { email, name: '费用项冒烟', role: 'quoter', companyId: COMPANY, passwordHash: hash, emailVerified: true },
  });
  userId = u.id;
  const lg = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const lgj = await lg.json();
  check('登录成功', !!lgj.token, 'status=' + lg.status);
  token = lgj.token;

  const baseMoldParams = { 模芯长: 500, 模芯宽: 400, 模芯高: 150, 模具重量: 800 };
  const basePartParams = { 单件重量: 0.18, 原料单价: 12, 原料损耗率: 0.05, 机台时薪: 130, 成型周期: 30 };

  // ---------- A. 什么都不填 ----------
  const c1 = `不填费用项_${ts}`;
  customerNames.push(c1);
  const rA = await api('POST', '/api/quotes/project', {
    moldTypeId: moldType.id,
    customerName: c1,
    common: { profitRate: 0, taxRate: 0 },
    molds: [{ name: 'A模', params: { ...baseMoldParams } }],
    parts: [{ name: '件1', qty: 5000, params: { ...basePartParams } }],
  });
  check('不填新增项 → 报价 200', rA.status === 200, 'status=' + rA.status + ' ' + (rA.body?.error ?? ''));
  if (rA.body?.id) quoteIds.push(rA.body.id);
  const calcA = rA.body?.versions?.[0]?.calcResultJson ?? {};
  const moldA = calcA.moldResults?.[0] ?? {};

  for (const n of ['模架费', '热流道费', 'EDM放电费', '线切割费', '抛光省模费']) {
    check(`不填 → ${n} = 0`, near(lineOf(moldA, n)?.value, 0), 'value=' + lineOf(moldA, n)?.value);
  }
  for (const n of ['标准件费', '滑块斜顶镶件', '热处理费', '表面处理费']) {
    check(`不填 → ${n}（手填项）= 0`, near(lineOf(moldA, n)?.value, 0), 'value=' + lineOf(moldA, n)?.value);
  }
  // 与改造前一致：5887.5(钢) + 38400(CNC) + 6000(设计) + 5000(试模) + 960(运输)
  check('不填 → 模具合计仍为 56247.5（与改造前一致）', near(calcA.moldSubtotal, 56247.5), 'sub=' + calcA.moldSubtotal);
  check(
    '机台费按默认参数 = 130×30÷3600÷2 = 0.54 元/件',
    near(lineOf(calcA.partResults?.[0], '机台费')?.unitPrice, 0.54),
    'unitPrice=' + lineOf(calcA.partResults?.[0], '机台费')?.unitPrice,
  );
  check('旧的固定「注塑加工费」已不存在', lineOf(calcA.partResults?.[0], '注塑加工费') == null, '');

  // ---------- B. 全部填上 ----------
  const c2 = `填满费用项_${ts}`;
  customerNames.push(c2);
  const rB = await api('POST', '/api/quotes/project', {
    moldTypeId: moldType.id,
    customerName: c2,
    common: { profitRate: 0, taxRate: 0 },
    molds: [
      {
        name: 'B模',
        params: { ...baseMoldParams, 模架规格: 8600, 热流道点数: 2, 'EDM工时': 10, 线切割长度: 100, 抛光工时: 5 },
        manualAmounts: { 标准件费: 3000, 滑块斜顶镶件: 5000, 热处理费: 2000, 表面处理费: 1500 },
      },
    ],
    parts: [{ name: '件1', qty: 5000, params: { ...basePartParams } }],
  });
  check('填上新增项 → 报价 200', rB.status === 200, 'status=' + rB.status + ' ' + (rB.body?.error ?? ''));
  if (rB.body?.id) quoteIds.push(rB.body.id);
  const calcB = rB.body?.versions?.[0]?.calcResultJson ?? {};
  const moldB = calcB.moldResults?.[0] ?? {};

  check('模架规格 8600 → 模架费 = 8600', near(lineOf(moldB, '模架费')?.value, 8600), 'value=' + lineOf(moldB, '模架费')?.value);
  check('热流道 2 点 × 8000 = 16000', near(lineOf(moldB, '热流道费')?.value, 16000), 'value=' + lineOf(moldB, '热流道费')?.value);
  check('EDM 10h × 220 = 2200', near(lineOf(moldB, 'EDM放电费')?.value, 2200), 'value=' + lineOf(moldB, 'EDM放电费')?.value);
  check('线切割 100mm × 8 = 800', near(lineOf(moldB, '线切割费')?.value, 800), 'value=' + lineOf(moldB, '线切割费')?.value);
  check('抛光 5h × 120 = 600', near(lineOf(moldB, '抛光省模费')?.value, 600), 'value=' + lineOf(moldB, '抛光省模费')?.value);
  check('手填 标准件费 = 3000', near(lineOf(moldB, '标准件费')?.value, 3000), 'value=' + lineOf(moldB, '标准件费')?.value);
  check('手填 滑块斜顶镶件 = 5000', near(lineOf(moldB, '滑块斜顶镶件')?.value, 5000), 'value=' + lineOf(moldB, '滑块斜顶镶件')?.value);
  check('手填 热处理费 = 2000', near(lineOf(moldB, '热处理费')?.value, 2000), 'value=' + lineOf(moldB, '热处理费')?.value);
  check('手填 表面处理费 = 1500', near(lineOf(moldB, '表面处理费')?.value, 1500), 'value=' + lineOf(moldB, '表面处理费')?.value);

  const added = 8600 + 16000 + 2200 + 800 + 600 + 3000 + 5000 + 2000 + 1500;
  check(
    `模具合计 = 56247.5 + ${added} = ${56247.5 + added}`,
    near(calcB.moldSubtotal, 56247.5 + added),
    'sub=' + calcB.moldSubtotal,
  );

  // ---------- C. 机台费公式（换参数） ----------
  const c3 = `机台费_${ts}`;
  customerNames.push(c3);
  const rC = await api('POST', '/api/quotes/project', {
    moldTypeId: moldType.id,
    customerName: c3,
    common: { profitRate: 0, taxRate: 0, params: { 腔数: 4 } },
    molds: [{ name: 'C模', params: { ...baseMoldParams } }],
    parts: [{ name: '件1', qty: 5000, params: { ...basePartParams, 机台时薪: 200, 成型周期: 40 } }],
  });
  check('机台费报价 200', rC.status === 200, 'status=' + rC.status + ' ' + (rC.body?.error ?? ''));
  if (rC.body?.id) quoteIds.push(rC.body.id);
  const calcC = rC.body?.versions?.[0]?.calcResultJson ?? {};
  // 200 × 40 ÷ 3600 ÷ 4 = 0.5556 → 0.56
  check(
    '机台费 = 200×40÷3600÷4 = 0.56 元/件',
    near(lineOf(calcC.partResults?.[0], '机台费')?.unitPrice, 0.56),
    'unitPrice=' + lineOf(calcC.partResults?.[0], '机台费')?.unitPrice,
  );
} catch (e) {
  console.error('ERR', e && e.message);
  fail++;
} finally {
  try {
    for (const qid of quoteIds) {
      await prisma.quoteShare.deleteMany({ where: { quoteId: qid } });
      await prisma.quoteEmailLog.deleteMany({ where: { quoteId: qid } });
      await prisma.quoteVersion.deleteMany({ where: { quoteId: qid } });
      await prisma.quoteLog.deleteMany({ where: { quoteId: qid } });
      await prisma.quote.deleteMany({ where: { id: qid } });
    }
    await prisma.customer.deleteMany({ where: { companyId: COMPANY, name: { in: customerNames } } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    console.log('CLEANUP_DONE');
  } catch (e) {
    console.error('CLEANUP_ERR', e && e.message);
  }
  await prisma.$disconnect();
}

console.log(fail === 0 ? '\nALL_PASS' : `\nFAILED=${fail}`);
process.exit(fail === 0 ? 0 : 1);
