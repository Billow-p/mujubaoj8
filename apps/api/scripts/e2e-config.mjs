// 配置中心端到端测试（本地嵌入式 PostgreSQL）
// 运行：node apps/api/scripts/e2e-config.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, '..');

const envPath = path.join(apiDir, '.env');
const fileEnv = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) fileEnv[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
Object.assign(process.env, fileEnv);
const PORT = Number(fileEnv.PORT || 4799);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const failures = [];
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  \u2713 ${name}${extra ? ` — ${extra}` : ''}`); }
  else { fail++; failures.push(name); console.log(`  \u2717 ${name}${extra ? ` — ${extra}` : ''}`); }
};

async function req(method, p, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await resp.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* keep */ }
  return { status: resp.status, data };
}

async function seed() {
  const prisma = new PrismaClient();
  await prisma.$connect();
  await prisma.quoteAdjustment.deleteMany({});
  await prisma.quoteVersion.deleteMany({});
  await prisma.quoteLog.deleteMany({});
  await prisma.quoteEmailLog.deleteMany({});
  await prisma.quoteShare.deleteMany({});
  await prisma.quote.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.quoteItem.deleteMany({});
  await prisma.businessTerm.deleteMany({});
  await prisma.materialPrice.deleteMany({});
  await prisma.material.deleteMany({});
  await prisma.customParameter.deleteMany({});
  await prisma.moldType.deleteMany({});
  await prisma.customFormula.deleteMany({});
  await prisma.quoteTemplate.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.company.deleteMany({});

  const c1 = await prisma.company.create({ data: { name: '配置测试企业' } });
  await prisma.user.create({
    data: { companyId: c1.id, email: 'cfg@mqs.local', passwordHash: bcrypt.hashSync('password123', 10), name: '配置员', role: 'admin', emailVerified: true },
  });
  const c2 = await prisma.company.create({ data: { name: '隔离企业' } });
  await prisma.user.create({
    data: { companyId: c2.id, email: 'other2@mqs.local', passwordHash: bcrypt.hashSync('password123', 10), name: '隔离用户', role: 'admin', emailVerified: true },
  });
  await prisma.$disconnect();
}

async function waitApi(ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return true; } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  console.log('\n===== 配置中心端到端测试 =====');
  console.log('[准备] 初始化数据');
  await seed();
  const api = spawn(process.execPath, ['dist/index.js'], {
    cwd: apiDir,
    env: { ...process.env, LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stderr.on('data', (d) => process.stderr.write(`  [api:err] ${d}`));
  const up = await waitApi();
  check('API 启动', up);
  if (!up) { api.kill(); process.exit(1); }

  try {
    const login = await req('POST', '/api/auth/login', { email: 'cfg@mqs.local', password: 'password123' });
    const token = login.data?.token;
    check('登录成功', !!token);

    // ---------- 1 预置初始化 ----------
    console.log('\n[1] 初始化预置模具类型');
    const init = await req('POST', '/api/mold-types/init-preset', {}, token);
    check('初始化三套预置', init.status === 200 && init.data.created === 3, `创建 ${init.data.created} 套`);
    const types = await req('GET', '/api/mold-types', undefined, token);
    check('模具类型列表', types.status === 200 && types.data.length === 3);
    console.log('        类型：' + types.data.map((t) => `${t.name}(${t.counts.items}项费用)`).join('、'));
    const injection = types.data.find((t) => t.code === 'injection');
    check('注塑含 5 项费用', injection?.counts.items === 5, `${injection?.counts.items}`);
    check('注塑含 8 项参数', injection?.counts.parameters === 8, `${injection?.counts.parameters}`);

    // ---------- 2 读配置 ----------
    console.log('\n[2] 读取整类配置');
    const cfg = await req('GET', `/api/config/${injection.id}`, undefined, token);
    check('配置可读', cfg.status === 200 && !!cfg.data.moldType);
    check('含参数', cfg.data.parameters.length === 8, `${cfg.data.parameters.length} 项`);
    check('含材料', cfg.data.materials.length === 5, `${cfg.data.materials.length} 种`);
    check('含条款', cfg.data.terms.length === 3, `${cfg.data.terms.length} 条`);
    check('含费用项', cfg.data.items.length === 5, `${cfg.data.items.length} 项`);

    // ---------- 3 试算 ----------
    console.log('\n[3] 按配置试算');
    const calc = await req('POST', `/api/config/${injection.id}/calc`, {}, token);
    check('试算成功', calc.status === 200);
    const line = (n) => calc.data.lines.find((l) => l.name === n);
    check('模芯钢材费 = 5887.5', line('模芯钢材费')?.value === 5887.5, String(line('模芯钢材费')?.value));
    check('CNC 加工费 = 38400', line('CNC 加工费')?.value === 38400);
    check('设计费 = 6000', line('设计费')?.value === 6000);
    check('试模费 = 5000', line('试模费')?.value === 5000);
    const sub = 5887.5 + 38400 + 6000 + 5000;
    check('管理费 = 小计 × 15%', line('管理费')?.value === Math.round(sub * 0.15), String(line('管理费')?.value));
    check('模具合计', calc.data.mold === sub + Math.round(sub * 0.15), String(calc.data.mold));
    check('含税总价 > 0', calc.data.total > 0, String(calc.data.total));
    check('中文读法可用', !!line('模芯钢材费')?.readable, line('模芯钢材费')?.readable);

    // ---------- 4 改参数值即时反映 ----------
    console.log('\n[4] 改参数值即时重算');
    const calc2 = await req('POST', `/api/config/${injection.id}/calc`, { params: { 腔数: 4 } }, token);
    check('腔数改 4 后试模费翻倍', calc2.data.lines.find((l) => l.name === '试模费')?.value === 10000);

    // ---------- 5 管理费改固定金额（用户可手动调整） ----------
    console.log('\n[5] 管理费改成固定金额');
    const items = cfg.data.items.map((it) =>
      it.name === '管理费'
        ? { id: it.id, name: it.name, category: it.category, scope: it.scope, calcType: 'fixed', calcConfig: { amount: 8000 }, enabled: true }
        : { id: it.id, name: it.name, category: it.category, scope: it.scope, calcType: it.calcType, calcConfig: it.calcConfig, expression: it.expression, enabled: it.enabled },
    );
    const save1 = await req('PUT', `/api/config/${injection.id}`, { items }, token);
    check('保存成功', save1.status === 200);
    const after1 = await req('POST', `/api/config/${injection.id}/calc`, {}, token);
    check('管理费变为固定 8000', after1.data.lines.find((l) => l.name === '管理费')?.value === 8000);
    check('模具合计随之变化', after1.data.mold === sub + 8000, String(after1.data.mold));

    // ---------- 6 新增参数 + 费用项 ----------
    console.log('\n[6] 新增参数并用它建费用项');
    const cfgNow = await req('GET', `/api/config/${injection.id}`, undefined, token);
    const save2 = await req('PUT', `/api/config/${injection.id}`, {
      parameters: [
        ...cfgNow.data.parameters.map((p) => ({ id: p.id, code: p.code, name: p.name, unit: p.unit, defaultValue: p.defaultValue, group: p.group, enabled: true })),
        { code: 'hotRunnerPoints', name: '热流道点数', unit: '点', defaultValue: '8', group: '模具', enabled: true },
      ],
      items: [
        ...cfgNow.data.items.map((it) => ({ id: it.id, name: it.name, category: it.category, scope: it.scope, calcType: it.calcType, calcConfig: it.calcConfig, enabled: it.enabled })),
        { name: '热流道费', category: '热流道', scope: 'mold', calcType: 'qty', calcConfig: { src: '热流道点数', price: 1500 }, enabled: true },
      ],
    }, token);
    check('新增参数与费用项保存成功', save2.status === 200);
    const after2 = await req('POST', `/api/config/${injection.id}/calc`, {}, token);
    check('热流道费 = 8 × 1500', after2.data.lines.find((l) => l.name === '热流道费')?.value === 12000);
    check('参数已入库', after2.data.params['热流道点数'] === 8);

    // ---------- 7 删除费用项 ----------
    console.log('\n[7] 删除费用项');
    const cfgNow2 = await req('GET', `/api/config/${injection.id}`, undefined, token);
    const keep = cfgNow2.data.items.filter((x) => x.name !== '设计费');
    const save3 = await req('PUT', `/api/config/${injection.id}`, {
      items: keep.map((it) => ({ id: it.id, name: it.name, category: it.category, scope: it.scope, calcType: it.calcType, calcConfig: it.calcConfig, enabled: it.enabled })),
    }, token);
    check('删除保存成功', save3.status === 200);
    const after3 = await req('GET', `/api/config/${injection.id}`, undefined, token);
    check('设计费已删除', !after3.data.items.some((x) => x.name === '设计费'), `剩 ${after3.data.items.length} 项`);

    // ---------- 8 停用不参与计算 ----------
    console.log('\n[8] 停用费用项');
    const cfgNow3 = await req('GET', `/api/config/${injection.id}`, undefined, token);
    await req('PUT', `/api/config/${injection.id}`, {
      items: cfgNow3.data.items.map((it) => ({ id: it.id, name: it.name, category: it.category, scope: it.scope, calcType: it.calcType, calcConfig: it.calcConfig, enabled: it.name !== 'CNC 加工费' })),
    }, token);
    const after4 = await req('POST', `/api/config/${injection.id}/calc`, {}, token);
    check('停用项标记为 skipped', after4.data.lines.find((l) => l.name === 'CNC 加工费')?.skipped === true);
    check('停用项不计入合计', after4.data.mold === 5887.5 + 5000 + 12000 + 8000, String(after4.data.mold));

    // ---------- 9 坏配置给中文提示 ----------
    console.log('\n[9] 配置错误的中文提示');
    const cfgNow4 = await req('GET', `/api/config/${injection.id}`, undefined, token);
    await req('PUT', `/api/config/${injection.id}`, {
      items: [
        ...cfgNow4.data.items.map((it) => ({ id: it.id, name: it.name, category: it.category, scope: it.scope, calcType: it.calcType, calcConfig: it.calcConfig, enabled: it.enabled })),
        { name: '坏项', category: '自定义', scope: 'mold', calcType: 'qty', calcConfig: { src: '不存在的参数', price: 5 }, enabled: true },
      ],
    }, token);
    const after5 = await req('POST', `/api/config/${injection.id}/calc`, {}, token);
    const badLine = after5.data.lines.find((l) => l.name === '坏项');
    check('坏配置返回中文提示', !!badLine?.error, badLine?.error);
    check('坏项不影响其它项', after5.data.lines.find((l) => l.name === '模芯钢材费')?.value === 5887.5);

    // ---------- 10 新建类型（复制） ----------
    console.log('\n[10] 新建模具类型');
    const created = await req('POST', '/api/mold-types', { name: '橡胶模具', copyFromId: injection.id }, token);
    check('复制创建成功', created.status === 200 && !!created.data.id);
    const newCfg = await req('GET', `/api/config/${created.data.id}`, undefined, token);
    check('新类型继承了参数', newCfg.data.parameters.length >= 9, `${newCfg.data.parameters.length} 项`);
    check('新类型继承了费用项', newCfg.data.items.length >= 5, `${newCfg.data.items.length} 项`);
    const newCalc = await req('POST', `/api/config/${created.data.id}/calc`, {}, token);
    check('新类型可独立算价', newCalc.data.mold > 0, String(newCalc.data.mold));

    const blank = await req('POST', '/api/mold-types', { name: '空白类型' }, token);
    const blankCfg = await req('GET', `/api/config/${blank.data.id}`, undefined, token);
    check('空白类型有最小可用配置', blankCfg.data.parameters.length === 2 && blankCfg.data.items.length === 1);

    // ---------- 11 删除类型 ----------
    console.log('\n[11] 删除模具类型');
    const delRes = await req('DELETE', `/api/mold-types/${created.data.id}`, undefined, token);
    check('删除成功', delRes.status === 200);
    const afterDel = await req('GET', '/api/mold-types', undefined, token);
    check('类型数量恢复', afterDel.data.length === 4, `${afterDel.data.length} 个（3 预置 + 1 空白）`);

    // ---------- 12 参数校验 ----------
    console.log('\n[12] 参数校验与错误处理');
    const badParam = await req('PUT', `/api/config/${injection.id}`, {
      parameters: [{ code: '2bad', name: '非法编码', defaultValue: '1' }],
    }, token);
    check('非法参数编码返回 400', badParam.status === 400, `status=${badParam.status}`);

    const badItem = await req('PUT', `/api/config/${injection.id}`, {
      items: [{ name: 'X', calcType: 'not-exist' }],
    }, token);
    check('非法计算方式返回 400', badItem.status === 400);

    // ---------- 13 企业隔离 ----------
    console.log('\n[13] 企业数据隔离');
    const other = await req('POST', '/api/auth/login', { email: 'other2@mqs.local', password: 'password123' });
    const otok = other.data?.token;
    const isoTypes = await req('GET', '/api/mold-types', undefined, otok);
    check('看不到其它企业模具类型', isoTypes.data.length === 0, `${isoTypes.data.length} 个`);
    const crossCfg = await req('GET', `/api/config/${injection.id}`, undefined, otok);
    check('无法跨企业读配置', crossCfg.status === 404);
    const crossWrite = await req('PUT', `/api/config/${injection.id}`, { items: [] }, otok);
    check('无法跨企业写配置', crossWrite.status === 404);
  } catch (e) {
    fail++;
    failures.push('执行异常: ' + e.message);
    console.log('\n执行异常：', e.message);
  } finally {
    api.kill();
  }

  console.log('\n===== 结果 =====');
  console.log(`${pass} 通过 / ${fail} 失败`);
  if (fail) { console.log('失败项：'); failures.forEach((f) => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
}

main();
