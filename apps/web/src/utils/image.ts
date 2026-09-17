// 件图通道 —— 所有「把一张图变成件图」的入口都走这里。
//
// 为什么单独抽出来：
//   一期是「用户手点上传」，二期是「从 Excel / 3D 图纸里批量识别导入」。
//   两条路最后都是「一个 File → 一个 QuoteImage」，所以压缩、转码、
//   上传、错误提示统一收在这个文件里，二期直接复用 uploadImage()，
//   不用再关心格式兼容与体积这些坑。
//
// 两个必须在这里解决的问题（放这儿一次解决，避免各处重复踩）：
//   1) 体积：手机拍的照片动辄 3~5MB，直接存会让磁盘和 Excel 报价单都失控；
//   2) 格式：后端能收 WEBP / BMP / GIF，但 **exceljs 只认 PNG / JPEG / GIF**，
//      不转码的话图片在报价单里会被静默跳过 —— 用户会以为「图没导出来」。

import { uploads, type QuoteImage } from '../api';
import { planImage, JPEG_QUALITY } from './imagePlan';

export interface PreparedImage {
  /** 处理后的文件（可能被缩放过、转过码） */
  file: File;
  /** 是否做了处理，用于给用户提示 */
  transformed: boolean;
  /** 原始尺寸，便于排查 */
  originalSize: number;
}

/** 读图片为可绘制对象（优先 createImageBitmap，退化到 <img>） */
async function decode(file: File): Promise<{ w: number; h: number; draw: CanvasImageSource; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file);
    return { w: bmp.width, h: bmp.height, draw: bmp, close: () => bmp.close?.() };
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('图片无法解码'));
    img.src = url;
  });
  return { w: img.naturalWidth, h: img.naturalHeight, draw: img, close: () => URL.revokeObjectURL(url) };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('图片压缩失败'))),
      type,
      quality,
    );
  });
}

/**
 * 上传前的预处理：按需缩放 + 把 Excel 不认的格式转成 PNG。
 *
 * 规则（尽量少动原图，只在必要时代价）：
 *   · PNG / JPEG 且边长没超 → 原样返回，一个字节都不改；
 *   · PNG / JPEG 但太大 → 等比缩到长边 1200，仍存原格式；
 *   · WEBP / BMP / 其他 → 转 PNG（PNG 无损、支持透明，最稳）；
 *   · GIF → 转 PNG（保留第一帧；动图在报价单里没意义）。
 *
 * ⚠ 绝不允许「解码不了就原样上传」：一份解不开的 WEBP 传上去，
 * 导出报价单时会被静默跳过，用户看到的现象就是「我明明传了图，Excel 里没有」。
 * 所以这里解码失败必须抛错，让调用方给用户一句人话提示。
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const originalSize = file.size;

  // 非图片直接挡掉，省得白白解码
  if (!file.type.startsWith('image/')) {
    throw new Error('不是图片文件');
  }

  // 先按 MIME 判断该不该转码。Excel 不认的类型**必须**解码成功才能继续 ——
  // 有些相机会给 WEBP 塞 image/jpeg 的错 MIME，靠 plan 是兜不住的。
  const prePlan = planImage(file.type, 1, 1);
  const typeNeedsConvert = prePlan.needConvert;

  let decoded: Awaited<ReturnType<typeof decode>>;
  try {
    decoded = await decode(file);
  } catch {
    if (typeNeedsConvert) {
      throw new Error('这张图片浏览器打不开，没法存成报价单能显示的格式，请换一张（或先存成 PNG / JPG 再上传）');
    }
    // PNG / JPEG 解不开仍可原样上传（服务端与 Excel 都认容器格式）
    return { file, transformed: false, originalSize };
  }

  const { w, h, draw, close } = decoded;
  const plan = planImage(file.type, w, h);

  if (plan.skip) {
    close();
    return { file, transformed: false, originalSize };
  }

  try {
    const tw = plan.targetW;
    const th = plan.targetH;

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器不支持 Canvas，无法处理图片');
    ctx.drawImage(draw, 0, 0, tw, th);

    const outType = plan.outType;
    const blob = await toBlob(canvas, outType, outType === 'image/jpeg' ? JPEG_QUALITY : undefined);

    // 转完反而更大，且原格式本来就 Excel 认 —— 那就用原图
    if (!plan.needConvert && blob.size >= file.size) {
      return { file, transformed: false, originalSize };
    }

    const ext = outType === 'image/png' ? 'png' : 'jpg';
    const base = (file.name || 'image').replace(/\.[^.]+$/, '');
    return {
      file: new File([blob], `${base}.${ext}`, { type: outType }),
      transformed: true,
      originalSize,
    };
  } finally {
    close();
  }
}

/**
 * 【统一入口】一个图片文件 → 一个件图。
 *
 * 二期从 Excel 内嵌图 / 3D 渲染截图导入时，也调这个函数，
 * 拿到的 QuoteImage 直接塞进 molds[].image / parts[].image 即可。
 */
export async function uploadImage(
  file: File | Blob,
  opts: { name?: string; source?: QuoteImage['source'] } = {},
): Promise<QuoteImage> {
  const raw =
    file instanceof File
      ? file
      : new File([file], opts.name || 'image.png', { type: file.type || 'image/png' });

  const prepared = await prepareImage(raw);
  const res = await uploads.upload(prepared.file);
  return {
    url: res.url,
    name: opts.name || raw.name || res.name,
    source: opts.source ?? 'upload',
    uploadedAt: new Date().toISOString(),
  };
}

/**
 * 【前置体检】在上传之前就把「传上去 Excel 也显示不出来」的图拦下来。
 *
 * 起因：WEBP / BMP 这类图 exceljs 不认，而 3D 渲染截图、Excel 内嵌图
 * 走的是 dataURL 直传通道，**不过 prepareImage 的转码**，于是出现
 * 「图上传成功了，导出的报价单里就是没图」这种静默失败。
 *
 * 返回 null 表示「能安全落到报价单里」，否则返回一句给用户看的中文原因。
 */
export async function assertExcelDisplayable(file: File | Blob): Promise<string | null> {
  const name = (file as File).name || 'image';
  const type = (file.type || '').toLowerCase();

  // 后端只给 png / jpg / jpeg / gif / webp / bmp 建 /uploads 记录（见 uploads.ts 白名单）
  if (type && !/^image\/(png|jpe?g|gif|webp|bmp)$/.test(type)) {
    return `这件图是 ${type} 格式，报价单里显示不出来，请换成 PNG / JPG`;
  }

  // GIF 动图在 Excel 里只会显示第一帧，仍可接受；WEBP / BMP 一律不让过
  if (type === 'image/webp' || type === 'image/bmp' || /\.(webp|bmp)$/i.test(name)) {
    return 'WEBP / BMP 的图在 Excel 报价单里显示不出来，请换成 PNG / JPG 再上传';
  }

  // 体积兜底：单张 > 6MB 的图会让报价单体积失控
  if (file.size > 6 * 1024 * 1024) {
    return `这件图 ${humanSize(file.size)} 有点大，请先压缩到 6MB 以内再上传`;
  }

  return null;
}

/** 人话版体积，用于提示 */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * data URL → File。
 * 3D 渲染截图、Excel 内嵌图都要走这条路，才能复用上面的上传与压缩逻辑。
 */
export function dataUrlToFile(dataUrl: string, name: string): File | null {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: m[1] });
}
