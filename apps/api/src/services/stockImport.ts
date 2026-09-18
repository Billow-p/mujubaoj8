// Excel 批量入库 —— 解析「材料编码 + 数量」表，交给 stock 服务批量生成入库流水
//
// 设计原则（延续一/二期）：任何解析不出来的行都进 errors 报出来，绝不静默吞掉。

import ExcelJS from 'exceljs';

export type StockInRow = {
  /** Excel 里的行号（从 1 开始，含表头），方便用户回去改 */
  row: number;
  code: string;
  name?: string;
  qty: number;
  unitCost?: number;
  remark?: string;
};

export type StockImportResult = {
  rows: StockInRow[];
  errors: { row: number; code: string; reason: string }[];
  sheetName: string;
};

// 列头同义词：兼容「编码 / 材料编码 / 物料编码 / code」各种写法
const ALIASES = {
  code: ['材料编码', '编码', '材料编号', '编号', '材料代码', '物料编码', '物料代码', 'code'],
  name: ['材料名称', '名称', '品名', '材料', 'name'],
  qty: ['数量', '入库数量', '入库数', '数量(kg)', '重量', '重量(kg)', 'qty', '入库重量'],
  unitCost: ['单价', '采购单价', '入库单价', '单价(元)', '价格', 'price'],
  remark: ['备注', '说明', '供应商', '批次', 'remark'],
};

const cellText = (v: any): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return v.toLocaleDateString('zh-CN');
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join('').trim();
    if (v.result != null) return String(v.result).trim();
    if (v.text != null) return String(v.text).trim();
  }
  return '';
};

/** 数值解析：容忍千分位、货币符号、括号单位；解析不出返回 undefined */
const toNumber = (v: any): number | undefined => {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const raw = String(v);
  const s = raw
    .replace(/[¥$￥,\s%]/g, '')
    .replace(/[（(].*[)）]/g, '')
    .replace(/[a-zA-Z一-龥]/g, '')
    .trim();
  if (s === '' || s === '-' || s === '.') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** 在表头行里定位各列下标（找不到返回 -1） */
function mapHeaders(header: string[]): Record<keyof typeof ALIASES, number> {
  const norm = header.map((h) => String(h || '').trim().toLowerCase());
  const out: any = { code: -1, name: -1, qty: -1, unitCost: -1, remark: -1 };
  for (const key of Object.keys(ALIASES) as (keyof typeof ALIASES)[]) {
    for (const alias of ALIASES[key]) {
      const i = norm.indexOf(alias.toLowerCase());
      if (i >= 0) {
        out[key] = i;
        break;
      }
    }
  }
  return out;
}

/**
 * 解析入库表。
 * 表头行 = 前 10 行里第一个同时含「编码」和「数量」类列头的行。
 */
export async function parseStockInWorkbook(buffer: Buffer): Promise<StockImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);

  const sheet = wb.worksheets.find((ws) => ws.rowCount > 0) ?? wb.worksheets[0];
  if (!sheet) {
    return { rows: [], errors: [{ row: 0, code: '', reason: '这个 Excel 里没有工作表' }], sheetName: '' };
  }

  // 找表头
  let headerIdx = -1;
  let cols: Record<string, number> = { code: -1, name: -1, qty: -1, unitCost: -1, remark: -1 };
  const maxScan = Math.min(sheet.rowCount, 10);
  for (let r = 1; r <= maxScan; r += 1) {
    const vals: string[] = [];
    sheet.getRow(r).eachCell({ includeEmpty: true }, (c) => vals.push(cellText(c.value)));
    const mapped = mapHeaders(vals);
    if (mapped.code >= 0 && mapped.qty >= 0) {
      headerIdx = r;
      cols = mapped;
      break;
    }
  }
  if (headerIdx < 0) {
    return {
      rows: [],
      errors: [
        {
          row: 0,
          code: '',
          reason: '没找到表头，第一行需要同时有「材料编码」和「数量」两列（也可以是 编码/物料编码/入库数量 这类同义写法）',
        },
      ],
      sheetName: sheet.name,
    };
  }

  const rows: StockInRow[] = [];
  const errors: { row: number; code: string; reason: string }[] = [];

  for (let r = headerIdx + 1; r <= sheet.rowCount; r += 1) {
    const vals: string[] = [];
    sheet.getRow(r).eachCell({ includeEmpty: true }, (c) => vals.push(cellText(c.value)));
    const code = cellText(vals[cols.code]).trim();
    const rawQty = vals[cols.qty];
    if (!code && !rawQty) continue; // 空行跳过

    if (!code) {
      errors.push({ row: r, code: '', reason: '这一行没填材料编码' });
      continue;
    }
    const qty = toNumber(rawQty);
    if (qty == null || qty <= 0) {
      errors.push({ row: r, code, reason: `数量「${rawQty || '空'}」不是有效数字` });
      continue;
    }

    rows.push({
      row: r,
      code,
      name: cols.name >= 0 ? cellText(vals[cols.name]) || undefined : undefined,
      qty,
      unitCost: cols.unitCost >= 0 ? toNumber(vals[cols.unitCost]) : undefined,
      remark: cols.remark >= 0 ? cellText(vals[cols.remark]) || undefined : undefined,
    });
  }

  return { rows, errors, sheetName: sheet.name };
}
