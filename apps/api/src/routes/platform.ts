// 平台管理路由（SaaS 运营方超管）—— 跨租户查看全部注册用户与公司
//
// 权限：仅 User.isSuperAdmin = true 可访问。
// 与 admin.ts 的区别：
//   admin.ts   = 公司内管理员，只能看本公司数据
//   platform.ts= 平台超管，可跨所有公司查看（运营视角）
//
// 注意：这里**不信任 JWT 里的角色**，每次都回库校验 isSuperAdmin，
// 这样给某人开通/收回超管权限后立即生效，无需重新登录。

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { calcTotal } from '../services/quoteTotal.js';

const ROLE_LABEL: Record<string, string> = {
  admin: '管理员',
  auditor: '审核员',
  quoter: '报价员',
};

/**
 * 先鉴权再校验平台超管。
 * 说明：app.authenticate 失败时只 reply 401 并不抛错，必须检查 reply.sent。
 */
function requireSuperAdmin(app: FastifyInstance) {
  return async (req: any, reply: any) => {
    await app.authenticate(req, reply);
    if (reply.sent) return;
    const { userId } = req.user as any;
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isSuperAdmin: true, name: true, email: true },
    });
    if (!u || !u.isSuperAdmin) {
      return reply.code(403).send({ error: '仅平台超管可访问' });
    }
    req.superUser = u;
  };
}

export async function platformRoutes(app: FastifyInstance) {
  // ================================================================
  // 平台概览：全站规模 + 角色分布 + 公司排行
  // ================================================================
  app.get('/api/platform/overview', { preHandler: [requireSuperAdmin(app)] }, async () => {
    const since = new Date(Date.now() - 30 * 86400000);

    const [
      companyCount,
      userCount,
      customerCount,
      quoteCount,
      newUsers,
      newQuotes,
      roleGroups,
      companies,
    ] = await Promise.all([
      prisma.company.count(),
      prisma.user.count(),
      prisma.customer.count(),
      prisma.quote.count(),
      prisma.user.count({ where: { createdAt: { gte: since } } }),
      prisma.quote.count({ where: { createdAt: { gte: since } } }),
      prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      prisma.company.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          createdAt: true,
          _count: { select: { users: true, quotes: true, customers: true } },
        },
      }),
    ]);

    return {
      counts: {
        companies: companyCount,
        users: userCount,
        customers: customerCount,
        quotes: quoteCount,
      },
      recent30: { users: newUsers, quotes: newQuotes },
      byRole: roleGroups
        .map((g) => ({
          role: g.role,
          label: ROLE_LABEL[g.role] ?? g.role,
          count: (g._count as any)?._all ?? 0,
        }))
        .sort((a, b) => b.count - a.count),
      companies: companies.map((c) => ({
        id: c.id,
        name: c.name,
        createdAt: c.createdAt,
        users: c._count.users,
        quotes: c._count.quotes,
        customers: c._count.customers,
      })),
    };
  });

  // ================================================================
  // 全部注册用户（跨租户）—— 支持关键词搜索 + 分页
  // ================================================================
  app.get('/api/platform/users', { preHandler: [requireSuperAdmin(app)] }, async (req) => {
    const q = z
      .object({
        keyword: z.string().trim().max(100).optional(),
        companyId: z.string().trim().max(60).optional(),
        role: z.enum(['quoter', 'auditor', 'admin']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(req.query ?? {});

    const where: any = {};
    if (q.companyId) where.companyId = q.companyId;
    if (q.role) where.role = q.role;
    if (q.keyword) {
      where.OR = [
        { email: { contains: q.keyword, mode: 'insensitive' } },
        { name: { contains: q.keyword, mode: 'insensitive' } },
        { company: { name: { contains: q.keyword, mode: 'insensitive' } } },
      ];
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isSuperAdmin: true,
          emailVerified: true,
          createdAt: true,
          lastLoginAt: true,
          company: { select: { id: true, name: true } },
        },
      }),
    ]);

    // 只统计当前页用户的报价数据，避免全表扫描
    const ids = users.map((u) => u.id);
    const quotes = ids.length
      ? await prisma.quote.findMany({
          where: { createdById: { in: ids } },
          select: {
            createdById: true,
            status: true,
            versions: { orderBy: { versionNo: 'desc' }, take: 1, select: { calcResultJson: true } },
          },
        })
      : [];

    type Stat = { quotes: number; amount: number; confirmed: number };
    const stat = new Map<string, Stat>();
    for (const qq of quotes) {
      const s: Stat = stat.get(qq.createdById) ?? { quotes: 0, amount: 0, confirmed: 0 };
      s.quotes += 1;
      const amt = calcTotal(qq.versions[0]?.calcResultJson);
      s.amount += amt;
      if (qq.status === 'confirmed') s.confirmed += amt;
      stat.set(qq.createdById, s);
    }

    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: users.map((u) => {
        const s: Stat = stat.get(u.id) ?? { quotes: 0, amount: 0, confirmed: 0 };
        return {
          ...u,
          roleLabel: ROLE_LABEL[u.role] ?? u.role,
          stats: {
            quotes: s.quotes,
            amount: Math.round(s.amount * 100) / 100,
            confirmedAmount: Math.round(s.confirmed * 100) / 100,
          },
        };
      }),
    };
  });

  // ================================================================
  // 公司（租户）列表
  // ================================================================
  app.get('/api/platform/companies', { preHandler: [requireSuperAdmin(app)] }, async (req) => {
    const q = z
      .object({ keyword: z.string().trim().max(100).optional() })
      .parse(req.query ?? {});

    const companies = await prisma.company.findMany({
      where: q.keyword ? { name: { contains: q.keyword, mode: 'insensitive' } } : {},
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: { select: { users: true, quotes: true, customers: true } },
        quotes: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
      },
    });

    return companies.map((c) => ({
      id: c.id,
      name: c.name,
      createdAt: c.createdAt,
      users: c._count.users,
      quotes: c._count.quotes,
      customers: c._count.customers,
      lastQuoteAt: c.quotes[0]?.createdAt ?? null,
    }));
  });

  // ================================================================
  // 修改用户角色 / 超管标记（禁止自锁：不能取消自己的超管）
  // ================================================================
  app.patch('/api/platform/users/:id', { preHandler: [requireSuperAdmin(app)] }, async (req, reply) => {
    const { id } = req.params as any;
    const body = z
      .object({
        role: z.enum(['quoter', 'auditor', 'admin']).optional(),
        isSuperAdmin: z.boolean().optional(),
      })
      .parse(req.body ?? {});

    const me = (req as any).superUser as { id: string };
    if (id === me.id && body.isSuperAdmin === false) {
      return reply.code(400).send({ error: '不能取消自己的超管权限' });
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: '用户不存在' });

    const data: any = {};
    if (body.role !== undefined) data.role = body.role;
    if (body.isSuperAdmin !== undefined) data.isSuperAdmin = body.isSuperAdmin;
    if (Object.keys(data).length === 0) return reply.code(400).send({ error: '没有要修改的内容' });

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isSuperAdmin: true,
        company: { select: { id: true, name: true } },
      },
    });
    return { ...updated, roleLabel: ROLE_LABEL[updated.role] ?? updated.role };
  });
}
