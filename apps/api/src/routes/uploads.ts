// 件图上传（一期：图片跟件走）
//
// 设计取舍：
//   · 图片落**本地目录**（交付版无对象存储），数据库只存相对路径 —— 避免 DB 膨胀；
//   · 目录位置：打包成 exe 时 = exe 同级 uploads/；开发时 = apps/api/uploads/；
//   · 返回的 url 是相对路径（如 /uploads/ab12.png），前端直接当 <img src> 用；
//   · 只收图片（3D 图纸走二期单独通道，体积大且要解析）。

import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../db.js';

/** 单张图上限 20MB —— 报价单件图用不到更大 */
const MAX_BYTES = 20 * 1024 * 1024;

const ALLOWED_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
};

/** 上传根目录（打包后取 exe 同级目录，开发取当前工作目录） */
export function uploadRoot(): string {
  const base = (process as any).pkg ? path.dirname(process.execPath) : process.cwd();
  const dir = path.join(base, 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function uploadRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------
  // 上传一张件图
  // ---------------------------------------------------------------
  app.post('/api/uploads', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!(req as any).isMultipart || !(req as any).isMultipart()) {
      return reply.code(400).send({ error: '请以 multipart/form-data 方式上传' });
    }

    let data: any;
    try {
      data = await (req as any).file({ limits: { fileSize: MAX_BYTES } });
    } catch (e: any) {
      if (e?.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: '图片太大（上限 20MB），请先压缩' });
      }
      throw e;
    }
    if (!data) return reply.code(400).send({ error: '没有收到文件' });

    const ext = ALLOWED_MIME[data.mimetype];
    if (!ext) {
      // 吃掉流，避免连接挂住
      await data.toBuffer().catch(() => {});
      return reply.code(400).send({ error: '只支持 PNG / JPG / WEBP / GIF / BMP 图片' });
    }

    let buf: Buffer;
    try {
      buf = await data.toBuffer();
    } catch (e: any) {
      if (e?.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: '图片太大（上限 20MB），请先压缩' });
      }
      throw e;
    }
    if (!buf.length) return reply.code(400).send({ error: '文件内容为空' });

    const filename = crypto.randomBytes(10).toString('hex') + ext;
    fs.writeFileSync(path.join(uploadRoot(), filename), buf);

    return {
      url: '/uploads/' + filename,
      name: data.filename || filename,
      size: buf.length,
      mime: data.mimetype,
    };
  });

  // ---------------------------------------------------------------
  // 删除一张件图（换图 / 移除时调用）
  //
  // 关键：报价单版本是**快照**。用户换图时，旧图可能还挂在历史版本上，
  // 直接删文件会让老版本报价单的图裂掉。所以先查引用，有人用就只解除引用、
  // 不删文件（留成孤儿，宁可占点磁盘也不能让历史单据坏掉）。
  // ---------------------------------------------------------------
  app.delete('/api/uploads', { preHandler: [app.authenticate] }, async (req, reply) => {
    const url = String((req.query as any)?.url || '');
    const filename = path.basename(url);
    // 只允许删除 uploads 目录下的文件，挡掉 ../ 穿越
    if (!filename || !/^[a-f0-9]{20}\.(png|jpg|webp|gif|bmp)$/i.test(filename)) {
      return reply.code(400).send({ error: '文件名不合法' });
    }

    const { companyId } = req.user as any;

    // 还有报价版本引用它 → 保留文件
    let stillUsed = 0;
    try {
      const rows = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n
        FROM "QuoteVersion" v
        JOIN "Quote" q ON q.id = v."quoteId"
        WHERE q."companyId" = ${companyId}
          AND v."paramsJson"::text LIKE ${'%' + url + '%'}
      `;
      stillUsed = Number(rows?.[0]?.n ?? 0);
    } catch {
      // 查询失败按「有人用」处理，宁可留垃圾也不要删坏历史单据
      stillUsed = 1;
    }
    if (stillUsed > 0) {
      return { ok: true, kept: true, reason: '该图仍被报价单版本引用，已解除引用但不删除文件' };
    }

    const full = path.join(uploadRoot(), filename);
    if (fs.existsSync(full)) {
      try {
        fs.unlinkSync(full);
      } catch {
        /* 删除失败不影响业务，忽略 */
      }
    }
    return { ok: true, kept: false };
  });
}
