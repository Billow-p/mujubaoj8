// Excel 报价单导出 — 正式单据样式
// Sheet1「报价单」：公司抬头 → 单据信息 → 客户/项目 → 费用明细 → 汇总 → 条款 → 签字
// Sheet2「计算明细」：每个费用的计算方式与代入过程（内部核算用）
//
// 费用明细分两段，列结构不同：
//   模具费用 —— 一次性总价：项目 / 说明 / 金额
//   注塑费用 —— 按件计价：项目 / 说明 / 单件成本 / 数量 / 金额
// 两段共用同一套表头（单价、数量列模具段留「—」），保证列对齐、读起来清楚。

import ExcelJS from 'exceljs';

const C = {
  brand: 'FF1E40AF',
  brandLight: 'FFEFF6FF',
  text: 'FF111827',
  muted: 'FF6B7280',
  line: 'FFD1D5DB',
  zebra: 'FFF9FAFB',
  groupBg: 'FFF3F4F6',
  totalBg: 'FF1E3A8A',
  injectBg: 'FFF0FDF4',
  injectText: 'FF166534',
};

const MONEY_FMT = '#,##0.00';
const PRICE_FMT = '#,##0.0000';
const QTY_FMT = '#,##0" 件"';
const thin = { style: 'thin' as const, color: { argb: C.line } };
const box = { top: thin, left: thin, bottom: thin, right: thin };

export interface ExcelLine {
  name: string;
  readable?: string;
  value: number;
  note?: string;
  /** 单价 / 单件成本（注塑项才有） */
  unitPrice?: number;
  /** 数量（注塑项才有） */
  qty?: number;
  /** 按件计价：unitPrice 是单件成本 */
  perUnit?: boolean;
}

export interface ExcelQuoteModel {
  company?: { name?: string; phone?: string; address?: string; email?: string };
  quoteNo: string;
  createdAt: Date;
  expiresAt?: Date | null;
  moldTypeName?: string;
  customer: {
    name: string;
    contact?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
  };
  project: { label: string; value: string }[];
  moldLines: ExcelLine[];
  injectionLines: ExcelLine[];
  summary: {
    mold: number;
    injection: number;
    profitRate: number;
    profit: number;
    taxRate: number;
    tax: number;
    total: number;
    /** 注塑数量 */
    injectionQty?: number;
    /** 注塑单件成本合计（元/件） */
    unitCost?: number;
  };
  terms: string[];
  senderName?: string;
}

const fmtDate = (d?: Date | null) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : '';

export async function buildQuoteExcel(model: ExcelQuoteModel): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = model.company?.name || model.senderName || '模具注塑报价系统';
  wb.created = model.createdAt;

  buildMainSheet(wb, model);
  buildDetailSheet(wb, model);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// 列布局（两段费用共用）
// A 序号/标签(10) | B 费用项目(28) | C 计算说明(42) | D 单价/标签(22) | E 数量(16) | F 金额(18)
// 2026-09-12 加宽：解决「注塑件：注塑件 1 ×50 件」等项目标签被截断、金额列太窄的问题
const COLS = [{ width: 10 }, { width: 28 }, { width: 42 }, { width: 22 }, { width: 16 }, { width: 18 }];
const LAST = 6;

function buildMainSheet(wb: ExcelJS.Workbook, m: ExcelQuoteModel) {
  const ws = wb.addWorksheet('报价单', {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
  });

  ws.columns = COLS;
  let r = 1;

  // ---------- 公司抬头 ----------
  ws.mergeCells(r, 1, r, LAST);
  const title = ws.getCell(r, 1);
  title.value = m.company?.name || '模具注塑报价单';
  title.font = { size: 20, bold: true, color: { argb: 'FFFFFFFF' }, name: '微软雅黑' };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.brand } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(r).height = 38;
  r++;

  ws.mergeCells(r, 1, r, LAST);
  const sub = ws.getCell(r, 1);
  const contact = [
    m.company?.address,
    m.company?.phone && `电话：${m.company.phone}`,
    m.company?.email,
  ]
    .filter(Boolean)
    .join('　|　');
  sub.value = contact || '模具设计与制造 · 注塑成型一站式服务';
  sub.font = { size: 10, color: { argb: C.muted }, name: '微软雅黑' };
  sub.alignment = { horizontal: 'center', vertical: 'middle' };
  sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.brandLight } };
  ws.getRow(r).height = 22;
  r += 2;

  // ---------- 单据标题 ----------
  ws.mergeCells(r, 1, r, LAST);
  const doc = ws.getCell(r, 1);
  doc.value = '模  具  报  价  单';
  doc.font = { size: 16, bold: true, color: { argb: C.text }, name: '微软雅黑' };
  doc.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(r).height = 30;
  r++;

  ws.mergeCells(r, 1, r, 3);
  ws.mergeCells(r, 4, r, LAST);
  const q1 = ws.getCell(r, 1);
  q1.value = `报价编号：${m.quoteNo}`;
  q1.font = { size: 10.5, color: { argb: C.muted }, name: '微软雅黑' };
  q1.alignment = { horizontal: 'left', vertical: 'middle' };
  const q2 = ws.getCell(r, 4);
  q2.value = `报价日期：${fmtDate(m.createdAt)}　有效期：${
    m.expiresAt ? fmtDate(m.expiresAt) : '自报价日起 30 天'
  }`;
  q2.font = { size: 10.5, color: { argb: C.muted }, name: '微软雅黑' };
  q2.alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getRow(r).height = 22;
  r += 2;

  const sectionBar = (text: string) => {
    ws.mergeCells(r, 1, r, LAST);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { size: 11.5, bold: true, color: { argb: C.brand }, name: '微软雅黑' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.brandLight } };
    c.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    c.border = box;
    ws.getRow(r).height = 24;
    r++;
  };

  // ---------- 一、客户与项目 ----------
  sectionBar('一、客户与项目信息');

  const customerRows: [string, string][] = [
    ['客户名称', m.customer.name],
    ['联系人', m.customer.contact || '—'],
    ['联系电话', m.customer.phone || '—'],
    ['电子邮箱', m.customer.email || '—'],
  ];
  const projectRows: [string, string][] = [
    ...(m.moldTypeName ? ([['模具类型', m.moldTypeName]] as [string, string][]) : []),
    ...m.project.map((p) => [p.label, p.value] as [string, string]),
  ];
  const rows = Math.max(customerRows.length, projectRows.length, 4);

  for (let i = 0; i < rows; i++) {
    ws.getRow(r).height = 22;

    // 左：客户（标签 A，值 B:C）
    const lk = ws.getCell(r, 1);
    lk.value = customerRows[i]?.[0] ?? (i === 0 ? '客户名称' : '');
    lk.font = { size: 10.5, color: { argb: C.muted }, name: '微软雅黑' };
    lk.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.groupBg } };
    lk.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    lk.border = box;

    ws.mergeCells(r, 2, r, 3);
    const lv = ws.getCell(r, 2);
    lv.value = customerRows[i]?.[1] ?? '';
    lv.font = { size: 11, color: { argb: C.text }, name: '微软雅黑' };
    lv.alignment = { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: true };
    lv.border = box;

    // 右：项目（标签 D，值 E:F）
    const rk = ws.getCell(r, 4);
    rk.value = projectRows[i]?.[0] ?? '';
    rk.font = { size: 10.5, color: { argb: C.muted }, name: '微软雅黑' };
    rk.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.groupBg } };
    rk.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    rk.border = box;

    ws.mergeCells(r, 5, r, LAST);
    const rv = ws.getCell(r, 5);
    rv.value = projectRows[i]?.[1] ?? '';
    rv.font = { size: 11, color: { argb: C.text }, name: '微软雅黑' };
    rv.alignment = { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: true };
    rv.border = box;

    r++;
  }
  r++;

  // ---------- 二、费用明细 ----------
  sectionBar('二、费用明细');

  const headers = ['序号', '费用项目', '计算说明', '单价 / 单件成本', '数量', '金额（元）'];
  headers.forEach((t, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = t;
    c.font = { size: 10.5, bold: true, color: { argb: 'FFFFFFFF' }, name: '微软雅黑' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.brand } };
    c.alignment = {
      horizontal: i >= 3 ? 'right' : 'center',
      vertical: 'middle',
      wrapText: true,
    };
    c.border = box;
  });
  ws.getRow(r).height = 28;
  r++;

  /** 分组行（含金额小计）。subText 用于注塑段显示「单件成本 × 数量」 */
  const groupRow = (
    label: string,
    amount: number,
    opts: { subText?: string; accent?: boolean } = {},
  ) => {
    const bg = opts.accent ? C.injectBg : C.groupBg;
    const fg = opts.accent ? C.injectText : C.text;
    ws.getRow(r).height = 24;

    ws.mergeCells(r, 1, r, 5);
    const c1 = ws.getCell(r, 1);
    c1.value = opts.subText ? `${label}　·　${opts.subText}` : label;
    c1.font = { size: 11, bold: true, color: { argb: fg }, name: '微软雅黑' };
    c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    c1.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    c1.border = box;

    const c6 = ws.getCell(r, 6);
    c6.value = amount;
    c6.numFmt = MONEY_FMT;
    c6.font = { size: 11, bold: true, color: { argb: fg }, name: '微软雅黑' };
    c6.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    c6.alignment = { horizontal: 'right', vertical: 'middle' };
    c6.border = box;
    r++;
  };

  /** 明细行 */
  const lineRow = (idx: number, line: ExcelLine, zebra: boolean) => {
    const bg = zebra ? C.zebra : 'FFFFFFFF';
    const hasPrice = line.unitPrice != null && Number.isFinite(line.unitPrice);
    const hasQty = line.qty != null && Number.isFinite(line.qty);

    const cells: { v: ExcelJS.CellValue; fmt?: string; align: 'center' | 'left' | 'right'; muted?: boolean }[] = [
      { v: idx, align: 'center' },
      { v: line.name, align: 'left' },
      { v: line.readable || '', align: 'left', muted: true },
      { v: hasPrice ? line.unitPrice! : '—', fmt: hasPrice ? PRICE_FMT : undefined, align: 'right' },
      { v: hasQty ? line.qty! : '—', fmt: hasQty ? QTY_FMT : undefined, align: 'right' },
      { v: line.value, fmt: MONEY_FMT, align: 'right' },
    ];

    cells.forEach((cell, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = cell.v;
      if (cell.fmt) c.numFmt = cell.fmt;
      c.font = {
        size: 10.5,
        color: { argb: cell.muted ? C.muted : C.text },
        name: '微软雅黑',
        bold: i === 5,
      };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      c.alignment = {
        horizontal: cell.align,
        vertical: 'middle',
        indent: cell.align === 'left' && i > 0 ? 1 : 0,
      };
      c.border = box;
    });
    ws.getRow(r).height = 24;
    r++;
  };

  if (m.moldLines.length) {
    groupRow('（一）模具费用　（一次性）', m.summary.mold);
    m.moldLines.forEach((l, i) => lineRow(i + 1, l, i % 2 === 1));
  }

  if (m.injectionLines.length) {
    const qty = m.summary.injectionQty;
    const unit = m.summary.unitCost;
    const subText =
      qty && unit
        ? `单件成本 ¥${unit.toLocaleString('zh-CN', { minimumFractionDigits: 2 })} / 件　×　${qty.toLocaleString('zh-CN')} 件`
        : undefined;
    groupRow('（二）注塑费用　（按件计价）', m.summary.injection, { subText, accent: true });
    m.injectionLines.forEach((l, i) => lineRow(i + 1, l, i % 2 === 1));
  }

  if (!m.moldLines.length && !m.injectionLines.length) {
    ws.mergeCells(r, 1, r, LAST);
    const c = ws.getCell(r, 1);
    c.value = '（无费用明细）';
    c.font = { size: 10.5, color: { argb: C.muted }, name: '微软雅黑' };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = box;
    ws.getRow(r).height = 24;
    r++;
  }
  r++;

  // ---------- 三、费用汇总 ----------
  sectionBar('三、费用汇总');

  const sumRow = (label: string, value: number, opts: { pct?: string } = {}) => {
    ws.mergeCells(r, 4, r, 5);
    const lc = ws.getCell(r, 4);
    lc.value = opts.pct ? `${label}（${opts.pct}）` : label;
    lc.font = { size: 10.5, color: { argb: C.muted }, name: '微软雅黑' };
    lc.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
    lc.border = box;
    ws.getCell(r, 5).border = box;

    const vc = ws.getCell(r, 6);
    vc.value = value;
    vc.numFmt = MONEY_FMT;
    vc.font = { size: 10.5, color: { argb: C.text }, name: '微软雅黑' };
    vc.alignment = { horizontal: 'right', vertical: 'middle' };
    vc.border = box;

    ws.getRow(r).height = 22;
    r++;
  };

  const s = m.summary;
  if (s.mold) sumRow('模具费用合计', s.mold);
  if (s.injection) {
    const qty = s.injectionQty;
    const unit = s.unitCost;
    const pct = qty && unit ? `单件 ¥${unit.toFixed(2)} × ${qty.toLocaleString('zh-CN')} 件` : undefined;
    sumRow('注塑费用合计', s.injection, { pct });
  }
  if (s.profit) sumRow('利润', s.profit, { pct: `${Math.round(s.profitRate * 1000) / 10}%` });
  if (s.tax) sumRow('税额', s.tax, { pct: `${Math.round(s.taxRate * 1000) / 10}%` });

  {
    ws.getRow(r).height = 38;
    ws.mergeCells(r, 4, r, 5);
    const lc = ws.getCell(r, 4);
    lc.value = '含 税 总 价';
    lc.font = { size: 13, bold: true, color: { argb: 'FFFFFFFF' }, name: '微软雅黑' };
    lc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalBg } };
    lc.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
    lc.border = box;
    ws.getCell(r, 5).border = box;
    ws.getCell(r, 5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalBg } };

    const vc = ws.getCell(r, 6);
    vc.value = s.total;
    vc.numFmt = MONEY_FMT;
    vc.font = { size: 15, bold: true, color: { argb: 'FFFFFFFF' }, name: '微软雅黑' };
    vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalBg } };
    vc.alignment = { horizontal: 'right', vertical: 'middle' };
    vc.border = box;
    r++;
  }

  ws.mergeCells(r, 1, r, LAST);
  const cap = ws.getCell(r, 1);
  cap.value = `大写金额：${toChineseAmount(s.total)}`;
  cap.font = { size: 11, color: { argb: C.text }, name: '微软雅黑' };
  cap.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.brandLight } };
  cap.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  cap.border = box;
  ws.getRow(r).height = 24;
  r += 2;

  // ---------- 四、商务条款 ----------
  if (m.terms.length) {
    sectionBar('四、商务条款');
    m.terms.forEach((t, i) => {
      ws.mergeCells(r, 1, r, LAST);
      const c = ws.getCell(r, 1);
      c.value = `${i + 1}. ${t}`;
      c.font = { size: 10.5, color: { argb: C.text }, name: '微软雅黑' };
      c.alignment = { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: true };
      c.border = box;
      ws.getRow(r).height = 20;
      r++;
    });
    r++;
  }

  // ---------- 签字 ----------
  ws.mergeCells(r, 1, r, LAST);
  const note = ws.getCell(r, 1);
  note.value = '本报价单经双方确认后生效。如需调整规格或数量，价格需重新核算。';
  note.font = { size: 10, italic: true, color: { argb: C.muted }, name: '微软雅黑' };
  note.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  r += 2;

  ws.mergeCells(r, 1, r, 3);
  ws.mergeCells(r, 4, r, LAST);
  const g1 = ws.getCell(r, 1);
  g1.value = `供方签字（盖章）：${m.senderName ? m.senderName + '　' : ''}____________________`;
  g1.font = { size: 11, color: { argb: C.text }, name: '微软雅黑' };
  g1.alignment = { horizontal: 'left', vertical: 'middle' };
  const g2 = ws.getCell(r, 4);
  g2.value = '需方签字（盖章）：____________________';
  g2.font = { size: 11, color: { argb: C.text }, name: '微软雅黑' };
  g2.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(r).height = 30;

  ws.headerFooter.oddFooter = `&L模具注塑报价系统&C第 &P 页 / 共 &N 页&R${m.quoteNo}`;
}

function buildDetailSheet(wb: ExcelJS.Workbook, m: ExcelQuoteModel) {
  const ws = wb.addWorksheet('计算明细', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 8 }, { width: 22 }, { width: 54 }, { width: 18 }, { width: 14 }, { width: 16 }];
  const LAST = 6;

  ws.mergeCells(1, 1, 1, LAST);
  const t = ws.getCell(1, 1);
  t.value = `计算明细 · ${m.quoteNo}`;
  t.font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' }, name: '微软雅黑' };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.brand } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  let r = 2;
  ws.mergeCells(r, 1, r, LAST);
  const meta = ws.getCell(r, 1);
  meta.value = `${m.customer.name}　·　${m.project.map((p) => `${p.label}：${p.value}`).join('　·　')}`;
  meta.font = { size: 10, color: { argb: C.muted }, name: '微软雅黑' };
  meta.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  r += 2;

  const head = ['序号', '费用项目', '计算方式与代入过程', '单价 / 单件成本', '数量', '金额（元）'];
  head.forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h;
    c.font = { size: 10.5, bold: true, color: { argb: 'FFFFFFFF' }, name: '微软雅黑' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.brand } };
    c.alignment = { horizontal: i >= 3 ? 'right' : 'center', vertical: 'middle', wrapText: true };
    c.border = box;
  });
  ws.getRow(r).height = 26;
  r++;

  const block = (title: string, lines: ExcelLine[], accent: boolean) => {
    if (!lines.length) return;

    ws.mergeCells(r, 1, r, LAST);
    const g = ws.getCell(r, 1);
    g.value = title;
    g.font = { size: 10.5, bold: true, color: { argb: accent ? C.injectText : C.text }, name: '微软雅黑' };
    g.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: accent ? C.injectBg : C.groupBg } };
    g.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    g.border = box;
    ws.getRow(r).height = 22;
    r++;

    lines.forEach((l, i) => {
      const bg = i % 2 === 1 ? C.zebra : 'FFFFFFFF';
      const hasPrice = l.unitPrice != null && Number.isFinite(l.unitPrice);
      const hasQty = l.qty != null && Number.isFinite(l.qty);
      const vals: { v: ExcelJS.CellValue; fmt?: string; align: 'center' | 'left' | 'right'; muted?: boolean }[] = [
        { v: i + 1, align: 'center' },
        { v: l.name, align: 'left' },
        { v: l.readable || '', align: 'left', muted: true },
        { v: hasPrice ? l.unitPrice! : '—', fmt: hasPrice ? PRICE_FMT : undefined, align: 'right' },
        { v: hasQty ? l.qty! : '—', fmt: hasQty ? QTY_FMT : undefined, align: 'right' },
        { v: l.value, fmt: MONEY_FMT, align: 'right' },
      ];
      vals.forEach((cell, ci) => {
        const c = ws.getCell(r, ci + 1);
        c.value = cell.v;
        if (cell.fmt) c.numFmt = cell.fmt;
        c.font = { size: 10.5, color: { argb: cell.muted ? C.muted : C.text }, name: '微软雅黑', bold: ci === 5 };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        c.alignment = { horizontal: cell.align, vertical: 'middle', indent: cell.align === 'left' && ci > 0 ? 1 : 0 };
        c.border = box;
      });
      ws.getRow(r).height = 22;
      r++;
    });
  };

  block('（一）模具费用', m.moldLines, false);
  block('（二）注塑费用', m.injectionLines, true);

  r++;
  const s = m.summary;
  const sumRows: [string, ExcelJS.CellValue, string | undefined][] = [
    ['模具费用合计', s.mold, MONEY_FMT],
    ['注塑费用合计', s.injection, MONEY_FMT],
    ...(s.unitCost && s.injectionQty
      ? ([['注塑单件成本', s.unitCost, PRICE_FMT]] as [string, ExcelJS.CellValue, string | undefined][])
      : []),
    ['利润', s.profit, MONEY_FMT],
    ['税额', s.tax, MONEY_FMT],
    ['含税总价', s.total, MONEY_FMT],
  ];

  sumRows.forEach(([label, v, fmt], i) => {
    const isTotal = i === sumRows.length - 1;
    ws.mergeCells(r, 4, r, 5);
    const lc = ws.getCell(r, 4);
    lc.value = label;
    lc.font = { size: isTotal ? 11.5 : 10.5, bold: isTotal, color: { argb: isTotal ? C.brand : C.muted }, name: '微软雅黑' };
    lc.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
    lc.border = box;
    ws.getCell(r, 5).border = box;

    const vc = ws.getCell(r, 6);
    vc.value = v;
    if (fmt) vc.numFmt = fmt;
    vc.font = { size: isTotal ? 12.5 : 10.5, bold: isTotal, color: { argb: isTotal ? C.brand : C.text }, name: '微软雅黑' };
    vc.alignment = { horizontal: 'right', vertical: 'middle' };
    vc.border = box;

    ws.getCell(r, 1).border = box;
    ws.getCell(r, 2).border = box;
    ws.getCell(r, 3).border = box;
    ws.getRow(r).height = isTotal ? 26 : 22;
    r++;
  });

  r++;
  ws.mergeCells(r, 1, r, LAST);
  const tip = ws.getCell(r, 1);
  tip.value =
    '说明：计算方式由配置中心设定，金额为系统自动核算结果。注塑费用按「单件成本 × 注塑数量」计。';
  tip.font = { size: 9.5, italic: true, color: { argb: C.muted }, name: '微软雅黑' };
  tip.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
}

/** 金额转中文大写 */
export function toChineseAmount(n: number): string {
  const num = Math.round((n || 0) * 100) / 100;
  if (num === 0) return '零元整';

  const digits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const units = ['', '拾', '佰', '仟'];
  const bigUnits = ['', '万', '亿', '兆'];

  const intPart = Math.floor(Math.abs(num));
  const decPart = Math.round((Math.abs(num) - intPart) * 100);

  let intStr = '';
  if (intPart === 0) {
    intStr = '零';
  } else {
    const groups: string[] = [];
    let rest = intPart;
    while (rest > 0) {
      groups.push(String(rest % 10000).padStart(4, '0'));
      rest = Math.floor(rest / 10000);
    }
    // 低位那一节的千位是不是 0 —— 是的话，两节之间要补一个「零」
    // 例：100305 → 壹拾万「零」叁佰零伍；1612285 → 壹佰陆拾壹万贰仟…（千位非零，不补）
    let prevSectionLeadingZero = false;
    groups.forEach((g, gi) => {
      let gs = '';
      let zero = false;
      for (let i = 0; i < 4; i++) {
        const d = Number(g[i]);
        if (d === 0) {
          zero = true;
        } else {
          if (zero && gs) gs += digits[0];
          zero = false;
          gs += digits[d] + units[3 - i];
        }
      }
      if (gs) {
        let section = gs + bigUnits[gi];
        if (gi > 0 && prevSectionLeadingZero && intStr && !intStr.startsWith('零')) {
          section += '零';
        }
        intStr = section + intStr;
      }
      prevSectionLeadingZero = g[0] === '0';
    });
    intStr = intStr.replace(/零+/g, '零').replace(/零$/, '');
  }

  let result = intStr + '元';
  if (decPart === 0) {
    result += '整';
  } else {
    const jiao = Math.floor(decPart / 10);
    const fen = decPart % 10;
    if (jiao > 0) result += digits[jiao] + '角';
    else if (fen > 0) result += '零';
    if (fen > 0) result += digits[fen] + '分';
  }
  return (num < 0 ? '负' : '') + result;
}
