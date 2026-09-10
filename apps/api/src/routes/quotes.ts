// 报价单路由 — CRUD + 状态机 + Excel 导出
// 流程：创建草稿 → （可选发邮件/客户确认）→ 已成交
// 设计：去掉了"审核"环节，提交即生成正式报价单（按业务方要求）

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { calculateQuote, validateQuoteInput } from '@mqs/calc-engine';
import type { CalcQuoteRequest, QuoteItemDef } from '@mqs/shared';
import { sendQuoteNotification } from '../services/email.js';
import { buildQuoteExcel } from '../services/excel.js';
import { toExcelModel } from '../services/quoteModel.js';
import { calculateConfigured } from '@mqs/calc-engine';

const CreateQuoteSchema = z.object({
  customerId: z.string().optional(),
  customerName: z.string().min(1),
  customerEmail: z.string().email().optional(), // 新增：客户邮箱（直发场景）
  input: z.any(), // QuoteInput - 已校验（含 extras/customParams）
  customFormulas: z.array(z.any()).optional(), // 参数中心 — 用户公式
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

/** 报价单含税总价 —— 兼容两代数据结构（配置驱动 lines / 老 11 项 summary） */
function calcTotal(calc: any): number {
  if (!calc) return 0;
  if (Array.isArray(calc.lines)) return Number(calc.total) || 0;
  return Number(calc.summary?.grandTotalIncVat) || 0;
}

/** 参数下拉选项存在 String 字段里（JSON），解析失败就当没有 */
function parseParamOptions(raw: string | null | undefined): { label: string; value: number }[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// 加载企业已启用的报价项（PRD 5.9：报价项自动参与计算并随版本冻结）
async function loadEnabledFormulas(companyId: string) {
  const items = await prisma.customFormula.findMany({
    where: { companyId, enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return items.map((f) => ({
    name: f.name,
    scope: f.scope as 'mold' | 'injection' | 'summary',
    expression: f.expression,
    condition: f.condition ?? undefined,
    code: f.code ?? undefined,
    category: f.category ?? undefined,
    unit: f.unit ?? undefined,
    version: f.version,
    enabled: true,
    sortOrder: f.sortOrder,
    note: f.note ?? undefined,
  }));
}

// 合并：企业启用项 + 请求方显式传入项（按 name 去重，传入优先）
function mergeFormulas(
  fromDb: Awaited<ReturnType<typeof loadEnabledFormulas>>,
  fromBody: any[] | undefined,
) {
  if (!fromBody || fromBody.length === 0) return fromDb;
  const names = new Set(fromBody.map((f: any) => f?.name).filter(Boolean));
  return [...fromBody, ...fromDb.filter((f) => !names.has(f.name))];
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
      grandTotal: calcTotal(q.versions[0]?.calcResultJson),
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
      grandTotal: calcTotal(v.calcResultJson),
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

    const companyFormulas = await loadEnabledFormulas(companyId);
    const formulas = mergeFormulas(companyFormulas, body.customFormulas);

    const result = calculateQuote({
      input: body.input,
      customFormulas: formulas,
    });

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
            paramsJson: { ...body.input, customFormulas: formulas } as any,
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

      // 报价项：沿用该版本冻结的，或重新取企业启用项（PRD 5.9）
      const frozen = (latestVersion.paramsJson as any)?.customFormulas;
      const formulas = Array.isArray(frozen) && frozen.length > 0
        ? frozen
        : await loadEnabledFormulas(companyId);

      const calcReq: CalcQuoteRequest = {
        input: body.input,
        overrides: body.overrides as any,
        locks: body.locks as any,
        businessTermOverrides: body.businessTermOverrides,
        customFormulas: formulas,
      };
      const result = calculateQuote(calcReq);

      const newVersion = await prisma.quoteVersion.create({
        data: {
          quoteId: id,
          versionNo: latestVersion.versionNo + 1,
          parentVersionId: latestVersion.id,
          paramsJson: { ...body.input, customFormulas: formulas } as any,
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

      // 邮件里的金额同样要兼容两代结构：配置驱动取 calc 顶层，老模型取 summary
      const cfgMail = Array.isArray(calc?.lines);

      let emailResult: { ok: boolean; error?: string } = { ok: false, error: '未发送' };
      if (body.sendEmail) {
        emailResult = await sendQuoteNotification({
          to: body.email,
          customerName: q.customer?.name || '客户',
          quoteNo: q.quoteNo,
          productName: params?.productName || '产品',
          grandTotalIncVat: cfgMail ? Number(calc.total) || 0 : summary.grandTotalIncVat || 0,
          moldTotalExVat: cfgMail ? Number(calc.mold) || 0 : summary.moldTotalExVat || 0,
          unitCostExVat: cfgMail ? Number(calc.unitCost) || 0 : summary.unitCostExVat || 0,
          firstOrderQty: cfgMail
            ? Number(calc.injectionQty) || 0
            : Number(params?.values?.['首单数量'] ?? params?.firstOrderQty ?? 0) || 0,
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
      const cfgMail = Array.isArray(calc?.lines);
      const shareUrl = `${process.env.PUBLIC_WEB_URL || 'http://47.242.248.104'}/share/${share.shareToken}`;

      const result = await sendQuoteNotification({
        to: body.email,
        customerName: q.customer?.name || '客户',
        quoteNo: q.quoteNo,
        productName: params?.productName || '产品',
        grandTotalIncVat: cfgMail ? Number(calc.total) || 0 : summary.grandTotalIncVat || 0,
        moldTotalExVat: cfgMail ? Number(calc.mold) || 0 : summary.moldTotalExVat || 0,
        unitCostExVat: cfgMail ? Number(calc.unitCost) || 0 : summary.unitCostExVat || 0,
        firstOrderQty: cfgMail
          ? Number(calc.injectionQty) || 0
          : Number(params?.values?.['首单数量'] ?? params?.firstOrderQty ?? 0) || 0,
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

      const [moldType, company] = await Promise.all([
        q.moldTypeId
          ? prisma.moldType.findUnique({ where: { id: q.moldTypeId }, select: { name: true } })
          : Promise.resolve(null),
        prisma.company.findUnique({ where: { id: q.companyId }, select: { name: true } }),
      ]);

      const model = toExcelModel(q, version, moldType?.name);
      if (company?.name) model.company = { ...(model.company ?? {}), name: company.name };
      const buf = await buildQuoteExcel(model);

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
  // 按配置中心创建报价单（选模具类型 → 填数据 → 自动算价）
  // ================================================================
  app.post('/api/quotes/configured', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { companyId, userId } = req.user as any;
    const body = z
      .object({
        moldTypeId: z.string().min(1),
        customerName: z.string().min(1).max(100),
        customerEmail: z.string().email().optional().or(z.literal('')),
        productName: z.string().max(100).optional(),
        values: z.record(z.union([z.number(), z.string()])).optional().default({}),
        manualAmounts: z.record(z.number()).optional(),
      })
      .parse(req.body);

    const moldType = await prisma.moldType.findFirst({ where: { id: body.moldTypeId, companyId } });
    if (!moldType) return reply.code(404).send({ error: '模具类型不存在' });

    const [parameters, items, terms] = await Promise.all([
      prisma.customParameter.findMany({
        where: { companyId, moldTypeId: moldType.id },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.quoteItem.findMany({
        where: { companyId, moldTypeId: moldType.id },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.businessTerm.findMany({
        where: { companyId, moldTypeId: moldType.id, enabled: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    // 参数值：传入优先，否则用默认值
    const params: Record<string, number> = {};
    for (const p of parameters) {
      const raw = (body.values as any)[p.name];
      const n = Number(raw !== undefined && raw !== '' ? raw : p.defaultValue);
      if (Number.isFinite(n)) params[p.name] = n;
    }
    for (const [k, v] of Object.entries(body.values as any)) {
      const n = Number(v);
      if (Number.isFinite(n) && !(k in params)) params[k] = n;
    }

    // 手填项若本次填了金额，按固定金额参与计算
    const defs: QuoteItemDef[] = items.map((it, i) => {
      const base: QuoteItemDef = {
        name: it.name,
        category: it.category,
        scope: (it.scope as 'mold' | 'injection') ?? 'mold',
        calcType: it.calcType as any,
        calcConfig: (it.calcConfig ?? {}) as any,
        expression: it.expression ?? undefined,
        enabled: it.enabled,
        sortOrder: i,
        // 注塑按件计价：结果是单件成本，再乘注塑数量
        perUnit: (it.scope as string) === 'injection' && (it as any).perUnit === true,
        unit: it.unit ?? undefined,
      };
      const amt = body.manualAmounts?.[it.name];
      if (it.calcType === 'manual' && amt != null) {
        return { ...base, calcType: 'fixed' as const, calcConfig: { amount: amt } };
      }
      return base;
    });

    const result = calculateConfigured(defs, params, {
      profitRate: moldType.profitRate,
      taxRate: moldType.taxRate,
    });

    // 客户：有则复用
    let customerId: string | undefined;
    const existing = await prisma.customer.findFirst({ where: { companyId, name: body.customerName } });
    if (existing) {
      customerId = existing.id;
      if (body.customerEmail && existing.email !== body.customerEmail) {
        await prisma.customer.update({ where: { id: existing.id }, data: { email: body.customerEmail } });
      }
    } else {
      const c = await prisma.customer.create({
        data: { companyId, name: body.customerName, email: body.customerEmail || null },
      });
      customerId = c.id;
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const quote = await prisma.quote.create({
      data: {
        companyId,
        customerId,
        moldTypeId: moldType.id,
        createdById: userId,
        quoteNo: genQuoteNo(),
        status: 'draft',
        expiresAt,
        versions: {
          create: {
            versionNo: 1,
            paramsJson: {
              moldTypeId: moldType.id,
              moldTypeName: moldType.name,
              productName: body.productName ?? '',
              customerName: body.customerName,
              customerEmail: body.customerEmail ?? '',
              // 带上 type/options，报价单与前端才能把下拉参数显示成选项文字而不是 0/1
              parameters: parameters.map((p) => ({
                name: p.name,
                unit: p.unit,
                type: p.type,
                options: parseParamOptions(p.options),
              })),
              values: params,
              manualAmounts: body.manualAmounts ?? {},
              items: defs,
            } as any,
            calcResultJson: result as any,
            businessTermsJson: terms.map((t, i) => ({
              index: i + 1,
              enabled: true,
              text: t.text,
            })) as any,
            createdById: userId,
            changeNote: '按配置创建',
          },
        },
        logs: {
          create: { userId, action: 'created', detail: `按「${moldType.name}」配置创建报价单` },
        },
      },
      include: { versions: true },
    });

    return quote;
  });

  // ================================================================
  // 复制历史报价生成新报价（PRD 6.3：原报价不改变）
  // ================================================================
  app.post(
    '/api/quotes/:id/duplicate',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { companyId, userId } = req.user as any;
      const { id } = req.params as any;
      const src = await prisma.quote.findFirst({
        where: { id, companyId },
        include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } },
      });
      if (!src) return reply.code(404).send({ error: '报价单不存在' });
      const v = src.versions[0];
      if (!v) return reply.code(400).send({ error: '源报价单无可用版本' });

      const input = { ...(v.paramsJson as any) };
      const formulas = Array.isArray(input.customFormulas) ? input.customFormulas : [];

      const errors = validateQuoteInput(input);
      if (errors.length > 0) return reply.code(400).send({ validationErrors: errors });

      const result = calculateQuote({ input, customFormulas: formulas });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const quote = await prisma.quote.create({
        data: {
          companyId,
          customerId: src.customerId,
          createdById: userId,
          quoteNo: genQuoteNo(),
          status: 'draft',
          expiresAt,
          versions: {
            create: {
              versionNo: 1,
              paramsJson: input as any,
              calcResultJson: result as any,
              businessTermsJson: result.businessTerms as any,
              createdById: userId,
              changeNote: `复制自 ${src.quoteNo}`,
            },
          },
          logs: {
            create: {
              userId,
              action: 'created',
              detail: `复制自报价单 ${src.quoteNo}`,
            },
          },
        },
        include: { versions: true },
      });
      return quote;
    },
  );

  // ================================================================
  // 人工调整留痕（PRD 5.6 / P12）
  // 记录系统计算值 → 调整值，并写入新的报价版本
  // ================================================================
  app.post(
    '/api/quotes/:id/adjust',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { companyId, userId } = req.user as any;
      const { id } = req.params as any;
      const body = z
        .object({
          field: z.string().min(1).max(60),
          adjustedValue: z.number(),
          systemValue: z.number().optional(),
          reason: z.string().max(200).optional(),
        })
        .parse(req.body);

      const q = await prisma.quote.findFirst({
        where: { id, companyId },
        include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } },
      });
      if (!q) return reply.code(404).send({ error: '报价单不存在' });
      const latest = q.versions[0];
      if (!latest) return reply.code(400).send({ error: '报价单无可用版本' });

      const calc = latest.calcResultJson as any;
      const systemValue =
        body.systemValue ??
        // 配置驱动下金额在 calc 顶层，老模型在 summary / moldFeeItems
        Number(
          (body.field === 'grandTotalIncVat' && Array.isArray(calc?.lines) ? calc.total : undefined) ??
            calc?.summary?.[body.field] ??
            (body.field === 'unitCostExVat' && Array.isArray(calc?.lines) ? calc.unitCost : undefined) ??
            calc?.moldFeeItems?.[body.field]?.value ??
            0,
        );

      const adjustment = await prisma.quoteAdjustment.create({
        data: {
          quoteId: id,
          versionNo: latest.versionNo,
          field: body.field,
          systemValue,
          adjustedValue: body.adjustedValue,
          reason: body.reason,
          createdById: userId,
        },
      });

      await prisma.quoteLog.create({
        data: {
          quoteId: id,
          userId,
          action: 'adjusted',
          detail: `人工调整「${body.field}」：${systemValue} → ${body.adjustedValue}${
            body.reason ? `（原因：${body.reason}）` : ''
          }`,
        },
      });

      return adjustment;
    },
  );

  app.get(
    '/api/quotes/:id/adjustments',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { companyId } = req.user as any;
      const { id } = req.params as any;
      const q = await prisma.quote.findFirst({ where: { id, companyId } });
      if (!q) return reply.code(404).send({ error: '报价单不存在' });
      return prisma.quoteAdjustment.findMany({
        where: { quoteId: id },
        orderBy: { createdAt: 'desc' },
      });
    },
  );

  // ================================================================
  // 状态流转：成交 / 未成交 / 作废（PRD 5.8）
  // ================================================================
  app.patch(
    '/api/quotes/:id/status',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { companyId, userId } = req.user as any;
      const { id } = req.params as any;
      const body = z
        .object({
          status: z.enum(['draft', 'sent', 'confirmed', 'lost', 'void']),
          note: z.string().max(200).optional(),
        })
        .parse(req.body);

      const q = await prisma.quote.findFirst({ where: { id, companyId } });
      if (!q) return reply.code(404).send({ error: '报价单不存在' });

      const data: any = { status: body.status };
      if (body.status === 'confirmed') data.confirmedAt = new Date();
      if (body.status === 'sent' && !q.sentAt) data.sentAt = new Date();

      await prisma.quote.update({ where: { id }, data });
      await prisma.quoteLog.create({
        data: {
          quoteId: id,
          userId,
          action: body.status,
          detail: `状态变更为 ${body.status}${body.note ? `（${body.note}）` : ''}`,
        },
      });
      return { ok: true, status: body.status };
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