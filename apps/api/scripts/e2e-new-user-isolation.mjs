// 验证新注册账号的数据隔离与试用期
// 约定：在服务器本地运行（API 监听 127.0.0.1:3000），直接用本机 .env 的 DATABASE_URL。
// 运行：cd apps/api && node scripts/e2e-new-user-isolation.mjs

import fs from 'node:fs';
import path from 'node:path';
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

function daysDiff(a, b) {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60 * 60 * 24));
}

let passed = 0;
let failed = 0;

function check(name, ok, extra = '') {
  if (ok) {
    console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
    failed++;
  }
}

async function main() {
  const stamp = Date.now();
  const email = `test-isolation-${stamp}@example.com`;
  const name = `测试新用户${stamp}`;
  const password = 'password123';

  console.log(`\n🧪 新用户隔离测试: ${email}`);

  // 0. 发送验证码（真实邮件发不出去没关系，我们直接读库拿到 code）
  const sendRes = await jpost('/api/auth/send-code', { email, scene: 'register' });
  check('发送验证码接口可调用', sendRes.status === 200);

  const record = await prisma.emailVerification.findFirst({
    where: { email, scene: 'register', used: false },
    orderBy: { createdAt: 'desc' },
  });
  if (!record) {
    console.log('  ❌ 未找到验证码记录，无法继续');
    process.exit(1);
  }

  // 1. 注册（不填企业名称）
  const regRes = await jpost('/api/auth/register', {
    email,
    password,
    name,
    code: record.code,
  });
  const regJson = await regRes.json();

  if (regRes.status !== 200) {
    console.log('注册失败，无法继续。状态:', regRes.status, regJson);
    process.exit(1);
  }

  const { token, user } = regJson;
  const userId = user.id;
  const companyId = user.companyId;

  // 2. 试用期检查
  check('注册返回体包含 expiresAt', !!user.expiresAt);
  const days = daysDiff(user.expiresAt, new Date());
  check(`新账号试用期为 5 天`, days === 5, `实际 ${days} 天`);

  // 3. 数据隔离检查
  check('新用户没有落入 default-company', companyId !== 'default-company');

  const dbUser = await prisma.user.findUnique({ where: { id: userId }, include: { company: true } });
  check(
    '数据库中公司名包含用户姓名',
    !!dbUser?.company?.name?.includes(name),
    `公司名：${dbUser?.company?.name}`,
  );

  // 4. 报价单列表应为空
  const quotesRes = await jget('/api/quotes', token);
  const quotesJson = await quotesRes.json();
  check('报价单列表接口 200', quotesRes.status === 200);
  check('新用户报价单列表为空', Array.isArray(quotesJson) && quotesJson.length === 0, `实际 ${quotesJson.length} 条`);

  // 5. 客户列表应为空
  const customersRes = await jget('/api/customers', token);
  const customersJson = await customersRes.json();
  check('客户列表接口 200', customersRes.status === 200);
  const customerCount = Array.isArray(customersJson) ? customersJson.length : (customersJson.items || []).length;
  check('新用户客户列表为空', customerCount === 0, `实际 ${customerCount} 条`);

  // 6. 尝试通过 id 猜测访问别人的报价单应 404
  const otherQuote = await prisma.quote.findFirst({ where: { companyId: { not: companyId } } });
  if (otherQuote) {
    const qRes = await jget(`/api/quotes/${otherQuote.id}`, token);
    check('访问其他公司报价单返回 404', qRes.status === 404, `实际 ${qRes.status}`);
  } else {
    console.log('  ⚠️ 没有其他公司报价单可供越权测试');
  }

  // 清理
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.company.delete({ where: { id: companyId } }).catch(() => {});
  await prisma.emailVerification.deleteMany({ where: { email } });

  console.log(`\n结果：通过 ${passed} / 失败 ${failed}`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error('E2E 异常：', e);
  await prisma.$disconnect().catch(() => {});
  process.exit(2);
});
