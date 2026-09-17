// 主入口

import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import { ZodError } from 'zod';
import { authRoutes } from './routes/auth.js';
import { uploadRoutes, uploadRoot } from './routes/uploads.js';
import { calcRoutes } from './routes/calc.js';
import { quoteRoutes } from './routes/quotes.js';
import { customerRoutes } from './routes/customers.js';
import { formulaRoutes } from './routes/formulas.js';
import { materialRoutes } from './routes/materials.js';
import { parameterRoutes } from './routes/parameters.js';
import { templateRoutes } from './routes/templates.js';
import { configRoutes } from './routes/config.js';
import { adminRoutes } from './routes/admin.js';
import { platformRoutes } from './routes/platform.js';
import { verifySmtpConnection } from './services/email.js';
import { prisma } from './db.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: any;
  }
}

async function bootstrap() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
    // 导出 Excel 要读 content-disposition 取文件名。CORS 白名单之外的头
    // 浏览器不会交给 JS，不显式 expose 的话前端永远拿到 undefined，
    // 只能退回一个通用文件名（用户看到的就是「导出没反应/文件名不对」）。
    exposedHeaders: ['Content-Disposition', 'Content-Length'],
  });
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-secret-change-in-prod' });

  // 件图上传（一期）：单文件、限 20MB、只收图片
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 10 },
  });

  // 上传的件图静态托管：nginx 把 /uploads 反代到本服务
  await app.register(staticPlugin, {
    root: uploadRoot(),
    prefix: '/uploads/',
    decorateReply: false,
    cacheControl: true,
    maxAge: '7d',
  });

  // 鉴权装饰器
  app.decorate('authenticate', async (req: any, reply: any) => {
    try {
      await req.jwtVerify();
    } catch (err) {
      return reply.code(401).send({ error: '未登录或登录已过期' });
    }
    // 账号到期拦截：expiresAt 有值且小于当前时间则禁止一切操作
    try {
      const u = await prisma.user.findUnique({
        where: { id: (req.user as any).userId },
        select: { expiresAt: true },
      });
      if (u?.expiresAt && u.expiresAt < new Date()) {
        return reply
          .code(403)
          .send({ error: '账号已过期，请联系管理员开通使用时长', code: 'ACCOUNT_EXPIRED' });
      }
    } catch (e) {
      // 查询失败不阻断（避免 DB 抖动导致全员掉线），仅记录日志
      req.log?.error?.(e);
    }
  });

  // 全局错误处理：把参数校验失败转成 400 + 中文提示，避免一律 500
  app.setErrorHandler((error: any, request, reply) => {
    if (error instanceof ZodError) {
      const msg = error.errors
        .map((e) => `${e.path.join('.') || '参数'}：${e.message}`)
        .join('；');
      return reply.code(400).send({ error: msg || '参数校验失败' });
    }
    if (error?.validation) {
      return reply.code(400).send({ error: error.message });
    }
    const statusCode = error?.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error(error);
      return reply.code(500).send({ error: '服务器内部错误' });
    }
    return reply.code(statusCode).send({ error: error?.message ?? '请求失败' });
  });

  // 健康检查
  app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));
  // 供 nginx / 容器健康检查直接探测（无 /api 前缀）
  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  // 注册路由
  await app.register(authRoutes);
  await app.register(uploadRoutes);
  await app.register(calcRoutes);
  await app.register(quoteRoutes);
  await app.register(customerRoutes);
  await app.register(formulaRoutes);
  await app.register(materialRoutes);
  await app.register(parameterRoutes);
  await app.register(templateRoutes);
  await app.register(configRoutes);
  await app.register(adminRoutes);
  await app.register(platformRoutes);

  const port = parseInt(process.env.PORT || '3000');
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`🚀 API server listening on http://localhost:${port}`);

  // 启动后异步自检 SMTP（不阻塞启动，失败仅告警）
  verifySmtpConnection()
    .then((ok) => {
      if (ok) {
        console.log('✅ 邮件服务就绪（QQ SMTP）');
      } else {
        console.warn('⚠️  邮件服务未就绪：SMTP 连接失败，验证码/报价单邮件将无法发送');
      }
    })
    .catch(() => {});
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
