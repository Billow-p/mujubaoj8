// Excel 报价单导出 — 正式单据样式
// Sheet1「报价单」：公司抬头 → 单据信息 → 客户/项目 → 费用明细 → 汇总 → 条款 → 签字
// Sheet2「计算明细」：每个费用的计算方式与代入过程（内部核算用）

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
};

const MONEY_FMT = '#,##0.00';
const thin = { style: 'thin' as const, color: { argb: C.line } };
const box = { top: thin, left: thin, bottom: thin, right: thin };

export interface ExcelLine {
  name: string;
  readable?: string;
  value: number;
  note?: string;
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

function buildMainSheet(wb: ExcelJS.Workbook, m: ExcelQuoteModel) {
  const ws = wb.addWorksheet('报价单', {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
  });

  ws.columns = [{ width: 7 }, { width: 26 }, { width: 46 }, { width: 17 }, { width: 16 }];
  const LAST = 5;
  let r = 1;

  // 公司抬头
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

  // 单据标题
  ws.mergeCells(r, 1, r, LAST);
  const doc = ws.getCell(r, 1);
  doc.value = '模  具  报  价  单';
  doc.font = { size: 16, bold: true, color: { argb: C.text }, name: '微软雅黑' };
  doc.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(r).height = 30;
  r++;

  ws.mergeCells(r, 1, r, 2);
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

  // 客户与项目
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
    const lk = ws.getCell(r, 1);
    lk.value = customerRows[i]?.[0] ?? '';
    lk.font = { size: 10.5, color: { argb: C.muted }, name: '微软雅黑' };
    lk.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.groupBg } };
    lk.alignment = { horizontal: 'center', vertical: 'middle' };
    lk.border = box;

    const lv = ws.getCell(r, 2);
    ws.mergeCells(r, 2, r, 3);
    lv.value = customerRows[i]?.[1] ?? '';
    lv.font = { size: 11, color: { argb: C.text }, name: '微软雅黑' };
    lv.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    lv.border = box;

    const rk = ws.getCell(r, 4);
    rk.value = projectRows[i]?.[0] ?? '';
    rk.font = { size: 10.5, color: { argb: C.muted }, name: '微软雅黑' };
    rk.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.groupBg } };
    rk.alignment = { horizontal: 'center', vertical: 'middle' };
    rk.border = box;

    const rv = ws.getCell(r, 5);
    rv.value = projectRows[i]?.[1] ?? '';
    rv.font = { size: 11, color: { argb: C.text }, name: '微软雅黑' };
    rv.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    rv.border = box;
    r++;
  }
  r++;

  // 费用明细
  sectionBar('二、费用明细');

  ['序号', '费用项目', '计算说明', '金额（元）', '备注'].forEach((t, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = t;
    c.font = { size: 11, bold: true, color: { argb: 'FFFFFFFF' }, name: '微软雅黑' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.brand } };
    c.alignment = { horizontal: i === 3 ? 'right' : 'center', vertical: 'middle' };
    c.border = box;
  });
  ws.getRow(r).height = 26;
  r++;

  const groupRow = (label: string, amount: number) => {
    ws.getRow(r).height = 22;
    const c1 = ws.getCell(r, 1);
    ws.mergeCells(r, 1, r, 2);
    c1.value = label;
    c1.font = { size: 11, bold: true, color: { argb: C.text }, name: '微软雅黑' };
    c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.groupBg } };
    c1.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    c1.border = box;

    const c3 = ws.getCell(r, 3);
    c3.value = '';
    c3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.groupBg } };
    c3.border = box;

    const c4 = ws.getCell(r, 4);
    c4.value = amount;
    c4.numFmt = MONEY_FMT;
    c4.font = { size: 11, bold: true, color: { argb: C.text }, name: '微软雅黑' };
    c4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.groupBg } };
    c4.alignment = { horizontal: 'right', vertical: 'middle' };
    c4.border = box;

    const c5 = ws.getCell(r, 5);
    c5.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.groupBg } };
    c5.border = box;
    r++;
  };

  const lineRow = (idx: number, line: ExcelLine, zebra: boolean) => {
    const bg = zebra ? C.zebra : 'FFFFFFFF';
    const vals: (string | number)[] = [idx, line.name, line.readable || '', line.value, line.note || ''];
    vals.forEach((v, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = v;
      c.font = {
        size: 10.5,
        color: { argb: i === 2 ? C.muted : C.text },
        name: '微软雅黑',
        bold: i === 3,
      };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      c.alignment = {
        horizontal: i === 0 ? 'center' : i === 3 ? 'right' : 'left',
        vertical: 'middle',
        indent: i === 1 || i === 2 || i === 4 ? 1 : 0,
      };
      if (i === 3) c.numFmt = MONEY_FMT;
      c.border = box;
    });
    ws.getRow(r).height = 24;
    r++;
  };

  if (m.moldLines.length) {
    groupRow('（一）模具费用', m.summary.mold);
    m.moldLines.forEach((l, i) => lineRow(i + 1, l, i % 2 === 1));
  }
  if (m.injectionLines.length) {
    groupRow('（二）注塑费用', m.summary.injection);
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

  // 汇总
  sectionBar('三、费用汇总');

  const sumRow = (label: string, value: number, opts: { pct?: string } = {}) => {
    const lc = ws.getCell(r, 3);
    lc.value = opts.pct ? `${label}（${opts.pct}）` : label;
    lc.font = { size: 10.5, color: { argb: C.muted }, name: '微软雅黑' };
    lc.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
    lc.border = box;

    const vc = ws.getCell(r, 4);
    vc.value = value;
    vc.numFmt = MONEY_FMT;
    vc.font = { size: 10.5, color: { argb: C.text }, name: '微软雅黑' };
    vc.alignment = { horizontal: 'right', vertical: 'middle' };
    vc.border = box;

    ws.getCell(r, 5).border = box;
    ws.getRow(r).height = 22;
    r++;
  };

  const s = m.summary;
  if (s.mold) sumRow('模具费用合计', s.mold);
  if (s.injection) sumRow('注塑费用合计', s.injection);
  if (s.profit) sumRow('利润', s.profit, { pct: `${Math.round(s.profitRate * 1000) / 10}%` });
  if (s.tax) sumRow('税额', s.tax, { pct: `${Math.round(s.taxRate * 1000) / 10}%` });

  {
    ws.getRow(r).height = 36;
    const lc = ws.getCell(r, 3);
    lc.value = '含 税 总 价';
    lc.font = { size: 13, bold: true, color: { argb: 'FFFFFFFF' }, name: '微软雅黑' };
    lc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalBg } };
    lc.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
    lc.border = box;

    const vc = ws.getCell(r, 4);
    vc.value = s.total;
    vc.numFmt = MONEY_FMT;
    vc.font = { size: 15, bold: true, color: { argb: 'FFFFFFFF' }, name: '微软雅黑' };
    vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalBg } };
    vc.alignment = { horizontal: 'right', vertical: 'middle' };
    vc.border = box;

    const nc = ws.getCell(r, 5);
    nc.value = '（人民币）';
    nc.font = { size: 10, color: { argb: 'FFFFFFFF' }, name: '微软雅黑' };
    nc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalBg } };
    nc.alignment = { horizontal: 'center', vertical: 'middle' };
    nc.border = box;
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

  // 条款
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

  // 签字
  ws.mergeCells(r, 1, r, LAST);
  const note = ws.getCell(r, 1);
  note.value = '本报价单经双方确认后生效。如需调整规格或数量，价格需重新核算。';
  note.font = { size: 10, italic: true, color: { argb: C.muted }, name: '微软雅黑' };
  note.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  r += 2;

  ws.mergeCells(r, 1, r, 2);
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
  ws.columns = [{ width: 8 }, { width: 24 }, { width: 60 }, { width: 18 }];

  ws.mergeCells('A1:D1');
  const t = ws.getCell('A1');
  t.value = `计算明细 · ${m.quoteNo}`;
  t.font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' }, name: '微软雅黑' };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.brand } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  let r = 2;
  ws.mergeCells(r, 1, r, 4);
  const meta = ws.getCell(r, 1);
  meta.value = `${m.customer.name}　·　${m.project.map((p) => `${p.label}：${p.value}`).join('　·　')}`;
  meta.font = { size: 10, color: { argb: C.muted }, name: '微软雅黑' };
  meta.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  r += 2;

  ['序号', '费用项目', '计算方式与代入过程', '金额（元）'].forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h;
    c.font = { size: 11, bold: true, color: { argb: 'FFFFFFFF' }, name: '微软雅黑' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.brand } };
    c.alignment = { horizontal: i === 3 ? 'right' : 'center', vertical: 'middle' };
    c.border = box;
  });
  ws.getRow(r).height = 24;
  r++;

  const all = [
    ...m.moldLines,
    ...m.injectionLines,
  ];
  all.forEach((l, i) => {
    const bg = i % 2 === 1 ? C.zebra : 'FFFFFFFF';
    const vals: (string | number)[] = [i + 1, l.name, l.readable || '', l.value];
    vals.forEach((v, ci) => {
      const c = ws.getCell(r, ci + 1);
      c.value = v;
      c.font = { size: 10.5, color: { argb: ci === 2 ? C.muted : C.text }, name: '微软雅黑', bold: ci === 3 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      c.alignment = {
        horizontal: ci === 0 ? 'center' : ci === 3 ? 'right' : 'left',
        vertical: 'middle',
        indent: ci === 2 ? 1 : 0,
      };
      if (ci === 3) c.numFmt = MONEY_FMT;
      c.border = box;
    });
    ws.getRow(r).height = 22;
    r++;
  });

  r++;
  const s = m.summary;
  const rows: [string, number][] = [
    ['模具费用合计', s.mold],
    ['注塑费用合计', s.injection],
    ['利润', s.profit],
    ['税额', s.tax],
    ['含税总价', s.total],
  ];
  rows.forEach(([label, v], i) => {
    const isTotal = i === rows.length - 1;
    const lc = ws.getCell(r, 3);
    lc.value = label;
    lc.font = { size: isTotal ? 11.5 : 10.5, bold: isTotal, color: { argb: isTotal ? C.brand : C.muted }, name: '微软雅黑' };
    lc.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
    lc.border = box;
    const vc = ws.getCell(r, 4);
    vc.value = v;
    vc.numFmt = MONEY_FMT;
    vc.font = { size: isTotal ? 12.5 : 10.5, bold: isTotal, color: { argb: isTotal ? C.brand : C.text }, name: '微软雅黑' };
    vc.alignment = { horizontal: 'right', vertical: 'middle' };
    vc.border = box;
    ws.getCell(r, 1).border = box;
    ws.getCell(r, 2).border = box;
    ws.getRow(r).height = isTotal ? 26 : 22;
    r++;
  });

  r++;
  ws.mergeCells(r, 1, r, 4);
  const tip = ws.getCell(r, 1);
  tip.value = '说明：计算方式由配置中心设定，金额为系统按公式自动核算结果。';
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
      if (gs) intStr = gs + bigUnits[gi] + intStr;
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
