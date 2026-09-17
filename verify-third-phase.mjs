#!/usr/bin/env node
/**
 * 一键验证：
 *   [1] 数据端到端：模板 .xlsx → 后端 importQuoteExcel（列映射）→ 前端 applyImportedParams（落状态）
 *   [2] UI 交互（jsdom）：SmartImport 的「参数表导入」入口
 *   [3] 报价页渲染（jsdom）：运输区域/其他价格的位置、模具与注塑件自定义栏增删
 *
 *   node verify-third-phase.mjs
 *
 * 说明：本机无可用真机浏览器，[2][3] 以 jsdom 作为降级手段；
 *      若未安装 jsdom 会自动跳过 [2][3] 并给出启用提示，不影响 [1]。
 *      UI 测试需要 jsdom 可被 require 到，可用环境变量 MQS_JSDOM_NODE_PATH 指定含 jsdom 的 node_modules。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PNPM = path.join(ROOT, 'node_modules', '.pnpm');
const OUTDIR = path.join(ROOT, 'node_modules', '.cache', 'mqs-verify');

function pnpmPkg(prefix, entry) {
  if (!existsSync(PNPM)) throw new Error('未找到 node_modules/.pnpm —— 请先在项目根执行 pnpm install');
  const dir = readdirSync(PNPM).find((d) => d.startsWith(prefix));
  if (!dir) throw new Error(`未找到 ${prefix} —— 请先在项目根执行 pnpm install`);
  return path.join(PNPM, dir, 'node_modules', ...entry);
}

const esbuildBin = () => pnpmPkg('esbuild@', ['esbuild', 'bin', 'esbuild']);

function bundle(src, out, externals = []) {
  const args = [esbuildBin(), src, '--bundle', '--platform=node', '--format=cjs', '--log-level=error', '--outfile=' + out];
  for (const e of externals) args.push('--external:' + e);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0 || !existsSync(out)) throw new Error('打包失败：' + src);
}

/** 报价页验证要把 `../api` 换成假数据 → 用 esbuild JS API 挂 onResolve 插件 */
async function bundleWithStubApi(src, out, stub) {
  const main = pnpmPkg('esbuild@', ['esbuild', 'lib', 'main.js']);
  const mod = await import(pathToFileURL(main).href);
  const esbuild = mod.build ? mod : mod.default;
  await esbuild.build({
    entryPoints: [src],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['jsdom'],
    logLevel: 'error',
    absWorkingDir: ROOT,
    plugins: [
      {
        name: 'stub-api',
        setup(build) {
          build.onResolve({ filter: /^\.\.\/api$/ }, (args) => {
            if (args.importer.includes(`${path.sep}src${path.sep}`)) return { path: stub };
            return null;
          });
        },
      },
    ],
  });
  if (!existsSync(out)) throw new Error('打包失败：' + src);
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

console.log('\n▶ [1/4] 数据端到端：模板 → 后端列映射 → 前端落状态');
// 打包产物放在 node_modules/.cache 下找不到 exceljs；用 NODE_PATH 指回 apps/api 的依赖
code |= run(path.join(ROOT, 'apps/api/scripts/verifyParamsE2E.cjs'), {
  NODE_PATH: path.join(ROOT, 'apps/api', 'node_modules'),
});

const env = jsdomEnv();
if (!hasJsdom(env)) {
  console.log('\n⚠ 未检测到 jsdom，跳过 [2][3] UI 验证（不影响 [1]）。');
  console.log('  启用：在含 jsdom 的环境下设置 MQS_JSDOM_NODE_PATH，例如 npm i jsdom 后指向其 node_modules。');
} else {
  console.log('\n▶ [2/4] UI 交互（jsdom）：SmartImport「参数表导入」入口');
  bundle(path.join(ROOT, 'apps/web/verify/smartimportDom.ts'), path.join(OUTDIR, 'smartimportDom.cjs'), ['jsdom']);
  code |= run(path.join(OUTDIR, 'smartimportDom.cjs'), env);

  console.log('\n▶ [3/4] 报价页渲染（jsdom）：运输区域/其他价格位置 + 配置中心费用项可见可填');
  await bundleWithStubApi(
    path.join(ROOT, 'apps/web/verify/configuredQuoteDom.ts'),
    path.join(OUTDIR, 'configuredQuoteDom.cjs'),
    path.join(ROOT, 'apps/web/verify/stubApi.ts'),
  );
  code |= run(path.join(OUTDIR, 'configuredQuoteDom.cjs'), env);

  console.log('\n▶ [4/4] 配置中心渲染（jsdom）：参数分组与报价页一致（无「公共参数」）');
  await bundleWithStubApi(
    path.join(ROOT, 'apps/web/verify/configCenterDom.ts'),
    path.join(OUTDIR, 'configCenterDom.cjs'),
    path.join(ROOT, 'apps/web/verify/stubApi.ts'),
  );
  code |= run(path.join(OUTDIR, 'configCenterDom.cjs'), env);
}

console.log('\n' + '='.repeat(56));
console.log(code === 0 ? '✅ 全部验证通过' : '❌ 存在失败项');
process.exit(code === 0 ? 0 : 1);
