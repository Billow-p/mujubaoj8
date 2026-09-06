// 主入口

import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { authRoutes } from './routes/auth';
import { calcRoutes } from './routes/calc';
import { quoteRoutes } from './routes/quotes';
import { customerRoutes } from './routes/customers';

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

  // 注册路由
  await app.register(authRoutes);
  await app.register(calcRoutes);
  await app.register(quoteRoutes);
  await app.register(customerRoutes);

  const port = parseInt(process.env.PORT || '3000');
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`🚀 API server listening on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
