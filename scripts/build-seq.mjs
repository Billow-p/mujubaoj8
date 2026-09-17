#!/usr/bin/env node
/**
 * 逐包串行构建 —— 替代 `pnpm -r build`。
 *
 * 为什么不用 `pnpm -r build`：
 * pnpm 会**并行**跑各 workspace 包的构建，本机 16G 内存下同时起 4 个 tsc + vite
 * 会耗尽虚拟内存，tsc 直接 `Fatal process out of memory: Zone` 被杀，
 * 退出码 2147483651（0x80000003）—— 报错还看不出是内存问题。
 * 单独跑每个包都正常，是纯并发问题。
 *
 * 顺序按依赖来：shared → calc-engine → api → web。
 * heap 上限给 3G：够用，又不会把开发机压死（可用 NODE_OPTIONS 覆盖）。
 *
 * 用法：pnpm build
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

/** 按依赖顺序，别乱改 —— api / web 都依赖前两个 */
const ORDER = ['@mqs/shared', '@mqs/calc-engine', '@mqs/api', '@mqs/web'];

/**
 * 找出 pnpm 的入口。
 * 优先用 pnpm 自己传进来的 $npm_execpath（最可靠，pnpm 跑 script 时一定会设）；
 * 再退到 corepack（WorkBuddy 托管 Node 的环境里 PATH 常常没有 pnpm）。
 */
function resolvePnpm() {
  const ep = process.env.npm_execpath;
  if (ep && fs.existsSync(ep)) return { cmd: process.execPath, args: [ep] };

  // corepack 自带的那份 pnpm
  const candidates = [];
  const nodeDir = path.dirname(process.execPath);
  candidates.push(path.join(nodeDir, 'node_modules', 'corepack', 'dist', 'pnpm.js'));
  candidates.push(
    'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node_modules/corepack/dist/pnpm.js',
  );
  for (const c of candidates) {
    if (fs.existsSync(c)) return { cmd: process.execPath, args: [c] };
  }

  // 最后才假设 PATH 里有 pnpm
  return { cmd: 'pnpm', args: [] };
}

const { cmd, args: base } = resolvePnpm();
// heap 给足，但别把机器压死；外层已经设了就不覆盖
if (!process.env.NODE_OPTIONS) process.env.NODE_OPTIONS = '--max-old-space-size=3072';

console.log(`[build-seq] 逐包串行构建（避免 pnpm -r 并行 OOM）`);
for (const pkg of ORDER) {
  console.log(`\n===== building ${pkg} =====`);
  const r = spawnSync(cmd, [...base, '--filter', pkg, 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
    shell: false,
  });
  if (r.error) {
    console.error(`✗ 启动 ${pkg} 构建失败：${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) {
    // 2147483651 = 0x80000003，V8 的 Zone 分配失败 —— 十有八九是内存不够
    const hint =
      r.status === 2147483651
        ? '\n（这个退出码是 V8 内存不足。关掉些程序再试，或调大 NODE_OPTIONS=--max-old-space-size=6144）'
        : '';
    console.error(`\n✗ ${pkg} 构建失败，退出码 ${r.status}${hint}`);
    process.exit(r.status ?? 1);
  }
  console.log(`✓ ${pkg} 构建完成`);
}

console.log('\n[build-seq] 全部构建完成 ✓');
