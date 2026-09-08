// 认证路由 — 支持邮箱验证码注册 / 找回密码

import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { sendVerificationCode, verifyCode, verifySmtpConnection } from '../services/email.js';

const EmailSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
});

// 注册：邮箱 + 验证码 + 密码 + 姓名
const RegisterSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  code: z.string().length(6, '验证码为 6 位数字'),
  password: z.string().min(6, '密码至少 6 位'),
  name: z.string().min(1, '请填写姓名'),
  companyName: z.string().min(1).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// 发送验证码：scene = register | reset_password
const SendCodeSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  scene: z.enum(['register', 'reset_password']),
});

// 重置密码：邮箱 + 验证码 + 新密码
const ResetPasswordSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  code: z.string().length(6, '验证码为 6 位数字'),
  password: z.string().min(6, '密码至少 6 位'),
});

export async function authRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------
  // 发送邮箱验证码（注册 / 找回密码）
  // ---------------------------------------------------------------
  app.post('/api/auth/send-code', async (req, reply) => {
    const body = SendCodeSchema.parse(req.body);
    const result = await sendVerificationCode(body.email, body.scene);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return {
      ok: true,
      message: '验证码已发送，请查收邮件',
      expiresInSec: result.expiresInSec,
    };
  });

  // ---------------------------------------------------------------
  // 邮箱注册（需验证码）
  // ---------------------------------------------------------------
  app.post('/api/auth/register', async (req, reply) => {
    const body = RegisterSchema.parse(req.body);
    const email = body.email.trim().toLowerCase();

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return reply.code(400).send({ error: '邮箱已被注册' });

    // 校验验证码
    const check = await verifyCode(email, body.code, 'register');
    if (!check.ok) return reply.code(400).send({ error: check.error });

    let company;
    if (body.companyName) {
      company = await prisma.company.create({ data: { name: body.companyName } });
    } else {
      company = await prisma.company.findUnique({ where: { id: 'default-company' } });
      if (!company) {
        company = await prisma.company.create({ data: { id: 'default-company', name: '默认企业' } });
      }
    }

    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: body.name,
        role: 'quoter',
        companyId: company.id,
        emailVerified: true, // 验证码验证通过
      },
    });

    const token = app.jwt.sign({ userId: user.id, companyId: user.companyId, role: user.role });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });

  // ---------------------------------------------------------------
  // 邮箱登录
  // ---------------------------------------------------------------
  app.post('/api/auth/login', async (req, reply) => {
    const body = LoginSchema.parse(req.body);
    const email = body.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return reply.code(401).send({ error: '邮箱或密码错误' });

    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: '邮箱或密码错误' });

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const token = app.jwt.sign({ userId: user.id, companyId: user.companyId, role: user.role });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });

  // ---------------------------------------------------------------
  // 找回密码：重置密码（需验证码）
  // ---------------------------------------------------------------
  app.post('/api/auth/reset-password', async (req, reply) => {
    const body = ResetPasswordSchema.parse(req.body);
    const email = body.email.trim().toLowerCase();

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return reply.code(404).send({ error: '该邮箱未注册' });

    const check = await verifyCode(email, body.code, 'reset_password');
    if (!check.ok) return reply.code(400).send({ error: check.error });

    const passwordHash = await bcrypt.hash(body.password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, emailVerified: true },
    });

    return { ok: true, message: '密码重置成功，请重新登录' };
  });

  // ---------------------------------------------------------------
  // 当前用户
  // ---------------------------------------------------------------
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
      emailVerified: user.emailVerified,
    };
  });

  // ---------------------------------------------------------------
  // 登出
  // ---------------------------------------------------------------
  app.post('/api/auth/logout', { preHandler: [app.authenticate] }, async () => {
    return { ok: true };
  });

  // ---------------------------------------------------------------
  // 邮件服务健康检查（管理员可用，便于排查 SMTP 配置）
  // ---------------------------------------------------------------
  app.get('/api/health/email', { preHandler: [app.authenticate] }, async (req, reply) => {
    const u = req.user as any;
    if (u.role !== 'admin') return reply.code(403).send({ error: '需要管理员权限' });
    const ok = await verifySmtpConnection();
    return { ok, smtpUser: process.env.SMTP_USER || '729503962@qq.com' };
  });
}