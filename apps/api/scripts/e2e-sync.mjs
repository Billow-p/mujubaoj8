// 同步功能 E2E（修正版）：材料库按类型初始化 + 配置中心增量同步 + 价格安全补齐
// 说明：会短暂把压铸「钢材单价」清 0 验证补价、把「合金单价」改为 33 验证不覆盖，跑完自动恢复。

import fs from 'node:fs';
import bcrypt from 'bcryptjs';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Za-z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
Object.assign(process.env, env);

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const BASE = 'http://127.0.0.1:3000';
const CO = 'default-company';

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? '  → ' + detail : ''}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? '  → ' + detail : ''}`);
  }
}

const email = `sync_e2e_${Date.now()}@qq.com`;
const pw = 'SyncE2e123456';
await prisma.user.create({
  data: {
    email,
    name: '同步E2E',
    role: 'quoter',
    companyId: CO,
    passwordHash: await bcrypt.hash(pw, 10),
    emailVerified: true,
  },
});

async function api(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null;
  try {
    j = await r.json();
  } catch {
    /* ignore */
  }
  return { status: r.status, j };
}

try {
  const login = await api('POST', '/api/auth/login', { email, password: pw });
  const token = login.j?.token;
  check('登录', !!token, `status=${login.status}`);

  // ========== 1. 材料库按类型初始化 ==========
  console.log('\n[1] 材料库按模具类型初始化');
  const seedRubber = await api('POST', '/api/materials/seed-preset', { moldTypeCodes: ['rubber'] }, token);
  check('按类型(rubber)初始化返回 ok', seedRubber.status === 200 && seedRubber.j?.ok === true,
    `created=${seedRubber.j?.created} total=${seedRubber.j?.total}`);
  check('rubber 相关材料分类共 18 种', seedRubber.j?.total === 18, `total=${seedRubber.j?.total}`);
  const rubMatCount = await prisma.material.count({ where: { companyId: CO, moldTypeId: null, category: '橡胶原料' } });
  check('全局库已含橡胶原料类材料(4种)', rubMatCount === 4, `橡胶原料=${rubMatCount}`);
  const seedAll = await api('POST', '/api/materials/seed-preset', {}, token);
  check('全部初始化（兼容旧行为）', seedAll.status === 200 && seedAll.j?.ok === true, `total=${seedAll.j?.total}`);

  // ========== 2. 配置中心：rubber 增量同步（已存在 → 只补缺失） ==========
  console.log('\n[2] 配置中心按类型同步（rubber）');
  const rubber = await prisma.moldType.findFirst({ where: { companyId: CO, code: 'rubber' } });
  const initRubber = await api('POST', '/api/mold-types/init-preset', { code: 'rubber' }, token);
  check('rubber 单套同步成功', initRubber.status === 200 && (initRubber.j?.created + initRubber.j?.filled) === 1,
    `created=${initRubber.j?.created} filled=${initRubber.j?.filled} addedParams=${initRubber.j?.addedParams} addedItems=${initRubber.j?.addedItems}`);
  const rubParams = await prisma.customParameter.count({ where: { companyId: CO, moldTypeId: rubber.id } });
  const rubItems = await prisma.quoteItem.count({ where: { companyId: CO, moldTypeId: rubber.id } });
  check('rubber 参数 24 个', rubParams === 24, `params=${rubParams}`);
  check('rubber 费用项 18 个', rubItems === 18, `items=${rubItems}`);

  // ========== 3. 压铸增量同步：数量守恒（after = before + added） ==========
  console.log('\n[3] 压铸/双色增量补齐');
  const diecast = await prisma.moldType.findFirst({ where: { companyId: CO, code: 'diecast' } });
  const beforeParams = await prisma.customParameter.count({ where: { companyId: CO, moldTypeId: diecast.id } });
  const beforeItems = await prisma.quoteItem.count({ where: { companyId: CO, moldTypeId: diecast.id } });

  const initDiecast = await api('POST', '/api/mold-types/init-preset', { code: 'diecast' }, token);
  check('压铸增量同步成功', initDiecast.status === 200 && initDiecast.j?.filled === 1,
    `addedParams=${initDiecast.j?.addedParams} addedItems=${initDiecast.j?.addedItems} filledPrices=${initDiecast.j?.filledPrices}`);
  const afterParams = await prisma.customParameter.count({ where: { companyId: CO, moldTypeId: diecast.id } });
  const afterItems = await prisma.quoteItem.count({ where: { companyId: CO, moldTypeId: diecast.id } });
  check('参数数量守恒（after = before + added）',
    afterParams === beforeParams + (initDiecast.j?.addedParams ?? 0),
    `before=${beforeParams} added=${initDiecast.j?.addedParams} after=${afterParams}`);
  check('费用项数量守恒（after = before + added）',
    afterItems === beforeItems + (initDiecast.j?.addedItems ?? 0),
    `before=${beforeItems} added=${initDiecast.j?.addedItems} after=${afterItems}`);
  check('压铸已具备完整主流参数（≥27）', afterParams >= 27, `params=${afterParams}`);
  check('压铸已具备完整主流费用项（≥21）', afterItems >= 21, `items=${afterItems}`);
  // 重复同步幂等：再同步一次不应再增加
  const again = await api('POST', '/api/mold-types/init-preset', { code: 'diecast' }, token);
  const after2 = await prisma.customParameter.count({ where: { companyId: CO, moldTypeId: diecast.id } });
  check('重复同步幂等（不重复添加）', (again.j?.addedParams ?? 0) === 0 && after2 === afterParams,
    `addedParams=${again.j?.addedParams} params=${after2}`);

  // ========== 4. 价格安全规则：只补空/0，不覆盖已设 ==========
  console.log('\n[4] 价格同步安全规则');
  const steelParam = await prisma.customParameter.findFirst({ where: { companyId: CO, moldTypeId: diecast.id, code: 'steelPrice' } });
  const alloyParam = await prisma.customParameter.findFirst({ where: { companyId: CO, moldTypeId: diecast.id, code: 'alloyPrice' } });
  check('压铸存在绑定价格参数', !!steelParam && !!alloyParam, `steelPrice=${steelParam?.defaultValue} alloyPrice=${alloyParam?.defaultValue}`);

  // 4a. 钢材单价清 0 → 同步应从材料库 H13 补回；合金单价改 33 → 必须保持
  await prisma.customParameter.update({ where: { id: steelParam.id }, data: { defaultValue: '0' } });
  await prisma.customParameter.update({ where: { id: alloyParam.id }, data: { defaultValue: '33' } });

  const sync3 = await api('POST', '/api/mold-types/init-preset', { code: 'diecast' }, token);
  const steelAfter = await prisma.customParameter.findUnique({ where: { id: steelParam.id } });
  const alloyAfter = await prisma.customParameter.findUnique({ where: { id: alloyParam.id } });
  const h13 = await prisma.material.findFirst({ where: { companyId: CO, moldTypeId: null, code: 'H13' } });
  check('空价格(0)被从材料库补齐', Number(steelAfter.defaultValue) > 0,
    `steelPrice: 0 → ${steelAfter.defaultValue}`);
  check('补价值 = 材料库 H13 当前价', h13 && Number(steelAfter.defaultValue) === Number(h13.currentPrice),
    `${steelAfter.defaultValue} === ${h13?.currentPrice}`);
  check('已设值(33)不被覆盖', alloyAfter.defaultValue === '33', `alloyPrice=${alloyAfter.defaultValue}`);

  // 4b. 完全清空（''）也要能补
  await prisma.customParameter.update({ where: { id: steelParam.id }, data: { defaultValue: '' } });
  const sync4 = await api('POST', '/api/mold-types/init-preset', { code: 'diecast' }, token);
  const steelAfter2 = await prisma.customParameter.findUnique({ where: { id: steelParam.id } });
  check('空字符串价格也被补齐', Number(steelAfter2.defaultValue) > 0,
    `steelPrice: '' → ${steelAfter2.defaultValue}`);

  // 恢复原值
  await prisma.customParameter.update({ where: { id: steelParam.id }, data: { defaultValue: steelParam.defaultValue } });
  await prisma.customParameter.update({ where: { id: alloyParam.id }, data: { defaultValue: alloyParam.defaultValue } });
  console.log('  （已恢复压铸原价格）');

  // ========== 5. 四套类型试算：总价有限、无致命错误 ==========
  console.log('\n[5] 四套类型试算');
  for (const code of ['injection', 'diecast', 'twocolor', 'rubber']) {
    const mt = await prisma.moldType.findFirst({ where: { companyId: CO, code } });
    const calc = await api('POST', `/api/config/${mt.id}/calc`, {}, token);
    const t = calc.j?.total;
    const errs = (calc.j?.lines ?? []).filter((l) => l.error && !l.skipped);
    check(`${code} 试算 200 且总价有限`, calc.status === 200 && Number.isFinite(t), `total=${Math.round(t ?? 0)}`);
    check(`${code} 无报错费用项`, errs.length === 0, errs.length ? errs.map((e) => e.name + ':' + e.error).join(' | ') : '全部正常');
  }

  // ========== 6. 统一同步（不传 code = 全部） ==========
  console.log('\n[6] 统一同步（全部类型）');
  const syncAll = await api('POST', '/api/mold-types/init-preset', {}, token);
  check('统一同步成功', syncAll.status === 200 && syncAll.j?.ok === true,
    `created=${syncAll.j?.created} filled=${syncAll.j?.filled} 补价=${syncAll.j?.filledPrices}`);
} finally {
  const u = await prisma.user.findUnique({ where: { email } });
  if (u) {
    const qs = await prisma.quote.findMany({ where: { createdById: u.id }, select: { id: true } });
    for (const q of qs) {
      await prisma.quoteLog.deleteMany({ where: { quoteId: q.id } });
      await prisma.quoteShare.deleteMany({ where: { quoteId: q.id } });
      await prisma.quoteVersion.deleteMany({ where: { quoteId: q.id } });
      await prisma.quote.delete({ where: { id: q.id } });
    }
    await prisma.user.delete({ where: { id: u.id } });
  }
  await prisma.$disconnect();
  console.log(`\n清理完成（测试账号已删）。结果：${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}
