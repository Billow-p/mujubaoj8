// 认证路由

import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  companyName: z.string().min(1).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function authRoutes(app: FastifyInstance) {
  // 邮箱注册
  app.post('/api/auth/register', async (req, reply) => {
    const body = RegisterSchema.parse(req.body);
    const exists = await prisma.user.findUnique({ where: { email: body.email } });
    if (exists) return reply.code(400).send({ error: '邮箱已被注册' });

    let company;
    if (body.companyName) {
      company = await prisma.company.create({ data: { name: body.companyName } });
    } else {
      // 第一个用户自动加入 default-company
      company = await prisma.company.findUnique({ where: { id: 'default-company' } });
      if (!company) {
        company = await prisma.company.create({ data: { id: 'default-company', name: '默认企业' } });
      }
    }

    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        name: body.name,
        role: 'quoter',
        companyId: company.id,
      },
    });

    const token = app.jwt.sign({ userId: user.id, companyId: user.companyId, role: user.role });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });

  // 邮箱登录
  app.post('/api/auth/login', async (req, reply) => {
    const body = LoginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) return reply.code(401).send({ error: '邮箱或密码错误' });

    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: '邮箱或密码错误' });

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const token = app.jwt.sign({ userId: user.id, companyId: user.companyId, role: user.role });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });

  // 当前用户
  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (req) => {
    const { userId } = req.user as any;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      companyId: user.companyId,
    };
  });

  // 登出（前端清 token 即可，这里仅日志）
  app.post('/api/auth/logout', { preHandler: [app.authenticate] }, async () => {
    return { ok: true };
  });
}
