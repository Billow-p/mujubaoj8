// 生产端到端：材料中心 + 材料驱动算价
//
// 覆盖：
//   A. 新增材料（不填编码 → 自动生成；重名 → 自动加后缀）
//   B. 改价生成价格版本；停用可保存
//   C. 自建材料可删除
//   D. 删除被报价引用的材料 → 被拒绝
//   E. 引用不存在的材料下单 → 400
//   F. 单位换算（材料按 t 维护 → 折算成元/kg）
//   G. 注塑件按材料库的损耗率计算
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
const createdMaterialIds = [];
const customerNames = [];
const quoteIds = [];

const authHeaders = () => ({ 'content-type': 'application/json', authorization: 'Bearer ' + token });

async function api(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: authHeaders(),
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

try {
  const moldType = await prisma.moldType.findFirst({
    where: { companyId: COMPANY, code: 'injection' },
    select: { id: true },
  });
  if (!moldType) throw new Error('找不到注塑模具类型');

  const pa = await prisma.material.findFirst({
    where: { companyId: COMPANY, moldTypeId: null, code: 'PA' },
  });
  if (!pa) throw new Error('全局材料库找不到 PA');

  const hash = await bcrypt.hash(password, 10);
  const email = `mat_e2e_${ts}@example.com`;
  const u = await prisma.user.create({
    data: { email, name: '材料冒烟', role: 'quoter', companyId: COMPANY, passwordHash: hash, emailVerified: true },
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

  // ---------- A. 新增材料 ----------
  const rA = await api('POST', '/api/materials', { name: `冷作钢甲_${ts}`, category: '模具钢材', unit: 'kg' });
  check('新增材料（不填编码）= 200', rA.status === 200, 'status=' + rA.status + ' ' + (rA.body?.error ?? ''));
  check('服务端自动生成了编码', !!rA.body?.code, 'code=' + rA.body?.code);
  if (rA.body?.id) createdMaterialIds.push(rA.body.id);

  const rA2 = await api('POST', '/api/materials', { name: `冷作钢甲_${ts}`, category: '模具钢材', unit: 'kg' });
  check('同名再建 → 编码自动加后缀（不报重复）', rA2.status === 200 && rA2.body?.code !== rA.body?.code, `${rA.body?.code} vs ${rA2.body?.code}`);
  if (rA2.body?.id) createdMaterialIds.push(rA2.body.id);

  const rA3 = await api('POST', '/api/materials', { name: '', unit: 'kg' });
  check('缺名称 → 400 且提示中文', rA3.status === 400 && /名称/.test(rA3.body?.error ?? ''), 'err=' + rA3.body?.error);

  // ---------- B. 改价生成价格版本 / 停用 ----------
  const rB = await api('PATCH', `/api/materials/${rA.body.id}`, { currentPrice: 99 });
  check('改价 = 200', rB.status === 200, 'status=' + rB.status);
  const rB2 = await api('GET', `/api/materials/${rA.body.id}/prices`);
  check('价格版本变成 2 条（1 初始 + 1 调价）', (rB2.body ?? []).length === 2, 'n=' + (rB2.body ?? []).length);
  const rB3 = await api('PATCH', `/api/materials/${rA.body.id}`, { enabled: false });
  check('停用 = 200 且 enabled=false', rB3.status === 200 && rB3.body?.enabled === false, 'enabled=' + rB3.body?.enabled);

  // ---------- C. 自建材料可删除 ----------
  const rC = await api('DELETE', `/api/materials/${rA2.body.id}`);
  check('删除未引用的自建材料 = 200', rC.status === 200, 'status=' + rC.status);

  // ---------- 准备：按吨维护的钢材 + 引用它的报价 ----------
  const steel = await api('POST', '/api/materials', {
    name: `测试钢材_${ts}`,
    category: '模具钢材',
    subCategory: '冷作模具钢',
    unit: 't',
    currentPrice: 12000, // 12000 元/吨 = 12 元/kg
    lossRate: 0.1,
    density: 7.85,
  });
  check('新增按吨维护的钢材 = 200', steel.status === 200, 'status=' + steel.status + ' ' + (steel.body?.error ?? ''));
  const steelId = steel.body?.id;
  if (steelId) createdMaterialIds.push(steelId);

  const customerName = `材料测试客户_${ts}`;
  customerNames.push(customerName);
  const dims = { 模芯长: 500, 模芯宽: 400, 模芯高: 150 };
  const q = await api('POST', '/api/quotes/project', {
    moldTypeId: moldType.id,
    customerName,
    common: { profitRate: 0, taxRate: 0 },
    molds: [{ name: 'A模', materialCode: steel.body.code, params: { ...dims } }],
    parts: [{ name: '件1', materialCode: 'PA', qty: 1000, params: { 单件重量: 0.18 } }],
  });
  check('项目报价（含钢材 + 注塑件材料）= 200', q.status === 200, 'status=' + q.status + ' ' + (q.body?.error ?? ''));
  if (q.body?.id) quoteIds.push(q.body.id);

  const calc = q.body?.versions?.[0]?.calcResultJson ?? {};
  const moldSteel = (calc.moldResults?.[0]?.lines ?? []).find((l) => l.name === '模芯钢材费');
  const partRes = calc.partResults?.[0] ?? {};

  // ---------- F. 单位换算：12000 元/吨 → 12 元/kg ----------
  // 235.5 kg = 500×400×150/1000×7.85/1000；×12×1.1 = 3108.6
  check('单位换算（吨→kg）：钢材费 = 235.5×12×1.1 = 3108.6', near(moldSteel?.value, 3108.6), 'value=' + moldSteel?.value);

  // ---------- G. 注塑件按材料库损耗率计算 ----------
  // 注意：partResult.unitCost 是「整件成本」（材料费 + 加工费 + 包装费），
  // 所以要校验的是「产品材料费」那一项的单件价。
  const matLine = (partRes.lines ?? []).find((l) => l.name === '产品材料费');
  const expectMatUnit = Math.round(0.18 * Number(pa.currentPrice) * (1 + Number(pa.lossRate)) * 100) / 100;
  check(
    `注塑件材料费按材料库损耗率（PA ${Math.round(pa.lossRate * 100)}%）：0.18×${pa.currentPrice}×${(1 + Number(pa.lossRate)).toFixed(2)} = ${expectMatUnit}`,
    near(matLine?.unitPrice, expectMatUnit),
    `unitPrice=${matLine?.unitPrice} 期望=${expectMatUnit}`,
  );

  // 整件成本 = 材料费 + 加工费 0.3 + 包装费 0.05
  const expectTotal = Math.round((expectMatUnit + 0.3 + 0.05) * 100) / 100;
  check(
    `整件成本 = 材料费 + 加工费 + 包装费 = ${expectTotal}`,
    near(partRes.unitCost, expectTotal),
    `unitCost=${partRes.unitCost} 期望=${expectTotal}`,
  );

  // ---------- H. 材料阶梯价（按用量取价） ----------
  // 钢材：用量 235.5kg，档位 0~100 → 20 元/kg，100 以上 → 10 元/kg，应命中 10
  const tierSteel = await api('POST', '/api/materials', {
    name: `阶梯钢材_${ts}`,
    category: '模具钢材',
    unit: 'kg',
    currentPrice: 20,
    lossRate: 0.1,
    density: 7.85,
    priceRule: 'tiered',
    priceTiers: [
      { minQty: 0, maxQty: 100, price: 20 },
      { minQty: 100, maxQty: null, price: 10 },
    ],
  });
  check('新增阶梯价钢材 = 200', tierSteel.status === 200, 'status=' + tierSteel.status + ' ' + (tierSteel.body?.error ?? ''));
  if (tierSteel.body?.id) createdMaterialIds.push(tierSteel.body.id);

  // 塑料：数量 1000 件 × 0.18kg = 180kg，档位 100 以上 → 25 元/kg
  const tierPlastic = await api('POST', '/api/materials', {
    name: `阶梯塑料_${ts}`,
    category: '塑料原料',
    subCategory: '通用塑料',
    unit: 'kg',
    currentPrice: 30,
    lossRate: 0.05,
    density: 1.05,
    priceRule: 'tiered',
    priceTiers: [
      { minQty: 0, maxQty: 100, price: 30 },
      { minQty: 100, maxQty: null, price: 25 },
    ],
  });
  check('新增阶梯价塑料 = 200', tierPlastic.status === 200, 'status=' + tierPlastic.status + ' ' + (tierPlastic.body?.error ?? ''));
  if (tierPlastic.body?.id) createdMaterialIds.push(tierPlastic.body.id);

  const cust2 = `阶梯价客户_${ts}`;
  customerNames.push(cust2);
  const q2 = await api('POST', '/api/quotes/project', {
    moldTypeId: moldType.id,
    customerName: cust2,
    common: { profitRate: 0, taxRate: 0 },
    molds: [{ name: '阶梯模', materialCode: tierSteel.body.code, params: { ...dims } }],
    parts: [{ name: '阶梯件', materialCode: tierPlastic.body.code, qty: 1000, params: { 单件重量: 0.18 } }],
  });
  check('阶梯价报价 = 200', q2.status === 200, 'status=' + q2.status + ' ' + (q2.body?.error ?? ''));
  if (q2.body?.id) quoteIds.push(q2.body.id);

  const calc2 = q2.body?.versions?.[0]?.calcResultJson ?? {};
  const steelLine2 = (calc2.moldResults?.[0]?.lines ?? []).find((l) => l.name === '模芯钢材费');
  check(
    '阶梯价钢材命中 100kg 以上档（10 元/kg）：235.5×10×1.1 = 2590.5',
    near(steelLine2?.value, 2590.5),
    'value=' + steelLine2?.value,
  );

  const matLine2 = (calc2.partResults?.[0]?.lines ?? []).find((l) => l.name === '产品材料费');
  check(
    '阶梯价塑料按用量取价：0.18×25×1.05 = 4.73',
    near(matLine2?.unitPrice, 4.73),
    'unitPrice=' + matLine2?.unitPrice,
  );

  // ---------- I. 配置中心保存不再改动材料（防止把材料整批删掉） ----------
  const beforeCount = await prisma.material.count();
  const cfgSave = await api('PUT', `/api/config/${moldType.id}`, { materials: [] });
  const afterCount = await prisma.material.count();
  check('保存配置时传 materials:[] 不再删除材料', cfgSave.status === 200 && beforeCount === afterCount, `status=${cfgSave.status} ${beforeCount} → ${afterCount}`);

  // ---------- D. 被引用的材料不能删 ----------
  const rD = await api('DELETE', `/api/materials/${steelId}`);
  check('删除被报价引用的材料 → 被拒绝并提示停用', rD.status === 400 && /停用/.test(rD.body?.error ?? ''), `status=${rD.status} err=${rD.body?.error}`);

  // ---------- E. 引用不存在的材料 → 400 ----------
  const rE = await api('POST', '/api/quotes/project', {
    moldTypeId: moldType.id,
    customerName: `不存在材料客户_${ts}`,
    common: { profitRate: 0, taxRate: 0 },
    molds: [{ name: 'X模', materialCode: 'NO_SUCH_CODE_XYZ', params: { ...dims } }],
    parts: [],
  });
  check('引用不存在的材料 → 400', rE.status === 400, 'status=' + rE.status + ' err=' + rE.body?.error);
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
    if (createdMaterialIds.length) {
      await prisma.materialPrice.deleteMany({ where: { materialId: { in: createdMaterialIds } } });
      await prisma.material.deleteMany({ where: { id: { in: createdMaterialIds } } });
    }
    if (userId) await prisma.user.delete({ where: { id: userId } });
    console.log('CLEANUP_DONE');
  } catch (e) {
    console.error('CLEANUP_ERR', e && e.message);
  }
  await prisma.$disconnect();
}

console.log(fail === 0 ? '\nALL_PASS' : `\nFAILED=${fail}`);
process.exit(fail === 0 ? 0 : 1);
