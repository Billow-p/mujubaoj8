// 报价单路由 — CRUD + 状态机 + Excel 导出
// 流程：创建草稿 → （可选发邮件/客户确认）→ 已成交
// 设计：去掉了"审核"环节，提交即生成正式报价单（按业务方要求）

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { calculateQuote, validateQuoteInput } from '@mqs/calc-engine';
import type { CalcQuoteRequest } from '@mqs/shared';
import { sendQuoteNotification } from '../services/email.js';
import { buildQuoteExcel } from '../services/excel.js';

const CreateQuoteSchema = z.object({
  customerId: z.string().optional(),
  customerName: z.string().min(1),
  customerEmail: z.string().email().optional(), // 新增：客户邮箱（直发场景）
  input: z.any(), // QuoteInput - 已校验（含 extras/customParams）
});

const UpdateQuoteSchema = z.object({
  input: z.any(),
  overrides: z.record(z.string(), z.number()).optional(),
  locks: z.array(z.string()).optional(),
  businessTermOverrides: z
    .array(z.object({ index: z.number(), enabled: z.boolean(), text: z.string() }))
    .optional(),
  changeNote: z.string().optional(),
});

function genQuoteNo(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `BJ-${date}-${seq}`;
}

function genShareToken(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

export async function quoteRoutes(app: FastifyInstance) {
  // 列表（多维筛选）
  app.get('/api/quotes', { preHandler: [app.authenticate] }, async (req) => {
    const { companyId } = req.user as any;
    const q = req.query as any;
    const where: any = { companyId };
    if (q.status) where.status = q.status;
    if (q.customerId) where.customerId = q.customerId;
    if (q.productName) where.versions = { some: { paramsJson: { path: ['productName'], equals: q.productName } } };
    if (q.material) where.versions = { some: { paramsJson: { path: ['material'], equals: q.material } } };
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = new Date(q.from);
      if (q.to) where.createdAt.lte = new Date(q.to);
    }

    const quotes = await prisma.quote.findMany({
      where,
      include: {
        customer: true,
        createdBy: { select: { id: true, name: true } },
        versions: {
          orderBy: { versionNo: 'desc' },
          take: 1,
          select: { paramsJson: true, calcResultJson: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return quotes.map((q: any) => ({
      id: q.id,
      quoteNo: q.quoteNo,
      status: q.status,
      customerName: q.customer?.name || '',
      customerEmail: q.customer?.email || '',
      productName: (q.versions[0]?.paramsJson as any)?.productName || '',
      grandTotal: (q.versions[0]?.calcResultJson as any)?.summary?.grandTotalIncVat || 0,
      createdBy: q.createdBy.name,
      createdAt: q.createdAt,
      expiresAt: q.expiresAt,
    }));
  });

  // 详情（最新版本）
  app.get('/api/quotes/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const quote = await prisma.quote.findFirst({
      where: { id, companyId },
      include: {
        customer: true,
        createdBy: { select: { id: true, name: true, email: true } },
        approvedBy: { select: { id: true, name: true } },
        versions: { orderBy: { versionNo: 'desc' } },
        shares: true,
        logs: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!quote) return reply.code(404).send({ error: '报价单不存在' });
    return quote;
  });

  // 所有版本列表
  app.get('/api/quotes/:id/versions', { preHandler: [app.authenticate] }, async (req) => {
    const { companyId } = req.user as any;
    const { id } = req.params as any;
    const versions = await prisma.quoteVersion.findMany({
      where: { quote: { id, companyId } },
      orderBy: { versionNo: 'desc' },
      select: {
        id: true,
        versionNo: true,
        createdAt: true,
        changeNote: true,
        calcResultJson: true,
      },
    });
    return versions.map((v: any) => ({
      id: v.id,
      versionNo: v.versionNo,
      createdAt: v.createdAt,
      changeNote: v.changeNote,
      grandTotal: (v.calcResultJson as any).summary.grandTotalIncVat,
    }));
  });

  // 指定版本
  app.get(
    '/api/quotes/:id/versions/:versionNo',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { companyId } = req.user as any;
      const { id, versionNo } = req.params as any;
      const v = await prisma.quoteVersion.findFirst({
        where: { versionNo: parseInt(versionNo), quote: { id, companyId } },
      });
      if (!v) return reply.code(404).send({ error: '版本不存在' });
      return v;
    },
  );

  // ================================================================
  // 创建报价单
  // 行为：
  //   1) 找到或创建客户（客户邮箱会一并写进 Customer.email）
  //   2) 落库（含 input.extras、input.customParams 在 paramsJson 内）
  //   3) 若 customerEmail 给了 → 直接进入 'sent' 状态，生成分享链接+发邮件
  // ================================================================
  app.post('/api/quotes', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId, userId } = req.user as any;
    const body = CreateQuoteSchema.parse(req.body);

    const errors = validateQuoteInput(body.input);
    if (errors.length > 0) {
      return reply.code(400).send({ validationErrors: errors });
    }

    const result = calculateQuote({ input: body.input });

    // 找到或创建客户
    let customerId = body.customerId;
    if (!customerId && body.customerName) {
      const existing = await prisma.customer.findFirst({
        where: { companyId, name: body.customerName },
      });
      if (existing) {
        customerId = existing.id;
        // 若已有客户且传了新邮箱，则更新
        if (body.customerEmail && existing.email !== body.customerEmail) {
          await prisma.customer.update({
            where: { id: existing.id },
            data: { email: body.customerEmail },
          });
        }
      } else {
        const c = await prisma.customer.create({
          data: {
            companyId,
            name: body.customerName,
            email: body.customerEmail || null,
          },
        });
        customerId = c.id;
      }
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const autoSend = !!body.customerEmail;
    const quote = await prisma.quote.create({
      data: {
        companyId,
        customerId,
        createdById: userId,
        quoteNo: genQuoteNo(),
        status: autoSend ? 'sent' : 'draft',
        expiresAt,
        sentAt: autoSend ? new Date() : null,
        versions: {
          create: {
            versionNo: 1,
            paramsJson: body.input as any,
            calcResultJson: result as any,
            businessTermsJson: result.businessTerms as any,
            createdById: userId,
            changeNote: '初始创建',
          },
        },
        logs: {
          create: {
            userId,
            action: autoSend ? 'sent' : 'created',
            detail: autoSend
              ? `创建并直发至客户邮箱 ${body.customerEmail}`
              : '创建报价单',
          },
        },
      },
      include: { versions: true },
    });

    // 若指定了客户邮箱：生成分享链接 + 发邮件（不阻塞主流程）
    let emailSent = false;
    let emailError: string | null = null;
    let shareUrl: string | null = null;
    if (autoSend && body.customerEmail) {
      const version = quote.versions[0];
      const summary = result.summary;
      const share = await prisma.quoteShare.create({
        data: {
          quoteId: quote.id,
          versionId: version.id,
          shareToken: genShareToken(),
          email: body.customerEmail,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      shareUrl = `${process.env.PUBLIC_WEB_URL || 'http://47.242.248.104'}/share/${share.shareToken}`;

      const me = await prisma.user.findUnique({ where: { id: userId } });
      const emailResult = await sendQuoteNotification({
        to: body.customerEmail,
        customerName: body.customerName,
        quoteNo: quote.quoteNo,
        productName: body.input.productName,
        grandTotalIncVat: summary.grandTotalIncVat,
        moldTotalExVat: summary.moldTotalExVat,
        unitCostExVat: summary.unitCostExVat,
        firstOrderQty: body.input.firstOrderQty,
        validUntil: expiresAt,
        shareUrl,
        senderName: me?.name || '报价员',
      });
      emailSent = emailResult.ok;
      emailError = emailResult.ok ? null : emailResult.error;

      await prisma.quoteEmailLog.create({
        data: {
          quoteId: quote.id,
          versionId: version.id,
          toEmail: body.customerEmail,
          subject: `【报价单】${quote.quoteNo} — ${body.input.productName}`,
          status: emailSent ? 'sent' : 'failed',
          errorMsg: emailError,
          sentById: userId,
        },
      });
    }

    return {
      ...quote,
      autoSend,
      emailSent,
      emailError,
      shareUrl,
    };
  });

  // ================================================================
  // 修改参数（自动派生新版本）
  // ================================================================
  app.patch(
    '/api/quotes/:id/versions/:versionNo',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { companyId, userId } = req.user as any;
      const { id, versionNo } = req.params as any;
      const body = UpdateQuoteSchema.parse(req.body);

      const currentQuote = await prisma.quote.findFirst({
        where: { id, companyId },
        include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } },
      });
      if (!currentQuote) return reply.code(404).send({ error: '报价单不存在' });

      const latestVersion = currentQuote.versions[0];
      if (latestVersion.versionNo !== parseInt(versionNo)) {
        return reply.code(400).send({ error: '只能修改最新版本' });
      }
      if (['sent', 'confirmed'].includes(currentQuote.status)) {
        return reply.code(400).send({ error: '已发送/已确认的报价单不可修改' });
      }

      const errors = validateQuoteInput(body.input);
      if (errors.length > 0) {
        return reply.code(400).send({ validationErrors: errors });
      }

      const calcReq: CalcQuoteRequest = {
        input: body.input,
        overrides: body.overrides as any,
        locks: body.locks as any,
        businessTermOverrides: body.businessTermOverrides,
      };
      const result = calculateQuote(calcReq);

      const newVersion = await prisma.quoteVersion.create({
        data: {
          quoteId: id,
          versionNo: latestVersion.versionNo + 1,
          parentVersionId: latestVersion.id,
          paramsJson: body.input as any,
          calcResultJson: result as any,
          businessTermsJson: result.businessTerms as any,
          createdById: userId,
          changeNote: body.changeNote,
        },
      });

      await prisma.quote.update({
        where: { id },
        data: { updatedAt: new Date() },
      });

      await prisma.quoteLog.create({
        data: {
          quoteId: id,
          userId,
          action: 'edited',
          detail: `派生 v${newVersion.versionNo}：${body.changeNote || '参数调整'}`,
        },
      });

      return newVersion;
    },
  );

  // ================================================================
  // 发送（生成分享链接 + 邮件通知客户）
  // 适用场景：draft 想补发邮件 / sent 状态再次发送
  // ================================================================
  app.post(
    '/api/quotes/:id/send',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { companyId, userId } = req.user as any;
      const { id } = req.params as any;
      const body = z
        .object({
          email: z.string().email('邮箱格式不正确'),
          sendEmail: z.boolean().optional().default(true),
        })
        .parse(req.body);

      const q = await prisma.quote.findFirst({
        where: { id, companyId },
        include: {
          versions: { orderBy: { versionNo: 'desc' }, take: 1 },
          customer: true,
          createdBy: { select: { name: true } },
        },
      });
      if (!q) return reply.code(404).send({ error: '报价单不存在' });
      if (['confirmed', 'expired'].includes(q.status)) {
        return reply.code(400).send({ error: '当前状态不可发送' });
      }

      const version = q.versions[0];
      const calc = version.calcResultJson as any;
      const params = version.paramsJson as any;
      const summary = calc?.summary || {};

      const share = await prisma.quoteShare.create({
        data: {
          quoteId: id,
          versionId: version.id,
          shareToken: genShareToken(),
          email: body.email,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      await prisma.quote.update({
        where: { id },
        data: { status: 'sent', sentAt: q.sentAt || new Date() },
      });

      await prisma.quoteLog.create({
        data: {
          quoteId: id,
          userId,
          action: 'sent',
          detail: `发送给 ${body.email}`,
        },
      });

      const shareUrl = `${process.env.PUBLIC_WEB_URL || 'http://47.242.248.104'}/share/${share.shareToken}`;

      let emailResult: { ok: boolean; error?: string } = { ok: false, error: '未发送' };
      if (body.sendEmail) {
        emailResult = await sendQuoteNotification({
          to: body.email,
          customerName: q.customer?.name || '客户',
          quoteNo: q.quoteNo,
          productName: params?.productName || '产品',
          grandTotalIncVat: summary.grandTotalIncVat || 0,
          moldTotalExVat: summary.moldTotalExVat || 0,
          unitCostExVat: summary.unitCostExVat || 0,
          firstOrderQty: params?.firstOrderQty || 0,
          validUntil: q.expiresAt,
          shareUrl,
          senderName: q.createdBy?.name || '报价员',
        });

        await prisma.quoteEmailLog.create({
          data: {
            quoteId: id,
            versionId: version.id,
            toEmail: body.email,
            subject: `【报价单】${q.quoteNo} — ${params?.productName || '产品'}`,
            status: emailResult.ok ? 'sent' : 'failed',
            errorMsg: emailResult.ok ? null : emailResult.error,
            sentById: userId,
          },
        });
      }

      return {
        shareToken: share.shareToken,
        shareUrl: `/share/${share.shareToken}`,
        fullShareUrl: shareUrl,
        emailSent: emailResult.ok,
        emailError: emailResult.ok ? null : emailResult.error,
      };
    },
  );

  // ================================================================
  // 单独重发报价单邮件（不改状态，仅重发通知）
  // ================================================================
  app.post(
    '/api/quotes/:id/resend-email',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { companyId, userId } = req.user as any;
      const { id } = req.params as any;
      const body = z.object({ email: z.string().email() }).parse(req.body);

      const q = await prisma.quote.findFirst({
        where: { id, companyId },
        include: {
          versions: { orderBy: { versionNo: 'desc' }, take: 1 },
          customer: true,
          createdBy: { select: { name: true } },
          shares: { orderBy: { expiresAt: 'desc' }, take: 1 },
        },
      });
      if (!q) return reply.code(404).send({ error: '报价单不存在' });

      const share = q.shares[0];
      if (!share) {
        return reply.code(400).send({ error: '请先生成分享链接' });
      }

      const version = q.versions[0];
      const calc = version.calcResultJson as any;
      const params = version.paramsJson as any;
      const summary = calc?.summary || {};
      const shareUrl = `${process.env.PUBLIC_WEB_URL || 'http://47.242.248.104'}/share/${share.shareToken}`;

      const result = await sendQuoteNotification({
        to: body.email,
        customerName: q.customer?.name || '客户',
        quoteNo: q.quoteNo,
        productName: params?.productName || '产品',
        grandTotalIncVat: summary.grandTotalIncVat || 0,
        moldTotalExVat: summary.moldTotalExVat || 0,
        unitCostExVat: summary.unitCostExVat || 0,
        firstOrderQty: params?.firstOrderQty || 0,
        validUntil: q.expiresAt,
        shareUrl,
        senderName: q.createdBy?.name || '报价员',
      });

      await prisma.quoteEmailLog.create({
        data: {
          quoteId: id,
          versionId: version.id,
          toEmail: body.email,
          subject: `【报价单】${q.quoteNo} — ${params?.productName || '产品'}`,
          status: result.ok ? 'sent' : 'failed',
          errorMsg: result.ok ? null : result.error,
          sentById: userId,
        },
      });

      if (!result.ok) return reply.code(500).send({ error: result.error });
      return { ok: true, message: '邮件已发送' };
    },
  );

  // ================================================================
  // 邮件发送记录
  // ================================================================
  app.get(
    '/api/quotes/:id/email-logs',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { companyId } = req.user as any;
      const { id } = req.params as any;
      const q = await prisma.quote.findFirst({ where: { id, companyId } });
      if (!q) return reply.code(404).send({ error: '报价单不存在' });
      return prisma.quoteEmailLog.findMany({
        where: { quoteId: id },
        orderBy: { createdAt: 'desc' },
      });
    },
  );

  // ================================================================
  // Excel 导出（下载 .xlsx）
  // ================================================================
  app.get(
    '/api/quotes/:id/export-excel',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { companyId } = req.user as any;
      const { id } = req.params as any;
      const q = await prisma.quote.findFirst({
        where: { id, companyId },
        include: {
          versions: { orderBy: { versionNo: 'desc' }, take: 1 },
          customer: true,
          createdBy: { select: { name: true } },
        },
      });
      if (!q) return reply.code(404).send({ error: '报价单不存在' });

      const version = q.versions[0];
      if (!version) return reply.code(400).send({ error: '报价单无可用版本' });

      const buf = await buildQuoteExcel({
        quoteNo: q.quoteNo,
        customerName: q.customer?.name || '',
        productName: (version.paramsJson as any)?.productName || '',
        input: version.paramsJson as any,
        result: version.calcResultJson as any,
        businessTerms: (version.businessTermsJson as any) || undefined,
        senderName: q.createdBy?.name,
        createdAt: q.createdAt,
      });

      reply
        .header(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        .header(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(`报价单_${q.quoteNo}.xlsx`)}"`,
        )
        .send(buf);
    },
  );

  // ================================================================
  // 客户通过分享链接确认
  // ================================================================
  app.post('/api/share/:token/confirm', async (req, reply) => {
    const { token } = req.params as any;
    const share = await prisma.quoteShare.findUnique({
      where: { shareToken: token },
      include: { quote: true },
    });
    if (!share) return reply.code(404).send({ error: '链接无效' });
    if (share.expiresAt < new Date()) {
      return reply.code(400).send({ error: '链接已过期' });
    }
    await prisma.quoteShare.update({
      where: { id: share.id },
      data: { confirmedAt: new Date() },
    });
    await prisma.quote.update({
      where: { id: share.quoteId },
      data: { status: 'confirmed', confirmedAt: new Date() },
    });
    await prisma.quoteLog.create({
      data: {
        quoteId: share.quoteId,
        action: 'confirmed',
        detail: `客户 ${share.email} 已确认`,
      },
    });
    return { ok: true };
  });
}