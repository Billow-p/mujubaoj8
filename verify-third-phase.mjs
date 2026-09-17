#!/usr/bin/env node
/**
 * 三期（Excel 参数表 · 列映射）验证一键跑。
 *
 *   node verify-third-phase.mjs
 *
 * 两段：
 *   [1] 数据端到端：模板 .xlsx → 后端 importQuoteExcel（列映射）→ 前端 applyImportedParams（落状态）
 *   [2] UI 交互（jsdom）：真实组件 SmartImport 的「参数表导入」入口
 *
 * 说明：本机无可用真机浏览器，[2] 以 jsdom 作为降级手段；若未安装 jsdom 会自动跳过并给出启用提示。
 *      UI 测试需要 jsdom 可被 require 到，可用环境变量 MQS_JSDOM_NODE_PATH 指定含 jsdom 的 node_modules。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PNPM = path.join(ROOT, 'node_modules', '.pnpm');
const OUTDIR = path.join(ROOT, 'node_modules', '.cache', 'mqs-verify');

function esbuildBin() {
  if (!existsSync(PNPM)) throw new Error('未找到 node_modules/.pnpm —— 请先在项目根执行 pnpm install');
  const dir = readdirSync(PNPM).find((d) => d.startsWith('esbuild@'));
  if (!dir) throw new Error('未找到 esbuild —— 请先在项目根执行 pnpm install');
  return path.join(PNPM, dir, 'node_modules', 'esbuild', 'bin', 'esbuild');
}

function bundle(src, out, externals = []) {
  const args = [esbuildBin(), src, '--bundle', '--platform=node', '--format=cjs', '--log-level=error', '--outfile=' + out];
  for (const e of externals) args.push('--external:' + e);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0 || !existsSync(out)) throw new Error('打包失败：' + src);
}

function run(file, env = {}) {
  return spawnSync(process.execPath, [file], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } }).status ?? 1;
}

function jsdomEnv() {
  if (process.env.MQS_JSDOM_NODE_PATH) return { NODE_PATH: process.env.MQS_JSDOM_NODE_PATH };
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return { NODE_PATH: path.join(home, '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules') };
}

function hasJsdom(env) {
  return spawnSync(process.execPath, ['-e', "require('jsdom')"], { cwd: ROOT, env: { ...process.env, ...env } }).status === 0;
}

rmSync(OUTDIR, { recursive: true, force: true });
mkdirSync(OUTDIR, { recursive: true });

console.log('▶ 打包验证产物…');
bundle(path.join(ROOT, 'apps/api/src/services/excelImport.ts'), path.join(OUTDIR, 'excelImport.cjs'), ['exceljs']);
bundle(path.join(ROOT, 'apps/web/src/utils/importParams.ts'), path.join(OUTDIR, 'importParams.cjs'));

let code = 0;

console.log('\n▶ [1/2] 数据端到端：模板 → 后端列映射 → 前端落状态');
// 打包产物放在 node_modules/.cache 下，找不到 exceljs；用 NODE_PATH 指回 apps/api 的依赖
code |= run(path.join(ROOT, 'apps/api/scripts/verifyParamsE2E.cjs'), {
  NODE_PATH: path.join(ROOT, 'apps/api', 'node_modules'),
});

console.log('\n▶ [2/2] UI 交互（jsdom）：SmartImport「参数表导入」入口');
const env = jsdomEnv();
if (!hasJsdom(env)) {
  console.log('⚠ 未检测到 jsdom，跳过 UI 交互验证（不影响 [1]）。');
  console.log('  启用：在含 jsdom 的环境下设置 MQS_JSDOM_NODE_PATH，例如 npm i jsdom 后指向其 node_modules。');
} else {
  bundle(path.join(ROOT, 'apps/web/verify/smartimportDom.ts'), path.join(OUTDIR, 'smartimportDom.cjs'), ['jsdom']);
  code |= run(path.join(OUTDIR, 'smartimportDom.cjs'), env);
}

console.log('\n' + '='.repeat(56));
console.log(code === 0 ? '✅ 三期验证全部通过' : '❌ 三期验证存在失败项');
process.exit(code === 0 ? 0 : 1);
