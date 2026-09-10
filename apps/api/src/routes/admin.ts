// 后台管理路由 —— 数据概览 + 用户列表
//
// 权限：仅 role='admin' 可访问。
// 数据范围：当前登录用户所属公司（多租户下管理员只能看本公司数据）。

import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { calcTotal } from '../services/quoteTotal.js';

/** 报价单状态中文名（pending/approved/rejected 是早期审核流程遗留，兼容老数据） */
const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  pending: '待审核',
  approved: '已审核',
  rejected: '已驳回',
  sent: '已发送',
  confirmed: '已成交',
  expired: '已过期',
};

/**
 * 先鉴权再判角色。
 * 注意：app.authenticate 失败时只 reply 401 并不抛错，必须检查 reply.sent，
 * 否则会在未登录的情况下继续往下走。
 */
function requireAdmin(app: FastifyInstance) {
  return async (req: any, reply: any) => {
    await app.authenticate(req, reply);
    if (reply.sent) return;
    if (req.user?.role !== 'admin') {
      return reply.code(403).send({ error: '仅管理员可访问' });
    }
  };
}

export async function adminRoutes(app: FastifyInstance) {
  // ================================================================
  // 数据概览
  // ================================================================
  app.get('/api/admin/overview', { preHandler: [requireAdmin(app)] }, async (req) => {
    const { companyId } = req.user as any;

    const [company, userCount, customerCount, quoteCount, statusGroups, quotes] = await Promise.all([
      prisma.company.findUnique({
        where: { id: companyId },
        select: { id: true, name: true, createdAt: true },
      }),
      prisma.user.count({ where: { companyId } }),
      prisma.customer.count({ where: { companyId } }),
      prisma.quote.count({ where: { companyId } }),
      prisma.quote.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true } }),
      // 金额合计：取每张报价单的最新版本快照
      prisma.quote.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          status: true,
          createdAt: true,
          versions: { orderBy: { versionNo: 'desc' }, take: 1, select: { calcResultJson: true } },
        },
      }),
    ]);

    const totalAmount = quotes.reduce((s, q) => s + calcTotal(q.versions[0]?.calcResultJson), 0);
    const confirmedAmount = quotes
      .filter((q) => q.status === 'confirmed')
      .reduce((s, q) => s + calcTotal(q.versions[0]?.calcResultJson), 0);

    const since = new Date(Date.now() - 30 * 86400000);
    const [newUsers, newQuotes] = await Promise.all([
      prisma.user.count({ where: { companyId, createdAt: { gte: since } } }),
      prisma.quote.count({ where: { companyId, createdAt: { gte: since } } }),
    ]);

    return {
      company,
      counts: { users: userCount, customers: customerCount, quotes: quoteCount },
      recent30: { users: newUsers, quotes: newQuotes },
      amount: {
        total: Math.round(totalAmount * 100) / 100,
        confirmed: Math.round(confirmedAmount * 100) / 100,
        basedOn: quotes.length,
      },
      byStatus: statusGroups
        .map((g) => ({
          status: g.status,
          label: STATUS_LABEL[g.status] ?? g.status,
          count: (g._count as any)?._all ?? 0,
        }))
        .sort((a, b) => b.count - a.count),
    };
  });

  // ================================================================
  // 用户列表（含每人的报价统计）
  // ================================================================
  app.get('/api/admin/users', { preHandler: [requireAdmin(app)] }, async (req) => {
    const { companyId } = req.user as any;

    const [users, quotes] = await Promise.all([
      prisma.user.findMany({
        where: { companyId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          emailVerified: true,
          createdAt: true,
          lastLoginAt: true,
        },
      }),
      prisma.quote.findMany({
        where: { companyId },
        select: {
          createdById: true,
          status: true,
          versions: { orderBy: { versionNo: 'desc' }, take: 1, select: { calcResultJson: true } },
        },
      }),
    ]);

    type Stat = { quotes: number; amount: number; confirmed: number };
    const stat = new Map<string, Stat>();
    for (const q of quotes) {
      const s: Stat = stat.get(q.createdById) ?? { quotes: 0, amount: 0, confirmed: 0 };
      s.quotes += 1;
      const amt = calcTotal(q.versions[0]?.calcResultJson);
      s.amount += amt;
      if (q.status === 'confirmed') s.confirmed += amt;
      stat.set(q.createdById, s);
    }

    return users.map((u) => {
      const s: Stat = stat.get(u.id) ?? { quotes: 0, amount: 0, confirmed: 0 };
      return {
        ...u,
        stats: {
          quotes: s.quotes,
          amount: Math.round(s.amount * 100) / 100,
          confirmedAmount: Math.round(s.confirmed * 100) / 100,
        },
      };
    });
  });
}
