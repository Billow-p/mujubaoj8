/**
 * 三期核心：Excel 参数表 → 报价参数（列映射）。
 *
 * 把客户发来的「报价参数 Excel」直接读成报价所需的参数结构：
 *   - 模具清单 Sheet   → QuoteProjectMold[]   （code / name / materialCode / params）
 *   - 注塑件清单 Sheet → QuoteProjectPart[]   （code / name / materialCode / qty / params）
 *   - 整单参数 Sheet   → QuoteProjectCommon    （利润/税/运输箱/运费/区域，整单一份）
 *                        （老叫法「公共参数」继续兼容）
 *   - 其他费用 Sheet   → QuoteExtras.otherExtras（自由费用行）
 *
 * 设计要点：
 *   1. 直接复用配置中心的参数 code（cavityCount / coreLengthMm / singleWeightKg /
 *      packLengthCm ...），这样映射结果能被引擎原样消费，不用再转一道。
 *   2. items（费用项定义）不从 Excel 来 —— 它由前端「已选模具类型」从配置中心带，
 *      本 service 只填参数值，前端接到后 set 进 ConfiguredQuote 即可。
 *   3. 列头做中文同义词归一化，兼容「好成本」13 项 + 行业通用写法
 *      （模芯长 / 模芯长度 / CoreLength 都能命中 coreLengthMm）。
 *   4. 钢材/材料列支持「编码或中文名」→ 编码（P20 / S136 镜面耐腐蚀钢 都识别成 S136）。
 *   5. 任何匹配不到的列、解析不出的行都进 warnings / unmatched，绝不静默吞掉，
 *      界面上给用户「系统建议 + 人工确认」的机会（沿用一期/二期原则）。
 */

import ExcelJS from 'exceljs';
import type { QuoteExtras } from '@mqs/shared';

// ------------------------------------------------------------------ 工具

/** 单元格文本读取（与 excelImages 同源逻辑，独立实现避免跨文件耦合） */
function cellText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return v.toLocaleDateString('zh-CN');
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join('').trim();
    if ('result' in v && v.result != null) return String(v.result).trim();
    if ('text' in v) return String(v.text).trim();
  }
  return '';
}

/**
 * 数值解析：支持千分位、货币符号、括号包裹单位；非数字返回 undefined。
 * 「5%」按 0.05 计 —— 比例列若把百分比当 5 用，损耗率/利润率会被放大 100 倍。
 */
function toNumber(v: any): number | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const raw = String(v);
  const isPercent = raw.includes('%');
  const s = raw
    .replace(/[¥$￥,\s%]/g, '')
    .replace(/[（(].*[)）]/g, '') // 去掉括号及括号内（如「(mm)」）
    .replace(/[a-zA-Z一-龥]/g, '') // 去掉单位文字
    .trim();
  if (s === '' || s === '-' || s === '.') return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return isPercent ? n / 100 : n;
}

/**
 * 比例类参数超过 1 时大概率是「把百分比当小数填了」（如损耗率填 5 而非 0.05）。
 * 这类错会让报价离谱，必须提示人工确认。按 code 命名规律判定，不写死清单。
 */
function warnHighRates(params: Record<string, any>, where: string, warnings: string[]) {
  for (const [code, v] of Object.entries(params ?? {})) {
    if (typeof v !== 'number') continue;
    if (!/rate/i.test(code) || !/loss|profit|tax/i.test(code)) continue;
    if (v <= 1) continue;
    const msg = `${where}「${code}」= ${v}，比例参数应填小数（如 5% 填 0.05），请确认`;
    if (warnings.length < 50 && !warnings.includes(msg)) warnings.push(msg);
  }
}

/** 列头归一化：小写、去空格、去括号及内容 */
function normHeader(h: string): string {
  return String(h)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[（(][^)）]*[)）]/g, '')
    .replace(/[(),，。:：]/g, '');
}

// ------------------------------------------------------------------ 材料解析

/** 主流材料清单（编码 + 名称），用于「编码/中文名 → 编码」归一化 */
const KNOWN_MATERIALS: { code: string; name: string }[] = [
  // 塑料原料
  { code: 'ABS', name: 'ABS' },
  { code: 'PP', name: 'PP' },
  { code: 'PE', name: 'PE' },
  { code: 'PA', name: 'PA' },
  { code: 'PC', name: 'PC' },
  { code: 'POM', name: 'POM' },
  { code: 'PMMA', name: 'PMMA' },
  { code: 'PBT', name: 'PBT' },
  // 模具钢材
  { code: 'P20', name: 'P20 预硬钢' },
  { code: '718H', name: '718H 预硬钢' },
  { code: 'NAK80', name: 'NAK80 镜面预硬钢' },
  { code: 'S136', name: 'S136 镜面耐腐蚀钢' },
  { code: '2316', name: '2316 预硬钢' },
  { code: 'H13', name: 'H13 热作钢' },
  { code: '8407', name: '8407 热作钢' },
  { code: 'DAC55', name: 'DAC55 热作钢' },
  { code: 'SKD11', name: 'SKD11 冷作钢' },
  { code: 'Cr12MoV', name: 'Cr12MoV 冷作钢' },
];

/** 钢材/材料列：编码或中文名 → 编码；识别不出返回原值（让前端回退到材料中心） */
function resolveMaterialCode(raw: string): string {
  const s = String(raw).trim();
  if (!s) return '';
  const up = s.toUpperCase();
  for (const m of KNOWN_MATERIALS) {
    if (m.code.toUpperCase() === up) return m.code;
  }
  // 模糊匹配必须限长：否则「钢」「S」「1」这种短串会命中第一个沾边的牌号（S→ABS、1→718H）
  if (s.length >= 2) {
    for (const m of KNOWN_MATERIALS) {
      const codeUp = m.code.toUpperCase();
      const hit =
        s.toUpperCase().includes(codeUp) ||                       // 值里含牌号：如「S136 镜面钢」
        m.name.includes(s) ||                                      // 值本身是牌号中文名的一部分
        (s.length >= 3 && codeUp.includes(s.toUpperCase()));       // 值短于牌号：如「718」→718H
      if (hit) return m.code;
    }
  }
  return s; // 没识别成已知材料，原样返回，前端/引擎再决定
}

// ------------------------------------------------------------------ 列头映射

/** 列头匹配器：dict[code] = 候选词数组；返回命中 code 或 null（取最长候选优先） */
function buildMatcher(dict: Record<string, string[]>) {
  const entries = Object.entries(dict).flatMap(([code, aliases]) =>
    aliases.map((a) => ({ code, alias: normHeader(a) })),
  );
  return (header: string): string | null => {
    const h = normHeader(header);
    if (!h) return null;
    let best: { code: string; alias: string } | null = null;
    for (const e of entries) {
      if (!e.alias) continue;
      const hit = h.includes(e.alias) || (e.alias.length >= 3 && h.length >= e.alias.length && e.alias.includes(h));
      if (hit && (!best || e.alias.length > best.alias.length)) best = e;
    }
    return best ? best.code : null;
  };
}

/** 哪些 code 是「材料/钢材」类型（值要 resolveMaterialCode，不是 toNumber） */
const MATERIAL_CODES = new Set(['frontMoldSteel', 'rearMoldSteel', 'materialCode']);
/** 文本列：直接存字符串，不走 toNumber（name/code/note 等） */
const TEXT_CODES = new Set(['name', 'code', 'note', 'qtyVarName']);

const MOLD_COL_MAP = buildMatcher({
  code: ['模具编号', '编号', 'moldcode', 'code'],
  name: ['模具名称', '名称', '品名', '模具', 'moldname'],
  frontMoldSteel: ['前模钢材', '前模钢料', '前模材料', '前模', 'frontmoldsteel'],
  rearMoldSteel: ['后模钢材', '后模钢料', '后模材料', '后模', 'rearmoldsteel'],
  materialCode: ['钢材编码', '整模钢材', '模具钢材', '钢材', 'moldsteel'],
  coreLengthMm: ['模芯长', '模芯长度', '型芯长', 'corelength', 'corel'],
  coreWidthMm: ['模芯宽', '模芯宽度', '型芯宽', 'corewidth', 'corew'],
  coreHeightMm: ['模芯高', '模芯高度', '型芯高', 'coreheight', 'coreh'],
  cavityCount: ['腔数', '穴数', 'cavities', 'cavity', 'cavitycount'],
  hotRunnerPoints: ['热流道点数', '热流道', '热咀点数', 'hotrunner', 'hotrunnerpoints'],
  edmHours: ['edm工时', 'edm', '电火花工时'],
  wireCutLength: ['线切割长度', '线切割', 'wirecut', 'wirecutlength'],
  polishHours: ['抛光工时', '抛光', '省模', 'polish', 'polishhours'],
  slideCount: ['滑块斜顶数量', '滑块数量', '滑块', '斜顶', 'slide', 'slidecount'],
  moldLife: ['模具寿命', '寿命', '寿命档', 'moldlife'],
  twoColorCoef: ['双色模系数', '双色模', 'twocolor', 'twocolorcoef'],
  moldWeightKg: ['模具重量', '模重', 'moldweight'],
});

const INJ_COL_MAP = buildMatcher({
  code: ['件编号', '编号', 'partcode', 'code'],
  name: ['件名称', '名称', '品名', '件名', '产品名', '注塑件', 'partname'],
  materialCode: ['材料编码', '材料', '原料', '塑料', '材质', 'materialcode', 'material'],
  singleWeightKg: ['单件重量', '单重', '净重', '产品重量', 'singleweight', 'weight'],
  injectionQty: ['注塑数量', '数量', '生产数量', '订单数量', 'injectionqty', 'qty', 'quantity'],
  machineHourlyRate: ['机台时薪', '机台费率', '时薪', 'machinehourlyrate', 'hourlyrate'],
  cycleTime: ['成型周期', '周期', 'cycletime', 'cycle'],
  materialLossRate: ['原料损耗率', '损耗率', '损耗', 'materiallossrate', 'lossrate'],
});

const COMMON_COL_MAP = buildMatcher({
  packLengthCm: ['运输箱长', '箱长', '包装长', 'packlength', 'packl'],
  packWidthCm: ['运输箱宽', '箱宽', '包装宽', 'packwidth', 'packw'],
  packHeightCm: ['运输箱高', '箱高', '包装高', 'packheight', 'packh'],
  freightRate: ['运费单价', '运费', '物流单价', 'freightrate', 'freight'],
  freightZone: ['运输区域', '区域', 'freightzone', 'zone'],
  profitRate: ['利润率', '利润', '毛利', 'profitrate', 'profit'],
  taxRate: ['税率', '税', 'taxrate', 'tax'],
  qtyVarName: ['数量变量名', '注塑数量变量', 'qtyvarname'],
});

const OTHER_COL_MAP = buildMatcher({
  name: ['费用名称', '名称', '项目', '费用项目', 'name'],
  amount: ['金额', '费用金额', '金额元', 'amount', 'fee'],
  note: ['备注', '说明', 'note', 'remark'],
});

// ------------------------------------------------------------------ Sheet 识别

function identifySheet(name: string): 'mold' | 'part' | 'common' | 'other' | 'unknown' {
  const n = normHeader(name);
  if (/模具清单|模具参数|molds?/.test(n) && !/注塑/.test(n)) return 'mold';
  if (/注塑件清单|注塑件|件清单|parts?|injection/.test(n)) return 'part';
  // 「整单参数」是 2026-09 起的正式叫法（配置中心已废除「公共参数」分组）。
  // 老叫法「公共参数」必须继续认 —— 用户手上的历史表格不能失效。
  if (/整单参数|整单|公共参数|公共|参数|common|运输/.test(n)) return 'common';
  if (/其他费用|其他|费用|other|extra/.test(n)) return 'other';
  return 'unknown';
}

/**
 * 单表退化（既没命名 Sheet、又只有一张数据表）时判角色：
 * 看表头能命中哪套字典的**不同字段**更多。命中数相同时偏向「模具」。
 * 修正前这里一律按注塑件解析，一张纯模具表会被喂进 INJ_COL_MAP 得出空结果。
 */
function guessRole(headers: string[]): 'mold' | 'part' {
  const hits = (matcher: (h: string) => string | null) => {
    const seen = new Set<string>();
    for (const h of headers) {
      const c = matcher(h);
      if (c) seen.add(c);
    }
    return seen.size;
  };
  return hits(MOLD_COL_MAP) >= hits(INJ_COL_MAP) ? 'mold' : 'part';
}

// ------------------------------------------------------------------ 输出结构

export interface ImportedMold {
  code?: string;
  name: string;
  materialCode?: string;
  /** 前/后模钢材编码（material 类型，存编码字符串） */
  params: Record<string, any>;
}
export interface ImportedPart {
  code?: string;
  name: string;
  materialCode?: string;
  qty: number;
  params: Record<string, any>;
}
export interface ImportedCommon {
  profitRate?: number;
  taxRate?: number;
  qtyVarName?: string;
  params: Record<string, any>;
}
export interface ExcelImportResult {
  fileName: string;
  molds: ImportedMold[];
  parts: ImportedPart[];
  common: ImportedCommon;
  extras: QuoteExtras;
  /** 命中的列（便于前端展示「识别到哪些」） */
  matched: { sheet: string; column: string; code: string }[];
  /** 没认出来的列（提示人工确认） */
  unmatched: { sheet: string; column: string }[];
  warnings: string[];
  /** 各 sheet 行数（调试/展示用） */
  sheetRows: { name: string; rows: number }[];
}

// ------------------------------------------------------------------ 核心读取

function readRows(ws: ExcelJS.Worksheet): { headers: string[]; rows: any[][] } {
  const maxRow = ws.rowCount;
  const maxCol = ws.columnCount;
  if (maxRow < 1 || maxCol < 1) return { headers: [], rows: [] };
  const headers: string[] = [];
  for (let c = 1; c <= maxCol; c++) {
    const t = cellText(ws.getCell(1, c).value);
    headers.push(t);
  }
  const rows: any[][] = [];
  for (let r = 2; r <= maxRow; r++) {
    const row: any[] = [];
    let hasValue = false;
    for (let c = 1; c <= maxCol; c++) {
      const v = ws.getCell(r, c).value;
      row.push(v);
      if (cellText(v) !== '') hasValue = true;
    }
    if (hasValue) rows.push(row);
  }
  return { headers, rows };
}

/** 把一行按 matcher 映射到 {code: value}，材料列走 resolveMaterialCode */
function mapRow(
  row: any[],
  headers: string[],
  matcher: (h: string) => string | null,
  materialCodes: Set<string>,
  sheet: string,
  onMatched: (m: { sheet: string; column: string; code: string }) => void,
  onUnmatched: (u: { sheet: string; column: string }) => void,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (let i = 0; i < headers.length; i++) {
    const code = matcher(headers[i]);
    if (!code) {
      const t = cellText(row[i] ?? '');
      if (t !== '') onUnmatched({ sheet, column: headers[i] || `第${i + 1}列` });
      continue;
    }
    const raw = cellText(row[i] ?? '');
    if (raw === '') continue;
    onMatched({ sheet, column: headers[i], code });
    if (TEXT_CODES.has(code)) {
      out[code] = String(raw).trim();
    } else if (materialCodes.has(code)) {
      const resolved = resolveMaterialCode(raw);
      if (resolved) out[code] = resolved;
    } else {
      const n = toNumber(raw);
      if (n !== undefined) out[code] = n;
    }
  }
  return out;
}

export async function importQuoteExcel(buffer: ArrayBuffer, fileName: string): Promise<ExcelImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const result: ExcelImportResult = {
    fileName,
    molds: [],
    parts: [],
    common: { params: {} },
    extras: { moldExtras: [], injectionExtras: [], otherExtras: [] },
    matched: [],
    unmatched: [],
    warnings: [],
    sheetRows: [],
  };

  // 同一列会在每一行重复命中 —— 去重后再返回，
  // 否则 100 行的表会把「未匹配列」刷 100 遍，接口和界面都被撑爆
  const seenMatched = new Set<string>();
  const seenUnmatched = new Set<string>();
  const onMatched = (m: { sheet: string; column: string; code: string }) => {
    const k = `${m.sheet}\u0000${m.column}\u0000${m.code}`;
    if (seenMatched.has(k)) return;
    seenMatched.add(k);
    result.matched.push(m);
  };
  const onUnmatched = (u: { sheet: string; column: string }) => {
    const k = `${u.sheet}\u0000${u.column}`;
    if (seenUnmatched.has(k)) return;
    seenUnmatched.add(k);
    result.unmatched.push(u);
  };

  const dataSheets = wb.worksheets.filter((ws) => ws.rowCount >= 1 && ws.columnCount >= 1);
  const named = dataSheets.filter((ws) => identifySheet(ws.name) !== 'unknown');

  const sheetsToProcess =
    named.length >= 1
      ? named
      : dataSheets.length === 1
        ? [dataSheets[0]]
        : [];

  for (const ws of sheetsToProcess) {
    const sheetName = ws.name;
    const { headers, rows } = readRows(ws);
    if (!headers.length) continue;
    // 命名 Sheet 按名字判角色；单表退化时按表头命中数猜「模具 / 注塑件」
    const role = named.length >= 1 ? identifySheet(ws.name) : guessRole(headers);
    result.sheetRows.push({ name: sheetName, rows: rows.length });

    if (named.length === 0) {
      result.warnings.push(
        `未识别到命名的 Sheet（模具清单 / 注塑件清单 / 整单参数 / 其他费用），已把「${sheetName}」按「${
          role === 'mold' ? '模具清单' : '注塑件清单'
        }」解析；建议下载官方模板填写，识别更准。`,
      );
    }

    // ---------- 其他费用：自由费用行 ----------
    if (role === 'other') {
      for (const row of rows) {
        const mapped = mapRow(row, headers, OTHER_COL_MAP, new Set(), sheetName, onMatched, onUnmatched);
        const name = String(mapped.name ?? '').trim();
        const amount = Number(mapped.amount ?? 0);
        if (!name) continue;
        result.extras.otherExtras!.push({
          id: `ext_${result.extras.otherExtras!.length + 1}`,
          name,
          amount: Number.isFinite(amount) ? amount : 0,
          note: mapped.note != null ? String(mapped.note) : undefined,
        });
      }
      continue;
    }

    // ---------- 公共参数：通常一行 ----------
    if (role === 'common') {
      const row = rows[0];
      if (!row) continue;
      const mapped = mapRow(row, headers, COMMON_COL_MAP, new Set(), sheetName, onMatched, onUnmatched);
      if (mapped.profitRate !== undefined) result.common.profitRate = mapped.profitRate;
      if (mapped.taxRate !== undefined) result.common.taxRate = mapped.taxRate;
      if (mapped.qtyVarName !== undefined) result.common.qtyVarName = String(mapped.qtyVarName);
      for (const k of Object.keys(mapped)) {
        if (k === 'profitRate' || k === 'taxRate' || k === 'qtyVarName') continue;
        result.common.params[k] = mapped[k];
      }
      warnHighRates(
        { profitRate: mapped.profitRate, taxRate: mapped.taxRate },
        `公共参数（${sheetName}）`,
        result.warnings,
      );
      continue;
    }

    // ---------- 模具 / 注塑件：逐行 ----------
    const isMold = role === 'mold';
    for (const row of rows) {
      const mapped = mapRow(
        row,
        headers,
        isMold ? MOLD_COL_MAP : INJ_COL_MAP,
        MATERIAL_CODES,
        sheetName,
        onMatched,
        onUnmatched,
      );
      const name = String(mapped.name ?? '').trim() || (isMold ? `模具 ${result.molds.length + 1}` : `注塑件 ${result.parts.length + 1}`);
      const materialCode = mapped.materialCode ? String(mapped.materialCode) : undefined;

      if (isMold) {
        const { code, name: _n, materialCode: _m, ...params } = mapped;
        warnHighRates(params, sheetName, result.warnings);
        result.molds.push({
          code: mapped.code ? String(mapped.code) : undefined,
          name,
          materialCode,
          params,
        });
      } else {
        const qty = Number(mapped.injectionQty ?? 0);
        const { code, name: _n, materialCode: _m, injectionQty, ...params } = mapped;
        warnHighRates(params, sheetName, result.warnings);
        result.parts.push({
          code: mapped.code ? String(mapped.code) : undefined,
          name,
          materialCode,
          qty: Number.isFinite(qty) ? qty : 0,
          params,
        });
      }
    }
  }

  if (result.molds.length === 0 && result.parts.length === 0) {
    result.warnings.push('没解析出任何模具或注塑件，请确认表格里有「模具清单」「注塑件清单」Sheet 且有数据行');
  }

  return result;
}
