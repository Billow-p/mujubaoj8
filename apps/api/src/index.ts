// 主入口

import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { authRoutes } from './routes/auth.js';
import { calcRoutes } from './routes/calc.js';
import { quoteRoutes } from './routes/quotes.js';
import { customerRoutes } from './routes/customers.js';
import { verifySmtpConnection } from './services/email.js';

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

  await app.register(cors, { origin: true, credentials: true });
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-secret-change-in-prod' });

  // 鉴权装饰器
  app.decorate('authenticate', async (req: any, reply: any) => {
    try {
      await req.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: '未登录或登录已过期' });
    }
  });

  // 健康检查
  app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));
  // 供 nginx / 容器健康检查直接探测（无 /api 前缀）
  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  // 注册路由
  await app.register(authRoutes);
  await app.register(calcRoutes);
  await app.register(quoteRoutes);
  await app.register(customerRoutes);

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
