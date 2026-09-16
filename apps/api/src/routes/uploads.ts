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
import { extractExcelImages } from '../services/excelImages.js';
import { extractWordImages } from '../services/wordImages.js';
import { writeRecogLog, type RecogOutcome } from '../services/recogLog.js';

/** 单张图上限 20MB —— 报价单件图用不到更大 */
const MAX_BYTES = 20 * 1024 * 1024;
/** Excel 里可能塞很多图，放宽到 30MB */
const MAX_EXCEL_BYTES = 30 * 1024 * 1024;

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

/** 识别失败的统一出口：记日志 + 给前端「人话原因」和「怎么改」 */
function recogFail(
  req: any,
  reply: any,
  o: {
    kind: 'excel' | 'word' | 'image' | 'unknown';
    fileName: string;
    fileSize: number;
    status: number;
    message: string;
    suggestion: string;
    outcome?: RecogOutcome;
    detail?: string;
    step?: string;
  },
) {
  writeRecogLog(
    {
      kind: o.kind,
      fileName: o.fileName,
      fileSize: o.fileSize,
      outcome: o.outcome ?? (o.status === 415 ? 'unsupported' : 'failed'),
      reason: o.message,
      detail: o.detail,
      step: o.step,
    },
    req?.user?.userId,
  );
  return reply.code(o.status).send({ error: o.message, suggestion: o.suggestion });
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
  // 从 Excel 询价单里提取内嵌图片（二期）
  //
  // 客户经常发「一张 Excel，左边品名、右边贴图」。这里把图抠出来，
  // 并带上它锚在哪一行、那一行写了什么 —— 前端据此建议「这张图属于哪个件」。
  // 不做列映射（那是三期的事），只解决图片归位。
  // ---------------------------------------------------------------
  app.post('/api/uploads/excel', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!(req as any).isMultipart || !(req as any).isMultipart()) {
      return reply.code(400).send({ error: '请以 multipart/form-data 方式上传' });
    }

    let data: any;
    try {
      data = await (req as any).file({ limits: { fileSize: MAX_EXCEL_BYTES } });
    } catch (e: any) {
      if (e?.code === 'FST_REQ_FILE_TOO_LARGE') {
        return recogFail(req, reply, {
          kind: 'excel', fileName: '(未知)', fileSize: 0, status: 413,
          message: 'Excel 太大（上限 30MB）',
          suggestion: '删掉表格里不必要的图片，或拆成几个小文件分别上传',
          step: 'read-file',
        });
      }
      throw e;
    }
    if (!data) {
      return recogFail(req, reply, {
        kind: 'excel', fileName: '(未知)', fileSize: 0, status: 400,
        message: '没有收到文件',
        suggestion: '重新选择文件后再上传；如果是拖拽，请确认文件确实拖进了虚线框内',
        step: 'read-file',
      });
    }

    const fname = String(data.filename || '询价单.xlsx');
    const name = fname.toLowerCase();
    if (!name.endsWith('.xlsx')) {
      await data.toBuffer().catch(() => {});
      // 老 .xls 是最常见的踩坑点，单独给一句明确的话
      const isOld = name.endsWith('.xls');
      return recogFail(req, reply, {
        kind: 'excel', fileName: fname, fileSize: 0, status: 415,
        message: isOld ? '老版 .xls 里的图片读不出来' : `不支持 .${(name.split('.').pop() || '?')} 格式`,
        suggestion: isOld
          ? '用 Excel 打开 →「文件 → 另存为」→ 格式选「Excel 工作簿 (*.xlsx)」→ 重新上传'
          : '目前支持 .xlsx（Excel）、.docx（Word）、图片、以及 STEP/STL 等 3D 格式',
        step: 'check-ext',
      });
    }

    let buf: Buffer;
    try {
      buf = await data.toBuffer();
    } catch (e: any) {
      if (e?.code === 'FST_REQ_FILE_TOO_LARGE') {
        return recogFail(req, reply, {
          kind: 'excel', fileName: fname, fileSize: 0, status: 413,
          message: 'Excel 太大（上限 30MB）',
          suggestion: '删掉表格里不必要的图片，或拆成几个小文件分别上传',
          step: 'read-file',
        });
      }
      throw e;
    }
    if (!buf.length) {
      return recogFail(req, reply, {
        kind: 'excel', fileName: fname, fileSize: 0, status: 400,
        message: '文件内容是空的（0 字节）',
        suggestion: '这个文件可能没保存好，请重新导出一次',
        outcome: 'empty',
        step: 'read-file',
      });
    }

    try {
      // Buffer → ArrayBuffer，注意用 slice 取真实片段，别把整个内存池传进去
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      const result = await extractExcelImages(ab, fname);
      writeRecogLog(
        { kind: 'excel', fileName: fname, fileSize: buf.length, outcome: 'ok', extracted: result.images.length },
        (req.user as any)?.userId,
      );
      return result;
    } catch (e: any) {
      req.log?.error?.(e, 'extractExcelImages failed');
      const msg = String(e?.message || '');
      // 加密的 xlsx 解不开，是最常见的失败原因，单独识别
      const encrypted = /encrypt|password|protect/i.test(msg);
      return recogFail(req, reply, {
        kind: 'excel', fileName: fname, fileSize: buf.length, status: 400,
        message: encrypted ? '这个 Excel 被加密或设置了保护，读不出内容' : '读取 Excel 失败：' + (msg || '文件可能已损坏'),
        suggestion: encrypted
          ? '去掉文件密码（「文件 → 信息 → 保护工作簿 → 用密码进行加密」清空）后重新上传'
          : '用 Excel 重新打开并另存为 .xlsx 再试；如果原本是 .xls / WPS 老文件，先转成 .xlsx',
        detail: msg,
        step: 'extract',
      });
    }
  });

  // ---------------------------------------------------------------
  // 从 Word 询价单里提取内嵌图片（二期扩展）
  //
  // .docx 是 ZIP：word/media/ 存图片，word/document.xml 存正文。
  // 把图抠出来并带上它所在段落的文字，界面上就知道这张图是哪个件。
  // ---------------------------------------------------------------
  app.post('/api/uploads/word', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!(req as any).isMultipart || !(req as any).isMultipart()) {
      return recogFail(req, reply, {
        kind: 'word', fileName: '(未知)', fileSize: 0, status: 400,
        message: '请以 multipart/form-data 方式上传',
        suggestion: '这是程序内部调用问题，请刷新页面重试',
        step: 'read-file',
      });
    }

    let data: any;
    try {
      data = await (req as any).file({ limits: { fileSize: MAX_EXCEL_BYTES } });
    } catch (e: any) {
      if (e?.code === 'FST_REQ_FILE_TOO_LARGE') {
        return recogFail(req, reply, {
          kind: 'word', fileName: '(未知)', fileSize: 0, status: 413,
          message: 'Word 文件太大（上限 30MB）',
          suggestion: '压缩文档里的图片，或拆成几个小文件分别上传',
          step: 'read-file',
        });
      }
      throw e;
    }
    if (!data) {
      return recogFail(req, reply, {
        kind: 'word', fileName: '(未知)', fileSize: 0, status: 400,
        message: '没有收到文件',
        suggestion: '重新选择文件后再上传',
        step: 'read-file',
      });
    }

    const fname = String(data.filename || '询价单.docx');
    const lower = fname.toLowerCase();
    if (!lower.endsWith('.docx')) {
      await data.toBuffer().catch(() => {});
      const isOld = lower.endsWith('.doc');
      return recogFail(req, reply, {
        kind: 'word', fileName: fname, fileSize: 0, status: 415,
        message: isOld ? '老版 .doc 读不出图片' : `不支持 .${(lower.split('.').pop() || '?')} 格式`,
        suggestion: isOld
          ? '用 Word 打开 →「文件 → 另存为」→ 格式选「Word 文档 (*.docx)」→ 重新上传'
          : '目前支持 .docx（Word）、.xlsx（Excel）、图片、以及 STEP/STL 等 3D 格式',
        step: 'check-ext',
      });
    }

    let buf: Buffer;
    try {
      buf = await data.toBuffer();
    } catch {
      return recogFail(req, reply, {
        kind: 'word', fileName: fname, fileSize: 0, status: 413,
        message: 'Word 文件太大（上限 30MB）',
        suggestion: '压缩文档里的图片，或拆成几个小文件分别上传',
        step: 'read-file',
      });
    }
    if (!buf.length) {
      return recogFail(req, reply, {
        kind: 'word', fileName: fname, fileSize: 0, status: 400,
        message: '文件内容是空的（0 字节）',
        suggestion: '这个文件可能没保存好，请重新导出一次',
        outcome: 'empty',
        step: 'read-file',
      });
    }

    try {
      const result = extractWordImages(buf, fname);
      writeRecogLog(
        { kind: 'word', fileName: fname, fileSize: buf.length, outcome: 'ok', extracted: result.images.length },
        (req.user as any)?.userId,
      );
      return result;
    } catch (e: any) {
      req.log?.error?.(e, 'extractWordImages failed');
      const msg = String(e?.message || '');
      const encrypted = /encrypt|password|protect/i.test(msg);
      return recogFail(req, reply, {
        kind: 'word', fileName: fname, fileSize: buf.length, status: 400,
        message: encrypted
          ? '这个 Word 被加密或设置了保护'
          : '读取 Word 失败：' + (msg || '文件可能已损坏'),
        suggestion: encrypted
          ? '去掉文档密码（「文件 → 信息 → 保护文档 → 用密码进行加密」清空）后重新上传'
          : '用 Word 重新打开并另存为 .docx 再试；如果原本是 .doc / WPS 老文件，先转成 .docx',
        detail: msg,
        step: 'extract',
      });
    }
  });

  // ---------------------------------------------------------------
  // 前端上报识别结果（页面要把「发生了什么」告诉你）
  //
  // 3D 和图片是在浏览器里解析的，服务端看不到过程。
  // 前端把关键结果（成功/失败/原因）报上来，才能和 Excel/Word 的日志凑成完整一份。
  // ---------------------------------------------------------------
  app.post('/api/uploads/recog-log', { preHandler: [app.authenticate] }, async (req, reply) => {
    const b = (req.body || {}) as any;
    const kind = ['excel', 'word', '3d', 'image', 'unknown'].includes(b.kind) ? b.kind : 'unknown';
    const outcome: RecogOutcome = ['ok', 'empty', 'unsupported', 'failed'].includes(b.outcome)
      ? b.outcome
      : 'failed';
    writeRecogLog(
      {
        kind,
        fileName: String(b.fileName || '(未知)').slice(0, 200),
        fileSize: Number(b.fileSize) || 0,
        outcome,
        extracted: Number(b.extracted) || 0,
        reason: String(b.reason || '').slice(0, 500),
        detail: String(b.detail || '').slice(0, 1000),
        step: String(b.step || '').slice(0, 80),
      },
      (req.user as any)?.userId,
    );
    return { ok: true };
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
