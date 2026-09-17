// 件图落盘目录 —— 单独一个文件，不依赖 Prisma / Fastify。
//
// 为什么单独抽出来：
//   excel.ts（导出报价单）需要知道件图存在哪个目录。
//   之前它 `import { uploadRoot } from '../routes/uploads.js'`，而 uploads.ts
//   顶层就 import 了 prisma —— 结果任何想单独跑「导出链路」的验证/脚本，
//   都会被 Prisma 引擎的加载拖下水（打包后找不到 query_engine-*.dll.node）。
//   把目录这件事抽成一个零依赖文件，导出链路就干净了。
//
// 目录位置：打包成 exe 时 = exe 同级 uploads/；开发时 = 进程工作目录/uploads/。

import fs from 'fs';
import path from 'path';

/** 上传根目录（不存在则创建） */
export function uploadRoot(): string {
  const base = (process as any).pkg ? path.dirname(process.execPath) : process.cwd();
  const dir = path.join(base, 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
