#!/usr/bin/env node
/**
 * 参数作用域（scope）体检 / 修复 / 保存往返测试。
 *
 * 为什么需要它：
 *   配置中心保存是「整体覆盖式」写库（先 deleteMany 再逐条重建），
 *   前端 payload 只要漏一个字段，后端 `?? 默认值` 就会把数据静默改坏。
 *   2026-09-17 就出过事故：保存漏传 scope → 注塑模具 24 个参数被刷成 'common'
 *   → 报价页的模具/注塑卡片里参数整片消失。这个脚本用来事后体检和修复。
 *
 * 用法（凭据走环境变量，不要写进命令历史）：
 *   MQS_EMAIL=... MQS_PASSWORD=... node apps/api/scripts/check-param-scopes.mjs
 *       → 体检：逐个模具类型对比官方预置，列出 scope 不符的参数（不改数据）
 *   ... --apply
 *       → 按预置定义把 scope 修回去
 *   ... --save-test
 *       → 保存往返测试：照前端 payload 走一次 PUT，断言参数数量/scope 分布不变，然后还原
 *
 * 可选：MQS_BASE 覆盖服务地址（默认 https://ycwl.chat）
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

const BASE = process.env.MQS_BASE || 'https://ycwl.chat';
const EMAIL = process.env.MQS_EMAIL;
const PASSWORD = process.env.MQS_PASSWORD;
const APPLY = process.argv.includes('--apply');
const SAVE_TEST = process.argv.includes('--save-test');

/** 加载模具预置定义（优先用已编译的 dist，否则用 esbuild 现打一份） */
function loadPresets() {
  const dist = path.join(ROOT, 'apps', 'api', 'dist', 'services', 'moldPresets.js');
  if (fs.existsSync(dist)) return require(dist);

  const cacheDir = path.join(ROOT, 'node_modules', '.cache', 'mqs-verify');
  const out = path.join(cacheDir, 'moldPresets.cjs');
  fs.mkdirSync(cacheDir, { recursive: true });
  const pnpm = path.join(ROOT, 'node_modules', '.pnpm');
  const ebDir = fs.readdirSync(pnpm).find((d) => d.startsWith('esbuild@'));
  if (!ebDir) throw new Error('找不到 esbuild，请先在项目根执行 pnpm install');
  const ebBin = path.join(pnpm, ebDir, 'node_modules', 'esbuild', 'bin', 'esbuild');
  const r = spawnSync(
    process.execPath,
    [ebBin, path.join(ROOT, 'apps/api/src/services/moldPresets.ts'),
      '--bundle', '--platform=node', '--format=cjs', '--log-level=error', '--outfile=' + out],
    { cwd: ROOT, stdio: 'inherit' },
  );
  if (r.status !== 0) throw new Error('打包 moldPresets.ts 失败');
  return require(out);
}

const { MOLD_PRESETS } = loadPresets();
const SCOPE_BY_TYPE = {};
const NAME_BY_TYPE = {};
for (const mt of MOLD_PRESETS) {
  SCOPE_BY_TYPE[mt.code] = {};
  NAME_BY_TYPE[mt.code] = {};
  for (const p of mt.params ?? []) {
    SCOPE_BY_TYPE[mt.code][p.code] = p.scope;
    NAME_BY_TYPE[mt.code][p.name] = p.scope;
  }
}

async function http(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: res.status, data };
}

if (!EMAIL || !PASSWORD) {
  console.error('缺少凭据：请设置 MQS_EMAIL / MQS_PASSWORD 环境变量');
  process.exit(2);
}

const login = await http('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
if (login.status !== 200) {
  console.error('登录失败', login.status, JSON.stringify(login.data).slice(0, 200));
  process.exit(1);
}
const token = login.data.token;
console.log(`✓ 登录成功 ${BASE}${APPLY || SAVE_TEST ? '' : '（体检模式，不会改动数据）'}`);

const dist = (params) => {
  const d = {};
  for (const p of params ?? []) d[p.scope ?? '(空)'] = (d[p.scope ?? '(空)'] || 0) + 1;
  return d;
};

const types = (await http('GET', '/api/mold-types', undefined, token)).data;
let wrongTotal = 0;

for (const t of types) {
  const cfg = (await http('GET', `/api/config/${t.id}`, undefined, token)).data;
  const params = cfg.parameters ?? [];
  const want = SCOPE_BY_TYPE[t.code] ?? {};
  const wantName = NAME_BY_TYPE[t.code] ?? {};

  const wrong = [];
  const unknown = [];
  for (const p of params) {
    const target = want[p.code] ?? wantName[p.name];
    if (!target) { unknown.push(p); continue; }
    if ((p.scope ?? 'common') !== target) wrong.push({ p, target });
  }

  console.log(`\n【${t.name}】code=${t.code} · 参数 ${params.length} 个 · scope ${JSON.stringify(dist(params))}`);
  console.log(`  与预置不符 ${wrong.length} 个；预置里没有的（跳过）${unknown.length} 个`);
  for (const { p, target } of wrong.slice(0, 40)) {
    console.log(`    · ${p.name.padEnd(10)} ${String(p.scope).padEnd(8)} → ${target}`);
  }
  wrongTotal += wrong.length;

  // 保存往返测试：照前端 save() 的 payload 走一次 PUT，看会不会把数据改坏
  if (SAVE_TEST) {
    const before = JSON.stringify(dist(params));
    const namesBefore = params.map((p) => p.name).join('|');
    const buildPayload = (extra) => ({
      parameters: params.map((p) => ({
        id: p.id, code: p.code, name: p.name, unit: p.unit ?? null,
        defaultValue: String(p.defaultValue ?? ''), group: p.group || '通用',
        scope: p.scope || 'common',                     // ← 事故点：漏了它就会被刷成 common
        type: p.type || 'decimal', materialCode: p.materialCode || null,
        options: p.type === 'select' && Array.isArray(p.options) ? p.options : null,
        enabled: p.enabled !== false,
      })),
      terms: (cfg.terms ?? []).map((x) => ({ id: x.id, text: x.text, enabled: x.enabled !== false })),
      items: [
        ...(cfg.items ?? []).map((it, i) => ({
          id: it.id, name: it.name, category: it.category, scope: it.scope,
          calcType: it.calcType, calcConfig: it.calcConfig ?? {}, expression: it.expression ?? null,
          perUnit: it.perUnit === true, enabled: it.enabled !== false, sortOrder: i,
        })),
        ...(extra ? [extra] : []),
      ],
      profitRate: t.profitRate, taxRate: t.taxRate,
    });
    const marker = `【体检往返${Date.now().toString().slice(-5)}】`;
    await http('PUT', `/api/config/${t.id}`, buildPayload(
      { name: marker, category: '自定义', scope: 'mold', calcType: 'fixed', calcConfig: { amount: 1 }, perUnit: false, enabled: true },
    ), token);
    const mid = (await http('GET', `/api/config/${t.id}`, undefined, token)).data;
    const okCount = (mid.parameters ?? []).length === params.length;
    const okNames = (mid.parameters ?? []).map((p) => p.name).join('|') === namesBefore;
    const okScope = JSON.stringify(dist(mid.parameters)) === before;
    const okItem = (mid.items ?? []).some((it) => it.name === marker);
    console.log(
      `  保存往返：参数数量${okCount ? '✓' : '✗'} 名称${okNames ? '✓' : '✗'} scope分布${okScope ? '✓' : '✗'} 新项入库${okItem ? '✓' : '✗'}`,
    );
    // 还原
    await http('PUT', `/api/config/${t.id}`, buildPayload(null), token);
    const back = (await http('GET', `/api/config/${t.id}`, undefined, token)).data;
    console.log(`  已还原：费用项 ${(back.items ?? []).length} 个（原始 ${(cfg.items ?? []).length}）`);
    if (!(okCount && okNames && okScope && okItem)) process.exitCode = 1;
  }

  if (APPLY && wrong.length) {
    const payload = {
      parameters: params.map((p) => {
        const target = want[p.code] ?? wantName[p.name] ?? p.scope ?? 'common';
        return {
          id: p.id, code: p.code, name: p.name, unit: p.unit ?? null,
          defaultValue: String(p.defaultValue ?? ''), group: p.group || '通用',
          scope: target, type: p.type || 'decimal',
          materialCode: p.materialCode || null,
          options: p.type === 'select' && Array.isArray(p.options) ? p.options : null,
          enabled: p.enabled !== false,
        };
      }),
      terms: (cfg.terms ?? []).map((x) => ({ id: x.id, text: x.text, enabled: x.enabled !== false })),
      items: (cfg.items ?? []).map((it, i) => ({
        id: it.id, name: it.name, category: it.category, scope: it.scope,
        calcType: it.calcType, calcConfig: it.calcConfig ?? {}, expression: it.expression ?? null,
        perUnit: it.perUnit === true, enabled: it.enabled !== false, sortOrder: it.sortOrder ?? i,
      })),
      profitRate: t.profitRate, taxRate: t.taxRate,
    };
    const saved = await http('PUT', `/api/config/${t.id}`, payload, token);
    const after = (await http('GET', `/api/config/${t.id}`, undefined, token)).data;
    console.log(
      saved.status === 200
        ? `  ✓ 已修复 ${wrong.length} 个 → scope ${JSON.stringify(dist(after.parameters))}`
        : `  ✗ 修复失败 ${saved.status}`,
    );
  }
}

console.log(
  `\n${APPLY ? '修复' : '体检'}完成：共 ${wrongTotal} 个参数与预置定义不符。`,
);
if (!APPLY && wrongTotal) console.log('要修复请加 --apply。');
