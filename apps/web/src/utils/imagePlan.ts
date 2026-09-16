// 件图预处理「决策」—— 纯函数、零依赖，方便单独验证。
//
// 真正的压缩 / 转码在 utils/image.ts 里做（要用 Canvas），
// 但「到底要不要动这张图」这件事本身是纯逻辑，抽出来单独测更稳。

/** 长边上限：1200px 足够报价单看清，又不会让单据臃肿 */
export const MAX_EDGE = 1200;
/** 超过这个边长就缩放 */
export const RESIZE_ABOVE = 1200;
/** 转 JPEG 时的质量 */
export const JPEG_QUALITY = 0.86;

/**
 * 这些格式后端收、**exceljs 也认**，尺寸合适就原样上传。
 * 其余（WEBP / BMP / GIF / 其他）必须转码，
 * 否则图片会在 Excel 报价单里被静默跳过 —— 用户会以为「图没导出来」。
 */
export const EXCEL_SAFE = new Set(['image/png', 'image/jpeg']);

export interface ImagePlan {
  longEdge: number;
  needResize: boolean;
  needConvert: boolean;
  /** true = 原样上传，一个字节都不改 */
  skip: boolean;
  /** 缩放后的目标尺寸（不缩放时等于原尺寸） */
  targetW: number;
  targetH: number;
  /** 输出格式：PNG 或无损需求 → PNG；其余 → JPEG */
  outType: 'image/png' | 'image/jpeg';
}

/** 拿到图片类型与尺寸，判断要不要缩放、要不要转码 */
export function planImage(type: string, w: number, h: number): ImagePlan {
  const longEdge = Math.max(w, h);
  const needResize = longEdge > RESIZE_ABOVE;
  const needConvert = !EXCEL_SAFE.has(type);
  const ratio = needResize && longEdge > 0 ? MAX_EDGE / longEdge : 1;
  return {
    longEdge,
    needResize,
    needConvert,
    skip: !needResize && !needConvert,
    targetW: Math.max(1, Math.round(w * ratio)),
    targetH: Math.max(1, Math.round(h * ratio)),
    outType: type === 'image/png' || needConvert ? 'image/png' : 'image/jpeg',
  };
}
