// 生产端到端：模具钢材来自材料库（方案 A）
//
// 断言全部从数据库读真实材料值来算，避免把价格/损耗写死。
// 校验点：
//   1) 不选钢材时，结果与「完全不涉及钢材材料」的基线完全一致（回归保证）
//   2) 选钢材后，钢材费 = 体积换算重量 × 材料单价 × (1+材料损耗率)
//   3) 一套单里两套模具可以用不同钢材
//   4) paramsJson 回存 materialName 与注入后的参数
// 结束后清理全部测试数据。

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const COMPANY = 'default-company';
const base = 'http://127.0.0.1:3000';
const password = 'SmokeTest#2026';
const ts = Date.now();
const STEEL_CODE = 'NAK80';
let fail = 0;

const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${extra ? ' :: ' + extra : ''}`);
  if (!ok) fail++;
};
const near = (a, b, eps = 0.02) => Math.abs(Number(a) - Number(b)) <= eps;

let userId = null;
const customerNames = [];
const quoteIds = [];

async function postProject(token, moldTypeId, customerName, molds) {
  const r = await fetch(base + '/api/quotes/project', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({
      moldTypeId,
      customerName,
      common: { profitRate: 0, taxRate: 0 },
      molds,
      parts: [],
    }),
  });
  const j = await r.json();
  if (j.id) quoteIds.push(j.id);
  return { status: r.status, body: j };
}

const lineOf = (m, name) => (m?.lines ?? []).find((l) => l.name === name);

try {
  const moldType = await prisma.moldType.findFirst({
    where: { companyId: COMPANY, code: 'injection' },
    select: { id: true },
  });
  if (!moldType) throw new Error('找不到注塑模具类型');

  const steel = await prisma.material.findFirst({
    where: { companyId: COMPANY, moldTypeId: null, code: STEEL_CODE },
  });
  if (!steel) throw new Error(`全局材料库找不到 ${STEEL_CODE}`);
  console.log(
    `材料库 ${STEEL_CODE}：${steel.name} / ¥${steel.currentPrice} per ${steel.unit} / 密度 ${steel.density} / 损耗 ${steel.lossRate}`,
  );

  const hash = await bcrypt.hash(password, 10);
  const email = `steel_e2e_${ts}@example.com`;
  const u = await prisma.user.create({
    data: { email, name: '钢材冒烟', role: 'quoter', companyId: COMPANY, passwordHash: hash, emailVerified: true },
  });
  userId = u.id;

  const lg = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const lgj = await lg.json();
  check('登录成功', !!lgj.token, 'status=' + lg.status);
  const token = lgj.token;

  const dims = { 模芯长: 500, 模芯宽: 400, 模芯高: 150 };
  // 体积换算重量：500×400×150 /1000 ×7.85 /1000 = 235.5 kg
  const weightKg = (500 * 400 * 150) / 1000 * 7.85 / 1000;

  // ---------- 基线：两套都不选钢材 ----------
  const c1 = `钢材基线客户_${ts}`;
  customerNames.push(c1);
  const base1 = await postProject(token, moldType.id, c1, [
    { name: 'A模', params: { ...dims } },
    { name: 'B模', params: { ...dims } },
  ]);
  check('基线（不选钢材）200', base1.status === 200, 'status=' + base1.status + ' ' + (base1.body.error ?? ''));
  const bMolds = base1.body.versions?.[0]?.calcResultJson?.moldResults ?? [];
  const baselineSteel = lineOf(bMolds[0], '模芯钢材费')?.value;

  // ---------- 处理：B 模选 NAK80 ----------
  const c2 = `钢材测试客户_${ts}`;
  customerNames.push(c2);
  const res = await postProject(token, moldType.id, c2, [
    { name: 'A模（不选钢材）', params: { ...dims } },
    { name: 'B模（NAK80）', materialCode: STEEL_CODE, params: { ...dims } },
  ]);
  check('项目报价 200', res.status === 200, 'status=' + res.status + ' ' + (res.body.error ?? ''));

  const ver = res.body.versions?.[0] ?? {};
  const calc = ver.calcResultJson ?? {};
  const molds = calc.moldResults ?? [];
  check('返回 2 套模具结果', molds.length === 2, 'n=' + molds.length);

  const aSteel = lineOf(molds[0], '模芯钢材费')?.value;
  const bSteel = lineOf(molds[1], '模芯钢材费')?.value;
  const expectB = weightKg * Number(steel.currentPrice) * (1 + Number(steel.lossRate));

  check(
    `A 模未选钢材 → 与基线完全一致（${baselineSteel}）`,
    near(aSteel, baselineSteel),
    `value=${aSteel} baseline=${baselineSteel}`,
  );
  check(
    `B 模选 ${STEEL_CODE} → ${weightKg}×${steel.currentPrice}×(1+${steel.lossRate}) = ${expectB.toFixed(2)}`,
    near(bSteel, expectB),
    'value=' + bSteel,
  );
  check('两套模具钢材费不同（一单多钢）', !near(aSteel, bSteel), `${aSteel} vs ${bSteel}`);

  const stored = ver.paramsJson?.molds ?? [];
  check('回存 materialName = 材料库名称', stored[1]?.materialName === steel.name, 'name=' + stored[1]?.materialName);
  check('回存注入后的钢材单价', near(stored[1]?.params?.['钢材单价'], steel.currentPrice), 'p=' + stored[1]?.params?.['钢材单价']);
  check('回存注入后的钢材密度', near(stored[1]?.params?.['钢材密度'], steel.density), 'p=' + stored[1]?.params?.['钢材密度']);
  check('回存注入后的钢材损耗率', near(stored[1]?.params?.['钢材损耗率'], steel.lossRate, 1e-6), 'p=' + stored[1]?.params?.['钢材损耗率']);
  check('A 模未被注入钢材参数（仍走公共参数）', stored[0]?.params?.['钢材单价'] == null, 'p=' + stored[0]?.params?.['钢材单价']);

  const sum = near(molds[0].subtotal + molds[1].subtotal, calc.moldSubtotal);
  check('模具小计 = 两套模具之和', sum, `${molds[0].subtotal}+${molds[1].subtotal} vs ${calc.moldSubtotal}`);
  check('总价 = 不含税小计（利润/税均为 0）', near(calc.total, calc.subtotal), 'total=' + calc.total);
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
