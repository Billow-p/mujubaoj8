// 三期：POST /api/uploads/excel-params 端到端（真 HTTP + multipart + 鉴权）
// 依赖：先跑过 scripts/e2e.mjs（它会种下 quoter@mqs.local 并压好库结构）
// 运行：node apps/api/scripts/e2e-excel-params.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, '..');
const ROOT = path.resolve(apiDir, '..', '..');

// ---------- 加载 .env ----------
const envPath = path.join(apiDir, '.env');
const fileEnv = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) fileEnv[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
Object.assign(process.env, fileEnv);
const PORT = Number(fileEnv.PORT || 4799);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0;
let fail = 0;
const failures = [];
const check = (name, cond, extra) => {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  \u2717 ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

async function waitForApi(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const upload = (token, buf, filename) => {
  const fd = new FormData();
  fd.append('file', new Blob([buf]), filename);
  return fetch(`${BASE}/api/uploads/excel-params`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: fd,
  });
};

async function main() {
  console.log('\n========== 三期 Excel 参数表上传 端到端 ==========');

  const api = spawn(process.execPath, ['dist/index.js'], {
    cwd: apiDir,
    env: { ...process.env, ...fileEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.on('data', (d) => process.stdout.write(`  [api] ${d}`));
  api.stderr.on('data', (d) => process.stderr.write(`  [api:err] ${d}`));

  const up = await waitForApi();
  check('API 启动并可访问 /health', up);
  if (!up) {
    api.kill();
    process.exit(1);
  }

  try {
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'quoter@mqs.local', password: 'password123' }),
    });
    const lj = await login.json();
    check('登录成功', login.status === 200 && !!lj.token, lj?.token ? 'token 已拿到' : JSON.stringify(lj).slice(0, 120));
    const token = lj.token;

    const tplPath = path.join(ROOT, 'apps/web/public/templates/报价参数导入模板.xlsx');
    check('官方模板文件存在', fs.existsSync(tplPath), tplPath);
    const buf = fs.readFileSync(tplPath);

    // ---- 未登录 ----
    const noAuth = await upload(null, buf, '报价参数导入模板.xlsx');
    check('未登录被拒', noAuth.status === 401 || noAuth.status === 403, `status=${noAuth.status}`);

    // ---- 正常上传 ----
    const r = await upload(token, buf, '报价参数导入模板.xlsx');
    const bodyText = await r.text();
    let j = {};
    try { j = JSON.parse(bodyText); } catch { /* 保留文本 */ }
    check('上传返回 200', r.status === 200, r.status === 200 ? '' : `status=${r.status} ${bodyText.slice(0, 160)}`);
    check('模具 1 套', (j.molds || []).length === 1, `molds=${(j.molds || []).length}`);
    check('注塑件 1 个', (j.parts || []).length === 1, `parts=${(j.parts || []).length}`);
    check('其他费用 1 条', (j.extras?.otherExtras || []).length === 1);
    check(
      '35 列全命中 / 0 未匹配 / 0 告警',
      (j.matched || []).length === 35 && (j.unmatched || []).length === 0 && (j.warnings || []).length === 0,
      `matched=${(j.matched || []).length} unmatched=${(j.unmatched || []).length} warnings=${(j.warnings || []).length}`,
    );
    check('模具名称 = 外壳模具', j.molds?.[0]?.name === '外壳模具');
    check('模具钢材编码 = P20', j.molds?.[0]?.materialCode === 'P20');
    check('模具腔数 = 2', j.molds?.[0]?.params?.cavityCount === 2);
    check('注塑件名称 = 外壳上盖', j.parts?.[0]?.name === '外壳上盖');
    check('注塑数量 = 5000', j.parts?.[0]?.qty === 5000);
    check('运输箱长 = 120', j.common?.params?.packLengthCm === 120);
    check('识别到运输区域 = 0', j.common?.params?.freightZone === 0, `freightZone=${j.common?.params?.freightZone}`);

    // ---- 错误格式 ----
    const bad = await upload(token, Buffer.from('not an excel'), 'not-excel.xls');
    check('.xls 被 415 拦截并给出转存建议', bad.status === 415, `status=${bad.status}`);
  } catch (e) {
    fail++;
    failures.push('测试执行异常: ' + e.message);
    console.log('\n执行异常：', e.message);
  } finally {
    api.kill();
  }

  console.log('\n========== 结果 ==========');
  console.log(`${pass} 通过 / ${fail} 失败`);
  if (fail > 0) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(fail === 0 ? 0 : 1);
}

main();
