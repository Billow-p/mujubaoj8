// 客户数据一键导出 — 一个工作簿两个 Sheet
//   Sheet1「报价明细」：每张报价单一行（客户 + 产品 + 金额 + 日期 + 状态）
//   Sheet2「客户汇总」：每个客户一行（联系信息 + 报价/成交统计）
// 风格与报价单导出（excel.ts）保持一致。

import ExcelJS from 'exceljs';
import { prisma } from '../db.js';
import { calcTotal } from './quoteTotal.js';
import { QTY_VAR_CANDIDATES } from '@mqs/shared';

const C = {
  brand: 'FF1E40AF',
  brandLight: 'FFEFF6FF',
  text: 'FF111827',
  muted: 'FF6B7280',
  line: 'FFD1D5DB',
  zebra: 'FFF9FAFB',
  confirmedBg: 'FFECFDF5',
  confirmedText: 'FF166534',
};

const MONEY_FMT = '#,##0.00';
const thin = { style: 'thin' as const, color: { argb: C.line } };
const box = { top: thin, left: thin, bottom: thin, right: thin };

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  pending_approval: '待审核',
  rejected: '已驳回',
  sent: '已发送',
  confirmed: '已成交',
  expired: '已过期',
};

const fmtDate = (d?: Date | string | null) => {
  if (!d) return '';
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return '';
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

/** 从报价单参数里取「数量」—— 各模具类型叫法不同，与计算引擎共用同一份候选列表 */
function pickQty(vals: any, params: any): number {
  for (const n of QTY_VAR_CANDIDATES) {
    const v = vals?.[n];
    if (v !== undefined && v !== null && v !== '') return Number(v) || 0;
  }
  return Number(params?.firstOrderQty) || 0;
}

function styleHeader(ws: ExcelJS.Worksheet, cols: { width: number }[], height = 22) {
  ws.columns = cols;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const row = ws.getRow(1);
  row.height = height;
  for (let c = 1; c <= cols.length; c++) {
    const cell = row.getCell(c);
    cell.font = { size: 11, bold: true, color: { argb: C.text }, name: '微软雅黑' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.brandLight } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = box;
  }
}

export async function buildCustomersExcel(companyId: string): Promise<Buffer> {
  const [quotes, customers, confirmedGroups] = await Promise.all([
    prisma.quote.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: true,
        versions: {
          orderBy: { versionNo: 'desc' },
          take: 1,
          select: { calcResultJson: true, paramsJson: true },
        },
      },
    }),
    prisma.customer.findMany({
      where: { companyId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { quotes: true } } },
    }),
    prisma.quote.groupBy({
      by: ['customerId'],
      where: { companyId, status: 'confirmed', customerId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const confirmedMap = new Map(
    confirmedGroups.map((g: any) => [g.customerId, g._count._all as number]),
  );

  // 模具类型名（Quote 无 moldType 关系，单独批量查）
  const moldTypeIds = [...new Set((quotes as any[]).map((q) => q.moldTypeId).filter(Boolean))] as string[];
  const moldTypes = moldTypeIds.length
    ? await prisma.moldType.findMany({ where: { id: { in: moldTypeIds } }, select: { id: true, name: true } })
    : [];
  const moldTypeName = new Map(moldTypes.map((m) => [m.id, m.name]));

  const wb = new ExcelJS.Workbook();
  wb.creator = '模具注塑报价系统';

  // ============ Sheet1 报价明细 ============
  const ws1 = wb.addWorksheet('报价明细', { views: [{ showGridLines: false }] });
  const HEAD1 = [
    '序号', '客户名称', '客户编码', '联系人', '联系电话', '邮箱', '报价单号', '产品名称',
    '模具类型', '材料', '数量', '含税总价(元)', '状态', '报价日期', '有效期至', '成交日期',
  ];
  ws1.addRow(HEAD1);
  styleHeader(ws1, [
    { width: 6 }, { width: 22 }, { width: 12 }, { width: 12 }, { width: 16 }, { width: 24 },
    { width: 22 }, { width: 20 }, { width: 12 }, { width: 14 }, { width: 12 }, { width: 16 },
    { width: 10 }, { width: 12 }, { width: 12 }, { width: 12 },
  ]);

  quotes.forEach((q: any, i: number) => {
    const v = q.versions?.[0];
    const params = (v?.paramsJson ?? {}) as any;
    const vals = (params.values ?? {}) as any;
    const total = calcTotal(v?.calcResultJson);
    const c = q.customer;
    const row = ws1.addRow([
      i + 1,
      c?.name ?? '（无客户）',
      c?.code ?? '',
      c?.contactName ?? '',
      c?.phone ?? '',
      c?.email ?? '',
      q.quoteNo,
      params.productName ?? '',
      moldTypeName.get(q.moldTypeId ?? '') ?? '',
      params.material ?? '',
      pickQty(vals, params),
      total ?? 0,
      STATUS_LABEL[q.status] ?? q.status,
      fmtDate(q.createdAt),
      fmtDate(q.expiresAt),
      fmtDate(q.confirmedAt),
    ]);
    row.height = 18;
    for (let col = 1; col <= HEAD1.length; col++) {
      const cell = row.getCell(col);
      cell.border = box;
      cell.font = { size: 10.5, color: { argb: C.text }, name: '微软雅黑' };
      const centerCols = [1, 3, 4, 5, 9, 10, 13, 14, 15, 16];
      const rightCols = [11, 12];
      cell.alignment = {
        vertical: 'middle',
        horizontal: centerCols.includes(col) ? 'center' : rightCols.includes(col) ? 'right' : 'left',
        wrapText: col === 2 || col === 7 || col === 8,
      };
      if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.zebra } };
    }
    row.getCell(12).numFmt = MONEY_FMT;
    if (q.status === 'confirmed') {
      const sc = row.getCell(13);
      sc.font = { size: 10.5, bold: true, color: { argb: C.confirmedText }, name: '微软雅黑' };
      sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.confirmedBg } };
    }
  });

  // ============ Sheet2 客户汇总 ============
  const ws2 = wb.addWorksheet('客户汇总', { views: [{ showGridLines: false }] });
  const HEAD2 = [
    '序号', '客户名称', '客户编码', '联系人', '联系电话', '邮箱', '地址', '行业',
    '报价数', '成交数', '累计报价金额(元)', '最近报价日期', '建档日期',
  ];
  ws2.addRow(HEAD2);
  styleHeader(ws2, [
    { width: 6 }, { width: 22 }, { width: 12 }, { width: 12 }, { width: 16 }, { width: 24 },
    { width: 26 }, { width: 12 }, { width: 8 }, { width: 8 }, { width: 18 }, { width: 12 }, { width: 12 },
  ]);

  // 每客户的累计报价金额 / 最近报价日期（quotes 已按时间倒序）
  const sumByCustomer = new Map<string, number>();
  const lastQuoteAtByCustomer = new Map<string, Date>();
  for (const q of quotes as any[]) {
    if (!q.customerId) continue;
    const t = calcTotal(q.versions?.[0]?.calcResultJson) ?? 0;
    sumByCustomer.set(q.customerId, (sumByCustomer.get(q.customerId) ?? 0) + t);
    if (!lastQuoteAtByCustomer.has(q.customerId)) lastQuoteAtByCustomer.set(q.customerId, q.createdAt);
  }

  customers.forEach((c: any, i: number) => {
    const row = ws2.addRow([
      i + 1,
      c.name,
      c.code ?? '',
      c.contactName ?? '',
      c.phone ?? '',
      c.email ?? '',
      c.address ?? '',
      c.industry ?? '',
      c._count.quotes,
      confirmedMap.get(c.id) ?? 0,
      sumByCustomer.get(c.id) ?? 0,
      fmtDate(lastQuoteAtByCustomer.get(c.id) ?? c.updatedAt),
      fmtDate(c.createdAt),
    ]);
    row.height = 18;
    for (let col = 1; col <= HEAD2.length; col++) {
      const cell = row.getCell(col);
      cell.border = box;
      cell.font = { size: 10.5, color: { argb: C.text }, name: '微软雅黑' };
      const centerCols = [1, 3, 4, 5, 8, 9, 10, 12, 13];
      const rightCols = [11];
      cell.alignment = {
        vertical: 'middle',
        horizontal: centerCols.includes(col) ? 'center' : rightCols.includes(col) ? 'right' : 'left',
        wrapText: col === 2 || col === 7,
      };
      if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.zebra } };
    }
    row.getCell(11).numFmt = MONEY_FMT;
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
