// 邮件服务 — QQ 邮箱 SMTP
// 覆盖三个场景：
//   1. register       用户注册验证码
//   2. reset_password 找回密码验证码
//   3. quote_notify   客户报价单邮件通知（含报价单链接）

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { randomInt } from 'node:crypto';
import { prisma } from '../db.js';

// ------------------------------------------------------------------
// 配置
// ------------------------------------------------------------------
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.qq.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = (process.env.SMTP_SECURE || 'true') === 'true';
const SMTP_USER = process.env.SMTP_USER || '729503962@qq.com';
const SMTP_PASS = process.env.SMTP_PASS || 'zdxcbqeinqokbcec';
const SMTP_FROM = process.env.SMTP_FROM || `模具注塑报价系统 <${SMTP_USER}>`;

// 验证码有效期（分钟）
const CODE_TTL_MINUTES = 10;
// 同一邮箱发送间隔（秒），防刷
const RESEND_INTERVAL_SEC = 60;

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE, // QQ 邮箱 465 端口用 SSL
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
  });
  return transporter;
}

export type CodeScene = 'register' | 'reset_password';

const SCENE_LABEL: Record<CodeScene, string> = {
  register: '注册账号',
  reset_password: '找回密码',
};

// ------------------------------------------------------------------
// 生成 6 位数字验证码
// ------------------------------------------------------------------
function generateCode(): string {
  // 用 crypto 保证随机性（不用 Math.random，防止被预测）
  return String(randomInt(100000, 1000000)).padStart(6, '0');
}

// ------------------------------------------------------------------
// 发送验证码
// ------------------------------------------------------------------
export async function sendVerificationCode(
  email: string,
  scene: CodeScene,
): Promise<{ ok: true; expiresInSec: number } | { ok: false; error: string }> {
  const normalized = email.trim().toLowerCase();

  // 1. 频控：同一邮箱 + 同一场景，60 秒内只能发一次
  const recent = await prisma.emailVerification.findFirst({
    where: {
      email: normalized,
      scene,
      createdAt: { gte: new Date(Date.now() - RESEND_INTERVAL_SEC * 1000) },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) {
    const waitSec = Math.ceil(
      (recent.createdAt.getTime() + RESEND_INTERVAL_SEC * 1000 - Date.now()) / 1000,
    );
    return { ok: false, error: `发送过于频繁，请 ${waitSec} 秒后再试` };
  }

  // 2. 注册场景：邮箱不能已被注册
  if (scene === 'register') {
    const exists = await prisma.user.findUnique({ where: { email: normalized } });
    if (exists) return { ok: false, error: '该邮箱已被注册，请直接登录' };
  }

  // 3. 找回密码场景：邮箱必须已注册
  if (scene === 'reset_password') {
    const exists = await prisma.user.findUnique({ where: { email: normalized } });
    if (!exists) return { ok: false, error: '该邮箱未注册' };
  }

  // 4. 作废该邮箱该场景下的旧验证码
  await prisma.emailVerification.updateMany({
    where: { email: normalized, scene, used: false },
    data: { used: true },
  });

  // 5. 生成并落库
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
  await prisma.emailVerification.create({
    data: { email: normalized, code, scene, expiresAt },
  });

  // 6. 发邮件
  const label = SCENE_LABEL[scene];
  const html = renderCodeEmail(code, label, CODE_TTL_MINUTES);

  try {
    const info = await getTransporter().sendMail({
      from: SMTP_FROM,
      to: normalized,
      subject: `【模具注塑报价系统】${label}验证码`,
      html,
      text: `您的${label}验证码是：${code}，${CODE_TTL_MINUTES} 分钟内有效。请勿告知他人。`,
    });
    console.log(`[email] code sent to ${normalized} scene=${scene} msgId=${info.messageId}`);
    return { ok: true, expiresInSec: CODE_TTL_MINUTES * 60 };
  } catch (e: any) {
    console.error('[email] send code failed:', e);
    return { ok: false, error: `邮件发送失败：${e?.message || '未知错误'}` };
  }
}

// ------------------------------------------------------------------
// 校验验证码（校验通过后自动作废，一次性）
// ------------------------------------------------------------------
export async function verifyCode(
  email: string,
  code: string,
  scene: CodeScene,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = email.trim().toLowerCase();
  const trimmed = (code || '').trim();

  const record = await prisma.emailVerification.findFirst({
    where: { email: normalized, scene, used: false },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) return { ok: false, error: '请先获取验证码' };
  if (record.expiresAt < new Date()) return { ok: false, error: '验证码已过期，请重新获取' };
  if (record.code !== trimmed) return { ok: false, error: '验证码错误' };

  // 一次性：校验通过即作废
  await prisma.emailVerification.update({
    where: { id: record.id },
    data: { used: true },
  });

  return { ok: true };
}

// ------------------------------------------------------------------
// 发送报价单邮件通知给客户
// ------------------------------------------------------------------
export interface QuoteNotifyPayload {
  to: string;
  customerName: string;
  quoteNo: string;
  productName: string;
  grandTotalIncVat: number;
  moldTotalExVat: number;
  unitCostExVat: number;
  firstOrderQty: number;
  validUntil: Date | null;
  shareUrl: string;
  senderName: string;
}

export async function sendQuoteNotification(
  payload: QuoteNotifyPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const to = payload.to.trim().toLowerCase();
  const html = renderQuoteEmail(payload);

  try {
    const info = await getTransporter().sendMail({
      from: SMTP_FROM,
      to,
      subject: `【报价单】${payload.quoteNo} — ${payload.productName}`,
      html,
      text:
        `您好 ${payload.customerName}：\n\n` +
        `您询价的「${payload.productName}」报价单已出具。\n` +
        `模具费：¥${payload.moldTotalExVat.toLocaleString('zh-CN')}\n` +
        `单件成本：¥${payload.unitCostExVat.toFixed(2)}\n` +
        `首单 ${payload.firstOrderQty.toLocaleString('zh-CN')} 件含税总计：` +
        `¥${payload.grandTotalIncVat.toLocaleString('zh-CN')}\n\n` +
        `在线查看：${payload.shareUrl}\n` +
        (payload.validUntil
          ? `报价有效期至：${payload.validUntil.toLocaleDateString('zh-CN')}\n`
          : '') +
        `\n—— ${payload.senderName}`,
    });
    console.log(`[email] quote notify sent to ${to} quote=${payload.quoteNo} msgId=${info.messageId}`);
    return { ok: true };
  } catch (e: any) {
    console.error('[email] quote notify failed:', e);
    return { ok: false, error: `邮件发送失败：${e?.message || '未知错误'}` };
  }
}

// ------------------------------------------------------------------
// 邮件模板
// ------------------------------------------------------------------
function renderCodeEmail(code: string, label: string, ttlMinutes: number): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
        <tr>
          <td style="background:#1e40af;padding:24px 32px;">
            <div style="color:#ffffff;font-size:18px;font-weight:600;letter-spacing:.5px;">模具注塑报价系统</div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <div style="color:#111827;font-size:16px;line-height:1.6;">
              您好，您正在进行<strong>${label}</strong>操作。
            </div>
            <div style="color:#6b7280;font-size:14px;line-height:1.6;margin-top:8px;">
              请在页面中输入下方验证码完成验证：
            </div>
            <div style="margin:28px 0;text-align:center;">
              <div style="display:inline-block;background:#f3f4f6;border:1px dashed #d1d5db;border-radius:8px;padding:16px 32px;">
                <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#1e40af;font-family:'SF Mono',Consolas,monospace;">${code}</span>
              </div>
            </div>
            <div style="color:#9ca3af;font-size:13px;line-height:1.6;">
              · 验证码 ${ttlMinutes} 分钟内有效，请尽快使用<br>
              · 请勿将验证码告知任何人<br>
              · 若非本人操作，请忽略此邮件
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
            <div style="color:#9ca3af;font-size:12px;">本邮件由系统自动发送，请勿直接回复</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function renderQuoteEmail(p: QuoteNotifyPayload): string {
  const money = (n: number) => '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const validText = p.validUntil
    ? p.validUntil.toLocaleDateString('zh-CN')
    : '—';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
        <tr>
          <td style="background:#1e40af;padding:24px 32px;">
            <div style="color:#ffffff;font-size:18px;font-weight:600;">报价单 ${p.quoteNo}</div>
            <div style="color:#bfdbfe;font-size:13px;margin-top:4px;">${p.productName}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <div style="color:#111827;font-size:15px;line-height:1.7;">
              您好 <strong>${p.customerName}</strong>：
            </div>
            <div style="color:#374151;font-size:14px;line-height:1.7;margin-top:12px;">
              您询价的「${p.productName}」报价已出具，详情如下：
            </div>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              <tr style="background:#f9fafb;">
                <td style="padding:12px 16px;color:#6b7280;font-size:13px;border-bottom:1px solid #e5e7eb;">费用项</td>
                <td align="right" style="padding:12px 16px;color:#6b7280;font-size:13px;border-bottom:1px solid #e5e7eb;">金额</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;color:#374151;font-size:14px;border-bottom:1px solid #f3f4f6;">模具费（不含税）</td>
                <td align="right" style="padding:12px 16px;color:#111827;font-size:14px;border-bottom:1px solid #f3f4f6;">${money(p.moldTotalExVat)}</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;color:#374151;font-size:14px;border-bottom:1px solid #f3f4f6;">单件成本（不含税）</td>
                <td align="right" style="padding:12px 16px;color:#111827;font-size:14px;border-bottom:1px solid #f3f4f6;">${money(p.unitCostExVat)}</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;color:#374151;font-size:14px;border-bottom:1px solid #f3f4f6;">首单数量</td>
                <td align="right" style="padding:12px 16px;color:#111827;font-size:14px;border-bottom:1px solid #f3f4f6;">${p.firstOrderQty.toLocaleString('zh-CN')} 件</td>
              </tr>
              <tr style="background:#eff6ff;">
                <td style="padding:14px 16px;color:#1e40af;font-size:14px;font-weight:600;">含税总计</td>
                <td align="right" style="padding:14px 16px;color:#1e40af;font-size:16px;font-weight:700;">${money(p.grandTotalIncVat)}</td>
              </tr>
            </table>

            <div style="color:#6b7280;font-size:13px;margin-bottom:20px;">
              报价有效期至：${validText}
            </div>

            <div style="text-align:center;margin:28px 0;">
              <a href="${p.shareUrl}" style="display:inline-block;background:#1e40af;color:#ffffff;text-decoration:none;padding:13px 36px;border-radius:8px;font-size:15px;font-weight:600;">
                在线查看完整报价单
              </a>
            </div>

            <div style="color:#9ca3af;font-size:12px;line-height:1.7;border-top:1px solid #f3f4f6;padding-top:16px;">
              若按钮无法点击，请复制以下链接到浏览器打开：<br>
              <span style="color:#6b7280;word-break:break-all;">${p.shareUrl}</span>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
            <div style="color:#6b7280;font-size:13px;">报价人：${p.senderName}</div>
            <div style="color:#9ca3af;font-size:12px;margin-top:4px;">本邮件由系统自动发送，请勿直接回复</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ------------------------------------------------------------------
// 启动自检：验证 SMTP 可连通
// ------------------------------------------------------------------
export async function verifySmtpConnection(): Promise<boolean> {
  try {
    await getTransporter().verify();
    console.log('[email] SMTP connection verified:', SMTP_USER);
    return true;
  } catch (e: any) {
    console.error('[email] SMTP verify failed:', e?.message || e);
    return false;
  }
}