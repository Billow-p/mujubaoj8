/**
 * 从 Excel 询价单里提取内嵌图片。
 *
 * 客户询价经常是「一张 Excel，左边写品名规格，右边贴图」。
 * 这里把图抠出来，并记下它锚在哪一行、那一行写了什么 ——
 * 界面上就能给出「这张图属于哪个件」的建议，由人确认后落进件图槽。
 *
 * 只支持 .xlsx：老 .xls 是 BIFF 二进制格式，图片提取不可靠，直接让客户另存为 xlsx。
 */

import ExcelJS from 'exceljs';

export interface ExtractedImage {
  id: number;
  sheetName: string;
  /** 1 起的行号（直观，界面上直接显示） */
  row: number;
  col: number;
  name: string;
  /** 浏览器可直接显示的 data URL */
  dataUrl: string;
  /** 该行前若干列的文本，作为「这是什么件」的线索 */
  rowText: string[];
  /** 建议的件名：该行第一个像名字的文本 */
  suggestedName: string;
  /** 建议归类：行文本里有「模」字倾向模具，否则注塑件 */
  suggestedKind: 'mold' | 'part';
}

export interface ExtractResult {
  fileName: string;
  sheets: { name: string; rowCount: number }[];
  images: ExtractedImage[];
  /** 因为太大 / 格式不支持而跳过的数量 */
  skipped: number;
  /** 提示信息 */
  notes: string[];
}

/** 最多返回多少张（多了响应体会爆炸） */
const MAX_IMAGES = 40;
/** 单张图上限：base64 会膨胀 1/3，2MB 的图返回就是 2.7MB */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** 取该行前几列做线索 */
const TEXT_COLS = 8;

/** 浏览器能直接显示的图片类型（EMF/WMF 是矢量，浏览器不认，要排除） */
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
};

function cellText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return v.toLocaleDateString('zh-CN');
  // 富文本 / 公式结果 / 超链接
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join('').trim();
    if ('result' in v && v.result != null) return String(v.result).trim();
    if ('text' in v) return String(v.text).trim();
  }
  return '';
}

/** 从一行文本里挑出最像「件名」的那个：有汉字或字母、长度合适、不是纯数字 */
function pickName(texts: string[]): string {
  for (const t of texts) {
    if (!t || t.length < 2 || t.length > 40) continue;
    if (/^[\d.,\s¥$￥-]+$/.test(t)) continue; // 纯数字/金额，不是名字
    if (/[一-龥]/.test(t)) return t; // 优先含中文
    if (/[A-Za-z]/.test(t)) return t;
  }
  return '';
}

export async function extractExcelImages(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<ExtractResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const sheets = wb.worksheets.map((ws) => ({ name: ws.name, rowCount: ws.rowCount }));
  const images: ExtractedImage[] = [];
  const notes: string[] = [];
  let skipped = 0;

  // 图片数据挂在内部 model 上（exceljs 没提供公开 API，做防御性读取）
  const media: any[] = (wb as any).model?.media ?? [];

  for (const ws of wb.worksheets) {
    let wsImages: any[] = [];
    try {
      wsImages = ws.getImages();
    } catch {
      continue;
    }

    for (const im of wsImages) {
      if (images.length >= MAX_IMAGES) {
        skipped++;
        continue;
      }
      const meta = media.find((m: any) => m.index === im.imageId);
      if (!meta?.buffer) {
        skipped++;
        continue;
      }
      const ext = String(meta.extension || '').toLowerCase();
      const mime = MIME[ext];
      if (!mime) {
        skipped++; // EMF / WMF 等矢量图，浏览器显示不了
        continue;
      }
      if (meta.buffer.length > MAX_IMAGE_BYTES) {
        skipped++;
        continue;
      }

      // exceljs 的行列是 0 起的，转成 1 起更符合直觉
      const row = (im.range?.tl?.nativeRow ?? 0) + 1;
      const col = (im.range?.tl?.nativeCol ?? 0) + 1;

      const rowText: string[] = [];
      for (let c = 1; c <= TEXT_COLS; c++) {
        const t = cellText(ws.getCell(row, c).value);
        if (t) rowText.push(t);
      }

      const joined = rowText.join(' ');
      images.push({
        id: im.imageId,
        sheetName: ws.name,
        row,
        col,
        name: `${meta.name || `image${im.imageId + 1}`}.${ext}`,
        dataUrl: `data:${mime};base64,${meta.buffer.toString('base64')}`,
        rowText,
        suggestedName: pickName(rowText),
        // 行里出现「模」字多半是模具；其余按注塑件
        suggestedKind: /模|mold|模架|模芯/i.test(joined) ? 'mold' : 'part',
      });
    }
  }

  if (!images.length && !skipped) {
    notes.push('这个 Excel 里没有内嵌图片');
  }
  if (skipped) {
    notes.push(`有 ${skipped} 张图被跳过（超过 ${MAX_IMAGES} 张上限、单张大于 2MB，或是 EMF/WMF 矢量图）`);
  }
  if (images.length) {
    notes.push(`共提取 ${images.length} 张图，请确认每张图属于哪个件`);
  }

  return { fileName, sheets, images, skipped, notes };
}
