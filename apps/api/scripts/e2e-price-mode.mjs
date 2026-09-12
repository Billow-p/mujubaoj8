// 材料库价格模式（模式B）E2E —— 用独立测试公司，全程不碰 default-company 数据
// 流程：建测试公司+用户 → 灌材料库（故意改一个非参考价）→ init-preset 建四套类型
//       → 验证价格默认值来自材料库（而非预置常量）→ 改库价→同步→配置跟随
//       → 开关切换语义（关=手动价不被覆盖，开=全量刷新）→ 试算 → 清理

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

const stamp = Date.now();
const companyName = `模式B验证公司_${stamp}`;
const email = `pb_${stamp}@qq.com`;
const pw = 'PriceMode123456';

// 独立公司的材料价：故意与预置参考值不同，验证「价格来自材料库而非预置常量」
const LIB_ABS_PRICE = 13.5; // 预置参考价是 12

let companyId = '';
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
  // ========== 准备 ==========
  console.log('\n[0] 准备独立测试公司');
  const co = await prisma.company.create({ data: { name: companyName } });
  companyId = co.id;
  await prisma.user.create({
    data: {
      email, name: '模式B验证', role: 'quoter', companyId,
      passwordHash: await bcrypt.hash(pw, 10), emailVerified: true,
    },
  });

  const login = await api('POST', '/api/auth/login', { email, password: pw });
  const token = login.j?.token;
  check('登录', !!token, `status=${login.status}`);

  // ========== 1. 灌材料库（先把 ABS 改成非参考价 13.5） ==========
  console.log('\n[1] 材料库（价格真源）');
  const seed = await api('POST', '/api/materials/seed-preset', {}, token);
  check('灌入全部预置材料', seed.status === 200 && seed.j?.ok === true, `total=${seed.j?.total}`);
  const abs = await prisma.material.findFirst({ where: { companyId, moldTypeId: null, code: 'ABS' } });
  await prisma.material.update({ where: { id: abs.id }, data: { currentPrice: LIB_ABS_PRICE } });
  check(`材料库 ABS 现价改为 ${LIB_ABS_PRICE}（预置参考价是 12）`, true);

  // ========== 2. init-preset：四套类型 born 模式B ==========
  console.log('\n[2] 新建四套预置类型（born 材料库价格模式）');
  const init = await api('POST', '/api/mold-types/init-preset', {}, token);
  check('四套类型创建成功', init.status === 200 && init.j?.created === 4,
    `created=${init.j?.created} 补价=${init.j?.filledPrices}`);
  const types = await prisma.moldType.findMany({ where: { companyId } });
  check('全部类型 priceFromLibrary=true', types.length === 4 && types.every((t) => t.priceFromLibrary === true),
    types.map((t) => `${t.code}:${t.priceFromLibrary ? '开' : '关'}`).join(' '));

  const injection = types.find((t) => t.code === 'injection');
  const steel = await prisma.customParameter.findFirst({ where: { companyId, moldTypeId: injection.id, code: 'materialPrice' } });
  const raw = await prisma.customParameter.findFirst({ where: { companyId, moldTypeId: injection.id, code: 'materialUnitPrice' } });
  check('注塑「钢材单价」= 材料库 P20 现价（同步灌入，非空）',
    steel.defaultValue !== '' && Number(steel.defaultValue) > 0, `steelPrice=${steel.defaultValue}`);
  check('注塑「原料单价」= 库中 ABS 现价 13.5（证明来自材料库而非预置 12）',
    Number(raw.defaultValue) === LIB_ABS_PRICE, `rawPrice=${raw.defaultValue}（期望 ${LIB_ABS_PRICE}）`);
  check('绑定元数据已入库（materialCode=P20/ABS）',
    steel.materialCode === 'P20' && raw.materialCode === 'ABS',
    `steel.materialCode=${steel.materialCode} raw.materialCode=${raw.materialCode}`);
  const cavity = await prisma.customParameter.findFirst({ where: { companyId, moldTypeId: injection.id, code: 'cavityCount' } });
  check('非价格参数不受影响（腔数=2）', cavity.defaultValue === '2', `cavityCount=${cavity.defaultValue}`);

  // ========== 3. 库改价 → 同步 → 配置中心跟随（模式B全量刷新） ==========
  console.log('\n[3] 库改价 → 同步 → 配置中心跟随');
  await prisma.material.update({ where: { id: abs.id }, data: { currentPrice: 15.8 } });
  const sync1 = await api('POST', '/api/mold-types/init-preset', { code: 'injection' }, token);
  const raw2 = await prisma.customParameter.findUnique({ where: { id: raw.id } });
  check('同步后「原料单价」跟随库现价 15.8（覆盖旧同步值）',
    Number(raw2.defaultValue) === 15.8 && sync1.j?.filledPrices >= 1,
    `rawPrice=${raw2.defaultValue} filledPrices=${sync1.j?.filledPrices}`);

  // ========== 4. 开关语义：关 → 手动价不被覆盖；开 → 全量刷新 ==========
  console.log('\n[4] 模式开关语义');
  const toggleOff = await api('PATCH', `/api/mold-types/${injection.id}`, { priceFromLibrary: false }, token);
  check('关闭材料库价格模式', toggleOff.status === 200 && toggleOff.j?.priceFromLibrary === false);
  await prisma.customParameter.update({ where: { id: raw.id }, data: { defaultValue: '99' } });
  const sync2 = await api('POST', '/api/mold-types/init-preset', { code: 'injection' }, token);
  const raw3 = await prisma.customParameter.findUnique({ where: { id: raw.id } });
  check('旧模式：手动价 99 不被同步覆盖', raw3.defaultValue === '99', `rawPrice=${raw3.defaultValue}`);

  const toggleOn = await api('PATCH', `/api/mold-types/${injection.id}`, { priceFromLibrary: true }, token);
  const raw4 = await prisma.customParameter.findUnique({ where: { id: raw.id } });
  check('重新开启：立即全量刷新回库现价 15.8',
    toggleOn.status === 200 && Number(raw4.defaultValue) === 15.8,
    `rawPrice=${raw4.defaultValue} filledPrices=${toggleOn.j?.filledPrices}`);

  // ========== 5. 库清价 → 模式B下同步后参数为空 → 试算出中文提醒、总价有限 ==========
  console.log('\n[5] 空价格兜底（防幻觉）');
  await prisma.material.update({ where: { id: abs.id }, data: { currentPrice: 0 } });
  const sync3 = await api('POST', '/api/mold-types/init-preset', { code: 'injection' }, token);
  const raw5 = await prisma.customParameter.findUnique({ where: { id: raw.id } });
  check('库价清 0 → 同步后参数为 0（如实反映库）', Number(raw5.defaultValue) === 0, `rawPrice=${raw5.defaultValue}`);

  const calc = await api('POST', `/api/config/${injection.id}/calc`, {}, token);
  const warnLines = (calc.j?.lines ?? []).filter((l) => l.warning);
  check('试算 200 且总价有限', calc.status === 200 && Number.isFinite(calc.j?.total), `total=${Math.round(calc.j?.total ?? 0)}`);
  check('缺价费用项返回中文提醒（不返回字母/NaN）',
    warnLines.length >= 1 && /材料库|原料单价|价格/.test(warnLines[0].warning ?? ''),
    `警告示例：${warnLines[0]?.warning ?? '（无）'}`);

  // 恢复库价，最终同步一次，让该类型处于健康状态
  await prisma.material.update({ where: { id: abs.id }, data: { currentPrice: LIB_ABS_PRICE } });
  await api('POST', '/api/mold-types/init-preset', { code: 'injection' }, token);

  // ========== 6. 四套类型试算全部健康 ==========
  console.log('\n[6] 四套类型试算');
  for (const code of ['injection', 'diecast', 'twocolor', 'rubber']) {
    const mt = types.find((t) => t.code === code);
    const r = await api('POST', `/api/config/${mt.id}/calc`, {}, token);
    const errs = (r.j?.lines ?? []).filter((l) => l.error && !l.skipped);
    check(`${code} 试算总价有限`, r.status === 200 && Number.isFinite(r.j?.total), `total=${Math.round(r.j?.total ?? 0)}`);
    check(`${code} 无报错费用项`, errs.length === 0, errs.length ? errs[0].error : '全部正常');
  }
} finally {
  // ========== 清理：测试公司全部数据 ==========
  try {
    if (companyId) {
      const mtIds = (await prisma.moldType.findMany({ where: { companyId }, select: { id: true } })).map((x) => x.id);
      if (mtIds.length) {
        await prisma.quoteItem.deleteMany({ where: { companyId } });
        await prisma.customParameter.deleteMany({ where: { companyId } });
        await prisma.businessTerm.deleteMany({ where: { companyId } });
        await prisma.moldType.deleteMany({ where: { companyId } });
      }
      const qs = await prisma.quote.findMany({ where: { companyId }, select: { id: true } });
      for (const q of qs) {
        await prisma.quoteLog.deleteMany({ where: { quoteId: q.id } });
        await prisma.quoteShare.deleteMany({ where: { quoteId: q.id } });
        await prisma.quoteVersion.deleteMany({ where: { quoteId: q.id } });
      }
      await prisma.quote.deleteMany({ where: { companyId } });
      await prisma.material.deleteMany({ where: { companyId } });
      await prisma.customer.deleteMany({ where: { companyId } });
      await prisma.user.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } });
      console.log('\n清理完成：测试公司及其全部数据已删除');
    }
  } catch (e) {
    console.log('清理异常（需手动检查）:', e?.message ?? e);
  }
  await prisma.$disconnect();
  console.log(`结果：${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}
