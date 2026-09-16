/**
 * 构建前把 OpenCascade 的运行时（js + wasm）复制到 public/occt/。
 * 为什么不走打包：occt-import-js 是 emscripten 老产物，内含 require('fs') 的 Node 分支，
 * 被引擎静态分析极易出错；放 public 下由 Worker 用 importScripts 直接加载最稳。
 *
 * 用法：node apps/web/scripts/copy-occt.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const src = path.join(webRoot, 'node_modules', 'occt-import-js', 'dist');
const dst = path.join(webRoot, 'public', 'occt');

const FILES = ['occt-import-js.js', 'occt-import-js.wasm'];

if (!fs.existsSync(src)) {
  console.error('[copy-occt] 找不到 occt-import-js，请先 pnpm install');
  process.exit(1);
}

fs.mkdirSync(dst, { recursive: true });
let copied = 0;
for (const f of FILES) {
  const from = path.join(src, f);
  if (!fs.existsSync(from)) {
    console.error(`[copy-occt] 缺少 ${f}`);
    process.exit(1);
  }
  const to = path.join(dst, f);
  // 大小一致就跳过，省掉 7.6MB 的无谓拷贝
  if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) continue;
  fs.copyFileSync(from, to);
  copied++;
}
console.log(`[copy-occt] 就绪（本次复制 ${copied} 个文件）→ public/occt/`);
