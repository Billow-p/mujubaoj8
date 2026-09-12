// 全流程端到端：登录 → 配置报价（全量/缺变量/缺价格/缺数据）→ 导出Excel → 发邮件 → 客户端查看 → 旧模型校验
// 目标：证明「缺参数/缺数据/缺价格」时系统返回中文提示（不 500、不字母、不 NaN），合计仍可算。
// 结束清理全部测试数据。

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 加载同目录 .env（服务器 / 本地均可独立运行，不依赖外部注入 DATABASE_URL）
const __here = path.dirname(fileURLToPath(import.meta.url));
const __envPath = path.join(__here, '.env');
if (fs.existsSync(__envPath)) {
  for (const line of fs.readFileSync(__envPath, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) {
      const k = m[1];
      const v = m[2].replace(/^["']|["']$/g, '');
      if (!(k in process.env)) process.env[k] = v;
    }
  }
}

const prisma = new PrismaClient();
const COMPANY = 'default-company';
const base = 'http://127.0.0.1:3000';
const password = 'FlowE2E#2026';
const ts = Date.now();
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${extra ? ' :: ' + extra : ''}`);
  if (!ok) fail++;
};
const near = (a, b, eps = 0.02) => Math.abs(Number(a) - Number(b)) <= eps;
const isFiniteNum = (x) => typeof x === 'number' && Number.isFinite(x);

let token = '';
const created = { userIds: [], quoteIds: [], customerNames: [], shareTokens: [] };

async function api(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let j = null;
  try { j = await r.json(); } catch { /* 空响应 */ }
  return { status: r.status, body: j, headers: r.headers };
}

const lineOf = (result, name) => (result?.lines ?? []).find((l) => l.name === name);

try {
  const moldType = await prisma.moldType.findFirst({
    where: { companyId: COMPANY, code: 'injection' },
    select: { id: true },
  });
  if (!moldType) throw new Error('找不到注塑模具类型');

  // ---- 登录 ----
  const hash = await bcrypt.hash(password, 10);
  const email = `flow_e2e_${ts}@example.com`;
  const u = await prisma.user.create({
    data: { email, name: '全流程冒烟', role: 'quoter', companyId: COMPANY, passwordHash: hash, emailVerified: true },
  });
  created.userIds.push(u.id);
  const lg = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const lgj = await lg.json();
  check('登录成功', !!lgj.token, 'status=' + lg.status);
  token = lgj.token;

  const commonFull = { profitRate: 0.15, taxRate: 0.13, params: {
    腔数: 2, 钢材单价: 8, 钢材密度: 7.85, 运费单价: 1.2, 运输区域: 1,
    运输箱长: 40, 运输箱宽: 30, 运输箱高: 20,
  } };
  const moldFull = { 模芯长: 500, 模芯宽: 400, 模芯高: 150, 模具重量: 800, 模架规格: 8600,
    热流道点数: 0, EDM工时: 0, 线切割长度: 0, 抛光工时: 0 };
  const partFull = { 单件重量: 0.18, 原料单价: 12, 原料损耗率: 0.05, 机台时薪: 130, 成型周期: 30 };

  // ===== 场景 1：全量报价（无缺漏） =====
  const c1 = `全量报价_${ts}`;
  created.customerNames.push(c1);
  const r1 = await api('POST', '/api/quotes/project', {
    moldTypeId: moldType.id, customerName: c1,
    common: commonFull,
    molds: [{ name: 'A模', params: { ...moldFull } }],
    parts: [{ name: '件1', qty: 5000, params: { ...partFull } }],
  });
  check('场景1 全量报价 200', r1.status === 200, 'status=' + r1.status + ' ' + (r1.body?.error ?? ''));
  const calc1 = r1.body?.versions?.[0]?.calcResultJson ?? {};
  if (r1.body?.id) created.quoteIds.push(r1.body.id);
  const m1 = calc1.moldResults?.[0] ?? {};
  const p1 = calc1.partResults?.[0] ?? {};
  const moldBase1 = lineOf(m1, '模架费');
  const machine1 = lineOf(p1, '机台费');
  const mat1 = lineOf(p1, '产品材料费');
  check('场景1 模架费=8600', near(moldBase1?.value, 8600), 'value=' + moldBase1?.value);
  check('场景1 机台费单件≈0.54', near(machine1?.unitPrice, 0.54, 0.01), 'unit=' + machine1?.unitPrice);
  check('场景1 产品材料费单件≈2.27', near(mat1?.unitPrice, 2.268, 0.01), 'unit=' + mat1?.unitPrice);
  check('场景1 无 error 行', !(m1.lines ?? []).some((l) => l.error) && !(p1.lines ?? []).some((l) => l.error),
    'moldErr=' + JSON.stringify((m1.lines ?? []).filter((l) => l.error).map((l) => l.name)));
  check('场景1 无 warning 行', !(m1.lines ?? []).some((l) => l.warning) && !(p1.lines ?? []).some((l) => l.warning),
    'moldWarn=' + JSON.stringify((m1.lines ?? []).filter((l) => l.warning).map((l) => l.name)));
  check('场景1 含税总价有限>0', isFiniteNum(calc1.total) && calc1.total > 0, 'total=' + calc1.total);

  // ===== 场景 2：缺变量（不传 模架规格 / 热流道点数） =====
  const c2 = `缺变量_${ts}`;
  created.customerNames.push(c2);
  const r2 = await api('POST', '/api/quotes/project', {
    moldTypeId: moldType.id, customerName: c2,
    common: commonFull,
    molds: [{ name: 'A模', params: { 模芯长: 500, 模芯宽: 400, 模芯高: 150, 模具重量: 800 } }],
    parts: [{ name: '件1', qty: 5000, params: { ...partFull } }],
  });
  check('场景2 缺变量 仍 200（不崩溃）', r2.status === 200, 'status=' + r2.status + ' ' + (r2.body?.error ?? ''));
  const calc2 = r2.body?.versions?.[0]?.calcResultJson ?? {};
  if (r2.body?.id) created.quoteIds.push(r2.body.id);
  const m2 = calc2.moldResults?.[0] ?? {};
  const mb2 = lineOf(m2, '模架费');
  const hr2 = lineOf(m2, '热流道费');
  check('场景2 模架费 返回中文错误（非字母）', !!mb2?.error && /[一-鿿]/.test(mb2.error), 'err=' + mb2?.error);
  check('场景2 热流道费 返回中文错误', !!hr2?.error && /[一-鿿]/.test(hr2.error), 'err=' + hr2?.error);
  check('场景2 其余项仍算价、总价有限', isFiniteNum(calc2.total) && calc2.total >= 0, 'total=' + calc2.total);
  check('场景2 错误项值=0', mb2?.value === 0 && hr2?.value === 0, 'mb=' + mb2?.value + ' hr=' + hr2?.value);

  // ===== 场景 3：缺价格（原料单价=0） =====
  const c3 = `缺价格_${ts}`;
  created.customerNames.push(c3);
  const r3 = await api('POST', '/api/quotes/project', {
    moldTypeId: moldType.id, customerName: c3,
    common: commonFull,
    molds: [{ name: 'A模', params: { ...moldFull } }],
    parts: [{ name: '件1', qty: 5000, params: { ...partFull, 原料单价: 0 } }],
  });
  check('场景3 缺价格 仍 200', r3.status === 200, 'status=' + r3.status + ' ' + (r3.body?.error ?? ''));
  const calc3 = r3.body?.versions?.[0]?.calcResultJson ?? {};
  if (r3.body?.id) created.quoteIds.push(r3.body.id);
  const p3 = calc3.partResults?.[0] ?? {};
  const mat3 = lineOf(p3, '产品材料费');
  check('场景3 产品材料费 返回中文 warning（提示补充价格）',
    !!mat3?.warning && /原料单价/.test(mat3.warning) && /[一-鿿]/.test(mat3.warning), 'warn=' + mat3?.warning);
  check('场景3 产品材料费 按 0 计入', mat3?.value === 0, 'value=' + mat3?.value);
  check('场景3 总价有限（非 NaN）', isFiniteNum(calc3.total) && calc3.total >= 0, 'total=' + calc3.total);

  // ===== 场景 4：缺数据（模芯长=0） =====
  const c4 = `缺数据_${ts}`;
  created.customerNames.push(c4);
  const r4 = await api('POST', '/api/quotes/project', {
    moldTypeId: moldType.id, customerName: c4,
    common: commonFull,
    molds: [{ name: 'A模', params: { 模芯长: 0, 模芯宽: 400, 模芯高: 150, 模具重量: 800, 模架规格: 8600 } }],
    parts: [{ name: '件1', qty: 5000, params: { ...partFull } }],
  });
  check('场景4 缺数据 仍 200', r4.status === 200, 'status=' + r4.status + ' ' + (r4.body?.error ?? ''));
  const calc4 = r4.body?.versions?.[0]?.calcResultJson ?? {};
  if (r4.body?.id) created.quoteIds.push(r4.body.id);
  const m4 = calc4.moldResults?.[0] ?? {};
  const steel4 = lineOf(m4, '模芯钢材费');
  check('场景4 模芯钢材费 因长=0 算 0（合理，非崩溃）', steel4?.value === 0, 'value=' + steel4?.value);
  check('场景4 总价有限', isFiniteNum(calc4.total) && calc4.total >= 0, 'total=' + calc4.total);

  // ===== 场景 5：导出 Excel =====
  const qid = r1.body?.id;
  const r5b = await fetch(base + `/api/quotes/${qid}/export-excel`, {
    headers: { authorization: 'Bearer ' + token },
  });
  const ab = await r5b.arrayBuffer();
  const ct = r5b.headers.get('content-type') || '';
  check('场景5 导出Excel 200', r5b.status === 200, 'status=' + r5b.status);
  check('场景5 是 xlsx', /spreadsheetml/.test(ct), 'ct=' + ct);
  check('场景5 文件非空', ab.byteLength > 1000, 'bytes=' + ab.byteLength);

  // ===== 场景 6：发送邮件 + 生成分享链接 =====
  const r6 = await api('POST', `/api/quotes/${qid}/send`, { email: '729503962@qq.com', sendEmail: true });
  check('场景6 发送返回分享链接', !!r6.body?.shareUrl || !!r6.body?.shareToken, 'status=' + r6.status + ' ' + JSON.stringify(r6.body?.emailError || r6.body?.error || ''));
  if (r6.body?.shareToken) created.shareTokens.push(r6.body.shareToken);
  check('场景6 邮件成功发出（SMTP 已配）', r6.body?.emailSent === true, 'emailError=' + (r6.body?.emailError || ''));
  const token6 = r6.body?.shareToken;

  // ===== 场景 7：客户端免登录查看分享页 =====
  if (token6) {
    const r7 = await fetch(base + `/api/share/${token6}`);
    const j7 = await r7.json().catch(() => null);
    check('场景7 客户端查看 200', r7.status === 200, 'status=' + r7.status);
    check('场景7 返回汇总（含税总计）', isFiniteNum(j7?.summary?.totalIncVat), 'total=' + j7?.summary?.totalIncVat);
    check('场景7 返回产品规格', Array.isArray(j7?.specs) && j7.specs.length > 0, 'specs=' + (j7?.specs?.length ?? 0));
  }

  // ===== 场景 8：旧模型 /api/calc/quote 缺必填 → 中文校验（400，非 500） =====
  const r8 = await api('POST', '/api/calc/quote', { input: { material: 'ABS' } });
  check('场景8 旧模型缺必填 400', r8.status === 400, 'status=' + r8.status);
  check('场景8 返回中文 validationErrors', Array.isArray(r8.body?.validationErrors) && r8.body.validationErrors.length > 0 && /[一-鿿]/.test(JSON.stringify(r8.body.validationErrors)),
    'errs=' + JSON.stringify(r8.body?.validationErrors ?? '').slice(0, 120));

  // ===== 场景 9：确认分享（客户端动作） =====
  if (token6) {
    const r9 = await fetch(base + `/api/share/${token6}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    check('场景9 客户端确认成功', r9.status === 200, 'status=' + r9.status);
  }
} catch (e) {
  console.log('FATAL - ' + (e?.stack || e?.message || e));
  fail++;
} finally {
  try {
    for (const t of created.shareTokens) await prisma.quoteShare.deleteMany({ where: { shareToken: t } });
    for (const id of created.quoteIds) {
      await prisma.quoteVersion.deleteMany({ where: { quoteId: id } });
      await prisma.quoteShare.deleteMany({ where: { quoteId: id } });
      await prisma.quoteEmailLog.deleteMany({ where: { quoteId: id } });
      await prisma.quote.delete({ where: { id } }).catch(() => {});
    }
    for (const n of created.customerNames) await prisma.customer.deleteMany({ where: { companyId: COMPANY, name: n } });
    for (const id of created.userIds) await prisma.user.delete({ where: { id } }).catch(() => {});
    console.log('已清理测试数据');
  } catch (e) {
    console.log('清理失败（可手动删）：' + (e?.message || e));
  }
  await prisma.$disconnect();
  console.log(`\n结果：${fail === 0 ? '全部通过 ✅' : fail + ' 项失败 ❌'}`);
  process.exit(fail === 0 ? 0 : 1);
}
