// 本地验收服务 —— 等价于生产环境里的 Nginx：
//   静态文件 → apps/web/dist（生产构建产物）
//   /api     → 反向代理到后端
// 用途：部署前在本地把「构建产物 + 后端」这条真实链路跑起来验收。
//
// 用法：node scripts/serve-local.mjs
//   环境变量 API_ORIGIN（默认 http://127.0.0.1:3000）、PORT（默认 8080）

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '..', '..', 'web', 'dist');
const API = process.env.API_ORIGIN ?? 'http://127.0.0.1:3000';
const PORT = Number(process.env.PORT ?? 8080);

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error(`找不到前端构建产物：${distDir}\n请先执行 pnpm --filter @mqs/web build`);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // ---- /api 反向代理 ----
  if (url.pathname.startsWith('/api')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    try {
      const r = await fetch(API + url.pathname + url.search, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
        redirect: 'manual',
      });
      const buf = Buffer.from(await r.arrayBuffer());
      const out = {};
      r.headers.forEach((v, k) => {
        if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(k)) out[k] = v;
      });
      res.writeHead(r.status, out);
      res.end(buf);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: `后端不可达（${API}）：${e.message}` }));
    }
    return;
  }

  // ---- 静态文件 + SPA 回退 ----
  const rel = decodeURIComponent(url.pathname);
  let file = path.join(distDir, rel);
  if (!file.startsWith(distDir)) file = path.join(distDir, 'index.html');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(distDir, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`本地验收服务已启动：http://127.0.0.1:${PORT}`);
  console.log(`  静态目录：${distDir}`);
  console.log(`  API 代理：/api → ${API}`);
});
