// 账号试用 / 过期拦截 / 超管开通 端到端验证
// 约定：在服务器本地运行（API 监听 127.0.0.1:3000），直接用本机 .env 的 DATABASE_URL。
// 运行：cd apps/api && node scripts/e2e-account-expiry.mjs

import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

// ---- 加载 .env ----
const envPath = path.resolve('.env');
const env = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;

const base = process.env.E2E_BASE || 'http://127.0.0.1:3000';
const prisma = new PrismaClient();

const PW = 'password123';
let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
}
const isoDay = (d) => Math.round((d.getTime() - Date.now()) / 86400000);
async function jpost(p, body, token) {
  return fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  });
}
async function jget(p, token) {
  return fetch(base + p, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
}
async function jpatch(p, body, token) {
  return fetch(base + p, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  });
}

const COMPANY = 'e2e-expiry-co';
const EMAILS = {
  exp: 'exp@e2e.local',
  trial: 'trial@e2e.local',
  sa: 'sa@e2e.local',
};

async function main() {
  console.log('==> 准备测试数据');
  await prisma.company.upsert({
    where: { id: COMPANY },
    update: {},
    create: { id: COMPANY, name: 'E2E过期测试企业' },
  });
  const hash = await bcrypt.hash(PW, 10);
  for (const [k, email] of Object.entries(EMAILS)) {
    await prisma.user.deleteMany({ where: { email } });
  }
  const exp = await prisma.user.create({
    data: { email: EMAILS.exp, name: '过期测试', role: 'quoter', companyId: COMPANY, passwordHash: hash, expiresAt: null },
  });
  const trial = await prisma.user.create({
    data: { email: EMAILS.trial, name: '试用测试', role: 'quoter', companyId: COMPANY, passwordHash: hash, expiresAt: new Date(Date.now() + 5 * 86400000) },
  });
  const sa = await prisma.user.create({
    data: { email: EMAILS.sa, name: '超管测试', role: 'admin', companyId: COMPANY, passwordHash: hash, isSuperAdmin: true, expiresAt: null },
  });

  console.log('\n==> 1. 登录拦截（过期账号）');
  // 先拿 exp 的 token（此时未过期），再把其 expiresAt 设为过去，验证中间件拦截
  const lgExp = await jpost('/api/auth/login', { email: EMAILS.exp, password: PW });
  const expToken = (await lgExp.json()).token;
  await prisma.user.update({ where: { id: exp.id }, data: { expiresAt: new Date(Date.now() - 86400000) } });
  const lgExp2 = await jpost('/api/auth/login', { email: EMAILS.exp, password: PW });
  const lgExp2j = await lgExp2.json();
  check('已过期账号登录被拒(403)', lgExp2.status === 403, `code=${lgExp2j.code}`);
  check('登录错误含 ACCOUNT_EXPIRED', lgExp2j.code === 'ACCOUNT_EXPIRED', lgExp2j.error || '');
  const meExp = await jget('/api/auth/me', expToken);
  const meExpj = await meExp.json();
  check('过期 token 调用 /me 被中间件拦截(403)', meExp.status === 403 && meExpj.code === 'ACCOUNT_EXPIRED');

  console.log('\n==> 2. 新注册账号 5 天试用');
  const lgTrial = await jpost('/api/auth/login', { email: EMAILS.trial, password: PW });
  const lgTrialj = await lgTrial.json();
  check('试用账号可登录(200)', lgTrial.status === 200);
  const trialToken = lgTrialj.token;
  check('登录返回 expiresAt ≈ +5 天', lgTrialj.user?.expiresAt && Math.abs(isoDay(new Date(lgTrialj.user.expiresAt)) - 5) <= 1, `剩 ${lgTrialj.user?.expiresAt ? isoDay(new Date(lgTrialj.user.expiresAt)) : '?'} 天`);
  const meTrial = await jget('/api/auth/me', trialToken);
  check('/me 正常返回(200)', meTrial.status === 200);

  console.log('\n==> 3. 超管开通 / 续期');
  const lgSa = await jpost('/api/auth/login', { email: EMAILS.sa, password: PW });
  const saToken = (await lgSa.json()).token;
  check('超管可登录(200)', lgSa.status === 200);

  const p1 = await jpatch(`/api/platform/users/${trial.id}`, { extendDays: 30 }, saToken);
  const p1j = await p1.json();
  check('PATCH extendDays=30 成功(200)', p1.status === 200, p1j.error || '');
  check('开通后 expiresAt ≈ +30 天', p1j.expiresAt && Math.abs(isoDay(new Date(p1j.expiresAt)) - 30) <= 1, `剩 ${p1j.expiresAt ? isoDay(new Date(p1j.expiresAt)) : '?'} 天`);
  const lgTrial2 = await jpost('/api/auth/login', { email: EMAILS.trial, password: PW });
  check('续期后登录正常(200)', lgTrial2.status === 200);

  const p2 = await jpatch(`/api/platform/users/${trial.id}`, { expiresAt: null }, saToken);
  const p2j = await p2.json();
  check('PATCH expiresAt=null 设为永久(200)', p2.status === 200 && p2j.expiresAt === null);
  const lgTrial3 = await jpost('/api/auth/login', { email: EMAILS.trial, password: PW });
  check('永久有效账号登录正常(200)', lgTrial3.status === 200);

  const past = new Date(Date.now() - 86400000).toISOString();
  const p3 = await jpatch(`/api/platform/users/${trial.id}`, { expiresAt: past }, saToken);
  check('PATCH 自定义过去时间成功(200)', p3.status === 200);
  const lgTrial4 = await jpost('/api/auth/login', { email: EMAILS.trial, password: PW });
  check('被设为过期后登录被拒(403)', lgTrial4.status === 403);

  console.log('\n==> 4. 非超管越权保护');
  const pNoAuth = await jpatch(`/api/platform/users/${trial.id}`, { extendDays: 30 }, trialToken);
  check('普通报价员无法调用平台接口(403)', pNoAuth.status === 403);

  console.log('\n==> 清理测试数据');
  await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });
  await prisma.company.delete({ where: { id: COMPANY } }).catch(() => {});
  await prisma.$disconnect();

  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('E2E 异常：', e);
  await prisma.$disconnect().catch(() => {});
  process.exit(2);
});
