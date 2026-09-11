// 平台管理端到端冒烟测试（生产服务器上运行）
// 覆盖：超管可访问 /api/platform/*；普通用户被 403 拒绝；测试账号用完即删。

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const COMPANY = 'default-company';
const base = 'http://127.0.0.1:3000';
const ts = Date.now();
const password = 'SmokeTest#2026';
let fail = 0;

const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${extra ? ' :: ' + extra : ''}`);
  if (!ok) fail++;
};

async function login(email) {
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  return j.token;
}

let superId = null;
let plainId = null;

try {
  const hash = await bcrypt.hash(password, 10);

  const su = await prisma.user.create({
    data: {
      email: `plat_super_${ts}@example.com`,
      name: '平台超管冒烟',
      role: 'admin',
      isSuperAdmin: true,
      companyId: COMPANY,
      passwordHash: hash,
      emailVerified: true,
    },
  });
  superId = su.id;

  const pl = await prisma.user.create({
    data: {
      email: `plat_plain_${ts}@example.com`,
      name: '普通用户冒烟',
      role: 'quoter',
      isSuperAdmin: false,
      companyId: COMPANY,
      passwordHash: hash,
      emailVerified: true,
    },
  });
  plainId = pl.id;

  // --- 超管登录 ---
  const suToken = await login(su.email);
  check('超管登录拿到 token', !!suToken);
  const auth = { 'content-type': 'application/json', authorization: 'Bearer ' + suToken };

  // --- 1. 概览 ---
  const r1 = await fetch(base + '/api/platform/overview', { headers: auth });
  const o1 = await r1.json();
  check('GET /api/platform/overview = 200', r1.status === 200, 'status=' + r1.status);
  check('概览含 counts.users', typeof o1?.counts?.users === 'number', JSON.stringify(o1?.counts));
  check('概览含 byRole', Array.isArray(o1?.byRole), 'roles=' + (o1?.byRole?.length ?? 0));
  check('概览含 companies', Array.isArray(o1?.companies), 'companies=' + (o1?.companies?.length ?? 0));

  // --- 2. 跨租户用户列表 + 搜索 ---
  const r2 = await fetch(base + '/api/platform/users?page=1&pageSize=50', { headers: auth });
  const o2 = await r2.json();
  check('GET /api/platform/users = 200', r2.status === 200, 'status=' + r2.status);
  check('用户列表含刚建的超管', (o2?.items ?? []).some((u) => u.id === su.id));
  check('用户条目带 company 与 stats', !!(o2?.items?.[0]?.company && o2?.items?.[0]?.stats));
  check('total >= 6', (o2?.total ?? 0) >= 6, 'total=' + o2?.total);

  const r2b = await fetch(base + '/api/platform/users?keyword=' + encodeURIComponent(`plat_super_${ts}`), {
    headers: auth,
  });
  const o2b = await r2b.json();
  check('关键词搜索命中 1 条', o2b?.total === 1, 'total=' + o2b?.total);

  // --- 3. 公司列表 ---
  const r3 = await fetch(base + '/api/platform/companies', { headers: auth });
  const o3 = await r3.json();
  check('GET /api/platform/companies = 200', r3.status === 200, 'status=' + r3.status);
  check('公司列表非空且含 default-company', Array.isArray(o3) && o3.some((c) => c.id === COMPANY));

  // --- 4. 修改角色 ---
  const r4 = await fetch(base + '/api/platform/users/' + plainId, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ role: 'auditor' }),
  });
  const o4 = await r4.json();
  check('PATCH 改角色 = 200 且 role=auditor', r4.status === 200 && o4?.role === 'auditor', JSON.stringify(o4));

  // --- 5. 自锁保护 ---
  const r5 = await fetch(base + '/api/platform/users/' + superId, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ isSuperAdmin: false }),
  });
  check('取消自己的超管被拒绝(400)', r5.status === 400, 'status=' + r5.status);

  // --- 6. 普通用户被拒 ---
  const plToken = await login(pl.email);
  const plainAuth = { 'content-type': 'application/json', authorization: 'Bearer ' + plToken };
  const r6 = await fetch(base + '/api/platform/users', { headers: plainAuth });
  check('普通用户访问 /api/platform/users = 403', r6.status === 403, 'status=' + r6.status);

  // --- 7. 未登录被拒 ---
  const r7 = await fetch(base + '/api/platform/users');
  check('未登录访问 = 401', r7.status === 401, 'status=' + r7.status);
} catch (e) {
  console.error('ERR', e && e.message);
  fail++;
} finally {
  try {
    if (superId) await prisma.user.delete({ where: { id: superId } });
    if (plainId) await prisma.user.delete({ where: { id: plainId } });
    console.log('CLEANUP_DONE');
  } catch (e) {
    console.error('CLEANUP_ERR', e && e.message);
  }
  await prisma.$disconnect();
}

console.log(fail === 0 ? '\nALL_PASS' : `\nFAILED=${fail}`);
process.exit(fail === 0 ? 0 : 1);
