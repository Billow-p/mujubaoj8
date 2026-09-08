// Excel 导出服务 — 用 exceljs 生成报价单 .xlsx
// 设计：3 个 sheet：① 报价汇总  ② 模具费明细+注塑明细  ③ 商务条款

import ExcelJS from 'exceljs';
import type { QuoteCalcResult, QuoteInput, BusinessTermItem, ExtraItem } from '@mqs/shared';

const MONEY = (n: number) => Math.round((n ?? 0) * 100) / 100;

const MOLD_FEE_LABELS: Record<string, string> = {
  coreSteel: '1. 模芯钢料费',
  designFee: '2. 模具设计费',
  moldBase: '3. 模架费',
  standardParts: '4. 标准件',
  cncMachining: '5. CNC 加工',
  edm: '6. EDM 电火花',
  wireCutting: '7. 线切割',
  polishing: '8. 省模抛光',
  trialMold: '9. 试模费',
  surfaceTreatment: '10. 表面处理',
  packagingShipping: '11. 模具包装运输',
};

const INJECTION_LABELS: Record<string, string> = {
  material: '1. 材料费',
  machining: '2. 注塑加工费',
  postProcess: '3. 后加工费',
  packaging: '4. 包装费',
  moldAmortization: '5. 模具分摊',
};

export interface ExcelExportOptions {
  quoteNo: string;
  customerName: string;
  productName: string;
  input: QuoteInput;
  result: QuoteCalcResult;
  businessTerms?: BusinessTermItem[];
  senderName?: string;
  createdAt?: Date;
}

export async function buildQuoteExcel(opts: ExcelExportOptions): Promise<Buffer> {
  const { quoteNo, customerName, productName, input, result, businessTerms, senderName, createdAt } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = senderName || '模具注塑报价系统';
  wb.created = createdAt || new Date();

  // ==================== Sheet 1: 报价汇总 ====================
  const s1 = wb.addWorksheet('报价汇总', { views: [{ showGridLines: false }] });

  // 标题块
  s1.mergeCells('A1:F1');
  s1.getCell('A1').value = '模 具 注 塑 报 价 单';
  s1.getCell('A1').font = { size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  s1.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  s1.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  s1.getRow(1).height = 36;

  // 基本信息
  const infoRows: [string, string][] = [
    ['报价编号', quoteNo],
    ['客户名称', customerName],
    ['产品名称', productName],
    ['产品材质', input.material],
    ['模具钢材', input.steel],
    ['产品复杂度', complexityLabel(input.complexity)],
    ['首单数量', `${input.firstOrderQty.toLocaleString('zh-CN')} 件`],
    ['模具腔数', `${input.cavityCount} 腔`],
    ['报价日期', (createdAt || new Date()).toLocaleDateString('zh-CN')],
    ['报价员', senderName || '—'],
  ];
  let row = 3;
  infoRows.forEach(([k, v]) => {
    s1.getCell(`A${row}`).value = k;
    s1.getCell(`A${row}`).font = { bold: true, color: { argb: 'FF6B7280' } };
    s1.getCell(`B${row}`).value = v;
    row++;
  });

  row += 1;
  // 总价块
  s1.getCell(`A${row}`).value = '含 税 总 计';
  s1.getCell(`A${row}`).font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  s1.getCell(`A${row}`).alignment = { horizontal: 'center', vertical: 'middle' };
  s1.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  s1.mergeCells(`A${row}:B${row}`);
  s1.getRow(row).height = 28;

  row += 1;
  s1.getCell(`A${row}`).value = '模具费（含税）';
  s1.getCell(`B${row}`).value = MONEY(result.summary.moldIncVat);
  s1.getCell(`B${row}`).numFmt = '"¥"#,##0.00';

  row += 1;
  s1.getCell(`A${row}`).value = `注塑费（${input.firstOrderQty.toLocaleString('zh-CN')}件 × ¥${result.summary.unitCostExVat.toFixed(2)}）含税`;
  s1.getCell(`B${row}`).value = MONEY(result.summary.injectionIncVat);
  s1.getCell(`B${row}`).numFmt = '"¥"#,##0.00';

  row += 1;
  s1.getCell(`A${row}`).value = '含税总计';
  s1.getCell(`A${row}`).font = { bold: true, size: 12 };
  s1.getCell(`B${row}`).value = MONEY(result.summary.grandTotalIncVat);
  s1.getCell(`B${row}`).numFmt = '"¥"#,##0.00';
  s1.getCell(`B${row}`).font = { bold: true, size: 14, color: { argb: 'FF1E40AF' } };

  row += 1;
  s1.getCell(`A${row}`).value = '（不含税）';
  s1.getCell(`A${row}`).font = { color: { argb: 'FF6B7280' } };
  s1.getCell(`B${row}`).value = MONEY(result.summary.grandTotalExVat);
  s1.getCell(`B${row}`).numFmt = '"¥"#,##0.00';
  s1.getCell(`B${row}`).font = { color: { argb: 'FF6B7280' } };

  // 列宽
  s1.getColumn(1).width = 32;
  s1.getColumn(2).width = 28;
  s1.getColumn(3).width = 14;
  s1.getColumn(4).width = 14;
  s1.getColumn(5).width = 14;
  s1.getColumn(6).width = 14;

  // ==================== Sheet 2: 费用明细 ====================
  const s2 = wb.addWorksheet('费用明细', { views: [{ showGridLines: false }] });

  // 模具费明细
  s2.getCell('A1').value = '模具费明细';
  s2.getCell('A1').font = { bold: true, size: 14 };
  s2.mergeCells('A1:E1');

  const header2 = ['#', '项目', '计算依据', '金额（元）', '锁定'];
  header2.forEach((h, i) => {
    const c = s2.getCell(2, i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = {
      top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    };
  });

  let r2 = 3;
  Object.entries(result.moldFeeItems).forEach(([k, item], i) => {
    s2.getCell(r2, 1).value = i + 1;
    s2.getCell(r2, 2).value = MOLD_FEE_LABELS[k] || k;
    s2.getCell(r2, 3).value = item.formula;
    s2.getCell(r2, 4).value = MONEY(item.value);
    s2.getCell(r2, 4).numFmt = '"¥"#,##0.00';
    s2.getCell(r2, 5).value = item.locked ? '🔒' : '';
    if (item.overridden || item.locked) {
      s2.getRow(r2).eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }));
    }
    r2++;
  });
  // 用户加的模具附加项
  (result.extras?.moldExtras ?? []).forEach((e: ExtraItem, i) => {
    s2.getCell(r2, 1).value = 11 + i + 1;
    s2.getCell(r2, 2).value = `附加：${e.name}`;
    s2.getCell(r2, 3).value = e.note || '用户自定义';
    s2.getCell(r2, 4).value = MONEY(e.amount);
    s2.getCell(r2, 4).numFmt = '"¥"#,##0.00';
    s2.getRow(r2).eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } }));
    r2++;
  });

  // 小计
  s2.getCell(r2, 2).value = '模具费小计';
  s2.getCell(r2, 2).font = { bold: true };
  s2.getCell(r2, 4).value = MONEY(result.summary.moldSubtotal + (result.summary.moldExtrasTotal || 0));
  s2.getCell(r2, 4).numFmt = '"¥"#,##0.00';
  s2.getCell(r2, 4).font = { bold: true };
  r2++;

  s2.getCell(r2, 2).value = '管理费+利润';
  s2.getCell(r2, 4).value = MONEY(result.summary.moldManagementFee);
  s2.getCell(r2, 4).numFmt = '"¥"#,##0.00';
  r2++;

  s2.getCell(r2, 2).value = '模具合计（不含税）';
  s2.getCell(r2, 2).font = { bold: true, size: 12 };
  s2.getCell(r2, 4).value = MONEY(result.summary.moldTotalExVat);
  s2.getCell(r2, 4).numFmt = '"¥"#,##0.00';
  s2.getCell(r2, 4).font = { bold: true, size: 12, color: { argb: 'FF1E40AF' } };
  s2.getCell(r2, 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  s2.getCell(r2, 4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  r2++;

  // 注塑明细
  r2 += 2;
  s2.getCell(r2, 1).value = '注塑单件成本';
  s2.getCell(r2, 1).font = { bold: true, size: 14 };
  s2.mergeCells(r2, 1, r2, 5);
  r2++;

  ['#', '项目', '计算依据', '单价（元/件）', '锁定'].forEach((h, i) => {
    const c = s2.getCell(r2, i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  r2++;

  Object.entries(result.injectionItems).forEach(([k, item], i) => {
    s2.getCell(r2, 1).value = i + 1;
    s2.getCell(r2, 2).value = INJECTION_LABELS[k] || k;
    s2.getCell(r2, 3).value = item.formula;
    s2.getCell(r2, 4).value = MONEY(item.value);
    s2.getCell(r2, 4).numFmt = '"¥"#,##0.00';
    s2.getCell(r2, 5).value = item.locked ? '🔒' : '';
    if (item.overridden || item.locked) {
      s2.getRow(r2).eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }));
    }
    r2++;
  });
  // 用户加的注塑附加项
  (result.extras?.injectionExtras ?? []).forEach((e: ExtraItem) => {
    s2.getCell(r2, 2).value = `附加：${e.name}`;
    s2.getCell(r2, 3).value = e.note || '用户自定义';
    s2.getCell(r2, 4).value = MONEY(e.amount);
    s2.getCell(r2, 4).numFmt = '"¥"#,##0.00';
    s2.getRow(r2).eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } }));
    r2++;
  });

  s2.getCell(r2, 2).value = `单件成本小计`;
  s2.getCell(r2, 2).font = { bold: true, size: 12 };
  s2.getCell(r2, 4).value = MONEY(result.summary.unitCostExVat);
  s2.getCell(r2, 4).numFmt = '"¥"#,##0.00';
  s2.getCell(r2, 4).font = { bold: true, size: 12, color: { argb: 'FF1E40AF' } };
  r2++;
  s2.getCell(r2, 2).value = `首单 ${input.firstOrderQty.toLocaleString('zh-CN')} 件 注塑合计（含税）`;
  s2.getCell(r2, 2).font = { bold: true };
  s2.getCell(r2, 4).value = MONEY(result.summary.injectionIncVat);
  s2.getCell(r2, 4).numFmt = '"¥"#,##0.00';
  s2.getCell(r2, 4).font = { bold: true };

  s2.getColumn(1).width = 6;
  s2.getColumn(2).width = 28;
  s2.getColumn(3).width = 48;
  s2.getColumn(4).width = 18;
  s2.getColumn(5).width = 8;

  // ==================== Sheet 3: 商务条款 ====================
  const s3 = wb.addWorksheet('商务条款', { views: [{ showGridLines: false }] });
  s3.getCell('A1').value = '商务条款';
  s3.getCell('A1').font = { bold: true, size: 14 };
  s3.mergeCells('A1:C1');

  ['#', '条款', '说明'].forEach((h, i) => {
    const c = s3.getCell(2, i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  let r3 = 3;
  (businessTerms ?? result.businessTerms ?? []).forEach((t) => {
    if (!t.enabled) return;
    s3.getCell(r3, 1).value = t.index;
    s3.getCell(r3, 2).value = `条款 ${t.index}`;
    s3.getCell(r3, 3).value = t.text;
    s3.getRow(r3).height = 28;
    s3.getCell(r3, 3).alignment = { vertical: 'middle', wrapText: true };
    r3++;
  });
  s3.getColumn(1).width = 6;
  s3.getColumn(2).width = 14;
  s3.getColumn(3).width = 90;

  // ==================== Sheet 4 (可选): 自定义参数 ====================
  if (input.customParams && Object.keys(input.customParams).length > 0) {
    const s4 = wb.addWorksheet('自定义参数', { views: [{ showGridLines: false }] });
    s4.getCell('A1').value = '自定义参数（仅记录，不参与计算）';
    s4.getCell('A1').font = { bold: true, size: 14 };
    s4.mergeCells('A1:B1');
    let r4 = 3;
    ['参数', '内容'].forEach((h, i) => {
      const c = s4.getCell(2, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
    });
    Object.entries(input.customParams).forEach(([k, v]) => {
      s4.getCell(r4, 1).value = k;
      s4.getCell(r4, 2).value = String(v);
      r4++;
    });
    s4.getColumn(1).width = 28;
    s4.getColumn(2).width = 56;
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function complexityLabel(c: string): string {
  return (
    { simple: '简单(0.7)', medium: '中等(1.0)', complex: '复杂(1.5)', ultra_precision: '超精密(2.5)' }[
      c
    ] || c
  );
}